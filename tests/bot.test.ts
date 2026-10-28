import { describe, expect, it } from 'vitest';
import { activate, ev, group, lastText, setup, textEv } from './helpers.ts';
import { familyIdForChat } from '../src/server/service.ts';
import { formatTranslation } from '../src/server/bot.ts';
import { jstMonth } from '../src/server/time.ts';

const image = (source: object, id: string, imageSet?: object) =>
  ev(source, { type: 'message', message: { id, type: 'image', imageSet } });

describe('onboarding', () => {
  it('join → consent → invite activates the family', async () => {
    const { bot, repo, line } = await setup();
    await bot.handleWebhook({ events: [ev(group(), { type: 'join' })] });
    expect(lastText(line)).toContain('Đồng ý');
    await bot.handleWebhook({ events: [textEv(group(), 'BETA2026')] });
    expect(lastText(line)).toContain('Đồng ý'); // must consent first
    await bot.handleWebhook({ events: [textEv(group(), 'Đồng ý điều khoản')] });
    await bot.handleWebhook({ events: [textEv(group(), 'mã mời: beta2026')] });
    expect(lastText(line)).toContain('Kích hoạt thành công');
    const fam = await repo.getFamily(familyIdForChat('Cgroup1'));
    expect(fam?.status).toBe('active');
    expect(fam?.member_user_ids).toContain('Uuser1');
    expect((await repo.getInviteCode('BETA2026'))?.used_count).toBe(1);
  });

  it('rejects wrong codes and enforces the beta family cap', async () => {
    const { bot, line } = await setup({ maxBetaFamilies: 1 });
    await activate(bot, group('Cg1'));
    await bot.handleWebhook({ events: [ev(group('Cg2'), { type: 'join' }), textEv(group('Cg2'), 'Đồng ý')] });
    await bot.handleWebhook({ events: [textEv(group('Cg2'), 'WRONG1')] });
    expect(lastText(line)).toContain('không đúng');
    await bot.handleWebhook({ events: [textEv(group('Cg2'), 'BETA2026')] });
    expect(lastText(line)).toContain('đủ 1 gia đình');
  });

  it('stays silent on normal group chatter once active', async () => {
    const { bot, line } = await setup();
    await activate(bot);
    const before = line.sent.length;
    await bot.handleWebhook({ events: [textEv(group(), 'Tối nay ăn gì?'), textEv(group(), 'HELLO')] });
    expect(line.sent.length).toBe(before);
  });

  it('deduplicates redelivered webhook events', async () => {
    const { bot, line } = await setup();
    const e = ev(group(), { type: 'join' });
    await bot.handleWebhook({ events: [e] });
    await bot.handleWebhook({ events: [e] });
    expect(line.sent.length).toBe(1);
  });
});

describe('document intake', () => {
  it('reads an image, stores it, replies with quick replies and counts quota + cost', async () => {
    const { bot, repo, line } = await setup();
    await activate(bot);
    line.contents.set('img1', { data: Buffer.from('jpg'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group(), 'img1')] });
    await bot.aggregator.flushAll();

    const fid = familyIdForChat('Cgroup1');
    const docs = await repo.listDocuments(fid);
    expect(docs).toHaveLength(1);
    const reply = line.sent[line.sent.length - 1];
    expect(reply.kind).toBe('reply');
    expect(lastText(line)).toContain('Cần làm');
    expect(lastText(line)).toContain('/cal/'); // first doc → add-to-calendar page link included
    expect(JSON.stringify(reply.messages[reply.messages.length - 1].quickReply)).toContain('action=fb');
    expect((await repo.getFamily(fid))?.quota_used).toBe(1);
    expect((await repo.getUsage(jstMonth())).cost_usd).toBeGreaterThan(0);
  });

  it('groups an imageSet into one multi-page document', async () => {
    const { bot, repo, line } = await setup({ aggregationWindowMs: 10_000 });
    await activate(bot);
    for (const id of ['p1', 'p2', 'p3']) line.contents.set(id, { data: Buffer.from(id), contentType: 'image/jpeg' });
    await bot.handleWebhook({
      events: [1, 2, 3].map(i => image(group(), `p${i}`, { id: 'set1', index: i, total: 3 })),
    });
    await new Promise(r => setTimeout(r, 30)); // completes without waiting for the 10s window
    const docs = await repo.listDocuments(familyIdForChat('Cgroup1'));
    expect(docs).toHaveLength(1);
    expect(docs[0].pages_count).toBe(3);
  });

  it('refuses images from inactive families and over-quota families', async () => {
    const { bot, repo, line } = await setup();
    await bot.handleWebhook({ events: [ev(group(), { type: 'join' }), textEv(group(), 'Đồng ý')] });
    line.contents.set('x', { data: Buffer.from('x'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group(), 'x')] });
    expect(lastText(line)).toContain('chưa kích hoạt');

    await bot.handleWebhook({ events: [textEv(group(), 'BETA2026')] });
    const fam = (await repo.getFamily(familyIdForChat('Cgroup1')))!;
    fam.quota_used = fam.quota_limit;
    await repo.saveFamily(fam);
    await bot.handleWebhook({ events: [image(group(), 'x')] });
    expect(lastText(line)).toContain('hết');
  });

  it('stops when the monthly budget is spent', async () => {
    const { bot, repo, line, cfg } = await setup();
    await activate(bot);
    await repo.addUsage(jstMonth(), { cost_usd: cfg.monthlyBudgetUsd });
    line.contents.set('x', { data: Buffer.from('x'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group(), 'x')] });
    expect(lastText(line)).toContain('ngân sách');
  });

  it('falls back to push when the reply token has expired', async () => {
    const { bot, repo, line } = await setup();
    await activate(bot);
    line.replyOk = false;
    line.contents.set('x', { data: Buffer.from('x'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group(), 'x')] });
    await bot.aggregator.flushAll();
    expect(line.sent[line.sent.length - 1].kind).toBe('push');
    expect((await repo.getUsage(jstMonth())).push_messages).toBe(1);
  });

  it('records 👍/👎 feedback from postbacks', async () => {
    const { bot, repo, line } = await setup();
    await activate(bot);
    line.contents.set('x', { data: Buffer.from('x'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group(), 'x')] });
    await bot.aggregator.flushAll();
    const fid = familyIdForChat('Cgroup1');
    const [doc] = await repo.listDocuments(fid);
    await bot.handleWebhook({ events: [ev(group(), { type: 'postback', postback: { data: `action=fb&doc=${doc.id}&v=down` } })] });
    expect((await repo.getDocument(fid, doc.id))?.feedback).toBe('down');
  });
});

describe('privacy', () => {
  it('isolates families: another chat cannot touch a document by id', async () => {
    const { bot, repo, line } = await setup();
    await activate(bot, group('CA'));
    await activate(bot, group('CB', 'Ub'));
    line.contents.set('x', { data: Buffer.from('x'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group('CA'), 'x')] });
    await bot.aggregator.flushAll();
    const [docA] = await repo.listDocuments(familyIdForChat('CA'));
    expect(await repo.listDocuments(familyIdForChat('CB'))).toHaveLength(0);
    expect(await repo.getDocument(familyIdForChat('CB'), docA.id)).toBeNull();
    await bot.handleWebhook({ events: [ev(group('CB', 'Ub'), { type: 'postback', postback: { data: `action=fb&doc=${docA.id}&v=down` } })] });
    expect((await repo.getDocument(familyIdForChat('CA'), docA.id))?.feedback).toBeNull();
  });

  it('"xóa dữ liệu" requires confirmation, purges docs and rotates the ICS token', async () => {
    const { bot, repo, line } = await setup();
    await activate(bot);
    line.contents.set('x', { data: Buffer.from('x'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group(), 'x')] });
    await bot.aggregator.flushAll();
    const fid = familyIdForChat('Cgroup1');
    const oldToken = (await repo.getFamily(fid))!.ics_token;

    await bot.handleWebhook({ events: [textEv(group(), 'xóa dữ liệu')] });
    expect(await repo.listDocuments(fid)).toHaveLength(1);
    await bot.handleWebhook({ events: [ev(group(), { type: 'postback', postback: { data: 'action=delete_confirm' } })] });
    expect(await repo.listDocuments(fid)).toHaveLength(0);
    const fam = (await repo.getFamily(fid))!;
    expect(fam.ics_token).not.toBe(oldToken);
    expect(fam.status).toBe('pending_terms');
    expect(await repo.getFamilyByIcsToken(oldToken)).toBeNull();
  });

  it('purges a family 7 days after the bot is removed', async () => {
    const { bot, repo } = await setup();
    await activate(bot);
    await bot.handleWebhook({ events: [ev(group(), { type: 'leave' })] });
    const fid = familyIdForChat('Cgroup1');
    expect((await repo.getFamily(fid))?.status).toBe('left');
    await bot.services.runCleanup(new Date(Date.now() + 6 * 86400_000));
    expect(await repo.getFamily(fid)).not.toBeNull();
    await bot.services.runCleanup(new Date(Date.now() + 8 * 86400_000));
    expect(await repo.getFamily(fid)).toBeNull();
  });
});

describe('duplicates (several family members send the same paper)', () => {
  it('same photo twice → answered from storage, no extra doc/quota/cost', async () => {
    const { bot, repo, line } = await setup();
    await activate(bot);
    line.contents.set('a', { data: Buffer.from('same-bytes'), contentType: 'image/jpeg' });
    line.contents.set('b', { data: Buffer.from('same-bytes'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group(), 'a')] });
    await bot.aggregator.flushAll();
    const cost1 = (await repo.getUsage(jstMonth())).cost_usd;
    await bot.handleWebhook({ events: [image(group('Cgroup1', 'Uother'), 'b')] });
    await bot.aggregator.flushAll();
    const fid = familyIdForChat('Cgroup1');
    expect(await repo.listDocuments(fid)).toHaveLength(1);
    expect((await repo.getFamily(fid))?.quota_used).toBe(1);
    expect((await repo.getUsage(jstMonth())).cost_usd).toBe(cost1);
    expect(lastText(line)).toContain('đã được đọc');
  });

  it('different photo of the same paper → recognised after reading, merged, quota not charged', async () => {
    const { bot, repo, line } = await setup();
    await activate(bot);
    line.contents.set('a', { data: Buffer.from('photo-1'), contentType: 'image/jpeg' });
    line.contents.set('b', { data: Buffer.from('photo-2'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group(), 'a')] });
    await bot.aggregator.flushAll();
    await bot.handleWebhook({ events: [image(group(), 'b')] });
    await bot.aggregator.flushAll();
    const fid = familyIdForChat('Cgroup1');
    const docs = await repo.listDocuments(fid);
    expect(docs).toHaveLength(1);
    expect(docs[0].source_hashes).toHaveLength(2);
    expect((await repo.getFamily(fid))?.quota_used).toBe(1);
    expect(lastText(line)).toContain('Không thêm lại vào lịch');
  });
});

describe('menu', () => {
  it('"menu" and a bare @mention show tap-able command buttons (camera, calendar…)', async () => {
    const { bot, line } = await setup();
    await activate(bot);
    await bot.handleWebhook({ events: [textEv(group(), 'menu')] });
    const qr = JSON.stringify(line.sent[line.sent.length - 1].messages[0].quickReply);
    expect(qr).toContain('"type":"camera"');
    expect(qr).toContain('action=calendar');
    const before = line.sent.length;
    await bot.handleWebhook({ events: [ev(group(), { type: 'message', message: { id: 'mm', type: 'text', text: '@Kami Việt', mention: { mentionees: [{ index: 0, length: 10, isSelf: true }] } } })] });
    expect(line.sent.length).toBe(before + 1);
    expect(lastText(line)).toContain('Hướng dẫn');
  });

  it('"@Kami Việt lịch" works like "lịch"', async () => {
    const { bot, line } = await setup();
    await activate(bot);
    await bot.handleWebhook({ events: [ev(group(), { type: 'message', message: { id: 'm2', type: 'text', text: '@Kami Việt lịch', mention: { mentionees: [{ index: 0, length: 10, isSelf: true }] } } })] });
    expect(lastText(line)).toContain('/cal/');
  });
});

describe('"dịch" command (translate only)', () => {
  it('"dịch" then a photo → bilingual translation, nothing stored, no quota; then one tap reads it', async () => {
    const { bot, repo, line } = await setup();
    await activate(bot);
    const fid = familyIdForChat('Cgroup1');
    await bot.handleWebhook({ events: [textEv(group(), 'dịch')] });
    expect(lastText(line)).toContain('CHỈ DỊCH');

    line.contents.set('t1', { data: Buffer.from('to-translate'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group(), 't1')] });
    await bot.aggregator.flushAll();
    expect(lastText(line)).toContain('Bản dịch (không lưu)');
    expect(JSON.stringify(line.sent[line.sent.length - 1].messages)).toContain('action=read_last');
    expect(await repo.listDocuments(fid)).toHaveLength(0);
    expect((await repo.getFamily(fid))?.quota_used).toBe(0);

    // one tap: full read of the same pages (no re-send)
    await bot.handleWebhook({ events: [ev(group(), { type: 'postback', postback: { data: 'action=read_last' } })] });
    expect(await repo.listDocuments(fid)).toHaveLength(1);
    expect((await repo.getFamily(fid))?.quota_used).toBe(1);
  });

  it('mode is one-shot: the next photo is read normally', async () => {
    const { bot, repo, line } = await setup();
    await activate(bot);
    await bot.handleWebhook({ events: [textEv(group(), 'dịch')] });
    line.contents.set('a', { data: Buffer.from('a'), contentType: 'image/jpeg' });
    line.contents.set('b', { data: Buffer.from('b'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group(), 'a')] });
    await bot.aggregator.flushAll();
    await bot.handleWebhook({ events: [image(group(), 'b')] });
    await bot.aggregator.flushAll();
    expect(await repo.listDocuments(familyIdForChat('Cgroup1'))).toHaveLength(1);
  });

  it('works even when the paper quota is used up', async () => {
    const { bot, repo, line } = await setup();
    await activate(bot);
    const fam = (await repo.getFamily(familyIdForChat('Cgroup1')))!;
    fam.quota_used = fam.quota_limit;
    await repo.saveFamily(fam);
    await bot.handleWebhook({ events: [textEv(group(), '/dịch')] });
    line.contents.set('q', { data: Buffer.from('q'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group(), 'q')] });
    await bot.aggregator.flushAll();
    expect(lastText(line)).toContain('Bản dịch');
  });

  it('"dịch <text>" translates pasted Japanese directly', async () => {
    const { bot, line } = await setup();
    await activate(bot);
    await bot.handleWebhook({ events: [textEv(group(), 'dịch 明日は休園日です')] });
    expect(lastText(line)).toContain('明日は休園日です');
  });

  it('splits long translations across ≤5 messages', () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({ jp: 'あ'.repeat(60) + i, vi: 'chữ '.repeat(20) + i }));
    const msgs = formatTranslation({ title_jp: 'x', lines, notes_vi: '' }, [{ label: 'm', text: 'menu' }]);
    expect(msgs.length).toBe(5);
    for (const m of msgs) expect((m.text as string).length).toBeLessThanOrEqual(5000);
    expect(msgs[4].quickReply).toBeDefined();
    expect(msgs[0].quickReply).toBeUndefined();
  });
});

describe('admin alerts', () => {
  it('budget 80% and 100% alert the admin once each month', async () => {
    const { bot, line, cfg } = await setup({ adminUserIds: ['U_admin'], monthlyBudgetUsd: 10 });
    const m = jstMonth();
    await bot.recordUsage(m, { cost_usd: 8.5 });
    await bot.recordUsage(m, { cost_usd: 0.1 });
    const toAdmin = () => line.sent.filter(s => s.kind === 'push' && s.target === 'U_admin');
    expect(toAdmin()).toHaveLength(1);
    expect(JSON.stringify(toAdmin()[0].messages)).toContain('80%');
    await bot.recordUsage(m, { cost_usd: 2 });
    await bot.recordUsage(m, { cost_usd: 1 });
    expect(toAdmin()).toHaveLength(2);
    expect(JSON.stringify(toAdmin()[1].messages)).toContain('hết ngân sách');
    expect(cfg.adminUserIds).toContain('U_admin');
  });

  it('5 reading errors within an hour → one alert', async () => {
    const { bot, line } = await setup({ adminUserIds: ['U_admin'] });
    for (let i = 0; i < 7; i++) await bot.services.logError('f', 'EXTRACT_API', 'boom');
    await new Promise(r => setTimeout(r, 10));
    expect(line.sent.filter(s => s.target === 'U_admin')).toHaveLength(1);
  });
});

describe('family name + morning digest', () => {
  it('"đặt tên ..." renames the family; plain "tên ..." chatter does not', async () => {
    const { bot, repo } = await setup();
    await activate(bot);
    const fid = familyIdForChat('Cgroup1');
    await bot.handleWebhook({ events: [textEv(group(), 'tên bé là gì nhỉ')] });
    expect((await repo.getFamily(fid))!.family_name).toMatch(/^Gia đình #/);
    await bot.handleWebhook({ events: [textEv(group(), 'đặt tên Nhà Tuấn Mai')] });
    expect((await repo.getFamily(fid))!.family_name).toBe('Nhà Tuấn Mai');
  });

  it('digest is opt-in and only sent when something is due', async () => {
    const { bot, repo, line } = await setup();
    await activate(bot);
    const fid = familyIdForChat('Cgroup1');
    const now = new Date('2026-11-01T22:00:00Z'); // 07:00 JST 11/02 — preset deadline 2026-11-02
    line.contents.set('x', { data: Buffer.from('x'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group(), 'x')] });
    await bot.aggregator.flushAll();

    expect((await bot.sendDailyDigests(now)).sent).toBe(0); // not opted in
    await bot.handleWebhook({ events: [textEv(group(), 'nhắc sáng bật')] });
    expect((await repo.getFamily(fid))!.daily_digest).toBe(true);
    expect((await bot.sendDailyDigests(now)).sent).toBe(1);
    expect(lastText(line)).toContain('Hôm nay');
    expect((await bot.sendDailyDigests(new Date('2027-03-01T22:00:00Z'))).sent).toBe(0); // overdue > 7 days → silent
  });

  it('keeps a push reserve', async () => {
    const { bot, repo, line, cfg } = await setup();
    await activate(bot);
    const fam = (await repo.getFamily(familyIdForChat('Cgroup1')))!;
    fam.daily_digest = true;
    await repo.saveFamily(fam);
    line.contents.set('x', { data: Buffer.from('x'), contentType: 'image/jpeg' });
    await bot.handleWebhook({ events: [image(group(), 'x')] });
    await bot.aggregator.flushAll();
    await repo.addUsage(jstMonth(new Date('2026-11-01T22:00:00Z')), { push_messages: cfg.pushLimit - 5 });
    expect(await bot.sendDailyDigests(new Date('2026-11-01T22:00:00Z'))).toEqual({ sent: 0, skippedQuota: 1 });
  });
});
