import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.js';

type LegacyVisitaRow = Record<string, unknown>;
type LegacyFattoreRow = Record<string, unknown>;
type LegacyAppointmentRow = Record<string, unknown>;
const MIN_ALLOWED_VISIT_DURATION_MINUTES = 10;
const VISIT_SETTINGS_REQUIRED_MESSAGE =
  'Devi prima configurare la durata delle visite ambulatoriali nelle impostazioni.';

const LAB_EXAM_CODES = [
  'hb',
  'plt',
  'creatinina',
  'egfr',
  'colesterolo_totale',
  'hdl',
  'trigliceridi',
  'ldl_calcolato',
  'ldl_diretto',
  'lipoproteina_a',
  'emoglobina_glicata',
  'glicemia',
  'ast',
  'alt',
  'bilirubina_totale',
  'cpk'
] as const;

type LabExamCode = (typeof LAB_EXAM_CODES)[number];

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function normalizeNullableText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 't';
  }

  return false;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Data visita non valida');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Data visita non valida');
  }

  return trimmed;
}

function mapOrigin(value: unknown): 'manual' | 'followup_visit' {
  return value === 'followup_visita' ? 'followup_visit' : 'manual';
}

function mapLegacyOrigin(value: unknown): 'manuale' | 'followup_visita' {
  return value === 'followup_visit' ? 'followup_visita' : 'manuale';
}

function createVisitSettingsRequiredError(): Error & { statusCode: number } {
  const error = new Error(VISIT_SETTINGS_REQUIRED_MESSAGE) as Error & { statusCode: number };
  error.statusCode = 400;
  return error;
}

function normalizeAppointmentDurationMinutes(value: unknown): number {
  const durationMinutes = Number(value);
  if (
    !Number.isFinite(durationMinutes) ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < MIN_ALLOWED_VISIT_DURATION_MINUTES
  ) {
    throw new Error(
      `Durata appuntamento non valida: minimo ${MIN_ALLOWED_VISIT_DURATION_MINUTES} minuti.`
    );
  }

  return durationMinutes;
}

function getDurationMinutes(startAt: string, endAt: string): number {
  const start = new Date(startAt);
  const end = new Date(endAt);
  return normalizeAppointmentDurationMinutes(Math.round((end.getTime() - start.getTime()) / 60000));
}

function addMinutesToDateTime(value: string, minutes: number): string {
  const date = new Date(normalizeTimestamp(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Data/ora non valida: ${value}`);
  }

  date.setMinutes(date.getMinutes() + minutes);
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function parseFollowUpScheduling(rawValue: unknown): {
  dataOraProssimaVisita: string;
  motivoProssimaVisita: string;
} | null {
  const parsed = parseJsonRecord(rawValue);
  const dataOraProssimaVisita = normalizeNullableText(parsed.dataOraProssimaVisita);
  if (!dataOraProssimaVisita) {
    return null;
  }

  return {
    dataOraProssimaVisita,
    motivoProssimaVisita: normalizeText(parsed.motivoProssimaVisita)
  };
}

function normalizeFollowUpMotivo(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isSameFollowUpSchedule(
  left: { dataOraProssimaVisita: string; motivoProssimaVisita: string } | null,
  right: { dataOraProssimaVisita: string; motivoProssimaVisita: string } | null
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    left.dataOraProssimaVisita === right.dataOraProssimaVisita &&
    normalizeFollowUpMotivo(left.motivoProssimaVisita) === normalizeFollowUpMotivo(right.motivoProssimaVisita)
  );
}

function hasMeaningfulFattoriRischioCV(input: Record<string, unknown> | null | undefined): boolean {
  if (!input) {
    return false;
  }

  return (
    Boolean(input.familiarita) ||
    Boolean(input.ipertensione) ||
    Boolean(input.diabete) ||
    Boolean(input.dislipidemia) ||
    Boolean(input.obesita) ||
    Boolean(normalizeNullableText(input.familiarita_note)) ||
    Boolean(normalizeNullableText(input.diabete_durata)) ||
    Boolean(normalizeNullableText(input.diabete_tipo)) ||
    Boolean(normalizeNullableText(input.fumo)) ||
    Boolean(normalizeNullableText(input.fumo_ex_eta))
  );
}

async function getPatientInternalIdByLegacy(client: PoolClient, legacyId: number): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT id
     FROM patient.patient
     WHERE legacy_id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [legacyId]
  );

  const patientId = result.rows[0]?.id;
  if (!patientId) {
    throw new Error(`Paziente ${legacyId} non trovato`);
  }

  return patientId;
}

async function ensureAmbulatorioVisitTimingSettingsConfigured(
  client: PoolClient,
  ambulatorioId: number
): Promise<{ minDurationMinutes: number; standardDurationMinutes: number }> {
  const settings = await client.query<{
    min_visit_minutes: number | null;
    standard_visit_minutes: number | null;
  }>(
    `SELECT min_visit_minutes, standard_visit_minutes
     FROM org.ambulatorio_settings
     WHERE ambulatorio_id = $1
     LIMIT 1`,
    [ambulatorioId]
  );

  const minDurationMinutes = Number(settings.rows[0]?.min_visit_minutes);
  const standardDurationMinutes = Number(settings.rows[0]?.standard_visit_minutes);

  if (
    !Number.isInteger(minDurationMinutes) ||
    minDurationMinutes < MIN_ALLOWED_VISIT_DURATION_MINUTES ||
    !Number.isInteger(standardDurationMinutes) ||
    standardDurationMinutes < minDurationMinutes
  ) {
    throw createVisitSettingsRequiredError();
  }

  const windows = await client.query<{ has_window: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM org.ambulatorio_operating_window ow
       WHERE ow.ambulatorio_id = $1
         AND ow.start_time < ow.end_time
     ) AS has_window`,
    [ambulatorioId]
  );

  if (!windows.rows[0]?.has_window) {
    throw createVisitSettingsRequiredError();
  }

  return {
    minDurationMinutes,
    standardDurationMinutes
  };
}

async function getUserInternalIdByLegacy(
  client: PoolClient,
  legacyId: number | null | undefined,
  fallbackUserId: string
): Promise<string> {
  if (!legacyId) {
    return fallbackUserId;
  }

  const result = await client.query<{ id: string }>(
    `SELECT id
     FROM iam.app_user
     WHERE legacy_id = $1
     LIMIT 1`,
    [legacyId]
  );

  return result.rows[0]?.id ?? fallbackUserId;
}

async function getRevisionByLegacyId(client: PoolClient, legacyId: number): Promise<{
  id: string;
  encounter_id: string;
} | null> {
  const result = await client.query<{ id: string; encounter_id: string }>(
    `SELECT id, encounter_id
     FROM clinical.encounter_revision
     WHERE legacy_id = $1
     LIMIT 1`,
    [legacyId]
  );

  return result.rows[0] ?? null;
}

async function getRevisionIdByLegacy(client: PoolClient, legacyId: number | null | undefined): Promise<string | null> {
  if (!legacyId) {
    return null;
  }

  const row = await getRevisionByLegacyId(client, legacyId);
  return row?.id ?? null;
}

function parseLabResultRows(rawValue: unknown): Array<{
  exam_code: LabExamCode;
  exam_date: string | null;
  value_text: string | null;
}> {
  const parsed = parseJsonRecord(rawValue);
  const examDateRaw = parsed.data_ee;
  const examDate = typeof examDateRaw === 'string' && examDateRaw.trim() ? examDateRaw.trim() : null;

  return LAB_EXAM_CODES.map((examCode) => {
    const value = parsed[examCode];
    const valueText = typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value);

    return {
      exam_code: examCode,
      exam_date: examDate,
      value_text: valueText || null
    };
  });
}

function parseFirmeVisita(rawValue: unknown): Array<{
  sign_role: 'cardiologo' | 'medico_formazione';
  full_name: string;
  title: 'dott' | 'dott.ssa';
  display_order: number;
}> {
  const parsed = parseJsonRecord(rawValue);
  const cardiologoNome = normalizeText(parsed.cardiologoNome).trim();
  const cardiologoTitolo = normalizeText(parsed.cardiologoTitolo).trim() === 'dott.ssa' ? 'dott.ssa' : 'dott';

  const signatures: Array<{
    sign_role: 'cardiologo' | 'medico_formazione';
    full_name: string;
    title: 'dott' | 'dott.ssa';
    display_order: number;
  }> = [];

  if (cardiologoNome) {
    signatures.push({
      sign_role: 'cardiologo',
      full_name: cardiologoNome,
      title: cardiologoTitolo,
      display_order: 1
    });
  }

  const mediciInFormazione = Array.isArray(parsed.mediciInFormazione)
    ? parsed.mediciInFormazione
    : [];

  for (let index = 0; index < mediciInFormazione.length; index += 1) {
    const raw = mediciInFormazione[index];
    if (!raw || typeof raw !== 'object') {
      continue;
    }

    const nome = normalizeText((raw as Record<string, unknown>).nome).trim();
    if (!nome) {
      continue;
    }

    const titoloRaw = normalizeText((raw as Record<string, unknown>).titolo).trim();
    const titolo = titoloRaw === 'dott.ssa' ? 'dott.ssa' : 'dott';

    signatures.push({
      sign_role: 'medico_formazione',
      full_name: nome,
      title: titolo,
      display_order: index + 1
    });
  }

  return signatures;
}

function parseFollowup(rawValue: unknown): {
  followup_at: string | null;
  followup_reason: string | null;
  followup_tests: string | null;
} {
  const parsed = parseJsonRecord(rawValue);
  return {
    followup_at: normalizeNullableText(parsed.dataOraProssimaVisita),
    followup_reason: normalizeNullableText(parsed.motivoProssimaVisita),
    followup_tests: normalizeNullableText(parsed.esamiEmaticiDaFare)
  };
}

async function upsertSingleRow(
  client: PoolClient,
  tableName: string,
  revisionId: string,
  columns: Record<string, unknown>
): Promise<void> {
  const keys = Object.keys(columns);
  if (keys.length === 0) {
    return;
  }

  const columnList = ['revision_id', ...keys];
  const placeholders = columnList.map((_, index) => `$${index + 1}`);
  const values = [revisionId, ...keys.map((key) => columns[key])];
  const updates = keys.map((key) => `${key} = EXCLUDED.${key}`);

  await client.query(
    `INSERT INTO ${tableName} (${columnList.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (revision_id)
     DO UPDATE SET ${updates.join(', ')}`,
    values
  );
}

async function applyLegacyVisitaBlocks(
  client: PoolClient,
  revisionId: string,
  payload: Record<string, unknown>,
  applyAll: boolean
): Promise<void> {
  const applyIfPresent = (field: string) => applyAll || hasOwn(payload, field);

  if (applyIfPresent('altezza') || applyIfPresent('peso') || applyIfPresent('bmi') || applyIfPresent('bsa')) {
    await upsertSingleRow(client, 'clinical.encounter_anthropometrics', revisionId, {
      height_cm: payload.altezza ?? null,
      weight_kg: payload.peso ?? null,
      bmi: payload.bmi ?? null,
      bsa: payload.bsa ?? null
    });
  }

  if (applyIfPresent('anamnesi_cardiologica') || applyIfPresent('anamnesi_internistica')) {
    await upsertSingleRow(client, 'clinical.encounter_anamnesis', revisionId, {
      cardiologica_text: normalizeNullableText(payload.anamnesi_cardiologica),
      internistica_text: normalizeNullableText(payload.anamnesi_internistica)
    });
  }

  if (applyIfPresent('terapia_domiciliare')) {
    await upsertSingleRow(client, 'clinical.encounter_home_therapy', revisionId, {
      content_text: normalizeNullableText(payload.terapia_domiciliare)
    });
  }

  if (applyIfPresent('valutazione_odierna')) {
    await upsertSingleRow(client, 'clinical.encounter_current_evaluation', revisionId, {
      content_text: normalizeNullableText(payload.valutazione_odierna)
    });
  }

  if (applyIfPresent('esami_ematici')) {
    const labRows = parseLabResultRows(payload.esami_ematici);
    await client.query('DELETE FROM clinical.encounter_lab_result WHERE revision_id = $1', [revisionId]);

    for (const row of labRows) {
      await client.query(
        `INSERT INTO clinical.encounter_lab_result(
          revision_id,
          exam_code,
          exam_date,
          value_text,
          value_numeric,
          unit
        ) VALUES ($1,$2,$3,$4,NULL,NULL)`,
        [revisionId, row.exam_code, row.exam_date, row.value_text]
      );
    }
  }

  if (applyIfPresent('ecocardiografia')) {
    await upsertSingleRow(client, 'clinical.encounter_echocardiography', revisionId, {
      schema_version: 1,
      payload_jsonb: JSON.stringify(parseJsonRecord(payload.ecocardiografia))
    });
  }

  if (applyIfPresent('fh_assessment')) {
    const fh = parseJsonRecord(payload.fh_assessment);
    await upsertSingleRow(client, 'clinical.encounter_fh_assessment', revisionId, {
      enabled: normalizeBoolean(fh.enabled),
      family_history_one_point: normalizeBoolean(fh.familyHistoryOnePoint),
      family_history_two_points: normalizeBoolean(fh.familyHistoryTwoPoints),
      clinical_premature_cad: normalizeBoolean(fh.clinicalPrematureCAD),
      clinical_premature_cerebral_or_peripheral: normalizeBoolean(fh.clinicalPrematureCerebralOrPeripheral),
      physical_tendon_xanthomas: normalizeBoolean(fh.physicalTendonXanthomas),
      physical_corneal_arcus_before45: normalizeBoolean(fh.physicalCornealArcusBefore45),
      untreated_ldl_range: normalizeText(fh.untreatedLdlRange),
      genetic_mutation: normalizeBoolean(fh.geneticMutation),
      total_score: Number(fh.totalScore ?? 0),
      classification: normalizeText(fh.classification) || 'Improbabile'
    });
  }

  if (applyIfPresent('terapia_ipolipemizzante')) {
    const terapia = parseJsonRecord(payload.terapia_ipolipemizzante);
    const getSection = (key: string) => {
      const section = terapia[key];
      return section && typeof section === 'object' ? (section as Record<string, unknown>) : {};
    };

    const statine = getSection('statine');
    const ezetimibe = getSection('ezetimibe');
    const fibrati = getSection('fibrati');
    const omega3 = getSection('omega3');
    const acidoBempedoico = getSection('acido_bempedoico');
    const repatha = getSection('repatha');
    const praluent = getSection('praluent');
    const leqvio = getSection('leqvio');

    await upsertSingleRow(client, 'clinical.encounter_lipid_therapy', revisionId, {
      statin_enabled: normalizeBoolean(statine.enabled),
      statin_dose: normalizeText(statine.dose),
      ezetimibe_enabled: normalizeBoolean(ezetimibe.enabled),
      ezetimibe_mode: normalizeText(ezetimibe.modalita),
      fibrati_enabled: normalizeBoolean(fibrati.enabled),
      fibrati_dose: normalizeText(fibrati.dose),
      omega3_enabled: normalizeBoolean(omega3.enabled),
      omega3_dose: normalizeText(omega3.dose),
      acido_bempedoico_enabled: normalizeBoolean(acidoBempedoico.enabled),
      acido_bempedoico_dose: normalizeText(acidoBempedoico.dose),
      repatha_enabled: normalizeBoolean(repatha.enabled),
      repatha_dose: normalizeText(repatha.dose),
      praluent_enabled: normalizeBoolean(praluent.enabled),
      praluent_dose: normalizeText(praluent.dose),
      leqvio_enabled: normalizeBoolean(leqvio.enabled),
      leqvio_dose: normalizeText(leqvio.dose)
    });
  }

  if (applyIfPresent('valutazione_rischio_cv')) {
    const valutazione = parseJsonRecord(payload.valutazione_rischio_cv);
    await upsertSingleRow(client, 'clinical.encounter_cv_risk_evaluation', revisionId, {
      risk_level: normalizeText(valutazione.rischio),
      target_ldl: valutazione.targetLdl ?? null,
      current_ldl: valutazione.ldlAttuale ?? null,
      ldl_source: normalizeText(valutazione.ldlSource),
      status: normalizeText(valutazione.status) || 'non_valutabile',
      status_message: normalizeText(valutazione.statusMessage)
    });
  }

  if (
    applyIfPresent('conclusioni') ||
    applyIfPresent('diagnosi') ||
    applyIfPresent('note') ||
    applyIfPresent('pianificazione_followup')
  ) {
    const followup = parseFollowup(payload.pianificazione_followup);
    await upsertSingleRow(client, 'clinical.encounter_conclusion', revisionId, {
      conclusion_text: normalizeNullableText(payload.conclusioni),
      diagnosis_text: normalizeNullableText(payload.diagnosi),
      note_text: normalizeNullableText(payload.note),
      followup_at: followup.followup_at,
      followup_reason: followup.followup_reason,
      followup_tests: followup.followup_tests
    });
  }

  if (applyIfPresent('firme_visita')) {
    const signatures = parseFirmeVisita(payload.firme_visita);
    await client.query('DELETE FROM clinical.encounter_signature WHERE revision_id = $1', [revisionId]);

    for (const signature of signatures) {
      await client.query(
        `INSERT INTO clinical.encounter_signature(
          revision_id,
          sign_role,
          full_name,
          title,
          display_order
        ) VALUES ($1,$2,$3,$4,$5)`,
        [
          revisionId,
          signature.sign_role,
          signature.full_name,
          signature.title,
          signature.display_order
        ]
      );
    }
  }

  if (
    applyAll ||
    hasOwn(payload, 'anamnesi') ||
    hasOwn(payload, 'esame_obiettivo') ||
    hasOwn(payload, 'diagnosi') ||
    hasOwn(payload, 'terapia') ||
    hasOwn(payload, 'note')
  ) {
    await client.query(
      `INSERT INTO clinical.encounter_legacy_payload(revision_id, source, payload_jsonb)
       VALUES ($1, 'legacy_adapter', $2::jsonb)`,
      [
        revisionId,
        JSON.stringify({
          anamnesi: normalizeText(payload.anamnesi),
          esame_obiettivo: normalizeText(payload.esame_obiettivo),
          diagnosi: normalizeText(payload.diagnosi),
          terapia: normalizeText(payload.terapia),
          note: normalizeText(payload.note)
        })
      ]
    );
  }
}

async function getStandardVisitDurationByAmbulatorio(client: PoolClient, ambulatorioId: number): Promise<number> {
  const settings = await ensureAmbulatorioVisitTimingSettingsConfigured(client, ambulatorioId);
  return settings.standardDurationMinutes;
}

async function getLegacyVisitaByIdTx(client: PoolClient, legacyId: number): Promise<LegacyVisitaRow | null> {
  const result = await client.query<LegacyVisitaRow>(
    `SELECT *
     FROM compat.visite
     WHERE id = $1
     LIMIT 1`,
    [legacyId]
  );

  return result.rows[0] ?? null;
}

async function getLegacyAppointmentBySourceVisitaIdTx(
  client: PoolClient,
  legacyVisitaId: number
): Promise<LegacyAppointmentRow | null> {
  const result = await client.query<LegacyAppointmentRow>(
    `SELECT *
     FROM compat.appuntamenti
     WHERE source_visita_id = $1
     LIMIT 1`,
    [legacyVisitaId]
  );

  return result.rows[0] ?? null;
}

async function createLegacyVisitaTx(
  client: PoolClient,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<number> {
  const ambulatorioId = Number(input.ambulatorio_id ?? 0);
  const pazienteLegacyId = Number(input.paziente_id ?? 0);
  const medicoLegacyId = input.medico_id !== undefined ? Number(input.medico_id) : null;

  if (!Number.isInteger(ambulatorioId) || ambulatorioId <= 0) {
    throw new Error('ambulatorio_id non valido');
  }

  if (!Number.isInteger(pazienteLegacyId) || pazienteLegacyId <= 0) {
    throw new Error('paziente_id non valido');
  }

  const patientId = await getPatientInternalIdByLegacy(client, pazienteLegacyId);
  const authorUserId = await getUserInternalIdByLegacy(client, medicoLegacyId, actorUserId);

  const previousVersionLegacyId =
    input.previous_version_id !== undefined && input.previous_version_id !== null
      ? Number(input.previous_version_id)
      : null;

  let encounterId: string;
  let supersedesRevisionId: string | null = null;
  let nextRevisionNo = 1;

  if (previousVersionLegacyId && Number.isInteger(previousVersionLegacyId)) {
    const previous = await getRevisionByLegacyId(client, previousVersionLegacyId);
    if (!previous) {
      throw new Error(`Visita precedente ${previousVersionLegacyId} non trovata`);
    }

    encounterId = previous.encounter_id;
    supersedesRevisionId = previous.id;

    await client.query(
      `SELECT id
       FROM clinical.encounter
       WHERE id = $1
       FOR UPDATE`,
      [encounterId]
    );

    const revisionNoResult = await client.query<{ max_revision_no: number }>(
      `SELECT COALESCE(MAX(revision_no), 0) AS max_revision_no
       FROM clinical.encounter_revision
       WHERE encounter_id = $1`,
      [encounterId]
    );
    nextRevisionNo = Number(revisionNoResult.rows[0]?.max_revision_no ?? 0) + 1;
  } else {
    const encounterInsert = await client.query<{ id: string }>(
      `INSERT INTO clinical.encounter(
        ambulatorio_id,
        patient_id,
        status,
        created_by
      ) VALUES ($1,$2,'completed',$3)
      RETURNING id`,
      [ambulatorioId, patientId, actorUserId]
    );

    const encounterRow = encounterInsert.rows[0];
    if (!encounterRow?.id) {
      throw new Error('Impossibile creare encounter');
    }
    encounterId = encounterRow.id;
  }

  const revisionInsert = await client.query<{ id: string; legacy_id: number }>(
    `INSERT INTO clinical.encounter_revision(
      encounter_id,
      revision_no,
      supersedes_revision_id,
      visit_at,
      visit_type,
      reason,
      author_user_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id, legacy_id`,
    [
      encounterId,
      nextRevisionNo,
      supersedesRevisionId,
      normalizeTimestamp(input.data_visita),
      normalizeText(input.tipo_visita) || 'Visita',
      normalizeText(input.motivo) || '-',
      authorUserId
    ]
  );

  const revisionRow = revisionInsert.rows[0];
  if (!revisionRow?.id) {
    throw new Error('Impossibile creare revisione visita');
  }

  await client.query(
    `UPDATE clinical.encounter
     SET current_revision_id = $1,
         updated_at = now()
     WHERE id = $2`,
    [revisionRow.id, encounterId]
  );

  await applyLegacyVisitaBlocks(client, revisionRow.id, input, true);

  return Number(revisionRow.legacy_id);
}

async function updateLegacyVisitaTx(
  client: PoolClient,
  legacyId: number,
  patch: Record<string, unknown>,
  actorUserId: string
): Promise<void> {
  const revision = await getRevisionByLegacyId(client, legacyId);
  if (!revision) {
    throw new Error(`Visita ${legacyId} non trovata`);
  }

  if (hasOwn(patch, 'ambulatorio_id') || hasOwn(patch, 'paziente_id')) {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (hasOwn(patch, 'ambulatorio_id')) {
      values.push(Number(patch.ambulatorio_id ?? 0));
      setClauses.push(`ambulatorio_id = $${values.length}`);
    }

    if (hasOwn(patch, 'paziente_id')) {
      const patientId = await getPatientInternalIdByLegacy(client, Number(patch.paziente_id ?? 0));
      values.push(patientId);
      setClauses.push(`patient_id = $${values.length}`);
    }

    if (setClauses.length > 0) {
      values.push(revision.encounter_id);
      await client.query(
        `UPDATE clinical.encounter
         SET ${setClauses.join(', ')},
             updated_at = now()
         WHERE id = $${values.length}`,
        values
      );
    }
  }

  if (
    hasOwn(patch, 'data_visita') ||
    hasOwn(patch, 'tipo_visita') ||
    hasOwn(patch, 'motivo') ||
    hasOwn(patch, 'medico_id') ||
    hasOwn(patch, 'previous_version_id')
  ) {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (hasOwn(patch, 'data_visita')) {
      values.push(normalizeTimestamp(patch.data_visita));
      setClauses.push(`visit_at = $${values.length}`);
    }

    if (hasOwn(patch, 'tipo_visita')) {
      values.push(normalizeText(patch.tipo_visita) || 'Visita');
      setClauses.push(`visit_type = $${values.length}`);
    }

    if (hasOwn(patch, 'motivo')) {
      values.push(normalizeText(patch.motivo) || '-');
      setClauses.push(`reason = $${values.length}`);
    }

    if (hasOwn(patch, 'medico_id')) {
      const authorUserId = await getUserInternalIdByLegacy(
        client,
        Number(patch.medico_id ?? 0),
        actorUserId
      );
      values.push(authorUserId);
      setClauses.push(`author_user_id = $${values.length}`);
    }

    if (hasOwn(patch, 'previous_version_id')) {
      const supersedesRevisionId = await getRevisionIdByLegacy(
        client,
        patch.previous_version_id === null ? null : Number(patch.previous_version_id)
      );
      values.push(supersedesRevisionId);
      setClauses.push(`supersedes_revision_id = $${values.length}`);
    }

    if (setClauses.length > 0) {
      values.push(revision.id);
      await client.query(
        `UPDATE clinical.encounter_revision
         SET ${setClauses.join(', ')}
         WHERE id = $${values.length}`,
        values
      );
    }
  }

  if (hasOwn(patch, 'is_current_version')) {
    const isCurrent = Number(patch.is_current_version ?? 1) === 1;
    if (isCurrent) {
      await client.query(
        `UPDATE clinical.encounter
         SET current_revision_id = $1,
             updated_at = now()
         WHERE id = $2`,
        [revision.id, revision.encounter_id]
      );
    } else {
      const currentResult = await client.query<{ current_revision_id: string | null }>(
        `SELECT current_revision_id
         FROM clinical.encounter
         WHERE id = $1
         LIMIT 1`,
        [revision.encounter_id]
      );

      const currentRevisionId = currentResult.rows[0]?.current_revision_id;
      if (currentRevisionId === revision.id) {
        const fallback = await client.query<{ id: string }>(
          `SELECT id
           FROM clinical.encounter_revision
           WHERE encounter_id = $1
             AND id <> $2
           ORDER BY revision_no DESC
           LIMIT 1`,
          [revision.encounter_id, revision.id]
        );

        await client.query(
          `UPDATE clinical.encounter
           SET current_revision_id = $1,
               updated_at = now()
           WHERE id = $2`,
          [fallback.rows[0]?.id ?? null, revision.encounter_id]
        );
      }
    }
  }

  await applyLegacyVisitaBlocks(client, revision.id, patch, false);
}

async function upsertLegacyFattoreByVisitaTx(
  client: PoolClient,
  visitaId: number,
  input: Record<string, unknown>
): Promise<void> {
  const revisionId = await getRevisionIdByLegacy(client, visitaId);
  if (!revisionId) {
    throw new Error(`Visita ${visitaId} non trovata`);
  }

  await upsertSingleRow(client, 'clinical.encounter_cv_risk_factor', revisionId, {
    familiarita: normalizeBoolean(input.familiarita),
    familiarita_note: normalizeNullableText(input.familiarita_note),
    ipertensione: normalizeBoolean(input.ipertensione),
    diabete: normalizeBoolean(input.diabete),
    diabete_durata: normalizeNullableText(input.diabete_durata),
    diabete_tipo: normalizeText(input.diabete_tipo),
    dislipidemia: normalizeBoolean(input.dislipidemia),
    obesita: normalizeBoolean(input.obesita),
    fumo: normalizeText(input.fumo),
    fumo_ex_eta: normalizeNullableText(input.fumo_ex_eta)
  });
}

async function createLegacyAppointmentTx(
  client: PoolClient,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<number> {
  const ambulatorioId = Number(input.ambulatorio_id ?? 0);
  const pazienteLegacyId = Number(input.paziente_id ?? 0);
  const startAt = normalizeTimestamp(input.data_ora_inizio);
  const endAt = normalizeTimestamp(input.data_ora_fine);

  if (!Number.isInteger(ambulatorioId) || ambulatorioId <= 0) {
    throw new Error('ambulatorio_id non valido');
  }

  const visitTimingSettings = await ensureAmbulatorioVisitTimingSettingsConfigured(client, ambulatorioId);

  const patientId = await getPatientInternalIdByLegacy(client, pazienteLegacyId);
  const sourceRevisionId = await getRevisionIdByLegacy(
    client,
    input.source_visita_id === null || input.source_visita_id === undefined
      ? null
      : Number(input.source_visita_id)
  );

  const durationMinutes =
    input.durata_minuti !== undefined
      ? normalizeAppointmentDurationMinutes(input.durata_minuti)
      : getDurationMinutes(startAt, endAt);
  if (durationMinutes < visitTimingSettings.minDurationMinutes) {
    throw new Error(
      `Durata appuntamento non valida: minimo ${visitTimingSettings.minDurationMinutes} minuti per questo ambulatorio.`
    );
  }

  const result = await client.query<{ legacy_id: number }>(
    `INSERT INTO scheduling.appointment(
      ambulatorio_id,
      patient_id,
      start_at,
      end_at,
      duration_minutes,
      status,
      reason,
      origin,
      source_encounter_revision_id,
      created_by,
      updated_by
    ) VALUES ($1,$2,($3::timestamp AT TIME ZONE 'Europe/Rome'),($4::timestamp AT TIME ZONE 'Europe/Rome'),$5,'scheduled',$6,$7,$8,$9,$9)
    RETURNING legacy_id`,
    [
      ambulatorioId,
      patientId,
      startAt,
      endAt,
      durationMinutes,
      normalizeNullableText(input.motivo),
      mapOrigin(input.origine),
      sourceRevisionId,
      actorUserId
    ]
  );

  return Number(result.rows[0]?.legacy_id ?? 0);
}

async function updateLegacyAppointmentSourceVisitaIdTx(
  client: PoolClient,
  legacyAppointmentId: number,
  sourceVisitaId: number,
  actorUserId: string
): Promise<void> {
  const sourceRevisionId = await getRevisionIdByLegacy(client, sourceVisitaId);

  await client.query(
    `UPDATE scheduling.appointment
     SET source_encounter_revision_id = $1,
         updated_by = $2,
         updated_at = now()
     WHERE legacy_id = $3
       AND deleted_at IS NULL`,
    [sourceRevisionId, actorUserId, legacyAppointmentId]
  );
}

async function deleteLegacyAppointmentTx(
  client: PoolClient,
  legacyAppointmentId: number,
  actorUserId: string
): Promise<void> {
  await client.query(
    `UPDATE scheduling.appointment
     SET deleted_at = now(),
         updated_by = $1,
         updated_at = now()
     WHERE legacy_id = $2
       AND deleted_at IS NULL`,
    [actorUserId, legacyAppointmentId]
  );
}

export async function listLegacyVisite(params: {
  ambulatorio_id?: number;
  paziente_id?: number;
  search?: string;
  current_only?: boolean;
}): Promise<LegacyVisitaRow[]> {
  const values: unknown[] = [];
  const where: string[] = ['TRUE'];

  if (params.ambulatorio_id) {
    values.push(params.ambulatorio_id);
    where.push(`ambulatorio_id = $${values.length}`);
  }

  if (params.paziente_id) {
    values.push(params.paziente_id);
    where.push(`paziente_id = $${values.length}`);
  }

  if (params.current_only) {
    where.push('COALESCE(is_current_version, 1) = 1');
  }

  if (params.search && params.search.trim()) {
    values.push(`%${params.search.trim()}%`);
    where.push(
      `(paziente_nome ILIKE $${values.length} OR paziente_cognome ILIKE $${values.length} OR motivo ILIKE $${values.length} OR diagnosi ILIKE $${values.length})`
    );
  }

  const result = await query<LegacyVisitaRow>(
    `SELECT *
     FROM compat.visite
     WHERE ${where.join(' AND ')}
     ORDER BY data_visita DESC, id DESC`,
    values
  );

  return result.rows;
}

export async function getLegacyVisitaById(id: number): Promise<LegacyVisitaRow | null> {
  const result = await query<LegacyVisitaRow>(
    `SELECT *
     FROM compat.visite
     WHERE id = $1
     LIMIT 1`,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function createLegacyVisita(input: Record<string, unknown>, actorUserId: string): Promise<number> {
  return withTransaction(async (client) => createLegacyVisitaTx(client, input, actorUserId));
}

export async function updateLegacyVisita(
  legacyId: number,
  patch: Record<string, unknown>,
  actorUserId: string
): Promise<void> {
  await withTransaction(async (client) => updateLegacyVisitaTx(client, legacyId, patch, actorUserId));
}

export async function deleteLegacyVisita(legacyId: number): Promise<void> {
  await withTransaction(async (client) => {
    const revision = await getRevisionByLegacyId(client, legacyId);
    if (!revision) {
      return;
    }

    await client.query(
      `UPDATE clinical.encounter
       SET deleted_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [revision.encounter_id]
    );
  });
}

export async function listLegacyFattoriByVisitaIds(visitaIds: number[]): Promise<LegacyFattoreRow[]> {
  if (visitaIds.length === 0) {
    return [];
  }

  const values: unknown[] = [];
  const placeholders = visitaIds.map((id) => {
    values.push(id);
    return `$${values.length}`;
  });

  const result = await query<LegacyFattoreRow>(
    `SELECT *
     FROM compat.fattori_rischio_cv
     WHERE visita_id IN (${placeholders.join(', ')})`,
    values
  );

  return result.rows;
}

export async function getLegacyFattoreByVisitaId(visitaId: number): Promise<LegacyFattoreRow | null> {
  const result = await query<LegacyFattoreRow>(
    `SELECT *
     FROM compat.fattori_rischio_cv
     WHERE visita_id = $1
     LIMIT 1`,
    [visitaId]
  );

  return result.rows[0] ?? null;
}

export async function upsertLegacyFattore(input: Record<string, unknown>): Promise<number> {
  return withTransaction(async (client) => {
    const visitaId = Number(input.visita_id ?? 0);
    if (!Number.isInteger(visitaId) || visitaId <= 0) {
      throw new Error('visita_id non valido');
    }

    await upsertLegacyFattoreByVisitaTx(client, visitaId, input);

    return visitaId;
  });
}

export async function updateLegacyFattore(legacyId: number, patch: Record<string, unknown>): Promise<void> {
  await withTransaction(async (client) => {
    const revisionId = await getRevisionIdByLegacy(client, legacyId);
    if (!revisionId) {
      throw new Error(`Fattore rischio visita ${legacyId} non trovato`);
    }

    const columns: Record<string, unknown> = {};

    if (hasOwn(patch, 'familiarita')) columns.familiarita = normalizeBoolean(patch.familiarita);
    if (hasOwn(patch, 'familiarita_note')) columns.familiarita_note = normalizeNullableText(patch.familiarita_note);
    if (hasOwn(patch, 'ipertensione')) columns.ipertensione = normalizeBoolean(patch.ipertensione);
    if (hasOwn(patch, 'diabete')) columns.diabete = normalizeBoolean(patch.diabete);
    if (hasOwn(patch, 'diabete_durata')) columns.diabete_durata = normalizeNullableText(patch.diabete_durata);
    if (hasOwn(patch, 'diabete_tipo')) columns.diabete_tipo = normalizeText(patch.diabete_tipo);
    if (hasOwn(patch, 'dislipidemia')) columns.dislipidemia = normalizeBoolean(patch.dislipidemia);
    if (hasOwn(patch, 'obesita')) columns.obesita = normalizeBoolean(patch.obesita);
    if (hasOwn(patch, 'fumo')) columns.fumo = normalizeText(patch.fumo);
    if (hasOwn(patch, 'fumo_ex_eta')) columns.fumo_ex_eta = normalizeNullableText(patch.fumo_ex_eta);

    if (Object.keys(columns).length === 0) {
      return;
    }

    await upsertSingleRow(client, 'clinical.encounter_cv_risk_factor', revisionId, columns);
  });
}

export async function deleteLegacyFattoreByVisitaId(visitaId: number): Promise<void> {
  await withTransaction(async (client) => {
    const revisionId = await getRevisionIdByLegacy(client, visitaId);
    if (!revisionId) {
      return;
    }

    await client.query(
      `DELETE FROM clinical.encounter_cv_risk_factor
       WHERE revision_id = $1`,
      [revisionId]
    );
  });
}

export async function listLegacyAppointments(params: {
  ambulatorio_id?: number;
  from?: string;
  to?: string;
  source_visita_id?: number;
}): Promise<LegacyAppointmentRow[]> {
  const values: unknown[] = [];
  const where: string[] = ['TRUE'];

  if (params.ambulatorio_id) {
    values.push(params.ambulatorio_id);
    where.push(`ambulatorio_id = $${values.length}`);
  }

  if (params.from) {
    values.push(params.from);
    where.push(`data_ora_fine > $${values.length}`);
  }

  if (params.to) {
    values.push(params.to);
    where.push(`data_ora_inizio < $${values.length}`);
  }

  if (params.source_visita_id) {
    values.push(params.source_visita_id);
    where.push(`source_visita_id = $${values.length}`);
  }

  const result = await query<LegacyAppointmentRow>(
    `SELECT *
     FROM compat.appuntamenti
     WHERE ${where.join(' AND ')}
     ORDER BY data_ora_inizio ASC, id ASC`,
    values
  );

  return result.rows;
}

export async function getLegacyAppointmentById(id: number): Promise<LegacyAppointmentRow | null> {
  const result = await query<LegacyAppointmentRow>(
    `SELECT *
     FROM compat.appuntamenti
     WHERE id = $1
     LIMIT 1`,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function getLegacyAppointmentBySourceVisitaId(visitaId: number): Promise<LegacyAppointmentRow | null> {
  const result = await query<LegacyAppointmentRow>(
    `SELECT *
     FROM compat.appuntamenti
     WHERE source_visita_id = $1
     LIMIT 1`,
    [visitaId]
  );

  return result.rows[0] ?? null;
}

export async function createLegacyAppointment(
  input: Record<string, unknown>,
  actorUserId: string
): Promise<number> {
  return withTransaction(async (client) => createLegacyAppointmentTx(client, input, actorUserId));
}

export async function updateLegacyAppointment(
  legacyId: number,
  patch: Record<string, unknown>,
  actorUserId: string
): Promise<void> {
  await withTransaction(async (client) => {
    const appointmentLookup = await client.query<{ id: string; ambulatorio_id: number }>(
      `SELECT id, ambulatorio_id
       FROM scheduling.appointment
       WHERE legacy_id = $1
         AND deleted_at IS NULL
       LIMIT 1`,
      [legacyId]
    );

    const appointmentId = appointmentLookup.rows[0]?.id;
    const ambulatorioId = Number(appointmentLookup.rows[0]?.ambulatorio_id);
    if (!appointmentId || !Number.isInteger(ambulatorioId) || ambulatorioId <= 0) {
      throw new Error(`Appuntamento ${legacyId} non trovato`);
    }

    const visitTimingSettings = await ensureAmbulatorioVisitTimingSettingsConfigured(client, ambulatorioId);

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (hasOwn(patch, 'paziente_id')) {
      const patientId = await getPatientInternalIdByLegacy(client, Number(patch.paziente_id ?? 0));
      values.push(patientId);
      setClauses.push(`patient_id = $${values.length}`);
    }

    if (hasOwn(patch, 'data_ora_inizio')) {
      values.push(normalizeTimestamp(patch.data_ora_inizio));
      setClauses.push(`start_at = ($${values.length}::timestamp AT TIME ZONE 'Europe/Rome')`);
    }

    if (hasOwn(patch, 'data_ora_fine')) {
      values.push(normalizeTimestamp(patch.data_ora_fine));
      setClauses.push(`end_at = ($${values.length}::timestamp AT TIME ZONE 'Europe/Rome')`);
    }

    if (hasOwn(patch, 'durata_minuti')) {
      const durationMinutes = normalizeAppointmentDurationMinutes(patch.durata_minuti);
      if (durationMinutes < visitTimingSettings.minDurationMinutes) {
        throw new Error(
          `Durata appuntamento non valida: minimo ${visitTimingSettings.minDurationMinutes} minuti per questo ambulatorio.`
        );
      }
      values.push(durationMinutes);
      setClauses.push(`duration_minutes = $${values.length}`);
    }

    if (hasOwn(patch, 'motivo')) {
      values.push(normalizeNullableText(patch.motivo));
      setClauses.push(`reason = $${values.length}`);
    }

    if (hasOwn(patch, 'origine')) {
      values.push(mapOrigin(patch.origine));
      setClauses.push(`origin = $${values.length}`);
    }

    if (hasOwn(patch, 'source_visita_id')) {
      const sourceRevisionId = await getRevisionIdByLegacy(
        client,
        patch.source_visita_id === null ? null : Number(patch.source_visita_id)
      );
      values.push(sourceRevisionId);
      setClauses.push(`source_encounter_revision_id = $${values.length}`);
    }

    if (setClauses.length === 0) {
      return;
    }

    values.push(actorUserId);
    setClauses.push(`updated_by = $${values.length}`);
    values.push(appointmentId);

    await client.query(
      `UPDATE scheduling.appointment
       SET ${setClauses.join(', ')},
           updated_at = now()
       WHERE id = $${values.length}`,
      values
    );
  });
}

export async function deleteLegacyAppointment(legacyId: number, actorUserId: string): Promise<void> {
  await query(
    `UPDATE scheduling.appointment
     SET deleted_at = now(),
         updated_by = $1,
         updated_at = now()
     WHERE legacy_id = $2
       AND deleted_at IS NULL`,
    [actorUserId, legacyId]
  );
}

type LegacyVisitaCompletaWriteInput = {
  visita: Record<string, unknown>;
  fattoriRischioCV: Record<string, unknown>;
};

type LegacyVisitaVersioneCompletaWriteInput = {
  sourceVisitaId: number;
  visita: Record<string, unknown>;
  fattoriRischioCV: Record<string, unknown>;
};

async function createFollowUpAppointmentFromVisitaTx(
  client: PoolClient,
  params: {
    visitaId: number;
    ambulatorioId: number;
    pazienteId: number;
    dataOraInizio: string;
    motivo: string;
    actorUserId: string;
  }
): Promise<number> {
  const durationMinutes = await getStandardVisitDurationByAmbulatorio(client, params.ambulatorioId);
  return createLegacyAppointmentTx(
    client,
    {
      ambulatorio_id: params.ambulatorioId,
      paziente_id: params.pazienteId,
      data_ora_inizio: params.dataOraInizio,
      data_ora_fine: addMinutesToDateTime(params.dataOraInizio, durationMinutes),
      durata_minuti: durationMinutes,
      motivo: params.motivo,
      origine: 'followup_visita',
      source_visita_id: params.visitaId
    },
    params.actorUserId
  );
}

export async function createLegacyVisitaCompleta(
  input: LegacyVisitaCompletaWriteInput,
  actorUserId: string
): Promise<number> {
  return withTransaction(async (client) => {
    const visitaId = await createLegacyVisitaTx(client, input.visita, actorUserId);

    if (hasMeaningfulFattoriRischioCV(input.fattoriRischioCV)) {
      await upsertLegacyFattoreByVisitaTx(client, visitaId, {
        ...input.fattoriRischioCV,
        visita_id: visitaId
      });
    }

    const followUpScheduling = parseFollowUpScheduling(input.visita.pianificazione_followup);
    if (followUpScheduling) {
      await createFollowUpAppointmentFromVisitaTx(client, {
        visitaId,
        ambulatorioId: Number(input.visita.ambulatorio_id ?? 0),
        pazienteId: Number(input.visita.paziente_id ?? 0),
        dataOraInizio: followUpScheduling.dataOraProssimaVisita,
        motivo: followUpScheduling.motivoProssimaVisita,
        actorUserId
      });
    }

    return visitaId;
  });
}

export async function updateLegacyVisitaCompleta(
  input: LegacyVisitaCompletaWriteInput & { visitaId: number },
  actorUserId: string
): Promise<void> {
  await withTransaction(async (client) => {
    await updateLegacyVisitaTx(client, input.visitaId, input.visita, actorUserId);

    const existingFattore = await client.query<{ id: number }>(
      `SELECT id
       FROM compat.fattori_rischio_cv
       WHERE visita_id = $1
       LIMIT 1`,
      [input.visitaId]
    );

    if (existingFattore.rows[0] || hasMeaningfulFattoriRischioCV(input.fattoriRischioCV)) {
      await upsertLegacyFattoreByVisitaTx(client, input.visitaId, {
        ...input.fattoriRischioCV,
        visita_id: input.visitaId
      });
    }

    const followUpScheduling = parseFollowUpScheduling(input.visita.pianificazione_followup);
    if (!followUpScheduling) {
      return;
    }

    const existingAppointment = await getLegacyAppointmentBySourceVisitaIdTx(client, input.visitaId);
    if (existingAppointment) {
      return;
    }

    let ambulatorioId = Number(input.visita.ambulatorio_id ?? 0);
    let pazienteId = Number(input.visita.paziente_id ?? 0);

    if (!Number.isInteger(ambulatorioId) || ambulatorioId <= 0 || !Number.isInteger(pazienteId) || pazienteId <= 0) {
      const visitaRow = await getLegacyVisitaByIdTx(client, input.visitaId);
      if (!visitaRow) {
        throw new Error(`Visita ${input.visitaId} non trovata`);
      }

      ambulatorioId = Number(visitaRow.ambulatorio_id ?? 0);
      pazienteId = Number(visitaRow.paziente_id ?? 0);
    }

    await createFollowUpAppointmentFromVisitaTx(client, {
      visitaId: input.visitaId,
      ambulatorioId,
      pazienteId,
      dataOraInizio: followUpScheduling.dataOraProssimaVisita,
      motivo: followUpScheduling.motivoProssimaVisita,
      actorUserId
    });
  });
}

export async function createLegacyVisitaVersioneCompleta(
  input: LegacyVisitaVersioneCompletaWriteInput,
  actorUserId: string
): Promise<number> {
  return withTransaction(async (client) => {
    const sourceVisita = await getLegacyVisitaByIdTx(client, input.sourceVisitaId);
    if (!sourceVisita) {
      throw new Error(`Visita ${input.sourceVisitaId} non trovata`);
    }

    if (Number(sourceVisita.is_current_version ?? 0) === 0) {
      throw new Error('La visita selezionata non è più la versione corrente');
    }

    const previousFollowUpScheduling = parseFollowUpScheduling(sourceVisita.pianificazione_followup);
    const nextFollowUpScheduling = parseFollowUpScheduling(input.visita.pianificazione_followup);
    const sameFollowUpScheduling = isSameFollowUpSchedule(previousFollowUpScheduling, nextFollowUpScheduling);
    const existingSourceAppointment = await getLegacyAppointmentBySourceVisitaIdTx(client, input.sourceVisitaId);

    const newVisitaId = await createLegacyVisitaTx(
      client,
      {
        ...input.visita,
        previous_version_id: input.sourceVisitaId,
        is_current_version: 1
      },
      actorUserId
    );

    await updateLegacyVisitaTx(
      client,
      input.sourceVisitaId,
      {
        is_current_version: 0
      },
      actorUserId
    );

    if (hasMeaningfulFattoriRischioCV(input.fattoriRischioCV)) {
      await upsertLegacyFattoreByVisitaTx(client, newVisitaId, {
        ...input.fattoriRischioCV,
        visita_id: newVisitaId
      });
    }

    if (!nextFollowUpScheduling) {
      if (existingSourceAppointment) {
        await deleteLegacyAppointmentTx(client, Number(existingSourceAppointment.id), actorUserId);
      }

      return newVisitaId;
    }

    const ambulatorioId = Number(input.visita.ambulatorio_id ?? sourceVisita.ambulatorio_id ?? 0);
    const pazienteId = Number(input.visita.paziente_id ?? sourceVisita.paziente_id ?? 0);

    if (sameFollowUpScheduling) {
      if (existingSourceAppointment) {
        await updateLegacyAppointmentSourceVisitaIdTx(
          client,
          Number(existingSourceAppointment.id),
          newVisitaId,
          actorUserId
        );
        return newVisitaId;
      }

      await createFollowUpAppointmentFromVisitaTx(client, {
        visitaId: newVisitaId,
        ambulatorioId,
        pazienteId,
        dataOraInizio: nextFollowUpScheduling.dataOraProssimaVisita,
        motivo: nextFollowUpScheduling.motivoProssimaVisita,
        actorUserId
      });

      return newVisitaId;
    }

    await createFollowUpAppointmentFromVisitaTx(client, {
      visitaId: newVisitaId,
      ambulatorioId,
      pazienteId,
      dataOraInizio: nextFollowUpScheduling.dataOraProssimaVisita,
      motivo: nextFollowUpScheduling.motivoProssimaVisita,
      actorUserId
    });

    if (existingSourceAppointment) {
      await deleteLegacyAppointmentTx(client, Number(existingSourceAppointment.id), actorUserId);
    }

    return newVisitaId;
  });
}

export function toLegacyAppointmentOrigin(value: unknown): 'manuale' | 'followup_visita' {
  return mapLegacyOrigin(value);
}
