// GMD Medical Platform - Authentication
import bcrypt from 'bcryptjs';
import { isApiDataProvider } from './config';
import { insertReturningId } from './client';
import { initDatabase } from './schema';
import type { User } from './types';
import { authStore } from '$lib/stores/auth';
import {
  createUserFromApi,
  disableUserFromApi,
  getAllUsersFromApi,
  loginWithApi,
  rotatePasswordFromApi,
  updateUserFromApi,
  updateUserPasswordFromApi,
  verifyUserPasswordFromApi
} from '$lib/services/auth-service';

function normalizeIntegerForWrite(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(normalized)) {
    throw new Error(`Valore intero non valido: ${value}`);
  }

  return normalized;
}

function sanitizeUser(user: User): User {
  const { password_hash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<{ user: User; passwordRotationRequired: boolean } | null> {
  if (isApiDataProvider()) {
    const result = await loginWithApi(username, password);
    if (!result) {
      return null;
    }

    authStore.setTokens(result.tokens);
    return {
      user: sanitizeUser(result.user),
      passwordRotationRequired: result.passwordRotationRequired
    };
  }

  const db = await initDatabase();
  const result = await db.select<User[]>(
    `SELECT id, username, password_hash, role, nome, cognome, created_at, updated_at
     FROM users
     WHERE username = ?`,
    [username]
  );

  if (result.length === 0) {
    return null;
  }

  const user = result[0];
  const isValid = await bcrypt.compare(password, user.password_hash ?? '');

  if (!isValid) {
    return null;
  }

  return {
    user: sanitizeUser(user),
    passwordRotationRequired: false
  };
}

export async function rotateCurrentUserPassword(
  currentPassword: string,
  newPassword: string
): Promise<User | null> {
  if (!isApiDataProvider()) {
    throw new Error('Rotazione password disponibile solo con provider API');
  }

  const result = await rotatePasswordFromApi(currentPassword, newPassword);
  if (!result) {
    return null;
  }

  authStore.setTokens(result.tokens);
  return sanitizeUser(result.user);
}

export async function createUser(
  username: string,
  password: string,
  role: 'admin' | 'medico' | 'infermiere',
  nome: string,
  cognome: string
): Promise<number> {
  if (isApiDataProvider()) {
    return createUserFromApi({ username, password, role, nome, cognome });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  return insertReturningId(
    `INSERT INTO users (username, password_hash, role, nome, cognome)
     VALUES (?, ?, ?, ?, ?)`,
    [username, passwordHash, role, nome, cognome]
  );
}

export async function getAllUsers(): Promise<User[]> {
  if (isApiDataProvider()) {
    return getAllUsersFromApi();
  }

  const db = await initDatabase();
  const rows = await db.select<User[]>(
    `SELECT id, username, role, nome, cognome, created_at, updated_at
     FROM users
     ORDER BY cognome, nome`
  );

  return rows.map((row) => sanitizeUser(row));
}

export async function updateUser(
  userId: number,
  username?: string,
  role?: 'admin' | 'medico' | 'infermiere',
  nome?: string,
  cognome?: string
): Promise<void> {
  if (isApiDataProvider()) {
    await updateUserFromApi(userId, {
      username,
      role,
      nome,
      cognome
    });
    return;
  }

  const db = await initDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (username !== undefined) {
    values.push(username);
    fields.push('username = ?');
  }
  if (role !== undefined) {
    values.push(role);
    fields.push('role = ?');
  }
  if (nome !== undefined) {
    values.push(nome);
    fields.push('nome = ?');
  }
  if (cognome !== undefined) {
    values.push(cognome);
    fields.push('cognome = ?');
  }

  if (fields.length === 0) {
    return;
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(normalizeIntegerForWrite(userId));

  await db.execute(
    `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function verifyUserPassword(userId: number, password: string): Promise<boolean> {
  if (isApiDataProvider()) {
    return verifyUserPasswordFromApi(userId, password);
  }

  const db = await initDatabase();
  const result = await db.select<Array<{ password_hash: string }>>(
    'SELECT password_hash FROM users WHERE id = ?',
    [normalizeIntegerForWrite(userId)]
  );

  if (result.length === 0) {
    return false;
  }

  return bcrypt.compare(password, result[0].password_hash);
}

export async function updateUserPassword(userId: number, newPassword: string): Promise<void> {
  if (isApiDataProvider()) {
    await updateUserPasswordFromApi(userId, newPassword);
    return;
  }

  const db = await initDatabase();
  const passwordHash = await bcrypt.hash(newPassword, 10);

  await db.execute(
    'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [passwordHash, normalizeIntegerForWrite(userId)]
  );
}

export async function deleteUser(userId: number): Promise<void> {
  if (isApiDataProvider()) {
    await disableUserFromApi(userId);
    return;
  }

  const db = await initDatabase();
  await db.execute('DELETE FROM users WHERE id = ?', [
    normalizeIntegerForWrite(userId)
  ]);
}
