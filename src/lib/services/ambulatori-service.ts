import type {
  Ambulatorio,
  AmbulatorioOperatingSettings,
  AmbulatorioOperatingWindow,
  UpsertAmbulatorioOperatingWindowInput
} from '$lib/db/types';
import { apiGet, apiPut } from './http-client';

function normalizeTimeForUi(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    return '';
  }

  return `${match[1]}:${match[2]}`;
}

function mapAmbulatorio(row: Record<string, unknown>): Ambulatorio {
  return {
    id: Number(row.id ?? 0),
    nome: String(row.nome ?? row.name ?? ''),
    logo_path: row.logo_path ? String(row.logo_path) : null,
    color_primary: String(row.color_primary ?? '#1e3a8a'),
    color_secondary: String(row.color_secondary ?? '#3b82f6'),
    color_accent: String(row.color_accent ?? '#22d3ee'),
    indirizzo: row.indirizzo ? String(row.indirizzo) : '',
    telefono: row.telefono ? String(row.telefono) : '',
    email: row.email ? String(row.email) : '',
    durata_minima_visita_minuti: Number(row.durata_minima_visita_minuti ?? row.min_visit_minutes),
    durata_standard_visita_minuti: Number(
      row.durata_standard_visita_minuti ?? row.standard_visit_minutes
    ),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString())
  };
}

function mapOperatingWindow(row: Record<string, unknown>): AmbulatorioOperatingWindow {
  return {
    id: Number(row.id ?? 0),
    ambulatorio_id: Number(row.ambulatorio_id ?? 0),
    weekday: Number(row.weekday ?? 1) as AmbulatorioOperatingWindow['weekday'],
    ora_inizio: normalizeTimeForUi(row.ora_inizio ?? row.start_time),
    ora_fine: normalizeTimeForUi(row.ora_fine ?? row.end_time),
    max_pazienti_giorno: Number(row.max_pazienti_giorno ?? row.max_patients_per_day ?? 25),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString())
  };
}

export async function getAllAmbulatoriFromApi(): Promise<Ambulatorio[]> {
  const rows = await apiGet<Array<Record<string, unknown>>>('/ambulatori');
  return rows.map((row) => mapAmbulatorio(row));
}

export async function getAmbulatorioByIdFromApi(id: number): Promise<Ambulatorio | null> {
  const row = await apiGet<Record<string, unknown> | null>(`/ambulatori/${id}`);
  if (!row) {
    return null;
  }

  return mapAmbulatorio(row);
}

export async function getAmbulatorioOperatingWindowsByIdFromApi(
  ambulatorioId: number
): Promise<AmbulatorioOperatingWindow[]> {
  const row = await apiGet<Record<string, unknown> | null>(`/ambulatori/${ambulatorioId}`);
  const windowsRaw = Array.isArray(row?.windows) ? (row.windows as Record<string, unknown>[]) : [];
  return windowsRaw.map((entry) => mapOperatingWindow(entry));
}

export async function getAmbulatorioOperatingSettingsByIdFromApi(
  ambulatorioId: number
): Promise<AmbulatorioOperatingSettings> {
  const row = await apiGet<Record<string, unknown> | null>(`/ambulatori/${ambulatorioId}`);
  if (!row) {
    throw new Error(`Ambulatorio ${ambulatorioId} non trovato`);
  }

  const windowsRaw = Array.isArray(row.windows) ? (row.windows as Record<string, unknown>[]) : [];
  return {
    ambulatorioId,
    durataMinimaVisitaMinuti: Number(row.min_visit_minutes ?? row.durata_minima_visita_minuti),
    durataStandardVisitaMinuti: Number(
      row.standard_visit_minutes ?? row.durata_standard_visita_minuti
    ),
    windows: windowsRaw.map((entry) => mapOperatingWindow(entry))
  };
}

export async function updateAmbulatorioFromApi(
  id: number,
  input: {
    nome?: string;
    logo_path?: string | null;
    color_primary?: string;
    color_secondary?: string;
    color_accent?: string;
  }
): Promise<void> {
  await apiPut<void>(`/ambulatori/${id}`, input);
}

export async function updateAmbulatorioOperatingSettingsFromApi(input: {
  ambulatorioId: number;
  durataMinimaVisitaMinuti: number;
  durataStandardVisitaMinuti: number;
  windows: UpsertAmbulatorioOperatingWindowInput[];
}): Promise<void> {
  await apiPut<void>(`/ambulatori/${input.ambulatorioId}/settings`, {
    min_visit_minutes: input.durataMinimaVisitaMinuti,
    standard_visit_minutes: input.durataStandardVisitaMinuti,
    timezone: 'Europe/Rome'
  });

  await apiPut<void>(`/ambulatori/${input.ambulatorioId}/orari`, {
    windows: input.windows.map((window) => ({
      weekday: window.weekday,
      start_time: window.ora_inizio,
      end_time: window.ora_fine,
      max_patients_per_day: window.max_pazienti_giorno
    }))
  });
}
