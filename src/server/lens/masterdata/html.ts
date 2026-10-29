/** Separator between the pages of a multi-page source once they are fetched into one buffer. */
export const PAGE_MARKER = '\n<!--kamiviet-page-->\n';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

const cellText = (inner: string) =>
  decodeEntities(inner.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).normalize('NFKC').replace(/\s+/g, ' ').trim();

/** Every <table> of a page as a rectangular grid of text, with rowspan/colspan filled in (nested tables are not supported). */
export function parseTables(html: string): string[][][] {
  const clean = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  return [...clean.matchAll(/<table[\s\S]*?<\/table>/gi)].map(([table]) => {
    const grid: string[][] = [];
    const pending = new Map<number, { text: string; left: number }>(); // column → text carried down by rowspan
    for (const [row] of table.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const out: string[] = [];
      let col = 0;
      const carry = () => {
        for (let p = pending.get(col); p && p.left > 0; p = pending.get(col)) { out.push(p.text); p.left--; col++; }
      };
      for (const m of row.matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/gi)) {
        carry();
        const text = cellText(m[2]);
        const rs = Number(/rowspan\s*=\s*["']?(\d+)/i.exec(m[1])?.[1] ?? 1);
        const cs = Number(/colspan\s*=\s*["']?(\d+)/i.exec(m[1])?.[1] ?? 1);
        for (let k = 0; k < cs; k++) {
          out.push(text);
          if (rs > 1) pending.set(col, { text, left: rs - 1 });
          col++;
        }
      }
      carry();
      grid.push(out);
    }
    return grid;
  });
}

/** "更新日：2026年1月28日" printed on city pages. Latest one wins. */
export function pageUpdateDate(html: string): string | undefined {
  const dates = [...html.matchAll(/更新日[:：]\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/g)]
    .map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  return dates.sort().at(-1);
}
