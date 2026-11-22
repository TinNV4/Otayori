import { PolicySource } from './sources.ts';

export interface Link {
  url: string;
  text: string;
  /** Publication date found next to the link (YYYY-MM-DD; month-only dates use the last day of the month). */
  date?: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

export function htmlToText(html: string, max = 8000): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|nav|header|footer)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|tr|h[1-6]|br)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t　]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, max);
}

export function pageTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

const ERA_BASE: Record<string, number> = { 令和: 2018, 平成: 1988 };
const DATE_RE = /(?:(令和|平成)(\d{1,2}|元)|((?:19|20)\d{2}))年(\d{1,2})月(?:(\d{1,2})日)?/g;

/** Last Japanese date in `text` (西暦 or 令和/平成; full-width digits ok). Month-only → end of that month. */
export function parseJaDate(text: string): string | undefined {
  let found: string | undefined;
  for (const m of text.normalize('NFKC').matchAll(DATE_RE)) {
    const year = m[3] ? Number(m[3]) : ERA_BASE[m[1]] + (m[2] === '元' ? 1 : Number(m[2]));
    const month = Number(m[4]);
    if (month < 1 || month > 12) continue;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = m[5] ? Number(m[5]) : last;
    if (day < 1 || day > last) continue;
    found = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return found;
}

/** `<a href>` links with their anchor text, resolved against the page URL. Duplicates and non-http links dropped. */
export function extractLinks(html: string, baseUrl: string): Link[] {
  const seen = new Set<string>();
  const out: Link[] = [];
  for (const m of html.matchAll(/<a\s[^>]*?href\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(decodeEntities(m[1]), baseUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || /\.(pdf|jpe?g|png|gif|zip|xlsx?|docx?|pptx?)$/i.test(url.pathname)) continue;
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!text || seen.has(url.href)) continue;
    seen.add(url.href);
    // List pages put the date in a heading/cell just before the link, so look back a short way.
    const before = decodeEntities(html.slice(Math.max(0, m.index! - 2500), m.index).replace(/<[^>]+>/g, ' ')).slice(-400);
    out.push({ url: url.href, text, date: parseJaDate(before) });
  }
  return out;
}

/**
 * Links worth analysing for one source: same host, path/keyword pre-filter, dated within `maxAgeDays`
 * (navigation menus have no date and drop out), newest first.
 */
export function candidateLinks(source: PolicySource, html: string, opts: { baseUrl?: string; today: string; maxAgeDays: number }): Link[] {
  const oldest = new Date(Date.parse(`${opts.today}T00:00:00Z`) - opts.maxAgeDays * 86400_000).toISOString().slice(0, 10);
  return extractLinks(html, opts.baseUrl || source.listUrl)
    .filter(l => {
      const u = new URL(l.url);
      if (!source.hosts.includes(u.hostname) || l.url === source.listUrl || u.pathname === '/') return false;
      if (source.linkPattern && !source.linkPattern.test(u.pathname)) return false;
      if (l.text.length < 6) return false; // "詳細", "more" …
      if (!l.date || l.date < oldest) return false;
      if (source.exclude?.test(l.text)) return false;
      return !source.keywords || source.keywords.test(l.text);
    })
    .sort((a, b) => b.date!.localeCompare(a.date!));
}

/** Decode with the charset from the header / <meta> (some ministries still serve Shift_JIS). */
export function decodeBody(buf: ArrayBuffer, contentType: string | null): string {
  const bytes = new Uint8Array(buf);
  let charset = /charset=([\w-]+)/i.exec(contentType || '')?.[1];
  if (!charset) charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder('latin1').decode(bytes.slice(0, 2048)))?.[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export type PageFetcher = (url: string) => Promise<string>;

/** Polite fetch: identifies itself, 15s timeout, 2 MB cap, http(s) only. */
export const fetchHtml: PageFetcher = async url => {
  if (!/^https?:\/\//i.test(url)) throw new Error('unsupported URL');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GiayToNhat-PolicyReader/1.0 (family helper bot; reads public notices)', 'Accept-Language': 'ja,en;q=0.5' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 2_000_000) throw new Error(`page too large: ${url}`);
  return decodeBody(buf, res.headers.get('content-type'));
};
