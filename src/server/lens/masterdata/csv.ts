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

/**
 * Some portals put a title row above the header (名古屋市: "50音順,," then a blank row). The header is the first of the first
 * 10 rows that holds every required name; without names, the first row that has at least two filled cells.
 */
function headerIndex(rows: string[][], required: string[]): number {
  const top = rows.slice(0, 10).map(r => r.map(c => c.trim()));
  const named = required.length ? top.findIndex(r => required.every(c => r.includes(c))) : -1;
  if (named >= 0) return named;
  const filled = top.findIndex(r => r.filter(c => c !== '').length >= 2);
  return filled > 0 ? filled : 0;
}

/** CSV → objects keyed by (trimmed) header. */
export function csvToRecords(text: string, required: string[] = []): { headers: string[]; records: Array<Record<string, string>> } {
  const rows = parseCsv(text);
  const h = headerIndex(rows, required);
  const headers = (rows[h] ?? []).map(c => c.trim());
  const records = rows.slice(h + 1).map(r => Object.fromEntries(headers.map((c, i) => [c, (r[i] ?? '').trim()])));
  return { headers, records };
}
