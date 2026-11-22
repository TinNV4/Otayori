import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { Fetcher, fetchSource, getAdapter, readTable } from '../src/server/lens/masterdata/adapters.ts';
import { decodeEntities, PAGE_MARKER, pageUpdateDate, parseTables } from '../src/server/lens/masterdata/html.ts';
import { validateSourceConfig } from '../src/server/lens/masterdata/registry.ts';
import { MemoryMasterStore } from '../src/server/lens/masterdata/store.ts';
import { publishStaged, syncSource } from '../src/server/lens/masterdata/sync.ts';
import { GomiItem, ScheduleRow, SourceConfig } from '../src/server/lens/masterdata/types.ts';
import { areaRows } from '../src/server/lens/gomi/schedule.ts';

const f = (name: string) => fs.readFileSync(`tests/fixtures/${name}`, 'utf8');
const NOW = new Date('2026-10-29T00:00:00Z');
const ctx = { fetchedAt: NOW.toISOString(), sourceUrl: 'https://x', sourceUpdatedAt: '2026-05-15' };
const noNet: Fetcher = { get: async () => { throw new Error('network must not be used'); } };

const items: SourceConfig = {
  id: 'edogawa-items', city_code: '13123', kind: 'gomi_items', adapter: 'html_items_v1', enabled: true, url: '', urls: ['https://x/a.html', 'https://x/ka.html'],
  encoding: 'utf-8', license: 'CC-BY', attribution: '江戸川区', cadence: 'monthly',
  columns: { name_jp: '品名', category: '種別', note: '出し方と注意点' },
  category_map: { 燃やすごみ: 'burnable', 燃やさないごみ: 'non_burnable', 資源: 'resource', 粗大ごみ: 'sodai' },
};
const sched: SourceConfig = {
  id: 'edogawa-schedule', city_code: '13123', kind: 'gomi_schedule', adapter: 'html_schedule_v1', enabled: true, url: 'https://x/y.html', encoding: 'utf-8',
  license: 'CC-BY', attribution: '江戸川区', cadence: 'weekly_jan_apr',
  html: { columns: ['地域', '丁目', '資源', '燃やすごみ', '燃やさないごみ', '管轄'], header_rows: 1 },
  schedule: { area_columns: ['地域', '丁目'], categories: [
    { column: '資源', local_category: '資源', common_class: 'resource' },
    { column: '燃やすごみ', local_category: '燃やすごみ', common_class: 'burnable' },
    { column: '燃やさないごみ', local_category: '燃やさないごみ', common_class: 'non_burnable' },
  ] },
};

describe('parseTables', () => {
  it('fills rowspan and colspan, decodes entities, turns <br> into a space', () => {
    const [t] = parseTables('<table><tr><th>A</th><th colspan="2">B</th></tr><tr><td rowspan="2">x&amp;y</td><td>1<br>2</td><td>&#12354;&nbsp;&lt;</td></tr><tr><td>3</td><td>4</td></tr></table>');
    expect(t).toEqual([['A', 'B', 'B'], ['x&y', '1 2', 'あ <'], ['x&y', '3', '4']]);
  });
  it('several tables, scripts and comments ignored; entities', () => {
    const html = '<script>var t="<table><tr><td>no</td></tr></table>"</script><!-- <table><tr><td>no</td></tr></table> --><table><tr><td>a</td></tr></table><table><tr><td>b</td></tr></table>';
    expect(parseTables(html)).toEqual([[['a']], [['b']]]);
    expect(decodeEntities('&#x3042;&amp;&unknown;')).toBe('あ&&unknown;');
  });
  it('reads the update date printed on city pages (latest wins)', () => {
    expect(pageUpdateDate('公開日：2020年3月1日　更新日：2026年5月15日')).toBe('2026-05-15');
    expect(pageUpdateDate('更新日：2026年1月8日 … 更新日：2025年12月31日')).toBe('2026-01-08');
    expect(pageUpdateDate('no date')).toBeUndefined();
  });
});

describe('html_items_v1 (江戸川区-style pages)', () => {
  const bytes = Buffer.from([f('edogawa-items-a.html'), f('edogawa-items-ka.html')].join(PAGE_MARKER));
  it('reads the items of every page; the header row is found by its column names', () => {
    const { headers, records } = readTable(bytes, items, ['品名', '種別']);
    expect(headers).toContain('品名');
    expect(records).toHaveLength(5);
    const { rows, warnings } = getAdapter('html_items_v1').parse(bytes, items, ctx);
    const r = rows as GomiItem[];
    expect(r.map(x => [x.name_jp, x.common_class])).toEqual([
      ['ICカード', 'burnable'], ['アイスクリームの容器(プラスチック製)', 'resource'], ['アイロン', 'non_burnable'], ['缶', 'resource'], ['ソファー', 'sodai'],
    ]);
    expect(r[3].note).toBe('軽くすすいで<青色>のコンテナへ。 汚れたものは燃やさないごみ。');
    expect(warnings).toEqual([]);
  });
  it('an unmapped label or a page without the table names the problem', () => {
    expect(() => getAdapter('html_items_v1').parse(bytes, { ...items, category_map: { 燃やすごみ: 'burnable' } }, ctx)).toThrow(/unmapped category label/);
    expect(() => getAdapter('html_items_v1').parse(Buffer.from('<p>moved</p>'), items, ctx)).toThrow(/missing column.*品名/);
  });
  it('fetches several pages into one buffer and takes the page date', async () => {
    const pages: Record<string, string> = { 'https://x/a.html': f('edogawa-items-a.html'), 'https://x/ka.html': f('edogawa-items-ka.html') };
    const fake: Fetcher = { get: async u => ({ bytes: Buffer.from(pages[u]), headers: {} }) };
    const got = await fetchSource(items, fake);
    expect(got.source_updated_at).toBe('2026-05-15');
    expect(got.bytes.toString().split(PAGE_MARKER)).toHaveLength(2);
    const store = new MemoryMasterStore();
    const out = await syncSource(items, { fetcher: fake, store, now: NOW });
    expect(out.status).toBe('staged');
    expect(out.diff!.added).toHaveLength(5);
  });
});

describe('html_schedule_v1 (江戸川区-style table)', () => {
  const bytes = Buffer.from(f('edogawa-schedule.html'));
  const { rows } = getAdapter('html_schedule_v1').parse(bytes, sched, ctx);
  const sr = rows as ScheduleRow[];
  it('resolves rowspan, strips the repeated category from the cell, expands "1から5丁目"', () => {
    const at = (area: string, cls: string) => sr.find(r => r.area_key === area && r.common_class === cls);
    expect(at('一之江1丁目', 'resource')).toMatchObject({ rule: { type: 'weekly', days: [1] }, rule_text: '月曜日' });
    expect(at('一之江5丁目', 'burnable')!.rule).toEqual({ type: 'weekly', days: [3, 6] });
    expect(at('一之江6丁目', 'non_burnable')!.rule).toEqual({ type: 'nth', days: [5], nths: [2, 4] });
    expect(at('一之江8丁目', 'non_burnable')).toBeTruthy();
    expect(at('一之江町', 'resource')).toBeTruthy(); // 全域 = the whole town
  });
  it('a family is matched by chome, by whole town, and differing blocks make it ambiguous', () => {
    expect(areaRows(sr, '一之江3丁目').rows.map(r => r.area_key)).toEqual(['一之江3丁目', '一之江3丁目', '一之江3丁目']);
    expect(areaRows(sr, '一之江町2丁目').rows[0].area_key).toBe('一之江町');
    expect(areaRows(sr, '鹿骨1丁目').rows.map(r => r.area_key)).toEqual(['鹿骨1丁目(1~17)'.replace('~', 'から'), '鹿骨1丁目(1から17)', '鹿骨1丁目(1から17)']);
    expect(areaRows(sr, '鹿骨3丁目').ambiguous).toBe(true); // 3丁目 is split into blocks with different days
  });
  it('is a valid registry entry and syncs end to end', async () => {
    expect(validateSourceConfig(sched, 'data/sources/edogawa-schedule.json').adapter).toBe('html_schedule_v1');
    const fake: Fetcher = { get: async () => ({ bytes, headers: { 'content-type': 'text/html' } }) };
    const store = new MemoryMasterStore();
    const out = await syncSource(sched, { fetcher: fake, store, now: NOW });
    expect(out.status).toBe('staged');
    publishStaged(store, sched.id, 'tester', NOW);
    expect(store.getLive(sched.id)!.meta.source_updated_at).toBe('2026-01-28'); // from "更新日" on the page
  });
});

describe('html_items_v1 on a fee list without category column (大阪市 粗大ごみ)', () => {
  const osaka: SourceConfig = {
    id: 'osaka-items', city_code: '27100', kind: 'gomi_items', adapter: 'html_items_v1', enabled: true, url: 'https://x/0000384507.html', encoding: 'utf-8',
    license: 'CC BY 4.0', attribution: '大阪市', cadence: 'monthly',
    html: { columns: ['五十音', '品名', '手数料'], header_rows: 0, tables: [0, 1, 2], constants: { 種別: '粗大ごみ' } },
    columns: { name_jp: '品名', category: '種別', fee: '手数料' }, category_map: { 粗大ごみ: 'sodai' },
  };
  const bytes = Buffer.from(f('osaka-sodai.html'));
  const rows = getAdapter('html_items_v1').parse(bytes, osaka, ctx).rows as GomiItem[];
  it('reads tables 1-3 only (size-based tables 4-5 are not items), with fee_yen and class sodai', () => {
    expect(rows.length).toBe(147);
    expect(rows.every(r => r.common_class === 'sodai' && r.fee_yen! > 0)).toBe(true);
    expect(rows.find(r => r.name_jp === 'ガスオーブンレンジ')!.fee_yen).toBe(1000);
    expect(rows.find(r => r.name_jp === '掃除機')!.fee_yen).toBe(200);
    expect(rows.some(r => /^1.5メートル未満のもの|^ごみ袋/.test(r.name_jp))).toBe(false);
    expect(rows.find(r => r.name_jp === 'たんす(幅・奥行・高さの合計が2メートル未満)')!.fee_yen).toBe(400); // size variants are separate rows
  });
  it('page date "2026年10月29日 … ページ番号" is the source date; entry validates and syncs', async () => {
    expect(pageUpdateDate(bytes.toString('utf8'))).toBe('2026-10-29');
    expect(validateSourceConfig(osaka, 'data/sources/osaka-items.json').id).toBe('osaka-items');
    const store = new MemoryMasterStore();
    const out = await syncSource(osaka, { fetcher: { get: async () => ({ bytes, headers: { 'content-type': 'text/html' } }) }, store, now: NOW });
    expect(out.status).toBe('staged');
    expect(store.getStaged('osaka-items')!.meta.source_updated_at).toBe('2026-10-29');
  });
});
