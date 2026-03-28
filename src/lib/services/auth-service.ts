import type { User } from '$lib/db/types';
import type { AuthTokens } from '$lib/stores/auth';
import { apiDelete, apiGet, apiPatch, apiPost } from './http-client';

type LoginResponse = {
  user: {
    id: number;
    internal_id?: string;
    username: string;
    nome: string;
    cognome: string;
    role: 'admin' | 'medico' | 'infermiere';
    roles?: string[];
    scopeAmbulatori?: number[];
  };
  tokens: AuthTokens;
  password_rotation_required?: boolean;
};

type RotatePasswordResponse = {
  user: {
    id: number;
    internal_id?: string;
    username: string;
    nome: string;
    cognome: string;
    role: 'admin' | 'medico' | 'infermiere';
    roles?: string[];
    scopeAmbulatori?: number[];
  };
  tokens: AuthTokens;
  password_rotation_required?: boolean;
};

function mapUser(row: Partial<User> & { [key: string]: unknown }): User {
  return {
    id: Number(row.id ?? 0),
    username: String(row.username ?? ''),
    role: (row.role as User['role']) ?? 'infermiere',
    nome: String(row.nome ?? ''),
    cognome: String(row.cognome ?? ''),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString())
  };
}

export async function loginWithApi(username: string, password: string): Promise<{
  user: User;
  tokens: AuthTokens;
  passwordRotationRequired: boolean;
} | null> {
  const payload = await apiPost<LoginResponse | null>('/auth/login', {
    username,
    password,
    deviceInfo: 'tauri-desktop'
  }, {
    auth: false
  });

  if (!payload || !payload.user || !payload.tokens) {
    return null;
  }

  return {
    user: mapUser(payload.user as Partial<User> & Record<string, unknown>),
    tokens: payload.tokens,
    passwordRotationRequired: Boolean(payload.password_rotation_required)
  };
}

export async function rotatePasswordFromApi(
  currentPassword: string,
  newPassword: string
): Promise<{
  user: User;
  tokens: AuthTokens;
} | null> {
  const payload = await apiPost<RotatePasswordResponse | null>('/auth/rotate-password', {
    currentPassword,
    newPassword
  });

  if (!payload || !payload.user || !payload.tokens) {
    return null;
  }

  return {
    user: mapUser(payload.user as Partial<User> & Record<string, unknown>),
    tokens: payload.tokens
  };
}

export async function refreshWithApi(refreshToken: string): Promise<AuthTokens | null> {
  const payload = await apiPost<AuthTokens | null>('/auth/refresh', { refreshToken }, { auth: false });
  if (!payload?.accessToken || !payload?.refreshToken) {
    return null;
  }

  return payload;
}

export async function logoutWithApi(refreshToken: string): Promise<void> {
  await apiPost<void>('/auth/logout', { refreshToken }, { auth: false });
}

export async function getAllUsersFromApi(): Promise<User[]> {
  const rows = await apiGet<Array<Partial<User> & Record<string, unknown>>>('/users');
  return rows.map((row) => mapUser(row));
}

export async function createUserFromApi(params: {
  username: string;
  password: string;
  role: User['role'];
  nome: string;
  cognome: string;
}): Promise<number> {
  const response = await apiPost<{ id: number }>('/users', params);
  return Number(response.id);
}

export async function updateUserFromApi(
  id: number,
  patch: {
    username?: string;
    role?: User['role'];
    nome?: string;
    cognome?: string;
  }
): Promise<void> {
  await apiPatch<void>(`/users/${id}`, patch);
}

export async function disableUserFromApi(id: number): Promise<void> {
  await apiDelete<void>(`/users/${id}`);
}

export async function verifyUserPasswordFromApi(id: number, password: string): Promise<boolean> {
  const response = await apiPost<{ valid: boolean }>(`/users/${id}/verify-password`, { password });
  return Boolean(response.valid);
}

export async function updateUserPasswordFromApi(id: number, password: string): Promise<void> {
  await apiPost<void>(`/users/${id}/password`, { password });
}
