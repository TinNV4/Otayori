import { Diff, GomiItem } from './types.ts';

const CONTENT_FIELDS = ['kana', 'local_category', 'common_class', 'note'] as const;

export function diffRows(before: GomiItem[], after: GomiItem[]): Diff {
  const old = new Map(before.map(r => [r.id, r]));
  const next = new Map(after.map(r => [r.id, r]));
  const diff: Diff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [id, a] of next) {
    const b = old.get(id);
    if (!b) { diff.added.push(a); continue; }
    const fields = CONTENT_FIELDS.filter(f => a[f] !== b[f]);
    if (fields.length) diff.changed.push({ before: b, after: a, fields: [...fields] });
    else diff.unchanged++;
  }
  for (const [id, b] of old) if (!next.has(id)) diff.removed.push(b);
  return diff;
}

export const changeCount = (d: Diff) => d.added.length + d.removed.length + d.changed.length;

export function formatDiff(d: Diff, limit = 15): string {
  const lines = [`+${d.added.length} added  -${d.removed.length} removed  ~${d.changed.length} changed  =${d.unchanged} same`];
  const show = <T,>(title: string, items: T[], fmt: (t: T) => string) => {
    if (!items.length) return;
    lines.push(`\n${title}`);
    for (const it of items.slice(0, limit)) lines.push(`  ${fmt(it)}`);
    if (items.length > limit) lines.push(`  … ${items.length - limit} more`);
  };
  show('Added', d.added, r => `+ ${r.name_jp} → ${r.local_category} (${r.common_class})`);
  show('Removed', d.removed, r => `- ${r.name_jp} (${r.local_category})`);
  show('Changed', d.changed, c => `~ ${c.after.name_jp}: ${c.fields.map(f => `${f} "${c.before[f as keyof GomiItem]}" → "${c.after[f as keyof GomiItem]}"`).join('; ')}`);
  return lines.join('\n');
}
