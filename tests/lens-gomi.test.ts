import { describe, expect, it } from 'vitest';
import { HAIKU_MODEL, SONNET_MODEL } from '../src/server/extract.ts';
import { MemoryRepo } from '../src/server/db/memory.ts';
import { answerGomi, GomiDeps } from '../src/server/lens/gomi/core.ts';
import { dictionaryFromStore } from '../src/server/lens/gomi/dictionary.ts';
import { matchItems } from '../src/server/lens/gomi/match.ts';
import { ClaudeRecognizer, EMPTY_QUERY, GomiInput, MockRecognizer, RecognizeError, Recognizer, sanitizeQuery } from '../src/server/lens/gomi/recognize.ts';
import { nationalGuard } from '../src/server/lens/gomi/rules.ts';
import { GomiQuery } from '../src/server/lens/gomi/types.ts';
import { MemoryMasterStore } from '../src/server/lens/masterdata/store.ts';
import { CommonClass, GomiItem, SourceConfig } from '../src/server/lens/masterdata/types.ts';

const NOW = new Date('2026-10-28T00:00:00Z');
const CITY = '12345';

function item(name: string, cls: CommonClass, over: Partial<GomiItem> = {}): GomiItem {
  return {
    id: `${CITY}-${name}`, city_code: CITY, name_jp: name, kana: '', local_category: `区分:${cls}`, common_class: cls, note: '',
    source_id: 's1', source_url: 'https://x', source_updated_at: '2026-04-01', fetched_at: NOW.toISOString(),
    license: 'CC-BY-4.0', attribution: 'テスト市 ごみ分別品目一覧', status: 'verified', ...over,
  };
}
const q = (over: Partial<GomiQuery>): GomiQuery => ({ ...EMPTY_QUERY, confidence: 0.9, ...over });

const ROWS: GomiItem[] = [
  item('ペットボトル', 'pet', { kana: 'ぺっとぼとる', note: 'キャップとラベルをはずす' }),
  item('傘', 'sodai', { kana: 'かさ' }),
  item('割り箸', 'burnable', { kana: 'わりばし' }),
  item('かばん(革)', 'burnable', { kana: 'かばん', note: '革製' }),
  item('かばん(布)', 'cloth', { kana: 'かばん', note: '布製' }),
  item('テレビ', 'burnable'), // a wrong city row: national rules must still win
  item('モバイルバッテリー', 'hazardous', { note: '拠点回収' }),
  item('石こうボード', 'not_collected'),
  item('ボタン電池', 'hazardous'),
  item('古い辞書', 'paper', { status: 'retired' }),
];

function setup(over: Partial<GomiDeps> = {}, rows = ROWS) {
  const repo = new MemoryRepo();
  const deps: GomiDeps = { recognizer: new MockRecognizer(), dictionary: { rows: c => (c === CITY ? rows : []) }, repo, now: () => NOW, ...over };
  const ask = (text: string, recognizer?: Recognizer) => answerGomi({ text }, { city_code: CITY }, { ...deps, ...(recognizer ? { recognizer } : {}) });
  return { repo, deps, ask };
}
const fixed = (query: Partial<GomiQuery>): Recognizer => ({ recognize: async () => ({ query: q(query), cost_usd: 0.001 }) });
const body = (a: { messages: Array<Record<string, unknown>> }) => a.messages.map(m => m.text).join('\n');

describe('national guard', () => {
  it.each([
    ['テレビ', 'kaden4'], ['液晶テレビ', 'kaden4'], ['tivi cũ', 'kaden4'], ['tủ lạnh', 'kaden4'], ['máy giặt', 'kaden4'],
    ['エアコン', 'kaden4'], ['điều hòa', 'kaden4'], ['衣類乾燥機', 'kaden4'],
    ['パソコン', 'pc'], ['laptop', 'pc'],
    ['モバイルバッテリー', 'hazard'], ['pin sạc dự phòng', 'hazard'], ['スプレー缶', 'hazard'], ['bật lửa', 'hazard'], ['カセットボンベ', 'hazard'],
  ])('%s → %s', (name, kind) => {
    expect(nationalGuard(q({ name_jp: name }))?.kind).toBe(kind);
    expect(nationalGuard(EMPTY_QUERY, name)?.kind).toBe(kind); // raw user text alone is enough
  });
  // names taken from real city dictionaries (Tokyo/Kanagawa open data)
  it.each([
    'テレビ(液晶、ブラウン管、プラズマ)', 'チューナーレステレビ', '薄型テレビ', '有機ELテレビ', '冷蔵庫・冷凍庫', 'エアコン(室外機)', '室外機(エアコン)', '乾燥機 衣類乾燥機', '乾燥機(衣類用)', '衣類乾燥機',
  ])('real name %s IS an appliance-law item', name => expect(nationalGuard(q({ name_jp: name }))?.kind).toBe('kaden4'));
  it.each([
    'テレビ台', 'テレビ台 幅1m未満', 'テレビスタンド', 'テレビ回転台', 'テレビアンテナ(屋外用)', 'アンテナ(テレビ用)', 'エアコンカバー・室外機カバー', 'エアコンダクトカバー', 'エアコン用窓枠',
    'フィルター(エアコン・空気清浄機等)', '洗濯機台', '洗濯機防水パン', '洗濯機カバー', '戸棚・冷蔵庫の仕切り板', '冷蔵庫用脱臭剤',
    '衣類乾燥機台',
  ])('real name %s is NOT (an accessory)', name => {
    expect(nationalGuard(q({ name_jp: name }))).toBeNull();
    expect(nationalGuard(q({ name_jp: name, appliance: 'washer' }))).toBeNull(); // even if the recognizer over-eagerly says so
  });
  it.each(['ふとん乾燥機', '布団乾燥機', '靴乾燥機', '食器乾燥機', '食器洗い乾燥機', '乾燥機台'])('real name %s is not covered by the law', name => {
    expect(nationalGuard(q({ name_jp: name }))).toBeNull();
  });
  it.each(['テレビ台', 'テレビボード', 'リモコン', 'ペットボトル', '傘'])('%s is not caught', name => {
    expect(nationalGuard(q({ name_jp: name }))).toBeNull();
  });
  it('trusts the recognizer traits even when the name is unhelpful', () => {
    expect(nationalGuard(q({ name_jp: '黒い箱', appliance: 'washer' }))).toEqual({ kind: 'kaden4', appliance: 'washer' });
    expect(nationalGuard(q({ name_jp: '黒い箱', hazard: 'battery' }))).toEqual({ kind: 'hazard', hazard: 'battery' });
    expect(nationalGuard(q({ name_jp: 'テレビ台', appliance: 'tv' }))).toBeNull(); // stand, not a TV
  });
  it('appliance beats PC beats hazard', () => {
    expect(nationalGuard(q({ name_jp: 'テレビ', hazard: 'battery', is_pc: true }))?.kind).toBe('kaden4');
    expect(nationalGuard(q({ name_jp: 'x', hazard: 'battery', is_pc: true }))?.kind).toBe('pc');
  });
});

describe('dictionary matching', () => {
  const m = (name: string, rows = ROWS) => matchItems(rows, q({ name_jp: name }));
  it('exact name, reading (hiragana ↔ katakana) and alt names', () => {
    expect(m('ペットボトル')[0]).toMatchObject({ score: 1 });
    expect(m('ぺっとぼとる')[0].item.name_jp).toBe('ペットボトル'); // reading match
    expect(matchItems(ROWS, q({ name_jp: 'PETボトル', alt_names_jp: ['ペットボトル'] }))[0].item.name_jp).toBe('ペットボトル');
  });
  it('returns all same-reading rows together', () => {
    expect(m('かばん').map(x => x.item.name_jp).sort()).toEqual(['かばん(布)', 'かばん(革)'].sort());
  });
  it('partial overlap is only a loose hint, and unrelated names do not match', () => {
    const [hit] = m('電池');
    expect(hit.item.name_jp).toBe('ボタン電池');
    expect(hit.score).toBeLessThan(0.9);
    expect(m('ピアノ')).toEqual([]);
    expect(m('')).toEqual([]);
  });
  it('a city writes "缶／飲食缶 缶詰の缶": the part before ／ names the thing', () => {
    const rows = [item('缶／飲食缶 缶詰の缶', 'can'), item('缶／菓子の缶', 'can'), item('紙パック／牛乳', 'paper')];
    expect(matchItems(rows, q({ name_jp: '缶' })).map(m => m.item.name_jp).sort()).toEqual(['缶／飲食缶 缶詰の缶', '缶／菓子の缶'].sort());
    expect(matchItems(rows, q({ name_jp: '牛乳' }))[0].item.name_jp).toBe('紙パック／牛乳');
    expect(matchItems(rows, q({ name_jp: '缶' }))[0].score).toBeGreaterThanOrEqual(0.9);
  });
  it('skips retired rows', () => {
    expect(m('古い辞書')).toEqual([]);
  });
});

describe('answerGomi', () => {
  it('asks for the area first', async () => {
    const a = await answerGomi({ text: 'ペットボトル' }, undefined, setup().deps);
    expect(a.outcome).toBe('no_region');
    expect(a.cost_usd).toBe(0);
  });

  it('answers from the dictionary with city label, tips and source/date', async () => {
    const a = await setup().ask('ペットボトル');
    expect(a.outcome).toBe('matched');
    const t = body(a);
    expect(t).toContain('Chai nhựa PET');
    expect(t).toContain('区分:pet');
    expect(t).toContain('キャップとラベルをはずす');
    expect(t).toContain('tháo nắp');
    expect(t).toContain('Nguồn: テスト市 ごみ分別品目一覧, dữ liệu cập nhật 01/04/2026');
    expect(t).not.toContain('Dữ liệu đã cũ');
  });

  it('warns when the data is older than ~13 months', async () => {
    const old = ROWS.map(r => ({ ...r, source_updated_at: '2025-01-01' }));
    expect(body(await setup({}, old).ask('ペットボトル'))).toContain('Dữ liệu đã cũ');
  });

  it('lists every variant when the city splits one name by material', async () => {
    const t = body(await setup().ask('かばん'));
    expect(t).toContain('Tùy loại/chất liệu');
    expect(t).toContain('革製');
    expect(t).toContain('布製');
  });

  it('粗大ごみ: booking-first message, with the city link and fee when known', async () => {
    const withInfo = setup({ cityInfo: () => ({ sodai_booking_url: 'https://city.example/sodai', sodai_phone: '0000-00-0000', sodai_fee_note: '傘: 200円' }) });
    const t = body(await withInfo.ask('傘'));
    expect(t).toMatch(/ĐẶT LỊCH TRƯỚC/);
    expect(t).toContain('https://city.example/sodai');
    expect(t).toContain('傘: 200円');
    const bare = body(await setup().ask('傘'));
    expect(bare).toMatch(/ĐẶT LỊCH TRƯỚC/);
    expect(bare).toMatch(/Xem trang đặt lịch/); // never invents a link
  });

  it('shows the next collection day when the schedule layer provides one', async () => {
    const s = setup({ nextCollection: () => ({ date: '2026-10-30', label: 'Thứ Năm' }) });
    expect(body(await s.ask('割り箸'))).toContain('Thứ Năm (30/10/2026)');
    expect(body(await s.ask('傘'))).not.toContain('Ngày đổ gần nhất'); // 粗大ごみ has no weekly day
  });

  it('not collected: says so', async () => {
    expect(body(await setup().ask('石こうボード'))).toMatch(/KHÔNG thu gom/);
  });

  it('a close-but-not-exact name is flagged as such', async () => {
    const a = await setup().ask('電池');
    // 電池 also trips the national hazard rule, which takes precedence
    expect(a.outcome).toBe('hazard');
    const s = setup();
    const b = await s.ask('割り');
    expect(b.outcome).toBe('similar');
    expect(body(b)).toMatch(/phân loại CHUNG, chưa chắc/); // the generic answer, not the close entry's
    expect(body(b)).toMatch(/Mục gần giống[\s\S]*• 割り箸 → 「区分:burnable」/);
    expect((await s.repo.listUnknownItems(5))[0].name_jp).toBe('割り'); // still a gap in the dictionary
    expect((await setup().ask('ピアノ')).outcome).toBe('fallback');
  });

  it('"ペットボトル" is not answered with the entry "ペットボトルカバー"', async () => {
    const rows = [item('ペットボトルカバー', 'burnable')];
    const s = setup({}, rows);
    const a = await s.ask('ペットボトル', fixed({ name_jp: 'ペットボトル', generic_class: 'pet' }));
    expect(a.outcome).toBe('similar');
    const t = body(a);
    expect(t).toMatch(/Có thể là: Chai nhựa PET/);
    expect(t).toMatch(/có thể KHÔNG phải món bạn hỏi/);
    expect(t).not.toMatch(/^→ Rác cháy được/m);
  });

  it('a name with a bracketed qualifier is found by its head noun ("傘(金属製)" for "傘")', async () => {
    const rows = [item('傘(金属製)', 'sodai'), item('傘(ビニール)', 'burnable')];
    const a = await setup({}, rows).ask('傘');
    expect(a.outcome).toBe('matched');
    expect(body(a)).toMatch(/Tùy loại\/chất liệu/);
  });

  it('家電4品目: national rule wins over a wrong city row, in Japanese and Vietnamese', async () => {
    const s = setup();
    for (const t of ['テレビ', 'tivi', 'máy giặt']) {
      const a = await s.ask(t);
      expect(a.outcome).toBe('kaden4');
      const text = body(a);
      expect(text).toMatch(/KHÔNG bỏ như rác thường/);
      expect(text).toMatch(/家電リサイクル券/);
      expect(text).toMatch(/不用品回収/);
      expect(text).not.toContain('Rác cháy được');
    }
    expect(await s.repo.listUnknownItems(10)).toEqual([]);
  });

  it('hazards: warn clearly, and add the city label when the dictionary has the item', async () => {
    const t = body(await setup().ask('モバイルバッテリー'));
    expect(t).toMatch(/NGUY CƠ CHÁY NỔ/);
    expect(t).toContain('区分:hazardous');
    expect(t).toContain('拠点回収');
    const lighter = body(await setup().ask('ライター'));
    expect(lighter).toMatch(/NGUY CƠ CHÁY NỔ/);
    expect(lighter).toMatch(/làm đúng hướng dẫn của thành phố/);
  });

  it('a city entry that matches exactly and is not "hazardous" gets a safety line instead of an alarm', async () => {
    const rows = [item('ライター', 'non_burnable', { note: '使い切ってから「危険」と表示' }), item('カビ取りスプレー', 'plastic', { note: '中身を使いきって' })];
    const s = setup({}, rows);
    for (const name of ['ライター', 'カビ取りスプレー']) {
      const a = await s.ask(name);
      expect(a.outcome).toBe('matched');
      const t = body(a);
      expect(t).toMatch(/^🔥 Lưu ý an toàn/);
      expect(t).toContain('Thành phố gọi là');
      expect(t).not.toMatch(/NGUY CƠ CHÁY NỔ/);
    }
    expect(body(await s.ask('ライター'))).toContain('使い切ってから「危険」と表示');
    // not an exact entry: the strong warning stays
    expect((await s.ask('スプレー')).outcome).toBe('hazard');
  });

  it('AI traits trigger the guard even if the dictionary has nothing', async () => {
    const a = await setup().ask('x', fixed({ name_jp: '黒い箱', hazard: 'battery' }));
    expect(a.outcome).toBe('hazard');
  });

  it('PC: points to the PC recycling scheme', async () => {
    expect(body(await setup().ask('ノートパソコン'))).toMatch(/PC リサイクル/);
  });

  it('unknown item: generic answer labelled unsure, logged by name + city only', async () => {
    const s = setup();
    const rec = fixed({ name_jp: 'ヨガマット', name_vi: 'thảm tập yoga', generic_class: 'burnable', generic_how_to_vi: 'Cắt nhỏ nếu thành phố yêu cầu.', size_cm_max: 180 });
    const a = await s.ask('thảm yoga', rec);
    expect(a.outcome).toBe('fallback');
    const t = body(a);
    expect(t).toMatch(/chưa chắc/);
    expect(t).toMatch(/kiểm tra lại quy định của thành phố/);
    expect(t).toMatch(/粗大ごみ/); // big item hint
    await s.ask('thảm yoga', rec);
    const log = await s.repo.listUnknownItems(10);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ city_code: CITY, name_jp: 'ヨガマット', name_vi: 'thảm tập yoga', count: 2 });
    expect(Object.keys(log[0]).sort()).toEqual(['city_code', 'count', 'first_seen', 'id', 'last_seen', 'name_jp', 'name_vi']);
  });

  it('a photo that is not an item costs a lookup but logs nothing', async () => {
    const s = setup();
    const a = await answerGomi({ pages: [{ data: Buffer.from('x'), mediaType: 'image/jpeg' }] }, { city_code: CITY }, { ...s.deps, recognizer: fixed({ not_an_item: true }) });
    expect(a.outcome).toBe('not_an_item');
    expect(a.cost_usd).toBe(0.001);
    expect(await s.repo.listUnknownItems(10)).toEqual([]);
  });

  it('a city with no verified data still gives the national rules and a labelled fallback', async () => {
    const empty = setup({}, []);
    expect((await empty.ask('テレビ')).outcome).toBe('kaden4');
    expect((await empty.ask('ペットボトル')).outcome).toBe('fallback');
  });
});

describe('dictionaryFromStore', () => {
  it('serves only published, verified rows', () => {
    const src = { id: 's1', city_code: CITY, kind: 'gomi_items' } as SourceConfig;
    const store = new MemoryMasterStore();
    store.saveStaged('s1', { meta: {} as never, rows: [item('ステージ中', 'burnable', { status: 'draft' })] });
    expect(dictionaryFromStore(store, [src]).rows(CITY)).toEqual([]); // staged ≠ live
    store.setLive('s1', { meta: {} as never, rows: [item('公開済み', 'burnable'), item('下書き', 'burnable', { status: 'draft' })] });
    expect(dictionaryFromStore(store, [src]).rows(CITY).map(r => r.name_jp)).toEqual(['公開済み']);
    expect(dictionaryFromStore(store, [src]).rows('99999')).toEqual([]);
  });
});

describe('recognizers', () => {
  function fake(responses: Record<string, object | Error>) {
    const calls: Array<{ model: string; content: Array<{ type: string }> }> = [];
    const client = {
      beta: { messages: { create: async (p: { model: string; messages: Array<{ content: Array<{ type: string }> }> }) => {
        calls.push({ model: p.model, content: p.messages[0].content });
        const r = responses[p.model];
        if (r instanceof Error) throw r;
        return { stop_reason: 'end_turn', usage: { input_tokens: 1500, output_tokens: 300 }, content: [{ type: 'text', text: JSON.stringify(r) }] };
      } } },
    };
    return { client: client as never, calls };
  }
  const photo: GomiInput = { pages: [{ data: Buffer.from('x'), mediaType: 'image/jpeg' }] };
  const out = (over: Partial<GomiQuery>) => ({ ...EMPTY_QUERY, name_jp: '傘', confidence: 0.9, ...over });

  it('keeps Haiku for a confident photo and prices it (≈ $0.0003)', async () => {
    const { client, calls } = fake({ [HAIKU_MODEL]: out({}) });
    const r = await new ClaudeRecognizer(undefined, client).recognize(photo);
    expect(calls.map(c => c.model)).toEqual([HAIKU_MODEL]);
    expect(r.cost_usd).toBeCloseTo(0.0003, 5);
  });
  it('escalates an unsure photo to Sonnet and sums the cost', async () => {
    const { client, calls } = fake({ [HAIKU_MODEL]: out({ confidence: 0.3 }), [SONNET_MODEL]: out({ name_jp: '折りたたみ傘', confidence: 0.9 }) });
    const r = await new ClaudeRecognizer(undefined, client).recognize(photo);
    expect(calls.map(c => c.model)).toEqual([HAIKU_MODEL, SONNET_MODEL]);
    expect(r.query.name_jp).toBe('折りたたみ傘');
    expect(r.cost_usd).toBeCloseTo(0.0003 + 0.006, 5); // Haiku + Sonnet
  });
  it('never escalates typed text, and keeps the Haiku answer if Sonnet fails', async () => {
    const t = fake({ [HAIKU_MODEL]: out({ confidence: 0.2 }) });
    await new ClaudeRecognizer(undefined, t.client).recognize({ text: 'cái ô' });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].content.every(b => b.type === 'text')).toBe(true);
    const f = fake({ [HAIKU_MODEL]: out({ confidence: 0.2 }), [SONNET_MODEL]: new RecognizeError('boom', 0.002) });
    const r = await new ClaudeRecognizer(undefined, f.client).recognize(photo);
    expect(r.query.confidence).toBe(0.2);
    expect(r.cost_usd).toBeGreaterThan(0.0003);
  });
  it('sanitizes model output', () => {
    const s = sanitizeQuery({ name_jp: ' 傘 ', appliance: 'robot' as never, hazard: 'battery', size_cm_max: -5, confidence: 7, generic_class: 'lava' as never, alt_names_jp: ['', 'かさ'] });
    expect(s).toMatchObject({ name_jp: '傘', appliance: 'none', hazard: 'battery', size_cm_max: 0, confidence: 1, generic_class: 'burnable', alt_names_jp: ['かさ'] });
  });
});
