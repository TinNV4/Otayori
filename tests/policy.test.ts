import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp } from '../src/server/app.ts';
import { MemoryRepo } from '../src/server/db/memory.ts';
import { DOT_MENU_ALIAS, RecordingLineApi } from '../src/server/line.ts';
import { MockExtractor } from '../src/server/extract.ts';
import { TemplateComposer } from '../src/server/renraku.ts';
import { makeInvite } from '../src/server/service.ts';
import { MockPolicyAnalyzer, toPolicyItem } from '../src/server/policy/analyzer.ts';
import { candidateLinks, decodeBody, extractLinks, htmlToText, parseJaDate } from '../src/server/policy/fetch.ts';
import { addMonths, formatPolicyMessage, matchItem, remindersDue, renewalWindowOpens, suggestSeverity } from '../src/server/policy/match.ts';
import { PolicyService, validateProfileInput } from '../src/server/policy/service.ts';
import { POLICY_CITIES, POLICY_SOURCES, PolicySource } from '../src/server/policy/sources.ts';
import { PolicyItem, PolicyProfile } from '../src/types/policy.ts';
import { activate, group, lastText, setup, testConfig, textEv } from './helpers.ts';

const NOW = new Date('2026-09-20T00:00:00Z'); // 2026-09-20 09:00 JST
const profile = (over: Partial<PolicyProfile> = {}): PolicyProfile => ({
  user_id: 'Ua', visa_type: 'gijinkoku', visa_expiry: '2027-03-15', city: 'nagoya', has_children: false,
  created_at: NOW.toISOString(), updated_at: NOW.toISOString(), reminders_sent: [], ...over,
});
const item = (over: Partial<PolicyItem> = {}): PolicyItem => ({
  id: 'pol_x', source_id: 'isa', issuer: '出入国在留管理庁', url: 'https://www.moj.go.jp/isa/a.html', title_jp: '手数料改定', title_vi: 'Phí gia hạn 在留 tăng',
  summary_vi: 'Phí tăng.', action_vi: 'Chuẩn bị giấy tờ sớm.', stage: 'decided', severity: 'red', effective_date: '2026-10-01',
  audience: { visa_types: [], cities: [], children_only: false, renewal_related: true }, status: 'approved', confidence: 0.9,
  created_at: NOW.toISOString(), approved_at: NOW.toISOString(), pushed_user_ids: [], push_failed_user_ids: [], ...over,
});

describe('matching', () => {
  it('personalises the visa-fee example: expires 3/2027 → can file from 12/2026, after the new fee', () => {
    const m = matchItem(profile(), item())!;
    expect(m.personal_vi).toContain('hết hạn 3/2027');
    expect(m.personal_vi).toContain('từ 12/2026');
    expect(m.personal_vi).toContain('quy định mới');
    expect(m.reason_vi).toContain('visa của bạn hết hạn 3/2027');
  });

  it('skips renewal-related items for users whose visa ends before the rule applies', () => {
    expect(matchItem(profile({ visa_expiry: '2026-09-30' }), item())).toBeNull();
    expect(matchItem(profile({ visa_expiry: undefined }), item())).not.toBeNull(); // unknown expiry: still informed
  });

  it('filters by city, visa type and children', () => {
    const cityItem = item({ audience: { visa_types: [], cities: ['nagoya'], children_only: false, renewal_related: false } });
    expect(matchItem(profile({ city: 'other' }), cityItem)).toBeNull();
    expect(matchItem(profile(), cityItem)!.reason_vi).toContain('Nagoya');
    const tokutei = item({ audience: { visa_types: ['tokutei1'], cities: [], children_only: false, renewal_related: false } });
    expect(matchItem(profile(), tokutei)).toBeNull();
    const kids = item({ audience: { visa_types: [], cities: [], children_only: true, renewal_related: false } });
    expect(matchItem(profile(), kids)).toBeNull();
    expect(matchItem(profile({ has_children: true }), kids)).not.toBeNull();
  });

  it('computes the renewal window with month-end clamping', () => {
    expect(renewalWindowOpens('2027-03-15')).toBe('2026-12-15');
    expect(addMonths('2026-05-31', -3)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('suggests 🟢 for drafts, 🔴 when the date is ≤30 days away, 🟡 otherwise', () => {
    expect(suggestSeverity('proposed', '2026-09-20', '2026-09-25')).toBe('green');
    expect(suggestSeverity('decided', '2026-09-20', '2026-10-01')).toBe('red');
    expect(suggestSeverity('decided', '2026-09-20', '2026-12-01')).toBe('yellow');
    expect(suggestSeverity('decided', '2026-09-20', '2026-12-01', '2026-09-30')).toBe('red');
    expect(suggestSeverity('decided', '2026-09-20')).toBe('yellow');
  });

  it('every message carries why, what to do and the official link', () => {
    const it0 = item();
    const msg = formatPolicyMessage({ ...it0, ...matchItem(profile(), it0)! });
    expect(msg).toContain('🔴 Phí gia hạn');
    expect(msg).toContain('Vì sao bạn nhận tin');
    expect(msg).toContain('Việc cần làm: Chuẩn bị giấy tờ sớm.');
    expect(msg).toContain('https://www.moj.go.jp/isa/a.html');
  });
});

describe('cities', () => {
  const at = (cities: string[]) => item({ audience: { visa_types: [], cities, children_only: false, renewal_related: false } });

  it('a Yokohama resident also gets Kanagawa prefecture news, but not the other way round', () => {
    expect(matchItem(profile({ city: 'yokohama' }), at(['kanagawa']))!.reason_vi).toContain('Kanagawa');
    expect(matchItem(profile({ city: 'yokohama' }), at(['yokohama']))!.reason_vi).toContain('Yokohama');
    expect(matchItem(profile({ city: 'kanagawa' }), at(['yokohama']))).toBeNull();
    expect(matchItem(profile({ city: 'tokyo' }), at(['kanagawa']))).toBeNull();
    expect(matchItem(profile({ city: 'tokyo' }), at(['tokyo']))).not.toBeNull();
    expect(matchItem(profile({ city: 'other' }), at(['tokyo', 'yokohama']))).toBeNull();
  });

  it('every city source maps to a selectable city, and every source is well-formed', () => {
    const ids = POLICY_SOURCES.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of POLICY_SOURCES) {
      expect(new URL(s.listUrl).hostname).toBe(s.hosts[0]);
      if (s.city) expect(POLICY_CITIES.map(c => c.id)).toContain(s.city);
    }
    for (const c of ['tokyo', 'yokohama', 'kanagawa']) expect(POLICY_SOURCES.some(s => s.city === c)).toBe(true);
    expect(validateProfileInput({ visa_type: 'student', city: 'yokohama' }, '2026-09-20').ok).toBe(true);
  });
});

describe('profile validation', () => {
  it('accepts a valid profile and rejects bad input', () => {
    expect(validateProfileInput({ visa_type: 'gijinkoku', city: 'nagoya', visa_expiry: '2027-03-15', has_children: true }, '2026-09-20').ok).toBe(true);
    expect(validateProfileInput({ visa_type: 'nope', city: 'nagoya' }, '2026-09-20').ok).toBe(false);
    expect(validateProfileInput({ visa_type: 'student', city: 'osaka' }, '2026-09-20').ok).toBe(false);
    expect(validateProfileInput({ visa_type: 'student', city: 'other', visa_expiry: '2026-02-30' }, '2026-09-20').ok).toBe(false);
    expect(validateProfileInput({ visa_type: 'student', city: 'other', visa_expiry: '2099-01-01' }, '2026-09-20').ok).toBe(false);
  });
});

describe('HTML helpers', () => {
  const html = `<html><head><title>お知らせ</title></head><body><p>2026年9月18日</p><nav><a href="/isa/nav.html">ナビゲーション</a></nav>
    <a href="/isa/fee.html">在留手数料の改定について</a><a href="/isa/fee.html">在留手数料の改定について</a>
    <a href="https://evil.example.com/x.html">外国人向けの重要なお知らせ</a><a href="/isa/doc.pdf">資料ダウンロード用ファイル</a>
    <a href="/isa/more.html">詳細</a><a href="mailto:a@b.c">在留に関するメール問い合わせ</a></body></html>`;
  const src: PolicySource = { id: 't', issuer: 'T', listUrl: 'https://www.moj.go.jp/isa/index.html', hosts: ['www.moj.go.jp'], linkPattern: /^\/isa\// };

  it('extracts, dedupes and drops pdf/mailto links', () => {
    const urls = extractLinks(html, src.listUrl).map(l => l.url);
    expect(urls).toContain('https://www.moj.go.jp/isa/fee.html');
    expect(urls.filter(u => u.endsWith('fee.html'))).toHaveLength(1);
    expect(urls.some(u => u.endsWith('.pdf') || u.startsWith('mailto'))).toBe(false);
  });

  it('keeps only same-host, long-enough, pattern-matching links', () => {
    const opts = { today: '2026-09-20', maxAgeDays: 45 };
    expect(candidateLinks(src, html, opts).map(l => l.url)).toEqual(['https://www.moj.go.jp/isa/nav.html', 'https://www.moj.go.jp/isa/fee.html']);
  });

  it('drops undated links (menus) and entries older than maxAgeDays, newest first', () => {
    const list = `<a href="/isa/menu.html">在留資格から探す一覧</a>
      <th>令和8年7月</th><td><a href="/isa/old.html">古いお知らせの掲載について</a></td>
      <th>令和8年9月</th><td><a href="/isa/mid.html">九月のお知らせの掲載について</a></td>
      <div class="date">2026年9月19日</div><a href="/isa/new.html">昨日のお知らせの掲載について</a>`;
    const urls = candidateLinks(src, list, { today: '2026-09-20', maxAgeDays: 45 }).map(l => l.url.split('/').pop());
    expect(urls).toEqual(['mid.html', 'new.html']); // month-only dates count as the last day of the month (30/9 > 19/9)
  });

  it('parses 西暦, 令和/平成, full-width digits and month-only dates', () => {
    expect(parseJaDate('2026年10月23日')).toBe('2026-10-23');
    expect(parseJaDate('令和８年９月８日')).toBe('2026-09-08');
    expect(parseJaDate('令和元年5月1日')).toBe('2019-05-01');
    expect(parseJaDate('平成30年12月')).toBe('2018-12-31');
    expect(parseJaDate('2026年10月28日（水）掲載 / 2026年10月27日')).toBe('2026-10-27'); // last date wins
    expect(parseJaDate('2026年2月30日')).toBeUndefined();
    expect(parseJaDate('お知らせ')).toBeUndefined();
  });

  it('strips markup and decodes Shift_JIS', () => {
    expect(htmlToText('<style>x{}</style><p>A&amp;B</p><script>1</script><p>本文</p>')).toBe('A&B\n本文');
    const sjis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b]); // 日本
    expect(decodeBody(sjis.buffer, 'text/html; charset=Shift_JIS')).toBe('日本');
  });
});

describe('ingest → review → push', () => {
  const src: PolicySource = { id: 'isa', issuer: '出入国在留管理庁', listUrl: 'https://www.moj.go.jp/isa/index.html', hosts: ['www.moj.go.jp'] };
  const pad = '本文。'.repeat(80);
  const pages: Record<string, string> = {
    'https://www.moj.go.jp/isa/index.html': `<p>2026年9月18日</p><a href="/isa/fee.html">在留手数料の改定について</a><a href="/isa/event.html">職員の採用説明会のご案内</a><a href="/isa/thin.html">リンクだけのページです</a>`,
    'https://www.moj.go.jp/isa/fee.html': `<title>在留手数料の改定</title><p>在留手数料を改定します。施行 2026年10月1日。${pad}</p>`,
    'https://www.moj.go.jp/isa/event.html': `<title>採用説明会</title><p>職員採用の説明会を開催します。${pad}</p>`,
    'https://www.moj.go.jp/isa/thin.html': '<p>短い</p>',
  };

  async function build(over: { pushLimit?: number } = {}) {
    const cfg = testConfig(over);
    const repo = new MemoryRepo();
    const line = new RecordingLineApi();
    const notes: string[] = [];
    const links: Array<{ label: string; uri: string }> = [];
    const calls: string[] = [];
    const svc = new PolicyService({
      repo, cfg, line, analyzer: new MockPolicyAnalyzer(), sources: [src], now: () => NOW,
      fetchPage: async u => { calls.push(u); if (!(u in pages)) throw new Error('404'); return pages[u]; },
      notify: async (m, l) => { notes.push(m); if (l) links.push(l); },
    });
    return { svc, repo, line, notes, links, calls, cfg };
  }

  it('creates drafts for relevant pages only, never re-reads known pages, and tells the admin', async () => {
    const { svc, repo, notes, links, calls } = await build();
    const r = await svc.ingest();
    expect(r.created).toBe(1);
    expect(r.sources[0]).toMatchObject({ links: 3, fresh: 3, pending: 1, ignored: 2 });
    const pending = await repo.listPolicyItems('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].effective_date).toBe('2026-10-01');
    expect(pending[0].audience.renewal_related).toBe(true);
    expect(pending[0].severity).toBe('red');
    expect(notes[0]).toContain('1 bản tin');
    expect(notes[0]).toContain('admin=policy'); // a tap-able link, not a terminal command
    expect(notes[0]).not.toContain('npm run');
    expect(links[0]).toMatchObject({ label: '📰 Duyệt ngay' });
    expect(links[0].uri).toContain('admin=policy');
    const before = calls.length;
    expect((await svc.ingest()).created).toBe(0);
    expect(calls.length).toBe(before + 1); // only the list page is fetched again
  });

  it('--dry lists candidates without fetching pages or saving', async () => {
    const { svc, repo, calls } = await build();
    const r = await svc.ingest({ dry: true });
    expect(r.sources[0].sample).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(await repo.listPolicyItems()).toHaveLength(0);
  });

  it('nothing is pushed before approval; approval pushes 🔴 once to matching users only', async () => {
    const { svc, repo, line } = await build();
    await repo.savePolicyProfile(profile({ user_id: 'Ua' }));
    await repo.savePolicyProfile(profile({ user_id: 'Ub', visa_expiry: '2026-09-30' })); // files before the new fee
    await repo.savePolicyProfile(profile({ user_id: 'Uc', visa_expiry: undefined }));
    await svc.ingest();
    expect((await svc.dispatch()).sent).toBe(0);
    expect(line.sent).toHaveLength(0);

    const [draft] = await repo.listPolicyItems('pending');
    const r = (await svc.approve(draft.id, 'U_admin'))!;
    expect(r.dispatch.sent).toBe(2);
    expect(line.sent.map(s => s.target).sort()).toEqual(['Ua', 'Uc']);
    expect(line.sent.find(s => s.target === 'Ua')!.messages[0].text).toContain('từ 12/2026');
    expect((await svc.dispatch()).sent).toBe(0); // idempotent
    expect((await repo.getUsage('2026-09')).push_messages).toBe(2);
    expect(await svc.approve(draft.id, 'U_admin')).toBeNull(); // already approved
  });

  it('🟡/🟢 and rejected items never push, but 🟡 shows in the feed', async () => {
    const { svc, repo, line } = await build();
    await repo.savePolicyProfile(profile());
    await svc.ingest();
    const [draft] = await repo.listPolicyItems('pending');
    await svc.approve(draft.id, 'U_admin', 'yellow');
    expect(line.sent).toHaveLength(0);
    const feed = await svc.feed('Ua');
    expect(feed.items).toHaveLength(1);
    expect(feed.unread_count).toBe(1);
    await svc.markSeen('Ua');
    expect((await svc.feed('Ua')).unread_count).toBe(0);
    await svc.reject(draft.id, 'U_admin');
    expect((await svc.feed('Ua')).items).toHaveLength(0);
  });

  it('keeps the push reserve: defers when the monthly quota is nearly used and alerts once', async () => {
    const { svc, repo, line, notes } = await build({ pushLimit: 21 }); // 21 − 20 reserve = 1 push available
    for (const id of ['Ua', 'Ub', 'Uc']) await repo.savePolicyProfile(profile({ user_id: id }));
    await svc.ingest();
    notes.length = 0;
    const [draft] = await repo.listPolicyItems('pending');
    const r = (await svc.approve(draft.id, 'U_admin'))!;
    expect(r.dispatch).toMatchObject({ sent: 1, deferred: 2 });
    expect(line.sent).toHaveLength(1);
    expect(notes.filter(n => n.includes('chưa gửi'))).toHaveLength(1);
    await svc.dispatch();
    expect(notes.filter(n => n.includes('chưa gửi'))).toHaveLength(1); // alert only once per month
  });

  it('records a failed push (user never added the bot) without retrying forever', async () => {
    const { svc, repo, line } = await build();
    line.push = async () => false;
    await repo.savePolicyProfile(profile());
    await svc.ingest();
    const [draft] = await repo.listPolicyItems('pending');
    expect((await svc.approve(draft.id, 'U_admin'))!.dispatch).toMatchObject({ sent: 0, failed: 1 });
    expect((await svc.dispatch()).failed).toBe(0);
  });

  it('sends the visa reminder once per expiry date, within 90 days, and not for expired cards', async () => {
    const { svc, repo, line } = await build();
    await repo.savePolicyProfile(profile({ user_id: 'Ua', visa_expiry: '2026-12-01' })); // 72 days
    await repo.savePolicyProfile(profile({ user_id: 'Ub', visa_expiry: '2027-03-15' })); // too early
    await repo.savePolicyProfile(profile({ user_id: 'Uc', visa_expiry: '2026-09-01' })); // already expired
    expect((await svc.sendReminders()).sent).toBe(1);
    expect(line.sent[0].target).toBe('Ua');
    expect(line.sent[0].messages[0].text).toContain('còn 72 ngày');
    expect((await svc.sendReminders()).sent).toBe(0);
    await svc.saveProfile('Ua', { visa_type: 'gijinkoku', city: 'nagoya', has_children: false, visa_expiry: '2027-12-01' }); // renewed
    expect((await repo.getPolicyProfile('Ua'))!.reminders_sent).toHaveLength(1);
  });
});

describe('extended profile', () => {
  const aud = (o: object) => ({ visa_types: [], cities: [], children_only: false, renewal_related: false, ...o });

  it('optional answers only exclude when answered; unknown still gets the news', () => {
    const lic = item({ audience: aud({ license_only: true }) });
    expect(matchItem(profile({ license_status: 'none' }), lic)).toBeNull();
    expect(matchItem(profile({ license_status: 'converting' }), lic)!.reason_vi).toContain('bằng lái');
    expect(matchItem(profile(), lic)).not.toBeNull();

    const kaigo = item({ audience: aud({ sectors: ['kaigo'] }) });
    expect(matchItem(profile({ visa_type: 'gijinkoku' }), kaigo)).toBeNull(); // sector rules concern 特定技能 only
    expect(matchItem(profile({ visa_type: 'tokutei1', sector: 'construction' }), kaigo)).toBeNull();
    expect(matchItem(profile({ visa_type: 'tokutei1', sector: 'kaigo' }), kaigo)!.reason_vi).toContain('ngành');
    expect(matchItem(profile({ visa_type: 'tokutei1' }), kaigo)).not.toBeNull();

    const parts = item({ audience: aud({ contract_types: ['part'] }) });
    expect(matchItem(profile({ contract_type: 'seishain' }), parts)).toBeNull();
    expect(matchItem(profile({ contract_type: 'part' }), parts)).not.toBeNull();
    expect(matchItem(profile(), parts)).not.toBeNull();

    const leaving = item({ audience: aud({ plans: ['return'] }) });
    expect(matchItem(profile({ plan: 'permanent' }), leaving)).toBeNull();
    expect(matchItem(profile({ plan: 'return' }), leaving)).not.toBeNull();
  });

  it('validates the extras and drops answers that do not apply', () => {
    const ok = validateProfileInput({
      visa_type: 'gijinkoku', city: 'nagoya', sector: 'kaigo', license_status: 'none', license_expiry: '2027-05-01',
      contract_type: 'part', plan: 'bogus', resident_tax: 'ordinary',
    }, '2026-09-20');
    expect(ok.ok && ok.value).toMatchObject({ sector: undefined, license_expiry: undefined, contract_type: 'part', plan: undefined, resident_tax: 'ordinary' });
    const tk = validateProfileInput({ visa_type: 'tokutei1', city: 'other', sector: 'kaigo', license_status: 'japan', license_expiry: '2027-05-01' }, '2026-09-20');
    expect(tk.ok && tk.value).toMatchObject({ sector: 'kaigo', license_expiry: '2027-05-01' });
    expect(validateProfileInput({ visa_type: 'gijinkoku', city: 'other', license_status: 'japan', license_expiry: '2099-01-01' }, '2026-09-20').ok).toBe(false);
  });

  it('reminds licence expiry (60d) and 住民税 due dates (7d, only for 普通徴収)', () => {
    const lic = profile({ visa_expiry: undefined, license_status: 'japan', license_expiry: '2026-11-10' });
    expect(remindersDue(lic, '2026-10-28').map(r => r.key)).toEqual(['lic60:2026-11-10']);
    expect(remindersDue({ ...lic, license_status: 'none' }, '2026-10-28')).toHaveLength(0);
    expect(remindersDue(lic, '2026-08-01')).toHaveLength(0);

    const tax = profile({ visa_expiry: undefined, resident_tax: 'ordinary' });
    const due = remindersDue(tax, '2026-10-25');
    expect(due.map(r => r.key)).toEqual(['jt:2026-10']);
    expect(due[0].text).toContain('納付書');
    expect(remindersDue(tax, '2026-10-20')).toHaveLength(0); // 11 days out
    expect(remindersDue(tax, '2026-11-25')).toHaveLength(0); // November is not a usual due month
    expect(remindersDue(tax, '2026-12-27')).toHaveLength(0);
    expect(remindersDue(tax, '2027-01-26').map(r => r.key)).toEqual(['jt:2027-01']);
    expect(remindersDue({ ...tax, resident_tax: 'special' }, '2026-10-25')).toHaveLength(0);
    expect(remindersDue({ ...tax, resident_tax: undefined }, '2026-10-25')).toHaveLength(0);
  });
});

describe('premium gating, rich-menu dot', () => {
  const src: PolicySource = { id: 'isa', issuer: 'ISA', listUrl: 'https://www.moj.go.jp/isa/index.html', hosts: ['www.moj.go.jp'] };
  const make = async (over = {}) => {
    const cfg = testConfig(over);
    const repo = new MemoryRepo();
    const line = new RecordingLineApi();
    const svc = new PolicyService({ repo, cfg, line, analyzer: new MockPolicyAnalyzer(), sources: [src], now: () => NOW });
    return { svc, repo, line };
  };

  it('POLICY_PREMIUM_ONLY_PUSH: free users keep the app but get no push or reminders', async () => {
    const { svc, repo, line } = await make({ policyPremiumOnlyPush: true });
    await repo.savePolicyProfile(profile({ user_id: 'Ufree', visa_expiry: '2026-12-01' }));
    await repo.savePolicyProfile(profile({ user_id: 'Upro', visa_expiry: '2026-12-01', tier: 'premium' }));
    await repo.savePolicyItem(item({ status: 'pending' }));
    await svc.approve('pol_x', 'U_admin');
    expect(line.sent.map(s => s.target)).toEqual(['Upro']);
    expect((await svc.sendReminders()).sent).toBe(1);
    expect((await svc.feed('Ufree')).items).toHaveLength(1); // still sees it
    expect((await repo.getPolicyProfile('Ufree'))!.reminders_sent).toHaveLength(0); // upgrade later → still reminded
    expect(await svc.setTier('Ufree', 'premium')).toBe(true);
    expect((await svc.sendReminders()).sent).toBe(1);
    expect(await svc.setTier('Unobody', 'premium')).toBe(false);
  });

  it('keeps tier and dot state when the user edits their profile', async () => {
    const { svc, repo } = await make();
    await repo.savePolicyProfile(profile({ tier: 'premium', menu_dot: true }));
    const saved = await svc.saveProfile('Ua', { visa_type: 'student', city: 'other', has_children: false });
    expect(saved).toMatchObject({ tier: 'premium', menu_dot: true });
  });

  it('lights the red dot for matching users on approval and clears it when they read', async () => {
    const { svc, repo, line } = await make();
    await repo.savePolicyProfile(profile({ user_id: 'Ua' }));
    await repo.savePolicyProfile(profile({ user_id: 'Ub', city: 'other' }));
    await repo.savePolicyItem(item({ severity: 'yellow', status: 'pending', effective_date: undefined, audience: { visa_types: [], cities: ['nagoya'], children_only: false, renewal_related: false } }));
    await svc.approve('pol_x', 'U_admin');
    expect(line.menus.get('Ua')).toBe(DOT_MENU_ALIAS);
    expect(line.menus.has('Ub')).toBe(false);
    expect((await repo.getPolicyProfile('Ua'))!.menu_dot).toBe(true);

    await svc.markSeen('Ua');
    expect(line.menus.has('Ua')).toBe(false);
    expect((await repo.getPolicyProfile('Ua'))!.menu_dot).toBe(false);
  });

  it('"có gì mới" in 1:1 counts as reading and clears the dot', async () => {
    const { svc, repo, line } = await make();
    await repo.savePolicyProfile(profile());
    await repo.savePolicyItem(item({ severity: 'yellow', status: 'pending', effective_date: undefined, audience: { visa_types: [], cities: [], children_only: false, renewal_related: false } }));
    await svc.approve('pol_x', 'U_admin');
    expect(line.menus.get('Ua')).toBe(DOT_MENU_ALIAS);
    await svc.chatReply('Ua', true, 'whatsnew');
    expect(line.menus.has('Ua')).toBe(false);
  });

  it('a failed menu switch (not a friend / menus not set up) leaves the flag off so it retries', async () => {
    const { svc, repo, line } = await make();
    line.linkRichMenu = async () => false;
    await repo.savePolicyProfile(profile());
    await repo.savePolicyItem(item({ severity: 'yellow', status: 'pending', effective_date: undefined, audience: { visa_types: [], cities: [], children_only: false, renewal_related: false } }));
    await svc.approve('pol_x', 'U_admin');
    expect((await repo.getPolicyProfile('Ua'))!.menu_dot).toBeFalsy();
  });
});

describe('model output is validated', () => {
  const source: PolicySource = { id: 'city_x', issuer: 'X市', listUrl: 'https://x/', hosts: ['x'], city: 'nagoya' };
  it('drops invalid dates / visa types and takes the city from the source, not the model', () => {
    const it0 = toPolicyItem({
      relevant: true, stage: 'decided', title_vi: 't', summary_vi: 's', action_vi: '', effective_date: '2026-13-45', deadline: '2026-11-02',
      visa_types: ['gijinkoku', 'wizard'], children_only: false, renewal_related: false, license_only: false, sectors: ['kaigo', 'bogus'], contract_types: ['part', 'x'], plans: ['permanent', 'y'], confidence: 7,
    }, source, { url: 'https://x/a', title: 'a' }, NOW, '2026-09-20');
    expect(it0.effective_date).toBeUndefined();
    expect(it0.deadline).toBe('2026-11-02');
    expect(it0.audience.visa_types).toEqual(['gijinkoku']);
    expect(it0.audience.cities).toEqual(['nagoya']);
    expect(it0.audience.sectors).toEqual(['kaigo']);
    expect(it0.audience.contract_types).toEqual(['part']);
    expect(it0.audience.plans).toEqual(['permanent']);
    expect(it0.confidence).toBe(1);
    expect(it0.status).toBe('pending');
  });
});

describe('LINE chat', () => {
  it('"có gì mới" in a group never prints personal data; in 1:1 it answers by reply (no push quota)', async () => {
    const { bot, repo, line } = await setup();
    await activate(bot, group('CP', 'Ua'));
    await activate(bot, { type: 'user', userId: 'Ua' });
    await repo.savePolicyProfile(profile());
    await repo.savePolicyItem(item({ severity: 'yellow', effective_date: undefined, audience: { visa_types: [], cities: [], children_only: false, renewal_related: false } }));

    await bot.handleWebhook({ events: [textEv(group('CP', 'Ua'), 'có gì mới?')] });
    expect(lastText(line)).toContain('không đăng trong nhóm');
    expect(lastText(line)).not.toContain('3/2027');

    await bot.handleWebhook({ events: [textEv({ type: 'user', userId: 'Ua' }, 'Có gì mới?')] });
    const last = line.sent[line.sent.length - 1];
    expect(last.kind).toBe('reply');
    expect(lastText(line)).toContain('Phí gia hạn');
    expect(lastText(line)).toContain('https://www.moj.go.jp/isa/a.html');
  });

  it('asks for the 3 fields when there is no profile yet', async () => {
    const { bot, line } = await setup();
    await activate(bot, { type: 'user', userId: 'Un' });
    await bot.handleWebhook({ events: [textEv({ type: 'user', userId: 'Un' }, 'chính sách')] });
    expect(lastText(line)).toContain('3 thông tin');
  });
});

describe('HTTP API', () => {
  let server: Server;
  let base: string;
  const repo = new MemoryRepo();
  const line = new RecordingLineApi();
  const tokens: Record<string, string> = { tokA: 'Ua', tokX: 'Ustranger', tokAdmin: 'U_admin' };
  const { app, bot } = createApp({
    cfg: testConfig(), repo, line, extractor: new MockExtractor(), composer: new TemplateComposer(),
    // No network in tests: every official page is empty, so each source reports 0 links.
    policyFetchPage: async () => '<html></html>',
    verifyIdToken: async t => (tokens[t] ? { sub: tokens[t], exp: Date.now() / 1000 + 600 } : null),
  });
  const h = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

  beforeAll(async () => {
    await repo.saveInviteCode(makeInvite('BETA2026', { quota: 50, maxUses: 20 }, new Date()));
    await activate(bot, group('CA', 'Ua'));
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it('is limited to members of an active family, and validates the profile', async () => {
    expect((await fetch(`${base}/api/policy/feed`)).status).toBe(401);
    expect((await fetch(`${base}/api/policy/feed`, { headers: h('tokX') })).status).toBe(403);
    const bad = await fetch(`${base}/api/policy/profile`, { method: 'PUT', headers: h('tokA'), body: JSON.stringify({ visa_type: 'x', city: 'nagoya' }) });
    expect(bad.status).toBe(400);
    const ok = await fetch(`${base}/api/policy/profile`, { method: 'PUT', headers: h('tokA'), body: JSON.stringify({ visa_type: 'gijinkoku', city: 'nagoya', visa_expiry: '2027-03-15', has_children: true }) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).profile.visa_expiry).toBe('2027-03-15');
  });

  it('admin reviews drafts; regular users cannot', async () => {
    await repo.savePolicyItem(item({ id: 'pol_draft', status: 'pending', severity: 'yellow', approved_at: undefined, effective_date: undefined, audience: { visa_types: [], cities: [], children_only: false, renewal_related: false } }));
    expect((await fetch(`${base}/api/admin/policy`, { headers: h('tokA') })).status).toBe(403);
    expect((await (await fetch(`${base}/api/admin/policy?status=pending`, { headers: h('tokAdmin') })).json()).items).toHaveLength(1);
    expect((await fetch(`${base}/api/admin/policy/pol_draft/approve`, { method: 'POST', headers: h('tokA'), body: '{}' })).status).toBe(403);
    const ap = await fetch(`${base}/api/admin/policy/pol_draft/approve`, { method: 'POST', headers: h('tokAdmin'), body: JSON.stringify({ severity: 'green' }) });
    expect((await ap.json()).item.severity).toBe('green');
    const feed = await (await fetch(`${base}/api/policy/feed`, { headers: h('tokA') })).json();
    expect(feed.items.map((i: { id: string }) => i.id)).toContain('pol_draft');
    expect(feed.unread_count).toBe(1);
    await fetch(`${base}/api/policy/seen`, { method: 'POST', headers: h('tokA') });
    expect((await (await fetch(`${base}/api/policy/feed`, { headers: h('tokA') })).json()).unread_count).toBe(0);
  });

  it('admin sees counts + last run, and can start a read of the sources (admins only)', async () => {
    expect((await fetch(`${base}/api/admin/policy-status`, { headers: h('tokA') })).status).toBe(403);
    expect((await fetch(`${base}/api/admin/policy-ingest`, { method: 'POST', headers: h('tokA'), body: '{}' })).status).toBe(403);

    const before = await (await fetch(`${base}/api/admin/policy-status`, { headers: h('tokAdmin') })).json();
    expect(before.last).toBeNull();
    expect(before.llm).toBe('mock');
    expect(before.counts.approved).toBeGreaterThanOrEqual(1);

    const start = await fetch(`${base}/api/admin/policy-ingest`, { method: 'POST', headers: h('tokAdmin'), body: JSON.stringify({ dry: true }) });
    expect(start.status).toBe(202);
    let st = before;
    for (let i = 0; i < 50 && (st.running || !st.last); i++) {
      await new Promise(r => setTimeout(r, 20));
      st = await (await fetch(`${base}/api/admin/policy-status`, { headers: h('tokAdmin') })).json();
    }
    expect(st.running).toBe(false);
    expect(st.last).toMatchObject({ dry: true });
    expect(st.last.report.sources.length).toBe(POLICY_SOURCES.length);
    expect(st.last.report.sources.every((s: { links: number; errors: string[] }) => s.links === 0 && s.errors.length === 0)).toBe(true);
  });

  it('lets users delete their profile; the cron route needs the secret', async () => {
    expect((await (await fetch(`${base}/api/policy/profile`, { method: 'DELETE', headers: h('tokA') })).json()).success).toBe(true);
    expect((await (await fetch(`${base}/api/policy/feed`, { headers: h('tokA') })).json()).profile).toBeNull();
    expect((await fetch(`${base}/tasks/policy`, { method: 'POST' })).status).toBe(403);
  });
});
