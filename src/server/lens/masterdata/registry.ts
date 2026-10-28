import fs from 'fs';
import path from 'path';
import { SyncError } from './adapters.ts';
import { COMMON_CLASSES, SourceConfig } from './types.ts';

export const SOURCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validateSourceConfig(raw: unknown, file: string): SourceConfig {
  const s = raw as Partial<SourceConfig>;
  const bad = (msg: string) => new SyncError('config', `${file}: ${msg}`);
  if (!s || typeof s !== 'object') throw bad('not an object');
  if (!s.id || !SOURCE_ID_RE.test(s.id)) throw bad('"id" must match ' + SOURCE_ID_RE);
  if (path.basename(file, '.json') !== s.id) throw bad(`"id" (${s.id}) must equal the file name`);
  if (!/^\d{5}$/.test(s.city_code || '')) throw bad('"city_code" must be a 5-digit JIS code');
  if (s.kind !== 'gomi_items') throw bad(`unsupported kind "${s.kind}"`);
  if (!s.adapter) throw bad('"adapter" required');
  if (!s.ckan && !s.url) throw bad('"url" or "ckan" required');
  if (!s.license || !s.attribution) throw bad('"license" and "attribution" are required (every row must carry its terms)');
  if (!s.columns?.name_jp || !s.columns?.category) throw bad('"columns.name_jp" and "columns.category" required');
  if (!s.category_map || !Object.keys(s.category_map).length) throw bad('"category_map" required');
  for (const [k, v] of Object.entries(s.category_map)) if (!COMMON_CLASSES.includes(v)) throw bad(`category_map["${k}"]: "${v}" is not one of ${COMMON_CLASSES.join(', ')}`);
  if (s.source_updated_at && !/^\d{4}-\d{2}-\d{2}$/.test(s.source_updated_at)) throw bad('"source_updated_at" must be YYYY-MM-DD');
  return {
    ...(s as SourceConfig),
    encoding: s.encoding ?? 'utf-8',
    cadence: s.cadence ?? 'monthly',
    enabled: s.enabled ?? true,
  };
}

export function loadSources(dir: string): SourceConfig[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort().map(f => {
    const file = path.join(dir, f);
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { throw new SyncError('config', `${file}: invalid JSON (${(err as Error).message})`); }
    return validateSourceConfig(raw, file);
  });
}
