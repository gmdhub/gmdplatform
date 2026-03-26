import { insertReturningId } from './client';
import { isApiDataProvider } from './config';
import { initDatabase } from './schema';
import {
  createFattoriRischioCVFromApi,
  deleteFattoriRischioCVByVisitaIdFromApi,
  deleteFattoriRischioCVFromApi,
  getFattoriRischioCVByVisitaIdFromApi,
  getFattoriRischioCVByVisitaIdsFromApi,
  updateFattoriRischioCVFromApi
} from '$lib/services/fattori-rischio-cv-service';
import type {
  CreateFattoriRischioCVInput,
  FattoriRischioCV,
  UpdateFattoriRischioCVInput
} from './types';

type Booleanish = boolean | number | string | null | undefined;

function normalizeBoolean(value: Booleanish): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 't';
  }

  return false;
}

function normalizeBooleanForWrite(value: Booleanish): 1 | 0 {
  return normalizeBoolean(value) ? 1 : 0;
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

function pushField(fields: string[], values: unknown[], column: string, value: unknown) {
  values.push(value);
  fields.push(`${column} = ?`);
}

export async function createFattoriRischioCV(
  data: CreateFattoriRischioCVInput
): Promise<number> {
  if (isApiDataProvider()) {
    return createFattoriRischioCVFromApi(data);
  }

  await initDatabase();

  return insertReturningId(
    `INSERT INTO fattori_rischio_cv (
      visita_id,
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizeIntegerForWrite(data.visita_id),
      normalizeBooleanForWrite(data.familiarita),
      normalizeTextForWrite(data.familiarita_note),
      normalizeBooleanForWrite(data.ipertensione),
      normalizeBooleanForWrite(data.diabete),
      normalizeTextForWrite(data.diabete_durata),
      normalizeRequiredTextForWrite(data.diabete_tipo ?? ''),
      normalizeBooleanForWrite(data.dislipidemia),
      normalizeBooleanForWrite(data.obesita),
      normalizeRequiredTextForWrite(data.fumo ?? ''),
      normalizeTextForWrite(data.fumo_ex_eta)
    ]
  );
}

export async function getFattoriRischioCVByVisitaId(
  visitaId: number
): Promise<FattoriRischioCV | null> {
  if (isApiDataProvider()) {
    return getFattoriRischioCVByVisitaIdFromApi(visitaId);
  }

  const db = await initDatabase();

  const rows = await db.select<Array<
    Omit<FattoriRischioCV, 'familiarita' | 'ipertensione' | 'diabete' | 'dislipidemia' | 'obesita'> & {
      familiarita: Booleanish;
      ipertensione: Booleanish;
      diabete: Booleanish;
      dislipidemia: Booleanish;
      obesita: Booleanish;
    }
  >>(
    `SELECT
      id,
      visita_id,
      familiarita,
      familiarita_note,
      ipertensione,
      diabete,
      diabete_durata,
      diabete_tipo,
      dislipidemia,
      obesita,
      fumo,
      fumo_ex_eta,
      created_at,
      updated_at
    FROM fattori_rischio_cv
    WHERE visita_id = ?`,
    [normalizeIntegerForWrite(visitaId)]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    ...row,
    familiarita: normalizeBoolean(row.familiarita),
    ipertensione: normalizeBoolean(row.ipertensione),
    diabete: normalizeBoolean(row.diabete),
    diabete_tipo: row.diabete_tipo || '',
    dislipidemia: normalizeBoolean(row.dislipidemia),
    obesita: normalizeBoolean(row.obesita),
    fumo: row.fumo || ''
  };
}

export async function getFattoriRischioCVByVisitaIds(visitaIds: number[]): Promise<FattoriRischioCV[]> {
  if (isApiDataProvider()) {
    return getFattoriRischioCVByVisitaIdsFromApi(visitaIds);
  }

  if (visitaIds.length === 0) {
    return [];
  }

  const db = await initDatabase();
  const normalizedIds = visitaIds
    .map((visitaId) => normalizeIntegerForWrite(visitaId))
    .filter((visitaId): visitaId is number => visitaId !== null);

  if (normalizedIds.length === 0) {
    return [];
  }

  const placeholders = normalizedIds.map(() => '?').join(', ');
  const rows = await db.select<Array<
    Omit<FattoriRischioCV, 'familiarita' | 'ipertensione' | 'diabete' | 'dislipidemia' | 'obesita'> & {
      familiarita: Booleanish;
      ipertensione: Booleanish;
      diabete: Booleanish;
      dislipidemia: Booleanish;
      obesita: Booleanish;
    }
  >>(
    `SELECT
      id,
      visita_id,
      familiarita,
      familiarita_note,
      ipertensione,
      diabete,
      diabete_durata,
      diabete_tipo,
      dislipidemia,
      obesita,
      fumo,
      fumo_ex_eta,
      created_at,
      updated_at
    FROM fattori_rischio_cv
    WHERE visita_id IN (${placeholders})`,
    normalizedIds
  );

  return rows.map((row) => ({
    ...row,
    familiarita: normalizeBoolean(row.familiarita),
    ipertensione: normalizeBoolean(row.ipertensione),
    diabete: normalizeBoolean(row.diabete),
    diabete_tipo: row.diabete_tipo || '',
    dislipidemia: normalizeBoolean(row.dislipidemia),
    obesita: normalizeBoolean(row.obesita),
    fumo: row.fumo || ''
  }));
}

export async function updateFattoriRischioCV(
  data: UpdateFattoriRischioCVInput
): Promise<void> {
  if (isApiDataProvider()) {
    await updateFattoriRischioCVFromApi(data);
    return;
  }

  const db = await initDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.visita_id !== undefined) {
    pushField(fields, values, 'visita_id', normalizeIntegerForWrite(data.visita_id));
  }
  if (data.familiarita !== undefined) {
    pushField(fields, values, 'familiarita', normalizeBooleanForWrite(data.familiarita));
  }
  if (data.familiarita_note !== undefined) {
    pushField(fields, values, 'familiarita_note', normalizeTextForWrite(data.familiarita_note));
  }
  if (data.ipertensione !== undefined) {
    pushField(fields, values, 'ipertensione', normalizeBooleanForWrite(data.ipertensione));
  }
  if (data.diabete !== undefined) {
    pushField(fields, values, 'diabete', normalizeBooleanForWrite(data.diabete));
  }
  if (data.diabete_durata !== undefined) {
    pushField(fields, values, 'diabete_durata', normalizeTextForWrite(data.diabete_durata));
  }
  if (data.diabete_tipo !== undefined) {
    pushField(fields, values, 'diabete_tipo', normalizeRequiredTextForWrite(data.diabete_tipo ?? ''));
  }
  if (data.dislipidemia !== undefined) {
    pushField(fields, values, 'dislipidemia', normalizeBooleanForWrite(data.dislipidemia));
  }
  if (data.obesita !== undefined) {
    pushField(fields, values, 'obesita', normalizeBooleanForWrite(data.obesita));
  }
  if (data.fumo !== undefined) {
    pushField(fields, values, 'fumo', normalizeRequiredTextForWrite(data.fumo ?? ''));
  }
  if (data.fumo_ex_eta !== undefined) {
    pushField(fields, values, 'fumo_ex_eta', normalizeTextForWrite(data.fumo_ex_eta));
  }

  if (fields.length === 0) {
    return;
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(normalizeIntegerForWrite(data.id));

  await db.execute(
    `UPDATE fattori_rischio_cv
     SET ${fields.join(', ')}
     WHERE id = ?`,
    values
  );
}

export async function deleteFattoriRischioCV(id: number): Promise<void> {
  if (isApiDataProvider()) {
    await deleteFattoriRischioCVFromApi(id);
    return;
  }

  const db = await initDatabase();
  await db.execute('DELETE FROM fattori_rischio_cv WHERE id = ?', [
    normalizeIntegerForWrite(id)
  ]);
}

export async function deleteFattoriRischioCVByVisitaId(visitaId: number): Promise<void> {
  if (isApiDataProvider()) {
    await deleteFattoriRischioCVByVisitaIdFromApi(visitaId);
    return;
  }

  const db = await initDatabase();
  await db.execute('DELETE FROM fattori_rischio_cv WHERE visita_id = ?', [
    normalizeIntegerForWrite(visitaId)
  ]);
}
