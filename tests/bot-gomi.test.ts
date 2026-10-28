import { describe, expect, it } from 'vitest';
import { activate, ev, group, lastText, setup, textEv } from './helpers.ts';
import { familyIdForChat } from '../src/server/service.ts';
import { City } from '../src/server/lens/regions.ts';
import { EMPTY_QUERY, GomiInput, Recognizer } from '../src/server/lens/gomi/recognize.ts';
import { GomiItem } from '../src/server/lens/masterdata/types.ts';
import { GomiQuery } from '../src/server/lens/gomi/types.ts';

const CITIES: City[] = [
  { code: '13118', prefecture_jp: '東京都', name_jp: '荒川区', name_vi: 'quận Arakawa (Tokyo)', aliases: ['arakawa'] },
  { code: '14100', prefecture_jp: '神奈川県', name_jp: '横浜市', name_vi: 'thành phố Yokohama', aliases: ['yokohama'] },
  { code: '27103', prefecture_jp: '大阪府', name_jp: '大阪市北区', name_vi: 'quận Kita (Osaka)' },
  { code: '26101', prefecture_jp: '京都府', name_jp: '京都市北区', name_vi: 'quận Kita (Kyoto)' },
];

const row = (name: string, over: Partial<GomiItem> = {}): GomiItem => ({
  id: `13118-${name}`, city_code: '13118', name_jp: name, kana: '', local_category: '燃やすごみ', common_class: 'burnable', note: '',
  source_id: 's', source_url: 'https://x', source_updated_at: '2026-04-01', fetched_at: '2026-10-01T00:00:00Z',
  license: 'CC-BY-4.0', attribution: '荒川区 ごみと資源の分別品目', status: 'verified', ...over,
});
const ROWS = [row('割り箸'), row('ペットボトル', { local_category: ' 資源', common_class: 'pet' })];

/** Recognizer that records calls and answers with a fixed query (cost > 0 so lookups are counted). */
function spyRecognizer(query: Partial<GomiQuery> = {}, cost = 0.001) {
  const calls: GomiInput[] = [];
  const recognizer: Recognizer = {
    recognize: async input => { calls.push(input); return { query: { ...EMPTY_QUERY, name_jp: 'ヨガマット', name_vi: 'thảm yoga', confidence: 0.9, ...query }, cost_usd: cost }; },
  };
  return { recognizer, calls };
}

async function boot(opts: { recognizer?: Recognizer; geocoder?: (lat: number, lng: number) => Promise<{ muniCd: string; town?: string } | null>; lookupQuota?: number } = {}) {
  const spy = spyRecognizer();
  const t = await setup({ lookupQuota: opts.lookupQuota ?? 60 }, {
    cities: CITIES,
    geocoder: opts.geocoder,
    gomi: { recognizer: opts.recognizer ?? spy.recognizer, dictionary: { rows: c => (c === '13118' ? ROWS : []) } },
  });
  await activate(t.bot);
  const say = async (msg: string) => { await t.bot.handleWebhook({ events: [textEv(group(), msg)] }); return lastText(t.line); };
  const fam = () => t.repo.getFamily(familyIdForChat('Cgroup1'));
  const send = (message: object) => t.bot.handleWebhook({ events: [ev(group(), { type: 'message', message: { id: `m${Math.random()}`, ...message } })] });
  const postback = (data: string) => t.bot.handleWebhook({ events: [ev(group(), { type: 'postback', postback: { data } })] });
  const lastQuick = () => {
    const m = t.line.sent[t.line.sent.length - 1].messages.at(-1) as { quickReply?: { items: Array<{ action: Record<string, string> }> } };
    return (m.quickReply?.items ?? []).map(i => i.action);
  };
  return { ...t, spy, say, fam, send, postback, lastQuick };
}

describe('menu and help', () => {
  it('advertises waste sorting and region', async () => {
    const b = await boot();
    const help = await b.say('hướng dẫn');
    expect(help).toMatch(/"rác"/);
    expect(help).toMatch(/"khu vực"/);
    const labels = b.lastQuick().map(a => a.label);
    expect(labels).toEqual(expect.arrayContaining(['🗑️ Phân loại rác', '📍 Khu vực']));
  });
});

describe('region by typing', () => {
  it('sets a known city and says whether it has data', async () => {
    const b = await boot();
    const t = await b.say('khu vực arakawa');
    expect(t).toContain('Đã đặt khu vực: 荒川区');
    expect(t).toContain('2 mục');
    expect(t).toMatch(/không lưu tọa độ/);
    expect((await b.fam())!.region).toMatchObject({ city_code: '13118', via: 'text' });
    expect((await b.say('khu vực yokohama'))).toMatch(/chưa có dữ liệu riêng/);
    expect((await b.fam())!.region!.city_code).toBe('14100');
  });

  it('shows the current region and how to change it', async () => {
    const b = await boot();
    expect(await b.say('khu vực')).toMatch(/Chưa đặt khu vực/);
    expect(b.lastQuick().some(a => a.type === 'location')).toBe(true);
    await b.say('khu vuc 荒川区');
    expect(await b.say('khu vực')).toContain('Khu vực hiện tại: 荒川区');
  });

  it('asks which one when ambiguous', async () => {
    const b = await boot();
    await b.say('khu vực 北区');
    expect(b.lastQuick().map(a => a.label).sort()).toEqual(['京都市北区', '大阪市北区']);
    await b.postback(b.lastQuick()[0].data);
    expect((await b.fam())!.region!.city_code).toBe('27103');
  });

  it('unknown city: explicit opt-in to generic answers, and the demand is logged', async () => {
    const b = await boot();
    const t = await b.say('khu vực Sapporo');
    expect(t).toMatch(/chưa có dữ liệu riêng cho 「Sapporo」/);
    expect((await b.fam())!.region).toBeUndefined(); // a typo never becomes a region by itself
    await b.postback(b.lastQuick()[0].data);
    expect((await b.fam())!.region).toMatchObject({ city_code: 'unsupported', city_name_jp: 'Sapporo' });
    expect((await b.repo.listUnknownItems(10))[0]).toMatchObject({ city_code: 'region', name_jp: 'Sapporo', count: 1 });
  });

  it('ignores a forged postback for a city that is not in the list', async () => {
    const b = await boot();
    await b.postback('action=region_set&c=99999&v=text');
    expect((await b.fam())!.region).toBeUndefined();
  });
});

describe('region from a LINE location', () => {
  const loc = (address: string, extra = {}) => ({ type: 'location', title: 'x', address, latitude: 35.73, longitude: 139.77, ...extra });

  it('suggests the city for confirmation, then stores city + town only', async () => {
    const b = await boot();
    await b.send(loc('日本、〒116-0013 東京都荒川区西日暮里2-3-4'));
    const suggestion = lastText(b.line);
    expect(suggestion).toContain('Có phải bạn ở 荒川区');
    expect(suggestion).toContain('西日暮里');
    expect((await b.fam())!.region).toBeUndefined(); // nothing saved until confirmed
    const yes = b.lastQuick()[0];
    expect(yes.label).toBe('✅ Đúng');
    await b.postback(yes.data);
    const region = (await b.fam())!.region!;
    expect(region).toMatchObject({ city_code: '13118', chome_label: '西日暮里', via: 'location' });
    const stored = JSON.stringify(await b.fam());
    expect(stored).not.toMatch(/2-3-4|116-0013|35\.73|139\.77/); // no number, postcode or coordinates
  });

  it('declining leaves the region alone', async () => {
    const b = await boot();
    await b.send(loc('日本、東京都荒川区西日暮里2-3-4'));
    await b.postback(b.lastQuick()[1].data);
    expect(lastText(b.line)).toMatch(/chưa đổi khu vực/);
    expect((await b.fam())!.region).toBeUndefined();
  });

  it('a city outside the list offers generic answers', async () => {
    const b = await boot();
    await b.send(loc('日本、〒330-0063 埼玉県さいたま市浦和区高砂1-1'));
    expect(lastText(b.line)).toMatch(/chưa có dữ liệu riêng cho 「さいたま市」/);
  });

  it('an unreadable pin explains what to do, without a geocoder it never calls out', async () => {
    const b = await boot();
    await b.send(loc('', { latitude: 35, longitude: 139 }));
    expect(lastText(b.line)).toMatch(/chưa đọc được thành phố/);
  });

  it('falls back to the geocoder (when configured) for a pin with no address', async () => {
    const seen: Array<[number, number]> = [];
    const b = await boot({ geocoder: async (lat, lng) => { seen.push([lat, lng]); return { muniCd: '14109', town: '新横浜二丁目' }; } });
    await b.send(loc('', { latitude: 35.51, longitude: 139.61 }));
    expect(seen).toEqual([[35.51, 139.61]]);
    expect(lastText(b.line)).toContain('Có phải bạn ở 横浜市');
    expect(lastText(b.line)).toContain('新横浜二丁目');
  });

  it('ignores locations from inactive families', async () => {
    const t = await setup({}, { cities: CITIES });
    const before = t.line.sent.length;
    await t.bot.handleWebhook({ events: [ev(group('Cnew'), { type: 'message', message: { id: 'l1', type: 'location', address: '東京都荒川区西日暮里', latitude: 1, longitude: 1 } })] });
    expect(t.line.sent.length).toBe(before);
  });
});

describe('asking about rubbish', () => {
  it('before a region: national rules still answer, anything else asks for the area', async () => {
    const b = await boot();
    expect(await b.say('rác tivi')).toMatch(/KHÔNG bỏ như rác thường/);
    expect(await b.say('rác モバイルバッテリー')).toMatch(/NGUY CƠ CHÁY NỔ/);
    const t = await b.say('rác thảm yoga');
    expect(t).toMatch(/cần biết bạn ở đâu/);
    expect(b.lastQuick().some(a => a.type === 'location')).toBe(true);
    expect((await b.fam())!.lookup_used ?? 0).toBe(0); // no answer given → not counted
  });

  it('answers from the city dictionary; a typed exact name costs nothing and skips the model', async () => {
    const b = await boot();
    await b.say('khu vực 荒川区');
    const t = await b.say('rác 割り箸');
    expect(t).toContain('燃やすごみ');
    expect(t).toContain('Nguồn: 荒川区 ごみと資源の分別品目');
    expect(b.spy.calls).toHaveLength(0);
    expect((await b.fam())!.lookup_used ?? 0).toBe(0);
    expect((await b.repo.getUsage('2026-10')).cost_usd).toBe(0);
  });

  it('an unknown item uses the model, is counted, billed, labelled unsure and logged', async () => {
    const b = await boot();
    await b.say('khu vực 荒川区');
    const t = await b.say('phân loại rác thảm tập yoga');
    expect(t).toMatch(/chưa chắc/);
    expect(b.spy.calls[0]).toEqual({ text: 'thảm tập yoga' });
    expect((await b.fam())!.lookup_used).toBe(1);
    const usage = await b.repo.getUsage(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7));
    expect(usage.cost_usd).toBeCloseTo(0.001);
    expect((await b.repo.listUnknownItems(5)).find(u => u.city_code === '13118')).toMatchObject({ name_jp: 'ヨガマット', count: 1 });
  });

  it('"rác" opens a mode: follow-up text and photos are questions, "hủy" closes it', async () => {
    const b = await boot();
    await b.say('khu vực 荒川区');
    expect(await b.say('rác')).toMatch(/PHÂN LOẠI RÁC/);
    expect(await b.say('ペットボトル')).toContain('Chai nhựa PET'); // plain text, no command word
    b.line.contents.set('p1', { data: Buffer.from('jpg'), contentType: 'image/jpeg' });
    await b.send({ type: 'image', id: 'p1' });
    const photo = b.spy.calls.at(-1)!;
    expect(photo.pages).toHaveLength(1);
    expect(lastText(b.line)).toMatch(/chưa chắc/);
    expect(await b.say('hủy')).toMatch(/Đã tắt chế độ phân loại rác/);
    const before = b.line.sent.length;
    await b.bot.handleWebhook({ events: [textEv(group(), 'Tối nay ăn gì?')] });
    expect(b.line.sent.length).toBe(before); // silent again
  });

  it('a photo in rác mode is answered immediately, not read as a document', async () => {
    const b = await boot();
    await b.say('khu vực 荒川区');
    await b.say('rác');
    b.line.contents.set('p2', { data: Buffer.from('jpg'), contentType: 'image/jpeg' });
    await b.send({ type: 'image', id: 'p2' });
    expect((await b.repo.listDocuments(familyIdForChat('Cgroup1')))).toHaveLength(0);
    expect(b.bot.aggregator.size()).toBe(0);
  });

  it('stops at the monthly lookup quota with its own message, not the paper quota', async () => {
    const b = await boot({ lookupQuota: 2 });
    await b.say('khu vực 荒川区');
    await b.say('rác ヨガ1');
    await b.say('rác ヨガ2');
    const t = await b.say('rác ヨガ3');
    expect(t).toMatch(/hết 2 lượt phân loại rác/);
    expect(b.spy.calls).toHaveLength(2);
    expect(await b.say('rác 割り箸')).toMatch(/hết 2 lượt/); // even free ones: simple, predictable rule
  });

  it('stops when the monthly Claude budget is spent', async () => {
    const b = await boot();
    await b.say('khu vực 荒川区');
    await b.repo.addUsage(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7), { cost_usd: 999 });
    expect(await b.say('rác ヨガ')).toMatch(/hết ngân sách/);
    expect(b.spy.calls).toHaveLength(0);
  });

  it('a model failure is answered kindly and logged', async () => {
    const failing: Recognizer = { recognize: async () => { throw new Error('boom'); } };
    const b = await boot({ recognizer: failing });
    await b.say('khu vực 荒川区');
    expect(await b.say('rác thảm yoga')).toMatch(/Chưa tra được/);
    expect((await b.repo.listErrors(5))[0].error_type).toBe('GOMI_LOOKUP');
  });
});

describe('data deletion', () => {
  it('"xóa dữ liệu" removes the region too', async () => {
    const b = await boot();
    await b.say('khu vực 荒川区');
    await b.say('xóa dữ liệu');
    await b.say('xác nhận xóa dữ liệu');
    expect((await b.fam())!.region).toBeUndefined();
  });
});
