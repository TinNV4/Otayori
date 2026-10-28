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
    .replace(/毎週|曜日|曜/g, '')
    .replace(/[・･、,／/＋+・\s]+/g, ',')
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
