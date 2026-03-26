import argon2 from 'argon2';
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../db/pool.js';

export type AppUserRow = {
  id: number;
  username: string;
  role: 'admin' | 'medico' | 'infermiere';
  nome: string;
  cognome: string;
  created_at: string;
  updated_at: string;
};

export async function listUsers(): Promise<AppUserRow[]> {
  const result = await query<AppUserRow>(
    `SELECT id, username, role, nome, cognome, created_at, updated_at
     FROM compat.users
     ORDER BY cognome ASC, nome ASC`
  );

  return result.rows;
}

export async function createUser(params: {
  username: string;
  password: string;
  role: 'admin' | 'medico' | 'infermiere';
  nome: string;
  cognome: string;
}): Promise<number> {
  const passwordHash = await argon2.hash(params.password);

  return withTransaction(async (client) => {
    const userRes = await client.query<{ id: string; legacy_id: number }>(
      `INSERT INTO iam.app_user(username, first_name, last_name, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id, legacy_id`,
      [params.username, params.nome, params.cognome]
    );

    const createdUser = userRes.rows[0];
    if (!createdUser?.id) {
      throw new Error('Impossibile creare utente');
    }
    const userId = createdUser.id;

    await client.query(
      `INSERT INTO iam.user_credential(user_id, password_hash, password_algo, must_rotate)
       VALUES ($1, $2, 'argon2id', FALSE)`,
      [userId, passwordHash]
    );

    const roleRes = await client.query<{ id: number }>(
      'SELECT id FROM iam.role WHERE code = $1 LIMIT 1',
      [params.role]
    );

    if (!roleRes.rows[0]?.id) {
      throw new Error(`Ruolo non trovato: ${params.role}`);
    }

    await client.query(
      `INSERT INTO iam.user_role(user_id, role_id, scope_type, scope_id)
       SELECT $1, $2, 'global', NULL
       WHERE NOT EXISTS (
         SELECT 1
         FROM iam.user_role ur
         WHERE ur.user_id = $1
           AND ur.role_id = $2
           AND ur.scope_type = 'global'
           AND ur.scope_id IS NULL
       )`,
      [userId, roleRes.rows[0].id]
    );

    return Number(createdUser.legacy_id);
  });
}

export async function updateUserByLegacyId(
  userLegacyId: number,
  patch: {
    username?: string;
    role?: 'admin' | 'medico' | 'infermiere';
    nome?: string;
    cognome?: string;
  }
): Promise<void> {
  const userLookup = await query<{ id: string }>('SELECT id FROM iam.app_user WHERE legacy_id = $1 LIMIT 1', [
    userLegacyId
  ]);
  const userId = userLookup.rows[0]?.id;
  if (!userId) {
    throw new Error(`Utente ${userLegacyId} non trovato`);
  }

  await withTransaction(async (client) => {
    const setParts: string[] = [];
    const values: unknown[] = [];

    if (patch.username !== undefined) {
      values.push(patch.username);
      setParts.push(`username = $${values.length}`);
    }

    if (patch.nome !== undefined) {
      values.push(patch.nome);
      setParts.push(`first_name = $${values.length}`);
    }

    if (patch.cognome !== undefined) {
      values.push(patch.cognome);
      setParts.push(`last_name = $${values.length}`);
    }

    if (setParts.length > 0) {
      values.push(userId);
      await client.query(
        `UPDATE iam.app_user
         SET ${setParts.join(', ')}
         WHERE id = $${values.length}`,
        values
      );
    }

    if (patch.role !== undefined) {
      const roleRes = await client.query<{ id: number }>('SELECT id FROM iam.role WHERE code = $1 LIMIT 1', [
        patch.role
      ]);
      const roleId = roleRes.rows[0]?.id;
      if (!roleId) {
        throw new Error(`Ruolo non trovato: ${patch.role}`);
      }

      await client.query(
        `DELETE FROM iam.user_role
         WHERE user_id = $1
           AND scope_type = 'global'`,
        [userId]
      );

      await client.query(
        `INSERT INTO iam.user_role(user_id, role_id, scope_type, scope_id)
         SELECT $1, $2, 'global', NULL
         WHERE NOT EXISTS (
           SELECT 1
           FROM iam.user_role ur
           WHERE ur.user_id = $1
             AND ur.role_id = $2
             AND ur.scope_type = 'global'
             AND ur.scope_id IS NULL
         )`,
        [userId, roleId]
      );
    }
  });
}

export async function disableUserByLegacyId(userLegacyId: number): Promise<void> {
  await query(
    `UPDATE iam.app_user
     SET status = 'disabled',
         disabled_at = now()
     WHERE legacy_id = $1`,
    [userLegacyId]
  );

  await query(
    `UPDATE iam.user_session
     SET revoked_at = now()
     WHERE user_id = (SELECT id FROM iam.app_user WHERE legacy_id = $1)
       AND revoked_at IS NULL`,
    [userLegacyId]
  );
}

async function comparePassword(hash: string, password: string): Promise<boolean> {
  if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
    return bcrypt.compare(password, hash);
  }

  return argon2.verify(hash, password);
}

export async function verifyUserPasswordByLegacyId(userLegacyId: number, password: string): Promise<boolean> {
  const result = await query<{ password_hash: string }>(
    `SELECT c.password_hash
     FROM iam.user_credential c
     INNER JOIN iam.app_user u ON u.id = c.user_id
     WHERE u.legacy_id = $1
     LIMIT 1`,
    [userLegacyId]
  );

  const hash = result.rows[0]?.password_hash;
  if (!hash) {
    return false;
  }

  return comparePassword(hash, password);
}

export async function updateUserPasswordByLegacyId(userLegacyId: number, password: string): Promise<void> {
  const newHash = await argon2.hash(password);

  await query(
    `UPDATE iam.user_credential c
     SET password_hash = $1,
         password_algo = 'argon2id',
         must_rotate = FALSE,
         password_changed_at = now()
     FROM iam.app_user u
     WHERE c.user_id = u.id
       AND u.legacy_id = $2`,
    [newHash, userLegacyId]
  );
}
