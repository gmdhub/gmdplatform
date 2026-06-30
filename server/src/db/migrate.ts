import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { pool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, '..', '..', 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function checksum(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i += 1) {
    hash = (hash * 31 + content.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

async function run() {
  // Guardrail hard: in produzione richiede conferma esplicita.
  if (env.APP_ENV === 'production' && process.env.CONFIRM_PROD_MIGRATION !== 'YES') {
    throw new Error(
      'Refused to run migrations in production without CONFIRM_PROD_MIGRATION=YES.'
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `[migrate] env=${env.APP_ENV} project_ref_actual=${env.SUPABASE_PROJECT_REF_ACTUAL} project_ref_expected=${env.SUPABASE_PROJECT_REF_EXPECTED}`
  );

  await ensureMigrationsTable();

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  for (const filename of files) {
    const fullPath = join(migrationsDir, filename);
    const sql = readFileSync(fullPath, 'utf8');
    const digest = checksum(sql);

    const existing = await pool.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM public.schema_migrations WHERE filename = $1',
      [filename]
    );
    const existingRow = existing.rows[0];

    if (existing.rowCount && existingRow && existingRow.checksum !== digest) {
      throw new Error(`Migration checksum mismatch for ${filename}`);
    }

    if (existing.rowCount) {
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO public.schema_migrations(filename, checksum) VALUES ($1, $2)',
        [filename, digest]
      );
      await client.query('COMMIT');
      // eslint-disable-next-line no-console
      console.log(`Applied migration: ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  await pool.end();
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
