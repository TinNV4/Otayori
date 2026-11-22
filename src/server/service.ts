import crypto from 'crypto';
import { AppConfig } from './config.ts';
import { Repo } from './db/repo.ts';
import { Family, InviteCode } from '../types/index.ts';
import { jstMonth } from './time.ts';

export function familyIdForChat(chatId: string): string {
  return `fam_${crypto.createHash('sha256').update(chatId).digest('hex').slice(0, 16)}`;
}

export function newIcsToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function newFamily(chatId: string, chatType: Family['chat_type'], cfg: AppConfig, now: Date): Family {
  const id = familyIdForChat(chatId);
  return {
    family_id: id,
    line_chat_id: chatId,
    chat_type: chatType,
    family_name: `Gia đình #${id.slice(4, 8).toUpperCase()}`,
    invite_code: '',
    status: 'pending_terms',
    quota_limit: cfg.defaultQuota,
    quota_used: 0,
    quota_month: jstMonth(now),
    ics_token: newIcsToken(),
    created_at: now.toISOString(),
    last_active: now.toISOString(),
    member_user_ids: [],
  };
}

/** Reset monthly quota when the JST month rolls over. Returns true if changed. */
export function rollQuotaMonth(family: Family, now: Date): boolean {
  const m = jstMonth(now);
  let changed = false;
  if (family.lookup_month !== m && (family.lookup_used || family.lookup_month)) {
    family.lookup_month = m;
    family.lookup_used = 0;
    changed = true;
  }
  if (family.quota_month === m) return changed;
  family.quota_month = m;
  family.quota_used = 0;
  return true;
}

export function icsUrl(cfg: AppConfig, family: Family): string {
  return `${cfg.publicBaseUrl}/ics/${family.ics_token}.ics`;
}

/** Human "add to calendar" page; `openExternalBrowser=1` makes LINE open it in Safari/Chrome. */
export function calendarPageUrl(cfg: AppConfig, family: Family): string {
  return `${cfg.publicBaseUrl}/cal/${family.ics_token}?openExternalBrowser=1`;
}

export function liffUrl(cfg: AppConfig, params: Record<string, string> = {}): string | null {
  const qs = new URLSearchParams(params).toString();
  if (cfg.liffId) return `https://liff.line.me/${cfg.liffId}${qs ? `?${qs}` : ''}`;
  return cfg.devMode ? `${cfg.publicBaseUrl}/${qs ? `?${qs}` : ''}` : null;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

export function makeInvite(code: string, opts: { quota: number; maxUses: number; days?: number; note?: string }, now: Date): InviteCode {
  return {
    code: normalizeCode(code),
    quota_per_family: opts.quota,
    max_uses: opts.maxUses,
    used_count: 0,
    is_active: true,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (opts.days ?? 90) * 86400_000).toISOString(),
    note: opts.note,
  };
}

export class Services {
  constructor(readonly repo: Repo, readonly cfg: AppConfig) {}

  async audit(actor: string, action: string, details: string, familyId?: string) {
    await this.repo.addAudit({
      id: `aud_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      timestamp: new Date().toISOString(),
      admin_id: actor,
      action,
      target_family_id: familyId,
      details,
    });
  }

  /** Set by the bot to watch for error spikes. */
  onError?: (familyId: string, type: string) => void;

  async logError(familyId: string, type: string, message: string) {
    console.error(`[error] ${type} family=${familyId}: ${message}`);
    try {
      this.onError?.(familyId, type);
    } catch {
      /* alerting must never break the request */
    }
    await this.repo.addError({
      id: `err_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      timestamp: new Date().toISOString(),
      family_id: familyId,
      error_type: type,
      message: message.slice(0, 300),
    }).catch(() => undefined);
  }

  /** Delete every document, rotate the ICS link and require consent + invite again. */
  async purgeFamilyData(familyId: string, actor: string): Promise<number> {
    const family = await this.repo.getFamily(familyId);
    const n = await this.repo.deleteDocumentsByFamily(familyId);
    if (family) {
      family.ics_token = newIcsToken();
      family.status = 'pending_terms';
      family.terms_accepted_at = undefined;
      family.invite_code = '';
      family.quota_used = 0;
      family.pending_delete_until = undefined;
      family.region = undefined;
      family.lookup_used = 0;
      await this.repo.saveFamily(family);
    }
    await this.audit(actor, 'DELETE_FAMILY_DATA', `Xóa ${n} tài liệu, thu hồi link lịch`, familyId);
    return n;
  }

  async rotateIcsToken(familyId: string, actor: string): Promise<string | null> {
    const family = await this.repo.getFamily(familyId);
    if (!family) return null;
    family.ics_token = newIcsToken();
    await this.repo.saveFamily(family);
    await this.audit(actor, 'ROTATE_ICS_TOKEN', 'Đổi link lịch bí mật', familyId);
    return family.ics_token;
  }

  /** Housekeeping: purge families whose bot left > N days ago and expired documents. */
  async runCleanup(now = new Date()) {
    let familiesPurged = 0;
    for (const f of await this.repo.listFamilies()) {
      if (f.status === 'left' && f.left_at && now.getTime() - Date.parse(f.left_at) > this.cfg.leftGroupPurgeDays * 86400_000) {
        await this.repo.deleteDocumentsByFamily(f.family_id);
        await this.repo.deleteFamily(f.family_id);
        await this.audit('system', 'PURGE_LEFT_FAMILY', `Bot rời nhóm > ${this.cfg.leftGroupPurgeDays} ngày`, f.family_id);
        familiesPurged++;
      }
    }
    const docsPurged = await this.repo.purgeExpiredDocuments(now);
    return { familiesPurged, docsPurged };
  }
}
