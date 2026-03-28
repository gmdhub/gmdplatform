import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { pool, withTransaction } from './pool.js';

type UserRow = {
  id: string;
  username: string;
  status: 'active' | 'disabled' | 'locked';
  is_service_account: boolean;
};

function generateTemporaryPassword(username: string): string {
  const suffix = randomBytes(4).toString('hex');
  const userPart = username.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'user';
  return `Tmp-${userPart}-${suffix}`;
}

async function run() {
  if (env.APP_ENV === 'production' && process.env.CONFIRM_TEMP_PASSWORD_RESET !== 'YES') {
    throw new Error('Refused to reset production passwords without CONFIRM_TEMP_PASSWORD_RESET=YES.');
  }

  // eslint-disable-next-line no-console
  console.log(
    `[temp-passwords] env=${env.APP_ENV} project_ref_actual=${env.SUPABASE_PROJECT_REF_ACTUAL}`
  );

  const usersRes = await pool.query<UserRow>(
    `SELECT id, username, status, is_service_account
     FROM iam.app_user
     WHERE status = 'active'
       AND is_service_account = FALSE
     ORDER BY username ASC`
  );

  const generated: Array<{ username: string; temporaryPassword: string }> = [];

  await withTransaction(async (client) => {
    for (const user of usersRes.rows) {
      const temporaryPassword = generateTemporaryPassword(user.username);

      await client.query(
        `UPDATE iam.user_credential
         SET password_hash = crypt($2, gen_salt('bf', 12)),
             password_algo = 'bcrypt',
             must_rotate = TRUE,
             password_changed_at = now()
         WHERE user_id = $1`,
        [user.id, temporaryPassword]
      );

      await client.query(
        `UPDATE iam.user_session
         SET revoked_at = now()
         WHERE user_id = $1
           AND revoked_at IS NULL`,
        [user.id]
      );

      generated.push({
        username: user.username,
        temporaryPassword
      });
    }
  });

  // eslint-disable-next-line no-console
  console.log('Temporary passwords generated (rotate required at first login):');
  for (const item of generated) {
    // eslint-disable-next-line no-console
    console.log(`${item.username},${item.temporaryPassword}`);
  }

  await pool.end();
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
