export type DocType =
  | 'otayori'      // お便り (Thông báo trường / nhà trẻ)
  | 'nenkan_yotei' // 年間行事予定表 (Lịch năm học)
  | 'kondate'      // 献立表 (Thực đơn trường)
  | 'yakusho'      // 役所 (Giấy tờ UBND / hành chính / thuế)
  | 'form'         // 提出書類 (Mẫu đơn / phiếu điều tra cần nộp)
  | 'hospital'     // 病院・健診 (Khám sức khoẻ / phiếu tiêm phòng)
  | 'kairanban'    // 回覧板 (Bản tin tổ dân phố)
  | 'meisai'       // 給与明細・請求書 (Phiếu lương / hoá đơn)
  | 'other';       // Khác

export const DOC_TYPES: DocType[] = [
  'otayori', 'nenkan_yotei', 'kondate', 'yakusho', 'form', 'hospital', 'kairanban', 'meisai', 'other',
];

export type ModelId = 'claude-haiku-5-5' | 'claude-sonnet-5-5' | 'mock';

export interface DocAction {
  id: string;
  todo_vi: string;
  deadline?: string; // YYYY-MM-DD
  deadline_uncertain?: boolean;
  completed: boolean;
  priority?: 'high' | 'normal' | 'low';
}

export interface DocEvent {
  id: string;
  title_vi: string;
  title_jp: string;
  date: string; // YYYY-MM-DD
  start_time?: string; // HH:mm
  end_time?: string; // HH:mm
  time?: string; // display string, e.g. "08:45 - 14:30"
  date_uncertain?: boolean;
  location?: string;
  description_vi?: string;
}

export interface ExtractedDocument {
  id: string;
  family_id: string;
  created_at: string;
  expire_at: string;
  doc_type: DocType;
  title_jp: string;
  title_vi: string;
  issuer: string;
  summary_vi: string;
  actions: DocAction[];
  items_to_bring: string[];
  events: DocEvent[];
  warnings_vi?: string[];
  confidence: number;
  model_used: ModelId;
  pages_count: number;
  feedback?: 'up' | 'down' | null;
  date_corrections?: string[];
  token_usage?: {
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
  };
  disclaimer?: string;
  is_urgent?: boolean;
  urgent_notified_at?: string;
  urgent_reason?: string;
}

export type FamilyStatus = 'pending_terms' | 'pending_invite' | 'active' | 'suspended' | 'left';

export interface Family {
  family_id: string;
  line_chat_id: string;
  chat_type: 'group' | 'room' | 'user';
  family_name: string;
  invite_code: string;
  status: FamilyStatus;
  quota_limit: number;
  quota_used: number;
  quota_month: string; // YYYY-MM (JST); quota_used resets when month changes
  ics_token: string;
  created_at: string;
  last_active: string;
  terms_accepted_at?: string;
  left_at?: string; // bot removed from group -> data purged 7 days later
  pending_delete_until?: string; // "xóa dữ liệu" confirmation window
  member_user_ids: string[]; // LINE userIds seen in this chat (for LIFF access)
  members_count?: number;
  /** Client-only: derived by the API. */
  ics_url?: string;
}

export interface InviteCode {
  code: string;
  quota_per_family: number;
  max_uses: number;
  used_count: number;
  is_active: boolean;
  created_at: string;
  expires_at: string;
  note?: string;
}

export interface MonthlyUsage {
  month: string; // YYYY-MM
  cost_usd: number;
  docs: number;
  pages: number;
  push_messages: number;
  sonnet_docs: number;
}

export interface ErrorLog {
  id: string;
  timestamp: string;
  family_id: string;
  error_type: string;
  message: string; // never document content
}

export interface AdminMetrics {
  total_families: number;
  active_families: number;
  max_beta_families: number;
  total_documents_processed: number;
  docs_by_type: Record<DocType, number>;
  monthly_cost_usd: number;
  monthly_budget_usd: number;
  accuracy_rate: number | null;
  thumbs_up: number;
  thumbs_down: number;
  push_messages_used: number;
  push_messages_limit: number;
  urgent_docs_count: number;
  recent_errors: ErrorLog[];
}

export interface AuditLog {
  id: string;
  timestamp: string;
  admin_id: string;
  action: string;
  target_family_id?: string;
  details: string; // Strictly no personal document content
}

export interface ComposeRenrakuRequest {
  topic: 'absence' | 'lateness' | 'general' | 'health';
  content_vi: string;
  child_name?: string;
  class_name?: string;
}

export interface ComposeRenrakuResponse {
  japanese_text: string;
  vietnamese_back_translation: string;
  furigana_notes?: string;
  etiquette_tips: string;
}

export interface MeResponse {
  user_id: string;
  is_admin: boolean;
  dev_mode: boolean;
  liff_id: string | null;
  families: Array<{ family_id: string; family_name: string }>;
}
