import argon2 from 'argon2';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import {
  createSession,
  findAuthUserById,
  findAuthUserByUsername,
  getActiveSessionByRefreshHash,
  revokeSessionById
} from '../repos/auth-repo.js';
import { sha256, signAccessToken, signRefreshToken, verifyToken } from './auth-tokens.js';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type AuthUser = {
  id: number;
  internal_id: string;
  username: string;
  nome: string;
  cognome: string;
  role: 'admin' | 'medico' | 'infermiere';
  roles: string[];
  permissions: string[];
  scopeAmbulatori: number[];
};

function normalizePrimaryRole(roles: string[]): 'admin' | 'medico' | 'infermiere' {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('medico')) return 'medico';
  return 'infermiere';
}

function buildAuthUser(record: Awaited<ReturnType<typeof findAuthUserByUsername>>): AuthUser {
  if (!record) {
    throw new Error('Record utente non disponibile');
  }

  return {
    id: Number(record.legacy_id),
    internal_id: record.id,
    username: record.username,
    nome: record.first_name,
    cognome: record.last_name,
    role: normalizePrimaryRole(record.roles),
    roles: record.roles,
    permissions: record.permissions,
    scopeAmbulatori: record.scope_ambulatori
  };
}

async function verifyPasswordHash(hash: string, plainPassword: string): Promise<boolean> {
  if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
    return bcrypt.compare(plainPassword, hash);
  }

  return argon2.verify(hash, plainPassword);
}

export async function loginWithPassword(params: {
  username: string;
  password: string;
  ipAddress?: string | null;
  deviceInfo?: string | null;
}): Promise<{ user: AuthUser; tokens: AuthTokens } | null> {
  const userRecord = await findAuthUserByUsername(params.username);
  if (!userRecord || userRecord.status !== 'active') {
    return null;
  }

  const valid = await verifyPasswordHash(userRecord.password_hash, params.password);
  if (!valid) {
    return null;
  }

  const sessionId = randomUUID();
  const refreshToken = await signRefreshToken(userRecord.id, sessionId);
  const refreshTokenHash = sha256(refreshToken);
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  await withTransaction(async (client) => {
    await createSession(client, {
      sessionId,
      userId: userRecord.id,
      refreshTokenHash,
      expiresAt: refreshExpiresAt,
      ipAddress: params.ipAddress ?? null,
      deviceInfo: params.deviceInfo ?? null
    });
  });

  const user = buildAuthUser(userRecord);
  const accessToken = await signAccessToken({
    sub: user.internal_id,
    username: user.username,
    roles: user.roles,
    permissions: user.permissions,
    scopeAmbulatori: user.scopeAmbulatori
  });

  return {
    user,
    tokens: {
      accessToken,
      refreshToken,
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS
    }
  };
}

export async function refreshAuthTokens(refreshToken: string): Promise<AuthTokens | null> {
  const refreshHash = sha256(refreshToken);
  const session = await getActiveSessionByRefreshHash(refreshHash);
  if (!session) {
    return null;
  }

  const decoded = await verifyToken(refreshToken).catch(() => null);
  if (!decoded || decoded.payload.sub !== session.user_id) {
    await revokeSessionById(session.id);
    return null;
  }

  const userRecord = await findAuthUserById(session.user_id);
  if (!userRecord || userRecord.id !== session.user_id || userRecord.status !== 'active') {
    await revokeSessionById(session.id);
    return null;
  }

  const newRefreshToken = await signRefreshToken(userRecord.id, session.id);
  const newRefreshHash = sha256(newRefreshToken);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE iam.user_session
       SET refresh_token_hash = $1,
           expires_at = now() + ($2 || ' seconds')::interval
       WHERE id = $3`,
      [newRefreshHash, String(env.REFRESH_TOKEN_TTL_SECONDS), session.id]
    );
  });

  const accessToken = await signAccessToken({
    sub: userRecord.id,
    username: userRecord.username,
    roles: userRecord.roles,
    permissions: userRecord.permissions,
    scopeAmbulatori: userRecord.scope_ambulatori
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS
  };
}

export async function logoutWithRefreshToken(refreshToken: string): Promise<void> {
  const refreshHash = sha256(refreshToken);
  const session = await getActiveSessionByRefreshHash(refreshHash);
  if (!session) {
    return;
  }

  await revokeSessionById(session.id);
}
