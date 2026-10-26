export type DocType =
  | 'otayori'      // お便り (Thông báo trường / nhà trẻ)
  | 'nenkan_yotei'// 年間行事予定表 (Lịch năm học)
  | 'kondate'     // 献立表 (Thực đơn trường)
  | 'yakusho'     // 役所 (Giấy tờ UBND / hành chính / thuế)
  | 'form'        // 提出書類 (Mẫu đơn / phiếu điều tra cần nộp)
  | 'hospital'    // 病院・健診 (Khám sức khoẻ / phiếu tiêm phòng)
  | 'kairanban'   // 回覧板 (Bản tin tổ dân phố)
  | 'meisai'      // 給与明細・請求書 (Phiếu lương / hoá đơn)
  | 'other';      // Khác

export interface DocAction {
  id: string;
  todo_vi: string;
  deadline?: string;
  completed: boolean;
  priority?: 'high' | 'normal' | 'low';
}

export interface DocEvent {
  id: string;
  title_vi: string;
  title_jp: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm or e.g. 09:30 - 11:30
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
  confidence: number;
  model_used: 'claude-haiku-5-5' | 'claude-sonnet-5-5' | 'gemini-2.5-flash';
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

export interface Family {
  family_id: string;
  line_chat_id: string;
  chat_type: 'group' | 'user';
  family_name: string;
  invite_code: string;
  status: 'pending_terms' | 'pending_invite' | 'active' | 'suspended';
  quota_limit: number; // default 50
  quota_used: number;
  ics_token: string;
  created_at: string;
  last_active: string;
  members_count?: number;
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

export interface AdminMetrics {
  total_families: number;
  active_families: number;
  max_beta_families: number; // 20
  total_documents_processed: number;
  docs_by_type: Record<DocType, number>;
  monthly_cost_usd: number;
  monthly_budget_usd: number; // 20.0
  accuracy_rate: number; // e.g. 96.5%
  thumbs_up: number;
  thumbs_down: number;
  push_messages_used: number;
  push_messages_limit: number; // 200
  urgent_docs_count: number;
  recent_errors: Array<{
    id: string;
    timestamp: string;
    family_id: string;
    error_type: string;
    message: string;
  }>;
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
