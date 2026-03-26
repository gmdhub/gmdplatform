import type {
  Appuntamento,
  CreateAppuntamentoManualeInput,
  DailyAppointmentCount,
  UpdateAppuntamentoInput
} from '$lib/db/types';
import { apiDelete, apiGet, apiPatch, apiPost } from './http-client';

function mapAppuntamento(row: Record<string, unknown>): Appuntamento {
  return {
    id: Number(row.id ?? 0),
    ambulatorio_id: Number(row.ambulatorio_id ?? 0),
    paziente_id: Number(row.paziente_id ?? 0),
    data_ora_inizio: String(row.data_ora_inizio ?? ''),
    data_ora_fine: String(row.data_ora_fine ?? ''),
    durata_minuti: Number(row.durata_minuti ?? 15),
    motivo: row.motivo ? String(row.motivo) : null,
    origine: (row.origine as Appuntamento['origine']) ?? 'manuale',
    source_visita_id:
      row.source_visita_id === null || row.source_visita_id === undefined
        ? null
        : Number(row.source_visita_id),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
    paziente_nome: row.paziente_nome ? String(row.paziente_nome) : '',
    paziente_cognome: row.paziente_cognome ? String(row.paziente_cognome) : '',
    paziente_codice_fiscale: row.paziente_codice_fiscale ? String(row.paziente_codice_fiscale) : '',
    paziente_data_nascita: row.paziente_data_nascita ? String(row.paziente_data_nascita) : '',
    paziente_telefono: row.paziente_telefono ? String(row.paziente_telefono) : ''
  };
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) {
    return '';
  }

  return `?${entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')}`;
}

export async function getAppuntamentoByIdFromApi(id: number): Promise<Appuntamento | null> {
  const row = await apiGet<Record<string, unknown> | null>(`/legacy/appuntamenti/${id}`);
  return row ? mapAppuntamento(row) : null;
}

export async function getAppuntamentoBySourceVisitaIdFromApi(visitaId: number): Promise<Appuntamento | null> {
  const row = await apiGet<Record<string, unknown> | null>(`/legacy/appuntamenti/by-source/${visitaId}`);
  return row ? mapAppuntamento(row) : null;
}

export async function getAppuntamentiByRangeFromApi(params: {
  ambulatorioId: number;
  rangeStart: string;
  rangeEndExclusive: string;
}): Promise<Appuntamento[]> {
  const query = buildQuery({
    ambulatorio_id: params.ambulatorioId,
    from: params.rangeStart,
    to: params.rangeEndExclusive
  });

  const rows = await apiGet<Array<Record<string, unknown>>>(`/legacy/appuntamenti${query}`);
  return rows.map((row) => mapAppuntamento(row));
}

export async function getDailyAppointmentCountsByRangeFromApi(params: {
  ambulatorioId: number;
  rangeStart: string;
  rangeEndExclusive: string;
}): Promise<DailyAppointmentCount[]> {
  const appointments = await getAppuntamentiByRangeFromApi(params);
  const counts = new Map<string, number>();

  for (const appointment of appointments) {
    const key = appointment.data_ora_inizio.slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total }));
}

export async function createAppuntamentoManualeFromApi(input: CreateAppuntamentoManualeInput): Promise<number> {
  const response = await apiPost<{ id: number }>('/legacy/appuntamenti', {
    ...input,
    origine: 'manuale',
    source_visita_id: null
  });

  return Number(response.id);
}

export async function createFollowUpAppuntamentoFromApi(input: {
  ambulatorio_id: number;
  paziente_id: number;
  data_ora_inizio: string;
  data_ora_fine: string;
  motivo?: string;
  source_visita_id: number;
}): Promise<number> {
  const response = await apiPost<{ id: number }>('/legacy/appuntamenti', {
    ...input,
    origine: 'followup_visita'
  });

  return Number(response.id);
}

export async function updateAppuntamentoFromApi(input: UpdateAppuntamentoInput): Promise<void> {
  const { id, ...patch } = input;
  await apiPatch<void>(`/legacy/appuntamenti/${id}`, patch);
}

export async function deleteAppuntamentoFromApi(id: number): Promise<void> {
  await apiDelete<void>(`/legacy/appuntamenti/${id}`);
}

export async function updateAppuntamentoSourceVisitaIdFromApi(params: {
  appuntamentoId: number;
  sourceVisitaId: number | null;
}): Promise<void> {
  await apiPatch<void>(`/legacy/appuntamenti/${params.appuntamentoId}`, {
    source_visita_id: params.sourceVisitaId
  });
}
