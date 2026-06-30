import { withTransaction, query } from '../db/pool.js';

export type AmbulatorioRow = {
  id: number | string;
  code: string;
  name: string;
  nome: string;
  logo_path: string | null;
  color_primary: string;
  color_secondary: string;
  color_accent: string;
  min_visit_minutes: number | string | null;
  standard_visit_minutes: number | string | null;
  durata_minima_visita_minuti: number | string | null;
  durata_standard_visita_minuti: number | string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function listAmbulatori(): Promise<AmbulatorioRow[]> {
  const result = await query<AmbulatorioRow>(
    `SELECT
       a.id,
       a.code,
       a.name,
       a.name AS nome,
       t.logo_path,
       COALESCE(t.color_primary, '#1e3a8a') AS color_primary,
       COALESCE(t.color_secondary, '#3b82f6') AS color_secondary,
       COALESCE(t.color_accent, '#22d3ee') AS color_accent,
       s.min_visit_minutes,
       s.standard_visit_minutes,
       s.min_visit_minutes AS durata_minima_visita_minuti,
       s.standard_visit_minutes AS durata_standard_visita_minuti,
       a.is_active,
       a.created_at,
       a.updated_at
     FROM org.ambulatorio a
     LEFT JOIN org.ambulatorio_theme t ON t.ambulatorio_id = a.id
     LEFT JOIN org.ambulatorio_settings s ON s.ambulatorio_id = a.id
     WHERE is_active = TRUE
     ORDER BY a.name ASC`
  );
  return result.rows;
}

export async function getAmbulatorioById(id: number) {
  const result = await query(
    `SELECT
       a.id,
       a.code,
       a.name,
       a.is_active,
       a.created_at,
       a.updated_at,
       s.min_visit_minutes,
       s.standard_visit_minutes,
       s.report_base_uri,
       s.timezone,
       t.logo_path,
       t.color_primary,
       t.color_secondary,
       t.color_accent
     FROM org.ambulatorio a
     LEFT JOIN org.ambulatorio_settings s ON s.ambulatorio_id = a.id
     LEFT JOIN org.ambulatorio_theme t ON t.ambulatorio_id = a.id
     WHERE a.id = $1
     LIMIT 1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function getOperatingWindows(ambulatorioId: number) {
  const result = await query(
    `SELECT id, ambulatorio_id, weekday, start_time, end_time, max_patients_per_day
     FROM org.ambulatorio_operating_window
     WHERE ambulatorio_id = $1
     ORDER BY weekday ASC, start_time ASC`,
    [ambulatorioId]
  );
  return result.rows;
}

export async function upsertSettings(params: {
  ambulatorioId: number;
  minVisitMinutes: number;
  standardVisitMinutes: number;
  reportBaseUri: string | null;
  timezone: string;
}) {
  await query(
    `INSERT INTO org.ambulatorio_settings(
      ambulatorio_id,
      min_visit_minutes,
      standard_visit_minutes,
      report_base_uri,
      timezone
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (ambulatorio_id)
    DO UPDATE SET
      min_visit_minutes = EXCLUDED.min_visit_minutes,
      standard_visit_minutes = EXCLUDED.standard_visit_minutes,
      report_base_uri = EXCLUDED.report_base_uri,
      timezone = EXCLUDED.timezone,
      updated_at = now()`,
    [
      params.ambulatorioId,
      params.minVisitMinutes,
      params.standardVisitMinutes,
      params.reportBaseUri,
      params.timezone
    ]
  );
}

export async function updateAmbulatorioDetails(params: {
  ambulatorioId: number;
  name?: string;
  logoPath?: string | null;
  colorPrimary?: string;
  colorSecondary?: string;
  colorAccent?: string;
}) {
  await withTransaction(async (client) => {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.name !== undefined) {
      values.push(params.name);
      updates.push(`name = $${values.length}`);
    }

    if (updates.length > 0) {
      values.push(params.ambulatorioId);
      await client.query(
        `UPDATE org.ambulatorio
         SET ${updates.join(', ')}
         WHERE id = $${values.length}`,
        values
      );
    }

    if (
      params.logoPath !== undefined ||
      params.colorPrimary !== undefined ||
      params.colorSecondary !== undefined ||
      params.colorAccent !== undefined
    ) {
      await client.query(
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
          params.ambulatorioId,
          params.logoPath ?? null,
          params.colorPrimary ?? '#1e3a8a',
          params.colorSecondary ?? '#3b82f6',
          params.colorAccent ?? '#22d3ee'
        ]
      );
    }
  });
}

export async function replaceOperatingWindows(params: {
  ambulatorioId: number;
  windows: Array<{ weekday: number; start_time: string; end_time: string; max_patients_per_day: number }>;
}) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM org.ambulatorio_operating_window WHERE ambulatorio_id = $1', [params.ambulatorioId]);

    for (const win of params.windows) {
      await client.query(
        `INSERT INTO org.ambulatorio_operating_window(
          ambulatorio_id,
          weekday,
          start_time,
          end_time,
          max_patients_per_day
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          params.ambulatorioId,
          win.weekday,
          win.start_time,
          win.end_time,
          win.max_patients_per_day
        ]
      );
    }
  });
}
