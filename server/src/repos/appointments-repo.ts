import { query } from '../db/pool.js';

export async function listAppointments(params: {
  ambulatorioId?: number;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) {
  const values: unknown[] = [];
  const where: string[] = ['a.deleted_at IS NULL'];

  if (params.ambulatorioId) {
    values.push(params.ambulatorioId);
    where.push(`a.ambulatorio_id = $${values.length}`);
  }

  if (params.from) {
    values.push(params.from);
    where.push(`a.start_at >= ($${values.length}::timestamp AT TIME ZONE 'Europe/Rome')`);
  }

  if (params.to) {
    values.push(params.to);
    where.push(`a.end_at <= ($${values.length}::timestamp AT TIME ZONE 'Europe/Rome')`);
  }

  const limit = Math.max(1, Math.min(params.limit ?? 500, 1000));
  const offset = Math.max(0, params.offset ?? 0);
  values.push(limit);
  values.push(offset);

  const result = await query(
    `SELECT a.*
     FROM scheduling.appointment a
     WHERE ${where.join(' AND ')}
     ORDER BY a.start_at ASC
     LIMIT $${values.length - 1}
     OFFSET $${values.length}`,
    values
  );

  return result.rows;
}

export async function createAppointment(input: {
  ambulatorio_id: number;
  patient_id: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  reason?: string | null;
  origin: 'manual' | 'followup_visit';
  source_encounter_revision_id?: string | null;
  actor_user_id?: string | null;
}) {
  const result = await query<{ id: string }>(
    `INSERT INTO scheduling.appointment(
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
      updated_by
    ) VALUES (
      $1,
      $2,
      ($3::timestamp AT TIME ZONE 'Europe/Rome'),
      ($4::timestamp AT TIME ZONE 'Europe/Rome'),
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $10
    )
    RETURNING id`,
    [
      input.ambulatorio_id,
      input.patient_id,
      input.start_at,
      input.end_at,
      input.duration_minutes,
      input.status,
      input.reason ?? null,
      input.origin,
      input.source_encounter_revision_id ?? null,
      input.actor_user_id ?? null
    ]
  );

  return result.rows[0]?.id ?? null;
}

export async function updateAppointment(id: string, patch: Record<string, unknown>, actorUserId?: string) {
  const allowed = new Set([
    'patient_id',
    'start_at',
    'end_at',
    'duration_minutes',
    'status',
    'reason',
    'origin',
    'source_encounter_revision_id'
  ]);

  const values: unknown[] = [];
  const setClauses: string[] = [];

  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) continue;
    values.push(value);
    if (key === 'start_at' || key === 'end_at') {
      setClauses.push(`${key} = ($${values.length}::timestamp AT TIME ZONE 'Europe/Rome')`);
    } else {
      setClauses.push(`${key} = $${values.length}`);
    }
  }

  values.push(actorUserId ?? null);
  setClauses.push(`updated_by = $${values.length}`);
  values.push(id);

  if (setClauses.length === 1) {
    return;
  }

  await query(
    `UPDATE scheduling.appointment
     SET ${setClauses.join(', ')}
     WHERE id = $${values.length}
       AND deleted_at IS NULL`,
    values
  );
}

export async function deleteAppointment(id: string, actorUserId?: string) {
  await query(
    `UPDATE scheduling.appointment
     SET deleted_at = now(),
         updated_by = $1
     WHERE id = $2
       AND deleted_at IS NULL`,
    [actorUserId ?? null, id]
  );
}
