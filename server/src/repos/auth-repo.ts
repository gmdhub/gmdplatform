import type { PoolClient } from 'pg';
import { query } from '../db/pool.js';

export type AuthUserRecord = {
  id: string;
  legacy_id: number;
  username: string;
  first_name: string;
  last_name: string;
  status: string;
  password_hash: string;
  password_algo: string;
  must_rotate: boolean;
  roles: string[];
  permissions: string[];
  scope_ambulatori: number[];
};

export async function findAuthUserByUsername(username: string): Promise<AuthUserRecord | null> {
  const result = await query<AuthUserRecord>(
    `SELECT
       u.id,
       u.legacy_id,
       u.username,
       u.first_name,
       u.last_name,
       u.status,
       c.password_hash,
       c.password_algo,
       c.must_rotate,
       COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), ARRAY[]::text[]) AS roles,
       COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[]) AS permissions,
       COALESCE(array_agg(DISTINCT ur.scope_id) FILTER (WHERE ur.scope_type = 'ambulatorio' AND ur.scope_id IS NOT NULL), ARRAY[]::bigint[])::int[] AS scope_ambulatori
     FROM iam.app_user u
     INNER JOIN iam.user_credential c ON c.user_id = u.id
     LEFT JOIN iam.user_role ur ON ur.user_id = u.id
     LEFT JOIN iam.role r ON r.id = ur.role_id
     LEFT JOIN iam.role_permission rp ON rp.role_id = r.id
     LEFT JOIN iam.permission p ON p.id = rp.permission_id
     WHERE u.username = $1
     GROUP BY u.id, u.legacy_id, u.username, u.first_name, u.last_name, u.status, c.password_hash, c.password_algo, c.must_rotate
     LIMIT 1`,
    [username]
  );

  return result.rows[0] ?? null;
}

export async function findAuthUserById(userId: string): Promise<AuthUserRecord | null> {
  const result = await query<AuthUserRecord>(
    `SELECT
       u.id,
       u.legacy_id,
       u.username,
       u.first_name,
       u.last_name,
       u.status,
       c.password_hash,
       c.password_algo,
       c.must_rotate,
       COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), ARRAY[]::text[]) AS roles,
       COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[]) AS permissions,
       COALESCE(array_agg(DISTINCT ur.scope_id) FILTER (WHERE ur.scope_type = 'ambulatorio' AND ur.scope_id IS NOT NULL), ARRAY[]::bigint[])::int[] AS scope_ambulatori
     FROM iam.app_user u
     INNER JOIN iam.user_credential c ON c.user_id = u.id
     LEFT JOIN iam.user_role ur ON ur.user_id = u.id
     LEFT JOIN iam.role r ON r.id = ur.role_id
     LEFT JOIN iam.role_permission rp ON rp.role_id = r.id
     LEFT JOIN iam.permission p ON p.id = rp.permission_id
     WHERE u.id = $1
     GROUP BY u.id, u.legacy_id, u.username, u.first_name, u.last_name, u.status, c.password_hash, c.password_algo, c.must_rotate
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] ?? null;
}

export async function createSession(
  client: PoolClient,
  params: {
    sessionId: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ipAddress: string | null;
    deviceInfo: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO iam.user_session(
      id,
      user_id,
      refresh_token_hash,
      expires_at,
      ip_address,
      device_info
    ) VALUES ($1, $2, $3, $4, $5, to_jsonb($6::text))`,
    [
      params.sessionId,
      params.userId,
      params.refreshTokenHash,
      params.expiresAt.toISOString(),
      params.ipAddress,
      params.deviceInfo
    ]
  );
}

export async function getActiveSessionByRefreshHash(refreshTokenHash: string): Promise<{
  id: string;
  user_id: string;
  expires_at: string;
} | null> {
  const result = await query<{ id: string; user_id: string; expires_at: string }>(
    `SELECT id, user_id, expires_at
     FROM iam.user_session
     WHERE refresh_token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > now()
     LIMIT 1`,
    [refreshTokenHash]
  );

  return result.rows[0] ?? null;
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  await query(
    `UPDATE iam.user_session
     SET revoked_at = now()
     WHERE id = $1
       AND revoked_at IS NULL`,
    [sessionId]
  );
}

export async function verifyUserPassword(userId: string, plainPassword: string): Promise<boolean> {
  const result = await query<{ valid: boolean }>(
    `SELECT
       CASE
         WHEN c.password_algo = 'bcrypt' THEN c.password_hash = crypt($2, c.password_hash)
         ELSE FALSE
       END AS valid
     FROM iam.user_credential c
     WHERE c.user_id = $1
     LIMIT 1`,
    [userId, plainPassword]
  );

  return Boolean(result.rows[0]?.valid);
}

export async function revokeSessionsByUserId(userId: string): Promise<void> {
  await query(
    `UPDATE iam.user_session
     SET revoked_at = now()
     WHERE user_id = $1
       AND revoked_at IS NULL`,
    [userId]
  );
}
