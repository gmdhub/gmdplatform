// GMD Medical Platform - Pazienti Database Operations
import { insertReturningId } from './client';
import { isApiDataProvider } from './config';
import { initDatabase } from './schema';
import {
  createPazienteFromApi,
  createPazienteRapidoFromApi,
  deletePazienteFromApi,
  getAllPazientiFromApi,
  getPazienteByIdFromApi,
  getPazientiByAmbulatorioFromApi,
  searchPazientiFromApi,
  updatePazienteFromApi
} from '$lib/services/pazienti-service';
import type {
  CreatePazienteInput,
  CreatePazienteRapidoInput,
  Paziente,
  UpdatePazienteInput
} from './types';

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

function pushField(fields: string[], values: unknown[], column: string, value: unknown) {
  values.push(value);
  fields.push(`${column} = ?`);
}

export async function getAllPazienti(): Promise<Paziente[]> {
  if (isApiDataProvider()) {
    return getAllPazientiFromApi();
  }

  const db = await initDatabase();
  return db.select<Paziente[]>(
    `SELECT * FROM pazienti
     ORDER BY cognome, nome`
  );
}

// Manteniamo questa funzione per compatibilita, ma ora restituisce tutti i pazienti
export async function getPazientiByAmbulatorio(_ambulatorioId: number): Promise<Paziente[]> {
  if (isApiDataProvider()) {
    return getPazientiByAmbulatorioFromApi(_ambulatorioId);
  }

  return getAllPazienti();
}

export async function getPazienteById(id: number): Promise<Paziente | null> {
  if (isApiDataProvider()) {
    return getPazienteByIdFromApi(id);
  }

  const db = await initDatabase();
  const result = await db.select<Paziente[]>(
    'SELECT * FROM pazienti WHERE id = ?',
    [normalizeIntegerForWrite(id)]
  );
  return result[0] || null;
}

export async function searchPazienti(
  _ambulatorioId: number,
  searchTerm: string
): Promise<Paziente[]> {
  if (isApiDataProvider()) {
    return searchPazientiFromApi(_ambulatorioId, searchTerm);
  }

  const db = await initDatabase();
  const term = `%${searchTerm}%`;
  return db.select<Paziente[]>(
    `SELECT * FROM pazienti
     WHERE (
       LOWER(nome) LIKE LOWER(?) OR
       LOWER(cognome) LIKE LOWER(?) OR
       LOWER(codice_fiscale) LIKE LOWER(?)
     )
     ORDER BY cognome, nome`,
    [term, term, term]
  );
}

export async function createPaziente(data: CreatePazienteInput): Promise<number> {
  if (isApiDataProvider()) {
    return createPazienteFromApi(data);
  }

  await initDatabase();

  return insertReturningId(
    `INSERT INTO pazienti (
      ambulatorio_id, nome, cognome, data_nascita, luogo_nascita,
      codice_fiscale, sesso, esenzioni, indirizzo, citta, cap, provincia,
      telefono, email
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizeIntegerForWrite(data.ambulatorio_id),
      data.nome,
      data.cognome,
      data.data_nascita,
      data.luogo_nascita,
      data.codice_fiscale,
      data.sesso,
      data.esenzioni || '',
      data.indirizzo || '',
      data.citta || '',
      data.cap || '',
      data.provincia || '',
      data.telefono || '',
      data.email || ''
    ]
  );
}

function sanitizeToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function buildTemporaryCodiceFiscale(nome: string, cognome: string): string {
  const timestampToken = Date.now().toString(36).toUpperCase().slice(-8);
  const nameToken = sanitizeToken(nome).padEnd(3, 'X').slice(0, 3);
  const surnameToken = sanitizeToken(cognome).padEnd(3, 'X').slice(0, 3);
  return `TMP${surnameToken}${nameToken}${timestampToken}`;
}

export async function createPazienteRapido(data: CreatePazienteRapidoInput): Promise<number> {
  if (isApiDataProvider()) {
    return createPazienteRapidoFromApi(data);
  }

  const nome = data.nome.trim();
  const cognome = data.cognome.trim();
  const telefono = data.telefono.trim();

  if (!nome) {
    throw new Error('Il nome del paziente è obbligatorio');
  }
  if (!cognome) {
    throw new Error('Il cognome del paziente è obbligatorio');
  }
  if (!telefono) {
    throw new Error('Il numero di telefono del paziente è obbligatorio');
  }

  return createPaziente({
    ambulatorio_id: data.ambulatorio_id,
    nome,
    cognome,
    telefono,
    // Campi tecnici richiesti dallo schema DB, inizializzati in modo neutro.
    data_nascita: '1900-01-01',
    luogo_nascita: 'Non specificato',
    codice_fiscale: buildTemporaryCodiceFiscale(nome, cognome),
    sesso: 'Altro',
    esenzioni: '',
    indirizzo: '',
    citta: '',
    cap: '',
    provincia: '',
    email: ''
  });
}

export async function updatePaziente(data: UpdatePazienteInput): Promise<void> {
  if (isApiDataProvider()) {
    await updatePazienteFromApi(data);
    return;
  }

  const db = await initDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.nome !== undefined) {
    pushField(fields, values, 'nome', data.nome);
  }
  if (data.cognome !== undefined) {
    pushField(fields, values, 'cognome', data.cognome);
  }
  if (data.data_nascita !== undefined) {
    pushField(fields, values, 'data_nascita', data.data_nascita);
  }
  if (data.luogo_nascita !== undefined) {
    pushField(fields, values, 'luogo_nascita', data.luogo_nascita);
  }
  if (data.codice_fiscale !== undefined) {
    pushField(fields, values, 'codice_fiscale', data.codice_fiscale);
  }
  if (data.sesso !== undefined) {
    pushField(fields, values, 'sesso', data.sesso);
  }
  if (data.esenzioni !== undefined) {
    pushField(fields, values, 'esenzioni', data.esenzioni);
  }
  if (data.indirizzo !== undefined) {
    pushField(fields, values, 'indirizzo', data.indirizzo);
  }
  if (data.citta !== undefined) {
    pushField(fields, values, 'citta', data.citta);
  }
  if (data.cap !== undefined) {
    pushField(fields, values, 'cap', data.cap);
  }
  if (data.provincia !== undefined) {
    pushField(fields, values, 'provincia', data.provincia);
  }
  if (data.telefono !== undefined) {
    pushField(fields, values, 'telefono', data.telefono);
  }
  if (data.email !== undefined) {
    pushField(fields, values, 'email', data.email);
  }

  if (fields.length === 0) {
    return;
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(normalizeIntegerForWrite(data.id));

  await db.execute(
    `UPDATE pazienti SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deletePaziente(id: number): Promise<void> {
  if (isApiDataProvider()) {
    await deletePazienteFromApi(id);
    return;
  }

  const db = await initDatabase();
  await db.execute('DELETE FROM pazienti WHERE id = ?', [
    normalizeIntegerForWrite(id)
  ]);
}
