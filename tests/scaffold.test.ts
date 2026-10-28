import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ckanAction, Fetcher, SyncError } from '../src/server/lens/masterdata/adapters.ts';
import { validateSourceConfig } from '../src/server/lens/masterdata/registry.ts';
import { detectEncoding, guessAreaColumn, guessColumns, renderScaffold, scaffoldSource, suggestClass } from '../src/server/lens/masterdata/scaffold.ts';
import { MemoryMasterStore } from '../src/server/lens/masterdata/store.ts';
import { syncSource } from '../src/server/lens/masterdata/sync.ts';
import { CommonClass, SourceConfig } from '../src/server/lens/masterdata/types.ts';

const ITEMS = fs.readFileSync('tests/fixtures/items-cp932.csv');
const SCHED = fs.readFileSync('tests/fixtures/schedule-utf8.csv');
const base = { license: 'CC-BY-4.0', attribution: '◯◯区 ごみ分別 (CC BY 4.0)', url: 'https://catalog.example.jp/dataset/x' };
const NOW = new Date('2026-10-28T00:00:00Z');
const noNet: Fetcher = { get: async () => { throw new Error('network must not be used'); } };

describe('detectEncoding', () => {
  it('Shift_JIS city CSVs vs UTF-8', () => {
    expect(detectEncoding(ITEMS)).toBe('shift_jis');
    expect(detectEncoding(SCHED)).toBe('utf-8');
    expect(detectEncoding(Buffer.from('﻿a,b\n1,2'))).toBe('utf-8');
  });
});

describe('suggestClass (a suggestion, never a decision)', () => {
  it.each<[string, CommonClass]>([
    ['燃やすごみ', 'burnable'], ['可燃ごみ', 'burnable'], ['もえるごみ', 'burnable'],
    ['燃やさないごみ', 'non_burnable'], ['燃やせないごみ', 'non_burnable'], ['不燃ごみ', 'non_burnable'], ['もえないごみ', 'non_burnable'],
    ['ペットボトル', 'pet'], ['プラスチック製容器包装', 'plastic'], ['缶', 'can'], ['びん', 'glass'], ['古紙', 'paper'], ['古布', 'cloth'],
    ['有害ごみ', 'hazardous'], ['乾電池', 'hazardous'], ['粗大ごみ', 'sodai'], ['家電リサイクル法対象品目', 'kaden4'],
    ['収集しません', 'not_collected'], ['販売店引取', 'not_collected'], ['パソコン', 'pc'],
  ])('%s → %s', (label, cls) => expect(suggestClass(label)).toBe(cls));
  it('leaves what it cannot place for a person ("資源" is a bucket, not a class)', () => {
    for (const l of ['資源', '小型金属類', '']) expect(suggestClass(l)).toBeNull();
  });
});

describe('guessColumns', () => {
  it.each([
    [['品目', '読み', '分別区分', '備考'], { name_jp: '品目', kana: '読み', category: '分別区分', note: '備考' }],
    [['市区町村コード', '品目名', 'カナ表記', '区分', '摘要'], { city_code: '市区町村コード', name_jp: '品目名', kana: 'カナ表記', category: '区分', note: '摘要' }],
    [['ごみの品目', 'ふりがな', 'ごみの分類', '出し方'], { name_jp: 'ごみの品目', kana: 'ふりがな', category: 'ごみの分類', note: '出し方' }],
  ])('%j', (headers, want) => expect(guessColumns(headers)).toEqual(want));
  it('one header serves one role', () => {
    const g = guessColumns(['品目', '分別']);
    expect(new Set(Object.values(g)).size).toBe(Object.values(g).length);
  });
  it('area column', () => {
    expect(guessAreaColumn(['町丁目', '燃やすごみ'])).toBe('町丁目');
    expect(guessAreaColumn(['地区名', 'x'])).toBe('地区名');
    expect(guessAreaColumn(['a', 'b'])).toBeUndefined();
  });
});

describe('scaffoldSource: items', () => {
  const r = scaffoldSource({ id: 'city-13118-items', city_code: '13118', kind: 'gomi_items', bytes: ITEMS, ...base });
  it('detects encoding + columns and maps the labels it is sure about', () => {
    expect(r.encoding).toBe('shift_jis');
    expect(r.config).toMatchObject({
      enabled: false, adapter: 'ckan_csv_v1', encoding: 'shift_jis', license: 'CC-BY-4.0',
      columns: { name_jp: '品目', kana: '読み', category: '分別区分', note: '備考' },
    });
    expect(r.config.category_map).toMatchObject({ ペットボトル: 'pet', 有害ごみ: 'hazardous', 燃やすごみ: 'burnable', 燃やさないごみ: 'non_burnable', 家電リサイクル法対象品目: 'kaden4', 粗大ごみ: 'sodai', 古紙: 'paper' });
  });
  it('lists exactly what a person must decide', () => {
    expect(r.todo).toEqual([expect.stringContaining('"小型金属類"')]);
    expect(r.config.category_map).not.toHaveProperty('小型金属類');
    expect(renderScaffold(r)).toMatch(/\? 小型金属類\s+1/);
    expect(renderScaffold(r)).toMatch(/✓ ペットボトル\s+1\s+→ pet/);
  });
  it('is a valid registry entry, and sync stops on the unmapped label until it is added', async () => {
    expect(validateSourceConfig(r.config, 'data/sources/city-13118-items.json').enabled).toBe(false);
    const cfg = { ...r.config, enabled: true } as SourceConfig;
    const store = new MemoryMasterStore();
    const failed = await syncSource(cfg, { fetcher: noNet, store, now: NOW, file: { bytes: ITEMS, source_updated_at: '2026-04-01' } });
    expect(failed.status).toBe('failed');
    expect(failed.detail).toMatch(/unmapped category label.*小型金属類/);
    const fixed = { ...cfg, category_map: { ...cfg.category_map, 小型金属類: 'non_burnable' as const } };
    const ok = await syncSource(fixed, { fetcher: noNet, store, now: NOW, file: { bytes: ITEMS, source_updated_at: '2026-04-01' } });
    expect(ok.status).toBe('staged'); // first import always waits for an admin
    expect(ok.diff!.added).toHaveLength(9);
  });
  it('names the problem when the columns cannot be found', () => {
    const bad = scaffoldSource({ id: 'x', city_code: '13118', kind: 'gomi_items', bytes: Buffer.from('foo,bar\n1,2'), ...base });
    expect(bad.todo.join()).toMatch(/no item-name column.*foo \| bar/);
    expect(() => validateSourceConfig(bad.config, 'data/sources/x.json')).toThrow(); // never written as-is
  });
});

describe('scaffoldSource: schedule', () => {
  const r = scaffoldSource({ id: 'city-13118-schedule', city_code: '13118', kind: 'gomi_schedule', bytes: SCHED, ...base });
  it('finds the area and the category columns, and proves the cells are understood', () => {
    expect(r.config.schedule).toMatchObject({ area_column: '町丁目' });
    expect(r.config.schedule!.categories).toEqual([
      { column: '燃やすごみ', local_category: '燃やすごみ', common_class: 'burnable' },
      { column: '燃やさないごみ', local_category: '燃やさないごみ', common_class: 'non_burnable' },
      { column: 'プラスチック', local_category: 'プラスチック', common_class: 'plastic' },
      { column: '古紙', local_category: '古紙', common_class: 'paper' },
    ]);
    expect(r.cells.every(c => c.understood)).toBe(true);
    expect(r.todo).toEqual([]);
    expect(renderScaffold(r)).toMatch(/Nothing left to decide/);
  });
  it('sync of the scaffolded schedule works as is', async () => {
    const out = await syncSource({ ...r.config, enabled: true } as SourceConfig, { fetcher: noNet, store: new MemoryMasterStore(), now: NOW, file: { bytes: SCHED, source_updated_at: '2026-04-01' } });
    expect(out.status).toBe('staged');
    expect(out.diff!.added).toHaveLength(12);
  });
  it('flags cells it cannot read, and long-format files', () => {
    const odd = scaffoldSource({ id: 'x', city_code: '13118', kind: 'gomi_schedule', bytes: Buffer.from('町丁目,燃やすごみ\nA,月・木\nB,毎日\nC,随時'), ...base });
    expect(odd.todo.join('\n')).toMatch(/"毎日" \(1 rows\) is not understood/);
    expect(odd.todo.join('\n')).toMatch(/"随時"/);
    const long = scaffoldSource({ id: 'x', city_code: '13118', kind: 'gomi_schedule', bytes: Buffer.from('地区,収集品目,曜日\nA,燃やす,月'), ...base });
    expect(long.todo.join()).toMatch(/long.*convert it to a wide table/);
  });
  it('a file without an area column is flagged as city-wide', () => {
    const wide = scaffoldSource({ id: 'x', city_code: '13118', kind: 'gomi_schedule', bytes: Buffer.from('燃やすごみ,古紙\n月・木,第1金'), ...base });
    expect(wide.todo.join()).toMatch(/treated as a city-wide schedule/);
    expect(wide.config.schedule!.area_column).toBeUndefined();
  });
});

describe('ckanAction', () => {
  const fake = (body: string): Fetcher => ({ get: async () => ({ bytes: Buffer.from(body), headers: {} }) });
  it('returns the result, or an error a person can act on', async () => {
    expect(await ckanAction(fake('{"success":true,"result":{"count":2}}'), 'https://c.example/api/3/action/', 'package_search', { q: 'ごみ' })).toEqual({ count: 2 });
    await expect(ckanAction(fake('<html>'), 'https://c.example/api', 'package_show', { id: 'x' })).rejects.toThrow(/not JSON/);
    await expect(ckanAction(fake('{"success":false,"error":{"message":"Not found"}}'), 'https://c.example/api', 'package_show', { id: 'x' })).rejects.toThrow(/package_show failed: Not found/);
    await expect(ckanAction(fake('{"success":false}'), 'https://c.example/api', 'package_show', { id: 'x' })).rejects.toBeInstanceOf(SyncError);
  });
  it('builds the URL with an encoded query', async () => {
    const seen: string[] = [];
    await ckanAction({ get: async u => { seen.push(u); return { bytes: Buffer.from('{"success":true,"result":1}'), headers: {} }; } }, 'https://c.example/api/', 'package_search', { q: 'ごみ 分別', rows: '5' });
    expect(seen[0]).toBe('https://c.example/api/package_search?q=%E3%81%94%E3%81%BF+%E5%88%86%E5%88%A5&rows=5');
  });
});

describe('CLI: scaffold → inspect → sync → publish on real files (no network)', () => {
  const run = (env: Record<string, string>, ...args: string[]) => {
    try {
      return { out: execFileSync('npx', ['tsx', 'scripts/data.ts', ...args], { env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; status?: number };
      return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 };
    }
  };
  it('imports a Shift_JIS city file end to end', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-'));
    const env = { MASTERDATA_SOURCES: path.join(tmp, 'sources'), MASTERDATA_DIR: path.join(tmp, 'out') };
    const file = path.resolve('tests/fixtures/items-cp932.csv');
    const common = ['scaffold', 'demo-items', '--city', '13118', '--file', file, '--url', 'https://catalog.example.jp/dataset/x', '--license', 'CC-BY-4.0', '--attribution', 'デモ区 (CC BY 4.0)'];

    const dry = run(env, ...common);
    expect(dry.code).toBe(0);
    expect(dry.out).toMatch(/encoding shift_jis/);
    expect(dry.out).toMatch(/dry run/);
    expect(fs.existsSync(path.join(tmp, 'sources', 'demo-items.json'))).toBe(false);

    expect(run(env, ...common.filter(a => a !== '--url' && a !== 'https://catalog.example.jp/dataset/x')).out).toMatch(/--url .* is required/);
    expect(run(env, ...common, '--write').out).toMatch(/Wrote .*demo-items\.json \(enabled:false\)/);
    expect(run(env, ...common, '--write').out).toMatch(/exists/); // no silent overwrite

    const sync1 = run(env, 'sync', 'demo-items', '--file', file, '--updated', '2026-04-01');
    expect(sync1.code).toBe(1);
    expect(sync1.out).toMatch(/unmapped category label.*小型金属類/);

    const f = path.join(tmp, 'sources', 'demo-items.json');
    const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
    cfg.category_map['小型金属類'] = 'non_burnable';
    cfg.enabled = true;
    fs.writeFileSync(f, JSON.stringify(cfg));
    expect(run(env, 'sync', 'demo-items', '--file', file, '--updated', '2026-04-01').out).toMatch(/staged/);
    expect(run(env, 'publish', 'demo-items', '--by', 'tester').out).toMatch(/Published v1 \(9 rows/);
    expect(run(env, 'status').out).toMatch(/demo-items\s+published\s+v1 ×9/);
  }, 90_000);
});
