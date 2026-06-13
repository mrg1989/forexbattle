// Server-side copy of src/lib/time.ts for use in Vercel serverless functions.
// Vercel ESM bundling does not include src/ files in api/ function deployments,
// so this file must stay in sync with src/lib/time.ts manually.

const _ukFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function getUKParts(tsMs: number) {
  const parts = _ukFmt.formatToParts(new Date(tsMs))
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

export function toUKHour(tsMs: number): number {
  return getUKParts(tsMs).hour
}

export function toUKDateString(tsMs: number): string {
  const { year, month, day } = getUKParts(tsMs)
  return `${year}-${month}-${day}`
}

export function toUKTimeString(tsMs: number): string {
  const { hour, minute } = getUKParts(tsMs)
  return `${String(hour).padStart(2, '0')}:${minute}`
}
