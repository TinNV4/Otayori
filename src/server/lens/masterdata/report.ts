import { readTable } from './adapters.ts';
import { MasterStore } from './store.ts';
import { isStale } from './sync.ts';
import { parseRuleText } from './scheduleRule.ts';
import { CommonClass, isGomiItem, isScheduleRow, Snapshot, SourceConfig } from './types.ts';

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
    for (const r of withLive) for (const row of r.live!.rows) if (isGomiItem(row)) mix.set(row.common_class, (mix.get(row.common_class) ?? 0) + 1);
    if (mix.size) {
      const top = Math.max(...mix.values());
      out.push('\nLive items by common class');
      for (const [c, n] of [...mix].sort((a, b) => b[1] - a[1])) out.push(`  ${c.padEnd(14)} ${bar(n, top, 24)} ${n}`);
    }
  }
  return out.join('\n');
}

/** What is in the file and how its category labels map: the quickest way to write `columns` / `category_map`. */
export function renderInspect(src: SourceConfig, bytes: Buffer, meta: { url: string; source_updated_at?: string }): string {
  const required = src.kind === 'gomi_schedule'
    ? [...(src.schedule?.area_columns ?? (src.schedule?.area_column ? [src.schedule.area_column] : [])), ...(src.schedule?.categories.map(k => k.column) ?? [])]
    : [src.columns?.name_jp ?? '', src.columns?.category ?? ''];
  const { headers, records } = readTable(bytes, src, required);
  const out = [
    `url      ${meta.url}`,
    `date     ${meta.source_updated_at ?? '(none reported)'}`,
    `size     ${bytes.length} bytes · ${records.length} records · encoding ${src.encoding}`,
    `headers  ${headers.join(' | ')}`,
    '',
    'first rows',
    ...records.slice(0, 5).map(r => '  ' + headers.map(h => r[h]).join(' | ')),
  ];
  if (src.kind === 'gomi_schedule') {
    const sc = src.schedule!;
    out.push('');
    for (const k of sc.categories) {
      if (!headers.includes(k.column)) { out.push(`⚠ column "${k.column}" not found — fix "schedule.categories"`); continue; }
      const counts = new Map<string, number>();
      for (const r of records) counts.set(r[k.column], (counts.get(r[k.column]) ?? 0) + 1);
      out.push(`"${k.column}" → ${k.local_category} (${k.common_class})`);
      for (const [text, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
        const rule = parseRuleText(text);
        out.push(`  ${(text || '(blank)').padEnd(16)} ${String(n).padStart(5)}  ${rule === 'none' ? '– no collection' : rule ? `→ ${JSON.stringify(rule)}` : '✗ NOT UNDERSTOOD'}`);
      }
    }
    for (const a of sc.area_columns ?? (sc.area_column ? [sc.area_column] : [])) if (!headers.includes(a)) out.push(`⚠ area column "${a}" not found`);
    return out.join('\n');
  }
  const cat = src.columns!.category;
  if (headers.includes(cat)) {
    const counts = new Map<string, number>();
    for (const r of records) counts.set(r[cat], (counts.get(r[cat]) ?? 0) + 1);
    const max = Math.max(...counts.values());
    out.push('', `values of "${cat}" (→ category_map)`);
    for (const [label, n] of [...counts].sort((a, b) => b[1] - a[1])) {
      const mapped = src.category_map![label];
      out.push(`  ${(label || '(blank)').padEnd(16)} ${bar(n, max, 20)} ${String(n).padStart(5)}  ${mapped ? `→ ${mapped}` : '✗ UNMAPPED'}`);
    }
  } else {
    out.push('', `⚠ column "${cat}" not found — fix "columns.category"`);
  }
  return out.join('\n');
}

/** Names that must never end up as ordinary waste. The national rules answer these anyway; the review shows what the city says. */
const SAFETY_NAMES = ['電池', 'バッテリー', 'スプレー', 'ライター', 'ガスボンベ', 'カセットボンベ', 'テレビ', '冷蔵庫', '冷凍庫', '洗濯機', 'エアコン', '乾燥機', 'パソコン'];
const SAFE_CLASSES: CommonClass[] = ['hazardous', 'kaden4', 'pc', 'not_collected', 'drop_off', 'other', 'sodai'];

/** What an admin needs before `publish`: size, mix of classes, warnings, and how the city treats the dangerous things. */
export function renderReview(snap: Snapshot): string {
  const out: string[] = [];
  const m = snap.meta;
  out.push(`${m.source_id} · ${m.row_count} rows · source date ${m.source_updated_at} · ${m.source_url}`);
  if (m.review_reasons?.length) out.push(`review: ${m.review_reasons.join('; ')}`);

  const mix = new Map<string, number>();
  for (const r of snap.rows) mix.set(r.common_class, (mix.get(r.common_class) ?? 0) + 1);
  const top = Math.max(...mix.values());
  out.push('', 'by common class');
  for (const [c, n] of [...mix].sort((a, b) => b[1] - a[1])) out.push(`  ${c.padEnd(14)} ${bar(n, top, 24)} ${n}`);

  const labels = new Map<string, Map<string, number>>();
  for (const r of snap.rows) {
    const l = labels.get(r.common_class) ?? new Map<string, number>();
    l.set(r.local_category, (l.get(r.local_category) ?? 0) + 1);
    labels.set(r.common_class, l);
  }
  out.push('', 'city label → class (check these)');
  for (const [c, l] of labels) out.push(`  ${c.padEnd(14)} ${[...l].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' · ')}`);

  const items = snap.rows.filter(isGomiItem);
  if (items.length) {
    const hits = items.filter(i => SAFETY_NAMES.some(n => i.name_jp.includes(n)));
    const odd = hits.filter(i => !SAFE_CLASSES.includes(i.common_class));
    out.push('', `dangerous / appliance-law names: ${hits.length} rows, ${odd.length} filed as ordinary waste (national rules still override these in answers)`);
    for (const i of odd.slice(0, 12)) out.push(`  ${i.name_jp} → 「${i.local_category}」 (${i.common_class})${i.note ? ` — ${i.note.slice(0, 50)}` : ''}`);
    const fees = items.filter(i => i.fee_yen).length;
    if (fees) out.push('', `${fees} item(s) carry a 粗大ごみ fee`);
  }
  const sched = snap.rows.filter(isScheduleRow);
  if (sched.length) {
    const areas = new Set(sched.map(r => r.area_key));
    out.push('', `${areas.size} area(s); sample: ${[...areas].slice(0, 6).join(', ')}`);
  }
  if (m.warnings.length) out.push('', `warnings (${m.warnings.length}): ${m.warnings.slice(0, 3).join(' | ')}`);
  return out.join('\n');
}
