import { getApiBaseUrl } from '$lib/db/config';
import { authStore, getAuthSnapshot, type AuthTokens } from '$lib/stores/auth';

export class ApiError extends Error {
  readonly status: number;
  readonly requestId?: string;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
    this.requestId = requestId;
  }
}

type RequestOptions = {
  auth?: boolean;
  retryAuth?: boolean;
  signal?: AbortSignal;
  retryNetwork?: boolean;
  maxNetworkRetries?: number;
  retryDelayMs?: number;
};

type JsonLike = Record<string, unknown>;

let refreshInFlight: Promise<AuthTokens | null> | null = null;

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function buildUrl(path: string): string {
  if (isAbsoluteUrl(path)) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}

function isLocalApiBaseUrl(baseUrl: string): boolean {
  try {
    const parsedUrl = new URL(baseUrl);
    const hostname = parsedUrl.hostname.toLowerCase();
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1';
  } catch {
    return false;
  }
}

function parseErrorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const maybeError = 'error' in payload ? (payload as { error?: unknown }).error : undefined;
    if (typeof maybeError === 'string' && maybeError.trim()) {
      return maybeError;
    }

    const maybeMessage = 'message' in payload ? (payload as { message?: unknown }).message : undefined;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
  }

  if (status === 401) {
    return 'Sessione non valida o scaduta';
  }

  if (status === 403) {
    return 'Accesso negato';
  }

  return `Errore API (${status})`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }

  const text = await response.text().catch(() => '');
  return text || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshAccessToken(): Promise<AuthTokens | null> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const snapshot = getAuthSnapshot();
    const refreshToken = snapshot.tokens?.refreshToken;

    if (!refreshToken) {
      return null;
    }

    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ refreshToken })
      });

      const payload = (await parseResponseBody(response)) as AuthTokens | JsonLike | null;
      if (!response.ok || !payload || typeof payload !== 'object') {
        authStore.logout();
        return null;
      }

      const nextTokens = payload as AuthTokens;
      if (!nextTokens.accessToken || !nextTokens.refreshToken) {
        authStore.logout();
        return null;
      }

      authStore.setTokens(nextTokens);
      return nextTokens;
    } catch {
      authStore.logout();
      return null;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  options?: RequestOptions,
  networkAttempt = 0
): Promise<T> {
  const authEnabled = options?.auth !== false;
  const retryAuth = options?.retryAuth !== false;

  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined)
  };

  if (!headers['content-type'] && init.body && !(init.body instanceof FormData)) {
    headers['content-type'] = 'application/json';
  }

  if (authEnabled) {
    const snapshot = getAuthSnapshot();
    const accessToken = snapshot.tokens?.accessToken;
    if (accessToken) {
      headers.authorization = `Bearer ${accessToken}`;
    }
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path), {
      ...init,
      headers,
      signal: options?.signal
    });
  } catch (error) {
    const allowNetworkRetry = options?.retryNetwork !== false;
    const maxNetworkRetries = options?.maxNetworkRetries ?? 8;
    const retryDelayMs = options?.retryDelayMs ?? 500;

    if (allowNetworkRetry && networkAttempt < maxNetworkRetries) {
      await sleep(retryDelayMs);
      return request<T>(path, init, options, networkAttempt + 1);
    }

    const baseUrl = getApiBaseUrl();
    const isLocalBackend = isLocalApiBaseUrl(baseUrl);
    throw new ApiError(
      isLocalBackend
        ? `Impossibile raggiungere il backend API locale su ${baseUrl}. Verifica che il servizio locale sia attivo.`
        : `Impossibile raggiungere il backend API remoto su ${baseUrl}. Verifica connessione Internet e disponibilità del servizio.`,
      0,
      {
        cause: error instanceof Error ? error.message : String(error)
      }
    );
  }

  if (response.status === 401 && authEnabled && retryAuth) {
    const refreshed = await refreshAccessToken();
    if (refreshed?.accessToken) {
      return request<T>(
        path,
        {
          ...init,
          headers: {
            ...headers,
            authorization: `Bearer ${refreshed.accessToken}`
          }
        },
        {
          ...options,
          retryAuth: false
        }
      );
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await parseResponseBody(response);
  if (!response.ok) {
    const requestId =
      (payload && typeof payload === 'object' && 'requestId' in payload
        ? (payload as { requestId?: unknown }).requestId
        : undefined) || undefined;
    throw new ApiError(
      parseErrorMessage(response.status, payload),
      response.status,
      payload,
      typeof requestId === 'string' ? requestId : undefined
    );
  }

  return payload as T;
}

export async function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>(path, { method: 'GET' }, options);
}

export async function apiPost<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>(
    path,
    {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body)
    },
    options
  );
}

export async function apiPut<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>(
    path,
    {
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body)
    },
    options
  );
}

export async function apiPatch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>(
    path,
    {
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body)
    },
    options
  );
}

export async function apiDelete<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>(path, { method: 'DELETE' }, options);
}
