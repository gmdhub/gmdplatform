import { appConfigDir, join } from '@tauri-apps/api/path';

const SQLITE_URL_PATTERN = /^sqlite:.+/i;

export type DataProvider = 'legacy' | 'api';
export type AppEnvironment = 'development' | 'production' | 'test';

const DATA_PROVIDER_STORAGE_KEY_BASE = 'gmd_data_provider';
const API_BASE_URL_STORAGE_KEY_BASE = 'gmd_api_base_url';
const DATABASE_DIRECTORY_STORAGE_KEY_BASE = 'gmd_database_directory';
const APP_ENV_MARKER_KEY = 'gmd_app_env_marker';
const FIXED_DATA_PROVIDER: DataProvider = 'api';

const SENSITIVE_STORAGE_BASE_KEYS = ['gmd_user', 'gmd_auth_tokens', 'gmd_ambulatorio', 'gmd_api_base_url'] as const;

export const DATABASE_FILENAME = 'gmd.db';

function normalizeAppEnvironment(rawValue: string): AppEnvironment {
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'production') return 'production';
  if (normalized === 'test') return 'test';
  return 'development';
}

const APP_ENV: AppEnvironment = normalizeAppEnvironment(
  String(import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE ?? 'development')
);
const BUILD_TIME_API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? '')
  .trim()
  .replace(/\/+$/, '');

const API_BASE_OVERRIDE_ALLOWED =
  String(import.meta.env.VITE_ALLOW_API_BASE_OVERRIDE ?? 'false').trim().toLowerCase() === 'true';

let storageIsolationApplied = false;

function getDefaultApiBaseUrl(): string {
  if (BUILD_TIME_API_BASE_URL) {
    return BUILD_TIME_API_BASE_URL;
  }

  if (APP_ENV === 'production') {
    console.error(
      'VITE_API_BASE_URL non configurato in build production. Fallback su API locale 127.0.0.1:8787.'
    );
  }

  return 'http://127.0.0.1:8787';
}

export function isLocalApiBaseUrl(baseUrl: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(baseUrl.trim());
}

function removeStorageKey(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // ignore storage removal failures
  }
}

export function getAppEnvironment(): AppEnvironment {
  return APP_ENV;
}

export function getScopedStorageKey(baseKey: string): string {
  return `${baseKey}:${APP_ENV}`;
}

export function isApiBaseOverrideAllowed(): boolean {
  return API_BASE_OVERRIDE_ALLOWED;
}

export function ensureStorageIsolationForEnvironment(): void {
  if (storageIsolationApplied || typeof window === 'undefined') {
    return;
  }

  const localStorageRef = window.localStorage;
  const sessionStorageRef = window.sessionStorage;
  const previousEnv = localStorageRef.getItem(APP_ENV_MARKER_KEY)?.trim();

  for (const baseKey of SENSITIVE_STORAGE_BASE_KEYS) {
    removeStorageKey(localStorageRef, baseKey);
    removeStorageKey(sessionStorageRef, baseKey);
  }

  if (previousEnv && previousEnv !== APP_ENV) {
    for (const baseKey of SENSITIVE_STORAGE_BASE_KEYS) {
      const oldScopedKey = `${baseKey}:${previousEnv}`;
      removeStorageKey(localStorageRef, oldScopedKey);
      removeStorageKey(sessionStorageRef, oldScopedKey);
    }
  }

  localStorageRef.setItem(APP_ENV_MARKER_KEY, APP_ENV);
  storageIsolationApplied = true;
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  ensureStorageIsolationForEnvironment();
  return window.localStorage;
}

export function getDataProvider(): DataProvider {
  const localStorageRef = getLocalStorage();
  const scopedKey = getScopedStorageKey(DATA_PROVIDER_STORAGE_KEY_BASE);
  const storedValue = localStorageRef?.getItem(scopedKey)?.trim().toLowerCase() ?? null;

  if (localStorageRef) {
    if (storedValue !== FIXED_DATA_PROVIDER) {
      localStorageRef.setItem(scopedKey, FIXED_DATA_PROVIDER);
    }
    removeStorageKey(localStorageRef, DATA_PROVIDER_STORAGE_KEY_BASE);
  }

  return FIXED_DATA_PROVIDER;
}

export function setDataProvider(provider: DataProvider): void {
  const localStorageRef = getLocalStorage();
  if (!localStorageRef) {
    return;
  }

  if (provider !== FIXED_DATA_PROVIDER) {
    console.warn('DATA_PROVIDER=legacy non supportato: il frontend è bloccato su provider api');
  }

  localStorageRef.setItem(getScopedStorageKey(DATA_PROVIDER_STORAGE_KEY_BASE), FIXED_DATA_PROVIDER);
  removeStorageKey(localStorageRef, DATA_PROVIDER_STORAGE_KEY_BASE);
}

export function isApiDataProvider(): boolean {
  return getDataProvider() === 'api';
}

export function getApiBaseUrl(): string {
  const localStorageRef = getLocalStorage();
  const scopedKey = getScopedStorageKey(API_BASE_URL_STORAGE_KEY_BASE);

  if (!API_BASE_OVERRIDE_ALLOWED) {
    if (localStorageRef) {
      removeStorageKey(localStorageRef, API_BASE_URL_STORAGE_KEY_BASE);
      removeStorageKey(localStorageRef, scopedKey);
    }
    return getDefaultApiBaseUrl();
  }

  if (localStorageRef) {
    const legacyValue = localStorageRef.getItem(API_BASE_URL_STORAGE_KEY_BASE)?.trim();
    if (legacyValue && !localStorageRef.getItem(scopedKey)) {
      localStorageRef.setItem(scopedKey, legacyValue.replace(/\/+$/, ''));
    }
    removeStorageKey(localStorageRef, API_BASE_URL_STORAGE_KEY_BASE);

    const storedValue = localStorageRef.getItem(scopedKey)?.trim();
    if (storedValue) {
      return storedValue.replace(/\/+$/, '');
    }
  }

  return getDefaultApiBaseUrl();
}

export function setApiBaseUrl(url: string): void {
  const localStorageRef = getLocalStorage();
  if (!localStorageRef) {
    return;
  }

  if (!API_BASE_OVERRIDE_ALLOWED) {
    console.warn('Override API base URL disabilitato: imposta VITE_ALLOW_API_BASE_OVERRIDE=true solo in ambienti non-prod.');
    removeStorageKey(localStorageRef, API_BASE_URL_STORAGE_KEY_BASE);
    removeStorageKey(localStorageRef, getScopedStorageKey(API_BASE_URL_STORAGE_KEY_BASE));
    return;
  }

  const normalized = url.trim().replace(/\/+$/, '');
  const scopedKey = getScopedStorageKey(API_BASE_URL_STORAGE_KEY_BASE);
  if (!normalized) {
    removeStorageKey(localStorageRef, scopedKey);
    removeStorageKey(localStorageRef, API_BASE_URL_STORAGE_KEY_BASE);
    return;
  }

  localStorageRef.setItem(scopedKey, normalized);
  removeStorageKey(localStorageRef, API_BASE_URL_STORAGE_KEY_BASE);
}

export function assertSqliteDatabaseUrl(url: string): string {
  const normalized = url.trim();
  if (!SQLITE_URL_PATTERN.test(normalized)) {
    throw new Error(`URL database non supportato: ${url}. È consentito solo sqlite:*`);
  }

  return normalized;
}

export function getConfiguredDatabaseDirectory(): string | null {
  const localStorageRef = getLocalStorage();
  const storedValue = localStorageRef?.getItem(getScopedStorageKey(DATABASE_DIRECTORY_STORAGE_KEY_BASE))?.trim();
  return storedValue ? storedValue : null;
}

export function setConfiguredDatabaseDirectory(path: string): void {
  const localStorageRef = getLocalStorage();
  if (!localStorageRef) {
    return;
  }

  const normalizedPath = path.trim();
  const scopedKey = getScopedStorageKey(DATABASE_DIRECTORY_STORAGE_KEY_BASE);
  if (!normalizedPath) {
    removeStorageKey(localStorageRef, scopedKey);
    removeStorageKey(localStorageRef, DATABASE_DIRECTORY_STORAGE_KEY_BASE);
    return;
  }

  localStorageRef.setItem(scopedKey, normalizedPath);
  removeStorageKey(localStorageRef, DATABASE_DIRECTORY_STORAGE_KEY_BASE);
}

export function clearConfiguredDatabaseDirectory(): void {
  const localStorageRef = getLocalStorage();
  if (!localStorageRef) {
    return;
  }

  removeStorageKey(localStorageRef, getScopedStorageKey(DATABASE_DIRECTORY_STORAGE_KEY_BASE));
  removeStorageKey(localStorageRef, DATABASE_DIRECTORY_STORAGE_KEY_BASE);
}

export async function getDefaultDatabaseDirectory(): Promise<string> {
  if (isApiDataProvider()) {
    return 'REMOTE_DATABASE';
  }

  return appConfigDir();
}

export async function getRuntimeDatabaseDirectory(): Promise<string> {
  if (isApiDataProvider()) {
    return 'REMOTE_DATABASE';
  }

  const configuredDirectory = getConfiguredDatabaseDirectory();
  if (configuredDirectory) {
    return configuredDirectory;
  }

  return getDefaultDatabaseDirectory();
}

export async function getDatabasePathForDirectory(directoryPath: string): Promise<string> {
  if (isApiDataProvider()) {
    return `api:${getApiBaseUrl()}`;
  }

  const normalizedDirectoryPath = directoryPath.trim();
  if (!normalizedDirectoryPath) {
    throw new Error('Percorso cartella database non valido');
  }

  return join(normalizedDirectoryPath, DATABASE_FILENAME);
}

export async function getRuntimeDatabasePath(): Promise<string> {
  if (isApiDataProvider()) {
    return `api:${getApiBaseUrl()}`;
  }

  const runtimeDirectory = await getRuntimeDatabaseDirectory();
  return getDatabasePathForDirectory(runtimeDirectory);
}

export async function getRuntimeDatabaseUrl(): Promise<string> {
  if (isApiDataProvider()) {
    return `api:${getApiBaseUrl()}`;
  }

  const runtimePath = await getRuntimeDatabasePath();
  return assertSqliteDatabaseUrl(`sqlite:${runtimePath}`);
}
