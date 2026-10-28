import crypto from 'crypto';
import { Fetcher, fetchSource, getAdapter, SyncError } from './adapters.ts';
import { changeCount, diffRows } from './diff.ts';
import { MasterStore } from './store.ts';
import { Diff, SAFETY_CLASSES, Snapshot, SourceConfig, SyncStatus } from './types.ts';

export const DEFAULT_MAX_ROW_DELTA_PCT = 20;
export const DEFAULT_AUTO_PUBLISH_MAX_CHANGE_PCT = 5;
/** City calendars are re-issued each fiscal year; data older than this is flagged. */
export const STALE_AFTER_DAYS = 395; // ~13 months

const DAY = 86_400_000;

export interface SyncOptions {
  fetcher: Fetcher;
  store: MasterStore;
  now?: Date;
  /** Use this file instead of downloading (manual download, Excel→CSV export, offline run). */
  file?: { bytes: Buffer; source_updated_at?: string; url?: string };
  dryRun?: boolean;
  /** Ignore the unchanged-hash shortcut and the row-count guard. Never bypasses the safety review. */
  force?: boolean;
}

export interface SyncResult {
  source_id: string;
  status: SyncStatus;
  /** What a dry run would do, or why nothing happened. */
  detail: string;
  diff?: Diff;
  warnings: string[];
  review_reasons: string[];
  error?: SyncError | Error;
}

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const pct = (n: number, of: number) => (of ? (n / of) * 100 : n ? 100 : 0);

/** Which sources should the scheduler run now? Weekly from January to April (new fiscal-year calendars), else monthly. */
export function isDue(src: SourceConfig, lastFetchedAt: string | undefined, now: Date): boolean {
  if (!lastFetchedAt) return true;
  const jstMonth = new Date(now.getTime() + 9 * 3_600_000).getUTCMonth() + 1;
  const everyDays = src.cadence === 'weekly_jan_apr' && jstMonth <= 4 ? 6 : 28;
  return now.getTime() - Date.parse(lastFetchedAt) >= everyDays * DAY;
}

export function isStale(sourceUpdatedAt: string | undefined, now: Date): boolean {
  return !sourceUpdatedAt || now.getTime() - Date.parse(sourceUpdatedAt) > STALE_AFTER_DAYS * DAY;
}

/** A hazardous / appliance-law item must never quietly become ordinary waste. */
export function safetyIssues(before: Snapshot | null, after: Snapshot): string[] {
  if (!before) return [];
  const next = new Map(after.rows.map(r => [r.id, r]));
  const out: string[] = [];
  for (const b of before.rows) {
    if (!SAFETY_CLASSES.includes(b.common_class)) continue;
    const a = next.get(b.id);
    if (!a) out.push(`safety item removed: "${b.name_jp}" (${b.common_class})`);
    else if (!SAFETY_CLASSES.includes(a.common_class)) out.push(`safety item downgraded: "${b.name_jp}" ${b.common_class} → ${a.common_class}`);
  }
  return out;
}

export function publishStaged(store: MasterStore, sourceId: string, by: string, now = new Date()): Snapshot {
  const staged = store.getStaged(sourceId);
  if (!staged) throw new Error(`${sourceId}: nothing staged`);
  const out = promote(store, sourceId, staged, by, now);
  store.saveState({ ...store.getState(sourceId), last_status: 'published' });
  return out;
}

/** Drop the staged snapshot; the next sync re-evaluates the same file instead of shortcutting on its hash. */
export function rejectStaged(store: MasterStore, sourceId: string): void {
  if (!store.getStaged(sourceId)) throw new Error(`${sourceId}: nothing staged`);
  store.clearStaged(sourceId);
  store.saveState({ ...store.getState(sourceId), last_hash: undefined, last_status: store.getLive(sourceId) ? 'published' : undefined });
}

function promote(store: MasterStore, sourceId: string, snap: Snapshot, by: string, now: Date, note?: string): Snapshot {
  const published: Snapshot = {
    meta: { ...snap.meta, verified_by: by, published_at: now.toISOString(), review_reasons: undefined, ...(note ? { note } : {}) },
    rows: snap.rows.map(r => ({ ...r, status: 'verified' as const })),
  };
  const version = store.setLive(sourceId, published);
  store.clearStaged(sourceId);
  return { ...published, meta: { ...published.meta, version } };
}

export function rollback(store: MasterStore, sourceId: string, to: number | undefined, by: string, now = new Date()): Snapshot {
  const live = store.getLive(sourceId);
  const versions = store.versions(sourceId);
  const target = to ?? [...versions].reverse().find(v => v < (live?.meta.version ?? Infinity));
  if (!target) throw new Error(`${sourceId}: no earlier version to roll back to`);
  const snap = store.getVersion(sourceId, target);
  if (!snap) throw new Error(`${sourceId}: version ${target} not found (have ${versions.join(', ') || 'none'})`);
  // Rolled-back content gets a new version number so history stays append-only.
  const out = promote(store, sourceId, snap, by, now, `rollback to v${target}`);
  const state = store.getState(sourceId);
  // Make the next sync re-evaluate instead of shortcutting on the hash of the file we just rolled away from.
  store.saveState({ ...state, last_hash: undefined });
  return out;
}

export async function syncSource(src: SourceConfig, opts: SyncOptions): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const { store } = opts;
  const state = store.getState(src.id);
  const result = (status: SyncStatus, detail: string, extra: Partial<SyncResult> = {}): SyncResult =>
    ({ source_id: src.id, status, detail, warnings: [], review_reasons: [], ...extra });

  try {
    const file = opts.file
      ? { bytes: opts.file.bytes, url: opts.file.url || src.url || '(local file)', source_updated_at: opts.file.source_updated_at }
      : await fetchSource(src, opts.fetcher);

    const hash = sha256(file.bytes);
    const settled = state.last_status === 'published' || state.last_status === 'staged' || state.last_status === 'unchanged';
    if (!opts.force && settled && state.last_hash === hash) {
      if (!opts.dryRun) store.saveState({ ...state, last_fetched_at: now.toISOString(), last_status: 'unchanged', last_error: undefined });
      return result('unchanged', 'file identical to the last sync');
    }

    const sourceUpdatedAt = file.source_updated_at || src.source_updated_at;
    if (!sourceUpdatedAt) {
      throw new SyncError('no_date', `cannot tell when ${src.id} was last updated (no portal date / Last-Modified). Set "source_updated_at" in ${src.id}.json or pass --updated YYYY-MM-DD.`);
    }

    const { rows, warnings } = getAdapter(src.adapter).parse(file.bytes, src, {
      fetchedAt: now.toISOString(), sourceUrl: file.url, sourceUpdatedAt,
    });
    const next: Snapshot = {
      meta: {
        source_id: src.id, version: 0, content_hash: hash, row_count: rows.length, created_at: now.toISOString(),
        source_url: file.url, source_updated_at: sourceUpdatedAt, warnings,
      },
      rows,
    };

    const live = store.getLive(src.id);
    const th = src.thresholds ?? {};
    const maxDelta = th.max_row_delta_pct ?? DEFAULT_MAX_ROW_DELTA_PCT;
    const autoMax = th.auto_publish_max_change_pct ?? DEFAULT_AUTO_PUBLISH_MAX_CHANGE_PCT;

    if (live && !opts.force) {
      const delta = pct(Math.abs(rows.length - live.rows.length), live.rows.length);
      if (delta > maxDelta) {
        throw new SyncError('delta', `row count ${live.rows.length} → ${rows.length} (${delta.toFixed(0)}% > ${maxDelta}%). Looks like a format change; kept the live version. Re-run with --force after checking the file.`);
      }
    }

    const diff = diffRows(live?.rows ?? [], rows);
    const reasons = [
      ...(live ? [] : ['first import: an admin must look at it once']),
      ...safetyIssues(live, next),
    ];
    const changePct = live ? pct(changeCount(diff), live.rows.length) : 100;
    if (live && changePct > autoMax) reasons.push(`${changePct.toFixed(1)}% of rows changed (auto-publish limit ${autoMax}%)`);
    const auto = reasons.length === 0;

    if (opts.dryRun) {
      return result('dry_run', auto ? 'would auto-publish' : `would stage for review: ${reasons.join('; ')}`, { diff, warnings, review_reasons: reasons });
    }

    const base = { ...state, last_fetched_at: now.toISOString(), last_hash: hash, last_error: undefined, source_updated_at: sourceUpdatedAt };
    if (auto) {
      promote(store, src.id, next, 'auto', now);
      store.saveState({ ...base, last_status: 'published' });
      return result('published', 'auto-published (small change, all checks passed)', { diff, warnings });
    }
    next.meta.review_reasons = reasons;
    store.saveStaged(src.id, next);
    store.saveState({ ...base, last_status: 'staged' });
    return result('staged', `waiting for review: ${reasons.join('; ')}`, { diff, warnings, review_reasons: reasons });
  } catch (err) {
    const e = err as Error;
    if (!opts.dryRun) store.saveState({ ...state, last_fetched_at: now.toISOString(), last_status: 'failed', last_error: e.message.slice(0, 500) });
    return result('failed', e.message, { error: e });
  }
}
