import { describe, expect, it } from 'vitest';
import { Fetcher, fetchSource, getAdapter, SyncError } from '../src/server/lens/masterdata/adapters.ts';
import { csvToRecords, decodeText, parseCsv } from '../src/server/lens/masterdata/csv.ts';
import { validateSourceConfig } from '../src/server/lens/masterdata/registry.ts';
import { renderInspect, renderStatus } from '../src/server/lens/masterdata/report.ts';
import { MemoryMasterStore } from '../src/server/lens/masterdata/store.ts';
import { isDue, isStale, publishStaged, rejectStaged, rollback, syncSource } from '../src/server/lens/masterdata/sync.ts';
import { GomiItem, SourceConfig } from '../src/server/lens/masterdata/types.ts';

const src: SourceConfig = {
  id: 'city-12345-items', city_code: '12345', kind: 'gomi_items', adapter: 'ckan_csv_v1', enabled: true,
  url: 'https://data.example.jp/items.csv', encoding: 'utf-8', license: 'CC-BY-4.0', attribution: 'Test city',
  columns: { name_jp: '品目名', kana: 'カナ', category: '区分', note: '摘要', city_code: 'コード' },
  category_map: { 燃えるごみ: 'burnable', 燃えないごみ: 'non_burnable', 有害ごみ: 'hazardous', 家電リサイクル対象: 'kaden4' },
  cadence: 'monthly',
};

const HEAD = 'コード,品目名,カナ,区分,摘要';
function csv(rows: string[]) { return Buffer.from([HEAD, ...rows].join('\n'), 'utf8'); }
/** n filler burnable items + the given extra rows. */
function bigCsv(n: number, extra: string[] = []) {
  return csv([...Array.from({ length: n }, (_, i) => `12345,品目${i},ヒンモク,燃えるごみ,`), ...extra]);
}
const BATTERY = '12345,モバイルバッテリー,バッテリー,有害ごみ,';
const TV = '12345,テレビ,テレビ,家電リサイクル対象,';

const noNet: Fetcher = { get: async () => { throw new Error('network must not be used'); } };
const file = (bytes: Buffer, d = '2026-04-01') => ({ bytes, source_updated_at: d });
const T0 = new Date('2026-10-28T00:00:00Z');

describe('csv', () => {
  it('handles quotes, escaped quotes, CRLF, embedded newlines and BOM', () => {
    const text = '﻿a,b\r\n"x,1","he said ""hi"""\r\n"multi\nline",z\r\n\r\n';
    expect(parseCsv(decodeText(Buffer.from(text), 'utf-8'))).toEqual([['a', 'b'], ['x,1', 'he said "hi"'], ['multi\nline', 'z']]);
  });
  it('decodes Shift_JIS', () => {
    expect(decodeText(Buffer.from([0x82, 0xb2, 0x82, 0xdd]), 'shift_jis')).toBe('ごみ');
  });
  it('keys records by trimmed header and pads short rows', () => {
    expect(csvToRecords(' a , b\n1').records).toEqual([{ a: '1', b: '' }]);
  });
});

describe('category labels are compared after normalization', () => {
  it('a map key written with full-width parentheses or spaces matches the file label', () => {
    const cfg: SourceConfig = { ...src, category_map: { 'プラスチック（資源）、可燃ごみ': 'plastic', 'メーカー回収\n宅配便回収': 'other', 燃えるごみ: 'burnable' } };
    const csvText = csv(['12345,a,a,"プラスチック（資源）、可燃ごみ",', '12345,b,b,"メーカー回収 宅配便回収",', '12345,c,c,燃えるごみ,']);
    const { rows } = getAdapter('ckan_csv_v1').parse(csvText, cfg, { fetchedAt: '', sourceUrl: '', sourceUpdatedAt: '2026-04-01' });
    expect((rows as GomiItem[]).map(r => r.common_class)).toEqual(['plastic', 'other', 'burnable']);
  });
});

describe('ckan_csv_v1 adapter: real Tokyo-standard files', () => {
  const cfg: SourceConfig = { ...src, columns: { name_jp: 'ゴミの品目', kana: 'ゴミの品目_カナ', category: '分別区分', note: ['備考', '注意点'], fee: '粗大ごみ回収料金', city_code: '全国地方公共団体コード' },
    category_map: { 粗大ごみ: 'sodai', 燃やすごみ: 'burnable' } };
  const head = '全国地方公共団体コード,ゴミの品目,ゴミの品目_カナ,分別区分,注意点,備考,粗大ごみ回収料金';
  const parse2 = (rows: string[]) => getAdapter('ckan_csv_v1').parse(Buffer.from([head, ...rows].join('\n')), cfg, { fetchedAt: '2026-10-28T00:00:00Z', sourceUrl: 'https://x', sourceUpdatedAt: '2026-04-01' });
  it('compares the first 5 digits of the 6-digit national code, joins several note columns, reads the fee', () => {
    const { rows } = parse2(['123456,ソファ,ソファ,粗大ごみ,二人で運ぶ,大きいもの,"1,200円"', '123456,割り箸,わりばし,燃やすごみ,,,', '999999,他市,ホカ,燃やすごみ,,,']);
    const items = rows as GomiItem[];
    expect(items.map(r => r.name_jp)).toEqual(['ソファ', '割り箸']);
    expect(items[0]).toMatchObject({ note: '大きいもの / 二人で運ぶ', fee_yen: 1200, common_class: 'sodai' });
    expect(items[1].fee_yen).toBeUndefined();
  });
  it('reports a missing note/fee column by name', () => {
    expect(() => getAdapter('ckan_csv_v1').parse(Buffer.from('全国地方公共団体コード,ゴミの品目,分別区分\n123456,a,粗大ごみ'), cfg, { fetchedAt: '', sourceUrl: '', sourceUpdatedAt: '2026-04-01' })).toThrow(/missing column.*備考/);
  });
});

describe('ckan_csv_v1 adapter', () => {
  const ctx = { fetchedAt: T0.toISOString(), sourceUrl: src.url, sourceUpdatedAt: '2026-04-01' };
  const parse = (b: Buffer, s = src) => getAdapter('ckan_csv_v1').parse(b, s, ctx);

  it('maps rows, normalizes width, keeps provenance on every row', () => {
    const { rows } = parse(csv(['12345,ＴＶ　台,テレビダイ,燃えるごみ,小型のもの']));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      city_code: '12345', name_jp: 'TV 台', local_category: '燃えるごみ', common_class: 'burnable', note: '小型のもの',
      source_id: src.id, source_url: src.url, source_updated_at: '2026-04-01', license: 'CC-BY-4.0', attribution: 'Test city', status: 'draft',
    });
  });
  it('filters other cities and skips blank rows with warnings', () => {
    const { rows, warnings } = parse(csv(['99999,他市,ホカ,燃えるごみ,', '12345,,,燃えるごみ,', '12345,紙くず,カミ,燃えるごみ,']));
    expect((rows as GomiItem[]).map(r => r.name_jp)).toEqual(['紙くず']);
    expect(warnings.join()).toMatch(/other city_code/);
    expect(warnings.join()).toMatch(/blank/);
  });
  it('stops on unmapped category labels and names them', () => {
    expect(() => parse(csv(['12345,x,x,新しい区分,']))).toThrow(/unmapped.*新しい区分/);
  });
  it('stops on missing columns and lists the headers it found', () => {
    expect(() => parse(Buffer.from('foo,bar\n1,2'))).toThrow(/missing column.*品目名.*foo \| bar/);
  });
  it('fails on an empty result', () => {
    expect(() => parse(csv(['99999,他市,ホカ,燃えるごみ,']))).toThrow(SyncError);
  });
  it('gives duplicate items distinct ids', () => {
    const { rows, warnings } = parse(csv(['12345,紙,カミ,燃えるごみ,', '12345,紙,カミ,燃えるごみ,']));
    expect(new Set(rows.map(r => r.id)).size).toBe(2);
    expect(warnings.join()).toMatch(/duplicate/);
  });
  it('keeps ids stable across runs and independent of category', () => {
    const a = parse(csv(['12345,紙,カミ,燃えるごみ,'])).rows[0].id;
    const b = parse(csv(['12345,紙,カミ,燃えないごみ,'])).rows[0].id;
    expect(a).toBe(b);
  });
});

describe('fetchSource', () => {
  const ckan = { ...src, url: '', ckan: { api: 'https://ckan.example.jp/api/3/action', dataset: 'ds1', resource_match: 'r5' } };
  const pkg = {
    success: true,
    result: {
      metadata_modified: '2026-01-01T00:00:00',
      resources: [
        { name: 'R4 一覧', format: 'CSV', url: 'https://x/r4.csv', last_modified: null },
        { name: 'R5 一覧', format: 'CSV', url: 'https://x/r5.csv', last_modified: '2026-03-15T09:00:00' },
        { name: 'R5 一覧', format: 'XLSX', url: 'https://x/r5.xlsx' },
      ],
    },
  };
  it('resolves the matching CSV resource and its date from the portal', async () => {
    const calls: string[] = [];
    const f: Fetcher = {
      get: async url => {
        calls.push(url);
        return url.includes('package_show') ? { bytes: Buffer.from(JSON.stringify(pkg)), headers: {} } : { bytes: Buffer.from('data'), headers: {} };
      },
    };
    const r = await fetchSource(ckan, f);
    expect(r.url).toBe('https://x/r5.csv');
    expect(r.source_updated_at).toBe('2026-03-15');
    expect(calls[0]).toBe('https://ckan.example.jp/api/3/action/package_show?id=ds1');
  });
  it('falls back to the dataset date, then to Last-Modified for direct files', async () => {
    expect((await fetchSource({ ...ckan, ckan: { ...ckan.ckan!, resource_match: 'r4' } }, {
      get: async url => url.includes('package_show') ? { bytes: Buffer.from(JSON.stringify(pkg)), headers: {} } : { bytes: Buffer.from('d'), headers: {} },
    })).source_updated_at).toBe('2026-01-01');
    const direct = await fetchSource(src, { get: async () => ({ bytes: Buffer.from('d'), headers: { 'last-modified': 'Tue, 07 Apr 2026 00:00:00 GMT' } }) });
    expect(direct.source_updated_at).toBe('2026-04-07');
  });
  it('reports when no CSV resource matches', async () => {
    const f: Fetcher = { get: async () => ({ bytes: Buffer.from(JSON.stringify({ success: true, result: { resources: [] } })), headers: {} }) };
    await expect(fetchSource(ckan, f)).rejects.toThrow(/no CSV resource/);
  });
});

describe('syncSource', () => {
  const run = (store: MemoryMasterStore, bytes: Buffer, o: object = {}, d = '2026-04-01', s = src) =>
    syncSource(s, { fetcher: noNet, store, now: T0, file: file(bytes, d), ...o });

  it('stages the first import, then publishes on admin approval with verified rows', async () => {
    const store = new MemoryMasterStore();
    const r = await run(store, bigCsv(40));
    expect(r.status).toBe('staged');
    expect(r.review_reasons[0]).toMatch(/first import/);
    expect(store.getLive(src.id)).toBeNull();
    const live = publishStaged(store, src.id, 'tin', T0);
    expect(live.meta).toMatchObject({ version: 1, verified_by: 'tin', row_count: 40 });
    expect(store.getLive(src.id)!.rows.every(x => x.status === 'verified')).toBe(true);
    expect(store.getStaged(src.id)).toBeNull();
  });

  it('reject drops the staged snapshot and lets the same file be evaluated again', async () => {
    const store = new MemoryMasterStore();
    await run(store, bigCsv(40));
    rejectStaged(store, src.id);
    expect(store.getStaged(src.id)).toBeNull();
    expect((await run(store, bigCsv(40))).status).toBe('staged');
    expect(() => rejectStaged(new MemoryMasterStore(), src.id)).toThrow(/nothing staged/);
  });

  it('tracks state across publish', async () => {
    const store = new MemoryMasterStore();
    await run(store, bigCsv(40));
    publishStaged(store, src.id, 'tin', T0);
    expect(store.getState(src.id).last_status).toBe('published');
  });

  it('skips an identical file, but re-parses after a failure with the same file', async () => {
    const store = new MemoryMasterStore();
    await run(store, bigCsv(40));
    publishStaged(store, src.id, 'tin', T0);
    expect((await run(store, bigCsv(40))).status).toBe('unchanged');
    const bad = csv(['12345,x,x,未知,']);
    expect((await run(store, bad)).status).toBe('failed');
    expect((await run(store, bad)).status).toBe('failed'); // not "unchanged": a failed hash is retried
  });

  it('auto-publishes a small, safe change and records a new version', async () => {
    const store = new MemoryMasterStore();
    await run(store, bigCsv(40));
    publishStaged(store, src.id, 'tin', T0);
    const r = await run(store, bigCsv(41), {}, '2026-05-01'); // +1 row of 41 ≈ 2.4%
    expect(r.status).toBe('published');
    expect(store.getLive(src.id)!.meta).toMatchObject({ version: 2, verified_by: 'auto', source_updated_at: '2026-05-01' });
  });

  it('stages (does not auto-publish) a large change', async () => {
    const store = new MemoryMasterStore();
    await run(store, bigCsv(40));
    publishStaged(store, src.id, 'tin', T0);
    const r = await run(store, bigCsv(46)); // +6 of 40 = 15%: under the 20% stop, over the 5% auto limit
    expect(r.status).toBe('staged');
    expect(r.review_reasons.join()).toMatch(/15\.0% of rows changed/);
    expect(store.getLive(src.id)!.rows).toHaveLength(40);
  });

  it('stops and keeps live on a row-count collapse unless forced', async () => {
    const store = new MemoryMasterStore();
    await run(store, bigCsv(40));
    publishStaged(store, src.id, 'tin', T0);
    const r = await run(store, bigCsv(10));
    expect(r.status).toBe('failed');
    expect((r.error as SyncError).code).toBe('delta');
    expect(store.getLive(src.id)!.rows).toHaveLength(40);
    expect((await run(store, bigCsv(10), { force: true })).status).toBe('staged');
  });

  it('never auto-publishes a downgrade of a hazardous / appliance-law item, even forced', async () => {
    const store = new MemoryMasterStore();
    await run(store, bigCsv(40, [BATTERY, TV]));
    publishStaged(store, src.id, 'tin', T0);
    const downgraded = bigCsv(40, ['12345,モバイルバッテリー,バッテリー,燃えるごみ,', TV]);
    for (const force of [false, true]) {
      const r = await run(store, downgraded, { force });
      expect(r.status).toBe('staged');
      expect(r.review_reasons.join()).toMatch(/downgraded: "モバイルバッテリー" hazardous → burnable/);
    }
    const removed = bigCsv(40, [TV]);
    expect((await run(store, removed, { force: true })).review_reasons.join()).toMatch(/removed: "モバイルバッテリー"/);
    expect((store.getLive(src.id)!.rows as GomiItem[]).find(r => r.name_jp === 'モバイルバッテリー')!.common_class).toBe('hazardous');
  });

  it('refuses a source whose date it cannot determine', async () => {
    const store = new MemoryMasterStore();
    const r = await syncSource(src, { fetcher: noNet, store, now: T0, file: { bytes: bigCsv(5) } });
    expect(r.status).toBe('failed');
    expect((r.error as SyncError).code).toBe('no_date');
    const ok = await syncSource({ ...src, source_updated_at: '2023-03-01' }, { fetcher: noNet, store, now: T0, file: { bytes: bigCsv(5) } });
    expect(ok.status).toBe('staged');
  });

  it('dry run writes nothing', async () => {
    const store = new MemoryMasterStore();
    const r = await run(store, bigCsv(40), { dryRun: true });
    expect(r.status).toBe('dry_run');
    expect(r.detail).toMatch(/would stage/);
    expect(store.getStaged(src.id)).toBeNull();
    expect(store.getState(src.id).last_status).toBeUndefined();
  });

  it('records fetch failures in state without touching live data', async () => {
    const store = new MemoryMasterStore();
    await run(store, bigCsv(40));
    publishStaged(store, src.id, 'tin', T0);
    const r = await syncSource(src, { fetcher: noNet, store, now: T0 });
    expect(r.status).toBe('failed');
    expect(store.getState(src.id)).toMatchObject({ last_status: 'failed' });
    expect(store.getLive(src.id)!.rows).toHaveLength(40);
  });

  it('rolls back to the previous version as a new version', async () => {
    const store = new MemoryMasterStore();
    await run(store, bigCsv(40));
    publishStaged(store, src.id, 'tin', T0);
    await run(store, bigCsv(41), {}, '2026-05-01');
    const back = rollback(store, src.id, undefined, 'tin', T0);
    expect(back.meta).toMatchObject({ version: 3, note: 'rollback to v1' });
    expect(store.getLive(src.id)!.rows).toHaveLength(40);
    expect(store.versions(src.id)).toEqual([1, 2, 3]);
    expect(() => rollback(new MemoryMasterStore(), 'x', undefined, 'tin')).toThrow(/no earlier version/);
  });
});

describe('scheduling + staleness', () => {
  it('runs monthly, and weekly from January to April for fiscal-year sources', () => {
    const wk = { ...src, cadence: 'weekly_jan_apr' as const };
    const last = '2026-02-01T00:00:00Z';
    expect(isDue(src, undefined, T0)).toBe(true);
    expect(isDue(src, last, new Date('2026-02-20T00:00:00Z'))).toBe(false);
    expect(isDue(wk, last, new Date('2026-02-08T00:00:00Z'))).toBe(true); // Feb: weekly
    expect(isDue(wk, '2026-10-01T00:00:00Z', new Date('2026-10-10T00:00:00Z'))).toBe(false); // Oct: monthly
  });
  it('flags data older than ~13 months, or of unknown date', () => {
    expect(isStale('2026-04-01', T0)).toBe(false);
    expect(isStale('2025-09-01', T0)).toBe(true);
    expect(isStale(undefined, T0)).toBe(true);
  });
});

describe('registry validation', () => {
  const ok = { ...src };
  it('accepts a complete source and applies defaults', () => {
    const { enabled: _enabled, ...rest } = ok;
    expect(validateSourceConfig(rest, 'data/sources/city-12345-items.json')).toMatchObject({ enabled: true, cadence: 'monthly' });
  });
  it.each([
    [{ ...ok, id: 'other' }, /must equal the file name/],
    [{ ...ok, city_code: '123' }, /5-digit/],
    [{ ...ok, license: '' }, /license/],
    [{ ...ok, category_map: { x: 'bogus' } }, /not one of/],
    [{ ...ok, url: '', ckan: undefined }, /url.*ckan/],
    [{ ...ok, source_updated_at: '令和5年' }, /YYYY-MM-DD/],
  ])('rejects %#', (cfg, re) => {
    expect(() => validateSourceConfig(cfg, 'data/sources/city-12345-items.json')).toThrow(re);
  });
});

describe('reports', () => {
  it('inspect shows headers and marks unmapped labels', () => {
    const out = renderInspect(src, csv(['12345,a,a,燃えるごみ,', '12345,b,b,謎の区分,']), { url: 'https://x/y.csv', source_updated_at: '2026-04-01' });
    expect(out).toMatch(/headers\s+コード \| 品目名/);
    expect(out).toMatch(/燃えるごみ.*→ burnable/);
    expect(out).toMatch(/謎の区分.*UNMAPPED/);
  });
  it('status lists state, version and review reasons', async () => {
    const store = new MemoryMasterStore();
    await syncSource(src, { fetcher: noNet, store, now: T0, file: file(bigCsv(40)) });
    expect(renderStatus([src], store, T0)).toMatch(/staged\s+–\s+×40/);
    publishStaged(store, src.id, 'tin', T0);
    const out = renderStatus([src], store, T0);
    expect(out).toMatch(/v1 ×40/);
    expect(out).toMatch(/burnable\s+█+ 40/);
  });
});
