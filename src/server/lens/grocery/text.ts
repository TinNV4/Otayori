/** Vietnamese diacritics off, lowercase, punctuation → spaces. CJK is kept as is. */
export function foldVi(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Same but keeps diacritics (NFC), for the precise first pass. */
export function plainVi(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

const CJK = /[぀-ヿ㐀-鿿]/;

/** "rau mùi (ngò rí)" → ["rau mùi", "ngò rí"]; "ブン (米粉の麺)" → ["ブン"]. */
export function baseNames(s: string): string[] {
  const m = s.match(/^(.*?)\s*[（(]([^）)]*)[）)]\s*$/);
  if (!m) return [s];
  return CJK.test(m[2]) ? [m[1]] : [m[1], m[2]];
}

/** Single words that are also ordinary Vietnamese once the diacritics are gone ("tôi"→"toi", "mẹ"→"me"). */
const COLLIDES = new Set(['toi', 'me', 'ga', 'ot', 'que', 'dua', 'mang', 'sa', 'hoi', 'nghe', 'muc', 'tieu', 'gia', 'bun', 'tom', 'mui']);

function has(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  if (CJK.test(phrase)) return haystack.includes(phrase);
  return ` ${haystack} `.includes(` ${phrase} `);
}

export interface Mention<T> { item: T; alias: string }

/**
 * Items mentioned in free text, with or without diacritics ("rau ram" finds "rau răm").
 * A single word that is also ordinary Vietnamese once the accents are gone ("tôi"→"toi", "mẹ"→"me") only
 * matches when the text spells it exactly as the alias, accents included ("tỏi" ≠ "tôi").
 * Longest alias wins, and an item whose alias sits inside a longer matched alias of another item is dropped
 * ("phở" inside "phở bò").
 */
export function findMentions<T>(text: string, items: T[], aliasesOf: (t: T) => string[]): Mention<T>[] {
  const plainHay = plainVi(text);
  const foldHay = foldVi(text);
  const hits: Mention<T>[] = [];
  for (const item of items) {
    let best = '';
    for (const raw of aliasesOf(item)) for (const a of baseNames(raw)) {
      const fold = foldVi(a);
      if (!fold || fold.length <= best.length) continue;
      const risky = !fold.includes(' ') && !CJK.test(fold) && COLLIDES.has(fold);
      const ok = risky ? plainVi(a) !== fold && has(plainHay, plainVi(a)) : has(foldHay, fold);
      if (ok) best = fold;
    }
    if (best) hits.push({ item, alias: best });
  }
  return hits.filter(h => !hits.some(o => o !== h && o.alias.length > h.alias.length && o.alias.includes(h.alias) && !h.alias.includes(o.alias)));
}
