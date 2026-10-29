import { MasterStore } from '../masterdata/store.ts';
import { CommonClass, isScheduleRow, ScheduleRow, ScheduleRule, SourceConfig } from '../masterdata/types.ts';

export interface Suspension { from: string; to: string } // MM-DD, inclusive, may wrap the new year

/** Verified schedule rows of a city plus the dates it publishes as "no collection". */
export interface ScheduleBook {
  rows(cityCode: string): ScheduleRow[];
  suspensions(cityCode: string): Suspension[];
}

export function scheduleFromStore(store: MasterStore, sources: SourceConfig[], ttlMs = 10 * 60_000): ScheduleBook {
  const cache = new Map<string, { at: number; rows: ScheduleRow[]; sus: Suspension[] }>();
  const load = (cityCode: string) => {
    const hit = cache.get(cityCode);
    if (hit && Date.now() - hit.at < ttlMs) return hit;
    const rows = new Map<string, ScheduleRow>();
    const sus: Suspension[] = [];
    for (const s of sources.filter(x => x.city_code === cityCode && x.kind === 'gomi_schedule')) {
      for (const r of store.getLive(s.id)?.rows ?? []) if (isScheduleRow(r) && r.status === 'verified') rows.set(r.id, r);
      sus.push(...(s.schedule?.suspensions ?? []));
    }
    const entry = { at: Date.now(), rows: [...rows.values()], sus };
    cache.set(cityCode, entry);
    return entry;
  };
  return { rows: c => load(c).rows, suspensions: c => load(c).sus };
}

// ---------- areas ----------

const KANJI_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** "西日暮里二丁目" / "西日暮里2丁目" / " 西日暮里 ２丁目" → "西日暮里2丁目". */
export function normArea(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '')
    .replace(/([一二三四五六七八九十]{1,2})丁目/g, (_m, k: string) => {
      const n = k.length === 2 ? (k[0] === '十' ? 10 + KANJI_DIGITS[k[1]] : KANJI_DIGITS[k[0]] * 10) : KANJI_DIGITS[k];
      return `${n}丁目`;
    });
}

const ruleKey = (r: ScheduleRow) => `${r.common_class}|${r.local_category}|${JSON.stringify(r.rule)}`;

/**
 * The schedule rows that apply to a family's area.
 *   - city-wide rows ('*') always apply;
 *   - "西日暮里2丁目" matches that exact area;
 *   - a town without a chome ("西日暮里") matches its chomes only if they all collect the same way,
 *     otherwise the answer would be a guess → `ambiguous`.
 */
export function areaRows(rows: ScheduleRow[], chomeLabel: string | undefined): { rows: ScheduleRow[]; ambiguous: boolean } {
  const wide = rows.filter(r => r.area_key === '*');
  if (wide.length && !rows.some(r => r.area_key !== '*')) return { rows: wide, ambiguous: false };
  if (!chomeLabel) return { rows: [], ambiguous: rows.some(r => r.area_key !== '*') };

  const label = normArea(chomeLabel);
  const exact = rows.filter(r => r.area_key !== '*' && normArea(r.area_key) === label);
  if (exact.length) return { rows: exact, ambiguous: false };

  // A whole-town row ("江原町") covers every chome of that town ("江原町2丁目").
  const wholeTown = rows.filter(r => r.area_key !== '*' && !/丁目|番|号/.test(r.area_key) && label.startsWith(normArea(r.area_key)));
  if (wholeTown.length) {
    const longest = Math.max(...wholeTown.map(r => r.area_key.length));
    return { rows: wholeTown.filter(r => r.area_key.length === longest), ambiguous: false };
  }

  const inTown = rows.filter(r => r.area_key !== '*' && normArea(r.area_key).startsWith(label));
  if (!inTown.length) return { rows: [], ambiguous: false };
  const byArea = new Map<string, Set<string>>();
  for (const r of inTown) byArea.set(r.area_key, (byArea.get(r.area_key) ?? new Set()).add(ruleKey(r)));
  const sets = [...byArea.values()].map(s => [...s].sort().join('\n'));
  if (sets.every(s => s === sets[0])) {
    const first = [...byArea.keys()][0];
    return { rows: inTown.filter(r => r.area_key === first), ambiguous: false };
  }
  return { rows: [], ambiguous: true };
}

// ---------- dates ----------

const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** ISO weekday 1..7 of a YYYY-MM-DD. */
export const isoWeekday = (d: string) => ((new Date(utc(d)).getUTCDay() + 6) % 7) + 1;

export function inSuspension(date: string, sus: Suspension[]): boolean {
  const md = date.slice(5);
  return sus.some(s => (s.from <= s.to ? md >= s.from && md <= s.to : md >= s.from || md <= s.to));
}

export function occursOn(rule: ScheduleRule, date: string): boolean {
  if (!rule.days.includes(isoWeekday(date))) return false;
  return rule.type === 'weekly' || rule.nths.includes(Math.ceil(Number(date.slice(8, 10)) / 7));
}

/** First collection date on or after `from` (YYYY-MM-DD, Japan time), skipping published suspensions. */
export function nextDate(rule: ScheduleRule, from: string, sus: Suspension[] = [], horizonDays = 400): string | null {
  for (let i = 0; i <= horizonDays; i++) {
    const d = iso(utc(from) + i * DAY);
    if (occursOn(rule, d) && !inSuspension(d, sus)) return d;
  }
  return null;
}

/** Same, but ignoring suspensions (the DTSTART of a recurring ICS event). */
export const firstDate = (rule: ScheduleRule, from: string) => nextDate(rule, from, [], 62);

/** Dates in [from, from+days] the rule would hit but a suspension removes (ICS EXDATE). */
export function suspendedDates(rule: ScheduleRule, from: string, sus: Suspension[], days = 400): string[] {
  const out: string[] = [];
  for (let i = 0; i <= days; i++) {
    const d = iso(utc(from) + i * DAY);
    if (occursOn(rule, d) && inSuspension(d, sus)) out.push(d);
  }
  return out;
}

export const WEEKDAY_VI = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];

export function describeRule(rule: ScheduleRule): string {
  const days = rule.days.map(d => WEEKDAY_VI[d]).join(', ');
  return rule.type === 'weekly' ? `hàng tuần: ${days}` : `tuần ${rule.nths.join(' & ')} của tháng: ${days}`;
}

// ---------- the answer's "next collection" line ----------

export type NextInfo = { date: string; label: string } | { hint: string };

/** Next collection of the given classes for the family's area. `null` = no schedule data at all for this city. */
export function nextCollectionFor(
  book: ScheduleBook, cityCode: string, chomeLabel: string | undefined, classes: CommonClass[], today: string,
): NextInfo | null {
  const all = book.rows(cityCode);
  if (!all.length) return null;
  const { rows, ambiguous } = areaRows(all, chomeLabel);
  if (ambiguous) return { hint: 'Ngày đổ khác nhau theo từng 丁目 — gõ "khu vực" kèm số 丁目 (ví dụ: khu vực 荒川区 西日暮里2丁目) để mình báo đúng ngày.' };
  const sus = book.suspensions(cityCode);
  let best: { date: string; row: ScheduleRow } | null = null;
  for (const r of rows.filter(x => classes.includes(x.common_class))) {
    const d = nextDate(r.rule, today, sus);
    if (d && (!best || d < best.date)) best = { date: d, row: r };
  }
  if (!best) return rows.length ? null : { hint: 'Chưa có lịch đổ rác cho khu của bạn trong dữ liệu.' };
  return { date: best.date, label: `${WEEKDAY_VI[isoWeekday(best.date)]} · 「${best.row.local_category}」` };
}
