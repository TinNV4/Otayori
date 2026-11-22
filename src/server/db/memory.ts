import fs from 'fs';
import path from 'path';
import { AuditLog, ErrorLog, ExtractedDocument, Family, InviteCode, MonthlyUsage } from '../../types/index.ts';
import { PolicyItem, PolicyProfile, PolicyStatus } from '../../types/policy.ts';
import { emptyUsage, RedeemResult, Repo, UsageDelta } from './repo.ts';

interface Snapshot {
  families: Family[];
  documents: ExtractedDocument[];
  invites: InviteCode[];
  usage: MonthlyUsage[];
  audit: AuditLog[];
  errors: ErrorLog[];
  policyProfiles?: PolicyProfile[];
  policyItems?: PolicyItem[];
}

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory repo for tests and local dev; optionally persisted to a JSON file. */
export class MemoryRepo implements Repo {
  private families = new Map<string, Family>();
  private documents = new Map<string, ExtractedDocument>();
  private invites = new Map<string, InviteCode>();
  private usage = new Map<string, MonthlyUsage>();
  private audit: AuditLog[] = [];
  private errors: ErrorLog[] = [];
  private policyProfiles = new Map<string, PolicyProfile>();
  private policyItems = new Map<string, PolicyItem>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly filePath?: string) {
    if (filePath && fs.existsSync(filePath)) {
      const snap: Snapshot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      snap.families.forEach(f => this.families.set(f.family_id, f));
      snap.documents.forEach(d => this.documents.set(d.id, d));
      snap.invites.forEach(i => this.invites.set(i.code, i));
      snap.usage.forEach(u => this.usage.set(u.month, u));
      this.audit = snap.audit || [];
      this.errors = snap.errors || [];
      (snap.policyProfiles || []).forEach(p => this.policyProfiles.set(p.user_id, p));
      (snap.policyItems || []).forEach(i => this.policyItems.set(i.id, i));
    }
  }

  private touch() {
    if (!this.filePath || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushSync();
    }, 200);
  }

  flushSync() {
    if (!this.filePath) return;
    const snap: Snapshot = {
      families: [...this.families.values()],
      documents: [...this.documents.values()],
      invites: [...this.invites.values()],
      usage: [...this.usage.values()],
      audit: this.audit,
      errors: this.errors,
      policyProfiles: [...this.policyProfiles.values()],
      policyItems: [...this.policyItems.values()],
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(snap, null, 2));
  }

  async getFamily(id: string) { const f = this.families.get(id); return f ? clone(f) : null; }
  async getFamilyByIcsToken(token: string) {
    for (const f of this.families.values()) if (f.ics_token === token) return clone(f);
    return null;
  }
  async findFamiliesByMember(userId: string) {
    return [...this.families.values()].filter(f => f.member_user_ids.includes(userId)).map(clone);
  }
  async listFamilies() { return [...this.families.values()].map(clone); }
  async saveFamily(f: Family) { this.families.set(f.family_id, clone(f)); this.touch(); }
  async deleteFamily(id: string) { this.families.delete(id); this.touch(); }

  async getInviteCode(code: string) { const i = this.invites.get(code); return i ? clone(i) : null; }
  async listInviteCodes() { return [...this.invites.values()].map(clone); }
  async saveInviteCode(i: InviteCode) { this.invites.set(i.code, clone(i)); this.touch(); }
  async redeemInviteCode(code: string, familyId: string, maxActive: number, now: Date): Promise<RedeemResult> {
    const inv = this.invites.get(code);
    if (!inv) return { ok: false, reason: 'not_found' };
    if (!inv.is_active) return { ok: false, reason: 'inactive' };
    if (Date.parse(inv.expires_at) < now.getTime()) return { ok: false, reason: 'expired' };
    if (inv.used_count >= inv.max_uses) return { ok: false, reason: 'exhausted' };
    const active = [...this.families.values()].filter(f => f.status === 'active' && f.family_id !== familyId).length;
    if (active >= maxActive) return { ok: false, reason: 'beta_full' };
    inv.used_count += 1;
    this.touch();
    return { ok: true, invite: clone(inv) };
  }

  async addDocument(d: ExtractedDocument) { this.documents.set(d.id, clone(d)); this.touch(); }
  async getDocument(familyId: string, id: string) {
    const d = this.documents.get(id);
    return d && d.family_id === familyId ? clone(d) : null;
  }
  async listDocuments(familyId: string) {
    return [...this.documents.values()]
      .filter(d => d.family_id === familyId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(clone);
  }
  async saveDocument(d: ExtractedDocument) {
    const existing = this.documents.get(d.id);
    if (existing && existing.family_id !== d.family_id) throw new Error('family_id mismatch');
    this.documents.set(d.id, clone(d));
    this.touch();
  }
  async deleteDocument(familyId: string, id: string) {
    const d = this.documents.get(id);
    if (!d || d.family_id !== familyId) return false;
    this.documents.delete(id);
    this.touch();
    return true;
  }
  async deleteDocumentsByFamily(familyId: string) {
    let n = 0;
    for (const [id, d] of this.documents) if (d.family_id === familyId) { this.documents.delete(id); n++; }
    this.touch();
    return n;
  }
  async listDocumentMeta() {
    return [...this.documents.values()].map(d => ({
      doc_type: d.doc_type, feedback: d.feedback, is_urgent: d.is_urgent, created_at: d.created_at, family_id: d.family_id,
    }));
  }
  async purgeExpiredDocuments(now: Date) {
    let n = 0;
    for (const [id, d] of this.documents) if (Date.parse(d.expire_at) <= now.getTime()) { this.documents.delete(id); n++; }
    if (n) this.touch();
    return n;
  }

  async getUsage(month: string) { return clone(this.usage.get(month) || emptyUsage(month)); }
  async addUsage(month: string, delta: UsageDelta) {
    const u = this.usage.get(month) || emptyUsage(month);
    u.cost_usd += delta.cost_usd || 0;
    u.docs += delta.docs || 0;
    u.pages += delta.pages || 0;
    u.push_messages += delta.push_messages || 0;
    u.sonnet_docs += delta.sonnet_docs || 0;
    this.usage.set(month, u);
    this.touch();
  }

  async markUsageAlert(month: string, key: string) {
    const u = this.usage.get(month) || emptyUsage(month);
    if (u.alerts?.includes(key)) return false;
    u.alerts = [...(u.alerts || []), key];
    this.usage.set(month, u);
    this.touch();
    return true;
  }

  async getPolicyProfile(userId: string) { const p = this.policyProfiles.get(userId); return p ? clone(p) : null; }
  async savePolicyProfile(p: PolicyProfile) { this.policyProfiles.set(p.user_id, clone(p)); this.touch(); }
  async deletePolicyProfile(userId: string) {
    const had = this.policyProfiles.delete(userId);
    if (had) this.touch();
    return had;
  }
  async listPolicyProfiles() { return [...this.policyProfiles.values()].map(clone); }
  async getPolicyItem(id: string) { const i = this.policyItems.get(id); return i ? clone(i) : null; }
  async savePolicyItem(i: PolicyItem) { this.policyItems.set(i.id, clone(i)); this.touch(); }
  async listPolicyItems(status?: PolicyStatus) {
    return [...this.policyItems.values()]
      .filter(i => !status || i.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(clone);
  }

  async addAudit(log: AuditLog) { this.audit.push(log); if (this.audit.length > 1000) this.audit.shift(); this.touch(); }
  async listAudit(limit: number) { return this.audit.slice(-limit).reverse(); }
  async addError(e: ErrorLog) { this.errors.push(e); if (this.errors.length > 500) this.errors.shift(); this.touch(); }
  async listErrors(limit: number) { return this.errors.slice(-limit).reverse(); }
}
