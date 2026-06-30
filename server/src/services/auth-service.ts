import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import {
  createSession,
  findAuthUserById,
  findAuthUserByUsername,
  getActiveSessionByRefreshHash,
  revokeSessionById,
  revokeSessionsByUserId,
  verifyUserPassword
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

export type LoginResult = {
  user: AuthUser;
  tokens: AuthTokens;
  password_rotation_required: boolean;
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

export async function loginWithPassword(params: {
  username: string;
  password: string;
  ipAddress?: string | null;
  deviceInfo?: string | null;
}): Promise<LoginResult | null> {
  const userRecord = await findAuthUserByUsername(params.username);
  if (!userRecord || userRecord.status !== 'active') {
    return null;
  }

  const valid = await verifyUserPassword(userRecord.id, params.password);
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
    },
    password_rotation_required: userRecord.must_rotate
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

export async function rotatePasswordWithCurrent(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  ipAddress?: string | null;
  deviceInfo?: string | null;
}): Promise<LoginResult | null> {
  const userRecord = await findAuthUserById(params.userId);
  if (!userRecord || userRecord.status !== 'active') {
    return null;
  }

  const valid = await verifyUserPassword(userRecord.id, params.currentPassword);
  if (!valid) {
    return null;
  }

  const sessionId = randomUUID();
  const refreshToken = await signRefreshToken(userRecord.id, sessionId);
  const refreshTokenHash = sha256(refreshToken);
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE iam.user_credential
       SET password_hash = crypt($2, gen_salt('bf', 12)),
           password_algo = 'bcrypt',
           must_rotate = FALSE,
           password_changed_at = now()
       WHERE user_id = $1`,
      [userRecord.id, params.newPassword]
    );

    await client.query(
      `UPDATE iam.user_session
       SET revoked_at = now()
       WHERE user_id = $1
         AND revoked_at IS NULL`,
      [userRecord.id]
    );

    await createSession(client, {
      sessionId,
      userId: userRecord.id,
      refreshTokenHash,
      expiresAt: refreshExpiresAt,
      ipAddress: params.ipAddress ?? null,
      deviceInfo: params.deviceInfo ?? null
    });
  });

  const refreshedUser = await findAuthUserById(userRecord.id);
  if (!refreshedUser) {
    return null;
  }

  const user = buildAuthUser(refreshedUser);
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
    },
    password_rotation_required: false
  };
}

export async function forceTemporaryPassword(params: {
  userId: string;
  temporaryPassword: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE iam.user_credential
       SET password_hash = crypt($2, gen_salt('bf', 12)),
           password_algo = 'bcrypt',
           must_rotate = TRUE,
           password_changed_at = now()
       WHERE user_id = $1`,
      [params.userId, params.temporaryPassword]
    );
  });

  await revokeSessionsByUserId(params.userId);
}
