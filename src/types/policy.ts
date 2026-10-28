/** Personalized policy newsletter ("Bản tin chính sách"). */

export type VisaType =
  | 'gijinkoku'    // 技術・人文知識・国際業務
  | 'tokutei1'     // 特定技能1号
  | 'tokutei2'     // 特定技能2号
  | 'ginou_jisshu' // 技能実習
  | 'ikusei'       // 育成就労
  | 'student'      // 留学
  | 'family_stay'  // 家族滞在
  | 'spouse'       // 日本人・永住者の配偶者等
  | 'teijusha'     // 定住者
  | 'permanent'    // 永住者
  | 'other';

export const VISA_TYPES: Array<{ id: VisaType; label: string }> = [
  { id: 'gijinkoku', label: '技術・人文知識・国際業務' },
  { id: 'tokutei1', label: '特定技能 1号' },
  { id: 'tokutei2', label: '特定技能 2号' },
  { id: 'ginou_jisshu', label: '技能実習' },
  { id: 'ikusei', label: '育成就労' },
  { id: 'student', label: '留学 (du học)' },
  { id: 'family_stay', label: '家族滞在 (đi theo gia đình)' },
  { id: 'spouse', label: '配偶者等 (vợ/chồng người Nhật, vĩnh trú)' },
  { id: 'teijusha', label: '定住者' },
  { id: 'permanent', label: '永住者 (vĩnh trú)' },
  { id: 'other', label: 'Loại khác' },
];

/** Cities with their own source. 'other' = nationwide news only. */
export interface PolicyCity {
  id: string;
  name_vi: string;
}

export type Severity = 'red' | 'yellow' | 'green';
export const SEVERITY_ICON: Record<Severity, string> = { red: '🔴', yellow: '🟡', green: '🟢' };
export const SEVERITY_LABEL: Record<Severity, string> = { red: 'Khẩn', yellow: 'Sắp có hiệu lực', green: 'Đang lấy ý kiến' };

/** proposed = bản dự thảo / パブコメ; decided = đã chốt. */
export type PolicyStage = 'proposed' | 'decided';

/** pending = chờ admin duyệt; ignored = AI cho là không liên quan (giữ để khỏi tải lại). */
export type PolicyStatus = 'pending' | 'approved' | 'rejected' | 'ignored';

export interface PolicyAudience {
  /** Empty = everyone. */
  visa_types: VisaType[];
  /** Empty = nationwide. Set from the source, never by the model. */
  cities: string[];
  children_only: boolean;
  /** Applies to renewal/application filings made on or after effective_date. */
  renewal_related: boolean;
}

export interface PolicyItem {
  id: string;
  source_id: string;
  issuer: string;
  url: string;
  title_jp: string;
  title_vi: string;
  summary_vi: string;
  action_vi: string;
  stage: PolicyStage;
  severity: Severity;
  effective_date?: string; // YYYY-MM-DD
  deadline?: string; // YYYY-MM-DD
  audience: PolicyAudience;
  status: PolicyStatus;
  confidence: number;
  created_at: string;
  approved_at?: string;
  approved_by?: string;
  /** Users who got the 🔴 push. */
  pushed_user_ids: string[];
  /** Push attempts that LINE rejected (e.g. user never added the bot) — not retried. */
  push_failed_user_ids: string[];
}

export interface PolicyProfile {
  user_id: string;
  visa_type: VisaType;
  visa_expiry?: string; // YYYY-MM-DD
  city: string; // PolicyCity.id
  has_children: boolean;
  created_at: string;
  updated_at: string;
  last_seen_at?: string;
  /** Idempotency keys of reminders already sent, e.g. "visa90:2027-03-15". */
  reminders_sent: string[];
}

export type PolicyProfileInput = Pick<PolicyProfile, 'visa_type' | 'visa_expiry' | 'city' | 'has_children'>;

/** What the LIFF app / LINE reply shows for one item. */
export interface PolicyFeedEntry {
  id: string;
  severity: Severity;
  stage: PolicyStage;
  issuer: string;
  title_vi: string;
  summary_vi: string;
  personal_vi?: string;
  reason_vi: string;
  action_vi: string;
  url: string;
  effective_date?: string;
  deadline?: string;
  approved_at: string;
  unread: boolean;
}

export interface PolicyFeed {
  profile: PolicyProfile | null;
  options: { visa_types: typeof VISA_TYPES; cities: PolicyCity[] };
  items: PolicyFeedEntry[];
  unread_count: number;
}
