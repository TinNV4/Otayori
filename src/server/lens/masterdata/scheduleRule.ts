import { ScheduleRule } from './types.ts';

const WEEKDAYS = '月火水木金土日';
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const weekdayNumber = (ch: string) => WEEKDAYS.indexOf(ch) + 1;

/** "no collection" cells. */
const NONE = /^(?:なし|無し|無|収集なし|-+|ー+|―+|－+|—+|×|✕|\/|)$/;

/**
 * City schedule cell → rule.
 *   "月・木" / "毎週月曜日" / "月木"      → weekly on Mon, Thu
 *   "第2・4水曜日" / "第1,3火" / "第2第4水" → every month, 2nd and 4th Wednesday
 * Returns `'none'` for an empty/"なし" cell and `null` for text it can't read (the caller must stop, not guess).
 */
export function parseRuleText(raw: string): ScheduleRule | 'none' | null {
  const s = raw
    .normalize('NFKC')
    .replace(/[（(][^）)]*[）)]/g, '') // "(祝日も収集)" etc.
    // "月曜日～土曜日" → every day Mon..Sat
    .replace(/([月火水木金土日])曜?日?\s*[~〜～ー-]\s*([月火水木金土日])曜?日?/g, (_m, a: string, b: string) => {
      const i = WEEKDAYS.indexOf(a);
      const j = WEEKDAYS.indexOf(b);
      const span = j >= i ? WEEKDAYS.slice(i, j + 1) : WEEKDAYS.slice(i) + WEEKDAYS.slice(0, j + 1);
      return span.split('').join(',');
    })
    .replace(/毎週|曜日|曜/g, '')
    .replace(/[・･、,;；／/＋+\s]+/g, ',')
    .replace(/^,|,$/g, '');
  if (NONE.test(s)) return 'none';

  const nth = s.match(/^第?([1-5](?:[,第]+[1-5])*)週?,?([月火水木金土日](?:,?[月火水木金土日])*)$/);
  if (nth) {
    const nths = [...new Set(nth[1].split(/[,第]+/).map(Number))].sort((a, b) => a - b);
    const days = [...new Set([...nth[2].replace(/,/g, '')].map(weekdayNumber))].sort((a, b) => a - b);
    return { type: 'nth', days, nths };
  }
  const weekly = s.match(/^[月火水木金土日](?:,?[月火水木金土日])*$/);
  if (weekly) return { type: 'weekly', days: [...new Set([...s.replace(/,/g, '')].map(weekdayNumber))].sort((a, b) => a - b) };
  return null;
}

/**
 * City schedule tables give the area as a town plus a "丁目" cell that can be a whole town, one chome, a list or a range:
 *   "全域" / "" → the town as a whole            → ["江原町"]
 *   "3" / "3丁目"                                → ["野方3丁目"]
 *   "1;2;4;5" / "1・2丁目" / "1,2"               → one area per chome
 *   "1～2丁目" / "3～6丁目"                      → every chome in the range
 *   "1丁目1～16番" (a block of a chome)          → kept literally: no chome-level answer can claim it
 * Keys are "<town><n>丁目" (or just "<town>"), the form normArea() compares against.
 */
export function expandAreas(town: string, chomeCell: string): string[] {
  const t = town.normalize('NFKC').replace(/\s+/g, '');
  const c = chomeCell.normalize('NFKC').replace(/\s+/g, '');
  if (!t) return [];
  if (!c || /^(全域|全て|すべて|全地域)$/.test(c)) return [t];
  if (/番|号/.test(c)) return [`${t}${c}`]; // a block inside a chome
  const range = c.match(/^(\d{1,2})[~〜～-](\d{1,2})丁目?$/);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    if (b >= a && b - a <= 20) return Array.from({ length: b - a + 1 }, (_, i) => `${t}${a + i}丁目`);
  }
  const list = c.replace(/丁目/g, '').split(/[,;；・、]/).filter(Boolean);
  if (list.length && list.every(n => /^\d{1,2}$/.test(n))) return [...new Set(list)].map(n => `${t}${Number(n)}丁目`);
  return [`${t}${c}`];
}
