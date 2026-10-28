import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp } from '../src/server/app.ts';
import { MemoryRepo } from '../src/server/db/memory.ts';
import { RecordingLineApi, signBody } from '../src/server/line.ts';
import { MockExtractor } from '../src/server/extract.ts';
import { TemplateComposer } from '../src/server/renraku.ts';
import { familyIdForChat, makeInvite } from '../src/server/service.ts';
import { activate, ev, group, testConfig } from './helpers.ts';

let server: Server;
let base: string;
const repo = new MemoryRepo();
const line = new RecordingLineApi();
const cfg = testConfig();
const tokens: Record<string, string> = { tokA: 'Ua', tokB: 'Ub', tokAdmin: 'U_admin' };
const { app, bot } = createApp({
  cfg, repo, line, extractor: new MockExtractor(), composer: new TemplateComposer(),
  verifyIdToken: async t => (tokens[t] ? { sub: tokens[t], exp: Date.now() / 1000 + 600 } : null),
});
const auth = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

beforeAll(async () => {
  await repo.saveInviteCode(makeInvite('BETA2026', { quota: 50, maxUses: 20 }, new Date()));
  await activate(bot, group('CA', 'Ua'));
  await activate(bot, group('CB', 'Ub'));
  line.contents.set('x', { data: Buffer.from('x'), contentType: 'image/jpeg' });
  await bot.handleWebhook({ events: [ev(group('CA', 'Ua'), { type: 'message', message: { id: 'x', type: 'image' } })] });
  await bot.aggregator.flushAll();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe('webhook', () => {
  it('rejects bad signatures and accepts good ones', async () => {
    const body = JSON.stringify({ events: [] });
    const bad = await fetch(`${base}/api/line/webhook`, { method: 'POST', body, headers: { 'x-line-signature': 'nope', 'content-type': 'application/json' } });
    expect(bad.status).toBe(401);
    const ok = await fetch(`${base}/api/line/webhook`, { method: 'POST', body, headers: { 'x-line-signature': signBody(cfg.lineChannelSecret, body), 'content-type': 'application/json' } });
    expect(ok.status).toBe(200);
  });
});

describe('LIFF API', () => {
  it('requires a valid ID token', async () => {
    expect((await fetch(`${base}/api/documents`)).status).toBe(401);
    expect((await fetch(`${base}/api/documents`, { headers: auth('forged') })).status).toBe(401);
  });

  it('returns only the caller’s family documents', async () => {
    const a = await (await fetch(`${base}/api/documents`, { headers: auth('tokA') })).json();
    expect(a.documents).toHaveLength(1);
    const b = await (await fetch(`${base}/api/documents`, { headers: auth('tokB') })).json();
    expect(b.documents).toHaveLength(0);
    const famA = familyIdForChat('CA');
    const cross = await fetch(`${base}/api/documents?familyId=${famA}`, { headers: auth('tokB') });
    expect(cross.status).toBe(404);
  });

  it('lets members fix a date, which updates the ICS feed', async () => {
    const { documents: [doc] } = await (await fetch(`${base}/api/documents`, { headers: auth('tokA') })).json();
    const res = await fetch(`${base}/api/documents/${doc.id}`, {
      method: 'PATCH', headers: auth('tokA'), body: JSON.stringify({ events: [{ id: doc.events[0].id, date: '2026-12-01' }] }),
    });
    expect(res.status).toBe(200);
    const { family } = await (await fetch(`${base}/api/family`, { headers: auth('tokA') })).json();
    expect(family.member_user_ids).toBeUndefined();
    const ics = await (await fetch(family.ics_url.replace(cfg.publicBaseUrl, base))).text();
    expect(ics).toContain('20261201');
    expect((await fetch(`${base}/ics/not-a-real-token-123456.ics`)).status).toBe(404);
  });

  it('serves an add-to-calendar page with webcal + Google subscribe links', async () => {
    const { family } = await (await fetch(`${base}/api/family`, { headers: auth('tokA') })).json();
    expect(family.calendar_page_url).toContain('openExternalBrowser=1');
    const page = await fetch(family.calendar_page_url.replace(cfg.publicBaseUrl, base), { headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari Line/14.0' } });
    const html = await page.text();
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(html).toContain(`webcal://bot.example.com/ics/${family.ics_token}.ics`);
    expect(html).toContain('calendar.google.com/calendar/r?cid=webcal%3A%2F%2F');
    expect(html).toContain('Mở bằng trình duyệt'); // opened inside LINE → tells user to go external
    expect((await fetch(`${base}/cal/not-a-real-token-123456`)).status).toBe(404);
  });
});

describe('in-app upload', () => {
  const page = { data: Buffer.from('fake-jpeg-bytes-123').toString('base64'), mediaType: 'image/jpeg' };

  it('reads photos uploaded from the LIFF app through the same pipeline', async () => {
    const res = await fetch(`${base}/api/documents/upload`, { method: 'POST', headers: auth('tokB'), body: JSON.stringify({ pages: [page] }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('new');
    expect(body.document.family_id).toBe(familyIdForChat('CB'));
    // same bytes again → answered from storage
    const again = await (await fetch(`${base}/api/documents/upload`, { method: 'POST', headers: auth('tokB'), body: JSON.stringify({ pages: [page] }) })).json();
    expect(again.result).toBe('duplicate');
  });

  it('rejects other families, bad types and empty uploads', async () => {
    const famA = familyIdForChat('CA');
    expect((await fetch(`${base}/api/documents/upload`, { method: 'POST', headers: auth('tokB'), body: JSON.stringify({ familyId: famA, pages: [page] }) })).status).toBe(404);
    expect((await fetch(`${base}/api/documents/upload`, { method: 'POST', headers: auth('tokB'), body: JSON.stringify({ pages: [{ ...page, mediaType: 'text/html' }] }) })).status).toBe(400);
    expect((await fetch(`${base}/api/documents/upload`, { method: 'POST', headers: auth('tokB'), body: JSON.stringify({ pages: [] }) })).status).toBe(400);
  });
});

describe('chỉ dịch (translate only)', () => {
  const page = { data: Buffer.from('translate-me').toString('base64'), mediaType: 'image/jpeg' };

  it('returns line-by-line translation without storing a document or using quota', async () => {
    const famB = familyIdForChat('CB');
    const before = await repo.listDocuments(famB);
    const quotaBefore = (await repo.getFamily(famB))!.quota_used;
    const res = await fetch(`${base}/api/translate`, { method: 'POST', headers: auth('tokB'), body: JSON.stringify({ pages: [page] }) });
    expect(res.status).toBe(200);
    const { translation } = await res.json();
    expect(translation.lines.length).toBeGreaterThan(0);
    expect(translation.lines[0]).toHaveProperty('vi');
    expect(await repo.listDocuments(famB)).toHaveLength(before.length);
    expect((await repo.getFamily(famB))!.quota_used).toBe(quotaBefore);
  });

  it('requires membership and valid pages', async () => {
    expect((await fetch(`${base}/api/translate`, { method: 'POST', headers: auth('tokB'), body: JSON.stringify({ familyId: familyIdForChat('CA'), pages: [page] }) })).status).toBe(404);
    expect((await fetch(`${base}/api/translate`, { method: 'POST', headers: auth('tokB'), body: JSON.stringify({ pages: [] }) })).status).toBe(400);
    expect((await fetch(`${base}/api/translate`, { method: 'POST', body: JSON.stringify({ pages: [page] }) })).status).toBe(401);
  });
});

describe('admin', () => {
  it('is forbidden for regular users', async () => {
    expect((await fetch(`${base}/api/admin/metrics`, { headers: auth('tokA') })).status).toBe(403);
  });

  it('exposes metrics without any document content', async () => {
    const res = await fetch(`${base}/api/admin/metrics`, { headers: auth('tokAdmin') });
    const json = JSON.stringify(await res.json());
    expect(res.status).toBe(200);
    expect(json).toContain('docs_by_type');
    const [doc] = await repo.listDocuments(familyIdForChat('CA'));
    expect(json).not.toContain(doc.summary_vi);
    const fams = JSON.stringify(await (await fetch(`${base}/api/admin/families`, { headers: auth('tokAdmin') })).json());
    expect(fams).not.toContain('Ua');
    expect(fams).not.toMatch(/"ics_token":"[^"]+"/);
  });

  it('creates invite codes', async () => {
    const res = await fetch(`${base}/api/admin/invite-codes`, { method: 'POST', headers: auth('tokAdmin'), body: JSON.stringify({ code: 'kanto-2', maxUses: 5 }) });
    expect((await res.json()).invite_code.code).toBe('KANTO-2');
  });
});
