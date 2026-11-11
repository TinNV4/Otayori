import { PolicyItem } from '../../types/policy.ts';

/**
 * The same notice often shows up as several pages: one per district (Nagoya), one per regional office (ISA),
 * a "guideline revised" page next to its sibling, or on two sites. Exact-URL dedupe can't see that, and the model
 * words each page a little differently, so we compare titles (character bigrams — works for Japanese and
 * Vietnamese alike) and the dates that matter.
 */

const clean = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s【】\[\]()（）「」『』・、。，,.!！?？:：\-–—|｜~〜]/g, '');

function grams(s: string): Set<string> {
  const t = clean(s);
  const g = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
}

/** Jaccard similarity of the two titles' character bigrams, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const x = grams(a);
  const y = grams(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const g of x) if (y.has(g)) both++;
  return both / (x.size + y.size - both);
}

/** Same source: this similar is "the same notice, repeated" (per district, per office, numbered series). */
export const SAME_SOURCE_TITLE = 0.7;
/** Looser when the key dates are identical as well. */
export const SAME_DATE_TITLE = 0.5;

const keyDate = (i: Pick<PolicyItem, 'deadline' | 'effective_date'>) => i.deadline || i.effective_date;

/** The earlier item `item` repeats, or null. Ignored shells are skipped; rejected ones count (a rejected story must not come back). */
export function findDuplicate(item: PolicyItem, others: PolicyItem[]): PolicyItem | null {
  const dates = keyDate(item);
  for (const o of others) {
    if (o.id === item.id || o.status === 'ignored') continue;
    const sim = Math.max(titleSimilarity(item.title_jp, o.title_jp), titleSimilarity(item.title_vi, o.title_vi));
    if (o.source_id === item.source_id && sim >= SAME_SOURCE_TITLE) return o;
    if (dates && dates === keyDate(o) && sim >= SAME_DATE_TITLE) return o;
  }
  return null;
}

/** The item a duplicate ultimately points at. */
export const rootId = (i: Pick<PolicyItem, 'id' | 'duplicate_of'>) => i.duplicate_of || i.id;
