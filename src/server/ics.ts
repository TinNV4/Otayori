import { ExtractedDocument, Family } from '../types/index.ts';

/**
 * Format Date string (YYYY-MM-DD) into iCalendar Date format YYYYMMDD
 */
function formatIcsDate(dateStr: string): string {
  return dateStr.replace(/[^0-9]/g, '');
}

/**
 * Escape text for iCalendar RFC 5545 compliance (escaping commas, semicolons, backslashes and newlines)
 */
function escapeIcsText(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/**
 * Generate RFC 5545 compliant iCalendar content with 1-day advance VALARM
 */
export function generateIcsCalendar(family: Family, documents: ExtractedDocument[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GiayToNhat//TroLyGiaDinh//VI',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`Giấy Tờ Nhật - ${family.family_name}`)}`,
    'X-WR-TIMEZONE:Asia/Tokyo',
    'REFRESH-INTERVAL;VALUE=DURATION:P1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  const nowStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  // Iterate over all documents of this family
  for (const doc of documents) {
    // 1. Add specific events extracted from the document
    for (const evt of doc.events) {
      if (!evt.date) continue;
      const cleanDate = formatIcsDate(evt.date);
      if (cleanDate.length !== 8) continue; // must be YYYYMMDD

      const eventUid = `evt-${doc.id}-${evt.id}@giaytonhat.app`;

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${eventUid}`);
      lines.push(`DTSTAMP:${nowStamp}`);
      lines.push(`DTSTART;VALUE=DATE:${cleanDate}`);
      lines.push(`DTEND;VALUE=DATE:${cleanDate}`);
      lines.push(`SUMMARY:${escapeIcsText(`[${doc.issuer || 'Giấy tờ'}] ${evt.title_vi}`)}`);
      
      const descLines = [
        `📄 Nguồn: ${doc.title_vi} (${doc.title_jp})`,
        evt.description_vi ? `ℹ️ Nội dung: ${evt.description_vi}` : '',
        evt.time ? `⏰ Giờ: ${evt.time}` : '',
        evt.location ? `📍 Địa điểm: ${evt.location}` : '',
        doc.items_to_bring.length > 0 ? `🎒 Đồ cần mang: ${doc.items_to_bring.join(', ')}` : '',
        '------------------',
        'Trợ lý giấy tờ Nhật cho gia đình Việt (Đồng bộ qua ICS)',
      ].filter(Boolean).join('\n');

      lines.push(`DESCRIPTION:${escapeIcsText(descLines)}`);
      if (evt.location) {
        lines.push(`LOCATION:${escapeIcsText(evt.location)}`);
      }

      // VALARM: 1 day advance reminder (-P1D)
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeIcsText(`Ngày mai: ${evt.title_vi} - Giấy Tờ Nhật`)}`);
      lines.push('TRIGGER:-P1D');
      lines.push('END:VALARM');

      lines.push('END:VEVENT');
    }

    // 2. Add action deadlines as separate calendar alerts if not already in events
    for (const action of doc.actions) {
      if (!action.deadline) continue;
      const cleanDeadline = formatIcsDate(action.deadline);
      if (cleanDeadline.length !== 8) continue;

      const actionUid = `act-${doc.id}-${action.id}@giaytonhat.app`;

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${actionUid}`);
      lines.push(`DTSTAMP:${nowStamp}`);
      lines.push(`DTSTART;VALUE=DATE:${cleanDeadline}`);
      lines.push(`DTEND;VALUE=DATE:${cleanDeadline}`);
      lines.push(`SUMMARY:${escapeIcsText(`[HẠN CHÓT] ${action.todo_vi}`)}`);
      
      const descLines = [
        `⚠️ Hạn chót cần làm: ${action.todo_vi}`,
        `📄 Từ giấy tờ: ${doc.title_vi} (${doc.title_jp})`,
        `🏢 Nơi phát hành: ${doc.issuer}`,
        '------------------',
        'Trợ lý giấy tờ Nhật - Đừng quên nộp đúng hạn!',
      ].join('\n');

      lines.push(`DESCRIPTION:${escapeIcsText(descLines)}`);

      // 1 day advance reminder for deadline
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeIcsText(`HẠN CHÓT NGÀY MAI: ${action.todo_vi}`)}`);
      lines.push('TRIGGER:-P1D');
      lines.push('END:VALARM');

      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
