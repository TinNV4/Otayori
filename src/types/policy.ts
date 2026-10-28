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

export type ContractType = 'seishain' | 'part' | 'other' | 'none';
export const CONTRACT_TYPES: Array<{ id: ContractType; label: string }> = [
  { id: 'seishain', label: '正社員 (nhân viên chính thức)' },
  { id: 'part', label: 'パート・アルバイト' },
  { id: 'other', label: 'Khác (haken, tự kinh doanh…)' },
  { id: 'none', label: 'Không đi làm' },
];

export type LicenseStatus = 'none' | 'japan' | 'converting';
export const LICENSE_STATUSES: Array<{ id: LicenseStatus; label: string }> = [
  { id: 'none', label: 'Chưa có bằng lái' },
  { id: 'japan', label: 'Có bằng lái Nhật' },
  { id: 'converting', label: 'Đang định đổi bằng nước ngoài sang bằng Nhật (外免切替)' },
];

export type FuturePlan = 'permanent' | 'return' | 'undecided';
export const FUTURE_PLANS: Array<{ id: FuturePlan; label: string }> = [
  { id: 'permanent', label: 'Định xin vĩnh trú (永住)' },
  { id: 'return', label: 'Định về nước' },
  { id: 'undecided', label: 'Chưa quyết định' },
];

/** 住民税: 特別徴収 = the employer deducts it; 普通徴収 = you pay with payment slips yourself. */
export type ResidentTax = 'special' | 'ordinary' | 'unknown';
export const RESIDENT_TAX: Array<{ id: ResidentTax; label: string }> = [
  { id: 'special', label: 'Công ty trừ vào lương (特別徴収)' },
  { id: 'ordinary', label: 'Tự đóng bằng phiếu nộp tiền (普通徴収)' },
  { id: 'unknown', label: 'Không rõ' },
];

/** 特定技能 fields (only asked when the visa is 特定技能). */
export const TOKUTEI_SECTORS: Array<{ id: string; label: string }> = [
  { id: 'kaigo', label: '介護 (điều dưỡng)' },
  { id: 'building_cleaning', label: 'ビルクリーニング' },
  { id: 'manufacturing', label: 'Chế tạo (素形材・産業機械・電気電子)' },
  { id: 'construction', label: '建設 (xây dựng)' },
  { id: 'shipbuilding', label: '造船・舶用工業' },
  { id: 'auto_maintenance', label: '自動車整備' },
  { id: 'aviation', label: '航空' },
  { id: 'lodging', label: '宿泊 (khách sạn)' },
  { id: 'agriculture', label: '農業' },
  { id: 'fishery', label: '漁業' },
  { id: 'food_manufacturing', label: '飲食料品製造業' },
  { id: 'restaurant', label: '外食業' },
  { id: 'auto_transport', label: '自動車運送業' },
  { id: 'railway', label: '鉄道' },
  { id: 'forestry', label: '林業' },
  { id: 'wood', label: '木材産業' },
];

export type Tier = 'free' | 'premium';

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
  /** Only for people who hold or plan to convert a driving licence. */
  license_only?: boolean;
  /** 特定技能 fields the item is limited to (empty = all). */
  sectors?: string[];
  /** Empty = all. */
  contract_types?: ContractType[];
  /** Empty = all. */
  plans?: FuturePlan[];
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
  // ---- optional extras: unknown = never excludes the user from a news item ----
  license_status?: LicenseStatus;
  license_expiry?: string; // YYYY-MM-DD
  contract_type?: ContractType;
  sector?: string; // TOKUTEI_SECTORS id, only for 特定技能
  plan?: FuturePlan;
  resident_tax?: ResidentTax;
  /** Free by default; set by the admin (`npm run policy -- tier`). */
  tier?: Tier;
  /** The per-user rich menu with the red dot is currently shown. */
  menu_dot?: boolean;
  /** Idempotency keys of reminders already sent, e.g. "visa90:2027-03-15". */
  reminders_sent: string[];
}

export type PolicyProfileInput = Pick<PolicyProfile, 'visa_type' | 'visa_expiry' | 'city' | 'has_children'> &
  Partial<Pick<PolicyProfile, 'license_status' | 'license_expiry' | 'contract_type' | 'sector' | 'plan' | 'resident_tax'>>;

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
  options: {
    visa_types: typeof VISA_TYPES;
    cities: PolicyCity[];
    contract_types: typeof CONTRACT_TYPES;
    license_statuses: typeof LICENSE_STATUSES;
    plans: typeof FUTURE_PLANS;
    resident_tax: typeof RESIDENT_TAX;
    sectors: typeof TOKUTEI_SECTORS;
  };
  items: PolicyFeedEntry[];
  unread_count: number;
}
