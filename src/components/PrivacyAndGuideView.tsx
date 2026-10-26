import React, { useState } from 'react';
import {
  ShieldCheck,
  BookOpen,
  Server,
  Lock,
  Trash2,
  Globe,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  FileCode,
  Copy,
  Check,
} from 'lucide-react';

export const PrivacyAndGuideView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'privacy' | 'guide' | 'checklist'>('privacy');
  const [lang, setLang] = useState<'vi' | 'ja'>('vi');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copySnippet = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Selector Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Chính Sách Bảo Mật Riêng Tư & Hướng Dẫn Vận Hành
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Tài liệu pháp lý thử nghiệm (Song ngữ Việt - Nhật) và Hướng dẫn triển khai hạ tầng Google Cloud
          </p>
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl text-xs">
          <button
            onClick={() => setActiveTab('privacy')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              activeTab === 'privacy' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600'
            }`}
          >
            Chính sách bảo mật (Privacy Policy)
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              activeTab === 'guide' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600'
            }`}
          >
            Hướng dẫn Deploy GCP
          </button>
          <button
            onClick={() => setActiveTab('checklist')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              activeTab === 'checklist' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600'
            }`}
          >
            Checklist trước khi mời thử
          </button>
        </div>
      </div>

      {/* VIEW 1: PRIVACY POLICY (BILINGUAL) */}
      {activeTab === 'privacy' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-1 bg-amber-100 text-amber-900 rounded-md font-semibold">
                BẢN DỰ THẢO THỬ NGHIỆM BETA · CẦN RÀ SOÁT PHÁP LÝ / ドラフト版
              </span>
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs">
              <button
                onClick={() => setLang('vi')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  lang === 'vi' ? 'bg-white text-slate-900 font-bold shadow-xs' : 'text-slate-600'
                }`}
              >
                Tiếng Việt (VI)
              </button>
              <button
                onClick={() => setLang('ja')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  lang === 'ja' ? 'bg-white text-slate-900 font-bold shadow-xs' : 'text-slate-600'
                }`}
              >
                日本語 (JA)
              </button>
            </div>
          </div>

          {lang === 'vi' ? (
            <div className="prose prose-slate max-w-none text-xs leading-relaxed space-y-4 text-slate-700">
              <h2 className="text-base font-bold text-slate-900">
                CHÍNH SÁCH BẢO MẬT & ĐIỀU KHOẢN SỬ DỤNG ("TRỢ LÝ GIẤY TỜ NHẬT")
              </h2>
              <p>
                <strong>Hiệu lực từ:</strong> 01/10/2026 · Phiên bản: 1.0-beta dành cho 20 gia đình thử nghiệm.
              </p>

              <h3 className="text-sm font-bold text-slate-900 mt-4">1. Mục đích thu thập & xử lý</h3>
              <p>
                Dịch vụ được thiết kế nhằm hỗ trợ các gia đình người Việt sinh sống tại Nhật Bản đọc, dịch nghĩa tóm tắt các thông báo trường học (お便り), thực đơn (献立表), thông báo hành chính công (役所) và trích xuất lịch sự kiện, việc cần làm nhằm tránh trễ hạn nộp hồ sơ.
              </p>

              <h3 className="text-sm font-bold text-slate-900 mt-4">2. Luồng luân chuyển dữ liệu xuyên biên giới</h3>
              <p>Người dùng hiểu và đồng ý rằng dữ liệu hình ảnh và văn bản sẽ đi qua các hạ tầng sau:</p>
              <ul className="list-disc list-inside space-y-1 pl-2">
                <li><strong>LINE Corporation (Nhật Bản):</strong> Tiếp nhận tin nhắn và hình ảnh mã hóa đầu cuối từ ứng dụng LINE của bạn.</li>
                <li><strong>Google Cloud Platform (Tokyo - region asia-northeast1):</strong> Máy chủ Cloud Run và Cơ sở dữ liệu Firestore Native xử lý webhook, quản lý hàng đợi và đồng bộ lịch ICS.</li>
                <li><strong>Anthropic PBC (Hoa Kỳ):</strong> API Claude 3.5 Haiku và Claude 3.5 Sonnet xử lý OCR nhận diện ký tự quang học và trích xuất cấu trúc JSON. Dữ liệu gửi qua API trả phí của Anthropic không được dùng để huấn luyện mô hình (No training on API data).</li>
              </ul>

              <h3 className="text-sm font-bold text-slate-900 mt-4">3. Chính sách lưu trữ & Thời hạn giữ dữ liệu</h3>
              <ul className="list-disc list-inside space-y-1 pl-2">
                <li><strong>Ảnh chụp gốc:</strong> Bị xóa vĩnh viễn khỏi Cloud Storage ngay sau khi pipeline trích xuất thành công (thường dưới 60 giây). Hệ thống KHÔNG lưu trữ file ảnh lâu dài.</li>
                <li><strong>Dữ liệu văn bản & Sự kiện:</strong> Được cài đặt trường <code>expire_at = created_at + 90 ngày</code>. Tính năng Firestore TTL tự động xóa sạch dữ liệu sau 90 ngày mà không cần thao tác thủ công.</li>
              </ul>

              <h3 className="text-sm font-bold text-slate-900 mt-4">4. Quyền của người dùng & Xóa dữ liệu</h3>
              <p>
                Bạn có toàn quyền kiểm soát dữ liệu của gia đình mình:
              </p>
              <ul className="list-disc list-inside space-y-1 pl-2">
                <li>Gõ lệnh <code>xóa dữ liệu</code> trong chat LINE hoặc bấm nút "Xóa toàn bộ dữ liệu gia đình" trên LIFF. Toàn bộ dữ liệu của gia đình sẽ bị xóa sạch ngay lập tức.</li>
                <li>Nếu bot bị kick ra khỏi nhóm LINE, hệ thống sẽ tự động lên lịch xóa toàn bộ dữ liệu của nhóm sau 7 ngày.</li>
              </ul>

              <h3 className="text-sm font-bold text-slate-900 mt-4">5. Giới hạn trách nhiệm pháp lý & Y tế</h3>
              <p className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-600">
                Dịch vụ chỉ mang tính chất hỗ trợ ngôn ngữ. Đối với các giấy tờ liên quan đến thuế, thủ tục cư trú (Xuất nhập cảnh Nyukan), y tế hoặc pháp lý, người dùng có trách nhiệm đối chiếu và xác nhận trực tiếp với cơ quan phát hành giấy tờ.
              </p>
            </div>
          ) : (
            <div className="prose prose-slate max-w-none text-xs leading-relaxed space-y-4 text-slate-700 font-jp">
              <h2 className="text-base font-bold text-slate-900">
                プライバシーポリシーおよび利用規約（在日ベトナム人家庭向け書類アシスタント）
              </h2>
              <p>
                <strong>制定日:</strong> 2026年10月1日 · バージョン: 1.0-beta（20世帯限定トライアル）
              </p>

              <h3 className="text-sm font-bold text-slate-900 mt-4">1. 利用目的</h3>
              <p>
                本サービスは、日本に在住するベトナム人家庭に対し、学校や保育園の「お便り」、献立表、自治体（役所）からの公的通知書の翻訳およびToDo・カレンダー登録を支援することを目的としています。
              </p>

              <h3 className="text-sm font-bold text-slate-900 mt-4">2. データフローと越境移転</h3>
              <ul className="list-disc list-inside space-y-1 pl-2">
                <li><strong>LINEヤフー株式会社（日本）:</strong> LINEメッセージおよび画像の送受信。</li>
                <li><strong>Google Cloud Platform（東京リージョン asia-northeast1）:</strong> Cloud RunおよびFirestoreによる暗号化保管、ICSカレンダー生成。</li>
                <li><strong>Anthropic PBC（米国）:</strong> Claude 3.5 Haiku/Sonnet APIによるOCR解析およびJSON構造化（API経由のデータはAIモデルの学習には一切使用されません）。</li>
              </ul>

              <h3 className="text-sm font-bold text-slate-900 mt-4">3. 保存期間と画像の即時消去</h3>
              <ul className="list-disc list-inside space-y-1 pl-2">
                <li><strong>元画像データ:</strong> テキスト抽出処理が正常に完了した直後に即時消去されます。恒久的な画像保存は行いません。</li>
                <li><strong>テキスト・予定データ:</strong> 最大90日間保持され、Firestore TTLポリシーにより自動完全消去されます。</li>
              </ul>

              <h3 className="text-sm font-bold text-slate-900 mt-4">4. データの消去権</h3>
              <p>
                ユーザーはいつでもLINE上で「xóa dữ liệu」と送信するか、LIFFアプリ内の消去ボタンから全データの即時削除を要求できます。
              </p>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: DEPLOYMENT GUIDE (CLOUD RUN + FIRESTORE) */}
      {activeTab === 'guide' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-xs space-y-6 text-xs">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Hướng dẫn triển khai production trên Google Cloud (Cloud Run asia-northeast1)
            </h2>
            <p className="text-slate-500 mt-1">
              Kiến trúc serverless tối ưu chi phí, hoàn toàn tự động co giãn và an toàn bí mật qua Secret Manager.
            </p>
          </div>

          <div className="space-y-4">
            {/* Step 1 */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="font-bold text-slate-900 flex items-center justify-between">
                <span>1. Tạo Firestore Native & Thiết lập TTL Policy (Tự xóa sau 90 ngày)</span>
                <span className="font-mono text-[11px] text-emerald-800">asia-northeast1</span>
              </div>
              <p className="text-slate-600">
                Tạo database Firestore ở chế độ Native tại region Tokyo (asia-northeast1), sau đó bật tính năng TTL trên trường <code>expire_at</code>:
              </p>
              <pre className="p-2.5 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto">
{`# Bật TTL tự động xóa sau 90 ngày trên collection documents
gcloud firestore fields ttls update expire_at \\
  --collection-group=documents \\
  --enable-ttl \\
  --project=YOUR_PROJECT_ID`}
              </pre>
            </div>

            {/* Step 2 */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="font-bold text-slate-900 flex items-center justify-between">
                <span>2. Cấu hình Secret Manager (Bảo mật tuyệt đối khóa API)</span>
                <span className="font-mono text-[11px] text-slate-500">Secret Manager</span>
              </div>
              <pre className="p-2.5 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto">
{`# Thêm các secrets vào Google Secret Manager
gcloud secrets create line-channel-secret --data-file=-
gcloud secrets create line-channel-token --data-file=-
gcloud secrets create anthropic-api-key --data-file=-
gcloud secrets create ics-signing-key --data-file=-`}
              </pre>
            </div>

            {/* Step 3 */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="font-bold text-slate-900 flex items-center justify-between">
                <span>3. Build & Deploy Cloud Run Service</span>
                <span className="font-mono text-[11px] text-emerald-800">Cloud Run</span>
              </div>
              <pre className="p-2.5 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto">
{`gcloud run deploy giay-to-nhat-api \\
  --source=./backend \\
  --region=asia-northeast1 \\
  --platform=managed \\
  --allow-unauthenticated \\
  --min-instances=0 \\
  --max-instances=5 \\
  --memory=512Mi \\
  --set-secrets=LINE_CHANNEL_SECRET=line-channel-secret:latest,LINE_CHANNEL_ACCESS_TOKEN=line-channel-token:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest`}
              </pre>
            </div>

            {/* Step 4 */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="font-bold text-slate-900 flex items-center justify-between">
                <span>4. Cấu hình LINE Official Account & LIFF</span>
                <span className="font-mono text-[11px] text-slate-500">LINE Console</span>
              </div>
              <p className="text-slate-600">
                • <strong>Webhook URL:</strong> <code>https://YOUR_CLOUD_RUN_URL/api/line/webhook</code> (Bật "Use Webhook").<br />
                • <strong>Auto-reply messages:</strong> TẮT trong LINE Official Account Manager (chuyển Response mode sang Bot).<br />
                • <strong>LIFF App:</strong> Tạo LIFF app với Endpoint URL là trang web này (Scope: <code>profile</code>, <code>chat_message.write</code>).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 3: PRE-BETA CHECKLIST */}
      {activeTab === 'checklist' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-xs space-y-4 text-xs">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Checklist hoàn tất trước khi gửi link mời 20 gia đình đầu tiên
            </h2>
            <p className="text-slate-500 mt-0.5">
              Đảm bảo các cơ chế an toàn, quota và bảo mật đều vận hành trơn tru
            </p>
          </div>

          <div className="space-y-3">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-3">
              <div className="w-5 h-5 rounded-md bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
              <div>
                <span className="font-bold text-slate-900 block">Tắt Chat thủ công trong LINE Official Account Manager</span>
                <span className="text-slate-600">
                  Vào Settings → Response settings → Chọn Response mode: "Bot" (KHÔNG chọn Chat để tránh tin nhắn bị xung đột).
                </span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-3">
              <div className="w-5 h-5 rounded-md bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
              <div>
                <span className="font-bold text-slate-900 block">Kiểm tra Onboarding & Xác thực mã mời</span>
                <span className="text-slate-600">
                  Bot chỉ được xử lý ảnh khi gia đình đã bấm "Đồng ý điều khoản" và nhập mã mời hợp lệ (BETA2026).
                </span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-3">
              <div className="w-5 h-5 rounded-md bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
              <div>
                <span className="font-bold text-slate-900 block">Hạn mức ngân sách Anthropic $20/tháng</span>
                <span className="text-slate-600">
                  Hệ thống tự động theo dõi token từng lần gọi và tạm dừng xử lý ảnh nếu đạt $20, đồng thời cảnh báo Admin.
                </span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-3">
              <div className="w-5 h-5 rounded-md bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
              <div>
                <span className="font-bold text-slate-900 block">Lịch nhắc hạn qua ICS (Tiết kiệm quota 200 tin LINE Push)</span>
                <span className="text-slate-600">
                  Hạn chót và dã ngoại được nhắc qua VALARM trong lịch điện thoại (iOS/Google). Không gửi tin nhắn push trừ trường hợp ngoại lệ.
                </span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-3">
              <div className="w-5 h-5 rounded-md bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
              <div>
                <span className="font-bold text-slate-900 block">Xóa dữ liệu ngay lập tức khi người dùng yêu cầu</span>
                <span className="text-slate-600">
                  Lệnh "xóa dữ liệu" hoặc nút xóa trên LIFF xóa sạch toàn bộ bản tóm tắt và vô hiệu hóa link lịch ICS ngay tức thì.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
