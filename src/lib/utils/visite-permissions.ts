export const VISITA_EDIT_DELETE_MAX_AGE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

function parseVisitaDate(value: string): Date | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hours = Number(match[4] ?? '0');
    const minutes = Number(match[5] ?? '0');
    const seconds = Number(match[6] ?? '0');
    const parsed = new Date(year, month - 1, day, hours, minutes, seconds);

    const isValid =
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day &&
      parsed.getHours() === hours &&
      parsed.getMinutes() === minutes &&
      parsed.getSeconds() === seconds;

    return isValid ? parsed : null;
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function isVisitaWithinEditDeleteWindow(
  dataVisita: string,
  now: Date = new Date(),
  maxAgeDays: number = VISITA_EDIT_DELETE_MAX_AGE_DAYS
): boolean {
  const visitaDate = parseVisitaDate(dataVisita);
  if (!visitaDate || !Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    return false;
  }

  const elapsedMs = now.getTime() - visitaDate.getTime();
  const maxAgeMs = maxAgeDays * DAY_MS;

  return elapsedMs < maxAgeMs;
}

export function getVisitaEditDeleteLockedMessage(maxAgeDays: number = VISITA_EDIT_DELETE_MAX_AGE_DAYS): string {
  return `Modifica ed eliminazione consentite solo se sono passati meno di ${maxAgeDays} giorni dalla data visita.`;
}

export function getVisitaPreviousVersionLockedMessage(): string {
  return 'Questa visita è una versione precedente e non può essere modificata o eliminata.';
}
