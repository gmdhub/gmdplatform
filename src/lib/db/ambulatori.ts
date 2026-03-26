// GMD Medical Platform - Ambulatori Database Operations
import { insertReturningId } from './client';
import { isApiDataProvider } from './config';
import { initDatabase } from './schema';
import {
  getAllAmbulatoriFromApi,
  getAmbulatorioByIdFromApi,
  getAmbulatorioOperatingSettingsByIdFromApi,
  getAmbulatorioOperatingWindowsByIdFromApi,
  updateAmbulatorioFromApi,
  updateAmbulatorioOperatingSettingsFromApi
} from '$lib/services/ambulatori-service';
import type {
  Ambulatorio,
  AmbulatorioOperatingSettings,
  AmbulatorioOperatingWindow,
  GiornoSettimana,
  UpsertAmbulatorioOperatingWindowInput
} from './types';

const MIN_ALLOWED_VISIT_DURATION_MINUTES = 10;
const DEFAULT_STANDARD_VISIT_DURATION_MINUTES = 15;
const DEFAULT_MAX_PATIENTS_PER_DAY = 25;

function normalizeWeekdayForWrite(value: number | string): GiornoSettimana {
  const normalizedValue = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(normalizedValue) || normalizedValue < 1 || normalizedValue > 7) {
    throw new Error(`Giorno settimana non valido: ${value}`);
  }

  return normalizedValue as GiornoSettimana;
}

function normalizeTimeForWrite(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Orario non valido: ${value}`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new Error(`Orario non valido: ${value}`);
  }

  return `${match[1]}:${match[2]}`;
}

function compareTimes(left: string, right: string): number {
  return left.localeCompare(right);
}

function normalizeMinVisitDuration(value: number | string): number {
  const normalizedValue = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(normalizedValue) || normalizedValue < MIN_ALLOWED_VISIT_DURATION_MINUTES) {
    throw new Error(
      `Durata minima visita non valida: ${value}. Minimo consentito: ${MIN_ALLOWED_VISIT_DURATION_MINUTES}`
    );
  }

  return normalizedValue;
}

function normalizeStandardVisitDuration(
  value: number | string,
  minDurationMinutes: number
): number {
  const normalizedValue = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(normalizedValue) || normalizedValue < MIN_ALLOWED_VISIT_DURATION_MINUTES) {
    throw new Error(
      `Durata standard visita non valida: ${value}. Minimo consentito: ${MIN_ALLOWED_VISIT_DURATION_MINUTES}`
    );
  }

  if (normalizedValue < minDurationMinutes) {
    throw new Error(
      `Durata standard visita non valida: ${value}. Deve essere maggiore o uguale alla durata minima (${minDurationMinutes}).`
    );
  }

  return normalizedValue;
}

function normalizeStandardVisitDurationForRead(
  value: number | null | undefined,
  minDurationMinutes: number
): number {
  const parsedValue = Number(value);
  const fallback = Math.max(DEFAULT_STANDARD_VISIT_DURATION_MINUTES, minDurationMinutes);
  if (!Number.isInteger(parsedValue) || parsedValue < MIN_ALLOWED_VISIT_DURATION_MINUTES) {
    return fallback;
  }

  return Math.max(parsedValue, minDurationMinutes);
}

function normalizeOperatingWindowInput(
  input: UpsertAmbulatorioOperatingWindowInput
): UpsertAmbulatorioOperatingWindowInput {
  const weekday = normalizeWeekdayForWrite(input.weekday);
  const oraInizio = normalizeTimeForWrite(input.ora_inizio);
  const oraFine = normalizeTimeForWrite(input.ora_fine);
  const maxPazientiGiorno = normalizeMaxPatientsPerDay(input.max_pazienti_giorno);

  if (compareTimes(oraInizio, oraFine) >= 0) {
    throw new Error(`Intervallo orario non valido (${oraInizio}-${oraFine}): l'ora fine deve essere successiva all'ora inizio`);
  }

  return {
    weekday,
    ora_inizio: oraInizio,
    ora_fine: oraFine,
    max_pazienti_giorno: maxPazientiGiorno
  };
}

function validateWindowsNoDuplicates(windows: UpsertAmbulatorioOperatingWindowInput[]): void {
  const keys = new Set<string>();
  for (const window of windows) {
    const key = `${window.weekday}|${window.ora_inizio}|${window.ora_fine}`;
    if (keys.has(key)) {
      throw new Error(`Intervallo duplicato non consentito: giorno ${window.weekday}, ${window.ora_inizio}-${window.ora_fine}`);
    }
    keys.add(key);
  }
}

function normalizeMaxPatientsPerDay(value: number | string): number {
  const normalizedValue = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(normalizedValue) || normalizedValue < 1) {
    throw new Error(`Numero massimo pazienti non valido: ${value}. Minimo consentito: 1`);
  }

  return normalizedValue;
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

export async function getAllAmbulatori(): Promise<Ambulatorio[]> {
  if (isApiDataProvider()) {
    return getAllAmbulatoriFromApi();
  }

  const db = await initDatabase();
  return db.select<Ambulatorio[]>(
    'SELECT * FROM ambulatori ORDER BY nome'
  );
}

export async function getAmbulatorioById(id: number): Promise<Ambulatorio | null> {
  if (isApiDataProvider()) {
    return getAmbulatorioByIdFromApi(id);
  }

  const db = await initDatabase();
  const result = await db.select<Ambulatorio[]>(
    'SELECT * FROM ambulatori WHERE id = ?',
    [normalizeIntegerForWrite(id)]
  );
  return result[0] || null;
}

export async function createAmbulatorio(
  nome: string,
  logoPath: string | null,
  colorPrimary: string,
  colorSecondary: string,
  colorAccent: string
): Promise<number> {
  if (isApiDataProvider()) {
    throw new Error('Creazione ambulatorio non ancora supportata in modalità API');
  }

  return insertReturningId(
    `INSERT INTO ambulatori (nome, logo_path, color_primary, color_secondary, color_accent)
     VALUES (?, ?, ?, ?, ?)`,
    [nome, logoPath, colorPrimary, colorSecondary, colorAccent]
  );
}

export async function updateAmbulatorio(
  id: number,
  nome?: string,
  logoPath?: string | null,
  colorPrimary?: string,
  colorSecondary?: string,
  colorAccent?: string,
  indirizzo?: string,
  telefono?: string,
  email?: string
): Promise<void> {
  if (isApiDataProvider()) {
    await updateAmbulatorioFromApi(id, {
      nome,
      logo_path: logoPath,
      color_primary: colorPrimary,
      color_secondary: colorSecondary,
      color_accent: colorAccent
    });
    return;
  }

  const db = await initDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (nome !== undefined) {
    values.push(nome);
    fields.push('nome = ?');
  }
  if (logoPath !== undefined) {
    values.push(logoPath);
    fields.push('logo_path = ?');
  }
  if (colorPrimary !== undefined) {
    values.push(colorPrimary);
    fields.push('color_primary = ?');
  }
  if (colorSecondary !== undefined) {
    values.push(colorSecondary);
    fields.push('color_secondary = ?');
  }
  if (colorAccent !== undefined) {
    values.push(colorAccent);
    fields.push('color_accent = ?');
  }
  if (indirizzo !== undefined) {
    values.push(indirizzo);
    fields.push('indirizzo = ?');
  }
  if (telefono !== undefined) {
    values.push(telefono);
    fields.push('telefono = ?');
  }
  if (email !== undefined) {
    values.push(email);
    fields.push('email = ?');
  }

  if (fields.length === 0) {
    return;
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(normalizeIntegerForWrite(id));

  await db.execute(
    `UPDATE ambulatori SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function getAmbulatorioOperatingWindowsById(
  ambulatorioId: number
): Promise<AmbulatorioOperatingWindow[]> {
  if (isApiDataProvider()) {
    return getAmbulatorioOperatingWindowsByIdFromApi(ambulatorioId);
  }

  const db = await initDatabase();
  return db.select<AmbulatorioOperatingWindow[]>(
    `SELECT *
     FROM ambulatorio_orari
     WHERE ambulatorio_id = ?
     ORDER BY weekday ASC, ora_inizio ASC, id ASC`,
    [normalizeIntegerForWrite(ambulatorioId)]
  );
}

export async function getAmbulatorioOperatingSettingsById(
  ambulatorioId: number
): Promise<AmbulatorioOperatingSettings> {
  if (isApiDataProvider()) {
    return getAmbulatorioOperatingSettingsByIdFromApi(ambulatorioId);
  }

  const ambulatorio = await getAmbulatorioById(ambulatorioId);
  if (!ambulatorio) {
    throw new Error(`Ambulatorio ${ambulatorioId} non trovato`);
  }

  const windows = await getAmbulatorioOperatingWindowsById(ambulatorioId);
  const normalizedWindows = windows.map((window) => ({
    ...window,
    max_pazienti_giorno: normalizeMaxPatientsPerDay(window.max_pazienti_giorno ?? DEFAULT_MAX_PATIENTS_PER_DAY)
  }));
  const durataMinimaVisitaMinuti = normalizeMinVisitDuration(
    ambulatorio.durata_minima_visita_minuti ?? MIN_ALLOWED_VISIT_DURATION_MINUTES
  );
  return {
    ambulatorioId,
    durataMinimaVisitaMinuti,
    durataStandardVisitaMinuti: normalizeStandardVisitDurationForRead(
      ambulatorio.durata_standard_visita_minuti,
      durataMinimaVisitaMinuti
    ),
    windows: normalizedWindows
  };
}

export async function updateAmbulatorioOperatingSettings(input: {
  ambulatorioId: number;
  durataMinimaVisitaMinuti: number;
  durataStandardVisitaMinuti: number;
  windows: UpsertAmbulatorioOperatingWindowInput[];
}): Promise<void> {
  if (isApiDataProvider()) {
    await updateAmbulatorioOperatingSettingsFromApi(input);
    return;
  }

  const ambulatorioId = normalizeIntegerForWrite(input.ambulatorioId);
  const durataMinimaVisitaMinuti = normalizeMinVisitDuration(input.durataMinimaVisitaMinuti);
  const durataStandardVisitaMinuti = normalizeStandardVisitDuration(
    input.durataStandardVisitaMinuti,
    durataMinimaVisitaMinuti
  );
  const normalizedWindows = input.windows.map((window) => normalizeOperatingWindowInput(window));
  validateWindowsNoDuplicates(normalizedWindows);

  const db = await initDatabase();
  await db.execute('BEGIN');

  try {
    await db.execute(
      `UPDATE ambulatori
       SET
         durata_minima_visita_minuti = ?,
         durata_standard_visita_minuti = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [durataMinimaVisitaMinuti, durataStandardVisitaMinuti, ambulatorioId]
    );

    await db.execute('DELETE FROM ambulatorio_orari WHERE ambulatorio_id = ?', [ambulatorioId]);

    for (const window of normalizedWindows) {
      await db.execute(
        `INSERT INTO ambulatorio_orari (
          ambulatorio_id,
          weekday,
          ora_inizio,
          ora_fine,
          max_pazienti_giorno
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          ambulatorioId,
          window.weekday,
          window.ora_inizio,
          window.ora_fine,
          window.max_pazienti_giorno
        ]
      );
    }

    await db.execute('COMMIT');
  } catch (error) {
    try {
      await db.execute('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw error;
  }
}

export async function deleteAmbulatorio(id: number): Promise<void> {
  if (isApiDataProvider()) {
    throw new Error('Eliminazione ambulatorio non supportata in modalità API');
  }

  const db = await initDatabase();
  await db.execute('DELETE FROM ambulatori WHERE id = ?', [
    normalizeIntegerForWrite(id)
  ]);
}
