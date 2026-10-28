/** Nationwide classes used to compare/explain waste categories whatever each city calls them. */
export const COMMON_CLASSES = [
  'burnable', 'non_burnable', 'plastic', 'pet', 'can', 'glass', 'paper', 'cloth',
  'hazardous', 'sodai', 'kaden4', 'pc', 'not_collected',
] as const;
export type CommonClass = (typeof COMMON_CLASSES)[number];

/** Classes where a wrong answer is dangerous or illegal: never silently downgraded by a sync. */
export const SAFETY_CLASSES: CommonClass[] = ['hazardous', 'kaden4'];

export type SourceKind = 'gomi_items';
export type Cadence = 'monthly' | 'weekly_jan_apr';

/** One registry file: data/sources/<id>.json. Adding a city = adding a file, not code. */
export interface SourceConfig {
  id: string;
  city_code: string;
  kind: SourceKind;
  adapter: string;
  /** Disabled sources are skipped by `sync --all`. Use for templates / unverified columns. */
  enabled: boolean;
  /** Direct file URL; ignored when `ckan` is set (the resource URL is resolved from the CKAN API). */
  url: string;
  ckan?: {
    /** e.g. https://ckan.example.jp/api/3/action */
    api: string;
    dataset: string;
    /** Case-insensitive substring of the resource name; first CSV resource when omitted. */
    resource_match?: string;
  };
  encoding: 'utf-8' | 'shift_jis';
  license: string;
  attribution: string;
  /** Header names in the source file. `city_code` filters rows when the file covers several cities. */
  columns: { name_jp: string; category: string; kana?: string; note?: string; city_code?: string };
  /** Local category label → common class. A label missing here stops the sync. */
  category_map: Record<string, CommonClass>;
  cadence: Cadence;
  /** YYYY-MM-DD fallback when the portal/HTTP headers give no date (e.g. prose "令和5年3月現在"). */
  source_updated_at?: string;
  /** Free text for admins (never shown to users). */
  note?: string;
  thresholds?: {
    /** Stop when the row count moves more than this vs. the live version. Default 20. */
    max_row_delta_pct?: number;
    /** Auto-publish only when changed rows ≤ this share of live rows. Default 5. */
    auto_publish_max_change_pct?: number;
  };
}

export type RowStatus = 'draft' | 'verified' | 'stale' | 'retired';

export interface GomiItem {
  id: string;
  city_code: string;
  name_jp: string;
  kana: string;
  /** The city's own label ("燃やすごみ"); shown to users so it matches what they see on the bin. */
  local_category: string;
  common_class: CommonClass;
  note: string;
  source_id: string;
  source_url: string;
  source_updated_at: string; // YYYY-MM-DD
  fetched_at: string; // ISO
  license: string;
  attribution: string;
  status: RowStatus;
}

export interface SnapshotMeta {
  source_id: string;
  version: number;
  content_hash: string;
  row_count: number;
  created_at: string;
  source_url: string;
  source_updated_at: string;
  /** 'auto' (passed checks, small diff) or an admin name. Absent on staged snapshots. */
  verified_by?: string;
  published_at?: string;
  /** Why a staged snapshot waits for an admin. */
  review_reasons?: string[];
  warnings: string[];
  note?: string;
}

export interface Snapshot {
  meta: SnapshotMeta;
  rows: GomiItem[];
}

export type SyncStatus = 'unchanged' | 'staged' | 'published' | 'failed' | 'dry_run';

export interface SourceState {
  source_id: string;
  last_fetched_at?: string;
  last_hash?: string;
  last_status?: SyncStatus;
  last_error?: string;
  source_updated_at?: string;
}

export interface Diff {
  added: GomiItem[];
  removed: GomiItem[];
  changed: Array<{ before: GomiItem; after: GomiItem; fields: string[] }>;
  unchanged: number;
}
