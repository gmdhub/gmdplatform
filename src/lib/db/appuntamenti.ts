import {
  getAmbulatorioOperatingSettingsById,
  getAmbulatorioOperatingWindowsById
} from './ambulatori';
import { isApiDataProvider } from './config';
import { initDatabase } from './schema';
import {
  createAppuntamentoManualeFromApi,
  createFollowUpAppuntamentoFromApi,
  deleteAppuntamentoFromApi,
  getAppuntamentoByIdFromApi,
  getAppuntamentoBySourceVisitaIdFromApi,
  getAppuntamentiByRangeFromApi,
  getDailyAppointmentCountsByRangeFromApi,
  updateAppuntamentoFromApi,
  updateAppuntamentoSourceVisitaIdFromApi
} from '$lib/services/appuntamenti-service';
import type {
  AmbulatorioOperatingSettings,
  Appuntamento,
  AppuntamentoAdjustment,
  AppuntamentoSlotDisponibilita,
  AppuntamentoWriteOptions,
  AppuntamentoWriteOutcome,
  AppuntamentoWriteRequirements,
  FindFirstSlotParams,
  FirstSlotSearchResult,
  DailyAppointmentCount,
  SlotAvailabilityCheck,
  CreateAppuntamentoManualeInput,
  UpdateAppuntamentoInput
} from './types';

const FIRST_SLOT_SEARCH_HORIZON_DAYS = 180;
const URGENT_SLOT_STEP_MINUTES = 5;
const QUARTER_HOUR_STEP_MINUTES = 15;
const MIN_ALLOWED_VISIT_DURATION_MINUTES = 10;
export const APPOINTAMENTO_CONFIRMATION_REQUIRED_PREFIX = 'APPUNTAMENTO_CONFIRMATION_REQUIRED:';
export const VISIT_SETTINGS_REQUIRED_MESSAGE =
  'Devi prima configurare la durata delle visite ambulatoriali nelle impostazioni.';

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

function normalizeTextForWrite(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeDateOnly(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Data non valida: ${value}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error(`Data non valida: ${value}`);
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeDateTime(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    throw new Error(`Data/ora non valida: ${value}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Date(year, month - 1, day, hour, minute);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    throw new Error(`Data/ora non valida: ${value}`);
  }

  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
}

function normalizeTime(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Orario non valido: ${value}`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new Error(`Orario non valido: ${value}`);
  }

  return `${match[1]}:${match[2]}`;
}

function formatDateTime(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function formatDateOnly(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addMinutes(dateTime: string, minutes: number): string {
  const normalized = normalizeDateTime(dateTime);
  const date = new Date(normalized);
  date.setMinutes(date.getMinutes() + minutes);
  return formatDateTime(date);
}

function getDayBounds(day: string): { start: string; endExclusive: string } {
  const normalizedDay = normalizeDateOnly(day);
  const start = `${normalizedDay}T00:00`;
  const nextDate = new Date(`${normalizedDay}T00:00`);
  nextDate.setDate(nextDate.getDate() + 1);
  return {
    start,
    endExclusive: `${formatDateOnly(nextDate)}T00:00`
  };
}

function getDurationMinutes(startDateTime: string, endDateTime: string): number {
  const start = new Date(normalizeDateTime(startDateTime));
  const end = new Date(normalizeDateTime(endDateTime));
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

function toIsoWeekday(dateTime: string): number {
  const date = new Date(normalizeDateTime(dateTime));
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function ensureSameDate(startDateTime: string, endDateTime: string): void {
  if (startDateTime.slice(0, 10) !== endDateTime.slice(0, 10)) {
    throw new Error('Gli appuntamenti devono iniziare e finire nello stesso giorno');
  }
}

function compareTimes(left: string, right: string): number {
  return left.localeCompare(right);
}

function timeToMinutes(timeValue: string): number {
  const normalized = normalizeTime(timeValue);
  const [hours, minutes] = normalized.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function minutesToTime(totalMinutes: number): string {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatDateTimeLabel(value: string): string {
  const normalized = normalizeDateTime(value);
  return `${normalized.slice(0, 10)} ${normalized.slice(11, 16)}`;
}

function normalizeMinVisitDuration(value: number): number {
  if (!Number.isInteger(value) || value < MIN_ALLOWED_VISIT_DURATION_MINUTES) {
    throw new Error(
      `Durata minima visita non valida: ${value}. Minimo consentito ${MIN_ALLOWED_VISIT_DURATION_MINUTES} minuti.`
    );
  }

  return value;
}

function normalizeStandardVisitDuration(value: number, minDurationMinutes: number): number {
  if (!Number.isInteger(value) || value < MIN_ALLOWED_VISIT_DURATION_MINUTES) {
    throw new Error(
      `Durata standard visita non valida: ${value}. Minimo consentito ${MIN_ALLOWED_VISIT_DURATION_MINUTES} minuti.`
    );
  }

  if (value < minDurationMinutes) {
    throw new Error(
      `Durata standard visita non valida: ${value}. Deve essere >= durata minima (${minDurationMinutes}).`
    );
  }

  return value;
}

function roundUpDateTimeToStep(dateTime: string, stepMinutes: number): string {
  const normalized = normalizeDateTime(dateTime);
  const date = new Date(normalized);
  const currentMinutes = date.getMinutes();
  const remainder = currentMinutes % stepMinutes;

  if (remainder !== 0) {
    date.setMinutes(currentMinutes + (stepMinutes - remainder));
  }

  date.setSeconds(0, 0);
  return formatDateTime(date);
}

function getDefaultSearchStartDateTime(fromDateTime?: string): string {
  if (typeof fromDateTime === 'string' && fromDateTime.trim()) {
    return normalizeDateTime(fromDateTime);
  }

  return formatDateTime(new Date());
}

function getSearchHorizonDays(horizonDays?: number): number {
  if (!Number.isInteger(horizonDays) || (horizonDays ?? 0) <= 0) {
    return FIRST_SLOT_SEARCH_HORIZON_DAYS;
  }

  return Math.max(1, Math.floor(horizonDays as number));
}

function getDayWindowsFromSettings(params: {
  day: string;
  weekday: number;
  windows: Array<{ weekday: number; ora_inizio: string; ora_fine: string; max_pazienti_giorno?: number }>;
}): Array<{ startDateTime: string; endDateTime: string }> {
  const result: Array<{ startDateTime: string; endDateTime: string }> = [];

  for (const window of params.windows) {
    if (window.weekday !== params.weekday) {
      continue;
    }

    const windowStartMinutes = timeToMinutes(window.ora_inizio);
    const windowEndMinutes = timeToMinutes(window.ora_fine);
    if (windowStartMinutes >= windowEndMinutes) {
      continue;
    }

    result.push({
      startDateTime: `${params.day}T${minutesToTime(windowStartMinutes)}`,
      endDateTime: `${params.day}T${minutesToTime(windowEndMinutes)}`
    });
  }

  return result.sort((left, right) => left.startDateTime.localeCompare(right.startDateTime));
}

function hasConfiguredOperatingWindows(
  windows: Array<{ weekday: number; ora_inizio: string; ora_fine: string; max_pazienti_giorno?: number }>
): boolean {
  return windows.some((window) => {
    try {
      return timeToMinutes(window.ora_inizio) < timeToMinutes(window.ora_fine);
    } catch {
      return false;
    }
  });
}

function getDailyCapacityLimitForWeekday(
  windows: Array<{ weekday: number; max_pazienti_giorno?: number }>,
  weekday: number
): number | null {
  const capacities = windows
    .filter((window) => window.weekday === weekday)
    .map((window) => Number(window.max_pazienti_giorno))
    .filter((value) => Number.isInteger(value) && value >= 1)
    .map((value) => Math.floor(value));

  if (capacities.length === 0) {
    return null;
  }

  return Math.max(...capacities);
}

function isRetryableFirstSlotCandidateError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes('durata appuntamento non valida') ||
    message.includes('durata finale appuntamento non valida') ||
    message.includes('conflitto orario') ||
    message.includes("impossibile accorciare l'appuntamento precedente") ||
    message.includes('impossibile accorciare il nuovo appuntamento') ||
    message.includes('limite giornaliero raggiunto')
  );
}

async function resolveAmbulatorioDurationSettings(
  ambulatorioId: number,
  preloadedSettings?: AmbulatorioOperatingSettings
): Promise<{
  settings: AmbulatorioOperatingSettings;
  minDurationMinutes: number;
  standardDurationMinutes: number;
}> {
  const settings = preloadedSettings ?? (await getAmbulatorioOperatingSettingsById(ambulatorioId));
  let minDurationMinutes: number;
  let standardDurationMinutes: number;

  try {
    minDurationMinutes = normalizeMinVisitDuration(Number(settings.durataMinimaVisitaMinuti));
    standardDurationMinutes = normalizeStandardVisitDuration(
      Number(settings.durataStandardVisitaMinuti),
      minDurationMinutes
    );
  } catch {
    throw new Error(VISIT_SETTINGS_REQUIRED_MESSAGE);
  }

  if (!hasConfiguredOperatingWindows(settings.windows)) {
    throw new Error(VISIT_SETTINGS_REQUIRED_MESSAGE);
  }

  return {
    settings,
    minDurationMinutes,
    standardDurationMinutes
  };
}

function buildOutsideHoursMessage(
  startDateTime: string,
  endDateTime: string,
  dayWindows: Array<{ ora_inizio: string; ora_fine: string }>
): string {
  const ranges = dayWindows
    .map((window) => `${window.ora_inizio}-${window.ora_fine}`)
    .join(', ');

  if (!ranges) {
    return `L'appuntamento ${formatDateTimeLabel(startDateTime)}-${endDateTime.slice(11, 16)} è fuori dai giorni/orari di funzionamento.`;
  }

  return `L'appuntamento ${formatDateTimeLabel(startDateTime)}-${endDateTime.slice(11, 16)} è fuori orario. Fasce disponibili per il giorno: ${ranges}.`;
}

function isIntervalInsideDayWindows(params: {
  startDateTime: string;
  endDateTime: string;
  windows: Array<{ weekday: number; ora_inizio: string; ora_fine: string }>;
}): {
  inside: boolean;
  dayWindows: Array<{ ora_inizio: string; ora_fine: string }>;
} {
  const startDateTime = normalizeDateTime(params.startDateTime);
  const endDateTime = normalizeDateTime(params.endDateTime);
  ensureSameDate(startDateTime, endDateTime);

  const weekday = toIsoWeekday(startDateTime);
  const dayWindows = params.windows
    .filter((window) => window.weekday === weekday)
    .map((window) => ({
      ora_inizio: normalizeTime(window.ora_inizio),
      ora_fine: normalizeTime(window.ora_fine)
    }))
    .sort((left, right) => compareTimes(left.ora_inizio, right.ora_inizio));

  if (dayWindows.length === 0) {
    return { inside: false, dayWindows };
  }

  const startTime = startDateTime.slice(11, 16);
  const endTime = endDateTime.slice(11, 16);

  const inside = dayWindows.some((window) => {
    return compareTimes(startTime, window.ora_inizio) >= 0 && compareTimes(endTime, window.ora_fine) <= 0;
  });

  return { inside, dayWindows };
}

async function getOverlappingAppointments(params: {
  ambulatorioId: number;
  startDateTime: string;
  endDateTime: string;
  excludeAppuntamentoId?: number;
}): Promise<Appuntamento[]> {
  if (isApiDataProvider()) {
    const appointments = await getAppuntamentiByRangeFromApi({
      ambulatorioId: params.ambulatorioId,
      rangeStart: params.startDateTime,
      rangeEndExclusive: params.endDateTime
    });

    return appointments
      .filter((appointment) => {
        if (params.excludeAppuntamentoId !== undefined && appointment.id === params.excludeAppuntamentoId) {
          return false;
        }

        const start = normalizeDateTime(appointment.data_ora_inizio);
        const end = normalizeDateTime(appointment.data_ora_fine);
        return start < params.endDateTime && end > params.startDateTime;
      })
      .sort((left, right) => {
        const leftStart = normalizeDateTime(left.data_ora_inizio);
        const rightStart = normalizeDateTime(right.data_ora_inizio);
        if (leftStart !== rightStart) {
          return leftStart.localeCompare(rightStart);
        }
        return normalizeDateTime(left.data_ora_fine).localeCompare(normalizeDateTime(right.data_ora_fine));
      });
  }

  const db = await initDatabase();
  const queryParams: unknown[] = [
    normalizeIntegerForWrite(params.ambulatorioId),
    normalizeDateTime(params.endDateTime),
    normalizeDateTime(params.startDateTime)
  ];

  let sql = `
    SELECT
      a.*,
      p.nome AS paziente_nome,
      p.cognome AS paziente_cognome,
      p.codice_fiscale AS paziente_codice_fiscale,
      p.data_nascita AS paziente_data_nascita,
      p.telefono AS paziente_telefono
    FROM appuntamenti a
    INNER JOIN pazienti p ON p.id = a.paziente_id
    WHERE a.ambulatorio_id = ?
      AND a.data_ora_inizio < ?
      AND a.data_ora_fine > ?
  `;

  if (params.excludeAppuntamentoId !== undefined) {
    sql += ' AND a.id <> ?';
    queryParams.push(normalizeIntegerForWrite(params.excludeAppuntamentoId));
  }

  sql += ' ORDER BY a.data_ora_inizio ASC, a.data_ora_fine ASC';
  return db.select<Appuntamento[]>(sql, queryParams);
}

async function getDailyAppointmentCount(params: {
  ambulatorioId: number;
  day: string;
  excludeAppuntamentoId?: number;
}): Promise<number> {
  if (isApiDataProvider()) {
    const bounds = getDayBounds(params.day);
    const appointments = await getAppuntamentiByRangeFromApi({
      ambulatorioId: params.ambulatorioId,
      rangeStart: bounds.start,
      rangeEndExclusive: bounds.endExclusive
    });

    return appointments.filter((appointment) => {
      if (params.excludeAppuntamentoId !== undefined && appointment.id === params.excludeAppuntamentoId) {
        return false;
      }
      return true;
    }).length;
  }

  const db = await initDatabase();
  const bounds = getDayBounds(params.day);
  const queryParams: unknown[] = [
    normalizeIntegerForWrite(params.ambulatorioId),
    normalizeDateTime(bounds.endExclusive),
    normalizeDateTime(bounds.start)
  ];

  let sql = `
    SELECT COUNT(*) AS total
    FROM appuntamenti
    WHERE ambulatorio_id = ?
      AND data_ora_inizio < ?
      AND data_ora_fine > ?
  `;

  if (params.excludeAppuntamentoId !== undefined) {
    sql += ' AND id <> ?';
    queryParams.push(normalizeIntegerForWrite(params.excludeAppuntamentoId));
  }

  const rows = await db.select<Array<{ total: number | string }>>(sql, queryParams);
  return Number(rows[0]?.total ?? 0);
}

async function buildWritePlan(params: {
  ambulatorioId: number;
  appointmentIdForUpdate?: number;
  startDateTime: string;
  endDateTime: string;
  settings?: AmbulatorioOperatingSettings;
  options?: AppuntamentoWriteOptions;
}): Promise<{
  finalStartDateTime: string;
  finalEndDateTime: string;
  finalDurationMinutes: number;
  adjustments: AppuntamentoAdjustment[];
  updatesToApply: Array<{ id: number; startDateTime: string; endDateTime: string; durationMinutes: number }>;
  requiresOutsideHoursConfirmation: boolean;
  outsideHoursMessage?: string;
  requiresOverlapAdjustmentConfirmation: boolean;
}> {
  const startDateTime = normalizeDateTime(params.startDateTime);
  const requestedEndDateTime = normalizeDateTime(params.endDateTime);

  ensureSameDate(startDateTime, requestedEndDateTime);

  const durationSettings = await resolveAmbulatorioDurationSettings(params.ambulatorioId, params.settings);
  const settings = durationSettings.settings;
  const minDurationMinutes = durationSettings.minDurationMinutes;
  const dailyCapacityLimit = getDailyCapacityLimitForWeekday(settings.windows, toIsoWeekday(startDateTime));
  if (dailyCapacityLimit !== null) {
    const currentCount = await getDailyAppointmentCount({
      ambulatorioId: params.ambulatorioId,
      day: startDateTime.slice(0, 10),
      excludeAppuntamentoId: params.appointmentIdForUpdate
    });
    if (currentCount >= dailyCapacityLimit) {
      throw new Error(
        `Limite giornaliero raggiunto per ${startDateTime.slice(0, 10)}: massimo ${dailyCapacityLimit} pazienti.`
      );
    }
  }

  const requestedDuration = getDurationMinutes(startDateTime, requestedEndDateTime);
  if (requestedDuration < minDurationMinutes) {
    throw new Error(
      `Durata appuntamento non valida: minimo ${minDurationMinutes} minuti per questo ambulatorio.`
    );
  }

  const insideResult = isIntervalInsideDayWindows({
    startDateTime,
    endDateTime: requestedEndDateTime,
    windows: settings.windows
  });

  const overlappingAppointments = await getOverlappingAppointments({
    ambulatorioId: params.ambulatorioId,
    startDateTime,
    endDateTime: requestedEndDateTime,
    excludeAppuntamentoId: params.appointmentIdForUpdate
  });

  const previousOverlaps = overlappingAppointments.filter(
    (appointment) => normalizeDateTime(appointment.data_ora_inizio) < startDateTime
  );
  const nextOverlaps = overlappingAppointments.filter(
    (appointment) => normalizeDateTime(appointment.data_ora_inizio) >= startDateTime
  );

  const updatesToApply: Array<{ id: number; startDateTime: string; endDateTime: string; durationMinutes: number }> = [];
  const adjustments: AppuntamentoAdjustment[] = [];

  for (const appointment of previousOverlaps) {
    const currentStart = normalizeDateTime(appointment.data_ora_inizio);
    const currentEnd = normalizeDateTime(appointment.data_ora_fine);
    if (currentEnd <= startDateTime) {
      continue;
    }

    const nextDuration = getDurationMinutes(currentStart, startDateTime);
    if (nextDuration < minDurationMinutes) {
      const patientName = [appointment.paziente_cognome, appointment.paziente_nome]
        .filter(Boolean)
        .join(' ')
        .trim();
      throw new Error(
        `Impossibile accorciare l'appuntamento precedente${patientName ? ` (${patientName})` : ''}: durata minima ${minDurationMinutes} minuti.`
      );
    }

    updatesToApply.push({
      id: appointment.id,
      startDateTime: currentStart,
      endDateTime: startDateTime,
      durationMinutes: nextDuration
    });

    adjustments.push({
      type: 'trim_previous_end',
      appuntamentoId: appointment.id,
      oldEnd: currentEnd,
      newEnd: startDateTime,
      pazienteNome: [appointment.paziente_cognome, appointment.paziente_nome]
        .filter(Boolean)
        .join(' ')
        .trim()
    });
  }

  let finalEndDateTime = requestedEndDateTime;
  if (nextOverlaps.length > 0) {
    const earliestNext = nextOverlaps[0];
    const earliestNextStart = normalizeDateTime(earliestNext.data_ora_inizio);
    const earliestNextEnd = normalizeDateTime(earliestNext.data_ora_fine);
    if (earliestNextStart < finalEndDateTime) {
      const nextDuration = getDurationMinutes(startDateTime, earliestNextStart);
      if (nextDuration < minDurationMinutes) {
        const shiftedNextDuration = getDurationMinutes(finalEndDateTime, earliestNextEnd);
        if (shiftedNextDuration >= minDurationMinutes) {
          updatesToApply.push({
            id: earliestNext.id,
            startDateTime: finalEndDateTime,
            endDateTime: earliestNextEnd,
            durationMinutes: shiftedNextDuration
          });

          adjustments.push({
            type: 'trim_next_start',
            appuntamentoId: earliestNext.id,
            oldEnd: earliestNextStart,
            newEnd: finalEndDateTime,
            pazienteNome: [earliestNext.paziente_cognome, earliestNext.paziente_nome]
              .filter(Boolean)
              .join(' ')
              .trim()
          });
        } else {
          const patientName = [earliestNext.paziente_cognome, earliestNext.paziente_nome]
            .filter(Boolean)
            .join(' ')
            .trim();
          const conflictRange = `${earliestNextStart.slice(11, 16)}-${earliestNextEnd.slice(11, 16)}`;
          const requestedRange = `${startDateTime.slice(11, 16)}-${requestedEndDateTime.slice(11, 16)}`;
          const minimumEndTime = addMinutes(startDateTime, minDurationMinutes).slice(11, 16);
          throw new Error(
            `Conflitto orario con appuntamento${patientName ? ` (${patientName})` : ''} ${conflictRange}. ` +
              `L'intervallo richiesto ${requestedRange} non rispetta la durata minima (${minDurationMinutes} minuti) ` +
              `perché andrebbe accorciato sotto soglia. Prova a usare un orario che termini entro ${minimumEndTime} ` +
              `oppure sposta l'appuntamento in conflitto.`
          );
        }
      } else {
        finalEndDateTime = earliestNextStart;
        adjustments.push({
          type: 'trim_new_end',
          appuntamentoId: earliestNext.id,
          oldEnd: requestedEndDateTime,
          newEnd: finalEndDateTime,
          pazienteNome: [earliestNext.paziente_cognome, earliestNext.paziente_nome]
            .filter(Boolean)
            .join(' ')
            .trim()
        });
      }
    }
  }

  const finalDurationMinutes = getDurationMinutes(startDateTime, finalEndDateTime);
  if (finalDurationMinutes < minDurationMinutes) {
    throw new Error(
      `Durata finale appuntamento non valida: minimo ${minDurationMinutes} minuti per questo ambulatorio.`
    );
  }

  const requiresOutsideHoursConfirmation = !insideResult.inside;
  const requiresOverlapAdjustmentConfirmation = adjustments.length > 0;
  const options = params.options ?? {};

  return {
    finalStartDateTime: startDateTime,
    finalEndDateTime,
    finalDurationMinutes,
    adjustments,
    updatesToApply,
    requiresOutsideHoursConfirmation:
      requiresOutsideHoursConfirmation && !Boolean(options.confirmOutsideHours),
    outsideHoursMessage: requiresOutsideHoursConfirmation
      ? buildOutsideHoursMessage(startDateTime, finalEndDateTime, insideResult.dayWindows)
      : undefined,
    requiresOverlapAdjustmentConfirmation:
      requiresOverlapAdjustmentConfirmation && !Boolean(options.confirmOverlapAdjustments)
  };
}

function buildRequiresConfirmationOutcome(plan: {
  requiresOutsideHoursConfirmation: boolean;
  outsideHoursMessage?: string;
  requiresOverlapAdjustmentConfirmation: boolean;
  adjustments: AppuntamentoAdjustment[];
}): AppuntamentoWriteOutcome {
  return {
    saved: false,
    requirements: {
      requiresOutsideHoursConfirmation: plan.requiresOutsideHoursConfirmation,
      requiresOverlapAdjustmentConfirmation: plan.requiresOverlapAdjustmentConfirmation,
      outsideHoursMessage: plan.outsideHoursMessage,
      overlapAdjustments: plan.adjustments
    }
  };
}

export function buildConfirmationRequiredErrorMessage(
  requirements: AppuntamentoWriteRequirements
): string {
  return `${APPOINTAMENTO_CONFIRMATION_REQUIRED_PREFIX}${JSON.stringify(requirements)}`;
}

export function parseConfirmationRequiredError(
  error: unknown
): AppuntamentoWriteRequirements | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message.startsWith(APPOINTAMENTO_CONFIRMATION_REQUIRED_PREFIX)) {
    return null;
  }

  const rawPayload = message.slice(APPOINTAMENTO_CONFIRMATION_REQUIRED_PREFIX.length);
  try {
    return JSON.parse(rawPayload) as AppuntamentoWriteRequirements;
  } catch {
    return null;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return '';
}

function isNoActiveTransactionError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes('no transaction is active');
}

async function beginWriteTransactionIfSupported(
  db: Awaited<ReturnType<typeof initDatabase>>
): Promise<boolean> {
  await db.execute('BEGIN');
  return true;
}

async function commitWriteTransactionIfSupported(
  db: Awaited<ReturnType<typeof initDatabase>>,
  transactionStarted: boolean
): Promise<void> {
  if (!transactionStarted) {
    return;
  }

  try {
    await db.execute('COMMIT');
  } catch (error) {
    if (isNoActiveTransactionError(error)) {
      return;
    }

    throw error;
  }
}

async function rollbackWriteTransactionIfSupported(
  db: Awaited<ReturnType<typeof initDatabase>>,
  transactionStarted: boolean
): Promise<void> {
  if (!transactionStarted) {
    return;
  }

  try {
    await db.execute('ROLLBACK');
  } catch (error) {
    if (isNoActiveTransactionError(error)) {
      return;
    }
  }
}

function getLastInsertId(result: { lastInsertId?: number | null }): number {
  const insertedId = Number(result.lastInsertId);
  if (!Number.isInteger(insertedId)) {
    throw new Error("Impossibile ottenere l'ID appena creato dal database.");
  }

  return insertedId;
}

async function applyExistingAppointmentAdjustments(params: {
  db: Awaited<ReturnType<typeof initDatabase>>;
  updates: Array<{ id: number; startDateTime: string; endDateTime: string; durationMinutes: number }>;
}): Promise<void> {
  for (const update of params.updates) {
    await params.db.execute(
      `UPDATE appuntamenti
       SET data_ora_inizio = ?, data_ora_fine = ?, durata_minuti = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        normalizeDateTime(update.startDateTime),
        normalizeDateTime(update.endDateTime),
        normalizeIntegerForWrite(update.durationMinutes),
        normalizeIntegerForWrite(update.id)
      ]
    );
  }
}

export async function getAppuntamentoById(id: number): Promise<Appuntamento | null> {
  if (isApiDataProvider()) {
    return getAppuntamentoByIdFromApi(id);
  }

  const db = await initDatabase();
  const rows = await db.select<Appuntamento[]>(
    `SELECT
      a.*,
      p.nome AS paziente_nome,
      p.cognome AS paziente_cognome,
      p.codice_fiscale AS paziente_codice_fiscale,
      p.data_nascita AS paziente_data_nascita,
      p.telefono AS paziente_telefono
    FROM appuntamenti a
    INNER JOIN pazienti p ON p.id = a.paziente_id
    WHERE a.id = ?`,
    [normalizeIntegerForWrite(id)]
  );

  return rows[0] ?? null;
}

export async function getAppuntamentoBySourceVisitaId(visitaId: number): Promise<Appuntamento | null> {
  if (isApiDataProvider()) {
    return getAppuntamentoBySourceVisitaIdFromApi(visitaId);
  }

  const db = await initDatabase();
  const rows = await db.select<Appuntamento[]>(
    `SELECT
      a.*,
      p.nome AS paziente_nome,
      p.cognome AS paziente_cognome,
      p.codice_fiscale AS paziente_codice_fiscale,
      p.data_nascita AS paziente_data_nascita,
      p.telefono AS paziente_telefono
    FROM appuntamenti a
    INNER JOIN pazienti p ON p.id = a.paziente_id
    WHERE a.source_visita_id = ?
    LIMIT 1`,
    [normalizeIntegerForWrite(visitaId)]
  );

  return rows[0] ?? null;
}

export async function getAppuntamentiByRange(params: {
  ambulatorioId: number;
  rangeStart: string;
  rangeEndExclusive: string;
}): Promise<Appuntamento[]> {
  if (isApiDataProvider()) {
    return getAppuntamentiByRangeFromApi(params);
  }

  const db = await initDatabase();

  return db.select<Appuntamento[]>(
    `SELECT
      a.*,
      p.nome AS paziente_nome,
      p.cognome AS paziente_cognome,
      p.codice_fiscale AS paziente_codice_fiscale,
      p.data_nascita AS paziente_data_nascita,
      p.telefono AS paziente_telefono
    FROM appuntamenti a
    INNER JOIN pazienti p ON p.id = a.paziente_id
    WHERE a.ambulatorio_id = ?
      AND a.data_ora_inizio < ?
      AND a.data_ora_fine > ?
    ORDER BY a.data_ora_inizio ASC`,
    [
      normalizeIntegerForWrite(params.ambulatorioId),
      normalizeDateTime(params.rangeEndExclusive),
      normalizeDateTime(params.rangeStart)
    ]
  );
}

export async function getDailyAppointmentCountsByRange(params: {
  ambulatorioId: number;
  rangeStart: string;
  rangeEndExclusive: string;
}): Promise<DailyAppointmentCount[]> {
  if (isApiDataProvider()) {
    return getDailyAppointmentCountsByRangeFromApi(params);
  }

  const db = await initDatabase();

  return db.select<DailyAppointmentCount[]>(
    `SELECT
       substr(data_ora_inizio, 1, 10) AS date,
       COUNT(*) AS total
     FROM appuntamenti
     WHERE ambulatorio_id = ?
       AND data_ora_inizio < ?
       AND data_ora_fine > ?
     GROUP BY substr(data_ora_inizio, 1, 10)
     ORDER BY date ASC`,
    [
      normalizeIntegerForWrite(params.ambulatorioId),
      normalizeDateTime(params.rangeEndExclusive),
      normalizeDateTime(params.rangeStart)
    ]
  );
}

export async function getAppuntamentiByDay(params: {
  ambulatorioId: number;
  day: string;
}): Promise<Appuntamento[]> {
  const bounds = getDayBounds(params.day);
  return getAppuntamentiByRange({
    ambulatorioId: params.ambulatorioId,
    rangeStart: bounds.start,
    rangeEndExclusive: bounds.endExclusive
  });
}

export async function getSlotDisponibilitaByDay(params: {
  ambulatorioId: number;
  day: string;
  excludeAppuntamentoId?: number;
}): Promise<AppuntamentoSlotDisponibilita[]> {
  const day = normalizeDateOnly(params.day);
  const settings = await getAmbulatorioOperatingSettingsById(params.ambulatorioId);
  const stepMinutes = normalizeMinVisitDuration(settings.durataMinimaVisitaMinuti);
  const appointments = await getAppuntamentiByDay({
    ambulatorioId: params.ambulatorioId,
    day
  });

  const targetWeekday = toIsoWeekday(`${day}T00:00`);
  const dayWindows = settings.windows
    .filter((window) => window.weekday === targetWeekday)
    .sort((left, right) => compareTimes(left.ora_inizio, right.ora_inizio));
  const dailyCapacityLimit = getDailyCapacityLimitForWeekday(settings.windows, targetWeekday);

  if (dayWindows.length === 0) {
    return [];
  }

  const filteredAppointments =
    params.excludeAppuntamentoId !== undefined
      ? appointments.filter((appointment) => appointment.id !== params.excludeAppuntamentoId)
      : appointments;
  const isDailyCapacityReached =
    dailyCapacityLimit !== null && filteredAppointments.length >= dailyCapacityLimit;

  const result: AppuntamentoSlotDisponibilita[] = [];

  for (const window of dayWindows) {
    const startMinutes = timeToMinutes(window.ora_inizio);
    const endMinutes = timeToMinutes(window.ora_fine);

    let current = startMinutes;
    while (current + stepMinutes <= endMinutes) {
      const time = minutesToTime(current);
      const slotStart = `${day}T${time}`;
      const slotEnd = addMinutes(slotStart, stepMinutes);
      const occupiedAppointment =
        filteredAppointments.find((appointment) => {
          const appointmentStart = normalizeDateTime(appointment.data_ora_inizio);
          const appointmentEnd = normalizeDateTime(appointment.data_ora_fine);
          return appointmentStart < slotEnd && appointmentEnd > slotStart;
        }) ?? null;

      result.push({
        date: day,
        time,
        dateTime: slotStart,
        endDateTime: slotEnd,
        insideWorkingHours: true,
        available: !isDailyCapacityReached && occupiedAppointment === null,
        appuntamento: occupiedAppointment
      });

      current += stepMinutes;
    }
  }

  return result;
}

export async function checkAppuntamentoSlotAvailability(params: {
  ambulatorioId: number;
  dataOraInizio: string;
  dataOraFine?: string;
  excludeAppuntamentoId?: number;
}): Promise<SlotAvailabilityCheck> {
  const startDateTime = normalizeDateTime(params.dataOraInizio);
  const durationSettings = await resolveAmbulatorioDurationSettings(params.ambulatorioId);
  const endDateTime = params.dataOraFine
    ? normalizeDateTime(params.dataOraFine)
    : addMinutes(startDateTime, durationSettings.standardDurationMinutes);

  const insideResult = isIntervalInsideDayWindows({
    startDateTime,
    endDateTime,
    windows: durationSettings.settings.windows
  });

  const overlaps = await getOverlappingAppointments({
    ambulatorioId: params.ambulatorioId,
    startDateTime,
    endDateTime,
    excludeAppuntamentoId: params.excludeAppuntamentoId
  });

  const suggestions = (await getSlotDisponibilitaByDay({
    ambulatorioId: params.ambulatorioId,
    day: startDateTime.slice(0, 10),
    excludeAppuntamentoId: params.excludeAppuntamentoId
  }))
    .filter((slot) => slot.available)
    .map((slot) => slot.time);

  if (!insideResult.inside || overlaps.length > 0) {
    return {
      available: false,
      conflict: overlaps[0] ?? null,
      suggestedTimes: suggestions
    };
  }

  return {
    available: true,
    conflict: null,
    suggestedTimes: suggestions
  };
}

export async function previewAppuntamentoWrite(params: {
  ambulatorioId: number;
  dataOraInizio: string;
  dataOraFine?: string;
  appointmentIdForUpdate?: number;
  options?: AppuntamentoWriteOptions;
}): Promise<AppuntamentoWriteOutcome> {
  const startDateTime = normalizeDateTime(params.dataOraInizio);
  const durationSettings = await resolveAmbulatorioDurationSettings(params.ambulatorioId);
  const endDateTime = params.dataOraFine
    ? normalizeDateTime(params.dataOraFine)
    : addMinutes(startDateTime, durationSettings.standardDurationMinutes);

  const plan = await buildWritePlan({
    ambulatorioId: params.ambulatorioId,
    appointmentIdForUpdate: params.appointmentIdForUpdate,
    startDateTime,
    endDateTime,
    settings: durationSettings.settings,
    options: params.options
  });

  if (plan.requiresOutsideHoursConfirmation || plan.requiresOverlapAdjustmentConfirmation) {
    return buildRequiresConfirmationOutcome({
      requiresOutsideHoursConfirmation: plan.requiresOutsideHoursConfirmation,
      outsideHoursMessage: plan.outsideHoursMessage,
      requiresOverlapAdjustmentConfirmation: plan.requiresOverlapAdjustmentConfirmation,
      adjustments: plan.adjustments
    });
  }

  return {
    saved: true,
    appliedAdjustments: plan.adjustments
  };
}

export async function createAppuntamentoManuale(
  input: CreateAppuntamentoManualeInput,
  options?: AppuntamentoWriteOptions
): Promise<AppuntamentoWriteOutcome> {
  const plan = await buildWritePlan({
    ambulatorioId: input.ambulatorio_id,
    startDateTime: input.data_ora_inizio,
    endDateTime: input.data_ora_fine,
    options
  });

  if (plan.requiresOutsideHoursConfirmation || plan.requiresOverlapAdjustmentConfirmation) {
    return buildRequiresConfirmationOutcome({
      requiresOutsideHoursConfirmation: plan.requiresOutsideHoursConfirmation,
      outsideHoursMessage: plan.outsideHoursMessage,
      requiresOverlapAdjustmentConfirmation: plan.requiresOverlapAdjustmentConfirmation,
      adjustments: plan.adjustments
    });
  }

  if (isApiDataProvider()) {
    for (const update of plan.updatesToApply) {
      await updateAppuntamentoFromApi({
        id: update.id,
        data_ora_inizio: update.startDateTime,
        data_ora_fine: update.endDateTime
      });
    }

    const appointmentId = await createAppuntamentoManualeFromApi({
      ambulatorio_id: input.ambulatorio_id,
      paziente_id: input.paziente_id,
      data_ora_inizio: plan.finalStartDateTime,
      data_ora_fine: plan.finalEndDateTime,
      motivo: input.motivo
    });

    return {
      saved: true,
      appuntamentoId: appointmentId,
      appliedAdjustments: plan.adjustments
    };
  }

  const db = await initDatabase();
  const transactionStarted = await beginWriteTransactionIfSupported(db);

  try {
    await applyExistingAppointmentAdjustments({
      db,
      updates: plan.updatesToApply
    });

    const insertResult = await db.execute(
      `INSERT INTO appuntamenti (
        ambulatorio_id,
        paziente_id,
        data_ora_inizio,
        data_ora_fine,
        durata_minuti,
        motivo,
        origine,
        source_visita_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'manuale', NULL)`,
      [
        normalizeIntegerForWrite(input.ambulatorio_id),
        normalizeIntegerForWrite(input.paziente_id),
        plan.finalStartDateTime,
        plan.finalEndDateTime,
        normalizeIntegerForWrite(plan.finalDurationMinutes),
        normalizeTextForWrite(input.motivo)
      ]
    );
    const appointmentId = getLastInsertId(insertResult);

    await commitWriteTransactionIfSupported(db, transactionStarted);

    return {
      saved: true,
      appuntamentoId: appointmentId,
      appliedAdjustments: plan.adjustments
    };
  } catch (error) {
    await rollbackWriteTransactionIfSupported(db, transactionStarted);
    throw error;
  }
}

export async function updateAppuntamento(
  input: UpdateAppuntamentoInput,
  options?: AppuntamentoWriteOptions
): Promise<AppuntamentoWriteOutcome> {
  const existing = await getAppuntamentoById(input.id);
  if (!existing) {
    throw new Error(`Appuntamento ${input.id} non trovato`);
  }

  const nextPazienteId =
    input.paziente_id !== undefined
      ? normalizeIntegerForWrite(input.paziente_id)
      : normalizeIntegerForWrite(existing.paziente_id);
  const nextStartDateTime =
    input.data_ora_inizio !== undefined
      ? normalizeDateTime(input.data_ora_inizio)
      : normalizeDateTime(existing.data_ora_inizio);
  const nextEndDateTime =
    input.data_ora_fine !== undefined
      ? normalizeDateTime(input.data_ora_fine)
      : normalizeDateTime(existing.data_ora_fine);
  const nextMotivo =
    input.motivo !== undefined ? normalizeTextForWrite(input.motivo) : normalizeTextForWrite(existing.motivo);

  const plan = await buildWritePlan({
    ambulatorioId: existing.ambulatorio_id,
    appointmentIdForUpdate: existing.id,
    startDateTime: nextStartDateTime,
    endDateTime: nextEndDateTime,
    options
  });

  if (plan.requiresOutsideHoursConfirmation || plan.requiresOverlapAdjustmentConfirmation) {
    return buildRequiresConfirmationOutcome({
      requiresOutsideHoursConfirmation: plan.requiresOutsideHoursConfirmation,
      outsideHoursMessage: plan.outsideHoursMessage,
      requiresOverlapAdjustmentConfirmation: plan.requiresOverlapAdjustmentConfirmation,
      adjustments: plan.adjustments
    });
  }

  if (isApiDataProvider()) {
    for (const update of plan.updatesToApply) {
      await updateAppuntamentoFromApi({
        id: update.id,
        data_ora_inizio: update.startDateTime,
        data_ora_fine: update.endDateTime
      });
    }

    await updateAppuntamentoFromApi({
      id: input.id,
      paziente_id: nextPazienteId ?? undefined,
      data_ora_inizio: plan.finalStartDateTime,
      data_ora_fine: plan.finalEndDateTime,
      motivo: nextMotivo ?? undefined
    });

    return {
      saved: true,
      appuntamentoId: existing.id,
      appliedAdjustments: plan.adjustments
    };
  }

  const db = await initDatabase();
  const transactionStarted = await beginWriteTransactionIfSupported(db);

  try {
    await applyExistingAppointmentAdjustments({
      db,
      updates: plan.updatesToApply
    });

    await db.execute(
      `UPDATE appuntamenti
       SET
         paziente_id = ?,
         data_ora_inizio = ?,
         data_ora_fine = ?,
         durata_minuti = ?,
         motivo = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        nextPazienteId,
        plan.finalStartDateTime,
        plan.finalEndDateTime,
        normalizeIntegerForWrite(plan.finalDurationMinutes),
        nextMotivo,
        normalizeIntegerForWrite(input.id)
      ]
    );

    await commitWriteTransactionIfSupported(db, transactionStarted);

    return {
      saved: true,
      appuntamentoId: existing.id,
      appliedAdjustments: plan.adjustments
    };
  } catch (error) {
    await rollbackWriteTransactionIfSupported(db, transactionStarted);
    throw error;
  }
}

export async function deleteAppuntamento(id: number): Promise<void> {
  if (isApiDataProvider()) {
    await deleteAppuntamentoFromApi(id);
    return;
  }

  const db = await initDatabase();
  await db.execute('DELETE FROM appuntamenti WHERE id = ?', [normalizeIntegerForWrite(id)]);
}

export async function updateAppuntamentoSourceVisitaId(params: {
  appuntamentoId: number;
  sourceVisitaId: number | null;
}): Promise<void> {
  if (isApiDataProvider()) {
    await updateAppuntamentoSourceVisitaIdFromApi(params);
    return;
  }

  const db = await initDatabase();
  await db.execute(
    `UPDATE appuntamenti
     SET source_visita_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      normalizeIntegerForWrite(params.sourceVisitaId),
      normalizeIntegerForWrite(params.appuntamentoId)
    ]
  );
}

export async function createFollowUpAppuntamentoFromVisita(params: {
  visitaId: number;
  ambulatorioId: number;
  pazienteId: number;
  dataOraInizio: string;
  dataOraFine?: string;
  motivo?: string;
  options?: AppuntamentoWriteOptions;
}): Promise<AppuntamentoWriteOutcome> {
  const existing = await getAppuntamentoBySourceVisitaId(params.visitaId);
  if (existing) {
    return {
      saved: true,
      appuntamentoId: existing.id,
      appliedAdjustments: []
    };
  }

  const startDateTime = normalizeDateTime(params.dataOraInizio);
  const durationSettings = await resolveAmbulatorioDurationSettings(params.ambulatorioId);
  const endDateTime = params.dataOraFine
    ? normalizeDateTime(params.dataOraFine)
    : addMinutes(startDateTime, durationSettings.standardDurationMinutes);

  const plan = await buildWritePlan({
    ambulatorioId: params.ambulatorioId,
    startDateTime,
    endDateTime,
    settings: durationSettings.settings,
    options: params.options
  });

  if (plan.requiresOutsideHoursConfirmation || plan.requiresOverlapAdjustmentConfirmation) {
    return buildRequiresConfirmationOutcome({
      requiresOutsideHoursConfirmation: plan.requiresOutsideHoursConfirmation,
      outsideHoursMessage: plan.outsideHoursMessage,
      requiresOverlapAdjustmentConfirmation: plan.requiresOverlapAdjustmentConfirmation,
      adjustments: plan.adjustments
    });
  }

  if (isApiDataProvider()) {
    for (const update of plan.updatesToApply) {
      await updateAppuntamentoFromApi({
        id: update.id,
        data_ora_inizio: update.startDateTime,
        data_ora_fine: update.endDateTime
      });
    }

    const appointmentId = await createFollowUpAppuntamentoFromApi({
      ambulatorio_id: params.ambulatorioId,
      paziente_id: params.pazienteId,
      data_ora_inizio: plan.finalStartDateTime,
      data_ora_fine: plan.finalEndDateTime,
      motivo: params.motivo,
      source_visita_id: params.visitaId
    });

    return {
      saved: true,
      appuntamentoId: appointmentId,
      appliedAdjustments: plan.adjustments
    };
  }

  const db = await initDatabase();
  const transactionStarted = await beginWriteTransactionIfSupported(db);

  try {
    await applyExistingAppointmentAdjustments({
      db,
      updates: plan.updatesToApply
    });

    const insertResult = await db.execute(
      `INSERT INTO appuntamenti (
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
        normalizeIntegerForWrite(params.ambulatorioId),
        normalizeIntegerForWrite(params.pazienteId),
        plan.finalStartDateTime,
        plan.finalEndDateTime,
        normalizeIntegerForWrite(plan.finalDurationMinutes),
        normalizeTextForWrite(params.motivo),
        normalizeIntegerForWrite(params.visitaId)
      ]
    );
    const appointmentId = getLastInsertId(insertResult);

    await commitWriteTransactionIfSupported(db, transactionStarted);

    return {
      saved: true,
      appuntamentoId: appointmentId,
      appliedAdjustments: plan.adjustments
    };
  } catch (error) {
    await rollbackWriteTransactionIfSupported(db, transactionStarted);
    throw error;
  }
}

async function findFirstSlot(params: FindFirstSlotParams & { mode: 'urgent' | 'quarter_hour' }): Promise<FirstSlotSearchResult> {
  const searchStartDateTime = getDefaultSearchStartDateTime(params.fromDateTime);
  const horizonDays = getSearchHorizonDays(params.horizonDays);
  const searchStartDate = new Date(searchStartDateTime);
  const horizonEndDate = new Date(searchStartDate);
  horizonEndDate.setDate(horizonEndDate.getDate() + horizonDays);
  const horizonEndDateTime = formatDateTime(horizonEndDate);

  const durationSettings = await resolveAmbulatorioDurationSettings(params.ambulatorioId);
  const settings = durationSettings.settings;
  if (settings.windows.length === 0) {
    return {
      found: false,
      startDateTime: null,
      endDateTime: null,
      requiresAdjustmentHint: false,
      reasonIfNotFound: 'Nessun orario operativo configurato per questo ambulatorio.'
    };
  }

  const candidateDurationMinutes =
    params.mode === 'urgent'
      ? Math.max(MIN_ALLOWED_VISIT_DURATION_MINUTES, durationSettings.minDurationMinutes)
      : durationSettings.standardDurationMinutes;
  const stepMinutes = params.mode === 'urgent' ? URGENT_SLOT_STEP_MINUTES : QUARTER_HOUR_STEP_MINUTES;
  const firstSearchDay = new Date(`${searchStartDateTime.slice(0, 10)}T00:00`);
  const dayCounts = await getDailyAppointmentCountsByRange({
    ambulatorioId: params.ambulatorioId,
    rangeStart: `${formatDateOnly(firstSearchDay)}T00:00`,
    rangeEndExclusive: horizonEndDateTime
  });
  const appointmentCountByDay = new Map(
    dayCounts.map((row) => [row.date, Number(row.total || 0)])
  );
  let blockedByDailyCapacity = false;

  for (let offsetDays = 0; offsetDays <= horizonDays; offsetDays += 1) {
    const dayDate = new Date(firstSearchDay);
    dayDate.setDate(firstSearchDay.getDate() + offsetDays);
    const day = formatDateOnly(dayDate);
    const dayStartDateTime = `${day}T00:00`;
    if (dayStartDateTime >= horizonEndDateTime) {
      break;
    }

    const weekday = toIsoWeekday(dayStartDateTime);
    const dailyCapacityLimit = getDailyCapacityLimitForWeekday(settings.windows, weekday);
    const currentDailyCount = appointmentCountByDay.get(day) ?? 0;
    if (dailyCapacityLimit !== null && currentDailyCount >= dailyCapacityLimit) {
      blockedByDailyCapacity = true;
      continue;
    }

    const dayWindows = getDayWindowsFromSettings({
      day,
      weekday,
      windows: settings.windows
    });

    for (const dayWindow of dayWindows) {
      let candidateStartDateTime = dayWindow.startDateTime;
      if (day === searchStartDateTime.slice(0, 10) && candidateStartDateTime < searchStartDateTime) {
        candidateStartDateTime = searchStartDateTime;
      }

      candidateStartDateTime = roundUpDateTimeToStep(candidateStartDateTime, stepMinutes);

      while (
        candidateStartDateTime < dayWindow.endDateTime &&
        candidateStartDateTime < horizonEndDateTime
      ) {
        const candidateEndDateTime = addMinutes(candidateStartDateTime, candidateDurationMinutes);
        if (candidateEndDateTime > dayWindow.endDateTime || candidateEndDateTime > horizonEndDateTime) {
          break;
        }

        try {
          if (params.mode === 'urgent') {
            const plan = await buildWritePlan({
              ambulatorioId: params.ambulatorioId,
              startDateTime: candidateStartDateTime,
              endDateTime: candidateEndDateTime,
              settings,
              options: {
                confirmOutsideHours: true,
                confirmOverlapAdjustments: true
              }
            });

            return {
              found: true,
              startDateTime: plan.finalStartDateTime,
              endDateTime: plan.finalEndDateTime,
              requiresAdjustmentHint: plan.adjustments.length > 0
            };
          }

          const plan = await buildWritePlan({
            ambulatorioId: params.ambulatorioId,
            startDateTime: candidateStartDateTime,
            endDateTime: candidateEndDateTime,
            settings
          });
          const requiresConfirmations =
            plan.requiresOutsideHoursConfirmation || plan.requiresOverlapAdjustmentConfirmation;
          const keepsRequestedEndTime = plan.finalEndDateTime === candidateEndDateTime;
          if (!requiresConfirmations && plan.adjustments.length === 0 && keepsRequestedEndTime) {
            return {
              found: true,
              startDateTime: plan.finalStartDateTime,
              endDateTime: plan.finalEndDateTime,
              requiresAdjustmentHint: false
            };
          }
        } catch (error) {
          if (!isRetryableFirstSlotCandidateError(error)) {
            throw error;
          }
        }

        candidateStartDateTime = addMinutes(candidateStartDateTime, stepMinutes);
      }
    }
  }

  return {
    found: false,
    startDateTime: null,
    endDateTime: null,
    requiresAdjustmentHint: false,
    reasonIfNotFound:
      blockedByDailyCapacity
        ? `Nessuno slot disponibile entro ${horizonDays} giorni: raggiunto il numero massimo pazienti nei giorni utili.`
        :
      params.mode === 'urgent'
        ? `Nessuno slot urgente disponibile entro ${horizonDays} giorni.`
        : `Nessuno slot disponibile (00/15/30/45) entro ${horizonDays} giorni.`
  };
}

export async function findFirstUrgentSlot(params: FindFirstSlotParams): Promise<FirstSlotSearchResult> {
  return findFirstSlot({
    ...params,
    mode: 'urgent'
  });
}

export async function findFirstQuarterHourSlot(
  params: FindFirstSlotParams
): Promise<FirstSlotSearchResult> {
  return findFirstSlot({
    ...params,
    mode: 'quarter_hour'
  });
}

export function normalizeAppuntamentoDateTimeInput(value: string): string {
  return normalizeDateTime(value);
}

export function getDefaultSlotConfiguration(settings: AmbulatorioOperatingSettings): {
  startHour: number;
  endHour: number;
  durationMinutes: number;
} {
  const minDurationMinutes = normalizeMinVisitDuration(Number(settings.durataMinimaVisitaMinuti));
  const standardDurationMinutes = normalizeStandardVisitDuration(
    Number(settings.durataStandardVisitaMinuti),
    minDurationMinutes
  );
  const minuteBounds = settings.windows
    .map((window) => {
      try {
        const startMinutes = timeToMinutes(window.ora_inizio);
        const endMinutes = timeToMinutes(window.ora_fine);
        if (startMinutes >= endMinutes) {
          return null;
        }
        return { startMinutes, endMinutes };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { startMinutes: number; endMinutes: number } => entry !== null);

  if (!hasConfiguredOperatingWindows(settings.windows) || minuteBounds.length === 0) {
    throw new Error(VISIT_SETTINGS_REQUIRED_MESSAGE);
  }

  const startMinutes = Math.min(...minuteBounds.map((entry) => entry.startMinutes));
  const endMinutes = Math.max(...minuteBounds.map((entry) => entry.endMinutes));
  const startHour = Math.floor(startMinutes / 60);
  const endHour = Math.ceil(endMinutes / 60);

  return {
    startHour,
    endHour,
    durationMinutes: standardDurationMinutes
  };
}

export function getAppuntamentoEndDateTime(
  startDateTime: string,
  durationMinutes: number
): string {
  const normalizedDuration = normalizeMinVisitDuration(Number(durationMinutes));
  return addMinutes(startDateTime, normalizedDuration);
}

export function parseFollowUpScheduling(raw: string | null | undefined): {
  dataOraProssimaVisita: string;
  motivoProssimaVisita: string;
} | null {
  if (!raw || !raw.trim()) {
    return null;
  }

  let parsed: { dataOraProssimaVisita?: unknown; motivoProssimaVisita?: unknown };
  try {
    parsed = JSON.parse(raw) as { dataOraProssimaVisita?: unknown; motivoProssimaVisita?: unknown };
  } catch {
    return null;
  }

  if (typeof parsed.dataOraProssimaVisita !== 'string' || !parsed.dataOraProssimaVisita.trim()) {
    return null;
  }

  let normalizedDateTime: string;
  try {
    normalizedDateTime = normalizeDateTime(parsed.dataOraProssimaVisita);
  } catch {
    return null;
  }

  return {
    dataOraProssimaVisita: normalizedDateTime,
    motivoProssimaVisita:
      typeof parsed.motivoProssimaVisita === 'string' ? parsed.motivoProssimaVisita.trim() : ''
  };
}

export async function getSlotConflictByDateTime(params: {
  ambulatorioId: number;
  dataOraInizio: string;
  dataOraFine?: string;
  excludeAppuntamentoId?: number;
}): Promise<Appuntamento | null> {
  const startDateTime = normalizeDateTime(params.dataOraInizio);
  const durationSettings = await resolveAmbulatorioDurationSettings(params.ambulatorioId);
  const endDateTime = params.dataOraFine
    ? normalizeDateTime(params.dataOraFine)
    : addMinutes(startDateTime, durationSettings.standardDurationMinutes);

  const conflicts = await getOverlappingAppointments({
    ambulatorioId: params.ambulatorioId,
    startDateTime,
    endDateTime,
    excludeAppuntamentoId: params.excludeAppuntamentoId
  });

  return conflicts[0] ?? null;
}

export async function getAmbulatorioOperatingWindows(ambulatorioId: number) {
  return getAmbulatorioOperatingWindowsById(ambulatorioId);
}
