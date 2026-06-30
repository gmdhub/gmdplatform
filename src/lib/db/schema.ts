// GMD Medical Platform - Database Schema
import type Database from '@tauri-apps/plugin-sql';
import { loadDatabase, getLoadedDatabase, resetLoadedDatabase } from './client';
import { getApiBaseUrl, isApiDataProvider } from './config';
import { applyMigrations } from './migrations';

let initPromise: Promise<Database> | null = null;

const adminPasswordHash = '$2b$10$BpnBxVIQpbTUhRhgNpsSeeNzDbzUzkC0wJTnJLPaIQehJcGWuCXye';

const ambulatoriDemo = [
  {
    nome: 'Ambulatorio Cardiologico delle Dislipidemie',
    logo_path: '/ambulatori/icon_dislip.png',
    primary: '#06b6d4',
    secondary: '#0891b2',
    accent: '#22d3ee'
  },
  {
    nome: 'Ortopedia',
    logo_path: '/ambulatori/ortopedia.png',
    primary: '#059669',
    secondary: '#10b981',
    accent: '#6ee7b7'
  },
  {
    nome: 'Ambulatorio SCA',
    logo_path: '/ambulatori/icon_sca.png',
    primary: '#dc2626',
    secondary: '#ef4444',
    accent: '#fca5a5'
  },
  {
    nome: 'Day Hospital Riabilitativa',
    logo_path: '/ambulatori/icon_dhr.png',
    primary: '#03a19e',
    secondary: '#10ccb4',
    accent: '#31e0c6'
  }
];

const pazientiDemo = [
  {
    ambulatorio_id: 1,
    nome: 'Mario',
    cognome: 'Rossi',
    data_nascita: '1980-05-15',
    luogo_nascita: 'Roma',
    codice_fiscale: 'RSSMRA80E15H501Z',
    sesso: 'M',
    esenzioni: 'E01',
    indirizzo: 'Via Roma 123',
    citta: 'Roma',
    cap: '00100',
    provincia: 'RM'
  },
  {
    ambulatorio_id: 1,
    nome: 'Giulia',
    cognome: 'Bianchi',
    data_nascita: '1992-08-22',
    luogo_nascita: 'Milano',
    codice_fiscale: 'BNCGLI92M62F205X',
    sesso: 'F',
    esenzioni: '',
    indirizzo: 'Corso Italia 45',
    citta: 'Milano',
    cap: '20100',
    provincia: 'MI'
  }
];

export async function initDatabase(): Promise<Database> {
  if (!initPromise) {
    initPromise = initializeDatabase();
  }

  try {
    return await initPromise;
  } catch (error) {
    await resetDatabaseState();
    throw error;
  }
}

export function getDatabase(): Database {
  return getLoadedDatabase();
}

export async function resetDatabaseState(): Promise<void> {
  await resetLoadedDatabase();
  initPromise = null;
}

export async function reinitializeDatabase(): Promise<Database> {
  await resetDatabaseState();
  return initDatabase();
}

async function initializeDatabase(): Promise<Database> {
  if (isApiDataProvider()) {
    await assertApiHealth();
    return loadDatabase();
  }

  const db = await loadDatabase();
  await applyMigrations(db);
  await ensureBootstrapData(db);
  return db;
}

async function assertApiHealth(): Promise<void> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/health`);
  if (!response.ok) {
    throw new Error(`Backend API non raggiungibile (${response.status}) su ${baseUrl}`);
  }
}

async function ensureBootstrapData(db: Database): Promise<void> {
  const users = await db.select<Array<{ count: number | string }>>(
    'SELECT COUNT(*) AS count FROM users'
  );
  const totalUsers = Number(users[0]?.count ?? 0);

  if (totalUsers > 0) {
    return;
  }

  await db.execute(
    `INSERT INTO users (username, password_hash, role, nome, cognome)
     VALUES (?, ?, ?, ?, ?)`,
    ['admin', adminPasswordHash, 'admin', 'Admin', 'GMD']
  );

  for (const ambulatorio of ambulatoriDemo) {
    await db.execute(
      `INSERT INTO ambulatori (nome, logo_path, color_primary, color_secondary, color_accent)
       VALUES (?, ?, ?, ?, ?)`,
      [
        ambulatorio.nome,
        ambulatorio.logo_path,
        ambulatorio.primary,
        ambulatorio.secondary,
        ambulatorio.accent
      ]
    );
  }

  for (const paziente of pazientiDemo) {
    await db.execute(
      `INSERT INTO pazienti (
        ambulatorio_id, nome, cognome, data_nascita, luogo_nascita,
        codice_fiscale, sesso, esenzioni, indirizzo, citta, cap, provincia
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        paziente.ambulatorio_id,
        paziente.nome,
        paziente.cognome,
        paziente.data_nascita,
        paziente.luogo_nascita,
        paziente.codice_fiscale,
        paziente.sesso,
        paziente.esenzioni,
        paziente.indirizzo,
        paziente.citta,
        paziente.cap,
        paziente.provincia
      ]
    );
  }
}
