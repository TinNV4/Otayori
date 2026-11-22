import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HAIKU_MODEL, SONNET_MODEL } from '../src/server/extract.ts';
import { MemoryRepo } from '../src/server/db/memory.ts';
import { EXPIRY_CARD, DRAFT_NOTICE, expiryLines } from '../src/server/lens/grocery/compose.ts';
import { answerGrocery } from '../src/server/lens/grocery/core.ts';
import { checkGrocery, loadGrocery, reviewStats } from '../src/server/lens/grocery/data.ts';
import { ClaudeLabelRecognizer, EMPTY_LABEL, LabelError, LabelRecognizer, sanitizeLabel } from '../src/server/lens/grocery/recognize.ts';
import { findMentions, foldVi } from '../src/server/lens/grocery/text.ts';
import { GroceryData, LabelQuery } from '../src/server/lens/grocery/types.ts';
import { activate, ev, group, lastText, setup, textEv } from './helpers.ts';
import { familyIdForChat } from '../src/server/service.ts';

const DATA = loadGrocery('data/grocery');
const NOW = new Date('2026-10-28T00:00:00Z');
const body = (a: { messages: Array<Record<string, unknown>> }) => a.messages.map(m => m.text).join('\n');
const verified = (d: GroceryData): GroceryData => {
  const v = <T extends { status: string }>(rows: T[]) => rows.map(r => ({ ...r, status: 'verified', verified_by: 'tester', verified_at: NOW.toISOString() }));
  return { ingredients: v(d.ingredients), dishes: v(d.dishes), substitutes: v(d.substitutes) } as GroceryData;
};

describe('shipped tables (data/grocery)', () => {
  it('are consistent and cover the MVP scope: 20 dishes, ~100 ingredients', () => {
    expect(checkGrocery(DATA)).toEqual([]);
    expect(DATA.dishes).toHaveLength(20);
    expect(DATA.ingredients.length).toBeGreaterThanOrEqual(100);
    expect(DATA.substitutes.length).toBeGreaterThanOrEqual(30);
  });
  it('every row says who made it; verified rows say who checked', () => {
    for (const r of [...DATA.ingredients, ...DATA.dishes, ...DATA.substitutes]) {
      expect(r.source).toBeTruthy();
      if (r.status === 'verified') expect(r.verified_by && r.verified_at).toBeTruthy();
    }
    expect(reviewStats(DATA).dishes.total).toBe(20);
  });
  it('every dish has ingredients you actually shop for, and every non-supermarket staple of a dish has a way out', () => {
    for (const d of DATA.dishes) {
      expect(d.ingredients.filter(l => !DATA.ingredients.find(i => i.id === l.id)!.pantry).length).toBeGreaterThan(4);
    }
  });
  it('flags integrity problems', () => {
    const bad = structuredClone(DATA);
    bad.dishes[0].ingredients.push({ id: 'khong-co', role: 'main' });
    bad.ingredients[1].aliases_vi.push(bad.ingredients[0].vi);
    bad.substitutes[0].options[0].similarity = 'perfect' as never;
    bad.ingredients[2].status = 'verified';
    const issues = checkGrocery(bad).join('\n');
    expect(issues).toMatch(/unknown ingredient "khong-co"/);
    expect(issues).toMatch(/alias .* is also used by/);
    expect(issues).toMatch(/bad similarity/);
    expect(issues).toMatch(/verified rows need verified_by/);
  });
});

describe('matching free text', () => {
  const dishes = DATA.dishes;
  const names = (text: string) => findMentions(text, dishes, d => [d.vi, ...d.aliases_vi, d.jp]).map(m => m.item.id);
  it('foldVi', () => expect(foldVi('Phở Bò, đậu hũ!')).toBe('pho bo dau hu'));
  it('a specific dish beats the generic word it contains; the generic word alone gives all', () => {
    expect(names('phở bò')).toEqual(['pho-bo']);
    expect(names('pho ga')).toEqual(['pho-ga']);
    expect(names('phở').sort()).toEqual(['pho-bo', 'pho-ga']);
    expect(names('muốn nấu phở bò và phở gà').sort()).toEqual(['pho-bo', 'pho-ga']);
  });
  it('several dishes, with or without diacritics, and Japanese names', () => {
    expect(names('bún bò, canh chua, bánh xèo').sort()).toEqual(['banh-xeo', 'bun-bo-hue', 'canh-chua-ca']);
    expect(names('toi muon nau bun bo hue').sort()).toEqual(['bun-bo-hue']);
    expect(names('フォー・ボー')).toEqual(['pho-bo']);
    expect(names('hôm nay trời đẹp')).toEqual([]);
  });
  it('"tôi" (I) is not "tỏi" (garlic), and "mẹ" is not tamarind', () => {
    const ing = (t: string) => findMentions(t, DATA.ingredients, i => [i.vi, ...i.aliases_vi, i.jp, ...i.jp_alt]).map(m => m.item.id);
    expect(ing('tôi muốn thay rau răm')).toEqual(['rau-ram']);
    expect(ing('mẹ tôi không có húng quế')).toEqual(['hung-que']);
    expect(ing('mua tỏi')).toContain('toi');
    expect(ing('mua toi')).not.toContain('toi'); // typed without diacritics, a one-word collision is skipped
    expect(ing('rau ram')).toEqual(['rau-ram']);
    expect(ing('パクチー')).toEqual(['rau-mui']);
  });
});

describe('answerGrocery (typed questions: no model)', () => {
  const ask = (text: string, over: Partial<Parameters<typeof answerGrocery>[1]> = {}) => answerGrocery({ text }, { data: DATA, now: () => NOW, ...over });

  it('a dish: shopping list grouped by where to buy, with exits for hard-to-find items', async () => {
    const a = await ask('phở bò');
    expect(a.outcome).toBe('dish');
    expect(a.cost_usd).toBe(0);
    const t = body(a);
    expect(t).toMatch(/🛒 Siêu thị thường[\s\S]*thịt bò — 牛肉/);
    expect(t).toMatch(/🏪 Tiệm đồ châu Á[\s\S]*bánh phở — フォー\(乾麺\) \(thay: /);
    expect(t).toMatch(/🧂 Gia vị cơ bản[^\n]*muối/);
    expect(t).not.toMatch(/• muối/); // pantry items aren't shopping
    expect(t).toContain(DRAFT_NOTICE);
  });
  it('several dishes merge into one list without repeats', async () => {
    const t = body(await ask('bún bò Huế và canh chua'));
    expect(t).toContain('bún bò Huế');
    expect(t).toContain('canh chua cá');
    expect((t.match(/• nước mắm/g) || []).length).toBe(1);
    expect((t.match(/• me chua/g) || []).length).toBe(1);
  });
  it('substitutes: by intent words, with similarity and a reminder that the taste differs', async () => {
    for (const q of ['thay rau răm', 'không có rau răm', 'hết rau ram rồi dùng gì']) {
      const a = await ask(q);
      expect(a.outcome).toBe('substitute');
      expect(body(a)).toMatch(/Thay rau răm[\s\S]*húng lủi[\s\S]*khá gần/);
      expect(body(a)).toMatch(/không giống hệt/);
    }
  });
  it('an ingredient: Japanese name, where, storage, dishes, exits', async () => {
    const t = body(await ask('húng quế'));
    expect(t).toMatch(/タイバジル/);
    expect(t).toMatch(/Nơi bán: 🏪 Tiệm đồ châu Á/);
    expect(t).toMatch(/Dùng trong:.*phở bò/);
    expect(t).toMatch(/thay bằng:[\s\S]*basil/);
  });
  it('no draft warning once an admin verified the rows it relies on', async () => {
    expect(body(await ask('phở bò', { data: verified(DATA) }))).not.toContain(DRAFT_NOTICE);
  });
  it('empty text → help; unknown → list of dishes, and the question is counted (text only)', async () => {
    expect((await ask('')).outcome).toBe('help');
    const repo = new MemoryRepo();
    const a = await ask('pizza hải sản', { repo });
    expect(a.outcome).toBe('unknown');
    expect(body(a)).toContain('phở bò');
    await ask('pizza hải sản', { repo });
    expect(await repo.listUnknownItems(5)).toEqual([expect.objectContaining({ city_code: 'grocery', name_jp: 'pizza hải sản', count: 2 })]);
    await ask('phở bò', { repo });
    expect((await repo.listUnknownItems(5))).toHaveLength(1); // a hit is not logged
  });
  it('an ingredient with no substitute says so and logs the gap', async () => {
    const repo = new MemoryRepo();
    const a = await ask('thay tỏi', { repo });
    expect(body(a)).toMatch(/chưa có gợi ý thay thế/);
    expect((await repo.listUnknownItems(5))[0].name_jp).toBe('thay tỏi');
  });
});

const label = (over: Partial<LabelQuery> = {}): LabelQuery => ({ ...EMPTY_LABEL, product_name_jp: 'ヌクマム', product_name_vi: 'nước mắm', category_vi: 'nước mắm', ingredient_vi: 'nước mắm', confidence: 0.9, ...over });
const reads = (q: LabelQuery, cost = 0.0004): LabelRecognizer => ({ recognize: async () => ({ query: q, cost_usd: cost }) });
const PHOTO = [{ data: Buffer.from('x'), mediaType: 'image/jpeg' }];
const scan = (q: LabelQuery) => answerGrocery({ pages: PHOTO }, { data: DATA, recognizer: reads(q), now: () => NOW });

describe('label reading', () => {
  it('copies the allergen line verbatim, never judges, and always adds the explanation card', async () => {
    const a = await scan(label({ allergens_text_jp: '一部に小麦・大豆を含む', allergens_vi: 'Có chứa lúa mì, đậu nành', expiry_type: 'shomi', expiry_date: '2027-03-01' }));
    expect(a.outcome).toBe('label');
    const t = body(a);
    expect(t).toContain('「一部に小麦・大豆を含む」');
    expect(t).toMatch(/AI dịch, có thể sai/);
    expect(t).toMatch(/tự đọc lại nhãn gốc/);
    expect(t).toContain(EXPIRY_CARD);
    expect(a.cost_usd).toBe(0.0004);
  });
  it('NEVER says a product is safe for the user or free of allergens — in any answer', async () => {
    const forbidden = /an toàn với bạn|không chứa|không có chất gây dị ứng|safe for you|allergen[- ]free|hợp với bạn/i;
    const answers = [
      await scan(label({ allergens_text_jp: '卵・乳を含む' })),
      await scan(label({ allergens_text_jp: '' })),
      await scan(label({ expiry_type: 'shomi', expiry_date: '2026-01-01' })),
      await answerGrocery({ text: 'phở bò' }, { data: DATA }),
      await answerGrocery({ text: 'thay đậu phộng' }, { data: DATA }),
      await answerGrocery({ text: 'đậu phộng' }, { data: DATA }),
    ];
    for (const a of answers) expect(body(a)).not.toMatch(forbidden);
  });
  it('no allergen line visible: says so, and still tells them to check', async () => {
    const t = body(await scan(label({ allergens_text_jp: '' })));
    expect(t).toMatch(/không đọc thấy mục dị ứng/);
    expect(t).toMatch(/tự đọc lại nhãn gốc/);
  });
  it('uses the tables when the product is a known ingredient, and flags AI suggestions otherwise', async () => {
    const known = body(await scan(label({ ingredient_vi: 'nước mắm' })));
    expect(known).toMatch(/Dùng nấu:.*phở bò/);
    expect(known).toMatch(/Thông thường với nước mắm/);
    const unknown = body(await scan(label({ ingredient_vi: '', suggested_uses_vi: ['ăn kèm cơm'], product_name_jp: '梅干し' })));
    expect(unknown).toMatch(/Gợi ý \(AI, tham khảo\): ăn kèm cơm/);
  });
  it('shows the storage text as printed, translated by AI', async () => {
    const t = body(await scan(label({ storage_text_jp: '直射日光を避け、常温で保存', storage_vi: 'Tránh nắng, bảo quản nhiệt độ thường' })));
    expect(t).toContain('「直射日光を避け、常温で保存」');
    expect(t).toMatch(/AI dịch/);
  });
  it('medicine: refuses and sends them to a pharmacist, without reading anything about it', async () => {
    for (const q of [label({ is_medicine: true, product_name_jp: 'ロキソニンS', category_vi: 'thuốc giảm đau' }), label({ product_name_jp: '第2類医薬品 ◯◯錠', category_vi: 'viên' })]) {
      const a = await scan(q);
      expect(a.outcome).toBe('medicine');
      expect(body(a)).toMatch(/薬剤師/);
      expect(body(a)).not.toMatch(/liều dùng:|mỗi ngày|viên\/ngày/);
    }
  });
  it('not a label → ask again', async () => {
    expect((await scan(label({ not_a_food_label: true }))).outcome).toBe('not_a_label');
  });
  it('without a recognizer a photo cannot be read', async () => {
    expect((await answerGrocery({ pages: PHOTO }, { data: DATA })).outcome).toBe('unknown');
  });
});

describe('expiry wording', () => {
  const t = (type: LabelQuery['expiry_type'], date: string, extra: Partial<LabelQuery> = {}) => expiryLines(label({ expiry_type: type, expiry_date: date, ...extra }), '2026-10-28').join('\n');
  it('消費期限: expired = do not eat; today = last day; future = days left', () => {
    expect(t('shohi', '2026-10-25')).toMatch(/Đã quá hạn 3 ngày[\s\S]*đừng ăn/);
    expect(t('shohi', '2026-10-28')).toMatch(/Hôm nay là ngày cuối/);
    expect(t('shohi', '2026-10-31')).toMatch(/Còn 3 ngày/);
  });
  it('賞味期限: expired is "best before", never declared fine to eat', () => {
    const s = t('shomi', '2026-10-01');
    expect(s).toMatch(/không phải hạn an toàn/);
    expect(s).toMatch(/không thể nói món này còn ăn được hay không/);
    expect(s).not.toMatch(/vẫn ăn được|còn ăn tốt|có thể ăn/);
    expect(t('shomi', '2027-01-01')).toMatch(/Còn \d+ ngày/);
  });
  it('unknown type, unreadable or uncertain date', () => {
    expect(t('unknown', '2026-12-01')).toMatch(/chưa biết đây là 賞味期限 hay 消費期限/);
    expect(t('shomi', '')).toMatch(/không đọc được ngày/);
    expect(t('shomi', '2027-03-31', { expiry_uncertain: true })).toMatch(/ngày chưa chắc/);
  });
});

describe('label recognizer', () => {
  function fake(responses: Record<string, object | Error>) {
    const calls: string[] = [];
    const client = { beta: { messages: { create: async (p: { model: string }) => {
      calls.push(p.model);
      const r = responses[p.model];
      if (r instanceof Error) throw r;
      return { stop_reason: 'end_turn', usage: { input_tokens: 1500, output_tokens: 400 }, content: [{ type: 'text', text: JSON.stringify(r) }] };
    } } } };
    return { client: client as never, calls };
  }
  it('Haiku for a clear label; Sonnet when unsure, costs add up; Haiku result kept if Sonnet fails', async () => {
    const a = fake({ [HAIKU_MODEL]: label() });
    const r1 = await new ClaudeLabelRecognizer(undefined, a.client).recognize(PHOTO, { today: '2026-10-28' });
    expect(a.calls).toEqual([HAIKU_MODEL]);
    expect(r1.cost_usd).toBeCloseTo(0.00035, 5);
    const b = fake({ [HAIKU_MODEL]: label({ confidence: 0.3 }), [SONNET_MODEL]: label({ product_name_jp: 'しょうゆ' }) });
    const r2 = await new ClaudeLabelRecognizer(undefined, b.client).recognize(PHOTO, { today: '2026-10-28' });
    expect(b.calls).toEqual([HAIKU_MODEL, SONNET_MODEL]);
    expect(r2.query.product_name_jp).toBe('しょうゆ');
    const c = fake({ [HAIKU_MODEL]: label({ confidence: 0.3 }), [SONNET_MODEL]: new LabelError('boom', 0.002) });
    const r3 = await new ClaudeLabelRecognizer(undefined, c.client).recognize(PHOTO, { today: '2026-10-28' });
    expect(r3.query.confidence).toBe(0.3);
  });
  it('sanitizes: impossible dates become "unknown + uncertain", unknown enums fall back', () => {
    const s = sanitizeLabel({ expiry_date: '2026-02-30', expiry_type: 'x' as never, confidence: 9, suggested_uses_vi: ['a', 'b', 'c', 'd'] });
    expect(s).toMatchObject({ expiry_date: '', expiry_uncertain: true, expiry_type: 'unknown', confidence: 1 });
    expect(s.suggested_uses_vi).toHaveLength(3);
  });
});

describe('curation CLI (scripts/grocery.ts)', () => {
  const run = (dir: string, ...args: string[]) => {
    try {
      return { out: execFileSync('npx', ['tsx', 'scripts/grocery.ts', ...args], { env: { ...process.env, GROCERY_DIR: dir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; status?: number };
      return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 };
    }
  };
  it('verify records who and when; --by is mandatory; check catches broken data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocery-'));
    for (const f of fs.readdirSync('data/grocery')) fs.copyFileSync(path.join('data/grocery', f), path.join(dir, f));
    expect(run(dir, 'verify', 'rau-ram', '--table', 'substitutes').code).toBe(1); // no --by
    const r = run(dir, 'verify', 'rau-ram', '--table', 'substitutes', '--by', 'tester');
    expect(r.out).toMatch(/Verified 1 row\(s\) in substitutes as tester/);
    const subs = JSON.parse(fs.readFileSync(path.join(dir, 'substitutes.json'), 'utf8'));
    expect(subs.find((s: { from: string }) => s.from === 'rau-ram')).toMatchObject({ status: 'verified', verified_by: 'tester' });
    expect(run(dir, 'verify', 'khong-co', '--table', 'substitutes', '--by', 'tester').out).toMatch(/no such id/);
    expect(run(dir, 'check').out).toMatch(/substitutes\s+█+░*\s+1\/43/);
    expect(run(dir, 'ask', 'phở bò').out).toMatch(/outcome=dish/);

    const dishes = JSON.parse(fs.readFileSync(path.join(dir, 'dishes.json'), 'utf8'));
    dishes[0].ingredients.push({ id: 'khong-co', role: 'main' });
    fs.writeFileSync(path.join(dir, 'dishes.json'), JSON.stringify(dishes));
    const bad = run(dir, 'check');
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/unknown ingredient "khong-co"/);
  }, 60_000);
});

describe('bot: đi chợ', () => {
  function spy(q: Partial<LabelQuery> = {}, cost = 0.0004) {
    const photos: number[] = [];
    const recognizer: LabelRecognizer = { recognize: async pages => { photos.push(pages.length); return { query: label(q), cost_usd: cost }; } };
    return { recognizer, photos };
  }
  async function boot(over: Partial<ReturnType<typeof spy>> = {}) {
    const s = { ...spy(), ...over };
    const t = await setup({}, { grocery: { data: DATA, recognizer: s.recognizer } });
    await activate(t.bot);
    const say = async (m: string) => { await t.bot.handleWebhook({ events: [textEv(group(), m)] }); return lastText(t.line); };
    const fam = () => t.repo.getFamily(familyIdForChat('Cgroup1'));
    return { ...t, ...s, say, fam };
  }

  it('one-shot question without opening the mode; free (no model, no quota)', async () => {
    const b = await boot();
    const t = await b.say('đi chợ phở bò');
    expect(t).toContain('🍜 phở bò');
    expect((await b.fam())!.lookup_used ?? 0).toBe(0);
    expect(b.photos).toHaveLength(0);
    expect(await b.say('/chợ thay rau răm')).toMatch(/Thay rau răm/);
  });
  it('"đi chợ" opens a mode: follow-ups are questions, photos are labels (counted and billed), "hủy" closes it', async () => {
    const b = await boot();
    expect(await b.say('đi chợ')).toMatch(/ĐI CHỢ NHẬT/);
    expect(await b.say('bún chả')).toContain('bún chả');
    b.line.contents.set('lab1', { data: Buffer.from('jpg'), contentType: 'image/jpeg' });
    await b.bot.handleWebhook({ events: [ev(group(), { type: 'message', message: { id: 'lab1', type: 'image' } })] });
    expect(b.photos).toEqual([1]);
    expect(lastText(b.line)).toContain(EXPIRY_CARD);
    expect((await b.fam())!.lookup_used).toBe(1);
    expect(await b.repo.getUsage(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7))).toMatchObject({ cost_usd: expect.closeTo(0.0004, 6) });
    expect((await b.repo.listDocuments(familyIdForChat('Cgroup1')))).toHaveLength(0); // not read as a paper
    expect(await b.say('hủy')).toMatch(/Đã tắt chế độ đi chợ/);
    const before = b.line.sent.length;
    await b.bot.handleWebhook({ events: [textEv(group(), 'Tối nay ăn phở bò nhé')] });
    expect(b.line.sent.length).toBe(before); // silent again
  });
  it('plain chat about "chợ" or "cho" does not trigger the bot; only "đi chợ" and "/chợ"', async () => {
    const b = await boot();
    const before = b.line.sent.length;
    await b.bot.handleWebhook({ events: [textEv(group(), 'cho mình hỏi tí'), textEv(group(), 'chợ hôm nay đông quá'), textEv(group(), 'nấu phở đi')] });
    expect(b.line.sent.length).toBe(before);
  });
  it('shares the lookup quota with rác for photos and stops at the limit', async () => {
    const t = await setup({ lookupQuota: 1 }, { grocery: { data: DATA, recognizer: spy().recognizer } });
    await activate(t.bot);
    await t.bot.handleWebhook({ events: [textEv(group(), 'đi chợ')] });
    for (const id of ['a', 'b']) {
      t.line.contents.set(id, { data: Buffer.from('x'), contentType: 'image/jpeg' });
      await t.bot.handleWebhook({ events: [ev(group(), { type: 'message', message: { id, type: 'image' } })] });
    }
    expect(lastText(t.line)).toMatch(/hết 1 lượt tra cứu/);
  });
  it('starting "rác" ends "đi chợ" and vice versa; a failing label read is answered kindly', async () => {
    const failing: LabelRecognizer = { recognize: async () => { throw new Error('boom'); } };
    const b = await boot({ recognizer: failing });
    await b.say('đi chợ');
    await b.say('rác');
    expect(await b.say('phở bò')).not.toContain('🍜'); // now a rubbish question
    await b.say('đi chợ');
    b.line.contents.set('lab2', { data: Buffer.from('x'), contentType: 'image/jpeg' });
    await b.bot.handleWebhook({ events: [ev(group(), { type: 'message', message: { id: 'lab2', type: 'image' } })] });
    expect(lastText(b.line)).toMatch(/Chưa đọc được nhãn/);
    expect((await b.repo.listErrors(3))[0].error_type).toBe('GROCERY_LABEL');
  });
  it('menu and help advertise it', async () => {
    const b = await boot();
    expect(await b.say('hướng dẫn')).toMatch(/"đi chợ"/);
    const quick = (b.line.sent.at(-1)!.messages.at(-1) as unknown as { quickReply: { items: Array<{ action: { label: string } }> } }).quickReply.items.map(i => i.action.label);
    expect(quick).toContain('🛒 Đi chợ');
  });
});
