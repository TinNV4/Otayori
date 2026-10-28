import { csvToRecords, decodeText } from './csv.ts';
import { MasterStore } from './store.ts';
import { isStale } from './sync.ts';
import { SourceConfig } from './types.ts';

export function bar(value: number, max: number, width = 30) {
  const n = max ? Math.round((value / max) * width) : 0;
  return '█'.repeat(n) + '░'.repeat(width - n);
}

/** Text dashboard: one line per source, then live rows per source and the class mix. */
export function renderStatus(sources: SourceConfig[], store: MasterStore, now = new Date()): string {
  const out: string[] = [];
  const rows = sources.map(s => {
    const live = store.getLive(s.id);
    const staged = store.getStaged(s.id);
    const st = store.getState(s.id);
    const updated = live?.meta.source_updated_at ?? st.source_updated_at;
    return { s, live, staged, st, stale: live ? isStale(updated, now) : false, updated };
  });

  out.push('source'.padEnd(28) + 'state'.padEnd(11) + 'live'.padEnd(12) + 'staged'.padEnd(9) + 'source date'.padEnd(13) + 'last fetch');
  for (const r of rows) {
    const state = !r.s.enabled ? 'disabled' : r.st.last_status === 'failed' ? 'FAILED' : r.stale ? 'STALE' : r.st.last_status ?? 'never';
    out.push(
      r.s.id.padEnd(28) + state.padEnd(11) +
      (r.live ? `v${r.live.meta.version} ×${r.live.rows.length}` : '–').padEnd(12) +
      (r.staged ? `×${r.staged.rows.length}` : '–').padEnd(9) +
      (r.updated ?? '–').padEnd(13) + (r.st.last_fetched_at?.slice(0, 16).replace('T', ' ') ?? '–'),
    );
    if (r.st.last_status === 'failed' && r.st.last_error) out.push(`    ↳ ${r.st.last_error}`);
    if (r.staged?.meta.review_reasons?.length) out.push(`    ↳ review: ${r.staged.meta.review_reasons.join('; ')}`);
  }

  const withLive = rows.filter(r => r.live);
  if (withLive.length) {
    const max = Math.max(...withLive.map(r => r.live!.rows.length));
    out.push('\nLive rows per source');
    for (const r of withLive) out.push(`  ${r.s.id.padEnd(26)} ${bar(r.live!.rows.length, max, 24)} ${r.live!.rows.length}`);
    const mix = new Map<string, number>();
    for (const r of withLive) for (const row of r.live!.rows) mix.set(row.common_class, (mix.get(row.common_class) ?? 0) + 1);
    const top = Math.max(...mix.values());
    out.push('\nLive rows by common class');
    for (const [c, n] of [...mix].sort((a, b) => b[1] - a[1])) out.push(`  ${c.padEnd(14)} ${bar(n, top, 24)} ${n}`);
  }
  return out.join('\n');
}

/** What is in the file and how its category labels map: the quickest way to write `columns` / `category_map`. */
export function renderInspect(src: SourceConfig, bytes: Buffer, meta: { url: string; source_updated_at?: string }): string {
  const { headers, records } = csvToRecords(decodeText(bytes, src.encoding));
  const out = [
    `url      ${meta.url}`,
    `date     ${meta.source_updated_at ?? '(none reported)'}`,
    `size     ${bytes.length} bytes · ${records.length} records · encoding ${src.encoding}`,
    `headers  ${headers.join(' | ')}`,
    '',
    'first rows',
    ...records.slice(0, 5).map(r => '  ' + headers.map(h => r[h]).join(' | ')),
  ];
  const cat = src.columns.category;
  if (headers.includes(cat)) {
    const counts = new Map<string, number>();
    for (const r of records) counts.set(r[cat], (counts.get(r[cat]) ?? 0) + 1);
    const max = Math.max(...counts.values());
    out.push('', `values of "${cat}" (→ category_map)`);
    for (const [label, n] of [...counts].sort((a, b) => b[1] - a[1])) {
      const mapped = src.category_map[label];
      out.push(`  ${(label || '(blank)').padEnd(16)} ${bar(n, max, 20)} ${String(n).padStart(5)}  ${mapped ? `→ ${mapped}` : '✗ UNMAPPED'}`);
    }
  } else {
    out.push('', `⚠ column "${cat}" not found — fix "columns.category"`);
  }
  return out.join('\n');
}
