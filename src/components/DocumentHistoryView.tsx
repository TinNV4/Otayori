import React, { useState, useMemo } from 'react';
import {
  Search,
  Calendar,
  Clock,
  Filter,
  FileText,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  ArrowUpDown,
  Download,
  Copy,
  Check,
  X,
  ExternalLink,
  Layers,
  Sparkles,
  Briefcase,
  MapPin,
  Eye,
  SlidersHorizontal,
} from 'lucide-react';
import { ExtractedDocument, DocType } from '../types/index.ts';

interface DocumentHistoryViewProps {
  documents: ExtractedDocument[];
  onToggleAction: (docId: string, actionId: string) => void;
  onSubmitFeedback: (docId: string, feedback: 'up' | 'down', note?: string) => void;
  onToggleUrgent?: (docId: string, reason?: string) => Promise<any> | void;
  onOpenCalendar?: () => void;
  onOpenIcs?: () => void;
}

export const DocumentHistoryView: React.FC<DocumentHistoryViewProps> = ({
  documents,
  onToggleAction,
  onSubmitFeedback,
  onToggleUrgent,
  onOpenCalendar,
  onOpenIcs,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'pending' | 'completed'>('all');
  const [onlyUrgent, setOnlyUrgent] = useState<boolean>(false);
  const [timeFilter, setTimeFilter] = useState<'all' | '7days' | '30days'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'confidence'>('newest');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [selectedDocForDetail, setSelectedDocForDetail] = useState<ExtractedDocument | null>(null);
  const [copiedSummaryId, setCopiedSummaryId] = useState<string | null>(null);
  const [copiedExportAll, setCopiedExportAll] = useState(false);
  const [urgentToast, setUrgentToast] = useState<string | null>(null);

  // Helper label for document types
  const getDocTypeInfo = (type: DocType): { label: string; termJp: string; colorClass: string } => {
    switch (type) {
      case 'otayori':
        return { label: 'Thông báo trường', termJp: 'お便り', colorClass: 'text-emerald-800 bg-emerald-50 border-emerald-200' };
      case 'yakusho':
        return { label: 'Hành chính / Thuế', termJp: '役所', colorClass: 'text-indigo-800 bg-indigo-50 border-indigo-200' };
      case 'kondate':
        return { label: 'Thực đơn trường', termJp: '献立表', colorClass: 'text-amber-800 bg-amber-50 border-amber-200' };
      case 'nenkan_yotei':
        return { label: 'Lịch năm học', termJp: '年間行事', colorClass: 'text-cyan-800 bg-cyan-50 border-cyan-200' };
      case 'form':
        return { label: 'Mẫu đơn nộp', termJp: '提出書類', colorClass: 'text-violet-800 bg-violet-50 border-violet-200' };
      case 'hospital':
        return { label: 'Y tế & Khám bệnh', termJp: '健診・病院', colorClass: 'text-rose-800 bg-rose-50 border-rose-200' };
      case 'kairanban':
        return { label: 'Bản tin khu phố', termJp: '回覧板', colorClass: 'text-teal-800 bg-teal-50 border-teal-200' };
      case 'meisai':
        return { label: 'Phiếu thu / Lương', termJp: '給与明細', colorClass: 'text-blue-800 bg-blue-50 border-blue-200' };
      default:
        return { label: 'Giấy tờ khác', termJp: 'その他', colorClass: 'text-slate-800 bg-slate-50 border-slate-200' };
    }
  };

  // Filter and sort documents
  const filteredDocuments = useMemo(() => {
    const now = new Date().getTime();

    return documents
      .filter((doc) => {
        // Type filter
        if (selectedType !== 'all' && doc.doc_type !== selectedType) {
          return false;
        }

        // Urgent filter
        if (onlyUrgent && !doc.is_urgent) {
          return false;
        }

        // Action status filter
        if (selectedStatus === 'pending') {
          const hasPending = doc.actions.some((a) => !a.completed);
          if (!hasPending && doc.actions.length > 0) return false;
        } else if (selectedStatus === 'completed') {
          const allDone = doc.actions.length > 0 && doc.actions.every((a) => a.completed);
          if (!allDone) return false;
        }

        // Time range filter
        if (timeFilter === '7days') {
          const docTime = new Date(doc.created_at).getTime();
          if (now - docTime > 7 * 24 * 60 * 60 * 1000) return false;
        } else if (timeFilter === '30days') {
          const docTime = new Date(doc.created_at).getTime();
          if (now - docTime > 30 * 24 * 60 * 60 * 1000) return false;
        }

        // Full text search
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchTitle = doc.title_vi.toLowerCase().includes(q) || doc.title_jp.toLowerCase().includes(q);
          const matchSummary = doc.summary_vi.toLowerCase().includes(q);
          const matchIssuer = doc.issuer.toLowerCase().includes(q);
          const matchActions = doc.actions.some((a) => a.todo_vi.toLowerCase().includes(q));
          const matchItems = doc.items_to_bring.some((item) => item.toLowerCase().includes(q));
          const matchEvents = doc.events.some((e) => e.title_vi.toLowerCase().includes(q) || e.title_jp.toLowerCase().includes(q));
          return matchTitle || matchSummary || matchIssuer || matchActions || matchItems || matchEvents;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'newest') {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
        if (sortBy === 'oldest') {
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        }
        if (sortBy === 'confidence') {
          return b.confidence - a.confidence;
        }
        return 0;
      });
  }, [documents, searchQuery, selectedType, selectedStatus, onlyUrgent, timeFilter, sortBy]);

  // Copy individual document summary
  const copyDocSummary = (doc: ExtractedDocument) => {
    const text = `📄 [${getDocTypeInfo(doc.doc_type).label}] ${doc.title_vi}\n🏢 Nơi gửi: ${doc.issuer}\n⏰ Ngày xử lý: ${new Date(doc.created_at).toLocaleDateString('vi-VN')}\n\nℹ️ Tóm tắt nội dung:\n${doc.summary_vi}\n\n${
      doc.actions.length > 0 ? `✅ Việc cần làm:\n${doc.actions.map((a) => `• ${a.todo_vi}${a.deadline ? ` (Hạn: ${a.deadline})` : ''}`).join('\n')}\n\n` : ''
    }${
      doc.items_to_bring.length > 0 ? `🎒 Đồ cần mang:\n${doc.items_to_bring.map((i) => `• ${i}`).join('\n')}\n\n` : ''
    }Trích xuất bởi Trợ lý Giấy Tờ Nhật`;

    navigator.clipboard.writeText(text);
    setCopiedSummaryId(doc.id);
    setTimeout(() => setCopiedSummaryId(null), 2000);
  };

  // Export full summaries of currently filtered documents
  const exportAllSummaries = () => {
    const lines: string[] = [
      `=== BẢN TỔNG HỢP LỊCH SỬ GIẤY TỜ NHẬT (${filteredDocuments.length} tài liệu) ===`,
      `Ngày trích xuất: ${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')}`,
      '--------------------------------------------------\n',
    ];

    filteredDocuments.forEach((doc, idx) => {
      lines.push(`${idx + 1}. [${getDocTypeInfo(doc.doc_type).label}] ${doc.title_vi}`);
      lines.push(`   Tiêu đề Nhật: ${doc.title_jp}`);
      lines.push(`   Nơi gửi: ${doc.issuer} · Ngày xử lý: ${new Date(doc.created_at).toLocaleDateString('vi-VN')}`);
      lines.push(`   Tóm tắt: ${doc.summary_vi}`);
      if (doc.actions.length > 0) {
        lines.push(`   Việc cần làm:`);
        doc.actions.forEach((a) => {
          lines.push(`     • ${a.completed ? '[Đã xong] ' : '[Chưa làm] '}${a.todo_vi}${a.deadline ? ` (Hạn: ${a.deadline})` : ''}`);
        });
      }
      lines.push('--------------------------------------------------\n');
    });

    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedExportAll(true);
    setTimeout(() => setCopiedExportAll(false), 2000);
  };

  return (
    <div className="space-y-6">
      {urgentToast && (
        <div className="p-4 bg-rose-50 border border-rose-300 rounded-2xl text-rose-950 text-xs flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-semibold">{urgentToast}</span>
          </div>
          <button
            onClick={() => setUrgentToast(null)}
            className="text-rose-500 hover:text-rose-800 p-1 rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Banner / Breadcrumb */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <span>Lịch sử tra cứu thông tin</span>
              <span aria-hidden="true">·</span>
              <span>Tổng số: {documents.length} giấy tờ</span>
              <span aria-hidden="true">·</span>
              <span>Lưu trữ 90 ngày</span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Layers className="w-6 h-6 text-emerald-600" />
              <span>Lịch Sử Giấy Tờ Đã Xử Lý (Document History)</span>
            </h1>
            <p className="text-xs md:text-sm text-slate-600 mt-1 max-w-2xl leading-relaxed">
              Toàn bộ danh mục お便り nhà trẻ, giấy triệu tập 役所, thực đơn và lịch năm học đã được AI đọc và dịch. Bạn có thể dễ dàng tìm lại thông tin cũ, kiểm tra việc đã làm và tra cứu đồ dùng cần chuẩn bị.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={exportAllSummaries}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-1.5"
              title="Sao chép toàn bộ tóm tắt các giấy tờ đang lọc"
            >
              {copiedExportAll ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedExportAll ? 'Đã sao chép tổng hợp' : 'Xuất tóm tắt lịch sử'}</span>
            </button>

            {onOpenCalendar && (
              <button
                onClick={onOpenCalendar}
                className="px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-colors flex items-center gap-1.5"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Xem trên Lịch</span>
              </button>
            )}
          </div>
        </div>

        {/* Search Bar & Primary Filters */}
        <div className="mt-5 pt-4 border-t border-slate-100 space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Tìm theo tiêu đề, nơi gửi (さくら保育園, 区役所...), nội dung tóm tắt, đồ cần mang..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-9 py-2.5 text-xs md:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all placeholder:text-slate-400"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Sort & View Mode Switcher */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs">
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-transparent text-slate-700 font-medium focus:outline-none cursor-pointer"
                >
                  <option value="newest">Mới nhất trước</option>
                  <option value="oldest">Cũ nhất trước</option>
                  <option value="confidence">Độ tin cậy cao nhất</option>
                </select>
              </div>

              <div className="flex items-center bg-slate-100 rounded-xl p-0.5 text-xs">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`px-2.5 py-1.5 rounded-lg transition-colors ${
                    viewMode === 'cards' ? 'bg-white font-semibold text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                  title="Dạng thẻ trực quan"
                >
                  Thẻ
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-2.5 py-1.5 rounded-lg transition-colors ${
                    viewMode === 'table' ? 'bg-white font-semibold text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                  title="Dạng bảng tóm tắt"
                >
                  Bảng
                </button>
              </div>
            </div>
          </div>

          {/* Filter Pills (Document Types) */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <span className="text-slate-400 shrink-0 font-medium mr-1 flex items-center gap-1">
              <Filter className="w-3 h-3" />
              <span>Loại giấy:</span>
            </span>

            <button
              onClick={() => setSelectedType('all')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                selectedType === 'all'
                  ? 'bg-slate-900 text-white font-medium shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Tất cả ({documents.length})
            </button>

            <button
              onClick={() => setSelectedType('otayori')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                selectedType === 'otayori'
                  ? 'bg-slate-900 text-white font-medium shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Thông báo trường (お便り)
            </button>

            <button
              onClick={() => setSelectedType('yakusho')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                selectedType === 'yakusho'
                  ? 'bg-slate-900 text-white font-medium shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Giấy tờ 役所 (UBND/Thuế)
            </button>

            <button
              onClick={() => setSelectedType('kondate')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                selectedType === 'kondate'
                  ? 'bg-slate-900 text-white font-medium shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Thực đơn (献立表)
            </button>

            <button
              onClick={() => setSelectedType('nenkan_yotei')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                selectedType === 'nenkan_yotei'
                  ? 'bg-slate-900 text-white font-medium shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Lịch năm (年間予定)
            </button>

            <button
              onClick={() => setSelectedType('hospital')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                selectedType === 'hospital'
                  ? 'bg-slate-900 text-white font-medium shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Khám sức khỏe (健診)
            </button>
          </div>

          {/* Secondary Filters: Status & Time Range */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-2">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Trạng thái:</span>
              <button
                onClick={() => setSelectedStatus('all')}
                className={`px-2 py-1 rounded-md ${selectedStatus === 'all' ? 'bg-slate-200 text-slate-900 font-semibold' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Tất cả
              </button>
              <button
                onClick={() => setSelectedStatus('pending')}
                className={`px-2 py-1 rounded-md ${selectedStatus === 'pending' ? 'bg-amber-100 text-amber-900 font-semibold' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Còn việc cần làm
              </button>
              <button
                onClick={() => setSelectedStatus('completed')}
                className={`px-2 py-1 rounded-md ${selectedStatus === 'completed' ? 'bg-emerald-100 text-emerald-900 font-semibold' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Đã hoàn thành hết việc
              </button>

              <span aria-hidden="true" className="text-slate-300">|</span>

              <button
                onClick={() => setOnlyUrgent(!onlyUrgent)}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
                  onlyUrgent
                    ? 'bg-rose-600 text-white font-bold shadow-xs'
                    : 'bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200'
                }`}
              >
                <span>🚨 Khẩn cấp ({documents.filter((d) => d.is_urgent).length})</span>
              </button>
            </div>

            <div className="text-slate-400 tabular-nums">
              Hiển thị <span className="font-semibold text-slate-800">{filteredDocuments.length}</span> / {documents.length} giấy tờ
            </div>
          </div>
        </div>
      </div>

      {/* NO RESULTS STATE */}
      {filteredDocuments.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-3">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">Không tìm thấy giấy tờ phù hợp</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
            {searchQuery
              ? `Không có kết quả nào khớp với từ khóa "${searchQuery}". Hãy thử tìm bằng từ khóa ngắn hơn.`
              : 'Chưa có tài liệu nào trong danh mục này.'}
          </p>
          {(searchQuery || selectedType !== 'all' || selectedStatus !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedType('all');
                setSelectedStatus('all');
                setTimeFilter('all');
              }}
              className="mt-4 px-3.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
            >
              Xóa bộ lọc để xem tất cả
            </button>
          )}
        </div>
      )}

      {/* VIEW MODE 1: CARDS VIEW */}
      {viewMode === 'cards' && filteredDocuments.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredDocuments.map((doc) => {
            const typeInfo = getDocTypeInfo(doc.doc_type);
            const pendingActionsCount = doc.actions.filter((a) => !a.completed).length;
            const completedActionsCount = doc.actions.filter((a) => a.completed).length;
            const isAllActionsDone = doc.actions.length > 0 && pendingActionsCount === 0;

            return (
              <div
                key={doc.id}
                className={`bg-white rounded-2xl border p-5 shadow-xs transition-all flex flex-col justify-between ${
                  doc.is_urgent
                    ? 'border-rose-300 ring-1 ring-rose-200 bg-rose-50/15'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div>
                  {doc.is_urgent && (
                    <div className="mb-3 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-xs flex items-center justify-between font-semibold">
                      <span className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        <span>🚨 TÀI LIỆU KHẨN CẤP · Ưu tiên nhắc hạn</span>
                      </span>
                      {doc.urgent_notified_at && (
                        <span className="text-[10px] text-rose-700 font-normal">
                          Đã báo LINE lúc {new Date(doc.urgent_notified_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Unboxed Metadata (Zero-Pill Discipline) */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-2">
                    <span className="font-semibold text-emerald-800">{typeInfo.label} ({typeInfo.termJp})</span>
                    <span aria-hidden="true">·</span>
                    <span className="flex items-center gap-1 font-medium text-slate-700">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {new Date(doc.created_at).toLocaleDateString('vi-VN')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">Độ tin cậy {(doc.confidence * 100).toFixed(0)}%</span>
                  </div>

                  {/* Document Title (Vietnamese & Japanese) */}
                  <h2 className="text-base font-bold text-slate-900 leading-snug">
                    {doc.title_vi}
                  </h2>
                  <p className="text-xs text-slate-500 font-jp mt-0.5">
                    🇯🇵 {doc.title_jp}
                  </p>

                  <div className="text-xs text-slate-600 mt-1.5 flex items-center gap-1.5">
                    <span className="text-slate-400">Nơi phát hành:</span>
                    <span className="font-medium text-slate-800">{doc.issuer}</span>
                  </div>

                  {/* Summary of Content (Highlighted in Document History) */}
                  <div className="mt-3 p-3 bg-slate-50 rounded-xl text-xs text-slate-700 leading-relaxed border border-slate-100">
                    <span className="font-semibold text-slate-900 block mb-1">Tóm tắt nội dung:</span>
                    <p className="line-clamp-4">{doc.summary_vi}</p>
                  </div>

                  {/* Highlights Bar: Actions / Items / Events count */}
                  <div className="mt-3.5 flex flex-wrap items-center gap-3 text-xs">
                    {doc.actions.length > 0 && (
                      <div className="flex items-center gap-1 text-slate-600">
                        <CheckCircle2 className={`w-3.5 h-3.5 ${isAllActionsDone ? 'text-emerald-600' : 'text-amber-600'}`} />
                        <span>
                          {isAllActionsDone
                            ? `Đã xong ${completedActionsCount}/${doc.actions.length} việc`
                            : `Còn ${pendingActionsCount} việc cần làm`}
                        </span>
                      </div>
                    )}

                    {doc.items_to_bring.length > 0 && (
                      <div className="flex items-center gap-1 text-slate-500">
                        <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                        <span>{doc.items_to_bring.length} món đồ cần chuẩn bị</span>
                      </div>
                    )}

                    {doc.events.length > 0 && (
                      <div className="flex items-center gap-1 text-emerald-800 font-medium">
                        <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{doc.events.length} sự kiện lịch</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <div className="text-[11px] text-slate-400">
                    Hết hạn sau 90 ngày: {new Date(doc.expire_at).toLocaleDateString('vi-VN')}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {onToggleUrgent && (
                      <button
                        onClick={async () => {
                          const res = await onToggleUrgent(doc.id, doc.is_urgent ? 'Bỏ khẩn cấp' : 'Bật nhắc khẩn cấp');
                          if (res?.message) {
                            setUrgentToast(res.message);
                            setTimeout(() => setUrgentToast(null), 5000);
                          }
                        }}
                        className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 font-medium cursor-pointer ${
                          doc.is_urgent
                            ? 'bg-rose-100 text-rose-800 hover:bg-rose-200 border border-rose-300'
                            : 'bg-slate-100 text-slate-600 hover:text-rose-700 hover:bg-rose-50'
                        }`}
                        title={doc.is_urgent ? 'Tắt chế độ khẩn cấp' : 'Đánh dấu khẩn cấp & gửi nhắc ngay qua LINE'}
                      >
                        <AlertTriangle className={`w-3 h-3 ${doc.is_urgent ? 'text-rose-600 fill-rose-600' : 'text-slate-400'}`} />
                        <span>{doc.is_urgent ? 'Khẩn cấp' : 'Báo gấp'}</span>
                      </button>
                    )}

                    <button
                      onClick={() => copyDocSummary(doc)}
                      className="px-2.5 py-1 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center gap-1"
                      title="Sao chép tóm tắt nội dung"
                    >
                      {copiedSummaryId === doc.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedSummaryId === doc.id ? 'Đã chép' : 'Sao chép'}</span>
                    </button>

                    <button
                      onClick={() => setSelectedDocForDetail(doc)}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-md transition-colors flex items-center gap-1 shadow-xs"
                    >
                      <Eye className="w-3 h-3" />
                      <span>Xem chi tiết</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW MODE 2: TABLE VIEW */}
      {viewMode === 'table' && filteredDocuments.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3.5 font-semibold">Ngày xử lý</th>
                  <th className="p-3.5 font-semibold">Loại giấy</th>
                  <th className="p-3.5 font-semibold">Tiêu đề & Nơi phát hành</th>
                  <th className="p-3.5 font-semibold min-w-[280px]">Tóm tắt nội dung</th>
                  <th className="p-3.5 font-semibold">Việc cần làm</th>
                  <th className="p-3.5 font-semibold text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDocuments.map((doc) => {
                  const typeInfo = getDocTypeInfo(doc.doc_type);
                  const pendingCount = doc.actions.filter((a) => !a.completed).length;

                  return (
                    <tr
                      key={doc.id}
                      className={`hover:bg-slate-50/60 transition-colors ${
                        doc.is_urgent ? 'bg-rose-50/20' : ''
                      }`}
                    >
                      <td className="p-3.5 tabular-nums text-slate-500 whitespace-nowrap">
                        <div className="font-medium text-slate-800">{new Date(doc.created_at).toLocaleDateString('vi-VN')}</div>
                        <div className="text-[10px] text-slate-400">{new Date(doc.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</div>
                        {doc.is_urgent && (
                          <div className="mt-1 text-[10px] font-bold text-rose-700 flex items-center gap-0.5">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            <span>Gấp</span>
                          </div>
                        )}
                      </td>

                      <td className="p-3.5 whitespace-nowrap">
                        <div className="font-semibold text-emerald-800">{typeInfo.label}</div>
                        <div className="text-[10px] text-slate-400 font-jp">{typeInfo.termJp}</div>
                      </td>

                      <td className="p-3.5">
                        <div className="flex items-center gap-1.5 font-bold text-slate-900">
                          {doc.is_urgent && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-rose-100 text-rose-800 rounded font-bold shrink-0">
                              KHẨN CẤP
                            </span>
                          )}
                          <span>{doc.title_vi}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-jp">{doc.title_jp}</div>
                        <div className="text-[11px] text-slate-600 mt-0.5">{doc.issuer}</div>
                      </td>

                      <td className="p-3.5 text-slate-700 leading-relaxed">
                        <p className="line-clamp-2">{doc.summary_vi}</p>
                      </td>

                      <td className="p-3.5 whitespace-nowrap">
                        {doc.actions.length > 0 ? (
                          <div className={`font-medium ${pendingCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                            {pendingCount > 0 ? `Còn ${pendingCount} việc` : '✓ Đã xong hết'}
                          </div>
                        ) : (
                          <span className="text-slate-400">Không có việc</span>
                        )}
                        {doc.events.length > 0 && (
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {doc.events.length} sự kiện lịch
                          </div>
                        )}
                      </td>

                      <td className="p-3.5 text-right whitespace-nowrap space-x-1.5">
                        {onToggleUrgent && (
                          <button
                            onClick={async () => {
                              const res = await onToggleUrgent(doc.id, doc.is_urgent ? 'Bỏ khẩn cấp' : 'Bật nhắc khẩn cấp');
                              if (res?.message) {
                                setUrgentToast(res.message);
                                setTimeout(() => setUrgentToast(null), 5000);
                              }
                            }}
                            className={`px-2 py-1 rounded-md transition-colors cursor-pointer text-[11px] ${
                              doc.is_urgent
                                ? 'bg-rose-100 text-rose-800 hover:bg-rose-200 border border-rose-300 font-semibold'
                                : 'text-slate-500 hover:text-rose-700 hover:bg-rose-50 border border-slate-200'
                            }`}
                            title={doc.is_urgent ? 'Hủy khẩn cấp' : 'Đánh dấu khẩn cấp'}
                          >
                            {doc.is_urgent ? '🚨 Bỏ gấp' : '🚨 Gấp'}
                          </button>
                        )}
                        <button
                          onClick={() => copyDocSummary(doc)}
                          className="px-2 py-1 text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md hover:bg-slate-50"
                          title="Sao chép tóm tắt"
                        >
                          Chép
                        </button>
                        <button
                          onClick={() => setSelectedDocForDetail(doc)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-md shadow-xs"
                        >
                          Xem
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* FULL DOCUMENT DETAIL MODAL */}
      {selectedDocForDetail && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 flex items-start justify-between gap-4 bg-slate-50">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                  <span className="font-semibold text-emerald-800">
                    {getDocTypeInfo(selectedDocForDetail.doc_type).label} ({getDocTypeInfo(selectedDocForDetail.doc_type).termJp})
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Đã xử lý: {new Date(selectedDocForDetail.created_at).toLocaleString('vi-VN')}</span>
                  <span aria-hidden="true">·</span>
                  <span>Model: {selectedDocForDetail.model_used === 'claude-sonnet-5-5' ? 'Sonnet (Hành chính)' : 'Haiku'}</span>
                </div>
                <h3 className="text-lg font-bold text-slate-900 leading-snug">
                  {selectedDocForDetail.title_vi}
                </h3>
                <p className="text-xs text-slate-500 font-jp mt-0.5">
                  🇯🇵 {selectedDocForDetail.title_jp} · Nơi gửi: <span className="font-medium text-slate-700">{selectedDocForDetail.issuer}</span>
                </p>
              </div>

              <button
                onClick={() => setSelectedDocForDetail(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 rounded-full transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs">
              {/* Urgent Reminder Control Card */}
              <div
                className={`p-4 rounded-2xl border transition-all ${
                  selectedDocForDetail.is_urgent
                    ? 'bg-rose-50 border-rose-300 text-rose-950'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle
                      className={`w-5 h-5 shrink-0 mt-0.5 ${
                        selectedDocForDetail.is_urgent ? 'text-rose-600 fill-rose-600' : 'text-slate-400'
                      }`}
                    />
                    <div>
                      <div className="font-bold text-sm">
                        {selectedDocForDetail.is_urgent
                          ? '🚨 Giấy tờ này đang ở chế độ KHẨN CẤP (Urgent Priority)'
                          : 'Đánh dấu Khẩn cấp (Urgent Reminder)'}
                      </div>
                      <p className="text-[11px] mt-0.5 opacity-90 leading-relaxed">
                        {selectedDocForDetail.is_urgent
                          ? selectedDocForDetail.urgent_notified_at
                            ? `Bot đã gửi tin nhắn khẩn cấp qua LINE tới gia đình lúc ${new Date(selectedDocForDetail.urgent_notified_at).toLocaleTimeString('vi-VN')} ngày ${new Date(selectedDocForDetail.urgent_notified_at).toLocaleDateString('vi-VN')}.`
                            : 'Được ưu tiên xử lý lập tức và gửi thông báo trực tiếp qua LINE để gia đình không bỏ lỡ hạn chót.'
                          : 'Ưu tiên xử lý ngay lập tức, bỏ qua hàng đợi gom ảnh và gửi push notification qua LINE tới gia đình kèm hạn chót quan trọng.'}
                      </p>
                    </div>
                  </div>

                  {onToggleUrgent && (
                    <button
                      onClick={async () => {
                        const targetState = !selectedDocForDetail.is_urgent;
                        const res = await onToggleUrgent(selectedDocForDetail.id, targetState ? 'Bật nhắc khẩn cấp' : 'Bỏ khẩn cấp');
                        if (res?.message) {
                          setUrgentToast(res.message);
                          setTimeout(() => setUrgentToast(null), 5000);
                        }
                        setSelectedDocForDetail({
                          ...selectedDocForDetail,
                          is_urgent: targetState,
                          urgent_notified_at: targetState ? new Date().toISOString() : undefined,
                        });
                      }}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 cursor-pointer transition-colors shadow-xs ${
                        selectedDocForDetail.is_urgent
                          ? 'bg-white text-rose-700 border border-rose-300 hover:bg-rose-100'
                          : 'bg-rose-600 hover:bg-rose-700 text-white'
                      }`}
                    >
                      {selectedDocForDetail.is_urgent ? 'Tắt chế độ khẩn cấp' : '🚨 Đặt làm Khẩn cấp'}
                    </button>
                  )}
                </div>
              </div>

              {/* Summary of Content */}
              <div>
                <h4 className="font-bold text-slate-900 text-sm mb-1.5">Tóm tắt nội dung chi tiết:</h4>
                <div className="p-3.5 bg-slate-50 rounded-xl text-slate-700 leading-relaxed border border-slate-100 text-xs">
                  {selectedDocForDetail.summary_vi}
                </div>
              </div>

              {/* Actions / Tasks Checklist */}
              {selectedDocForDetail.actions.length > 0 && (
                <div>
                  <h4 className="font-bold text-slate-900 text-sm mb-2 flex items-center justify-between">
                    <span>Việc cần làm ({selectedDocForDetail.actions.length}):</span>
                    <span className="text-[11px] text-slate-400 font-normal">Bấm để đánh dấu hoàn tất</span>
                  </h4>
                  <div className="space-y-2">
                    {selectedDocForDetail.actions.map((act) => (
                      <div
                        key={act.id}
                        onClick={() => {
                          onToggleAction(selectedDocForDetail.id, act.id);
                          // Update local state in modal
                          setSelectedDocForDetail({
                            ...selectedDocForDetail,
                            actions: selectedDocForDetail.actions.map((a) =>
                              a.id === act.id ? { ...a, completed: !a.completed } : a
                            ),
                          });
                        }}
                        className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-colors ${
                          act.completed
                            ? 'bg-slate-50 border-slate-100 line-through text-slate-400'
                            : 'bg-white border-slate-200 hover:border-emerald-300'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-md mt-0.5 flex items-center justify-center shrink-0 border ${
                            act.completed ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300'
                          }`}
                        >
                          {act.completed && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-slate-900">{act.todo_vi}</div>
                          {act.deadline && (
                            <div className="text-[11px] text-amber-700 font-medium mt-0.5 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>Hạn chót: {act.deadline}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Items to bring */}
              {selectedDocForDetail.items_to_bring.length > 0 && (
                <div>
                  <h4 className="font-bold text-slate-900 text-sm mb-1.5">🎒 Đồ dùng cần mang theo / chuẩn bị:</h4>
                  <ul className="space-y-1 list-disc list-inside text-slate-700 pl-1">
                    {selectedDocForDetail.items_to_bring.map((item, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Events & Calendar */}
              {selectedDocForDetail.events.length > 0 && (
                <div>
                  <h4 className="font-bold text-slate-900 text-sm mb-1.5">📅 Các sự kiện đã thêm vào lịch:</h4>
                  <div className="space-y-1.5">
                    {selectedDocForDetail.events.map((evt) => (
                      <div
                        key={evt.id}
                        className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl flex items-center justify-between"
                      >
                        <div>
                          <div className="font-bold text-slate-900">{evt.title_vi}</div>
                          {evt.title_jp && <div className="text-[11px] text-slate-500 font-jp">🇯🇵 {evt.title_jp}</div>}
                          {(evt.time || evt.location) && (
                            <div className="text-[11px] text-emerald-800 mt-0.5">
                              {evt.time && <span>⏰ {evt.time} </span>}
                              {evt.location && <span>📍 {evt.location}</span>}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="font-bold text-slate-900 tabular-nums">{evt.date}</span>
                          <span className="block text-[10px] text-emerald-700">VALARM -1 ngày</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Disclaimer */}
              {selectedDocForDetail.disclaimer && (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 flex items-start gap-2 text-[11px]">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>{selectedDocForDetail.disclaimer}</span>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 flex items-center justify-between bg-slate-50">
              <button
                onClick={() => copyDocSummary(selectedDocForDetail)}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl transition-colors flex items-center gap-1.5"
              >
                {copiedSummaryId === selectedDocForDetail.id ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>
                  {copiedSummaryId === selectedDocForDetail.id ? 'Đã sao chép tóm tắt' : 'Sao chép tóm tắt'}
                </span>
              </button>

              <button
                onClick={() => setSelectedDocForDetail(null)}
                className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
