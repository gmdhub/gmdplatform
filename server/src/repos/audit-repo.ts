import { query } from '../db/pool.js';

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeUuid(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return uuidRegex.test(normalized) ? normalized : null;
}

export async function logAuditEvent(input: {
  actor_user_id?: string | null;
  action: string;
  entity_schema: string;
  entity_table: string;
  entity_pk: string;
  ambulatorio_id?: number | null;
  patient_id?: string | null;
  correlation_id?: string | null;
  app_version?: string | null;
  device_id?: string | null;
  ip_address?: string | null;
  before_data?: unknown;
  after_data?: unknown;
}) {
  await query(
    `INSERT INTO audit.audit_event(
      actor_user_id,
      action,
      entity_schema,
      entity_table,
      entity_pk,
      ambulatorio_id,
      patient_id,
      correlation_id,
      app_version,
      device_id,
      ip_address,
      before_data,
      after_data
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,
    [
      normalizeUuid(input.actor_user_id),
      input.action,
      input.entity_schema,
      input.entity_table,
      input.entity_pk,
      input.ambulatorio_id ?? null,
      normalizeUuid(input.patient_id),
      normalizeUuid(input.correlation_id),
      input.app_version ?? null,
      input.device_id ?? null,
      input.ip_address ?? null,
      input.before_data ? JSON.stringify(input.before_data) : null,
      input.after_data ? JSON.stringify(input.after_data) : null
    ]
  );
}

export async function logPatientAccess(input: {
  actor_user_id: string;
  patient_id: string;
  encounter_id?: string | null;
  access_type: 'view_patient' | 'view_encounter' | 'view_report' | 'export_report';
  reason?: string | null;
  correlation_id?: string | null;
}) {
  await query(
    `INSERT INTO audit.patient_access_log(
      actor_user_id,
      patient_id,
      encounter_id,
      access_type,
      reason,
      correlation_id
    ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.actor_user_id,
      input.patient_id,
      input.encounter_id ?? null,
      input.access_type,
      input.reason ?? null,
      input.correlation_id ?? null
    ]
  );
}

export async function logPatientAccessBatch(input: {
  actor_user_id: string;
  access_type: 'view_patient' | 'view_encounter' | 'view_report' | 'export_report';
  reason?: string | null;
  correlation_id?: string | null;
  items: Array<{
    patient_id: string;
    encounter_id?: string | null;
  }>;
}) {
  if (input.items.length === 0) {
    return;
  }

  await query(
    `INSERT INTO audit.patient_access_log(
      actor_user_id,
      patient_id,
      encounter_id,
      access_type,
      reason,
      correlation_id
    )
    SELECT
      $1::uuid,
      p.patient_id,
      p.encounter_id,
      $2::text,
      $3::text,
      NULLIF($4::text, '')::uuid
    FROM jsonb_to_recordset($5::jsonb) AS p(patient_id uuid, encounter_id uuid)`,
    [
      input.actor_user_id,
      input.access_type,
      input.reason ?? null,
      input.correlation_id ?? null,
      JSON.stringify(
        input.items.map((item) => ({
          patient_id: item.patient_id,
          encounter_id: item.encounter_id ?? null
        }))
      )
    ]
  );
}
