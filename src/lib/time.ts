/**
 * UK timezone utilities.
 *
 * All OANDA candle timestamps are UTC milliseconds. The Crossfire strategy
 * operates on UK wall-clock time (08:00–16:00 Europe/London). During British
 * Summer Time (BST, UTC+1, late March–late October), UK 13:00 = UTC 12:00.
 * Using Date.getHours() on a UTC timestamp returns the wrong hour for ~7
 * months of the year when the runtime timezone is UTC (e.g. Vercel).
 *
 * These functions use Intl.DateTimeFormat with timeZone: 'Europe/London',
 * which consults the IANA timezone database built into every modern JS runtime
 * (Node 18+, V8, Vercel serverless). No third-party library required.
 */

function getUKParts(tsMs: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(tsMs))

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(p => p.type === type)?.value ?? '00'

  return {
    year:   get('year'),
    month:  get('month'),
    day:    get('day'),
    hour:   parseInt(get('hour'), 10),
    minute: get('minute'),
  }
}

/**
 * Convert a UTC timestamp (ms) to the UK wall-clock hour (0–23).
 * Correctly handles GMT (UTC+0) and BST (UTC+1).
 *
 * @example
 * // July, BST period: UTC 12:00 = UK 13:00
 * toUKHour(Date.UTC(2024, 6, 15, 12, 0, 0)) // → 13
 *
 * // January, GMT period: UTC 13:00 = UK 13:00
 * toUKHour(Date.UTC(2024, 0, 15, 13, 0, 0)) // → 13
 */
export function toUKHour(tsMs: number): number {
  return getUKParts(tsMs).hour
}

/**
 * Return a stable YYYY-MM-DD date string in UK local time.
 * Use this instead of Date.toDateString() for day-boundary-safe grouping.
 *
 * @example
 * // BST period: 23:30 UTC on Jun 15 = 00:30 UK on Jun 16
 * toUKDateString(Date.UTC(2024, 5, 15, 23, 30, 0)) // → "2024-06-16"
 */
export function toUKDateString(tsMs: number): string {
  const { year, month, day } = getUKParts(tsMs)
  return `${year}-${month}-${day}`
}

/**
 * Return a UK HH:MM string for display and logging.
 *
 * @example
 * // BST period: UTC 12:00 = UK 13:00
 * toUKTimeString(Date.UTC(2024, 6, 15, 12, 0, 0)) // → "13:00"
 */
export function toUKTimeString(tsMs: number): string {
  const { hour, minute } = getUKParts(tsMs)
  return `${String(hour).padStart(2, '0')}:${minute}`
}
