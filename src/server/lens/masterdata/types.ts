/** Nationwide classes used to compare/explain waste categories whatever each city calls them. */
export const COMMON_CLASSES = [
  'burnable', 'non_burnable', 'plastic', 'pet', 'can', 'glass', 'paper', 'cloth',
  'hazardous', 'sodai', 'kaden4', 'pc', 'not_collected',
  /** 資源: a recycling bucket the city doesn't break down further. */
  'resource',
  /** 拠点回収: taken at dedicated collection points, not at the curb. */
  'drop_off',
  /** Needs its own handling (e.g. 消火器, 金属類 with local rules): the answer shows the city's label and note. */
  'other',
] as const;
export type CommonClass = (typeof COMMON_CLASSES)[number];

/** Classes where a wrong answer is dangerous or illegal: never silently downgraded by a sync. */
export const SAFETY_CLASSES: CommonClass[] = ['hazardous', 'kaden4'];

export type SourceKind = 'gomi_items' | 'gomi_schedule';
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
  /** Several pages that together make one source (e.g. the あ行…ら行 pages of an item list). Fetched in order. */
  urls?: string[];
  /** HTML sources: how to read the tables. */
  html?: {
    /** Names for the columns after rowspan/colspan are resolved. Use when the page's header row is irregular. */
    columns?: string[];
    /** Header rows to skip in every table when `columns` is given (default 1). */
    header_rows?: number;
  };
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
  /** gomi_items: header names in the source file. `city_code` filters rows when the file covers several cities. */
  columns?: {
    name_jp: string;
    category: string;
    kana?: string;
    /** One or several columns; their texts are joined (e.g. 備考 + 注意点). */
    note?: string | string[];
    /** Per-item 粗大ごみ fee in yen (digits are read, text is ignored). */
    fee?: string;
    /** Compared on its first 5 digits: 全国地方公共団体コード has a 6th check digit (131181 → 13118). */
    city_code?: string;
  };
  /** gomi_items: local category label → common class. A label missing here stops the sync. */
  category_map?: Record<string, CommonClass>;
  /** gomi_schedule: a wide table, one row per area (町丁目) and one column per waste category holding "月・木" / "第2・4水". */
  schedule?: {
    /** Header of the area column. Omit when the file is city-wide (every area collects the same days). */
    area_column?: string;
    /** Town + chome in two columns (e.g. ["町名", "丁目"]); the chome cell may be 全域, a list, or a range. Overrides area_column. */
    area_columns?: string[];
    /** `city_code_column` filters rows when the file covers several cities. */
    city_code_column?: string;
    categories: Array<{ column: string; local_category: string; common_class: CommonClass }>;
    /** No collection on these dates every year, as the city publishes them (e.g. year-end). MM-DD, inclusive; may wrap the new year. */
    suspensions?: Array<{ from: string; to: string }>;
  };
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

/** Carried by every master-data row: where it came from, when that was updated, and the terms of reuse. */
export interface Provenance {
  source_id: string;
  source_url: string;
  source_updated_at: string; // YYYY-MM-DD
  fetched_at: string; // ISO
  license: string;
  attribution: string;
  status: RowStatus;
}
export const PROVENANCE_KEYS: Array<keyof Provenance | 'id'> = ['id', 'source_id', 'source_url', 'source_updated_at', 'fetched_at', 'license', 'attribution', 'status'];

export interface GomiItem extends Provenance {
  id: string;
  city_code: string;
  name_jp: string;
  kana: string;
  /** The city's own label ("燃やすごみ"); shown to users so it matches what they see on the bin. */
  local_category: string;
  common_class: CommonClass;
  note: string;
  /** 粗大ごみ fee in yen when the city lists one per item. */
  fee_yen?: number;
}

/** ISO weekdays: 1 = Monday … 7 = Sunday. */
export type ScheduleRule =
  | { type: 'weekly'; days: number[] }
  /** Every month, on these weekdays of these weeks (第2・4水曜 → days [3], nths [2, 4]). */
  | { type: 'nth'; days: number[]; nths: number[] };

export interface ScheduleRow extends Provenance {
  id: string;
  city_code: string;
  /** 町丁目 as the city writes it, or '*' for a city-wide rule. */
  area_key: string;
  local_category: string;
  common_class: CommonClass;
  rule: ScheduleRule;
  /** The cell as published, kept for admins and diffs. */
  rule_text: string;
}

export type MasterRow = GomiItem | ScheduleRow;
export const isGomiItem = (r: MasterRow): r is GomiItem => 'name_jp' in r;
export const isScheduleRow = (r: MasterRow): r is ScheduleRow => 'rule' in r;
export const rowLabel = (r: MasterRow): string => (isGomiItem(r) ? r.name_jp : `${r.area_key} / ${r.local_category}`);

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
  rows: MasterRow[];
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
  added: MasterRow[];
  removed: MasterRow[];
  changed: Array<{ before: MasterRow; after: MasterRow; fields: string[] }>;
  unchanged: number;
}
