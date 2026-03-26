import { query } from '../db/pool.js';

export type LegacyPatientRow = {
  id: number;
  internal_id?: string;
  ambulatorio_id: number;
  nome: string;
  cognome: string;
  data_nascita: string;
  luogo_nascita: string;
  codice_fiscale: string;
  sesso: 'M' | 'F' | 'Altro';
  esenzioni: string;
  indirizzo: string;
  citta: string;
  cap: string;
  provincia: string;
  telefono: string;
  email: string;
  created_at: string;
  updated_at: string;
};

export async function listPatients(params: {
  ambulatorioId?: number;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<LegacyPatientRow[]> {
  const values: unknown[] = [];
  const where: string[] = ['TRUE'];

  if (params.ambulatorioId) {
    values.push(params.ambulatorioId);
    where.push(`ambulatorio_id = $${values.length}`);
  }

  if (params.search && params.search.trim()) {
    values.push(`%${params.search.trim()}%`);
    where.push(
      `(nome ILIKE $${values.length} OR cognome ILIKE $${values.length} OR codice_fiscale ILIKE $${values.length})`
    );
  }

  const limit = Math.max(1, Math.min(params.limit ?? 100, 500));
  const offset = Math.max(0, params.offset ?? 0);
  values.push(limit);
  values.push(offset);

  const result = await query<LegacyPatientRow>(
    `SELECT *
     FROM compat.pazienti
     WHERE ${where.join(' AND ')}
     ORDER BY cognome ASC, nome ASC
     LIMIT $${values.length - 1}
     OFFSET $${values.length}`,
    values
  );

  return result.rows;
}

export async function getPatientByLegacyId(legacyId: number): Promise<LegacyPatientRow | null> {
  const result = await query<LegacyPatientRow>(
    `SELECT *
     FROM compat.pazienti
     WHERE id = $1
     LIMIT 1`,
    [legacyId]
  );

  return result.rows[0] ?? null;
}

export async function createPatient(input: {
  ambulatorio_id: number;
  first_name: string;
  last_name: string;
  birth_date: string;
  birth_place: string;
  sex: 'M' | 'F' | 'Altro';
  tax_code?: string | null;
  temporary_code?: string | null;
  exemptions?: string | null;
  address?: string | null;
  city?: string | null;
  cap?: string | null;
  province?: string | null;
  phone?: string | null;
  email?: string | null;
  actor_user_id?: string | null;
}) {
  const result = await query<{ id: number }>(
    `INSERT INTO patient.patient(
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
      created_by,
      updated_by
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16
    ) RETURNING legacy_id AS id`,
    [
      input.ambulatorio_id,
      input.first_name,
      input.last_name,
      input.birth_date,
      input.birth_place,
      input.sex,
      input.tax_code ?? null,
      input.temporary_code ?? null,
      input.exemptions ?? null,
      input.address ?? null,
      input.city ?? null,
      input.cap ?? null,
      input.province ?? null,
      input.phone ?? null,
      input.email ?? null,
      input.actor_user_id ?? null
    ]
  );

  return result.rows[0]?.id ?? null;
}

export async function updatePatientByLegacyId(
  legacyId: number,
  patch: Record<string, unknown>,
  actorUserId?: string
) {
  const mapping: Record<string, string> = {
    ambulatorio_id: 'ambulatorio_id',
    first_name: 'first_name',
    last_name: 'last_name',
    birth_date: 'birth_date',
    birth_place: 'birth_place',
    sex: 'sex',
    tax_code: 'tax_code',
    temporary_code: 'temporary_code',
    exemptions: 'exemptions',
    address: 'address',
    city: 'city',
    cap: 'cap',
    province: 'province',
    phone: 'phone',
    email: 'email',
    is_active: 'is_active',
    archived_at: 'archived_at'
  };

  const values: unknown[] = [];
  const setClauses: string[] = [];

  for (const [key, value] of Object.entries(patch)) {
    const column = mapping[key];
    if (!column) {
      continue;
    }

    values.push(value);
    setClauses.push(`${column} = $${values.length}`);
  }

  values.push(actorUserId ?? null);
  setClauses.push(`updated_by = $${values.length}`);

  values.push(legacyId);

  if (setClauses.length === 1) {
    return;
  }

  await query(
    `UPDATE patient.patient
     SET ${setClauses.join(', ')}
     WHERE legacy_id = $${values.length}
       AND deleted_at IS NULL`,
    values
  );
}

export async function deletePatientByLegacyId(legacyId: number, actorUserId?: string | null): Promise<void> {
  await query(
    `UPDATE patient.patient
     SET deleted_at = now(),
         updated_by = $1
     WHERE legacy_id = $2
       AND deleted_at IS NULL`,
    [actorUserId ?? null, legacyId]
  );
}
