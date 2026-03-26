import type {
  CreateFattoriRischioCVInput,
  FattoriRischioCV,
  UpdateFattoriRischioCVInput
} from '$lib/db/types';
import { apiDelete, apiGet, apiPatch, apiPost } from './http-client';

function mapFattore(row: Record<string, unknown>): FattoriRischioCV {
  return {
    id: Number(row.id ?? row.visita_id ?? 0),
    visita_id: Number(row.visita_id ?? 0),
    familiarita: Boolean(row.familiarita),
    familiarita_note: row.familiarita_note ? String(row.familiarita_note) : '',
    ipertensione: Boolean(row.ipertensione),
    diabete: Boolean(row.diabete),
    diabete_durata: row.diabete_durata ? String(row.diabete_durata) : '',
    diabete_tipo: (row.diabete_tipo as FattoriRischioCV['diabete_tipo']) ?? '',
    dislipidemia: Boolean(row.dislipidemia),
    obesita: Boolean(row.obesita),
    fumo: String(row.fumo ?? ''),
    fumo_ex_eta: row.fumo_ex_eta ? String(row.fumo_ex_eta) : '',
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString())
  };
}

export async function createFattoriRischioCVFromApi(input: CreateFattoriRischioCVInput): Promise<number> {
  const response = await apiPost<{ id: number }>('/legacy/fattori-rischio-cv', input);
  return Number(response.id);
}

export async function getFattoriRischioCVByVisitaIdFromApi(visitaId: number): Promise<FattoriRischioCV | null> {
  const row = await apiGet<Record<string, unknown> | null>(`/legacy/fattori-rischio-cv/by-visita/${visitaId}`);
  return row ? mapFattore(row) : null;
}

export async function getFattoriRischioCVByVisitaIdsFromApi(visitaIds: number[]): Promise<FattoriRischioCV[]> {
  if (visitaIds.length === 0) {
    return [];
  }

  const query = visitaIds.map((value) => encodeURIComponent(String(value))).join(',');
  const rows = await apiGet<Array<Record<string, unknown>>>(`/legacy/fattori-rischio-cv?visita_ids=${query}`);
  return rows.map((row) => mapFattore(row));
}

export async function updateFattoriRischioCVFromApi(input: UpdateFattoriRischioCVInput): Promise<void> {
  const { id, ...patch } = input;
  await apiPatch<void>(`/legacy/fattori-rischio-cv/${id}`, patch);
}

export async function deleteFattoriRischioCVFromApi(id: number): Promise<void> {
  await apiDelete<void>(`/legacy/fattori-rischio-cv/${id}`);
}

export async function deleteFattoriRischioCVByVisitaIdFromApi(visitaId: number): Promise<void> {
  await apiDelete<void>(`/legacy/fattori-rischio-cv/by-visita/${visitaId}`);
}
