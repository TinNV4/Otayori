import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Image as ImageIcon,
  CheckCircle,
  Clock,
  Sparkles,
  RefreshCw,
  AlertCircle,
  FileText,
  User,
  Users,
  Calendar,
  ThumbsUp,
  ThumbsDown,
  Download,
  Info,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { PRESET_DOCUMENTS } from '../server/pipeline.ts';

interface Message {
  id: string;
  sender: 'user' | 'bot' | 'system';
  senderName?: string;
  text: string;
  timestamp: string;
  quickReplies?: string[];
  imageUrl?: string;
  isProcessing?: boolean;
  isUrgentPush?: boolean;
}

interface LineSimulatorViewProps {
  familyId: string;
  onRefreshData: () => void;
  onOpenPrivacy: () => void;
}

export const LineSimulatorView: React.FC<LineSimulatorViewProps> = ({
  familyId,
  onRefreshData,
  onOpenPrivacy,
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'm1',
      sender: 'bot',
      senderName: 'Trợ lý Giấy Tờ Nhật',
      text:
        '👋 Chào mừng gia đình bạn đến với Trợ lý Giấy Tờ Nhật (Bản Beta)!\n\n' +
        'Tôi giúp đọc お便り, giấy tờ 役所, form điền và đồng bộ vào lịch điện thoại qua link ICS.\n\n' +
        '📋 Để bắt đầu:\n' +
        '1. Đọc chính sách bảo mật riêng tư\n' +
        '2. Bấm "Đồng ý điều khoản" và nhập Mã mời (ví dụ: BETA2026).\n\n' +
        '🚨 Tính năng mới: Bạn có thể đánh dấu giấy tờ [KHẨN CẤP] để được ưu tiên xử lý tức thì và nhận thông báo nhắc nhở trực tiếp qua LINE.',
      timestamp: '09:00',
      quickReplies: ['✅ Đồng ý điều khoản', 'Mã mời: BETA2026', '/whoami', '/soạn'],
    },
  ]);

  const [inputText, setInputText] = useState('');
  const [chatType, setChatType] = useState<'group' | 'single'>('group');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUrgentUpload, setIsUrgentUpload] = useState(false);
  const [aggregationCounter, setAggregationCounter] = useState(0);
  const [selectedPreset, setSelectedPreset] = useState<string>('preschool_otayori');
  const [rawTextSnippet, setRawTextSnippet] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'presets' | 'ics_preview'>('chat');
  const [icsFeedText, setIcsFeedText] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isProcessing]);

  // Fetch real ICS feed
  const loadIcsFeed = async () => {
    try {
      const res = await fetch(`/ics/sec_token_${familyId}_99x8.ics`);
      if (res.ok) {
        const text = await res.text();
        setIcsFeedText(text);
      } else {
        // Fallback demo fetch
        const resFam = await fetch(`/api/family?familyId=${familyId}`);
        const famData = await resFam.json();
        if (famData?.family?.ics_token) {
          const res2 = await fetch(`/ics/${famData.family.ics_token}.ics`);
          if (res2.ok) setIcsFeedText(await res2.text());
        }
      }
    } catch {
      setIcsFeedText('BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//GiayToNhat//VI\n...');
    }
  };

  useEffect(() => {
    loadIcsFeed();
  }, [familyId]);

  // Send text message into LINE chat
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text) return;
    setInputText('');

    if (text.startsWith('/gấp') || text.startsWith('/urgent')) {
      handleSendDocumentImage(selectedPreset, 1, true);
      return;
    }

    const userMsg: Message = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      senderName: chatType === 'group' ? 'Bố Kenji' : 'Bạn',
      text,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);

    try {
      // Call server webhook endpoint
      const res = await fetch('/api/line/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': 'dev_simulated_sig',
        },
        body: JSON.stringify({
          events: [
            {
              type: 'message',
              source: {
                groupId: chatType === 'group' ? 'C_tokyo_group_9823' : undefined,
                userId: 'U_kenji_line_user_01',
              },
              message: {
                type: 'text',
                text,
              },
            },
          ],
        }),
      });

      const data = await res.json();
      if (data.replies && data.replies.length > 0) {
        data.replies.forEach((rep: any) => {
          const quickReplies = rep.quickReply?.items?.map((item: any) => item.action?.label || item.action?.text) || [];
          setMessages((prev) => [
            ...prev,
            {
              id: `bot_${Date.now()}_${Math.random()}`,
              sender: 'bot',
              senderName: 'Trợ lý Giấy Tờ Nhật',
              text: rep.text,
              timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
              quickReplies: quickReplies.length > 0 ? quickReplies : undefined,
            },
          ]);
        });
      }
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setIsProcessing(false);
      onRefreshData();
      loadIcsFeed();
    }
  };

  // Simulate sending a Japanese document photo
  const handleSendDocumentImage = async (presetKey: string, multiPageCount: number = 1, forceUrgent?: boolean) => {
    setIsProcessing(true);
    const urgent = forceUrgent !== undefined ? forceUrgent : isUrgentUpload;

    const userMsg: Message = {
      id: `img_${Date.now()}`,
      sender: 'user',
      senderName: chatType === 'group' ? 'Mẹ Mai' : 'Bạn',
      text: `[Đã gửi ${multiPageCount > 1 ? `${multiPageCount} ảnh liên tiếp trong 60s` : '1 ảnh giấy tờ tiếng Nhật'}${urgent ? ' · 🚨 ĐÁNH DẤU KHẨN CẤP' : ''}]`,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);

    try {
      // Process document with pipeline
      const res = await fetch('/api/simulate/process-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyId,
          presetId: presetKey,
          textSnippet: rawTextSnippet || undefined,
          pageCount: multiPageCount,
          isUrgent: urgent,
        }),
      });

      const data = await res.json();
      if (data.line_message) {
        setMessages((prev) => [
          ...prev,
          {
            id: `bot_doc_${Date.now()}`,
            sender: 'bot',
            senderName: 'Trợ lý Giấy Tờ Nhật',
            text: data.line_message,
            timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
            quickReplies: ['👍 Đúng', '👎 Sai', '✏️ Sửa ngày', '📅 Xem lịch tháng'],
          },
        ]);
      }

      if (data.urgent_push_message) {
        setMessages((prev) => [
          ...prev,
          {
            id: `bot_urgent_push_${Date.now()}`,
            sender: 'bot',
            senderName: '🚨 LINE Push Service (Khẩn cấp)',
            text: data.urgent_push_message,
            timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
            isUrgentPush: true,
          },
        ]);
      }
    } catch (err) {
      console.error('Error processing simulated doc:', err);
    } finally {
      setIsProcessing(false);
      onRefreshData();
      loadIcsFeed();
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Preset Selector & Controls (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>🧪 Thử nghiệm tài liệu tiếng Nhật</span>
              </h2>
              <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg text-xs">
                <button
                  onClick={() => setChatType('group')}
                  className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
                    chatType === 'group' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600'
                  }`}
                >
                  <Users className="w-3 h-3" />
                  <span>Group LINE</span>
                </button>
                <button
                  onClick={() => setChatType('single')}
                  className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
                    chatType === 'single' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600'
                  }`}
                >
                  <User className="w-3 h-3" />
                  <span>Chat 1-1</span>
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              Chọn mẫu giấy tờ bên dưới để thử nghiệm tốc độ đọc, phân loại Haiku/Sonnet và đồng bộ lịch tự động.
            </p>

            {/* Presets Grid */}
            <div className="space-y-2">
              <div
                onClick={() => setSelectedPreset('preschool_otayori')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedPreset === 'preschool_otayori'
                    ? 'border-emerald-500 bg-emerald-50/50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">Mẫu 1: お便り Bản tin tháng 11 mầm non</span>
                  <span className="text-[10px] text-emerald-800 font-semibold">Haiku (Tiết kiệm)</span>
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Thông báo dã ngoại mùa thu tại CV Kasai Rinkai, hạn nộp đơn 02/11 và chuẩn bị cơm hộp Bento.
                </p>
              </div>

              <div
                onClick={() => setSelectedPreset('yakusho_health')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedPreset === 'yakusho_health'
                    ? 'border-emerald-500 bg-emerald-50/50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">Mẫu 2: Giấy 役所 Khám sức khỏe 3 tuổi</span>
                  <span className="text-[10px] text-indigo-700 font-semibold">Sonnet (Hành chính)</span>
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Phiếu triệu tập khám định kỳ trẻ 3 tuổi, mẫu nước tiểu buổi sáng và điền trước bảng hỏi 問診票.
                </p>
              </div>

              <div
                onClick={() => setSelectedPreset('school_lunch_kondate')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedPreset === 'school_lunch_kondate'
                    ? 'border-emerald-500 bg-emerald-50/50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">Mẫu 3: Thực đơn 献立表 & Dị ứng</span>
                  <span className="text-[10px] text-emerald-800 font-semibold">Haiku</span>
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Thực đơn ăn trưa trường học tháng 11, cảnh báo dị ứng trứng/hải sản và đồ ăn trưa mang theo.
                </p>
              </div>

              <div
                onClick={() => setSelectedPreset('nenkan_yotei')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedPreset === 'nenkan_yotei'
                    ? 'border-emerald-500 bg-emerald-50/50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">Mẫu 4: Lịch năm học 年間行事予定表</span>
                  <span className="text-[10px] text-emerald-800 font-semibold">Haiku (Multi-events)</span>
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Nhập cả năm học vào lịch: Hội thao Undokai, họp phụ huynh, bế giảng học kỳ và khai giảng.
                </p>
              </div>
            </div>

            {/* Urgent Priority Checkbox */}
            <div className="mt-3 p-3 rounded-xl border border-rose-200 bg-rose-50/60 transition-colors">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isUrgentUpload}
                  onChange={(e) => setIsUrgentUpload(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-rose-600 rounded border-slate-300 focus:ring-rose-500 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-rose-950">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600 fill-rose-600" />
                    <span>Đánh dấu Khẩn Cấp (Urgent Priority & Push)</span>
                  </div>
                  <p className="text-[11px] text-rose-800 mt-0.5 leading-snug">
                    Bỏ qua hàng đợi gom ảnh, bot ưu tiên đọc tài liệu ngay và gửi thông báo push trực tiếp qua LINE (tính vào quota 200 tin).
                  </p>
                </div>
              </label>
            </div>

            {/* Action Buttons: 1 Page vs 60s Multi-Page Batch */}
            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
              <button
                disabled={isProcessing}
                onClick={() => handleSendDocumentImage(selectedPreset, 1)}
                className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-xs ${
                  isUrgentUpload
                    ? 'bg-rose-600 hover:bg-rose-700 text-white animate-pulse'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                <span>{isUrgentUpload ? 'Gửi Khẩn Cấp (1 trang)' : 'Chụp & Gửi mẫu này (1 trang)'}</span>
              </button>

              <button
                disabled={isProcessing}
                onClick={() => handleSendDocumentImage(selectedPreset, 2)}
                className="py-2.5 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
                title="Gom nhiều ảnh gửi liên tiếp trong 60 giây thành 1 tài liệu nhiều trang"
              >
                <Clock className="w-4 h-4" />
                <span>Gom 2 trang (60s Batch)</span>
              </button>
            </div>
          </div>

          {/* Quick Command Cheatsheet */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs text-xs space-y-2">
            <div className="font-bold text-slate-800 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-slate-500" />
              <span>Các lệnh bot hỗ trợ trong nhóm:</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <button
                onClick={() => handleSendMessage('/whoami')}
                className="p-2 bg-slate-50 rounded-lg text-left hover:bg-slate-100 transition-colors border border-slate-100"
              >
                <span className="font-mono font-bold text-emerald-800 block">/whoami</span>
                <span className="text-slate-500">Xem LINE User ID của bạn</span>
              </button>

              <button
                onClick={() => handleSendMessage('/gấp')}
                className="p-2 bg-rose-50 rounded-lg text-left hover:bg-rose-100 transition-colors border border-rose-200"
              >
                <span className="font-mono font-bold text-rose-800 block">/gấp</span>
                <span className="text-slate-600">Gửi giấy tờ khẩn cấp ngay</span>
              </button>

              <button
                onClick={() => handleSendMessage('/soạn Bé Kenji bị sốt 38.5 độ xin nghỉ học hôm nay')}
                className="p-2 bg-slate-50 rounded-lg text-left hover:bg-slate-100 transition-colors border border-slate-100"
              >
                <span className="font-mono font-bold text-emerald-800 block">/soạn [lý do]</span>
                <span className="text-slate-500">Soạn 連絡帳 kính ngữ</span>
              </button>

              <button
                onClick={() => handleSendMessage('BETA2026')}
                className="p-2 bg-slate-50 rounded-lg text-left hover:bg-slate-100 transition-colors border border-slate-100"
              >
                <span className="font-mono font-bold text-emerald-800 block">BETA2026</span>
                <span className="text-slate-500">Kích hoạt mã mời 50 giấy</span>
              </button>

              <button
                onClick={() => handleSendMessage('xóa dữ liệu')}
                className="p-2 bg-slate-50 rounded-lg text-left hover:bg-slate-100 transition-colors border border-slate-100"
              >
                <span className="font-mono font-bold text-rose-700 block">xóa dữ liệu</span>
                <span className="text-slate-500">Yêu cầu xóa dữ liệu gia đình</span>
              </button>
            </div>
          </div>

          {/* ICS Live Feed Inspector */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-800 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                <span>Xem trước nội dung ICS (RFC 5545)</span>
              </span>
              <a
                href={`/ics/sec_token_${familyId}_99x8.ics`}
                download="test_family.ics"
                className="text-emerald-700 font-semibold hover:underline flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                <span>Tải .ics</span>
              </a>
            </div>
            <pre className="text-[10px] font-mono bg-slate-50 p-2.5 rounded-lg border border-slate-200 max-h-36 overflow-y-auto text-slate-700 select-all leading-tight">
              {icsFeedText || 'Đang tải thông tin lịch...'}
            </pre>
          </div>
        </div>

        {/* Right Column: Interactive LINE Smartphone Window (7 Cols) */}
        <div className="lg:col-span-7">
          <div className="bg-slate-900 rounded-3xl p-3 sm:p-4 shadow-xl border border-slate-800 max-w-lg mx-auto">
            {/* Phone Screen Mockup */}
            <div className="bg-[#72899b] rounded-2xl overflow-hidden flex flex-col h-[640px] border border-slate-700 relative">
              {/* LINE Header */}
              <div className="bg-[#243342] text-white px-4 py-3 flex items-center justify-between shrink-0 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center font-bold text-white text-xs">
                    日
                  </div>
                  <div>
                    <h3 className="text-xs font-bold leading-tight">
                      {chatType === 'group' ? '👨‍👩‍👧 Nhóm Gia Đình (Tokyo)' : 'Trợ lý Giấy Tờ Nhật'}
                    </h3>
                    <p className="text-[10px] text-slate-300">
                      {chatType === 'group' ? '3 thành viên · Bot luôn sẵn sàng' : 'LINE Official Account'}
                    </p>
                  </div>
                </div>

                <div className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full text-slate-200">
                  LINE Verified
                </div>
              </div>

              {/* Chat Messages Feed */}
              <div className="flex-1 p-3 overflow-y-auto space-y-3.5">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    {m.senderName && (
                      <span className="text-[10px] text-white/80 mb-0.5 px-1">
                        {m.senderName}
                      </span>
                    )}

                    <div
                      className={`max-w-[85%] rounded-2xl p-3 text-xs shadow-xs leading-relaxed whitespace-pre-wrap ${
                        m.isUrgentPush
                          ? 'bg-rose-50 text-rose-950 border border-rose-300 ring-1 ring-rose-200 rounded-tl-xs'
                          : m.sender === 'user'
                          ? 'bg-[#85e249] text-slate-900 rounded-tr-xs'
                          : 'bg-white text-slate-900 rounded-tl-xs'
                      }`}
                    >
                      {m.isUrgentPush && (
                        <div className="flex items-center gap-1.5 pb-2 mb-2 border-b border-rose-200 text-rose-800 font-bold text-[11px]">
                          <AlertTriangle className="w-4 h-4 text-rose-600 fill-rose-600 shrink-0" />
                          <span>LINE PUSH KHẨN CẤP (Tính vào quota 200 tin)</span>
                        </div>
                      )}
                      {m.text}
                    </div>

                    <span className="text-[9px] text-white/60 mt-0.5 px-1">{m.timestamp}</span>

                    {/* Quick Replies Buttons */}
                    {m.quickReplies && m.quickReplies.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2 max-w-full">
                        {m.quickReplies.map((qr, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              if (qr === '✅ Đồng ý điều khoản') {
                                handleSendMessage('Đồng ý điều khoản');
                              } else if (qr === 'Mã mời: BETA2026') {
                                handleSendMessage('BETA2026');
                              } else if (qr === '👍 Đúng') {
                                handleSendMessage('Đúng');
                              } else if (qr === '👎 Sai') {
                                handleSendMessage('Sai');
                              } else if (qr === '✏️ Sửa ngày') {
                                handleSendMessage('Sửa ngày');
                              } else {
                                handleSendMessage(qr);
                              }
                            }}
                            className="text-[11px] font-medium bg-white/90 hover:bg-white text-slate-800 px-3 py-1 rounded-full shadow-xs border border-slate-200 transition-colors"
                          >
                            {qr}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* Loading indicator */}
                {isProcessing && (
                  <div className="flex items-center gap-2 bg-white/90 text-slate-800 p-2.5 rounded-2xl rounded-tl-xs max-w-[200px] text-xs">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                    <span>Đang đọc giấy tờ...</span>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input Bar */}
              <div className="bg-white p-2.5 border-t border-slate-200 flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleSendDocumentImage(selectedPreset, 1)}
                  className="p-2 text-slate-500 hover:text-emerald-600 hover:bg-slate-100 rounded-full transition-colors"
                  title="Gửi ảnh giấy tờ mẫu"
                >
                  <ImageIcon className="w-5 h-5" />
                </button>

                <input
                  type="text"
                  placeholder="Gửi tin nhắn hoặc lệnh (/soạn, BETA2026)..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSendMessage();
                  }}
                  className="flex-1 bg-slate-100 rounded-full px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />

                <button
                  onClick={() => handleSendMessage()}
                  className="p-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full transition-colors shadow-xs"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
