import { FieldValue, Firestore, Timestamp } from '@google-cloud/firestore';
import { AuditLog, ErrorLog, ExtractedDocument, Family, InviteCode, MonthlyUsage, UnknownItem } from '../../types/index.ts';
import { emptyUsage, RedeemResult, Repo, UsageDelta, unknownItemId } from './repo.ts';

/**
 * Firestore Native (asia-northeast1).
 * Collections: families, documents (TTL on `expire_at`), invite_codes, usage, audit_logs, error_logs (TTL on `expire_at`), unknown_items (TTL on `expire_at`, refreshed on every ask).
 */
export class FirestoreRepo implements Repo {
  private db: Firestore;

  constructor(db?: Firestore) {
    this.db = db || new Firestore({ ignoreUndefinedProperties: true });
  }

  private fam = () => this.db.collection('families');
  private docs = () => this.db.collection('documents');
  private inv = () => this.db.collection('invite_codes');

  async getFamily(id: string) {
    const s = await this.fam().doc(id).get();
    return s.exists ? (s.data() as Family) : null;
  }
  async getFamilyByIcsToken(token: string) {
    const q = await this.fam().where('ics_token', '==', token).limit(1).get();
    return q.empty ? null : (q.docs[0].data() as Family);
  }
  async findFamiliesByMember(userId: string) {
    const q = await this.fam().where('member_user_ids', 'array-contains', userId).get();
    return q.docs.map(d => d.data() as Family);
  }
  async listFamilies() {
    return (await this.fam().get()).docs.map(d => d.data() as Family);
  }
  async saveFamily(f: Family) { await this.fam().doc(f.family_id).set(f); }
  async deleteFamily(id: string) { await this.fam().doc(id).delete(); }

  async getInviteCode(code: string) {
    const s = await this.inv().doc(code).get();
    return s.exists ? (s.data() as InviteCode) : null;
  }
  async listInviteCodes() { return (await this.inv().get()).docs.map(d => d.data() as InviteCode); }
  async saveInviteCode(i: InviteCode) { await this.inv().doc(i.code).set(i); }

  async redeemInviteCode(code: string, familyId: string, maxActive: number, now: Date): Promise<RedeemResult> {
    return this.db.runTransaction(async tx => {
      const ref = this.inv().doc(code);
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false, reason: 'not_found' } as const;
      const inv = snap.data() as InviteCode;
      if (!inv.is_active) return { ok: false, reason: 'inactive' } as const;
      if (Date.parse(inv.expires_at) < now.getTime()) return { ok: false, reason: 'expired' } as const;
      if (inv.used_count >= inv.max_uses) return { ok: false, reason: 'exhausted' } as const;
      const active = await tx.get(this.fam().where('status', '==', 'active'));
      const others = active.docs.filter(d => d.id !== familyId).length;
      if (others >= maxActive) return { ok: false, reason: 'beta_full' } as const;
      tx.update(ref, { used_count: FieldValue.increment(1) });
      return { ok: true, invite: { ...inv, used_count: inv.used_count + 1 } } as const;
    });
  }

  private toStored(d: ExtractedDocument) {
    return { ...d, expire_at: Timestamp.fromDate(new Date(d.expire_at)) };
  }
  private fromStored(data: FirebaseFirestore.DocumentData): ExtractedDocument {
    const exp = data.expire_at instanceof Timestamp ? data.expire_at.toDate().toISOString() : data.expire_at;
    return { ...(data as ExtractedDocument), expire_at: exp };
  }

  async addDocument(d: ExtractedDocument) { await this.docs().doc(d.id).set(this.toStored(d)); }
  async getDocument(familyId: string, id: string) {
    const s = await this.docs().doc(id).get();
    if (!s.exists) return null;
    const d = this.fromStored(s.data()!);
    return d.family_id === familyId ? d : null;
  }
  async listDocuments(familyId: string) {
    const q = await this.docs().where('family_id', '==', familyId).get();
    return q.docs.map(s => this.fromStored(s.data()))
      .filter(d => Date.parse(d.expire_at) > Date.now()) // TTL deletion can lag up to 24h
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async saveDocument(d: ExtractedDocument) {
    const existing = await this.getDocument(d.family_id, d.id);
    if (!existing) throw new Error('document not found for family');
    await this.docs().doc(d.id).set(this.toStored(d));
  }
  async deleteDocument(familyId: string, id: string) {
    if (!(await this.getDocument(familyId, id))) return false;
    await this.docs().doc(id).delete();
    return true;
  }
  async deleteDocumentsByFamily(familyId: string) {
    const q = await this.docs().where('family_id', '==', familyId).get();
    const writer = this.db.bulkWriter();
    q.docs.forEach(s => writer.delete(s.ref));
    await writer.close();
    return q.size;
  }
  async listDocumentMeta() {
    const q = await this.docs().select('doc_type', 'feedback', 'is_urgent', 'created_at', 'family_id').get();
    return q.docs.map(s => s.data() as any);
  }
  async purgeExpiredDocuments(now: Date) {
    const q = await this.docs().where('expire_at', '<=', Timestamp.fromDate(now)).limit(500).get();
    const writer = this.db.bulkWriter();
    q.docs.forEach(s => writer.delete(s.ref));
    await writer.close();
    return q.size;
  }

  async getUsage(month: string) {
    const s = await this.db.collection('usage').doc(month).get();
    return s.exists ? ({ ...emptyUsage(month), ...(s.data() as MonthlyUsage) }) : emptyUsage(month);
  }
  async addUsage(month: string, delta: UsageDelta) {
    const inc: Record<string, unknown> = { month };
    for (const [k, v] of Object.entries(delta)) if (v) inc[k] = FieldValue.increment(v);
    await this.db.collection('usage').doc(month).set(inc, { merge: true });
  }

  async markUsageAlert(month: string, key: string) {
    const ref = this.db.collection('usage').doc(month);
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const alerts: string[] = (snap.exists && (snap.data() as MonthlyUsage).alerts) || [];
      if (alerts.includes(key)) return false;
      tx.set(ref, { month, alerts: FieldValue.arrayUnion(key) }, { merge: true });
      return true;
    });
  }

  async addAudit(log: AuditLog) { await this.db.collection('audit_logs').doc(log.id).set(log); }
  async listAudit(limit: number) {
    const q = await this.db.collection('audit_logs').orderBy('timestamp', 'desc').limit(limit).get();
    return q.docs.map(d => d.data() as AuditLog);
  }
  async addError(e: ErrorLog) {
    await this.db.collection('error_logs').doc(e.id).set({
      ...e, expire_at: Timestamp.fromDate(new Date(Date.now() + 30 * 86400_000)),
    });
  }
  async listErrors(limit: number) {
    const q = await this.db.collection('error_logs').orderBy('timestamp', 'desc').limit(limit).get();
    return q.docs.map(d => { const { expire_at, ...rest } = d.data(); return rest as ErrorLog; });
  }

  async logUnknownItem(cityCode: string, nameJp: string, nameVi: string, now: Date) {
    const ref = this.db.collection('unknown_items').doc(unknownItemId(cityCode, nameJp));
    const expire_at = Timestamp.fromDate(new Date(now.getTime() + 180 * 86400_000));
    await this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const cur = snap.data() as UnknownItem;
        tx.update(ref, { count: FieldValue.increment(1), last_seen: now.toISOString(), expire_at, ...(nameVi && !cur.name_vi ? { name_vi: nameVi } : {}) });
      } else {
        tx.set(ref, { id: ref.id, city_code: cityCode, name_jp: nameJp, name_vi: nameVi, count: 1, first_seen: now.toISOString(), last_seen: now.toISOString(), expire_at });
      }
    });
  }
  async listUnknownItems(limit: number) {
    const q = await this.db.collection('unknown_items').orderBy('count', 'desc').limit(limit).get();
    return q.docs.map(d => { const { expire_at, ...rest } = d.data(); return rest as UnknownItem; });
  }
}
