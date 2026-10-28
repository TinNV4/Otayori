import {
  CONTRACT_TYPES, FUTURE_PLANS, PolicyFeedEntry, PolicyItem, PolicyProfile, PolicyStage, SEVERITY_ICON, Severity, TOKUTEI_SECTORS, VISA_TYPES,
} from '../../types/policy.ts';
import { POLICY_CITIES } from './sources.ts';

/** Everything here is deterministic on purpose: who gets which message is never decided by the model. */

const DAY = 86400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** Same day-of-month N months earlier, clamped to the month's length (31/5 − 3 months → 28/2). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** In Japan a renewal can be filed from 3 months before the period of stay ends. */
export const renewalWindowOpens = (expiry: string) => addMonths(expiry, -3);

export const fmtDay = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`;
export const fmtMonth = (iso: string) => `${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`;

const labelOf = (list: Array<{ id: string; label: string }>, id: string) => (list.find(x => x.id === id)?.label ?? id).replace(/\s*\(.*$/, '');
export const visaLabel = (id: string) => VISA_TYPES.find(v => v.id === id)?.label ?? id;
export const cityLabel = (id: string) => POLICY_CITIES.find(c => c.id === id)?.name_vi ?? id;

/**
 * Suggested colour (admin can override on approval):
 * 🟢 draft for comment · 🔴 decided and the date that matters is ≤30 days away (or passed) · 🟡 decided, later.
 */
export function suggestSeverity(stage: PolicyStage, today: string, effective?: string, deadline?: string): Severity {
  if (stage === 'proposed') return 'green';
  const date = deadline || effective;
  if (!date) return 'yellow';
  return daysBetween(today, date) <= 30 ? 'red' : 'yellow';
}

export interface Match {
  /** "Vì sao bạn nhận tin này" — always present. */
  reason_vi: string;
  /** Sentence computed from the user's own dates (only when it can be). */
  personal_vi?: string;
}

/** null = this item is not for this user. */
export function matchItem(profile: PolicyProfile, item: PolicyItem): Match | null {
  const a = item.audience;
  if (a.cities.length && !a.cities.includes(profile.city)) return null;
  if (a.visa_types.length && !a.visa_types.includes(profile.visa_type)) return null;
  if (a.children_only && !profile.has_children) return null;
  // Optional profile answers only ever exclude when the user actually answered; unknown = still informed.
  if (a.license_only && profile.license_status === 'none') return null;
  if (a.sectors?.length) {
    const tokutei = profile.visa_type === 'tokutei1' || profile.visa_type === 'tokutei2';
    if (!tokutei || (profile.sector && !a.sectors.includes(profile.sector))) return null;
  }
  if (a.contract_types?.length && profile.contract_type && !a.contract_types.includes(profile.contract_type)) return null;
  if (a.plans?.length && profile.plan && !a.plans.includes(profile.plan)) return null;
  // Visa ends before the new rule applies: this user files under the old rule, nothing changes for them.
  if (a.renewal_related && item.effective_date && profile.visa_expiry && profile.visa_expiry < item.effective_date) return null;

  const why: string[] = [];
  if (a.cities.length) why.push(`bạn sống ở ${cityLabel(profile.city)}`);
  if (a.visa_types.length) why.push(`visa của bạn là ${visaLabel(profile.visa_type)}`);
  if (a.children_only) why.push('nhà bạn có con nhỏ');
  if (a.sectors?.length && profile.sector) why.push(`bạn làm ngành ${labelOf(TOKUTEI_SECTORS, profile.sector)}`);
  if (a.contract_types?.length && profile.contract_type) why.push(`hợp đồng của bạn là ${labelOf(CONTRACT_TYPES, profile.contract_type)}`);
  if (a.plans?.length && profile.plan) why.push(`kế hoạch của bạn: ${labelOf(FUTURE_PLANS, profile.plan).toLowerCase()}`);
  if (a.license_only && profile.license_status && profile.license_status !== 'none') why.push('bạn có / đang định đổi bằng lái');
  if (a.renewal_related && profile.visa_expiry) why.push(`visa của bạn hết hạn ${fmtMonth(profile.visa_expiry)}`);
  const reason_vi = why.length ? `Vì ${why.join(' và ')}.` : 'Tin áp dụng cho mọi người đang sống ở Nhật.';

  let personal_vi: string | undefined;
  if (a.renewal_related && profile.visa_expiry) {
    const open = renewalWindowOpens(profile.visa_expiry);
    personal_vi = `Visa của bạn hết hạn ${fmtMonth(profile.visa_expiry)} → bạn có thể nộp đơn gia hạn từ ${fmtMonth(open)}`;
    if (item.effective_date) {
      personal_vi += open >= item.effective_date
        ? ` — sau ngày áp dụng (${fmtDay(item.effective_date)}) nên sẽ theo quy định mới.`
        : `. Quy định mới áp dụng từ ${fmtDay(item.effective_date)}; nếu bạn nộp trước ngày đó, hãy kiểm tra nguồn chính thức xem đơn tính theo quy định nào.`;
    } else {
      personal_vi += '.';
    }
  }
  return { reason_vi, personal_vi };
}

const RANK: Record<Severity, number> = { red: 0, yellow: 1, green: 2 };

/** Approved items still worth showing: hide those whose date passed >14 days ago, and anything older than 180 days. */
export function isActive(item: PolicyItem, today: string): boolean {
  if (item.status !== 'approved') return false;
  const date = item.deadline || item.effective_date;
  if (date && daysBetween(today, date) < -14) return false;
  return !item.approved_at || daysBetween(item.approved_at.slice(0, 10), today) <= 180;
}

export function buildFeed(profile: PolicyProfile, items: PolicyItem[], today: string): PolicyFeedEntry[] {
  const out: PolicyFeedEntry[] = [];
  for (const item of items) {
    if (!isActive(item, today)) continue;
    const m = matchItem(profile, item);
    if (!m) continue;
    out.push({
      id: item.id,
      severity: item.severity,
      stage: item.stage,
      issuer: item.issuer,
      title_vi: item.title_vi,
      summary_vi: item.summary_vi,
      personal_vi: m.personal_vi,
      reason_vi: m.reason_vi,
      action_vi: item.action_vi,
      url: item.url,
      effective_date: item.effective_date,
      deadline: item.deadline,
      approved_at: item.approved_at || item.created_at,
      unread: !profile.last_seen_at || (item.approved_at || item.created_at) > profile.last_seen_at,
    });
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.deadline || a.effective_date || '9').localeCompare(b.deadline || b.effective_date || '9'));
}

/** One LINE message: why you got it · what to do · official source. */
export function formatPolicyMessage(e: Pick<PolicyFeedEntry, 'severity' | 'title_vi' | 'summary_vi' | 'personal_vi' | 'reason_vi' | 'action_vi' | 'issuer' | 'url' | 'effective_date' | 'deadline'>): string {
  const dates = [e.deadline && `Hạn: ${fmtDay(e.deadline)}`, e.effective_date && `Áp dụng từ: ${fmtDay(e.effective_date)}`].filter(Boolean).join(' · ');
  return [
    `${SEVERITY_ICON[e.severity]} ${e.title_vi}`,
    dates,
    e.personal_vi || e.summary_vi,
    `💡 Vì sao bạn nhận tin: ${e.reason_vi}`,
    e.action_vi && `✅ Việc cần làm: ${e.action_vi}`,
    `🔗 Nguồn: ${e.issuer}\n${e.url}`,
    'ℹ️ Tóm tắt từ nguồn chính thức, không phải tư vấn pháp lý. Hãy kiểm tra lại trên trang gốc.',
  ].filter(Boolean).join('\n');
}

export interface Reminder {
  /** Idempotency key stored in profile.reminders_sent. */
  key: string;
  text: string;
}

const VISA_REMIND_DAYS = 90;
const LICENSE_REMIND_DAYS = 60;
const TAX_REMIND_DAYS = 7;
/** Months whose last day is the usual 普通徴収 due date (Jun/Aug/Oct/Jan). Varies by city — the message says so. */
const TAX_DUE_MONTHS = [6, 8, 10, 1];

const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Personal deadlines due for a reminder today (the caller sends each key once). */
export function remindersDue(p: PolicyProfile, today: string): Reminder[] {
  const out: Reminder[] = [];

  if (p.visa_expiry) {
    const days = daysBetween(today, p.visa_expiry);
    if (days >= 0 && days <= VISA_REMIND_DAYS) {
      out.push({
        key: `visa${VISA_REMIND_DAYS}:${p.visa_expiry}`,
        text: [
          `⏰ Visa (在留期間) của bạn hết hạn ngày ${fmtDay(p.visa_expiry)} — còn ${days} ngày.`,
          '💡 Vì sao bạn nhận tin: bạn đã nhập ngày hết hạn visa trong hồ sơ.',
          `✅ Việc cần làm: có thể nộp đơn gia hạn từ ${fmtDay(renewalWindowOpens(p.visa_expiry))} (3 tháng trước hạn). Bắt đầu chuẩn bị giấy tờ sớm.`,
          '🔗 Nguồn: 出入国在留管理庁\nhttps://www.moj.go.jp/isa/',
        ].join('\n'),
      });
    }
  }

  if (p.license_expiry && p.license_status !== 'none') {
    const days = daysBetween(today, p.license_expiry);
    if (days >= 0 && days <= LICENSE_REMIND_DAYS) {
      out.push({
        key: `lic${LICENSE_REMIND_DAYS}:${p.license_expiry}`,
        text: [
          `⏰ Bằng lái của bạn hết hạn ngày ${fmtDay(p.license_expiry)} — còn ${days} ngày.`,
          '💡 Vì sao bạn nhận tin: bạn đã nhập ngày hết hạn bằng lái trong hồ sơ.',
          '✅ Việc cần làm: kiểm tra nơi và thời gian được gia hạn tại 運転免許センター / 警察署 và chuẩn bị giấy tờ trước.',
          '🔗 Nguồn: 警察庁\nhttps://www.npa.go.jp/bureau/traffic/index.html',
        ].join('\n'),
      });
    }
  }

  if (p.resident_tax === 'ordinary') {
    const [y, m] = today.split('-').map(Number);
    for (const [year, month] of [[y, m], [m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1]]) {
      if (!TAX_DUE_MONTHS.includes(month)) continue;
      const due = `${year}-${String(month).padStart(2, '0')}-${lastDayOf(year, month)}`;
      const days = daysBetween(today, due);
      if (days >= 0 && days <= TAX_REMIND_DAYS) {
        out.push({
          key: `jt:${year}-${String(month).padStart(2, '0')}`,
          text: [
            `⏰ Kỳ đóng 住民税 (thuế cư trú) thường hết hạn cuối tháng ${month} — còn ${days} ngày (${fmtDay(due)}).`,
            '💡 Vì sao bạn nhận tin: bạn chọn tự đóng 住民税 bằng phiếu nộp tiền (普通徴収).',
            '✅ Việc cần làm: xem hạn ghi trên phiếu 納付書 của bạn (mỗi thành phố có thể khác) và đóng ở konbini / ngân hàng / app. Chưa nhận được phiếu thì hỏi ward office.',
            '🔗 Nguồn: phiếu 納付書 do ward/city office gửi cho bạn',
          ].join('\n'),
        });
      }
    }
  }
  return out;
}

export { daysBetween };
