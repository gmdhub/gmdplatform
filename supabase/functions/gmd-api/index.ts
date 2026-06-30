import { buildApp } from '../../../server/dist/app.js';

type FastifyInjectHeaders = Record<string, string | string[]>;

const FUNCTION_PREFIXES = ['/functions/v1/gmd-api', '/gmd-api'];

let appPromise: ReturnType<typeof buildApp> | null = null;

function getFastifyApp() {
  if (!appPromise) {
    appPromise = buildApp();
  }
  return appPromise;
}

function normalizePath(pathname: string): string {
  for (const prefix of FUNCTION_PREFIXES) {
    if (pathname === prefix) {
      return '/';
    }
    if (pathname.startsWith(`${prefix}/`)) {
      return pathname.slice(prefix.length);
    }
  }
  return pathname || '/';
}

function toInjectHeaders(requestHeaders: Headers): FastifyInjectHeaders {
  const headers: FastifyInjectHeaders = {};

  for (const [key, value] of requestHeaders.entries()) {
    if (headers[key]) {
      const existing = headers[key];
      headers[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      continue;
    }
    headers[key] = value;
  }

  return headers;
}

function toResponseHeaders(headers: Record<string, string | string[] | number | undefined>): Headers {
  const responseHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const part of value) {
        responseHeaders.append(key, String(part));
      }
      continue;
    }

    responseHeaders.set(key, String(value));
  }

  return responseHeaders;
}

function allowsResponseBody(statusCode: number): boolean {
  if (statusCode === 101 || statusCode === 103 || statusCode === 204 || statusCode === 205 || statusCode === 304) {
    return false;
  }

  return true;
}

function getRemoteAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (!forwarded) {
    return '127.0.0.1';
  }
  const first = forwarded.split(',')[0]?.trim();
  return first || '127.0.0.1';
}

function buildPreflightResponse(request: Request): Response {
  const origin = request.headers.get('origin') ?? '*';
  const allowHeaders =
    request.headers.get('access-control-request-headers') ?? 'content-type,authorization';

  const headers = new Headers();
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-credentials', 'true');
  headers.set('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('access-control-allow-headers', allowHeaders);
  headers.set('access-control-max-age', '86400');
  headers.set('vary', 'Origin');

  return new Response(null, {
    status: 204,
    headers
  });
}

Deno.serve(async (request) => {
  if (request.method.toUpperCase() === 'OPTIONS') {
    return buildPreflightResponse(request);
  }

  const app = await getFastifyApp();
  const url = new URL(request.url);
  const normalizedPath = normalizePath(url.pathname);
  const injectUrl = `${normalizedPath}${url.search}`;
  const isPayloadMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase());
  let payload: string | undefined;
  if (isPayloadMethod) {
    const rawPayload = await request.text();
    payload = rawPayload.length > 0 ? rawPayload : undefined;
  }

  const injected = await app.inject({
    method: request.method,
    url: injectUrl,
    headers: toInjectHeaders(request.headers),
    payload,
    remoteAddress: getRemoteAddress(request)
  });

  const responseHeaders = toResponseHeaders(injected.headers);
  const responseBody = allowsResponseBody(injected.statusCode) ? injected.body : null;

  if (responseBody === null) {
    responseHeaders.delete('content-length');
    responseHeaders.delete('content-type');
    responseHeaders.delete('transfer-encoding');
  }

  return new Response(responseBody, {
    status: injected.statusCode,
    headers: responseHeaders
  });
});
