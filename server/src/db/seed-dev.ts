import argon2 from 'argon2';
import { env } from '../config/env.js';
import { query, withTransaction } from './pool.js';

type AmbulatorioRow = {
  id: number;
  code: string;
  name: string;
};

type SyntheticPatientSeed = {
  temporaryCode: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  birthPlace: string;
  sex: 'M' | 'F' | 'Altro';
  city: string;
  province: string;
};

const syntheticPatients: SyntheticPatientSeed[] = [
  {
    temporaryCode: 'DEVTMP0001',
    firstName: 'Luca',
    lastName: 'Ferri',
    birthDate: '1984-05-11',
    birthPlace: 'Bologna',
    sex: 'M',
    city: 'Bologna',
    province: 'BO'
  },
  {
    temporaryCode: 'DEVTMP0002',
    firstName: 'Elena',
    lastName: 'Riva',
    birthDate: '1978-09-23',
    birthPlace: 'Torino',
    sex: 'F',
    city: 'Torino',
    province: 'TO'
  },
  {
    temporaryCode: 'DEVTMP0003',
    firstName: 'Marco',
    lastName: 'Sartori',
    birthDate: '1990-01-17',
    birthPlace: 'Padova',
    sex: 'M',
    city: 'Padova',
    province: 'PD'
  },
  {
    temporaryCode: 'DEVTMP0004',
    firstName: 'Chiara',
    lastName: 'Galli',
    birthDate: '1988-12-02',
    birthPlace: 'Firenze',
    sex: 'F',
    city: 'Firenze',
    province: 'FI'
  },
  {
    temporaryCode: 'DEVTMP0005',
    firstName: 'Davide',
    lastName: 'Leoni',
    birthDate: '1975-03-29',
    birthPlace: 'Parma',
    sex: 'M',
    city: 'Parma',
    province: 'PR'
  }
];

async function ensureBaseAmbulatori(): Promise<AmbulatorioRow[]> {
  await query(
    `INSERT INTO org.ambulatorio(code, name, is_active)
     VALUES
       ('DISLIP', 'Ambulatorio Cardiologico delle Dislipidemie', TRUE),
       ('ORTO', 'Ortopedia', TRUE),
       ('DHR', 'Day Hospital Riabilitativa', TRUE)
     ON CONFLICT (code)
     DO UPDATE SET
       name = EXCLUDED.name,
       is_active = EXCLUDED.is_active`
  );

  const result = await query<AmbulatorioRow>(
    `SELECT id, code, name
     FROM org.ambulatorio
     WHERE code IN ('DISLIP', 'ORTO', 'DHR')
     ORDER BY id ASC`
  );

  return result.rows;
}

async function ensureDeveloperAdmin(): Promise<string> {
  const passwordHash = await argon2.hash('admin123');

  return withTransaction(async (client) => {
    const existing = await client.query<{ id: string }>(
      `SELECT id
       FROM iam.app_user
       WHERE username = 'admin'
       LIMIT 1`
    );

    const userId =
      existing.rows[0]?.id ??
      (
        await client.query<{ id: string }>(
          `INSERT INTO iam.app_user(username, first_name, last_name, status)
           VALUES ('admin', 'Admin', 'Dev', 'active')
           RETURNING id`
        )
      ).rows[0]?.id;

    if (!userId) {
      throw new Error('Impossibile creare admin utente sintetico');
    }

    await client.query(
      `INSERT INTO iam.user_credential(user_id, password_hash, password_algo, must_rotate)
       VALUES ($1, $2, 'argon2id', FALSE)
       ON CONFLICT (user_id)
       DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         password_algo = EXCLUDED.password_algo,
         must_rotate = EXCLUDED.must_rotate,
         password_changed_at = now()`,
      [userId, passwordHash]
    );

    const role = await client.query<{ id: number }>(
      `SELECT id
       FROM iam.role
       WHERE code = 'admin'
       LIMIT 1`
    );
    const roleId = role.rows[0]?.id;
    if (!roleId) {
      throw new Error('Ruolo admin non trovato. Esegui prima le migrazioni + seed IAM.');
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
      [userId, roleId]
    );

    return userId;
  });
}

async function upsertSyntheticPatients(ambulatorioId: number, actorUserId: string): Promise<string[]> {
  const patientIds: string[] = [];

  for (const seed of syntheticPatients) {
    const existing = await query<{ id: string }>(
      `SELECT id
       FROM patient.patient
       WHERE ambulatorio_id = $1
         AND temporary_code = $2
         AND deleted_at IS NULL
       LIMIT 1`,
      [ambulatorioId, seed.temporaryCode]
    );

    const existingId = existing.rows[0]?.id;
    if (existingId) {
      await query(
        `UPDATE patient.patient
         SET first_name = $1,
             last_name = $2,
             birth_date = $3,
             birth_place = $4,
             sex = $5,
             city = $6,
             province = $7,
             is_active = TRUE,
             updated_by = $8,
             updated_at = now()
         WHERE id = $9`,
        [
          seed.firstName,
          seed.lastName,
          seed.birthDate,
          seed.birthPlace,
          seed.sex,
          seed.city,
          seed.province,
          actorUserId,
          existingId
        ]
      );
      patientIds.push(existingId);
      continue;
    }

    const created = await query<{ id: string }>(
      `INSERT INTO patient.patient(
        ambulatorio_id,
        first_name,
        last_name,
        birth_date,
        birth_place,
        sex,
        temporary_code,
        city,
        province,
        is_active,
        created_by,
        updated_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,$10
      )
      RETURNING id`,
      [
        ambulatorioId,
        seed.firstName,
        seed.lastName,
        seed.birthDate,
        seed.birthPlace,
        seed.sex,
        seed.temporaryCode,
        seed.city,
        seed.province,
        actorUserId
      ]
    );

    const createdId = created.rows[0]?.id;
    if (createdId) {
      patientIds.push(createdId);
    }
  }

  return patientIds;
}

async function ensureSampleEncounter(
  patientId: string,
  ambulatorioId: number,
  actorUserId: string
): Promise<void> {
  const existing = await query<{ id: string }>(
    `SELECT id
     FROM clinical.encounter
     WHERE patient_id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [patientId]
  );

  if (existing.rows[0]?.id) {
    return;
  }

  await withTransaction(async (client) => {
    const encounter = await client.query<{ id: string }>(
      `INSERT INTO clinical.encounter(
        ambulatorio_id,
        patient_id,
        status,
        created_by
      ) VALUES ($1, $2, 'completed', $3)
      RETURNING id`,
      [ambulatorioId, patientId, actorUserId]
    );
    const encounterId = encounter.rows[0]?.id;
    if (!encounterId) {
      throw new Error('Impossibile creare encounter sintetico');
    }

    const revision = await client.query<{ id: string }>(
      `INSERT INTO clinical.encounter_revision(
        encounter_id,
        revision_no,
        visit_at,
        visit_type,
        reason,
        author_user_id
      ) VALUES ($1, 1, now(), 'Visita di controllo', 'Seed sintetico development', $2)
      RETURNING id`,
      [encounterId, actorUserId]
    );
    const revisionId = revision.rows[0]?.id;
    if (!revisionId) {
      throw new Error('Impossibile creare revision sintetica');
    }

    await client.query(
      `UPDATE clinical.encounter
       SET current_revision_id = $1,
           updated_at = now()
       WHERE id = $2`,
      [revisionId, encounterId]
    );

    await client.query(
      `INSERT INTO clinical.encounter_cv_risk_evaluation(
        revision_id,
        risk_level,
        target_ldl,
        current_ldl,
        ldl_source,
        status,
        status_message
      ) VALUES ($1, 'moderato', 100, 135, 'calcolato', 'non_raggiunto', 'Paziente seed sintetico')`,
      [revisionId]
    );
  });
}

async function main(): Promise<void> {
  if (env.APP_ENV !== 'development') {
    throw new Error(`Seed dev bloccato: APP_ENV=${env.APP_ENV}.`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[seed-dev] env=${env.APP_ENV} project_ref_actual=${env.SUPABASE_PROJECT_REF_ACTUAL} project_ref_expected=${env.SUPABASE_PROJECT_REF_EXPECTED}`
  );

  const ambulatori = await ensureBaseAmbulatori();
  const dislip = ambulatori.find((ambulatorio) => ambulatorio.code === 'DISLIP') ?? ambulatori[0];
  if (!dislip) {
    throw new Error('Nessun ambulatorio disponibile per il seed development');
  }

  const adminUserId = await ensureDeveloperAdmin();
  const patientIds = await upsertSyntheticPatients(dislip.id, adminUserId);

  for (const patientId of patientIds.slice(0, 3)) {
    await ensureSampleEncounter(patientId, dislip.id, adminUserId);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[seed-dev] completed: ambulatorio=${dislip.code} synthetic_patients=${patientIds.length} sample_encounters=${Math.min(patientIds.length, 3)}`
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[seed-dev] failed:', error);
  process.exitCode = 1;
});
