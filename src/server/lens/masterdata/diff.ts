import { Diff, MasterRow, PROVENANCE_KEYS, rowLabel } from './types.ts';

/** Fields that describe the content of a row (everything except provenance), so one diff works for every kind of row. */
const contentFields = (r: MasterRow) => Object.keys(r).filter(k => !(PROVENANCE_KEYS as string[]).includes(k));
const get = (r: MasterRow, k: string) => (r as unknown as Record<string, unknown>)[k];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffRows(before: MasterRow[], after: MasterRow[]): Diff {
  const old = new Map(before.map(r => [r.id, r]));
  const next = new Map(after.map(r => [r.id, r]));
  const diff: Diff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [id, a] of next) {
    const b = old.get(id);
    if (!b) { diff.added.push(a); continue; }
    const fields = [...new Set([...contentFields(a), ...contentFields(b)])].filter(f => !same(get(a, f), get(b, f)));
    if (fields.length) diff.changed.push({ before: b, after: a, fields });
    else diff.unchanged++;
  }
  for (const [id, b] of old) if (!next.has(id)) diff.removed.push(b);
  return diff;
}

export const changeCount = (d: Diff) => d.added.length + d.removed.length + d.changed.length;

const show1 = (r: MasterRow) => {
  const x = r as unknown as Record<string, unknown>;
  return `${rowLabel(r)} → ${x.local_category} (${x.common_class})${x.rule_text ? ` ${x.rule_text}` : ''}`;
};

export function formatDiff(d: Diff, limit = 15): string {
  const lines = [`+${d.added.length} added  -${d.removed.length} removed  ~${d.changed.length} changed  =${d.unchanged} same`];
  const show = <T,>(title: string, items: T[], fmt: (t: T) => string) => {
    if (!items.length) return;
    lines.push(`\n${title}`);
    for (const it of items.slice(0, limit)) lines.push(`  ${fmt(it)}`);
    if (items.length > limit) lines.push(`  … ${items.length - limit} more`);
  };
  show('Added', d.added, r => `+ ${show1(r)}`);
  show('Removed', d.removed, r => `- ${rowLabel(r)} (${(r as unknown as Record<string, unknown>).local_category})`);
  show('Changed', d.changed, c => `~ ${rowLabel(c.after)}: ${c.fields.map(f => `${f} ${JSON.stringify(get(c.before, f))} → ${JSON.stringify(get(c.after, f))}`).join('; ')}`);
  return lines.join('\n');
}
