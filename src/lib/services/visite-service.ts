import type {
  CreateVisitaInput,
  UpdateVisitaInput,
  Visita
} from '$lib/db/types';
import { apiDelete, apiGet, apiPatch, apiPost } from './http-client';

function mapJsonLikeField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  return String(value);
}

function mapVisita(row: Record<string, unknown>): Visita {
  return {
    id: Number(row.id ?? 0),
    ambulatorio_id: Number(row.ambulatorio_id ?? 0),
    paziente_id: Number(row.paziente_id ?? 0),
    medico_id: Number(row.medico_id ?? 0),
    previous_version_id: row.previous_version_id === null || row.previous_version_id === undefined
      ? null
      : Number(row.previous_version_id),
    is_current_version: Number(row.is_current_version ?? 1),
    data_visita: String(row.data_visita ?? ''),
    tipo_visita: String(row.tipo_visita ?? ''),
    motivo: String(row.motivo ?? ''),
    altezza: row.altezza === null || row.altezza === undefined ? undefined : Number(row.altezza),
    peso: row.peso === null || row.peso === undefined ? undefined : Number(row.peso),
    bmi: row.bmi === null || row.bmi === undefined ? undefined : Number(row.bmi),
    bsa: row.bsa === null || row.bsa === undefined ? undefined : Number(row.bsa),
    anamnesi_cardiologica: row.anamnesi_cardiologica ? String(row.anamnesi_cardiologica) : '',
    anamnesi_internistica: row.anamnesi_internistica ? String(row.anamnesi_internistica) : '',
    terapia_domiciliare: row.terapia_domiciliare ? String(row.terapia_domiciliare) : '',
    valutazione_odierna: row.valutazione_odierna ? String(row.valutazione_odierna) : '',
    esami_ematici: mapJsonLikeField(row.esami_ematici),
    ecocardiografia: mapJsonLikeField(row.ecocardiografia),
    fh_assessment: mapJsonLikeField(row.fh_assessment),
    terapia_ipolipemizzante: mapJsonLikeField(row.terapia_ipolipemizzante),
    valutazione_rischio_cv: mapJsonLikeField(row.valutazione_rischio_cv),
    firme_visita: mapJsonLikeField(row.firme_visita),
    pianificazione_followup: mapJsonLikeField(row.pianificazione_followup),
    conclusioni: row.conclusioni ? String(row.conclusioni) : '',
    anamnesi: row.anamnesi ? String(row.anamnesi) : '',
    esame_obiettivo: row.esame_obiettivo ? String(row.esame_obiettivo) : '',
    diagnosi: row.diagnosi ? String(row.diagnosi) : '',
    terapia: row.terapia ? String(row.terapia) : '',
    note: row.note ? String(row.note) : '',
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
    paziente_nome: row.paziente_nome ? String(row.paziente_nome) : '',
    paziente_cognome: row.paziente_cognome ? String(row.paziente_cognome) : '',
    paziente_codice_fiscale: row.paziente_codice_fiscale ? String(row.paziente_codice_fiscale) : '',
    medico_nome: row.medico_nome ? String(row.medico_nome) : '',
    medico_cognome: row.medico_cognome ? String(row.medico_cognome) : '',
    internal_revision_id: row.internal_revision_id ? String(row.internal_revision_id) : undefined,
    internal_encounter_id: row.internal_encounter_id ? String(row.internal_encounter_id) : undefined
  };
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) {
    return '';
  }

  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `?${query}`;
}

export async function listVisiteFromApi(params?: {
  ambulatorio_id?: number;
  paziente_id?: number;
  search?: string;
  current_only?: boolean;
}): Promise<Visita[]> {
  const query = buildQuery({
    ambulatorio_id: params?.ambulatorio_id,
    paziente_id: params?.paziente_id,
    search: params?.search,
    current_only: params?.current_only ? 1 : undefined
  });

  const rows = await apiGet<Array<Record<string, unknown>>>(`/legacy/visite${query}`);
  return rows.map((row) => mapVisita(row));
}

export async function getVisitaByIdFromApi(id: number): Promise<Visita | null> {
  const row = await apiGet<Record<string, unknown> | null>(`/legacy/visite/${id}`);
  return row ? mapVisita(row) : null;
}

export async function createVisitaFromApi(input: CreateVisitaInput): Promise<number> {
  const response = await apiPost<{ id: number }>('/legacy/visite', input);
  return Number(response.id);
}

export async function updateVisitaFromApi(input: UpdateVisitaInput): Promise<void> {
  const { id, ...patch } = input;
  await apiPatch<void>(`/legacy/visite/${id}`, patch);
}

export async function deleteVisitaFromApi(id: number): Promise<void> {
  await apiDelete<void>(`/legacy/visite/${id}`);
}
