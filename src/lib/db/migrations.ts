import type Database from '@tauri-apps/plugin-sql';

type ColumnDefinition = {
  name: string;
  definition: string;
};

type SchemaObjectRow = {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
};

const DEFAULT_APPOINTMENT_DURATION_MINUTES = 15;
const DEFAULT_MIN_VISIT_DURATION_MINUTES = 10;
const DEFAULT_STANDARD_VISIT_DURATION_MINUTES = 15;
const DEFAULT_MAX_PATIENTS_PER_DAY = 25;
const DEFAULT_MAX_PATIENTS_PER_DAY_MONDAY = 15;
const DEFAULT_MAX_PATIENTS_PER_DAY_THURSDAY = 25;

const ambulatoriColumns: ColumnDefinition[] = [
  { name: 'indirizzo', definition: 'TEXT' },
  { name: 'telefono', definition: 'TEXT' },
  { name: 'email', definition: 'TEXT' },
  {
    name: 'durata_minima_visita_minuti',
    definition: `INTEGER NOT NULL DEFAULT ${DEFAULT_MIN_VISIT_DURATION_MINUTES}`
  },
  {
    name: 'durata_standard_visita_minuti',
    definition: `INTEGER NOT NULL DEFAULT ${DEFAULT_STANDARD_VISIT_DURATION_MINUTES}`
  }
];

const pazientiColumns: ColumnDefinition[] = [
  { name: 'telefono', definition: 'TEXT' },
  { name: 'email', definition: 'TEXT' }
];

const visiteColumns: ColumnDefinition[] = [
  { name: 'previous_version_id', definition: 'INTEGER' },
  { name: 'is_current_version', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { name: 'bsa', definition: 'REAL' },
  { name: 'anamnesi_cardiologica', definition: 'TEXT' },
  { name: 'anamnesi_internistica', definition: 'TEXT' },
  { name: 'terapia_domiciliare', definition: 'TEXT' },
  { name: 'valutazione_odierna', definition: 'TEXT' },
  { name: 'esami_ematici', definition: 'TEXT' },
  { name: 'ecocardiografia', definition: 'TEXT' },
  { name: 'conclusioni', definition: 'TEXT' },
  { name: 'fh_assessment', definition: 'TEXT' },
  { name: 'terapia_ipolipemizzante', definition: 'TEXT' },
  { name: 'valutazione_rischio_cv', definition: 'TEXT' },
  { name: 'firme_visita', definition: 'TEXT' },
  { name: 'pianificazione_followup', definition: 'TEXT' },
  { name: 'anamnesi', definition: 'TEXT' },
  { name: 'esame_obiettivo', definition: 'TEXT' },
  { name: 'diagnosi', definition: 'TEXT' },
  { name: 'terapia', definition: 'TEXT' },
  { name: 'note', definition: 'TEXT' }
];

const appuntamentiColumns: ColumnDefinition[] = [
  { name: 'durata_minuti', definition: `INTEGER NOT NULL DEFAULT ${DEFAULT_APPOINTMENT_DURATION_MINUTES}` },
  { name: 'data_ora_fine', definition: 'DATETIME' },
  { name: 'motivo', definition: 'TEXT' },
  { name: 'origine', definition: "TEXT NOT NULL DEFAULT 'manuale'" },
  { name: 'source_visita_id', definition: 'INTEGER' }
];

const fattoriRischioColumns: ColumnDefinition[] = [
  { name: 'diabete_tipo', definition: "TEXT DEFAULT ''" },
  { name: 'fumo_ex_eta', definition: 'TEXT' }
];

const ambulatorioOrariColumns: ColumnDefinition[] = [
  {
    name: 'max_pazienti_giorno',
    definition: `INTEGER NOT NULL DEFAULT ${DEFAULT_MAX_PATIENTS_PER_DAY}`
  }
];

const indexStatements = [
  'CREATE INDEX IF NOT EXISTS idx_pazienti_ambulatorio ON pazienti(ambulatorio_id)',
  'CREATE INDEX IF NOT EXISTS idx_pazienti_cognome ON pazienti(cognome)',
  'CREATE INDEX IF NOT EXISTS idx_pazienti_cf ON pazienti(codice_fiscale)',
  'CREATE INDEX IF NOT EXISTS idx_visite_ambulatorio ON visite(ambulatorio_id)',
  'CREATE INDEX IF NOT EXISTS idx_visite_paziente ON visite(paziente_id)',
  'CREATE INDEX IF NOT EXISTS idx_visite_data ON visite(data_visita)',
  'CREATE INDEX IF NOT EXISTS idx_visite_current_ambulatorio_paziente ON visite(ambulatorio_id, paziente_id, is_current_version)',
  'CREATE INDEX IF NOT EXISTS idx_appuntamenti_ambulatorio_data ON appuntamenti(ambulatorio_id, data_ora_inizio, data_ora_fine)',
  'CREATE INDEX IF NOT EXISTS idx_appuntamenti_paziente_data ON appuntamenti(paziente_id, data_ora_inizio)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_appuntamenti_source_visita ON appuntamenti(source_visita_id) WHERE source_visita_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_ambulatorio_orari_ambulatorio_weekday ON ambulatorio_orari(ambulatorio_id, weekday, ora_inizio)',
  'CREATE INDEX IF NOT EXISTS idx_fattori_rischio_visita ON fattori_rischio_cv(visita_id)'
];

async function getTableColumns(db: Database, tableName: string): Promise<Set<string>> {
  const rows = await db.select<Array<{ name: string }>>(`PRAGMA table_info(${tableName})`);
  return new Set(rows.map((row) => row.name));
}

async function addMissingColumns(
  db: Database,
  tableName: string,
  columnsToEnsure: ColumnDefinition[]
): Promise<void> {
  const existingColumns = await getTableColumns(db, tableName);

  for (const column of columnsToEnsure) {
    if (existingColumns.has(column.name)) {
      continue;
    }

    await db.execute(
      `ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.definition}`
    );
  }
}

async function createBaseTables(db: Database): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      nome TEXT NOT NULL,
      cognome TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ambulatori (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      logo_path TEXT,
      color_primary TEXT NOT NULL DEFAULT '#1e3a8a',
      color_secondary TEXT NOT NULL DEFAULT '#3b82f6',
      color_accent TEXT NOT NULL DEFAULT '#22d3ee',
      indirizzo TEXT,
      telefono TEXT,
      email TEXT,
      durata_minima_visita_minuti INTEGER NOT NULL DEFAULT ${DEFAULT_MIN_VISIT_DURATION_MINUTES},
      durata_standard_visita_minuti INTEGER NOT NULL DEFAULT ${DEFAULT_STANDARD_VISIT_DURATION_MINUTES},
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS pazienti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ambulatorio_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      cognome TEXT NOT NULL,
      data_nascita DATE NOT NULL,
      luogo_nascita TEXT NOT NULL,
      codice_fiscale TEXT NOT NULL,
      sesso TEXT NOT NULL,
      esenzioni TEXT,
      indirizzo TEXT,
      citta TEXT,
      cap TEXT,
      provincia TEXT,
      telefono TEXT,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ambulatorio_id) REFERENCES ambulatori(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS visite (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ambulatorio_id INTEGER NOT NULL,
      paziente_id INTEGER NOT NULL,
      medico_id INTEGER NOT NULL,
      previous_version_id INTEGER,
      is_current_version INTEGER NOT NULL DEFAULT 1,
      data_visita DATETIME NOT NULL,
      tipo_visita TEXT NOT NULL,
      motivo TEXT NOT NULL,
      altezza REAL,
      peso REAL,
      bmi REAL,
      bsa REAL,
      anamnesi_cardiologica TEXT,
      anamnesi_internistica TEXT,
      terapia_domiciliare TEXT,
      valutazione_odierna TEXT,
      esami_ematici TEXT,
      ecocardiografia TEXT,
      fh_assessment TEXT,
      terapia_ipolipemizzante TEXT,
      valutazione_rischio_cv TEXT,
      firme_visita TEXT,
      pianificazione_followup TEXT,
      conclusioni TEXT,
      anamnesi TEXT,
      esame_obiettivo TEXT,
      diagnosi TEXT,
      terapia TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ambulatorio_id) REFERENCES ambulatori(id) ON DELETE CASCADE,
      FOREIGN KEY (paziente_id) REFERENCES pazienti(id) ON DELETE CASCADE,
      FOREIGN KEY (medico_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (previous_version_id) REFERENCES visite(id) ON DELETE SET NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS appuntamenti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ambulatorio_id INTEGER NOT NULL,
      paziente_id INTEGER NOT NULL,
      data_ora_inizio DATETIME NOT NULL,
      data_ora_fine DATETIME NOT NULL,
      durata_minuti INTEGER NOT NULL DEFAULT ${DEFAULT_APPOINTMENT_DURATION_MINUTES},
      motivo TEXT,
      origine TEXT NOT NULL DEFAULT 'manuale',
      source_visita_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ambulatorio_id) REFERENCES ambulatori(id) ON DELETE CASCADE,
      FOREIGN KEY (paziente_id) REFERENCES pazienti(id) ON DELETE CASCADE,
      FOREIGN KEY (source_visita_id) REFERENCES visite(id) ON DELETE SET NULL,
      CHECK (origine IN ('manuale', 'followup_visita'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ambulatorio_orari (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ambulatorio_id INTEGER NOT NULL,
      weekday INTEGER NOT NULL,
      ora_inizio TEXT NOT NULL,
      ora_fine TEXT NOT NULL,
      max_pazienti_giorno INTEGER NOT NULL DEFAULT ${DEFAULT_MAX_PATIENTS_PER_DAY},
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ambulatorio_id) REFERENCES ambulatori(id) ON DELETE CASCADE,
      CHECK (weekday BETWEEN 1 AND 7)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS fattori_rischio_cv (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visita_id INTEGER NOT NULL,
      familiarita BOOLEAN DEFAULT 0,
      familiarita_note TEXT,
      ipertensione BOOLEAN DEFAULT 0,
      diabete BOOLEAN DEFAULT 0,
      diabete_durata TEXT,
      diabete_tipo TEXT DEFAULT '',
      dislipidemia BOOLEAN DEFAULT 0,
      obesita BOOLEAN DEFAULT 0,
      fumo TEXT DEFAULT '',
      fumo_ex_eta TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (visita_id) REFERENCES visite(id) ON DELETE CASCADE
    )
  `);
}

async function ensureIndexes(db: Database): Promise<void> {
  for (const statement of indexStatements) {
    await db.execute(statement);
  }
}

type FollowUpRow = {
  id: number;
  ambulatorio_id: number;
  paziente_id: number;
  durata_standard_visita_minuti: number | null;
  pianificazione_followup: string | null;
};

type FollowUpPayload = {
  dataOraProssimaVisita?: unknown;
  motivoProssimaVisita?: unknown;
};

type AppuntamentoBackfillRow = {
  id: number;
  data_ora_inizio: string;
  data_ora_fine: string | null;
  durata_minuti: number | null;
};

function normalizeFollowUpDateTime(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
}

function normalizeDateTime(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
}

function addMinutesToDateTime(value: string, minutes: number): string {
  const normalized = normalizeDateTime(value);
  if (!normalized) {
    throw new Error(`Data/ora non valida: ${value}`);
  }

  const date = new Date(normalized);
  date.setMinutes(date.getMinutes() + minutes);

  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function calculateDurationMinutes(startDateTime: string, endDateTime: string): number {
  const start = new Date(startDateTime);
  const end = new Date(endDateTime);
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

async function dropLegacyFixedSlotIndexes(db: Database): Promise<void> {
  await db.execute('DROP INDEX IF EXISTS ux_appuntamenti_slot');
}

async function backfillAppuntamentiEndDateTime(db: Database): Promise<void> {
  const rows = await db.select<AppuntamentoBackfillRow[]>(
    'SELECT id, data_ora_inizio, data_ora_fine, durata_minuti FROM appuntamenti'
  );

  for (const row of rows) {
    const startDateTime = normalizeDateTime(row.data_ora_inizio);
    if (!startDateTime) {
      continue;
    }

    const parsedDuration = Number(row.durata_minuti ?? 0);
    const durationMinutes =
      Number.isFinite(parsedDuration) && parsedDuration > 0
        ? parsedDuration
        : DEFAULT_APPOINTMENT_DURATION_MINUTES;

    const normalizedEndDateTime = normalizeDateTime(row.data_ora_fine);
    const endDateTime =
      normalizedEndDateTime && calculateDurationMinutes(startDateTime, normalizedEndDateTime) > 0
        ? normalizedEndDateTime
        : addMinutesToDateTime(startDateTime, durationMinutes);

    const normalizedDuration = calculateDurationMinutes(startDateTime, endDateTime);
    if (normalizedDuration <= 0) {
      continue;
    }

    await db.execute(
      `UPDATE appuntamenti
       SET data_ora_inizio = ?, data_ora_fine = ?, durata_minuti = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [startDateTime, endDateTime, normalizedDuration, row.id]
    );
  }
}

type AmbulatorioIdRow = { id: number };
type CountRow = { count: number | string };

async function ensureDefaultOperatingHoursForAmbulatori(db: Database): Promise<void> {
  const ambulatori = await db.select<AmbulatorioIdRow[]>('SELECT id FROM ambulatori');

  for (const ambulatorio of ambulatori) {
    const rows = await db.select<CountRow[]>(
      'SELECT COUNT(*) AS count FROM ambulatorio_orari WHERE ambulatorio_id = ?',
      [ambulatorio.id]
    );
    const count = Number(rows[0]?.count ?? 0);

    if (count > 0) {
      continue;
    }

    await db.execute(
      `INSERT INTO ambulatorio_orari (
        ambulatorio_id,
        weekday,
        ora_inizio,
        ora_fine,
        max_pazienti_giorno
      ) VALUES (?, 1, '15:00', '18:00', ?)`,
      [ambulatorio.id, DEFAULT_MAX_PATIENTS_PER_DAY_MONDAY]
    );
    await db.execute(
      `INSERT INTO ambulatorio_orari (
        ambulatorio_id,
        weekday,
        ora_inizio,
        ora_fine,
        max_pazienti_giorno
      ) VALUES (?, 4, '08:30', '14:00', ?)`,
      [ambulatorio.id, DEFAULT_MAX_PATIENTS_PER_DAY_THURSDAY]
    );
  }
}

async function ensureOperatingWindowDailyCapacityBounds(db: Database): Promise<void> {
  await db.execute(
    `UPDATE ambulatorio_orari
     SET max_pazienti_giorno = CASE
       WHEN weekday = 1 THEN ?
       WHEN weekday = 4 THEN ?
       ELSE ?
     END,
     updated_at = CURRENT_TIMESTAMP
     WHERE max_pazienti_giorno IS NULL OR max_pazienti_giorno < 1`,
    [
      DEFAULT_MAX_PATIENTS_PER_DAY_MONDAY,
      DEFAULT_MAX_PATIENTS_PER_DAY_THURSDAY,
      DEFAULT_MAX_PATIENTS_PER_DAY
    ]
  );
}

async function ensureAmbulatorioStandardVisitDurationBounds(db: Database): Promise<void> {
  await db.execute(
    `UPDATE ambulatori
     SET durata_standard_visita_minuti = ?, updated_at = CURRENT_TIMESTAMP
     WHERE durata_standard_visita_minuti IS NULL OR durata_standard_visita_minuti < ?`,
    [DEFAULT_STANDARD_VISIT_DURATION_MINUTES, DEFAULT_MIN_VISIT_DURATION_MINUTES]
  );

  await db.execute(
    `UPDATE ambulatori
     SET durata_standard_visita_minuti = durata_minima_visita_minuti,
         updated_at = CURRENT_TIMESTAMP
     WHERE durata_standard_visita_minuti < durata_minima_visita_minuti`
  );
}

async function ensureScaAmbulatorio(db: Database): Promise<void> {
  const ambulatoriCountRows = await db.select<CountRow[]>(
    'SELECT COUNT(*) AS count FROM ambulatori'
  );
  const ambulatoriCount = Number(ambulatoriCountRows[0]?.count ?? 0);
  if (ambulatoriCount === 0) {
    return;
  }

  const existing = await db.select<Array<{ id: number }>>(
    'SELECT id FROM ambulatori WHERE nome = ? LIMIT 1',
    ['Ambulatorio SCA']
  );

  if (existing.length > 0) {
    await db.execute(
      `UPDATE ambulatori
       SET logo_path = ?,
           color_primary = ?,
           color_secondary = ?,
           color_accent = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      ['/ambulatori/icon_sca.png', '#dc2626', '#ef4444', '#fca5a5', existing[0].id]
    );
    return;
  }

  await db.execute(
    `INSERT INTO ambulatori (
      nome,
      logo_path,
      color_primary,
      color_secondary,
      color_accent
    ) VALUES (?, ?, ?, ?, ?)`,
    ['Ambulatorio SCA', '/ambulatori/icon_sca.png', '#dc2626', '#ef4444', '#fca5a5']
  );
}

async function ensureVisiteVersioningDefaults(db: Database): Promise<void> {
  await db.execute(
    `UPDATE visite
     SET is_current_version = 1
     WHERE is_current_version IS NULL`
  );
}

async function backfillFollowUpAppointments(db: Database): Promise<void> {
  const rows = await db.select<FollowUpRow[]>(
    `SELECT
       v.id,
       v.ambulatorio_id,
       v.paziente_id,
       v.pianificazione_followup,
       a.durata_standard_visita_minuti
     FROM visite v
     INNER JOIN ambulatori a ON a.id = v.ambulatorio_id
     WHERE v.pianificazione_followup IS NOT NULL
       AND TRIM(v.pianificazione_followup) <> ''`
  );

  for (const row of rows) {
    if (!row.pianificazione_followup) {
      continue;
    }

    let parsed: FollowUpPayload;
    try {
      parsed = JSON.parse(row.pianificazione_followup) as FollowUpPayload;
    } catch {
      continue;
    }

    const dataOraProssimaVisita = normalizeFollowUpDateTime(parsed.dataOraProssimaVisita);
    if (!dataOraProssimaVisita) {
      continue;
    }

    const motivoProssimaVisita =
      typeof parsed.motivoProssimaVisita === 'string' && parsed.motivoProssimaVisita.trim()
        ? parsed.motivoProssimaVisita.trim()
        : null;
    const parsedStandardDuration = Number(row.durata_standard_visita_minuti ?? DEFAULT_STANDARD_VISIT_DURATION_MINUTES);
    const durationMinutes =
      Number.isFinite(parsedStandardDuration) && parsedStandardDuration >= DEFAULT_MIN_VISIT_DURATION_MINUTES
        ? Math.floor(parsedStandardDuration)
        : DEFAULT_STANDARD_VISIT_DURATION_MINUTES;

    await db.execute(
      `INSERT OR IGNORE INTO appuntamenti (
         ambulatorio_id,
         paziente_id,
         data_ora_inizio,
         data_ora_fine,
         durata_minuti,
         motivo,
         origine,
         source_visita_id
       ) VALUES (?, ?, ?, ?, ?, ?, 'followup_visita', ?)`,
      [
        row.ambulatorio_id,
        row.paziente_id,
        dataOraProssimaVisita,
        addMinutesToDateTime(dataOraProssimaVisita, durationMinutes),
        durationMinutes,
        motivoProssimaVisita,
        row.id
      ]
    );
  }
}

async function updateLegacyAmbulatorioLabel(db: Database): Promise<void> {
  await db.execute(
    `UPDATE ambulatori
     SET nome = ?, logo_path = ?, color_primary = ?, color_secondary = ?, color_accent = ?, updated_at = CURRENT_TIMESTAMP
     WHERE nome = ?`,
    [
      'Day Hospital Riabilitativa',
      '/ambulatori/icon_dhr.png',
      '#03a19e',
      '#10ccb4',
      '#31e0c6',
      'Dermatologia'
    ]
  );
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function cleanupDanglingLegacyVisiteObjects(db: Database): Promise<void> {
  const legacyObjects = await db.select<SchemaObjectRow[]>(
    `SELECT type, name, tbl_name, sql
     FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%'
       AND (
         tbl_name = 'visite_old'
         OR (sql IS NOT NULL AND INSTR(LOWER(sql), 'visite_old') > 0)
       )`
  );

  for (const object of legacyObjects) {
    if (!object?.name) {
      continue;
    }

    const quotedName = quoteIdentifier(object.name);
    if (object.type === 'trigger') {
      await db.execute(`DROP TRIGGER IF EXISTS ${quotedName}`);
      continue;
    }

    if (object.type === 'view') {
      await db.execute(`DROP VIEW IF EXISTS ${quotedName}`);
      continue;
    }

    if (object.type === 'index') {
      await db.execute(`DROP INDEX IF EXISTS ${quotedName}`);
    }
  }
}

async function ensureFattoriRischioCvReferencesVisite(db: Database): Promise<void> {
  const foreignKeys = await db.select<Array<{ table: string; from: string }>>(
    'PRAGMA foreign_key_list(fattori_rischio_cv)'
  );
  const visitaForeignKey = foreignKeys.find((foreignKey) => foreignKey.from === 'visita_id');

  if (!visitaForeignKey || visitaForeignKey.table.toLowerCase() === 'visite') {
    return;
  }

  await db.execute('PRAGMA foreign_keys = OFF');

  try {
    await db.execute('BEGIN');
    await db.execute('DROP TABLE IF EXISTS fattori_rischio_cv_new');
    await db.execute(`
      CREATE TABLE fattori_rischio_cv_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        visita_id INTEGER NOT NULL,
        familiarita BOOLEAN DEFAULT 0,
        familiarita_note TEXT,
        ipertensione BOOLEAN DEFAULT 0,
        diabete BOOLEAN DEFAULT 0,
        diabete_durata TEXT,
        diabete_tipo TEXT DEFAULT '',
        dislipidemia BOOLEAN DEFAULT 0,
        obesita BOOLEAN DEFAULT 0,
        fumo TEXT DEFAULT '',
        fumo_ex_eta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (visita_id) REFERENCES visite(id) ON DELETE CASCADE
      )
    `);
    await db.execute(`
      INSERT INTO fattori_rischio_cv_new (
        id,
        visita_id,
        familiarita,
        familiarita_note,
        ipertensione,
        diabete,
        diabete_durata,
        diabete_tipo,
        dislipidemia,
        obesita,
        fumo,
        fumo_ex_eta,
        created_at,
        updated_at
      )
      SELECT
        id,
        visita_id,
        COALESCE(familiarita, 0),
        familiarita_note,
        COALESCE(ipertensione, 0),
        COALESCE(diabete, 0),
        diabete_durata,
        COALESCE(diabete_tipo, ''),
        COALESCE(dislipidemia, 0),
        COALESCE(obesita, 0),
        CASE
          WHEN fumo IS NULL THEN ''
          WHEN LOWER(TRIM(CAST(fumo AS TEXT))) IN ('1', 'true', 'si', 'yes') THEN 'si'
          WHEN LOWER(TRIM(CAST(fumo AS TEXT))) IN ('0', 'false', 'no') THEN ''
          ELSE TRIM(CAST(fumo AS TEXT))
        END,
        NULLIF(TRIM(COALESCE(fumo_ex_eta, '')), ''),
        COALESCE(created_at, CURRENT_TIMESTAMP),
        COALESCE(updated_at, CURRENT_TIMESTAMP)
      FROM fattori_rischio_cv
    `);
    await db.execute('DROP TABLE fattori_rischio_cv');
    await db.execute('ALTER TABLE fattori_rischio_cv_new RENAME TO fattori_rischio_cv');
    await db.execute('COMMIT');
  } catch (error) {
    try {
      await db.execute('ROLLBACK');
    } catch {
      // ignore rollback failures
    }
    throw error;
  } finally {
    await db.execute('PRAGMA foreign_keys = ON');
  }
}

export async function applyMigrations(db: Database): Promise<void> {
  await createBaseTables(db);
  await cleanupDanglingLegacyVisiteObjects(db);
  await addMissingColumns(db, 'ambulatori', ambulatoriColumns);
  await addMissingColumns(db, 'pazienti', pazientiColumns);
  await addMissingColumns(db, 'visite', visiteColumns);
  await addMissingColumns(db, 'appuntamenti', appuntamentiColumns);
  await addMissingColumns(db, 'fattori_rischio_cv', fattoriRischioColumns);
  await addMissingColumns(db, 'ambulatorio_orari', ambulatorioOrariColumns);
  await ensureVisiteVersioningDefaults(db);
  await ensureAmbulatorioStandardVisitDurationBounds(db);
  await ensureScaAmbulatorio(db);
  await ensureOperatingWindowDailyCapacityBounds(db);
  await ensureFattoriRischioCvReferencesVisite(db);
  await dropLegacyFixedSlotIndexes(db);
  await ensureIndexes(db);
  await backfillFollowUpAppointments(db);
  await backfillAppuntamentiEndDateTime(db);
  await ensureDefaultOperatingHoursForAmbulatori(db);
  await updateLegacyAmbulatorioLabel(db);
}
