import React, { useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Filter,
  RefreshCw,
  Search,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  AlertTriangle,
  MapPin,
  Briefcase,
  ChevronRight,
  ShieldCheck,
  Check,
} from 'lucide-react';
import { ExtractedDocument, Family, DocType } from '../types/index.ts';
import { DocumentHistoryView } from './DocumentHistoryView.tsx';

interface FamilyLIFFViewProps {
  family: Family;
  documents: ExtractedDocument[];
  onToggleAction: (docId: string, actionId: string) => void;
  onSubmitFeedback: (docId: string, feedback: 'up' | 'down', note?: string) => void;
  onToggleUrgent?: (docId: string, reason?: string) => Promise<any> | void;
  onRotateIcsToken: () => void;
  onDeleteFamilyData: () => void;
  onOpenPrivacy: () => void;
}

export const FamilyLIFFView: React.FC<FamilyLIFFViewProps> = ({
  family,
  documents,
  onToggleAction,
  onSubmitFeedback,
  onToggleUrgent,
  onRotateIcsToken,
  onDeleteFamilyData,
  onOpenPrivacy,
}) => {
  const [subTab, setSubTab] = useState<'docs' | 'tasks' | 'calendar' | 'ics' | 'settings'>('docs');
  const [copiedIcs, setCopiedIcs] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState('');

  // Generate full ICS URL
  const icsUrl = `${window.location.origin}/ics/${family.ics_token}.ics`;

  const copyIcsToClipboard = () => {
    navigator.clipboard.writeText(icsUrl);
    setCopiedIcs(true);
    setTimeout(() => setCopiedIcs(false), 2000);
  };

  // Extract all actions across documents
  const allActions = documents.flatMap((d) =>
    d.actions.map((a) => ({
      ...a,
      docId: d.id,
      docTitle: d.title_vi,
      docIssuer: d.issuer,
    }))
  );

  const pendingActions = allActions.filter((a) => !a.completed);
  const completedActions = allActions.filter((a) => a.completed);

  // Extract all calendar events
  const allEvents = documents
    .flatMap((d) =>
      d.events.map((e) => ({
        ...e,
        docTitle: d.title_vi,
        docIssuer: d.issuer,
      }))
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Mobile-Friendly Family Info Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <span>Bản thử nghiệm Beta</span>
              <span aria-hidden="true">·</span>
              <span>Lưu trữ dữ liệu: 90 ngày</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-700 font-medium">Đã kích hoạt</span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
              {family.family_name}
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Mã mời: <span className="font-mono font-semibold text-slate-800">{family.invite_code}</span> · Nhóm LINE:{' '}
              <span className="font-mono text-slate-700">{family.line_chat_id}</span>
            </p>
          </div>

          {/* Quota & Quick Action */}
          <div className="flex items-center gap-4 bg-slate-50 p-3 rounded-xl border border-slate-100">
            <div>
              <div className="text-xs text-slate-500 font-medium">Hạn mức tháng này</div>
              <div className="text-lg font-bold text-slate-900 tabular-nums">
                {family.quota_used} <span className="text-xs font-normal text-slate-500">/ {family.quota_limit} giấy</span>
              </div>
            </div>
            <div className="w-24 bg-slate-200 h-2 rounded-full overflow-hidden">
              <div
                className="bg-emerald-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, (family.quota_used / family.quota_limit) * 100)}%` }}
              />
            </div>
            <button
              onClick={() => setSubTab('ics')}
              className="px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-100/70 hover:bg-emerald-200 rounded-lg transition-colors whitespace-nowrap"
            >
              Lấy lịch ICS
            </button>
          </div>
        </div>

        {/* LIFF Sub Tabs Bar (Segmented Controls) */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl mt-5 overflow-x-auto">
          <button
            onClick={() => setSubTab('docs')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              subTab === 'docs' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Lịch sử giấy tờ ({documents.length})</span>
          </button>

          <button
            onClick={() => setSubTab('tasks')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              subTab === 'tasks' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Việc cần làm ({pendingActions.length})</span>
          </button>

          <button
            onClick={() => setSubTab('calendar')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              subTab === 'calendar' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Sự kiện ({allEvents.length})</span>
          </button>

          <button
            onClick={() => setSubTab('ics')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              subTab === 'ics' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Đồng bộ ICS</span>
          </button>

          <button
            onClick={() => setSubTab('settings')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              subTab === 'settings' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Cài đặt & Xóa dữ liệu</span>
          </button>
        </div>
      </div>

      {/* SUB-VIEW 1: DOCUMENT HISTORY (LỊCH SỬ GIẤY TỜ) */}
      {subTab === 'docs' && (
        <DocumentHistoryView
          documents={documents}
          onToggleAction={onToggleAction}
          onSubmitFeedback={onSubmitFeedback}
          onToggleUrgent={onToggleUrgent}
          onOpenCalendar={() => setSubTab('calendar')}
          onOpenIcs={() => setSubTab('ics')}
        />
      )}

      {/* SUB-VIEW 2: CHECKLIST TASKS */}
      {subTab === 'tasks' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Danh sách việc cần làm cho con & gia đình</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Các đầu việc tự động trích xuất từ tất cả お便り và giấy tờ hành chính
              </p>
            </div>
            <div className="text-xs text-slate-500 tabular-nums">
              Đã xong {completedActions.length}/{allActions.length} việc
            </div>
          </div>

          <div className="space-y-6">
            {/* Pending Tasks */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Chưa hoàn thành ({pendingActions.length})
              </h3>
              {pendingActions.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  🎉 Tuyệt vời! Bạn không còn việc nào tồn đọng.
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingActions.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => onToggleAction(task.docId, task.id)}
                      className="p-3 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/30 transition-all cursor-pointer flex items-start gap-3"
                    >
                      <div className="w-5 h-5 rounded-md border border-slate-300 mt-0.5 flex items-center justify-center shrink-0" />
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-slate-900">{task.todo_vi}</div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
                          <span>Từ: {task.docTitle}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-slate-700">{task.docIssuer}</span>
                          {task.deadline && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-amber-700 font-semibold flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Hạn chót: {task.deadline}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Completed Tasks */}
            {completedActions.length > 0 && (
              <div className="pt-4 border-t border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Đã hoàn thành ({completedActions.length})
                </h3>
                <div className="space-y-2 opacity-75">
                  {completedActions.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => onToggleAction(task.docId, task.id)}
                      className="p-3 rounded-xl border border-slate-100 bg-slate-50 cursor-pointer flex items-start gap-3 line-through text-slate-400"
                    >
                      <div className="w-5 h-5 rounded-md bg-emerald-600 border border-emerald-600 text-white mt-0.5 flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm">{task.todo_vi}</div>
                        <div className="text-xs mt-0.5">Từ: {task.docTitle}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-VIEW 3: CALENDAR VIEW */}
      {subTab === 'calendar' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Lịch sự kiện & Ngày quan trọng</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Được cập nhật tự động từ giấy tờ trường học, dã ngoại và lịch hẹn y tế
              </p>
            </div>
            <button
              onClick={() => setSubTab('ics')}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1.5 self-start"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Đăng ký lịch trên iPhone/Google</span>
            </button>
          </div>

          <div className="space-y-3">
            {allEvents.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                Chưa có sự kiện nào trong danh sách.
              </div>
            ) : (
              allEvents.map((evt) => (
                <div
                  key={evt.id}
                  className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex flex-col items-center justify-center text-emerald-900 shrink-0">
                      <span className="text-[10px] uppercase font-bold">Tháng {evt.date.split('-')[1]}</span>
                      <span className="text-base font-extrabold leading-tight">{evt.date.split('-')[2]}</span>
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-slate-900">{evt.title_vi}</h4>
                      {evt.title_jp && <p className="text-xs text-slate-500 font-jp">🇯🇵 {evt.title_jp}</p>}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
                        {evt.time && <span>⏰ {evt.time}</span>}
                        {evt.location && <span>📍 {evt.location}</span>}
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-600">Nguồn: {evt.docTitle}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-xs text-slate-400">VALARM</span>
                    <div className="text-xs font-medium text-emerald-800">Nhắc trước 1 ngày</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* SUB-VIEW 4: LIVE ICS CALENDAR SYNC */}
      {subTab === 'ics' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <span>Đồng bộ 1 chiều bảo mật</span>
              <span aria-hidden="true">·</span>
              <span>Ký mã HMAC bí mật</span>
              <span aria-hidden="true">·</span>
              <span>Tự động cập nhật mỗi giờ</span>
            </div>
            <h2 className="text-lg md:text-xl font-bold text-slate-900">
              Đồng bộ lịch gia đình qua link bí mật (ICS Feed)
            </h2>
            <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
              Mỗi gia đình có một URL lịch bí mật riêng biệt. Khi thêm lịch này vào iPhone hoặc Google Calendar, toàn bộ hạn nộp tiền, ngày dã ngoại, lịch khám bệnh sẽ tự động hiển thị trong ứng dụng Lịch của cả bố và mẹ, kèm thông báo nhắc trước 1 ngày (VALARM).
            </p>
          </div>

          {/* Secret Link Box */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
              <span className="font-semibold text-slate-800">Link đăng ký lịch (Subscription URL):</span>
              <span className="text-emerald-700 font-medium">Bảo mật riêng cho gia đình bạn</span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={icsUrl}
                className="w-full text-xs font-mono bg-white border border-slate-200 rounded-lg p-2.5 text-slate-800 select-all focus:outline-none"
              />
              <button
                onClick={copyIcsToClipboard}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
              >
                {copiedIcs ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedIcs ? 'Đã sao chép' : 'Sao chép link'}</span>
              </button>

              <a
                href={icsUrl}
                download={`giaytonhat_${family.family_id}.ics`}
                className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold shrink-0 transition-colors"
                title="Tải trực tiếp file .ics"
              >
                Tải file .ics
              </a>
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>Nếu nghi ngờ link bị lộ, bạn có thể tạo lại mã bất kỳ lúc nào:</span>
              <button
                onClick={onRotateIcsToken}
                className="text-amber-800 hover:text-amber-900 font-medium underline flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Tạo lại mã liên kết (Rotate token)</span>
              </button>
            </div>
          </div>

          {/* Setup Instructions for iOS and Google */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* iOS Calendar Guide */}
            <div className="p-4 bg-white rounded-xl border border-slate-200">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-2">
                <span>🍎 Hướng dẫn trên iPhone / iPad (Apple Calendar)</span>
              </h3>
              <ol className="text-xs text-slate-600 space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>Mở ứng dụng <strong>Cài đặt (Settings)</strong> trên iPhone.</li>
                <li>Chọn <strong>Lịch (Calendar)</strong> → <strong>Tài khoản (Accounts)</strong>.</li>
                <li>Bấm <strong>Thêm tài khoản (Add Account)</strong> → <strong>Khác (Other)</strong>.</li>
                <li>Chọn <strong>Thêm lịch đã đăng ký (Add Subscribed Calendar)</strong>.</li>
                <li>Dán link bí mật ở trên vào ô Máy chủ (Server) và bấm <strong>Tiếp (Next)</strong>.</li>
                <li>Bật tuỳ chọn Cảnh báo (Alerts) và bấm <strong>Lưu (Save)</strong>.</li>
              </ol>
              <div className="mt-3 text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg">
                💡 iOS hỗ trợ cảnh báo VALARM nhắc trước 1 ngày rất chuẩn xác.
              </div>
            </div>

            {/* Google Calendar Guide */}
            <div className="p-4 bg-white rounded-xl border border-slate-200">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-2">
                <span>🌐 Hướng dẫn trên Google Calendar</span>
              </h3>
              <ol className="text-xs text-slate-600 space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>Truy cập <a href="https://calendar.google.com" target="_blank" rel="noreferrer" className="text-emerald-700 underline font-medium">calendar.google.com</a> trên máy tính hoặc trình duyệt web.</li>
                <li>Ở cột bên trái, tìm mục <strong>Lịch khác (Other calendars)</strong> và bấm dấu <strong>+</strong>.</li>
                <li>Chọn <strong>Từ URL (From URL)</strong>.</li>
                <li>Dán link bí mật ở trên vào và bấm <strong>Thêm lịch (Add calendar)</strong>.</li>
                <li>Mở ứng dụng Google Calendar trên điện thoại và bật hiển thị lịch này.</li>
              </ol>
              <div className="mt-3 text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg">
                💡 Google Calendar đồng bộ định kỳ khoảng 8-12 tiếng một lần.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 5: SETTINGS & DELETE ALL FAMILY DATA */}
      {subTab === 'settings' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Cài đặt & Quyền riêng tư gia đình</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Quản lý thông tin lưu trữ và chính sách bảo mật riêng tư tuyệt đối
            </p>
          </div>

          {/* Privacy & Retention Highlights */}
          <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-100 text-xs space-y-2">
            <div className="font-semibold text-emerald-950 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-700" />
              <span>Cam kết bảo mật dữ liệu giấy tờ</span>
            </div>
            <p className="text-emerald-900 leading-relaxed">
              • <strong>Không lưu ảnh vĩnh viễn</strong>: Ảnh chụp gốc được xóa tự động ngay sau khi hoàn tất trích xuất.<br />
              • <strong>Thời gian giữ dữ liệu</strong>: Toàn bộ văn bản tóm tắt và việc cần làm sẽ tự động hết hạn và xóa sạch sau <strong>90 ngày</strong> (Firestore TTL).<br />
              • <strong>Admin không thể đọc trộm</strong>: Ban quản trị hoàn toàn không có giao diện xem nội dung giấy tờ của bạn.
            </p>
            <button
              onClick={onOpenPrivacy}
              className="text-emerald-800 font-semibold underline hover:text-emerald-900 block mt-1"
            >
              Xem toàn văn Chính sách bảo mật (Bilingual Song ngữ Việt - Nhật) →
            </button>
          </div>

          {/* Danger Zone: Purge Family Data */}
          <div className="pt-4 border-t border-slate-200">
            <h3 className="text-sm font-bold text-rose-700 flex items-center gap-1.5 mb-1">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>Khu vực nguy hiểm: Xóa toàn bộ dữ liệu gia đình</span>
            </h3>
            <p className="text-xs text-slate-600 mb-4 max-w-xl">
              Thao tác này sẽ xóa vĩnh viễn tất cả các bản tóm tắt giấy tờ, danh sách việc cần làm, sự kiện lịch và vô hiệu hóa link lịch ICS của gia đình bạn ngay lập tức. Không thể khôi phục sau khi xóa.
            </p>

            <button
              onClick={() => {
                setShowDeleteModal(true);
                setDeleteConfirmationInput('');
              }}
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors shadow-xs"
            >
              <Trash2 className="w-4 h-4" />
              <span>Xóa toàn bộ dữ liệu gia đình</span>
            </button>
          </div>

          {/* Delete Confirmation Modal */}
          {showDeleteModal && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mb-3">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Xác nhận xóa vĩnh viễn dữ liệu?</h3>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Để đảm bảo bạn không vô tình bấm nhầm, vui lòng gõ chính xác dòng chữ:{' '}
                  <span className="font-mono font-bold text-rose-700">XÁC NHẬN XÓA</span> vào ô dưới đây:
                </p>

                <input
                  type="text"
                  placeholder="XÁC NHẬN XÓA"
                  value={deleteConfirmationInput}
                  onChange={(e) => setDeleteConfirmationInput(e.target.value)}
                  className="w-full mt-3 p-2.5 text-xs font-mono border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
                />

                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setShowDeleteModal(false)}
                    className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    disabled={deleteConfirmationInput !== 'XÁC NHẬN XÓA'}
                    onClick={() => {
                      onDeleteFamilyData();
                      setShowDeleteModal(false);
                    }}
                    className={`px-4 py-2 text-xs font-semibold rounded-xl text-white transition-colors ${
                      deleteConfirmationInput === 'XÁC NHẬN XÓA'
                        ? 'bg-rose-600 hover:bg-rose-700 cursor-pointer'
                        : 'bg-slate-300 cursor-not-allowed'
                    }`}
                  >
                    Xóa vĩnh viễn ngay
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
