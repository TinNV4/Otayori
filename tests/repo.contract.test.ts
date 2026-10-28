/**
 * Storage contract: every Repo implementation must behave the same.
 * Always runs against MemoryRepo. Runs against Firestore when FIRESTORE_EMULATOR_HOST is set:
 *
 *   gcloud emulators firestore start --host-port=127.0.0.1:8089     # terminal 1
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 npm test                 # terminal 2
 */
import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { MemoryRepo } from '../src/server/db/memory.ts';
import { Repo } from '../src/server/db/repo.ts';
import { makeInvite, newFamily } from '../src/server/service.ts';
import { ExtractedDocument } from '../src/types/index.ts';
import { testConfig } from './helpers.ts';

const impls: Array<[string, () => Promise<Repo>]> = [['memory', async () => new MemoryRepo()]];
if (process.env.FIRESTORE_EMULATOR_HOST) {
  impls.push(['firestore', async () => {
    const { Firestore } = await import('@google-cloud/firestore');
    const { FirestoreRepo } = await import('../src/server/db/firestore.ts');
    // Unique project per run = isolated emulator namespace.
    return new FirestoreRepo(new Firestore({ projectId: `test-${crypto.randomBytes(4).toString('hex')}`, ignoreUndefinedProperties: true }));
  }]);
}

const cfg = testConfig();
const doc = (familyId: string, id: string, created: string, expire = '2099-01-01T00:00:00.000Z'): ExtractedDocument => ({
  id, family_id: familyId, created_at: created, expire_at: expire, doc_type: 'otayori', title_jp: 'お便り', title_vi: 'Thông báo',
  issuer: '', summary_vi: 'x', actions: [{ id: 'a0', todo_vi: 'Nộp', deadline: '2026-11-02', completed: false }], items_to_bring: [],
  events: [], confidence: 0.9, model_used: 'claude-haiku-5-5', pages_count: 1, feedback: null,
});

describe.each(impls)('Repo contract: %s', (_name, make) => {
  it('families: save/get, lookup by ICS token and by member', async () => {
    const repo = await make();
    const f = newFamily('Cchat1', 'group', cfg, new Date());
    f.member_user_ids = ['Ua', 'Ub'];
    await repo.saveFamily(f);
    expect((await repo.getFamily(f.family_id))?.family_name).toBe(f.family_name);
    expect((await repo.getFamilyByIcsToken(f.ics_token))?.family_id).toBe(f.family_id);
    expect((await repo.findFamiliesByMember('Ub')).map(x => x.family_id)).toEqual([f.family_id]);
    expect(await repo.findFamiliesByMember('Uzz')).toHaveLength(0);
    await repo.deleteFamily(f.family_id);
    expect(await repo.getFamily(f.family_id)).toBeNull();
  });

  it('documents: tenant isolation, ordering, update, delete, expiry', async () => {
    const repo = await make();
    await repo.addDocument(doc('famA', 'd1', '2026-10-01T00:00:00.000Z'));
    await repo.addDocument(doc('famA', 'd2', '2026-10-05T00:00:00.000Z'));
    await repo.addDocument(doc('famB', 'd3', '2026-10-03T00:00:00.000Z', '2026-10-04T00:00:00.000Z'));
    expect((await repo.listDocuments('famA')).map(d => d.id)).toEqual(['d2', 'd1']);
    expect(await repo.getDocument('famB', 'd1')).toBeNull();

    const d1 = (await repo.getDocument('famA', 'd1'))!;
    d1.actions[0].completed = true;
    await repo.saveDocument(d1);
    expect((await repo.getDocument('famA', 'd1'))!.actions[0].completed).toBe(true);
    expect((await repo.getDocument('famA', 'd1'))!.expire_at).toBe('2099-01-01T00:00:00.000Z');

    expect(await repo.deleteDocument('famB', 'd1')).toBe(false);
    expect(await repo.deleteDocument('famA', 'd1')).toBe(true);
    expect(await repo.purgeExpiredDocuments(new Date('2026-10-10T00:00:00Z'))).toBe(1);
    expect(await repo.deleteDocumentsByFamily('famA')).toBe(1);
    expect(await repo.listDocuments('famA')).toHaveLength(0);
  });

  it('invite redeem is capped by max uses and active-family limit', async () => {
    const repo = await make();
    await repo.saveInviteCode(makeInvite('CODE1', { quota: 50, maxUses: 1 }, new Date()));
    expect((await repo.redeemInviteCode('NOPE', 'f1', 20, new Date())).ok).toBe(false);
    expect((await repo.redeemInviteCode('CODE1', 'f1', 20, new Date())).ok).toBe(true);
    const again = await repo.redeemInviteCode('CODE1', 'f2', 20, new Date());
    expect(again.ok === false && again.reason).toBe('exhausted');

    await repo.saveInviteCode(makeInvite('CODE2', { quota: 50, maxUses: 9 }, new Date()));
    const active = newFamily('Cactive', 'group', cfg, new Date());
    active.status = 'active';
    await repo.saveFamily(active);
    const full = await repo.redeemInviteCode('CODE2', 'f3', 1, new Date());
    expect(full.ok === false && full.reason).toBe('beta_full');
  });

  it('usage counters accumulate and alerts fire once', async () => {
    const repo = await make();
    await repo.addUsage('2026-10', { cost_usd: 0.5, docs: 1 });
    await repo.addUsage('2026-10', { cost_usd: 0.25, push_messages: 2 });
    const u = await repo.getUsage('2026-10');
    expect(u.cost_usd).toBeCloseTo(0.75);
    expect(u.docs).toBe(1);
    expect(u.push_messages).toBe(2);
    expect(await repo.markUsageAlert('2026-10', 'budget80')).toBe(true);
    expect(await repo.markUsageAlert('2026-10', 'budget80')).toBe(false);
    expect((await repo.getUsage('2026-09')).cost_usd).toBe(0);
  });

  it('audit and error logs list newest first', async () => {
    const repo = await make();
    await repo.addAudit({ id: 'a1', timestamp: '2026-10-01T00:00:00Z', admin_id: 'x', action: 'A', details: '' });
    await repo.addAudit({ id: 'a2', timestamp: '2026-10-02T00:00:00Z', admin_id: 'x', action: 'B', details: '' });
    expect((await repo.listAudit(10)).map(a => a.id)).toEqual(['a2', 'a1']);
    await repo.addError({ id: 'e1', timestamp: '2026-10-01T00:00:00Z', family_id: 'f', error_type: 'T', message: 'm' });
    expect((await repo.listErrors(10))[0].id).toBe('e1');
  });
});
