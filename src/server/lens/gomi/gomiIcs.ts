import { escapeIcsText, foldLine } from '../../ics.ts';
import { nextDayCompact } from '../../time.ts';
import { FamilyRegion } from '../../../types/index.ts';
import { ScheduleRow, ScheduleRule } from '../masterdata/types.ts';
import { CLASS_VI } from './compose.ts';
import { describeRule, firstDate, Suspension, suspendedDates } from './schedule.ts';

const compact = (d: string) => d.replace(/-/g, '');
const BYDAY = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export function rruleFor(rule: ScheduleRule): string {
  if (rule.type === 'weekly') return `FREQ=WEEKLY;BYDAY=${rule.days.map(d => BYDAY[d]).join(',')}`;
  return `FREQ=MONTHLY;BYDAY=${rule.nths.flatMap(n => rule.days.map(d => `${n}${BYDAY[d]}`)).join(',')}`;
}

/**
 * Waste-collection feed for one area. One recurring all-day event per category, with an alarm at
 * 20:00 the evening before (all-day events start at 00:00, so -PT4H). The calendar app does the
 * reminding: no LINE push, no quota.
 */
export function generateGomiIcs(
  region: FamilyRegion,
  rows: ScheduleRow[],
  suspensions: Suspension[],
  today: string,
  now = new Date(),
): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const where = region.chome_label ? `${region.city_name_jp} ${region.chome_label}` : region.city_name_jp;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GiayToNhat//LichDoRac//VI',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`Lịch đổ rác · ${where}`)}`,
    'X-WR-TIMEZONE:Asia/Tokyo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
  ];

  for (const r of rows) {
    const start = firstDate(r.rule, today);
    if (!start) continue;
    const label = `${CLASS_VI[r.common_class]} (${r.local_category})`;
    const desc = [
      `📍 ${where}`,
      `🗓️ ${describeRule(r.rule)}`,
      `Nguồn: ${r.attribution}, cập nhật ${r.source_updated_at}.`,
      '⚠️ Có thể thay đổi dịp lễ / cuối năm — xem thông báo của thành phố.',
    ].join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:gomi-${r.id}@giaytonhat.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(start)}`,
      `DTEND;VALUE=DATE:${nextDayCompact(compact(start))}`,
      `RRULE:${rruleFor(r.rule)}`,
    );
    const ex = suspendedDates(r.rule, today, suspensions);
    if (ex.length) lines.push(`EXDATE;VALUE=DATE:${ex.map(compact).join(',')}`);
    lines.push(
      `SUMMARY:${escapeIcsText(`🗑️ ${label}`)}`,
      `DESCRIPTION:${escapeIcsText(desc)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(`Mai đổ rác: ${label}. Chuẩn bị tối nay!`)}`,
      'TRIGGER:-PT4H',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
