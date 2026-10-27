import { ExtractedDocument, Family } from '../types/index.ts';
import { nextDayCompact } from './time.ts';
import { eventKey, normText } from './dedupe.ts';

/** RFC 5545 §3.3.11 TEXT escaping. */
export function escapeIcsText(str: string | undefined): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/** RFC 5545 §3.1: fold lines longer than 75 octets (UTF-8), never splitting a code point. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curLen = 0;
  let limit = 75;
  for (const ch of line) {
    const len = enc.encode(ch).length;
    if (curLen + len > limit) {
      out.push(cur);
      cur = '';
      curLen = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    curLen += len;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const compactDate = (d: string) => d.replace(/-/g, '');
const compactTime = (t: string) => t.replace(':', '') + '00';

const VTIMEZONE_TOKYO = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Tokyo',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0900',
  'TZOFFSETTO:+0900',
  'TZNAME:JST',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function alarm(description: string, trigger = '-P1D'): string[] {
  return ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcsText(description)}`, `TRIGGER:${trigger}`, 'END:VALARM'];
}

/**
 * Family calendar feed. Events become VEVENTs (timed when a start time is known, otherwise all-day),
 * open action deadlines become all-day "[HẠN]" VEVENTs. Each has a VALARM one day before.
 */
export function generateIcsCalendar(family: Family, documents: ExtractedDocument[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GiayToNhat//TroLyGiaDinh//VI',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`Giấy Tờ Nhật · ${family.family_name}`)}`,
    'X-WR-TIMEZONE:Asia/Tokyo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE_TOKYO,
  ];

  // Safety net: the same event/deadline from two documents appears once.
  const seen = new Set<string>();
  const firstTime = (key: string) => (seen.has(key) ? false : (seen.add(key), true));

  for (const doc of documents) {
    const source = `📄 ${doc.title_vi}${doc.title_jp ? ` (${doc.title_jp})` : ''}`;

    for (const evt of doc.events) {
      const date = compactDate(evt.date || '');
      if (!/^\d{8}$/.test(date) || !firstTime(`e|${eventKey(evt)}`)) continue;
      const mark = evt.date_uncertain ? '[?] ' : '';
      const desc = [
        source,
        evt.description_vi ? `ℹ️ ${evt.description_vi}` : '',
        evt.time ? `⏰ ${evt.time}` : '',
        evt.location ? `📍 ${evt.location}` : '',
        doc.items_to_bring.length ? `🎒 Cần mang: ${doc.items_to_bring.join(', ')}` : '',
        evt.date_uncertain ? '⚠️ Ngày chưa chắc chắn — vui lòng kiểm tra lại giấy gốc.' : '',
      ].filter(Boolean).join('\n');

      lines.push('BEGIN:VEVENT', `UID:evt-${doc.id}-${evt.id}@giaytonhat.app`, `DTSTAMP:${stamp}`);
      if (evt.start_time) {
        const end = evt.end_time || evt.start_time;
        lines.push(`DTSTART;TZID=Asia/Tokyo:${date}T${compactTime(evt.start_time)}`);
        lines.push(evt.end_time ? `DTEND;TZID=Asia/Tokyo:${date}T${compactTime(end)}` : 'DURATION:PT1H');
      } else {
        lines.push(`DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${nextDayCompact(date)}`);
      }
      lines.push(`SUMMARY:${escapeIcsText(`${mark}${evt.title_vi}`)}`, `DESCRIPTION:${escapeIcsText(desc)}`);
      if (evt.location) lines.push(`LOCATION:${escapeIcsText(evt.location)}`);
      lines.push(...alarm(`Ngày mai: ${evt.title_vi}`), 'END:VEVENT');
    }

    for (const action of doc.actions) {
      if (!action.deadline || action.completed) continue;
      const date = compactDate(action.deadline);
      if (!/^\d{8}$/.test(date) || !firstTime(`a|${action.deadline}|${normText(action.todo_vi)}`)) continue;
      const mark = action.deadline_uncertain ? '[?] ' : '';
      const desc = [
        `⚠️ Việc cần làm: ${action.todo_vi}`,
        source,
        doc.issuer ? `🏢 ${doc.issuer}` : '',
      ].filter(Boolean).join('\n');
      lines.push(
        'BEGIN:VEVENT',
        `UID:act-${doc.id}-${action.id}@giaytonhat.app`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${date}`,
        `DTEND;VALUE=DATE:${nextDayCompact(date)}`,
        `SUMMARY:${escapeIcsText(`${mark}[HẠN] ${action.todo_vi}`)}`,
        `DESCRIPTION:${escapeIcsText(desc)}`,
        'TRANSP:TRANSPARENT',
        ...alarm(`Hạn ngày mai: ${action.todo_vi}`),
        'END:VEVENT',
      );
    }
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
