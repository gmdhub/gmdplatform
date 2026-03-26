import { writable } from 'svelte/store';
import type { User } from '$lib/db/types';
import {
  ensureStorageIsolationForEnvironment,
  getScopedStorageKey,
  isApiDataProvider
} from '$lib/db/config';

const USER_STORAGE_KEY_BASE = 'gmd_user';
const TOKENS_STORAGE_KEY_BASE = 'gmd_auth_tokens';
const AMBULATORIO_STORAGE_KEY_BASE = 'gmd_ambulatorio';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  expiresAt?: number;
}

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
}

let authSnapshot: AuthState = {
  user: null,
  tokens: null,
  isAuthenticated: false
};

function sanitizeUser(user: User): User {
  const { password_hash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

function readSessionStorage(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  ensureStorageIsolationForEnvironment();
  return sessionStorage.getItem(key);
}

function writeSessionStorage(key: string, value: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  ensureStorageIsolationForEnvironment();

  if (value === null) {
    sessionStorage.removeItem(key);
    return;
  }

  sessionStorage.setItem(key, value);
}

function createAuthStore() {
  const { subscribe, set } = writable<AuthState>(authSnapshot);

  function commit(next: AuthState): void {
    authSnapshot = next;
    set(next);
  }

  return {
    subscribe,
    login: (user: User, tokens?: AuthTokens) => {
      const safeUser = sanitizeUser(user);
      const normalizedTokens = tokens
        ? {
            ...tokens,
            expiresAt:
              tokens.expiresAt ??
              (tokens.expiresIn ? Date.now() + Math.max(0, tokens.expiresIn) * 1000 : undefined)
          }
        : authSnapshot.tokens;

      commit({
        user: safeUser,
        tokens: normalizedTokens ?? null,
        isAuthenticated: true
      });

      writeSessionStorage(getScopedStorageKey(USER_STORAGE_KEY_BASE), JSON.stringify(safeUser));
      writeSessionStorage(
        getScopedStorageKey(TOKENS_STORAGE_KEY_BASE),
        normalizedTokens ? JSON.stringify(normalizedTokens) : null
      );
    },
    setTokens: (tokens: AuthTokens | null) => {
      const normalizedTokens = tokens
        ? {
            ...tokens,
            expiresAt:
              tokens.expiresAt ??
              (tokens.expiresIn ? Date.now() + Math.max(0, tokens.expiresIn) * 1000 : undefined)
          }
        : null;

      commit({
        user: authSnapshot.user,
        tokens: normalizedTokens,
        isAuthenticated: Boolean(authSnapshot.user && normalizedTokens)
      });

      writeSessionStorage(
        getScopedStorageKey(TOKENS_STORAGE_KEY_BASE),
        normalizedTokens ? JSON.stringify(normalizedTokens) : null
      );
    },
    logout: () => {
      commit({
        user: null,
        tokens: null,
        isAuthenticated: false
      });
      writeSessionStorage(getScopedStorageKey(USER_STORAGE_KEY_BASE), null);
      writeSessionStorage(getScopedStorageKey(TOKENS_STORAGE_KEY_BASE), null);
      if (typeof window !== 'undefined') {
        ensureStorageIsolationForEnvironment();
        sessionStorage.removeItem(getScopedStorageKey(AMBULATORIO_STORAGE_KEY_BASE));
        sessionStorage.removeItem(AMBULATORIO_STORAGE_KEY_BASE);
      }
    },
    restore: () => {
      const storedUser = readSessionStorage(getScopedStorageKey(USER_STORAGE_KEY_BASE));
      const storedTokens = readSessionStorage(getScopedStorageKey(TOKENS_STORAGE_KEY_BASE));

      if (!storedUser) {
        return;
      }

      try {
        const user = sanitizeUser(JSON.parse(storedUser) as User);
        const tokens = storedTokens ? (JSON.parse(storedTokens) as AuthTokens) : null;
        const apiMode = isApiDataProvider();

        commit({
          user,
          tokens,
          isAuthenticated: apiMode ? Boolean(tokens?.accessToken && tokens?.refreshToken) : true
        });
      } catch {
        commit({
          user: null,
          tokens: null,
          isAuthenticated: false
        });
        writeSessionStorage(getScopedStorageKey(USER_STORAGE_KEY_BASE), null);
        writeSessionStorage(getScopedStorageKey(TOKENS_STORAGE_KEY_BASE), null);
      }
    }
  };
}

export const authStore = createAuthStore();

export function getAuthSnapshot(): AuthState {
  return authSnapshot;
}
