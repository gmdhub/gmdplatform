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
     WHERE id IN (
       SELECT legacy_id::BIGINT
       FROM iam.app_user
       WHERE status = 'active'
     )
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
       VALUES ($1, crypt($2, gen_salt('bf', 12)), 'bcrypt', TRUE)`,
      [userId, params.password]
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
  const userUpdateRes = await query<{ id: string }>(
    `UPDATE iam.app_user
     SET status = 'disabled',
         disabled_at = now()
     WHERE legacy_id = $1
     RETURNING id`,
    [userLegacyId]
  );

  const userId = userUpdateRes.rows[0]?.id;
  if (!userId) {
    const error = new Error(`Utente ${userLegacyId} non trovato`);
    (error as Error & { statusCode?: number }).statusCode = 404;
    throw error;
  }

  // Best effort: eventuali errori di revoca sessioni non devono annullare la disabilitazione utente.
  try {
    await query(
      `UPDATE iam.user_session
       SET revoked_at = now()
       WHERE user_id = $1
         AND revoked_at IS NULL`,
      [userId]
    );
  } catch {
    // no-op
  }
}

export async function verifyUserPasswordByLegacyId(userLegacyId: number, password: string): Promise<boolean> {
  const result = await query<{ valid: boolean }>(
    `SELECT
       CASE
         WHEN c.password_algo = 'bcrypt' THEN c.password_hash = crypt($2, c.password_hash)
         ELSE FALSE
       END AS valid
     FROM iam.user_credential c
     INNER JOIN iam.app_user u ON u.id = c.user_id
     WHERE u.legacy_id = $1
     LIMIT 1`,
    [userLegacyId, password]
  );

  return Boolean(result.rows[0]?.valid);
}

export async function updateUserPasswordByLegacyId(userLegacyId: number, password: string): Promise<void> {
  await query(
    `UPDATE iam.user_credential c
     SET password_hash = crypt($1, gen_salt('bf', 12)),
         password_algo = 'bcrypt',
         must_rotate = FALSE,
         password_changed_at = now()
     FROM iam.app_user u
     WHERE c.user_id = u.id
      AND u.legacy_id = $2`,
    [password, userLegacyId]
  );
}
