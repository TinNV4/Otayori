/** Decode a downloaded file. Many city CSVs are Shift_JIS (CP932); a UTF-8 BOM is stripped. */
export function decodeText(bytes: Uint8Array, encoding: 'utf-8' | 'shift_jis'): string {
  const text = new TextDecoder(encoding === 'shift_jis' ? 'shift_jis' : 'utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

/** CSV → objects keyed by (trimmed) header. */
export function csvToRecords(text: string): { headers: string[]; records: Array<Record<string, string>> } {
  const [head = [], ...body] = parseCsv(text);
  const headers = head.map(h => h.trim());
  const records = body.map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, records };
}
