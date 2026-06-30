/*
  SQLite -> PostgreSQL migration tool for GMD Platform.

  Prerequisites:
  - npm i -D tsx
  - npm i pg better-sqlite3

  Usage:
  SUPABASE_DB_URL=postgresql://postgres.<project-ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:6543/postgres \
  LEGACY_SQLITE_PATH="$HOME/Library/Application Support/com.gmdmedical.platform/gmd.db" \
  npx tsx scripts/migrate/sqlite-to-postgres.ts
*/

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';
import { Client } from 'pg';

type SqliteUser = {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'medico' | 'infermiere';
  nome: string;
  cognome: string;
  created_at: string;
  updated_at: string;
};

type SqliteAmbulatorio = {
  id: number;
  nome: string;
  logo_path: string | null;
  color_primary: string;
  color_secondary: string;
  color_accent: string;
  indirizzo: string | null;
  telefono: string | null;
  email: string | null;
  durata_minima_visita_minuti: number | null;
  durata_standard_visita_minuti: number | null;
  created_at: string;
  updated_at: string;
};

type SqliteAmbulatorioOrario = {
  id: number;
  ambulatorio_id: number;
  weekday: number;
  ora_inizio: string;
  ora_fine: string;
  max_pazienti_giorno: number;
  created_at: string;
  updated_at: string;
};

type SqlitePaziente = {
  id: number;
  ambulatorio_id: number;
  nome: string;
  cognome: string;
  data_nascita: string;
  luogo_nascita: string;
  codice_fiscale: string;
  sesso: 'M' | 'F' | 'Altro';
  esenzioni: string | null;
  indirizzo: string | null;
  citta: string | null;
  cap: string | null;
  provincia: string | null;
  telefono: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
};

type SqliteVisita = {
  id: number;
  ambulatorio_id: number;
  paziente_id: number;
  medico_id: number;
  previous_version_id: number | null;
  is_current_version: number | null;
  data_visita: string;
  tipo_visita: string;
  motivo: string;
  altezza: number | null;
  peso: number | null;
  bmi: number | null;
  bsa: number | null;
  anamnesi_cardiologica: string | null;
  anamnesi_internistica: string | null;
  terapia_domiciliare: string | null;
  valutazione_odierna: string | null;
  esami_ematici: string | null;
  ecocardiografia: string | null;
  fh_assessment: string | null;
  terapia_ipolipemizzante: string | null;
  valutazione_rischio_cv: string | null;
  firme_visita: string | null;
  pianificazione_followup: string | null;
  conclusioni: string | null;
  anamnesi: string | null;
  esame_obiettivo: string | null;
  diagnosi: string | null;
  terapia: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type SqliteFattoreRischio = {
  id: number;
  visita_id: number;
  familiarita: number;
  familiarita_note: string | null;
  ipertensione: number;
  diabete: number;
  diabete_durata: string | null;
  diabete_tipo: string | null;
  dislipidemia: number;
  obesita: number;
  fumo: string | null;
  fumo_ex_eta: string | null;
  created_at: string;
  updated_at: string;
};

type SqliteAppuntamento = {
  id: number;
  ambulatorio_id: number;
  paziente_id: number;
  data_ora_inizio: string;
  data_ora_fine: string;
  durata_minuti: number | null;
  motivo: string | null;
  origine: 'manuale' | 'followup_visita' | string;
  source_visita_id: number | null;
  created_at: string;
  updated_at: string;
};

const LAB_KEYS = [
  'hb',
  'plt',
  'creatinina',
  'egfr',
  'colesterolo_totale',
  'hdl',
  'trigliceridi',
  'ldl_calcolato',
  'ldl_diretto',
  'lipoproteina_a',
  'emoglobina_glicata',
  'glicemia',
  'ast',
  'alt',
  'bilirubina_totale',
  'cpk'
] as const;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing env ${name}`);
  }
  return value.trim();
}

function extractSupabaseProjectRef(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    const hostMatch = url.hostname.trim().toLowerCase().match(/^db\.([a-z0-9]{20})\.supabase\.co$/);
    if (hostMatch?.[1]) {
      return hostMatch[1];
    }

    if (url.hostname.endsWith('.pooler.supabase.com')) {
      const userMatch = decodeURIComponent(url.username)
        .trim()
        .toLowerCase()
        .match(/^[a-z0-9_]+\.([a-z0-9]{20})$/);
      if (userMatch?.[1]) {
        return userMatch[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function normalizeNullableText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 't';
  }

  return false;
}

function getDurationMinutes(startAt: string, endAt: string): number {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  return Number.isFinite(minutes) && minutes >= 10 ? minutes : 15;
}

function sanitizeTaxCode(value: string): { taxCode: string | null; temporaryCode: string | null } {
  const normalized = (value ?? '').trim();
  if (!normalized) {
    return { taxCode: null, temporaryCode: null };
  }

  if (normalized.toUpperCase().startsWith('TMP')) {
    return { taxCode: null, temporaryCode: normalized };
  }

  return { taxCode: normalized, temporaryCode: null };
}

async function syncLegacySequences(pg: Client): Promise<void> {
  await pg.query(
    `SELECT setval(
       'iam.app_user_legacy_id_seq',
       COALESCE((SELECT MAX(legacy_id) FROM iam.app_user), 0) + 1,
       false
     )`
  );
  await pg.query(
    `SELECT setval(
       'patient.patient_legacy_id_seq',
       COALESCE((SELECT MAX(legacy_id) FROM patient.patient), 0) + 1,
       false
     )`
  );
  await pg.query(
    `SELECT setval(
       'clinical.encounter_legacy_id_seq',
       COALESCE((SELECT MAX(legacy_id) FROM clinical.encounter), 0) + 1,
       false
     )`
  );
  await pg.query(
    `SELECT setval(
       'clinical.encounter_revision_legacy_id_seq',
       COALESCE((SELECT MAX(legacy_id) FROM clinical.encounter_revision), 0) + 1,
       false
     )`
  );
  await pg.query(
    `SELECT setval(
       'scheduling.appointment_legacy_id_seq',
       COALESCE((SELECT MAX(legacy_id) FROM scheduling.appointment), 0) + 1,
       false
     )`
  );
}

function assertRequiredSqliteTables(sqlite: Database.Database): void {
  const requiredTables = [
    'users',
    'ambulatori',
    'ambulatorio_orari',
    'pazienti',
    'visite',
    'fattori_rischio_cv',
    'appuntamenti'
  ];

  const rows = sqlite
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'`
    )
    .all() as Array<{ name: string }>;

  const tableSet = new Set(rows.map((row) => row.name));
  const missing = requiredTables.filter((tableName) => !tableSet.has(tableName));
  if (missing.length > 0) {
    throw new Error(
      `SQLite schema non valido. Tabelle mancanti: ${missing.join(', ')}. ` +
        `Verifica LEGACY_SQLITE_PATH (esempio: ~/Library/Application Support/com.gmdmedical.platform/gmd.db).`
    );
  }
}

async function main() {
  const migrationTargetRaw = requiredEnv('MIGRATION_TARGET').toLowerCase();
  if (migrationTargetRaw !== 'dev' && migrationTargetRaw !== 'prod') {
    throw new Error(`Invalid MIGRATION_TARGET=${migrationTargetRaw}. Allowed: dev | prod`);
  }

  if (migrationTargetRaw === 'prod' && process.env.CONFIRM_PROD_ETL !== 'YES') {
    throw new Error('Refused to run ETL on prod without CONFIRM_PROD_ETL=YES');
  }

  const sqlitePath = process.env.LEGACY_SQLITE_PATH
    ? path.resolve(process.env.LEGACY_SQLITE_PATH)
    : path.resolve(process.cwd(), 'gmd.db');

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite file not found: ${sqlitePath}`);
  }

  const dbUrl = requiredEnv('SUPABASE_DB_URL');
  const expectedRef = requiredEnv('SUPABASE_PROJECT_REF_EXPECTED').toLowerCase();
  const prodRef = requiredEnv('SUPABASE_PROD_PROJECT_REF').toLowerCase();
  const actualRef = extractSupabaseProjectRef(dbUrl);

  if (!actualRef) {
    throw new Error(
      'Impossibile estrarre project ref da SUPABASE_DB_URL. Usa formato db.<ref>.supabase.co o pooler con username postgres.<ref>.'
    );
  }

  if (actualRef !== expectedRef) {
    throw new Error(
      `SUPABASE_DB_URL punta al ref ${actualRef}, ma SUPABASE_PROJECT_REF_EXPECTED=${expectedRef}. ETL bloccata.`
    );
  }

  if (migrationTargetRaw === 'dev' && actualRef === prodRef && process.env.ALLOW_DEV_PROD_DB !== 'YES') {
    throw new Error('Target dev ma ref produzione rilevato. ETL bloccata.');
  }

  if (migrationTargetRaw === 'prod' && actualRef !== prodRef) {
    throw new Error(
      `Target prod ma ref attuale ${actualRef} diverso da SUPABASE_PROD_PROJECT_REF=${prodRef}. ETL bloccata.`
    );
  }

  console.log(
    `[etl] target=${migrationTargetRaw} project_ref_actual=${actualRef} project_ref_expected=${expectedRef}`
  );

  const sqlite = new Database(sqlitePath, { readonly: true });
  const pg = new Client({ connectionString: dbUrl });

  assertRequiredSqliteTables(sqlite);

  await pg.connect();

  const users = sqlite.prepare('SELECT * FROM users ORDER BY id ASC').all() as SqliteUser[];
  const ambulatori = sqlite.prepare('SELECT * FROM ambulatori ORDER BY id ASC').all() as SqliteAmbulatorio[];
  const orari = sqlite.prepare('SELECT * FROM ambulatorio_orari ORDER BY id ASC').all() as SqliteAmbulatorioOrario[];
  const pazienti = sqlite.prepare('SELECT * FROM pazienti ORDER BY id ASC').all() as SqlitePaziente[];
  const visite = sqlite.prepare('SELECT * FROM visite ORDER BY id ASC').all() as SqliteVisita[];
  const fattori = sqlite.prepare('SELECT * FROM fattori_rischio_cv ORDER BY id ASC').all() as SqliteFattoreRischio[];
  const appuntamenti = sqlite.prepare('SELECT * FROM appuntamenti ORDER BY id ASC').all() as SqliteAppuntamento[];

  const userLegacyToInternal = new Map<number, string>();
  const patientLegacyToInternal = new Map<number, string>();
  const visitaLegacyToRevision = new Map<number, string>();
  const visitaLegacyToEncounter = new Map<number, string>();

  const quarantine: Array<{ visita_id: number; reason: string; payload: string }> = [];

  try {
    await pg.query('BEGIN');

    await pg.query(
      `DELETE FROM org.ambulatorio a
       WHERE a.code IN ('DISLIP', 'ORTO', 'SCA', 'DHR')
         AND NOT EXISTS (
           SELECT 1
           FROM patient.patient p
           WHERE p.ambulatorio_id = a.id
             AND p.deleted_at IS NULL
         )
         AND NOT EXISTS (
           SELECT 1
           FROM scheduling.appointment ap
           WHERE ap.ambulatorio_id = a.id
             AND ap.deleted_at IS NULL
         )
         AND NOT EXISTS (
           SELECT 1
           FROM clinical.encounter e
           WHERE e.ambulatorio_id = a.id
             AND e.deleted_at IS NULL
         )`
    );

    const roleRows = await pg.query<{ id: number; code: string }>('SELECT id, code FROM iam.role');
    const roleIdByCode = new Map(roleRows.rows.map((row) => [row.code, row.id]));

    const fallbackRoleId = roleIdByCode.get('infermiere');
    if (!fallbackRoleId) {
      throw new Error('Role infermiere missing in iam.role');
    }

    for (const user of users) {
      const existingUser = await pg.query<{ id: string }>(
        `SELECT id
         FROM iam.app_user
         WHERE legacy_id = $1
            OR username = $2
         ORDER BY CASE WHEN legacy_id = $1 THEN 0 ELSE 1 END
         LIMIT 1`,
        [user.id, user.username]
      );

      let userRes: { rows: Array<{ id: string }> };
      if (existingUser.rows[0]?.id) {
        userRes = await pg.query<{ id: string }>(
          `UPDATE iam.app_user
           SET username = $1,
               first_name = $2,
               last_name = $3,
               status = 'active',
               updated_at = $4
           WHERE id = $5
           RETURNING id`,
          [user.username, user.nome, user.cognome, user.updated_at, existingUser.rows[0].id]
        );
      } else {
        userRes = await pg.query<{ id: string }>(
          `INSERT INTO iam.app_user(
            id,
            legacy_id,
            username,
            first_name,
            last_name,
            status,
            created_at,
            updated_at
          ) OVERRIDING SYSTEM VALUE
          VALUES (gen_random_uuid(), $1, $2, $3, $4, 'active', $5, $6)
          RETURNING id`,
          [
            user.id,
            user.username,
            user.nome,
            user.cognome,
            user.created_at,
            user.updated_at
          ]
        );
      }

      const internalId = userRes.rows[0]?.id;
      if (!internalId) {
        throw new Error(`Failed to upsert user legacy_id=${user.id}`);
      }
      userLegacyToInternal.set(user.id, internalId);

      await pg.query(
        `INSERT INTO iam.user_credential(user_id, password_hash, password_algo, must_rotate)
         VALUES ($1, $2, 'bcrypt', FALSE)
         ON CONFLICT (user_id)
         DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           password_algo = EXCLUDED.password_algo,
           must_rotate = EXCLUDED.must_rotate,
           password_changed_at = now()`,
        [internalId, user.password_hash]
      );

      const roleCode = user.role && roleIdByCode.has(user.role) ? user.role : 'infermiere';
      const roleId = roleIdByCode.get(roleCode) ?? fallbackRoleId;

      await pg.query(
        `DELETE FROM iam.user_role
         WHERE user_id = $1
           AND scope_type = 'global'`,
        [internalId]
      );

      await pg.query(
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
        [internalId, roleId]
      );
    }

    const defaultUserId = userLegacyToInternal.get(1) ?? userLegacyToInternal.values().next().value;
    if (!defaultUserId) {
      throw new Error('No user available after migration');
    }

    for (const amb of ambulatori) {
      await pg.query(
        `INSERT INTO org.ambulatorio(id, code, name, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, TRUE, $4, $5)
         ON CONFLICT (id)
         DO UPDATE SET
           code = EXCLUDED.code,
           name = EXCLUDED.name,
           updated_at = EXCLUDED.updated_at`,
        [
          amb.id,
          `legacy-${amb.id}`,
          amb.nome,
          amb.created_at,
          amb.updated_at
        ]
      );

      await pg.query(
        `INSERT INTO org.ambulatorio_settings(
          ambulatorio_id,
          min_visit_minutes,
          standard_visit_minutes,
          report_base_uri,
          timezone,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, NULL, 'Europe/Rome', $4, $5)
        ON CONFLICT (ambulatorio_id)
        DO UPDATE SET
          min_visit_minutes = EXCLUDED.min_visit_minutes,
          standard_visit_minutes = EXCLUDED.standard_visit_minutes,
          updated_at = EXCLUDED.updated_at`,
        [
          amb.id,
          Math.max(10, Number(amb.durata_minima_visita_minuti ?? 10)),
          Math.max(
            Number(amb.durata_minima_visita_minuti ?? 10),
            Number(amb.durata_standard_visita_minuti ?? 15)
          ),
          amb.created_at,
          amb.updated_at
        ]
      );

      await pg.query(
        `INSERT INTO org.ambulatorio_theme(
          ambulatorio_id,
          logo_path,
          color_primary,
          color_secondary,
          color_accent
        ) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (ambulatorio_id)
        DO UPDATE SET
          logo_path = EXCLUDED.logo_path,
          color_primary = EXCLUDED.color_primary,
          color_secondary = EXCLUDED.color_secondary,
          color_accent = EXCLUDED.color_accent`,
        [
          amb.id,
          normalizeNullableText(amb.logo_path),
          amb.color_primary || '#1e3a8a',
          amb.color_secondary || '#3b82f6',
          amb.color_accent || '#22d3ee'
        ]
      );
    }

    for (const row of orari) {
      await pg.query(
        `INSERT INTO org.ambulatorio_operating_window(
          id,
          ambulatorio_id,
          weekday,
          start_time,
          end_time,
          max_patients_per_day,
          created_at,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id)
        DO UPDATE SET
          ambulatorio_id = EXCLUDED.ambulatorio_id,
          weekday = EXCLUDED.weekday,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          max_patients_per_day = EXCLUDED.max_patients_per_day,
          updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.ambulatorio_id,
          row.weekday,
          row.ora_inizio,
          row.ora_fine,
          Math.max(1, Number(row.max_pazienti_giorno || 1)),
          row.created_at,
          row.updated_at
        ]
      );
    }

    for (const paziente of pazienti) {
      const { taxCode, temporaryCode } = sanitizeTaxCode(paziente.codice_fiscale);
      const patientRes = await pg.query<{ id: string }>(
        `INSERT INTO patient.patient(
          id,
          legacy_id,
          ambulatorio_id,
          first_name,
          last_name,
          birth_date,
          birth_place,
          sex,
          tax_code,
          temporary_code,
          exemptions,
          address,
          city,
          cap,
          province,
          phone,
          email,
          is_active,
          created_by,
          updated_by,
          created_at,
          updated_at
        ) OVERRIDING SYSTEM VALUE
        VALUES (
          gen_random_uuid(),
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
          TRUE,
          $17,
          $17,
          $18,
          $19
        )
        ON CONFLICT (legacy_id)
        DO UPDATE SET
          ambulatorio_id = EXCLUDED.ambulatorio_id,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          birth_date = EXCLUDED.birth_date,
          birth_place = EXCLUDED.birth_place,
          sex = EXCLUDED.sex,
          tax_code = EXCLUDED.tax_code,
          temporary_code = EXCLUDED.temporary_code,
          exemptions = EXCLUDED.exemptions,
          address = EXCLUDED.address,
          city = EXCLUDED.city,
          cap = EXCLUDED.cap,
          province = EXCLUDED.province,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at
        RETURNING id`,
        [
          paziente.id,
          paziente.ambulatorio_id,
          paziente.nome,
          paziente.cognome,
          paziente.data_nascita,
          paziente.luogo_nascita,
          paziente.sesso,
          taxCode,
          temporaryCode,
          normalizeNullableText(paziente.esenzioni),
          normalizeNullableText(paziente.indirizzo),
          normalizeNullableText(paziente.citta),
          normalizeNullableText(paziente.cap),
          normalizeNullableText(paziente.provincia),
          normalizeNullableText(paziente.telefono),
          normalizeNullableText(paziente.email),
          defaultUserId,
          paziente.created_at,
          paziente.updated_at
        ]
      );

      const internalId = patientRes.rows[0]?.id;
      if (!internalId) {
        throw new Error(`Failed to upsert patient legacy_id=${paziente.id}`);
      }

      patientLegacyToInternal.set(paziente.id, internalId);
    }

    const encounterRevisionNo = new Map<string, number>();

    for (const visita of visite) {
      const patientId = patientLegacyToInternal.get(visita.paziente_id);
      if (!patientId) {
        quarantine.push({
          visita_id: visita.id,
          reason: `patient_not_found:${visita.paziente_id}`,
          payload: JSON.stringify(visita)
        });
        continue;
      }

      const authorUserId = userLegacyToInternal.get(visita.medico_id) ?? defaultUserId;

      let encounterId: string;
      let supersedesRevisionId: string | null = null;

      const existingRevision = await pg.query<{ id: string; encounter_id: string }>(
        `SELECT id, encounter_id
         FROM clinical.encounter_revision
         WHERE legacy_id = $1
         LIMIT 1`,
        [visita.id]
      );

      const existingRevisionId = existingRevision.rows[0]?.id;
      const existingEncounterId = existingRevision.rows[0]?.encounter_id;
      if (existingRevisionId && existingEncounterId) {
        visitaLegacyToEncounter.set(visita.id, existingEncounterId);
        visitaLegacyToRevision.set(visita.id, existingRevisionId);
        if (!encounterRevisionNo.has(existingEncounterId)) {
          const maxRevision = await pg.query<{ max_revision_no: number }>(
            `SELECT COALESCE(MAX(revision_no), 0) AS max_revision_no
             FROM clinical.encounter_revision
             WHERE encounter_id = $1`,
            [existingEncounterId]
          );
          encounterRevisionNo.set(existingEncounterId, Number(maxRevision.rows[0]?.max_revision_no ?? 0));
        }

        if (visita.is_current_version === 1) {
          await pg.query(
            `UPDATE clinical.encounter
             SET current_revision_id = $1,
                 updated_at = $2
             WHERE id = $3`,
            [existingRevisionId, visita.updated_at, existingEncounterId]
          );
        }

        continue;
      }

      if (visita.previous_version_id && visitaLegacyToEncounter.has(visita.previous_version_id)) {
        encounterId = visitaLegacyToEncounter.get(visita.previous_version_id)!;
        supersedesRevisionId = visitaLegacyToRevision.get(visita.previous_version_id) ?? null;
      } else {
        const encounterRes = await pg.query<{ id: string }>(
          `INSERT INTO clinical.encounter(
            id,
            legacy_id,
            ambulatorio_id,
            patient_id,
            status,
            created_by,
            created_at,
            updated_at
          ) OVERRIDING SYSTEM VALUE
          VALUES (gen_random_uuid(), $1, $2, $3, 'completed', $4, $5, $6)
          RETURNING id`,
          [
            visita.id,
            visita.ambulatorio_id,
            patientId,
            defaultUserId,
            visita.created_at,
            visita.updated_at
          ]
        );

        encounterId = encounterRes.rows[0]?.id as string;
        if (!encounterId) {
          quarantine.push({
            visita_id: visita.id,
            reason: 'encounter_insert_failed',
            payload: JSON.stringify(visita)
          });
          continue;
        }
      }

      const currentRevisionNo = encounterRevisionNo.get(encounterId) ?? 0;
      const revisionNo = currentRevisionNo + 1;
      encounterRevisionNo.set(encounterId, revisionNo);

      const revisionRes = await pg.query<{ id: string }>(
        `INSERT INTO clinical.encounter_revision(
          id,
          legacy_id,
          encounter_id,
          revision_no,
          supersedes_revision_id,
          visit_at,
          visit_type,
          reason,
          author_user_id,
          created_at
        ) OVERRIDING SYSTEM VALUE
        VALUES (
          gen_random_uuid(),
          $1,$2,$3,$4,$5,$6,$7,$8,$9
        )
        RETURNING id`,
        [
          visita.id,
          encounterId,
          revisionNo,
          supersedesRevisionId,
          visita.data_visita,
          visita.tipo_visita || 'Visita',
          visita.motivo || '-',
          authorUserId,
          visita.created_at
        ]
      );

      const revisionId = revisionRes.rows[0]?.id;
      if (!revisionId) {
        quarantine.push({
          visita_id: visita.id,
          reason: 'revision_insert_failed',
          payload: JSON.stringify(visita)
        });
        continue;
      }

      visitaLegacyToEncounter.set(visita.id, encounterId);
      visitaLegacyToRevision.set(visita.id, revisionId);

      await pg.query(
        `INSERT INTO clinical.encounter_anthropometrics(revision_id, height_cm, weight_kg, bmi, bsa)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (revision_id)
         DO UPDATE SET
           height_cm = EXCLUDED.height_cm,
           weight_kg = EXCLUDED.weight_kg,
           bmi = EXCLUDED.bmi,
           bsa = EXCLUDED.bsa`,
        [revisionId, visita.altezza, visita.peso, visita.bmi, visita.bsa]
      );

      await pg.query(
        `INSERT INTO clinical.encounter_anamnesis(revision_id, cardiologica_text, internistica_text)
         VALUES ($1,$2,$3)
         ON CONFLICT (revision_id)
         DO UPDATE SET
           cardiologica_text = EXCLUDED.cardiologica_text,
           internistica_text = EXCLUDED.internistica_text`,
        [revisionId, normalizeNullableText(visita.anamnesi_cardiologica), normalizeNullableText(visita.anamnesi_internistica)]
      );

      await pg.query(
        `INSERT INTO clinical.encounter_home_therapy(revision_id, content_text)
         VALUES ($1,$2)
         ON CONFLICT (revision_id)
         DO UPDATE SET content_text = EXCLUDED.content_text`,
        [revisionId, normalizeNullableText(visita.terapia_domiciliare)]
      );

      await pg.query(
        `INSERT INTO clinical.encounter_current_evaluation(revision_id, content_text)
         VALUES ($1,$2)
         ON CONFLICT (revision_id)
         DO UPDATE SET content_text = EXCLUDED.content_text`,
        [revisionId, normalizeNullableText(visita.valutazione_odierna)]
      );

      const labData = parseJsonRecord(visita.esami_ematici);
      const examDate = normalizeNullableText(labData.data_ee);
      await pg.query('DELETE FROM clinical.encounter_lab_result WHERE revision_id = $1', [revisionId]);
      for (const examCode of LAB_KEYS) {
        const valueText = normalizeNullableText(labData[examCode]);
        await pg.query(
          `INSERT INTO clinical.encounter_lab_result(
            revision_id,
            exam_code,
            exam_date,
            value_text,
            value_numeric,
            unit
          ) VALUES ($1,$2,$3,$4,NULL,NULL)`,
          [revisionId, examCode, examDate, valueText]
        );
      }

      await pg.query(
        `INSERT INTO clinical.encounter_echocardiography(revision_id, schema_version, payload_jsonb)
         VALUES ($1,1,$2::jsonb)
         ON CONFLICT (revision_id)
         DO UPDATE SET payload_jsonb = EXCLUDED.payload_jsonb`,
        [revisionId, JSON.stringify(parseJsonRecord(visita.ecocardiografia))]
      );

      const fh = parseJsonRecord(visita.fh_assessment);
      await pg.query(
        `INSERT INTO clinical.encounter_fh_assessment(
          revision_id,
          enabled,
          family_history_one_point,
          family_history_two_points,
          clinical_premature_cad,
          clinical_premature_cerebral_or_peripheral,
          physical_tendon_xanthomas,
          physical_corneal_arcus_before45,
          untreated_ldl_range,
          genetic_mutation,
          total_score,
          classification
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (revision_id)
        DO UPDATE SET
          enabled = EXCLUDED.enabled,
          family_history_one_point = EXCLUDED.family_history_one_point,
          family_history_two_points = EXCLUDED.family_history_two_points,
          clinical_premature_cad = EXCLUDED.clinical_premature_cad,
          clinical_premature_cerebral_or_peripheral = EXCLUDED.clinical_premature_cerebral_or_peripheral,
          physical_tendon_xanthomas = EXCLUDED.physical_tendon_xanthomas,
          physical_corneal_arcus_before45 = EXCLUDED.physical_corneal_arcus_before45,
          untreated_ldl_range = EXCLUDED.untreated_ldl_range,
          genetic_mutation = EXCLUDED.genetic_mutation,
          total_score = EXCLUDED.total_score,
          classification = EXCLUDED.classification`,
        [
          revisionId,
          normalizeBoolean(fh.enabled),
          normalizeBoolean(fh.familyHistoryOnePoint),
          normalizeBoolean(fh.familyHistoryTwoPoints),
          normalizeBoolean(fh.clinicalPrematureCAD),
          normalizeBoolean(fh.clinicalPrematureCerebralOrPeripheral),
          normalizeBoolean(fh.physicalTendonXanthomas),
          normalizeBoolean(fh.physicalCornealArcusBefore45),
          normalizeText(fh.untreatedLdlRange),
          normalizeBoolean(fh.geneticMutation),
          Number(fh.totalScore ?? 0),
          normalizeText(fh.classification) || 'Improbabile'
        ]
      );

      const lipid = parseJsonRecord(visita.terapia_ipolipemizzante);
      const section = (key: string) => {
        const value = lipid[key];
        return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      };
      const statine = section('statine');
      const ezetimibe = section('ezetimibe');
      const fibrati = section('fibrati');
      const omega3 = section('omega3');
      const acidoBempedoico = section('acido_bempedoico');
      const repatha = section('repatha');
      const praluent = section('praluent');
      const leqvio = section('leqvio');

      await pg.query(
        `INSERT INTO clinical.encounter_lipid_therapy(
          revision_id,
          statin_enabled, statin_dose,
          ezetimibe_enabled, ezetimibe_mode,
          fibrati_enabled, fibrati_dose,
          omega3_enabled, omega3_dose,
          acido_bempedoico_enabled, acido_bempedoico_dose,
          repatha_enabled, repatha_dose,
          praluent_enabled, praluent_dose,
          leqvio_enabled, leqvio_dose
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (revision_id)
        DO UPDATE SET
          statin_enabled = EXCLUDED.statin_enabled,
          statin_dose = EXCLUDED.statin_dose,
          ezetimibe_enabled = EXCLUDED.ezetimibe_enabled,
          ezetimibe_mode = EXCLUDED.ezetimibe_mode,
          fibrati_enabled = EXCLUDED.fibrati_enabled,
          fibrati_dose = EXCLUDED.fibrati_dose,
          omega3_enabled = EXCLUDED.omega3_enabled,
          omega3_dose = EXCLUDED.omega3_dose,
          acido_bempedoico_enabled = EXCLUDED.acido_bempedoico_enabled,
          acido_bempedoico_dose = EXCLUDED.acido_bempedoico_dose,
          repatha_enabled = EXCLUDED.repatha_enabled,
          repatha_dose = EXCLUDED.repatha_dose,
          praluent_enabled = EXCLUDED.praluent_enabled,
          praluent_dose = EXCLUDED.praluent_dose,
          leqvio_enabled = EXCLUDED.leqvio_enabled,
          leqvio_dose = EXCLUDED.leqvio_dose`,
        [
          revisionId,
          normalizeBoolean(statine.enabled), normalizeText(statine.dose),
          normalizeBoolean(ezetimibe.enabled), normalizeText(ezetimibe.modalita),
          normalizeBoolean(fibrati.enabled), normalizeText(fibrati.dose),
          normalizeBoolean(omega3.enabled), normalizeText(omega3.dose),
          normalizeBoolean(acidoBempedoico.enabled), normalizeText(acidoBempedoico.dose),
          normalizeBoolean(repatha.enabled), normalizeText(repatha.dose),
          normalizeBoolean(praluent.enabled), normalizeText(praluent.dose),
          normalizeBoolean(leqvio.enabled), normalizeText(leqvio.dose)
        ]
      );

      const rischio = parseJsonRecord(visita.valutazione_rischio_cv);
      await pg.query(
        `INSERT INTO clinical.encounter_cv_risk_evaluation(
          revision_id,
          risk_level,
          target_ldl,
          current_ldl,
          ldl_source,
          status,
          status_message
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (revision_id)
        DO UPDATE SET
          risk_level = EXCLUDED.risk_level,
          target_ldl = EXCLUDED.target_ldl,
          current_ldl = EXCLUDED.current_ldl,
          ldl_source = EXCLUDED.ldl_source,
          status = EXCLUDED.status,
          status_message = EXCLUDED.status_message`,
        [
          revisionId,
          normalizeText(rischio.rischio),
          rischio.targetLdl ?? null,
          rischio.ldlAttuale ?? null,
          normalizeText(rischio.ldlSource),
          normalizeText(rischio.status) || 'non_valutabile',
          normalizeText(rischio.statusMessage)
        ]
      );

      const followup = parseJsonRecord(visita.pianificazione_followup);
      await pg.query(
        `INSERT INTO clinical.encounter_conclusion(
          revision_id,
          conclusion_text,
          diagnosis_text,
          note_text,
          followup_at,
          followup_reason,
          followup_tests
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (revision_id)
        DO UPDATE SET
          conclusion_text = EXCLUDED.conclusion_text,
          diagnosis_text = EXCLUDED.diagnosis_text,
          note_text = EXCLUDED.note_text,
          followup_at = EXCLUDED.followup_at,
          followup_reason = EXCLUDED.followup_reason,
          followup_tests = EXCLUDED.followup_tests`,
        [
          revisionId,
          normalizeNullableText(visita.conclusioni),
          normalizeNullableText(visita.diagnosi),
          normalizeNullableText(visita.note),
          normalizeNullableText(followup.dataOraProssimaVisita),
          normalizeNullableText(followup.motivoProssimaVisita),
          normalizeNullableText(followup.esamiEmaticiDaFare)
        ]
      );

      const firme = parseJsonRecord(visita.firme_visita);
      await pg.query('DELETE FROM clinical.encounter_signature WHERE revision_id = $1', [revisionId]);
      const cardiologoNome = normalizeText(firme.cardiologoNome).trim();
      const cardiologoTitolo = normalizeText(firme.cardiologoTitolo).trim() === 'dott.ssa' ? 'dott.ssa' : 'dott';
      if (cardiologoNome) {
        await pg.query(
          `INSERT INTO clinical.encounter_signature(revision_id, sign_role, full_name, title, display_order)
           VALUES ($1, 'cardiologo', $2, $3, 1)`,
          [revisionId, cardiologoNome, cardiologoTitolo]
        );
      }

      const mediciInFormazione = Array.isArray(firme.mediciInFormazione) ? firme.mediciInFormazione : [];
      for (let index = 0; index < mediciInFormazione.length; index += 1) {
        const raw = mediciInFormazione[index];
        if (!raw || typeof raw !== 'object') {
          continue;
        }

        const nome = normalizeText((raw as Record<string, unknown>).nome).trim();
        if (!nome) {
          continue;
        }

        const titolo =
          normalizeText((raw as Record<string, unknown>).titolo).trim() === 'dott.ssa'
            ? 'dott.ssa'
            : 'dott';

        await pg.query(
          `INSERT INTO clinical.encounter_signature(revision_id, sign_role, full_name, title, display_order)
           VALUES ($1, 'medico_formazione', $2, $3, $4)`,
          [revisionId, nome, titolo, index + 1]
        );
      }

      await pg.query(
        `INSERT INTO clinical.encounter_legacy_payload(revision_id, source, payload_jsonb)
         VALUES ($1, 'sqlite_etl', $2::jsonb)`,
        [
          revisionId,
          JSON.stringify({
            anamnesi: normalizeText(visita.anamnesi),
            esame_obiettivo: normalizeText(visita.esame_obiettivo),
            diagnosi: normalizeText(visita.diagnosi),
            terapia: normalizeText(visita.terapia),
            note: normalizeText(visita.note)
          })
        ]
      );

      if (visita.is_current_version === 1) {
        await pg.query(
          `UPDATE clinical.encounter
           SET current_revision_id = $1,
               updated_at = $2
           WHERE id = $3`,
          [revisionId, visita.updated_at, encounterId]
        );
      }
    }

    for (const fattore of fattori) {
      const revisionId = visitaLegacyToRevision.get(fattore.visita_id);
      if (!revisionId) {
        quarantine.push({
          visita_id: fattore.visita_id,
          reason: `fattore_without_visita:${fattore.visita_id}`,
          payload: JSON.stringify(fattore)
        });
        continue;
      }

      await pg.query(
        `INSERT INTO clinical.encounter_cv_risk_factor(
          revision_id,
          familiarita,
          familiarita_note,
          ipertensione,
          diabete,
          diabete_durata,
          diabete_tipo,
          dislipidemia,
          obesita,
          fumo,
          fumo_ex_eta
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (revision_id)
        DO UPDATE SET
          familiarita = EXCLUDED.familiarita,
          familiarita_note = EXCLUDED.familiarita_note,
          ipertensione = EXCLUDED.ipertensione,
          diabete = EXCLUDED.diabete,
          diabete_durata = EXCLUDED.diabete_durata,
          diabete_tipo = EXCLUDED.diabete_tipo,
          dislipidemia = EXCLUDED.dislipidemia,
          obesita = EXCLUDED.obesita,
          fumo = EXCLUDED.fumo,
          fumo_ex_eta = EXCLUDED.fumo_ex_eta`,
        [
          revisionId,
          normalizeBoolean(fattore.familiarita),
          normalizeNullableText(fattore.familiarita_note),
          normalizeBoolean(fattore.ipertensione),
          normalizeBoolean(fattore.diabete),
          normalizeNullableText(fattore.diabete_durata),
          normalizeText(fattore.diabete_tipo),
          normalizeBoolean(fattore.dislipidemia),
          normalizeBoolean(fattore.obesita),
          normalizeText(fattore.fumo),
          normalizeNullableText(fattore.fumo_ex_eta)
        ]
      );
    }

    for (const appuntamento of appuntamenti) {
      const patientId = patientLegacyToInternal.get(appuntamento.paziente_id);
      if (!patientId) {
        quarantine.push({
          visita_id: appuntamento.id,
          reason: `appuntamento_patient_not_found:${appuntamento.paziente_id}`,
          payload: JSON.stringify(appuntamento)
        });
        continue;
      }

      const sourceRevisionId =
        appuntamento.source_visita_id !== null && appuntamento.source_visita_id !== undefined
          ? visitaLegacyToRevision.get(appuntamento.source_visita_id) ?? null
          : null;

      await pg.query(
        `INSERT INTO scheduling.appointment(
          id,
          legacy_id,
          ambulatorio_id,
          patient_id,
          start_at,
          end_at,
          duration_minutes,
          status,
          reason,
          origin,
          source_encounter_revision_id,
          created_by,
          updated_by,
          created_at,
          updated_at
        ) OVERRIDING SYSTEM VALUE
        VALUES (
          gen_random_uuid(),
          $1,$2,$3,$4,$5,$6,
          'scheduled',
          $7,
          $8,
          $9,
          $10,
          $10,
          $11,
          $12
        )
        ON CONFLICT (legacy_id)
        DO UPDATE SET
          ambulatorio_id = EXCLUDED.ambulatorio_id,
          patient_id = EXCLUDED.patient_id,
          start_at = EXCLUDED.start_at,
          end_at = EXCLUDED.end_at,
          duration_minutes = EXCLUDED.duration_minutes,
          reason = EXCLUDED.reason,
          origin = EXCLUDED.origin,
          source_encounter_revision_id = EXCLUDED.source_encounter_revision_id,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at`,
        [
          appuntamento.id,
          appuntamento.ambulatorio_id,
          patientId,
          appuntamento.data_ora_inizio,
          appuntamento.data_ora_fine,
          appuntamento.durata_minuti ?? getDurationMinutes(appuntamento.data_ora_inizio, appuntamento.data_ora_fine),
          normalizeNullableText(appuntamento.motivo),
          appuntamento.origine === 'followup_visita' ? 'followup_visit' : 'manual',
          sourceRevisionId,
          defaultUserId,
          appuntamento.created_at,
          appuntamento.updated_at
        ]
      );
    }

    for (const [encounterId, revisionNo] of encounterRevisionNo.entries()) {
      const current = await pg.query<{ id: string }>(
        `SELECT id
         FROM clinical.encounter_revision
         WHERE encounter_id = $1
           AND revision_no = $2
         LIMIT 1`,
        [encounterId, revisionNo]
      );

      const currentRevisionId = current.rows[0]?.id;
      if (currentRevisionId) {
        await pg.query(
          `UPDATE clinical.encounter
           SET current_revision_id = COALESCE(current_revision_id, $1),
               updated_at = now()
           WHERE id = $2`,
          [currentRevisionId, encounterId]
        );
      }
    }

    for (const issue of quarantine) {
      const revisionId = visitaLegacyToRevision.get(issue.visita_id);
      if (!revisionId) {
        continue;
      }

      await pg.query(
        `INSERT INTO clinical.encounter_legacy_payload(revision_id, source, payload_jsonb)
         VALUES ($1, 'sqlite_etl_quarantine', $2::jsonb)`,
        [
          revisionId,
          JSON.stringify({
            reason: issue.reason,
            payload: issue.payload
          })
        ]
      );
    }

    await syncLegacySequences(pg);

    await pg.query('COMMIT');

    console.log('Migration completed');
    console.log(`users: ${users.length}`);
    console.log(`ambulatori: ${ambulatori.length}`);
    console.log(`orari: ${orari.length}`);
    console.log(`pazienti: ${pazienti.length}`);
    console.log(`visite: ${visite.length}`);
    console.log(`fattori_rischio_cv: ${fattori.length}`);
    console.log(`appuntamenti: ${appuntamenti.length}`);
    console.log(`quarantine: ${quarantine.length}`);
  } catch (error) {
    await pg.query('ROLLBACK');
    throw error;
  } finally {
    sqlite.close();
    await pg.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
