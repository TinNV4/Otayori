import { AuditLog, ErrorLog, ExtractedDocument, Family, InviteCode, MonthlyUsage } from '../../types/index.ts';
import { PolicyItem, PolicyProfile, PolicyStatus } from '../../types/policy.ts';

export type RedeemResult =
  | { ok: true; invite: InviteCode }
  | { ok: false; reason: 'not_found' | 'inactive' | 'expired' | 'exhausted' | 'beta_full' };

export interface UsageDelta {
  cost_usd?: number;
  docs?: number;
  pages?: number;
  push_messages?: number;
  sonnet_docs?: number;
}

/**
 * Persistence boundary. Every document read takes a familyId and implementations
 * must filter by it — that is the tenant isolation guarantee.
 */
export interface Repo {
  getFamily(familyId: string): Promise<Family | null>;
  getFamilyByIcsToken(token: string): Promise<Family | null>;
  findFamiliesByMember(userId: string): Promise<Family[]>;
  listFamilies(): Promise<Family[]>;
  saveFamily(family: Family): Promise<void>;
  deleteFamily(familyId: string): Promise<void>;

  getInviteCode(code: string): Promise<InviteCode | null>;
  listInviteCodes(): Promise<InviteCode[]>;
  saveInviteCode(invite: InviteCode): Promise<void>;
  /** Atomically checks + increments invite usage and the beta family cap. */
  redeemInviteCode(code: string, familyId: string, maxActiveFamilies: number, now: Date): Promise<RedeemResult>;

  addDocument(doc: ExtractedDocument): Promise<void>;
  getDocument(familyId: string, docId: string): Promise<ExtractedDocument | null>;
  listDocuments(familyId: string): Promise<ExtractedDocument[]>;
  saveDocument(doc: ExtractedDocument): Promise<void>;
  deleteDocument(familyId: string, docId: string): Promise<boolean>;
  deleteDocumentsByFamily(familyId: string): Promise<number>;
  /** Metadata-only scan for admin metrics (callers must not expose content). */
  listDocumentMeta(): Promise<Array<Pick<ExtractedDocument, 'doc_type' | 'feedback' | 'is_urgent' | 'created_at' | 'family_id'>>>;
  purgeExpiredDocuments(now: Date): Promise<number>;

  getUsage(month: string): Promise<MonthlyUsage>;
  addUsage(month: string, delta: UsageDelta): Promise<void>;
  /** Record that an alert was sent this month; returns false if it already was (send once). */
  markUsageAlert(month: string, key: string): Promise<boolean>;

  /** Policy newsletter: profiles are per LINE user (not per family) and only the owner may read/delete theirs. */
  getPolicyProfile(userId: string): Promise<PolicyProfile | null>;
  savePolicyProfile(profile: PolicyProfile): Promise<void>;
  deletePolicyProfile(userId: string): Promise<boolean>;
  listPolicyProfiles(): Promise<PolicyProfile[]>;
  getPolicyItem(id: string): Promise<PolicyItem | null>;
  /** Upsert. */
  savePolicyItem(item: PolicyItem): Promise<void>;
  listPolicyItems(status?: PolicyStatus): Promise<PolicyItem[]>;

  addAudit(log: AuditLog): Promise<void>;
  listAudit(limit: number): Promise<AuditLog[]>;
  addError(err: ErrorLog): Promise<void>;
  listErrors(limit: number): Promise<ErrorLog[]>;
}

export function emptyUsage(month: string): MonthlyUsage {
  return { month, cost_usd: 0, docs: 0, pages: 0, push_messages: 0, sonnet_docs: 0 };
}
