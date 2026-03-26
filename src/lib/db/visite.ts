// GMD Medical Platform - Visite Database Functions
import { insertReturningId } from './client';
import { isApiDataProvider } from './config';
import { initDatabase } from './schema';
import {
  getVisitaEditDeleteLockedMessage,
  getVisitaPreviousVersionLockedMessage,
  isVisitaWithinEditDeleteWindow
} from '../utils/visite-permissions';
import {
  createVisitaFromApi,
  deleteVisitaFromApi,
  getVisitaByIdFromApi,
  listVisiteFromApi,
  updateVisitaFromApi
} from '$lib/services/visite-service';
import type {
  CreateVisitaInput,
  EsameEmaticoKey,
  PreviousEsamiEmaticiMap,
  UpdateVisitaInput,
  Visita
} from './types';

const esameEmaticoKeys: EsameEmaticoKey[] = [
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
];

interface ParsedEsamiHistoryRow {
  values: Record<EsameEmaticoKey, string>;
  examDate: string;
  examDateComparable: string | null;
}

function normalizeExamDateForComparison(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (match) {
    const year = match[1];
    const month = match[2];
    const day = match[3];
    const hour = match[4] ?? '00';
    const minute = match[5] ?? '00';
    const second = match[6] ?? '00';
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  const hh = String(parsed.getHours()).padStart(2, '0');
  const mi = String(parsed.getMinutes()).padStart(2, '0');
  const ss = String(parsed.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

function parseEsamiForHistory(
  raw: string | null | undefined,
  fallbackVisitDate: string
): ParsedEsamiHistoryRow {
  const values = Object.fromEntries(esameEmaticoKeys.map((key) => [key, ''])) as Record<EsameEmaticoKey, string>;
  const fallbackDate = typeof fallbackVisitDate === 'string' ? fallbackVisitDate.trim() : '';
  let examDate = fallbackDate;

  if (!raw) {
    return {
      values,
      examDate,
      examDateComparable: normalizeExamDateForComparison(examDate)
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<EsameEmaticoKey | 'data_ee', unknown>>;
    for (const key of esameEmaticoKeys) {
      const value = parsed[key];
      values[key] = typeof value === 'string' ? value.trim() : '';
    }
    const dataEe = parsed.data_ee;
    if (typeof dataEe === 'string' && dataEe.trim()) {
      examDate = dataEe.trim();
    }
  } catch {
    return {
      values,
      examDate,
      examDateComparable: normalizeExamDateForComparison(examDate)
    };
  }

  return {
    values,
    examDate,
    examDateComparable: normalizeExamDateForComparison(examDate)
  };
}

function normalizeIntegerForWrite(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(normalized)) {
    throw new Error(`Valore intero non valido: ${value}`);
  }

  return normalized;
}

function coerceText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function normalizeTextForWrite(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = coerceText(value);
  return normalized === '' ? null : normalized;
}

function normalizeRequiredTextForWrite(value: unknown): string {
  return coerceText(value);
}

function normalizeRealForWrite(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }

  return value;
}

function pushField(fields: string[], values: unknown[], column: string, value: unknown) {
  values.push(value);
  fields.push(`${column} = ?`);
}

type VisitaMutationState = {
  data_visita: string;
  is_current_version: number | null;
};

async function getVisitaMutationState(id: number): Promise<VisitaMutationState | null> {
  const db = await initDatabase();
  const rows = await db.select<VisitaMutationState[]>(
    'SELECT data_visita, is_current_version FROM visite WHERE id = ? LIMIT 1',
    [normalizeIntegerForWrite(id)]
  );
  return rows[0] ?? null;
}

async function assertVisitaEditableOrDeletable(id: number): Promise<void> {
  const visitaState = await getVisitaMutationState(id);
  if (!visitaState) {
    throw new Error('Visita non trovata.');
  }

  if (visitaState.is_current_version === 0) {
    throw new Error(getVisitaPreviousVersionLockedMessage());
  }

  if (!isVisitaWithinEditDeleteWindow(visitaState.data_visita)) {
    throw new Error(getVisitaEditDeleteLockedMessage());
  }
}

function getCurrentOnlyWhereClause(currentOnly?: boolean): string {
  return currentOnly ? ' AND COALESCE(v.is_current_version, 1) = 1' : '';
}

export async function getAllVisite(): Promise<Visita[]> {
  if (isApiDataProvider()) {
    return listVisiteFromApi();
  }

  const db = await initDatabase();
  return db.select<Visita[]>(`
    SELECT
      v.*,
      p.nome as paziente_nome,
      p.cognome as paziente_cognome,
      p.codice_fiscale as paziente_codice_fiscale,
      u.nome as medico_nome,
      u.cognome as medico_cognome
    FROM visite v
    INNER JOIN pazienti p ON v.paziente_id = p.id
    INNER JOIN users u ON v.medico_id = u.id
    ORDER BY v.data_visita DESC, v.created_at DESC
  `);
}

export async function getVisiteByAmbulatorio(
  ambulatorioId: number,
  options?: { currentOnly?: boolean }
): Promise<Visita[]> {
  if (isApiDataProvider()) {
    return listVisiteFromApi({
      ambulatorio_id: ambulatorioId,
      current_only: options?.currentOnly
    });
  }

  const db = await initDatabase();
  return db.select<Visita[]>(
    `SELECT
      v.*,
      p.nome as paziente_nome,
      p.cognome as paziente_cognome,
      p.codice_fiscale as paziente_codice_fiscale,
      u.nome as medico_nome,
      u.cognome as medico_cognome
    FROM visite v
    INNER JOIN pazienti p ON v.paziente_id = p.id
    INNER JOIN users u ON v.medico_id = u.id
    WHERE v.ambulatorio_id = ?
    ${getCurrentOnlyWhereClause(options?.currentOnly)}
    ORDER BY v.data_visita DESC, v.created_at DESC`,
    [normalizeIntegerForWrite(ambulatorioId)]
  );
}

export async function getCurrentVisiteByAmbulatorio(ambulatorioId: number): Promise<Visita[]> {
  return getVisiteByAmbulatorio(ambulatorioId, { currentOnly: true });
}

export async function getVisiteByPaziente(
  pazienteId: number,
  options?: { currentOnly?: boolean }
): Promise<Visita[]> {
  if (isApiDataProvider()) {
    return listVisiteFromApi({
      paziente_id: pazienteId,
      current_only: options?.currentOnly
    });
  }

  const db = await initDatabase();
  return db.select<Visita[]>(
    `SELECT
      v.*,
      p.nome as paziente_nome,
      p.cognome as paziente_cognome,
      p.codice_fiscale as paziente_codice_fiscale,
      u.nome as medico_nome,
      u.cognome as medico_cognome
    FROM visite v
    INNER JOIN pazienti p ON v.paziente_id = p.id
    INNER JOIN users u ON v.medico_id = u.id
    WHERE v.paziente_id = ?
    ${getCurrentOnlyWhereClause(options?.currentOnly)}
    ORDER BY v.data_visita DESC, v.created_at DESC`,
    [normalizeIntegerForWrite(pazienteId)]
  );
}

export async function getCurrentVisiteByPaziente(pazienteId: number): Promise<Visita[]> {
  return getVisiteByPaziente(pazienteId, { currentOnly: true });
}

export async function searchVisite(
  query: string,
  ambulatorioId?: number,
  options?: { currentOnly?: boolean }
): Promise<Visita[]> {
  if (isApiDataProvider()) {
    return listVisiteFromApi({
      ambulatorio_id: ambulatorioId,
      search: query,
      current_only: options?.currentOnly
    });
  }

  const db = await initDatabase();
  const searchTerm = `%${query}%`;

  let sql = `
    SELECT
      v.*,
      p.nome as paziente_nome,
      p.cognome as paziente_cognome,
      p.codice_fiscale as paziente_codice_fiscale,
      u.nome as medico_nome,
      u.cognome as medico_cognome
    FROM visite v
    INNER JOIN pazienti p ON v.paziente_id = p.id
    INNER JOIN users u ON v.medico_id = u.id
    WHERE (
      LOWER(p.nome) LIKE LOWER(?) OR
      LOWER(p.cognome) LIKE LOWER(?) OR
      LOWER(p.codice_fiscale) LIKE LOWER(?) OR
      LOWER(v.motivo) LIKE LOWER(?) OR
      LOWER(COALESCE(v.diagnosi, '')) LIKE LOWER(?)
    )
  `;

  const params: unknown[] = [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm];

  if (ambulatorioId !== undefined) {
    params.push(normalizeIntegerForWrite(ambulatorioId));
    sql += ' AND v.ambulatorio_id = ?';
  }
  if (options?.currentOnly) {
    sql += ' AND COALESCE(v.is_current_version, 1) = 1';
  }

  sql += ' ORDER BY v.data_visita DESC, v.created_at DESC';

  return db.select<Visita[]>(sql, params);
}

export async function getVisitaById(id: number): Promise<Visita | null> {
  if (isApiDataProvider()) {
    return getVisitaByIdFromApi(id);
  }

  const db = await initDatabase();
  const visite = await db.select<Visita[]>(
    `SELECT
      v.*,
      p.nome as paziente_nome,
      p.cognome as paziente_cognome,
      p.codice_fiscale as paziente_codice_fiscale,
      u.nome as medico_nome,
      u.cognome as medico_cognome
    FROM visite v
    INNER JOIN pazienti p ON v.paziente_id = p.id
    INNER JOIN users u ON v.medico_id = u.id
    WHERE v.id = ?`,
    [normalizeIntegerForWrite(id)]
  );
  return visite.length > 0 ? visite[0] : null;
}

export async function getPreviousEsamiEmaticiByPaziente(params: {
  pazienteId: number;
  beforeDate: string;
  excludeVisitaId?: number;
}): Promise<PreviousEsamiEmaticiMap> {
  let rows: Array<{ id: number; data_visita: string; esami_ematici: string | null }>;
  if (isApiDataProvider()) {
    const visits = await listVisiteFromApi({
      paziente_id: params.pazienteId,
      current_only: true
    });

    rows = visits
      .filter((visit) => {
        if (params.excludeVisitaId !== undefined && visit.id === params.excludeVisitaId) {
          return false;
        }
        const raw = visit.esami_ematici ?? '';
        return typeof raw === 'string' && raw.trim() !== '';
      })
      .map((visit) => ({
        id: visit.id,
        data_visita: visit.data_visita,
        esami_ematici: visit.esami_ematici ?? null
      }));
  } else {
    const db = await initDatabase();
    const queryParams: unknown[] = [normalizeIntegerForWrite(params.pazienteId)];
    let sql = `
      SELECT id, data_visita, esami_ematici
      FROM visite
      WHERE paziente_id = ?
        AND COALESCE(is_current_version, 1) = 1
        AND esami_ematici IS NOT NULL
        AND TRIM(esami_ematici) <> ''
    `;

    if (params.excludeVisitaId !== undefined) {
      queryParams.push(normalizeIntegerForWrite(params.excludeVisitaId));
      sql += ' AND id != ?';
    }

    sql += ' ORDER BY id DESC';

    rows = await db.select<Array<{ id: number; data_visita: string; esami_ematici: string | null }>>(
      sql,
      queryParams
    );
  }

  const normalizedBeforeDate = normalizeExamDateForComparison(params.beforeDate);
  const isDateOnlyFilter = /^\d{4}-\d{2}-\d{2}$/.test(params.beforeDate.trim());
  const includeSameDateTime = params.excludeVisitaId !== undefined;

  const orderedRows = rows
    .map((row) => {
      const parsed = parseEsamiForHistory(row.esami_ematici, row.data_visita);
      const comparableDate = parsed.examDateComparable || normalizeExamDateForComparison(row.data_visita);
      const timestamp = comparableDate ? new Date(comparableDate).getTime() : Number.NaN;
      return {
        ...row,
        parsed,
        comparableDate,
        timestamp
      };
    })
    .filter((row) => {
      if (!row.comparableDate) {
        return false;
      }

      if (!normalizedBeforeDate) {
        return true;
      }

      if (isDateOnlyFilter) {
        return row.comparableDate.slice(0, 10) <= normalizedBeforeDate.slice(0, 10);
      }

      const beforeTimestamp = new Date(normalizedBeforeDate).getTime();
      if (!Number.isFinite(beforeTimestamp) || !Number.isFinite(row.timestamp)) {
        return false;
      }

      return includeSameDateTime ? row.timestamp <= beforeTimestamp : row.timestamp < beforeTimestamp;
    })
    .sort((left, right) => {
      const leftTs = Number.isFinite(left.timestamp) ? left.timestamp : Number.NEGATIVE_INFINITY;
      const rightTs = Number.isFinite(right.timestamp) ? right.timestamp : Number.NEGATIVE_INFINITY;
      if (leftTs !== rightTs) {
        return rightTs - leftTs;
      }
      return right.id - left.id;
    });

  const result: PreviousEsamiEmaticiMap = {};
  const remainingKeys = new Set(esameEmaticoKeys);

  for (const row of orderedRows) {
    const parsedValues = row.parsed.values;
    const referenceDate = row.parsed.examDate || row.data_visita;

    for (const key of esameEmaticoKeys) {
      if (!remainingKeys.has(key)) {
        continue;
      }

      const value = parsedValues[key];
      if (!value) {
        continue;
      }

      result[key] = {
        value,
        date: referenceDate
      };
      remainingKeys.delete(key);
    }

    if (remainingKeys.size === 0) {
      break;
    }
  }

  return result;
}

export async function createVisita(input: CreateVisitaInput): Promise<number> {
  if (isApiDataProvider()) {
    return createVisitaFromApi(input);
  }

  await initDatabase();

  return insertReturningId(
    `INSERT INTO visite (
      ambulatorio_id, paziente_id, medico_id, previous_version_id, is_current_version, data_visita, tipo_visita,
      motivo, altezza, peso, bmi, bsa, anamnesi_cardiologica, anamnesi_internistica, terapia_domiciliare, valutazione_odierna, esami_ematici, ecocardiografia, fh_assessment, terapia_ipolipemizzante, valutazione_rischio_cv, firme_visita, pianificazione_followup, conclusioni, anamnesi, esame_obiettivo, diagnosi, terapia, note
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )`,
    [
      normalizeIntegerForWrite(input.ambulatorio_id),
      normalizeIntegerForWrite(input.paziente_id),
      normalizeIntegerForWrite(input.medico_id),
      normalizeIntegerForWrite(input.previous_version_id),
      normalizeIntegerForWrite(input.is_current_version ?? 1),
      input.data_visita,
      normalizeRequiredTextForWrite(input.tipo_visita),
      normalizeRequiredTextForWrite(input.motivo),
      normalizeRealForWrite(input.altezza),
      normalizeRealForWrite(input.peso),
      normalizeRealForWrite(input.bmi),
      normalizeRealForWrite(input.bsa),
      normalizeTextForWrite(input.anamnesi_cardiologica),
      normalizeTextForWrite(input.anamnesi_internistica),
      normalizeTextForWrite(input.terapia_domiciliare),
      normalizeTextForWrite(input.valutazione_odierna),
      normalizeTextForWrite(input.esami_ematici),
      normalizeTextForWrite(input.ecocardiografia),
      normalizeTextForWrite(input.fh_assessment),
      normalizeTextForWrite(input.terapia_ipolipemizzante),
      normalizeTextForWrite(input.valutazione_rischio_cv),
      normalizeTextForWrite(input.firme_visita),
      normalizeTextForWrite(input.pianificazione_followup),
      normalizeTextForWrite(input.conclusioni),
      normalizeTextForWrite(input.anamnesi),
      normalizeTextForWrite(input.esame_obiettivo),
      normalizeTextForWrite(input.diagnosi),
      normalizeTextForWrite(input.terapia),
      normalizeTextForWrite(input.note)
    ]
  );
}

export async function updateVisita(input: UpdateVisitaInput): Promise<void> {
  if (isApiDataProvider()) {
    await updateVisitaFromApi(input);
    return;
  }

  const db = await initDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  await assertVisitaEditableOrDeletable(input.id);

  if (input.previous_version_id !== undefined) {
    pushField(fields, values, 'previous_version_id', normalizeIntegerForWrite(input.previous_version_id));
  }
  if (input.is_current_version !== undefined) {
    pushField(fields, values, 'is_current_version', normalizeIntegerForWrite(input.is_current_version));
  }
  if (input.paziente_id !== undefined) {
    pushField(fields, values, 'paziente_id', normalizeIntegerForWrite(input.paziente_id));
  }
  if (input.medico_id !== undefined) {
    pushField(fields, values, 'medico_id', normalizeIntegerForWrite(input.medico_id));
  }
  if (input.data_visita !== undefined) {
    pushField(fields, values, 'data_visita', input.data_visita);
  }
  if (input.tipo_visita !== undefined) {
    pushField(fields, values, 'tipo_visita', normalizeRequiredTextForWrite(input.tipo_visita));
  }
  if (input.motivo !== undefined) {
    pushField(fields, values, 'motivo', normalizeRequiredTextForWrite(input.motivo));
  }
  if (input.altezza !== undefined) {
    pushField(fields, values, 'altezza', normalizeRealForWrite(input.altezza ?? null));
  }
  if (input.peso !== undefined) {
    pushField(fields, values, 'peso', normalizeRealForWrite(input.peso ?? null));
  }
  if (input.bmi !== undefined) {
    pushField(fields, values, 'bmi', normalizeRealForWrite(input.bmi ?? null));
  }
  if (input.bsa !== undefined) {
    pushField(fields, values, 'bsa', normalizeRealForWrite(input.bsa ?? null));
  }
  if (input.anamnesi_cardiologica !== undefined) {
    pushField(fields, values, 'anamnesi_cardiologica', normalizeTextForWrite(input.anamnesi_cardiologica));
  }
  if (input.anamnesi_internistica !== undefined) {
    pushField(fields, values, 'anamnesi_internistica', normalizeTextForWrite(input.anamnesi_internistica));
  }
  if (input.terapia_domiciliare !== undefined) {
    pushField(fields, values, 'terapia_domiciliare', normalizeTextForWrite(input.terapia_domiciliare));
  }
  if (input.valutazione_odierna !== undefined) {
    pushField(fields, values, 'valutazione_odierna', normalizeTextForWrite(input.valutazione_odierna));
  }
  if (input.esami_ematici !== undefined) {
    pushField(fields, values, 'esami_ematici', normalizeTextForWrite(input.esami_ematici));
  }
  if (input.ecocardiografia !== undefined) {
    pushField(fields, values, 'ecocardiografia', normalizeTextForWrite(input.ecocardiografia));
  }
  if (input.fh_assessment !== undefined) {
    pushField(fields, values, 'fh_assessment', normalizeTextForWrite(input.fh_assessment));
  }
  if (input.terapia_ipolipemizzante !== undefined) {
    pushField(fields, values, 'terapia_ipolipemizzante', normalizeTextForWrite(input.terapia_ipolipemizzante));
  }
  if (input.valutazione_rischio_cv !== undefined) {
    pushField(fields, values, 'valutazione_rischio_cv', normalizeTextForWrite(input.valutazione_rischio_cv));
  }
  if (input.firme_visita !== undefined) {
    pushField(fields, values, 'firme_visita', normalizeTextForWrite(input.firme_visita));
  }
  if (input.pianificazione_followup !== undefined) {
    pushField(fields, values, 'pianificazione_followup', normalizeTextForWrite(input.pianificazione_followup));
  }
  if (input.conclusioni !== undefined) {
    pushField(fields, values, 'conclusioni', normalizeTextForWrite(input.conclusioni));
  }
  if (input.anamnesi !== undefined) {
    pushField(fields, values, 'anamnesi', normalizeTextForWrite(input.anamnesi));
  }
  if (input.esame_obiettivo !== undefined) {
    pushField(fields, values, 'esame_obiettivo', normalizeTextForWrite(input.esame_obiettivo));
  }
  if (input.diagnosi !== undefined) {
    pushField(fields, values, 'diagnosi', normalizeTextForWrite(input.diagnosi));
  }
  if (input.terapia !== undefined) {
    pushField(fields, values, 'terapia', normalizeTextForWrite(input.terapia));
  }
  if (input.note !== undefined) {
    pushField(fields, values, 'note', normalizeTextForWrite(input.note));
  }

  if (fields.length === 0) {
    return;
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(normalizeIntegerForWrite(input.id));

  await db.execute(
    `UPDATE visite SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deleteVisita(id: number): Promise<void> {
  if (isApiDataProvider()) {
    await deleteVisitaFromApi(id);
    return;
  }

  await assertVisitaEditableOrDeletable(id);
  const db = await initDatabase();
  await db.execute('DELETE FROM visite WHERE id = ?', [normalizeIntegerForWrite(id)]);
}
