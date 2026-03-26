import type {
  CreatePazienteInput,
  CreatePazienteRapidoInput,
  Paziente,
  UpdatePazienteInput
} from '$lib/db/types';
import { apiDelete, apiGet, apiPatch, apiPost } from './http-client';

function mapPaziente(row: Record<string, unknown>): Paziente {
  return {
    id: Number(row.id ?? 0),
    ambulatorio_id: Number(row.ambulatorio_id ?? 0),
    nome: String(row.nome ?? ''),
    cognome: String(row.cognome ?? ''),
    data_nascita: String(row.data_nascita ?? ''),
    luogo_nascita: String(row.luogo_nascita ?? ''),
    codice_fiscale: String(row.codice_fiscale ?? ''),
    sesso: (row.sesso as Paziente['sesso']) ?? 'Altro',
    esenzioni: String(row.esenzioni ?? ''),
    indirizzo: String(row.indirizzo ?? ''),
    citta: String(row.citta ?? ''),
    cap: String(row.cap ?? ''),
    provincia: String(row.provincia ?? ''),
    telefono: String(row.telefono ?? ''),
    email: String(row.email ?? ''),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString())
  };
}

export async function getAllPazientiFromApi(): Promise<Paziente[]> {
  const rows = await apiGet<Array<Record<string, unknown>>>('/patients');
  return rows.map((row) => mapPaziente(row));
}

export async function getPazientiByAmbulatorioFromApi(ambulatorioId: number): Promise<Paziente[]> {
  const rows = await apiGet<Array<Record<string, unknown>>>(`/patients?ambulatorio_id=${ambulatorioId}`);
  return rows.map((row) => mapPaziente(row));
}

export async function getPazienteByIdFromApi(id: number): Promise<Paziente | null> {
  const row = await apiGet<Record<string, unknown> | null>(`/patients/${id}`);
  return row ? mapPaziente(row) : null;
}

export async function searchPazientiFromApi(ambulatorioId: number, searchTerm: string): Promise<Paziente[]> {
  const encodedSearch = encodeURIComponent(searchTerm);
  const rows = await apiGet<Array<Record<string, unknown>>>(
    `/patients?ambulatorio_id=${ambulatorioId}&search=${encodedSearch}`
  );
  return rows.map((row) => mapPaziente(row));
}

export async function createPazienteFromApi(input: CreatePazienteInput): Promise<number> {
  const response = await apiPost<{ id: number }>('/patients', input);
  return Number(response.id);
}

export async function createPazienteRapidoFromApi(input: CreatePazienteRapidoInput): Promise<number> {
  const nome = input.nome.trim();
  const cognome = input.cognome.trim();
  const telefono = input.telefono.trim();

  if (!nome || !cognome || !telefono) {
    throw new Error('Nome, cognome e telefono sono obbligatori');
  }

  return createPazienteFromApi({
    ambulatorio_id: input.ambulatorio_id,
    nome,
    cognome,
    data_nascita: '1900-01-01',
    luogo_nascita: 'Non specificato',
    codice_fiscale: `TMP${Date.now().toString(36).toUpperCase().slice(-8)}`,
    sesso: 'Altro',
    esenzioni: '',
    indirizzo: '',
    citta: '',
    cap: '',
    provincia: '',
    telefono,
    email: ''
  });
}

export async function updatePazienteFromApi(input: UpdatePazienteInput): Promise<void> {
  const { id, ...patch } = input;
  await apiPatch<void>(`/patients/${id}`, patch);
}

export async function deletePazienteFromApi(id: number): Promise<void> {
  await apiDelete<void>(`/patients/${id}`);
}
