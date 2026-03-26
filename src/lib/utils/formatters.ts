// GMD Medical Platform - Formatting Utilities

/**
 * Formats a date from ISO format (YYYY-MM-DD) to Italian format (DD/MM/YYYY)
 */
export function formatDate(isoDate: string): string {
  if (!isoDate) return '';

  const normalizedValue = String(isoDate).trim();
  if (!normalizedValue) return '';

  // Handles plain dates and datetime strings like "YYYY-MM-DDTHH:mm[:ss][Z]"
  const isoDateMatch = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateMatch) {
    return `${isoDateMatch[3]}/${isoDateMatch[2]}/${isoDateMatch[1]}`;
  }

  // If already in Italian format keep it as-is
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalizedValue)) {
    return normalizedValue;
  }

  const parsedDate = new Date(normalizedValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedValue;
  }

  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(parsedDate);
}

/**
 * Parses a date from Italian format (DD/MM/YYYY) to ISO format (YYYY-MM-DD)
 */
export function parseDate(italianDate: string): string {
  if (!italianDate) return '';
  const [day, month, year] = italianDate.split('/');
  return `${year}-${month}-${day}`;
}

/**
 * Capitalizes the first letter of each word
 * Example: "mario rossi" -> "Mario Rossi"
 */
export function capitalizeWords(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Converts text to uppercase
 * Example: "rssmra80e15h501z" -> "RSSMRA80E15H501Z"
 */
export function uppercaseText(text: string): string {
  if (!text) return '';
  return text.toUpperCase();
}

/**
 * Validates Italian date format (DD/MM/YYYY)
 */
export function isValidItalianDate(date: string): boolean {
  const regex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  if (!regex.test(date)) return false;

  const [, day, month, year] = date.match(regex)!;
  const d = parseInt(day, 10);
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);

  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  if (y < 1900 || y > 2100) return false;

  return true;
}

/**
 * Validates Italian fiscal code format (16 alphanumeric characters)
 */
export function isValidFiscalCode(code: string): boolean {
  const regex = /^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$/;
  return regex.test(code.toUpperCase());
}
