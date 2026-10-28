import { csvToRecords, decodeText } from './csv.ts';
import { parseRuleText } from './scheduleRule.ts';
import { CommonClass, SourceConfig, SourceKind } from './types.ts';

/** Strict UTF-8 first; city CSVs that fail it are almost always Shift_JIS (CP932). */
export function detectEncoding(bytes: Uint8Array): 'utf-8' | 'shift_jis' {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'shift_jis';
  }
}

// ---------- waste category labels → common classes ----------

/** Order matters: "燃やさないごみ" must be tested before "燃やすごみ". */
const CLASS_KEYWORDS: Array<[CommonClass, RegExp]> = [
  ['kaden4', /家電リサイクル|リサイクル法|家電4品目|家電４品目/],
  ['pc', /パソコン|PC/],
  ['not_collected', /収集しない|収集しません|収集できない|収集していません|出せません|処理困難|収集対象外|収集不可|販売店|引取/],
  ['sodai', /粗大/],
  ['hazardous', /有害|危険|発火|電池|スプレー|ガスボンベ|蛍光管/],
  ['non_burnable', /不燃|燃やさない|燃やせない|燃えない|もえない|もやさない|燃せない/],
  ['burnable', /可燃|燃やす|燃える|もえる|もやす|一般ごみ|普通ごみ|家庭ごみ/],
  ['pet', /ペット|PET/],
  ['plastic', /プラ(スチック)?|容器包装/],
  ['can', /缶/],
  ['glass', /びん|ビン|瓶/],
  ['paper', /古紙|紙類|新聞|雑誌|段ボール|ダンボール|雑がみ|紙パック/],
  ['cloth', /古布|衣類|布類|繊維/],
];

/** A suggestion, never a decision: the admin confirms it (and anything null is left unmapped so sync stops). */
export function suggestClass(label: string): CommonClass | null {
  const l = label.normalize('NFKC');
  for (const [cls, re] of CLASS_KEYWORDS) if (re.test(l)) return cls;
  return null;
}

// ---------- columns ----------

type Role = 'name_jp' | 'kana' | 'category' | 'note' | 'city_code';
const COLUMN_PATTERNS: Array<[Role, RegExp[]]> = [
  ['city_code', [/^(全国)?地方公共団体コード$/, /^市区町村コード$/, /^団体コード$/]],
  ['kana', [/カナ|かな|ふりがな|フリガナ|よみ|読み/]],
  ['name_jp', [/^(ごみの)?(品目|品名)(名)?$/, /^名称$/, /品目|品名/, /^(物品|もの)(名)?$/]],
  ['category', [/^分別区分$/, /^(ごみの)?(区分|分類)$/, /分別区分|収集区分|ごみの種類|分別|区分|分類/]],
  ['note', [/^備考$/, /^摘要$/, /出し方|注意|説明|注記|備考|摘要|補足/]],
];

/** Pick a header for each role; one header serves one role. */
export function guessColumns(headers: string[]): Partial<Record<Role, string>> {
  const out: Partial<Record<Role, string>> = {};
  const used = new Set<string>();
  for (const [role, patterns] of COLUMN_PATTERNS) {
    for (const re of patterns) {
      const hit = headers.find(h => !used.has(h) && re.test(h.normalize('NFKC').trim()));
      if (hit) { out[role] = hit; used.add(hit); break; }
    }
  }
  return out;
}

const AREA_RE = [/^町丁目(名)?$/, /^町丁(目)?$/, /^町名$/, /^地区(名)?$/, /^地域(名)?$/, /^収集地区/, /^住所$/, /町丁目|町名|地区|地域/];
const SCHEDULE_CATEGORY_RE = /ごみ|資源|可燃|不燃|燃や|燃え|プラ|びん|ビン|瓶|缶|ペット|古紙|紙|布|容器|有害|粗大/;

export function guessAreaColumn(headers: string[]): string | undefined {
  for (const re of AREA_RE) { const h = headers.find(x => re.test(x.normalize('NFKC').trim())); if (h) return h; }
  return undefined;
}

// ---------- the report + config ----------

export interface ScaffoldInput {
  id: string;
  city_code: string;
  kind: SourceKind;
  bytes: Buffer;
  license: string;
  attribution: string;
  /** Either a direct file URL or a CKAN dataset (the resource is resolved at sync time). */
  url?: string;
  ckan?: { api: string; dataset: string; resource_match?: string };
  source_updated_at?: string;
}

export interface ScaffoldResult {
  config: SourceConfig;
  encoding: 'utf-8' | 'shift_jis';
  headers: string[];
  records: number;
  /** Labels / cells needing a person: unmapped categories, unreadable schedule text, missing columns. */
  todo: string[];
  /** What was guessed, for the report. */
  labels: Array<{ label: string; count: number; suggested: CommonClass | null }>;
  cells: Array<{ column: string; text: string; count: number; understood: boolean }>;
}

const countBy = (values: string[]) => {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

/**
 * Turn a downloaded file into a draft registry entry: encoding, columns, category map, schedule columns.
 * The entry is written disabled; a person checks the todo list, runs `inspect`, then `sync`.
 */
export function scaffoldSource(inp: ScaffoldInput): ScaffoldResult {
  const encoding = detectEncoding(inp.bytes);
  const { headers, records } = csvToRecords(decodeText(inp.bytes, encoding));
  const todo: string[] = [];
  const base = {
    id: inp.id,
    city_code: inp.city_code,
    kind: inp.kind,
    enabled: false,
    note: 'Draft written by `data scaffold`: check every guess against the dataset page, then run inspect → sync → publish, then set enabled:true.',
    ...(inp.ckan ? { ckan: inp.ckan } : {}),
    url: inp.url ?? '',
    encoding,
    license: inp.license,
    attribution: inp.attribution,
    cadence: 'monthly' as const,
    ...(inp.source_updated_at ? { source_updated_at: inp.source_updated_at } : {}),
  };

  if (inp.kind === 'gomi_items') {
    const g = guessColumns(headers);
    if (!g.name_jp) todo.push(`no item-name column found among: ${headers.join(' | ')}`);
    if (!g.category) todo.push(`no category column found among: ${headers.join(' | ')}`);
    const catCol = g.category;
    const counts = catCol ? countBy(records.map(r => r[catCol]).filter(Boolean)) : [];
    const labels = counts.map(([label, count]) => ({ label, count, suggested: suggestClass(label) }));
    const category_map = Object.fromEntries(labels.filter(l => l.suggested).map(l => [l.label, l.suggested!]));
    for (const l of labels.filter(x => !x.suggested)) todo.push(`category "${l.label}" (${l.count} rows): choose a common class and add it to category_map`);
    const config: SourceConfig = {
      ...base,
      adapter: 'ckan_csv_v1',
      columns: { name_jp: g.name_jp ?? '', category: g.category ?? '', ...(g.kana ? { kana: g.kana } : {}), ...(g.note ? { note: g.note } : {}), ...(g.city_code ? { city_code: g.city_code } : {}) },
      category_map,
    };
    return { config, encoding, headers, records: records.length, todo, labels, cells: [] };
  }

  // gomi_schedule: wide table (one column per category)
  const area = guessAreaColumn(headers);
  const cityCol = guessColumns(headers).city_code;
  const catCols = headers.filter(h => h !== area && h !== cityCol && SCHEDULE_CATEGORY_RE.test(h));
  if (!catCols.length) todo.push(`no category columns found among: ${headers.join(' | ')}. If the file is "long" (one row per area × category), convert it to a wide table first.`);
  if (!area) todo.push('no area column found: this will be treated as a city-wide schedule (every area the same). Check that is true.');
  const categories = catCols.map(column => ({ column, local_category: column, common_class: suggestClass(column) ?? ('burnable' as CommonClass) }));
  for (const c of catCols) if (!suggestClass(c)) todo.push(`column "${c}": set its common_class (defaulted to burnable)`);
  const cells = catCols.flatMap(column =>
    countBy(records.map(r => r[column])).slice(0, 12).map(([text, count]) => ({ column, text, count, understood: parseRuleText(text) !== null })));
  for (const c of cells.filter(x => !x.understood)) todo.push(`column "${c.column}": "${c.text}" (${c.count} rows) is not understood by parseRuleText`);
  const config: SourceConfig = {
    ...base,
    adapter: 'schedule_csv_v1',
    schedule: { ...(area ? { area_column: area } : {}), ...(cityCol ? { city_code_column: cityCol } : {}), categories },
  };
  return { config, encoding, headers, records: records.length, todo, labels: [], cells };
}

export function renderScaffold(r: ScaffoldResult): string {
  const out = [
    `encoding ${r.encoding} · ${r.records} records`,
    `headers  ${r.headers.join(' | ')}`,
    '',
  ];
  const c = r.config;
  if (c.kind === 'gomi_items' && c.columns) {
    out.push('columns   ' + Object.entries(c.columns).map(([k, v]) => `${k}=${v || '??'}`).join('  '));
    out.push('', 'category labels (✓ suggested · ? needs you)');
    for (const l of r.labels) out.push(`  ${l.suggested ? '✓' : '?'} ${l.label.padEnd(18)} ${String(l.count).padStart(5)}  ${l.suggested ? `→ ${l.suggested}` : ''}`);
  } else if (c.schedule) {
    out.push(`area column: ${c.schedule.area_column ?? '(none: city-wide)'}`);
    out.push('schedule columns: ' + c.schedule.categories.map(k => `${k.column}→${k.common_class}`).join('  '));
    out.push('', 'sample cells');
    for (const x of r.cells) out.push(`  ${x.understood ? '✓' : '✗'} ${x.column.padEnd(12)} ${x.text.padEnd(14)} ×${x.count}`);
  }
  out.push('', r.todo.length ? `TODO (${r.todo.length})\n${r.todo.map(t => `  - ${t}`).join('\n')}` : 'Nothing left to decide: run inspect, then sync.');
  return out.join('\n');
}
