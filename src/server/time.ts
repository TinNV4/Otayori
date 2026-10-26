const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** YYYY-MM-DD in Japan time. */
export function jstDate(d: Date = new Date()): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM in Japan time (quota/budget month). */
export function jstMonth(d: Date = new Date()): string {
  return jstDate(d).slice(0, 7);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Next calendar day of a YYYYMMDD string (for all-day DTEND). */
export function nextDayCompact(yyyymmdd: string): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10).replace(/-/g, '');
}

export function isValidIsoDate(s: string | undefined | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function isValidHm(s: string | undefined | null): s is string {
  return !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
