import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';
import { extractSupabaseProjectRef } from './supabase-ref.js';

const explicitEnvFile = process.env.GMD_ENV_FILE?.trim();
if (explicitEnvFile) {
  dotenv.config({ path: resolve(explicitEnvFile), override: false });
} else {
  dotenv.config();
}

const appEnvSchema = z.enum(['development', 'production', 'test']);

const envSchema = z.object({
  APP_ENV: appEnvSchema.default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(8787),
  API_JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  SUPABASE_DB_URL: z.string().min(1),
  SUPABASE_PROJECT_REF_EXPECTED: z.string().trim().regex(/^[a-z0-9]{20}$/i),
  SUPABASE_PROD_PROJECT_REF: z.string().trim().regex(/^[a-z0-9]{20}$/i),
  ALLOW_DEV_PROD_DB: z
    .string()
    .optional()
    .transform((value) => String(value ?? '').trim().toLowerCase() === 'yes'),
  CORS_ORIGIN: z.string().default('*')
});

const parsed = envSchema.safeParse({
  ...process.env,
  API_PORT: process.env.API_PORT ?? process.env.PORT ?? process.env.API_PORT
});
if (!parsed.success) {
  const pretty = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${pretty}`);
}

const actualProjectRef = extractSupabaseProjectRef(parsed.data.SUPABASE_DB_URL);
if (!actualProjectRef) {
  throw new Error(
    'Impossibile estrarre il project ref Supabase da SUPABASE_DB_URL. Usa formato db.<ref>.supabase.co o pooler con username postgres.<ref>.'
  );
}

const expectedProjectRef = parsed.data.SUPABASE_PROJECT_REF_EXPECTED.toLowerCase();
const normalizedActual = actualProjectRef.toLowerCase();
const prodProjectRef = parsed.data.SUPABASE_PROD_PROJECT_REF.toLowerCase();

if (normalizedActual !== expectedProjectRef) {
  throw new Error(
    `SUPABASE_DB_URL punta al ref ${normalizedActual}, ma SUPABASE_PROJECT_REF_EXPECTED=${expectedProjectRef}. Avvio bloccato.`
  );
}

if (
  parsed.data.APP_ENV === 'development' &&
  normalizedActual === prodProjectRef &&
  !parsed.data.ALLOW_DEV_PROD_DB
) {
  throw new Error(
    'APP_ENV=development sta puntando al project ref di produzione. Avvio bloccato (imposta ALLOW_DEV_PROD_DB=YES solo per emergenze).'
  );
}

export const env = {
  ...parsed.data,
  SUPABASE_PROJECT_REF_ACTUAL: normalizedActual,
  SUPABASE_PROJECT_REF_EXPECTED: expectedProjectRef,
  SUPABASE_PROD_PROJECT_REF: prodProjectRef
};
