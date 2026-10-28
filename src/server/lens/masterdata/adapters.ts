import crypto from 'crypto';
import { csvToRecords, decodeText } from './csv.ts';
import { parseRuleText } from './scheduleRule.ts';
import { COMMON_CLASSES, GomiItem, MasterRow, ScheduleRow, SourceConfig } from './types.ts';

export class SyncError extends Error {
  constructor(public readonly code: 'fetch' | 'columns' | 'unknown_category' | 'unreadable_rule' | 'empty' | 'no_date' | 'delta' | 'config', message: string) {
    super(message);
  }
}

export interface FetchedFile {
  bytes: Buffer;
  /** URL the bytes actually came from (resolved CKAN resource, or the direct URL). */
  url: string;
  /** From the source's own metadata (CKAN `metadata_modified`, HTTP Last-Modified), if any. */
  source_updated_at?: string;
}

/** Network boundary, injectable so tests and offline runs never touch the network. */
export interface Fetcher {
  get(url: string, opts?: { accept?: string }): Promise<{ bytes: Buffer; headers: Record<string, string> }>;
}

const MAX_BYTES = 20_000_000;

export const httpFetcher: Fetcher = {
  async get(url, opts) {
    if (!/^https:\/\//i.test(url)) throw new SyncError('fetch', `only https URLs are allowed: ${url}`);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
        headers: { 'user-agent': 'KamiVietDataSync/1.0 (+open-data consumer)', ...(opts?.accept ? { accept: opts.accept } : {}) },
      });
    } catch (err) {
      throw new SyncError('fetch', `${url}: ${(err as Error).message}`);
    }
    if (!res.ok) throw new SyncError('fetch', `${url}: HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) throw new SyncError('fetch', `${url}: file too large (${declared} bytes)`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new SyncError('fetch', `${url}: file too large (${bytes.length} bytes)`);
    return { bytes, headers: Object.fromEntries(res.headers.entries()) };
  },
};

const isoDate = (s?: string | null): string | undefined => {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
};

export interface CkanResource { name?: string; format?: string; url?: string; last_modified?: string | null; metadata_modified?: string | null }
export interface CkanPackage {
  id?: string;
  name?: string;
  title?: string;
  license_id?: string;
  license_title?: string;
  metadata_modified?: string;
  organization?: { title?: string; name?: string } | null;
  resources?: CkanResource[];
}

/** CKAN action call → `result`, with the failures a person can act on. */
export async function ckanAction<T>(fetcher: Fetcher, api: string, action: string, query: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(query).toString();
  const { bytes } = await fetcher.get(`${api.replace(/\/$/, '')}/${action}?${qs}`, { accept: 'application/json' });
  let body: { success?: boolean; result?: T; error?: { message?: string } };
  try { body = JSON.parse(bytes.toString('utf8')); } catch { throw new SyncError('fetch', `CKAN ${action}: response is not JSON`); }
  if (!body.success || body.result === undefined) throw new SyncError('fetch', `CKAN ${action} failed${body.error?.message ? `: ${body.error.message}` : ''}`);
  return body.result;
}

export const isCsvResource = (r: CkanResource) => /csv/i.test(r.format || '') || /\.csv(\?|$)/i.test(r.url || '');
export const resourceDate = (r: CkanResource, pkg: CkanPackage) => isoDate(r.last_modified) || isoDate(r.metadata_modified) || isoDate(pkg.metadata_modified);

/** Resolve the CSV resource of a CKAN dataset and the dates the portal reports for it. */
async function resolveCkan(src: SourceConfig, fetcher: Fetcher): Promise<{ url: string; updated?: string }> {
  const { api, dataset, resource_match } = src.ckan!;
  const pkg = await ckanAction<CkanPackage>(fetcher, api, 'package_show', { id: dataset });
  const csvs = (pkg.resources || []).filter(isCsvResource);
  const match = resource_match?.toLowerCase();
  const res = match ? csvs.find(r => (r.name || '').toLowerCase().includes(match)) : csvs[0];
  if (!res?.url) throw new SyncError('fetch', `CKAN ${dataset}: no CSV resource${match ? ` matching "${resource_match}"` : ''} (found ${csvs.length} CSV)`);
  return { url: res.url, updated: resourceDate(res, pkg) };
}

/** Download the source file (resolving the CKAN resource first when configured). */
export async function fetchSource(src: SourceConfig, fetcher: Fetcher): Promise<FetchedFile> {
  let url = src.url;
  let updated: string | undefined;
  if (src.ckan) {
    const r = await resolveCkan(src, fetcher);
    url = r.url;
    updated = r.updated;
  }
  if (!url) throw new SyncError('config', `${src.id}: no url or ckan block`);
  const { bytes, headers } = await fetcher.get(url);
  return { bytes, url, source_updated_at: updated || isoDate(headers['last-modified']) };
}

export interface ParseContext { fetchedAt: string; sourceUrl: string; sourceUpdatedAt: string }
export interface ParseResult { rows: MasterRow[]; warnings: string[] }

export interface Adapter {
  parse(bytes: Buffer, src: SourceConfig, ctx: ParseContext): ParseResult;
}

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();

/** CKAN (or any CSV) list of waste items: one row per item with the city's category label. */
export const ckanCsvV1: Adapter = {
  parse(bytes, src, ctx) {
    const { headers, records } = csvToRecords(decodeText(bytes, src.encoding));
    const c = src.columns;
    const categoryMap = src.category_map;
    if (!c || !categoryMap) throw new SyncError('config', `${src.id}: adapter ckan_csv_v1 needs "columns" and "category_map"`);
    const required = [c.name_jp, c.category, ...(c.city_code ? [c.city_code] : [])];
    const missing = required.filter(h => !headers.includes(h));
    if (missing.length) {
      throw new SyncError('columns', `missing column(s) ${missing.map(m => `"${m}"`).join(', ')}; file has: ${headers.join(' | ') || '(no header)'}. Fix "columns" in ${src.id}.json (try: data inspect ${src.id}).`);
    }
    for (const [label, cls] of Object.entries(categoryMap)) {
      if (!COMMON_CLASSES.includes(cls)) throw new SyncError('config', `category_map["${label}"] = "${cls}" is not a common class`);
    }

    const warnings: string[] = [];
    const unknown = new Set<string>();
    const rows: GomiItem[] = [];
    const seen = new Map<string, number>();
    let skipped = 0;
    let otherCities = 0;

    for (const r of records) {
      if (c.city_code && r[c.city_code] !== src.city_code) { otherCities++; continue; }
      const name = norm(r[c.name_jp] || '');
      const label = norm(r[c.category] || '');
      if (!name || !label) { skipped++; continue; }
      const cls = categoryMap[label];
      if (!cls) { unknown.add(label); continue; }
      const note = norm(c.note ? r[c.note] || '' : '');
      const base = crypto.createHash('sha1').update(`${src.city_code}|${name}|${note}`).digest('hex').slice(0, 12);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      if (n > 1) warnings.push(`duplicate item "${name}"${note ? ` (${note})` : ''}`);
      rows.push({
        id: `${src.city_code}-${base}${n > 1 ? `-${n}` : ''}`,
        city_code: src.city_code,
        name_jp: name,
        kana: norm(c.kana ? r[c.kana] || '' : ''),
        local_category: label,
        common_class: cls,
        note,
        source_id: src.id,
        source_url: ctx.sourceUrl,
        source_updated_at: ctx.sourceUpdatedAt,
        fetched_at: ctx.fetchedAt,
        license: src.license,
        attribution: src.attribution,
        status: 'draft',
      });
    }

    if (unknown.size) {
      throw new SyncError('unknown_category', `unmapped category label(s): ${[...unknown].map(u => `"${u}"`).join(', ')}. Add them to category_map in ${src.id}.json.`);
    }
    if (!rows.length) throw new SyncError('empty', `no usable rows (${records.length} records, ${otherCities} other city, ${skipped} blank)`);
    if (skipped) warnings.push(`${skipped} row(s) skipped: blank item name or category`);
    if (otherCities) warnings.push(`${otherCities} row(s) skipped: other city_code`);
    return { rows, warnings };
  },
};

/** Wide schedule table: one row per area, one column per category holding "月・木" / "第2・4水". */
export const scheduleCsvV1: Adapter = {
  parse(bytes, src, ctx) {
    const sc = src.schedule;
    if (!sc?.categories?.length) throw new SyncError('config', `${src.id}: adapter schedule_csv_v1 needs "schedule.categories"`);
    const { headers, records } = csvToRecords(decodeText(bytes, src.encoding));
    const required = [...(sc.area_column ? [sc.area_column] : []), ...(sc.city_code_column ? [sc.city_code_column] : []), ...sc.categories.map(k => k.column)];
    const missing = required.filter(h => !headers.includes(h));
    if (missing.length) {
      throw new SyncError('columns', `missing column(s) ${missing.map(m => `"${m}"`).join(', ')}; file has: ${headers.join(' | ') || '(no header)'}. Fix "schedule" in ${src.id}.json (try: data inspect ${src.id}).`);
    }
    for (const k of sc.categories) {
      if (!COMMON_CLASSES.includes(k.common_class)) throw new SyncError('config', `schedule category "${k.column}": "${k.common_class}" is not a common class`);
    }

    const rows: ScheduleRow[] = [];
    const unreadable = new Map<string, number>();
    const warnings: string[] = [];
    const seen = new Set<string>();
    let otherCities = 0;
    let blankAreas = 0;

    for (const r of records) {
      if (sc.city_code_column && r[sc.city_code_column] !== src.city_code) { otherCities++; continue; }
      const area = sc.area_column ? norm(r[sc.area_column] || '') : '*';
      if (!area) { blankAreas++; continue; }
      for (const k of sc.categories) {
        const text = (r[k.column] || '').trim();
        const rule = parseRuleText(text);
        if (rule === 'none') continue;
        if (!rule) { unreadable.set(text, (unreadable.get(text) || 0) + 1); continue; }
        const id = `${src.city_code}-${crypto.createHash('sha1').update(`${area}|${k.common_class}|${k.local_category}`).digest('hex').slice(0, 12)}`;
        if (seen.has(id)) { warnings.push(`duplicate schedule row for ${area} / ${k.local_category}`); continue; }
        seen.add(id);
        rows.push({
          id, city_code: src.city_code, area_key: area, local_category: k.local_category, common_class: k.common_class,
          rule, rule_text: norm(text),
          source_id: src.id, source_url: ctx.sourceUrl, source_updated_at: ctx.sourceUpdatedAt, fetched_at: ctx.fetchedAt,
          license: src.license, attribution: src.attribution, status: 'draft',
        });
      }
    }

    if (unreadable.size) {
      const sample = [...unreadable].slice(0, 8).map(([t, n]) => `"${t}" ×${n}`).join(', ');
      throw new SyncError('unreadable_rule', `${unreadable.size} schedule text(s) not understood: ${sample}. Teach src/server/lens/masterdata/scheduleRule.ts, or fix the file. Not guessing: a wrong day is worse than no day.`);
    }
    if (!rows.length) throw new SyncError('empty', `no schedule rows (${records.length} records, ${otherCities} other city, ${blankAreas} without area)`);
    if (otherCities) warnings.push(`${otherCities} row(s) skipped: other city_code`);
    if (blankAreas) warnings.push(`${blankAreas} row(s) skipped: blank area`);
    return { rows, warnings };
  },
};

export const ADAPTERS: Record<string, Adapter> = { ckan_csv_v1: ckanCsvV1, schedule_csv_v1: scheduleCsvV1 };

export function getAdapter(name: string): Adapter {
  const a = ADAPTERS[name];
  if (!a) throw new SyncError('config', `unknown adapter "${name}" (have: ${Object.keys(ADAPTERS).join(', ')})`);
  return a;
}
