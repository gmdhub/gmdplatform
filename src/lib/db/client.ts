import Database from '@tauri-apps/plugin-sql';
import { getApiBaseUrl, isApiDataProvider } from './config';
import { getRuntimeDatabaseUrl } from './config';

let db: Database | null = null;
let loadedDatabaseUrl: string | null = null;
let isApiShimLoaded = false;

function createApiDatabaseShim(): Database {
  const throwUnsupported = () => {
    throw new Error('Accesso SQL diretto non supportato con DATA_PROVIDER=api');
  };

  return {
    select: throwUnsupported,
    execute: throwUnsupported,
    close: async () => undefined
  } as unknown as Database;
}

function normalizeQueryParam(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return value;
}

function normalizeQueryParams(params?: unknown[]): unknown[] | undefined {
  if (!params) {
    return params;
  }

  return params.map((value) => normalizeQueryParam(value));
}

function wrapDatabase(database: Database): Database {
  return new Proxy(database, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (typeof value !== 'function') {
        return value;
      }

      if (prop === 'select' || prop === 'execute') {
        return (sql: string, params?: unknown[]) =>
          value.call(target, sql, normalizeQueryParams(params));
      }

      return value.bind(target);
    }
  }) as Database;
}

export async function loadDatabase(): Promise<Database> {
  if (db) {
    return db;
  }

  if (isApiDataProvider()) {
    loadedDatabaseUrl = `api:${getApiBaseUrl()}`;
    db = createApiDatabaseShim();
    isApiShimLoaded = true;
    return db;
  }

  loadedDatabaseUrl = await getRuntimeDatabaseUrl();
  db = wrapDatabase(await Database.load(loadedDatabaseUrl));
  return db;
}

export function getLoadedDatabase(): Database {
  if (!db) {
    throw new Error('Database non inizializzato. Chiamare initDatabase() prima.');
  }

  return db;
}

export async function resetLoadedDatabase(): Promise<void> {
  if (!db) {
    loadedDatabaseUrl = null;
    isApiShimLoaded = false;
    return;
  }

  if (isApiShimLoaded) {
    db = null;
    loadedDatabaseUrl = null;
    isApiShimLoaded = false;
    return;
  }

  try {
    if (loadedDatabaseUrl) {
      await db.close(loadedDatabaseUrl);
    } else {
      await db.close();
    }
  } catch {
    try {
      await db.close();
    } catch {
      // ignore close failures during reset
    }
  } finally {
    db = null;
    loadedDatabaseUrl = null;
    isApiShimLoaded = false;
  }
}

export async function insertReturningId(sql: string, params: unknown[]): Promise<number> {
  if (isApiDataProvider()) {
    throw new Error('insertReturningId non disponibile con DATA_PROVIDER=api');
  }

  const result = await getLoadedDatabase().execute(sql, params);
  const insertedId = Number(result.lastInsertId);

  if (!Number.isInteger(insertedId)) {
    throw new Error("Impossibile ottenere l'ID appena creato dal database.");
  }

  return insertedId;
}
