import { join, normalize } from '@tauri-apps/api/path';
import { copyFile, exists, mkdir, remove, rename } from '@tauri-apps/plugin-fs';
import {
  DATABASE_FILENAME,
  clearConfiguredDatabaseDirectory,
  getConfiguredDatabaseDirectory,
  getDatabasePathForDirectory,
  getDefaultDatabaseDirectory,
  isApiDataProvider,
  getRuntimeDatabasePath,
  getRuntimeDatabaseUrl,
  setConfiguredDatabaseDirectory
} from './config';
import { getDatabase, initDatabase, reinitializeDatabase, resetDatabaseState } from './schema';

export type SwitchDatabaseDirectoryResult = {
  changed: boolean;
  previousDatabasePath: string;
  activeDatabasePath: string;
  activeDatabaseUrl: string;
  backupPath?: string;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') {
      return serialized;
    }
  } catch {
    // ignore JSON serialization failure
  }

  return 'Errore sconosciuto';
}

function createBackupFilename(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${DATABASE_FILENAME}.bak.${timestamp}`;
}

function restoreConfiguredDatabaseDirectory(previousValue: string | null): void {
  const normalizedPreviousValue = previousValue?.trim();
  if (normalizedPreviousValue) {
    setConfiguredDatabaseDirectory(normalizedPreviousValue);
    return;
  }

  clearConfiguredDatabaseDirectory();
}

async function persistDatabaseDirectory(nextDirectory: string): Promise<void> {
  const normalizedNextDirectory = await normalize(nextDirectory);
  const normalizedDefaultDirectory = await normalize(await getDefaultDatabaseDirectory());

  if (normalizedNextDirectory === normalizedDefaultDirectory) {
    clearConfiguredDatabaseDirectory();
    return;
  }

  setConfiguredDatabaseDirectory(normalizedNextDirectory);
}

export async function switchDatabaseDirectory(
  nextDirectoryInput: string
): Promise<SwitchDatabaseDirectoryResult> {
  if (isApiDataProvider()) {
    throw new Error('Cambio cartella database non disponibile con provider API');
  }

  const nextDirectory = nextDirectoryInput.trim();
  if (!nextDirectory) {
    throw new Error('Inserisci un percorso valido per la cartella del database.');
  }

  await initDatabase();

  const previousDatabasePath = await getRuntimeDatabasePath();
  const previousDatabaseUrl = await getRuntimeDatabaseUrl();
  const normalizedPreviousDatabasePath = await normalize(previousDatabasePath);
  const normalizedNextDirectory = await normalize(nextDirectory);
  const targetDatabasePath = await getDatabasePathForDirectory(normalizedNextDirectory);
  const normalizedTargetDatabasePath = await normalize(targetDatabasePath);

  if (normalizedPreviousDatabasePath === normalizedTargetDatabasePath) {
    return {
      changed: false,
      previousDatabasePath,
      activeDatabasePath: previousDatabasePath,
      activeDatabaseUrl: previousDatabaseUrl
    };
  }

  try {
    await getDatabase().execute('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (error) {
    console.warn('Impossibile eseguire wal_checkpoint prima della migrazione database:', error);
  }

  await resetDatabaseState();

  const previousConfiguredDirectory = getConfiguredDatabaseDirectory();
  let backupPath: string | null = null;
  let targetCopied = false;
  let configurationUpdated = false;

  try {
    await mkdir(normalizedNextDirectory, { recursive: true });

    if (await exists(normalizedTargetDatabasePath)) {
      backupPath = await join(normalizedNextDirectory, createBackupFilename());
      await rename(normalizedTargetDatabasePath, backupPath);
    }

    await copyFile(normalizedPreviousDatabasePath, normalizedTargetDatabasePath);
    targetCopied = true;

    await persistDatabaseDirectory(normalizedNextDirectory);
    configurationUpdated = true;

    await reinitializeDatabase();
    const validationRows = await getDatabase().select<Array<{ ok: number | string }>>(
      'SELECT 1 AS ok'
    );
    const validationValue = Number(validationRows[0]?.ok ?? 0);
    if (validationValue !== 1) {
      throw new Error('Validazione database fallita dopo il cambio percorso.');
    }

    const activeDatabasePath = await getRuntimeDatabasePath();
    const activeDatabaseUrl = await getRuntimeDatabaseUrl();

    return {
      changed: true,
      previousDatabasePath,
      activeDatabasePath,
      activeDatabaseUrl,
      backupPath: backupPath ?? undefined
    };
  } catch (error) {
    const rollbackErrors: string[] = [];

    if (configurationUpdated) {
      try {
        restoreConfiguredDatabaseDirectory(previousConfiguredDirectory);
      } catch (rollbackError) {
        rollbackErrors.push(`ripristino configurazione fallito: ${toErrorMessage(rollbackError)}`);
      }
    }

    if (targetCopied) {
      try {
        if (await exists(normalizedTargetDatabasePath)) {
          await remove(normalizedTargetDatabasePath);
        }
      } catch (rollbackError) {
        rollbackErrors.push(`pulizia file target fallita: ${toErrorMessage(rollbackError)}`);
      }
    }

    if (backupPath) {
      try {
        if (await exists(backupPath)) {
          await rename(backupPath, normalizedTargetDatabasePath);
        }
      } catch (rollbackError) {
        rollbackErrors.push(`ripristino backup fallito: ${toErrorMessage(rollbackError)}`);
      }
    }

    try {
      await reinitializeDatabase();
    } catch (rollbackError) {
      rollbackErrors.push(`riapertura database precedente fallita: ${toErrorMessage(rollbackError)}`);
    }

    if (rollbackErrors.length > 0) {
      throw new Error(
        `Cambio cartella database fallito: ${toErrorMessage(error)}. Rollback con errori: ${rollbackErrors.join(' | ')}`
      );
    }

    throw new Error(`Cambio cartella database fallito: ${toErrorMessage(error)}`);
  }
}
