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

function getRemoteAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (!forwarded) {
    return '127.0.0.1';
  }
  const first = forwarded.split(',')[0]?.trim();
  return first || '127.0.0.1';
}

Deno.serve(async (request) => {
  const app = await getFastifyApp();
  const url = new URL(request.url);
  const normalizedPath = normalizePath(url.pathname);
  const injectUrl = `${normalizedPath}${url.search}`;
  const isPayloadMethod = !['GET', 'HEAD'].includes(request.method.toUpperCase());
  const payload = isPayloadMethod ? await request.text() : undefined;

  const injected = await app.inject({
    method: request.method,
    url: injectUrl,
    headers: toInjectHeaders(request.headers),
    payload,
    remoteAddress: getRemoteAddress(request)
  });

  return new Response(injected.body, {
    status: injected.statusCode,
    headers: toResponseHeaders(injected.headers)
  });
});
