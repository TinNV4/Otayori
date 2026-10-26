import React, { useEffect, useRef, useState } from 'react';
import { Send, Image as ImageIcon, Users, User, RefreshCw, LogIn } from 'lucide-react';
import { PRESET_DOCUMENTS } from '../shared/presets.ts';
import { apiFetch, currentDevUser } from '../lib/api.ts';

interface QuickItem {
  label: string;
  kind: 'message' | 'postback' | 'uri';
  value: string;
  displayText?: string;
}

interface ChatMessage {
  id: string;
  from: 'user' | 'bot';
  text: string;
  via?: string;
  quick?: QuickItem[];
}

interface LineSimulatorViewProps {
  onRefreshData: () => void;
}

const PRESET_LABELS: Record<string, string> = {
  preschool_otayori: 'お便り — Dã ngoại mùa thu',
  yakusho_health: '役所 — Khám sức khỏe 3 tuổi',
  school_lunch_kondate: '献立表 — Thực đơn tháng 11',
  nenkan_yotei: '年間行事 — Lịch năm học',
};

function parseQuick(msg: any): QuickItem[] | undefined {
  const items = msg.quickReply?.items;
  if (!items) return undefined;
  return items.map((it: any) => {
    const a = it.action;
    if (a.type === 'postback') return { label: a.label, kind: 'postback', value: a.data, displayText: a.displayText };
    if (a.type === 'uri') return { label: a.label, kind: 'uri', value: a.uri };
    return { label: a.label, kind: 'message', value: a.text };
  });
}

/**
 * Dev-only LINE chat simulator. Sends synthetic webhook events through the real bot
 * handler (`/api/dev/simulate`) and shows exactly what would be replied/pushed to LINE.
 * With ANTHROPIC_API_KEY set, uploaded photos/PDFs are read by Claude for real.
 */
export const LineSimulatorView: React.FC<LineSimulatorViewProps> = ({ onRefreshData }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatType, setChatType] = useState<'group' | 'user'>('group');
  const [preset, setPreset] = useState('preschool_otayori');
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, busy]);

  const push = (m: Omit<ChatMessage, 'id'>) => setMessages((prev) => [...prev, { ...m, id: `${Date.now()}_${Math.random()}` }]);

  const simulate = async (payload: Record<string, unknown>, userLabel: string) => {
    push({ from: 'user', text: userLabel });
    setBusy(true);
    try {
      const res = await apiFetch('/api/dev/simulate', { method: 'POST', body: JSON.stringify({ chatType, ...payload }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      for (const m of data.messages as any[]) {
        push({ from: 'bot', text: m.text || `[${m.type}]`, via: m.via, quick: parseQuick(m) });
      }
      if (!data.messages.length) push({ from: 'bot', text: '(bot không trả lời — đúng hành vi trong nhóm)', via: 'none' });
    } catch (err) {
      push({ from: 'bot', text: `⚠️ Lỗi: ${String((err as Error).message || err)}`, via: 'error' });
    } finally {
      setBusy(false);
      onRefreshData();
    }
  };

  const sendText = (t: string) => {
    const text = t.trim();
    if (!text) return;
    setInput('');
    simulate({ kind: 'text', textMessage: text }, text);
  };

  const onQuick = (q: QuickItem) => {
    if (q.kind === 'uri') window.open(q.value, '_blank');
    else if (q.kind === 'postback') simulate({ kind: 'postback', postbackData: q.value }, q.displayText || q.label);
    else sendText(q.value);
  };

  const sendPreset = () =>
    simulate({ kind: 'image', presetId: preset, pages }, `[📷 ${pages} ảnh] ${PRESET_LABELS[preset] || preset}`);

  const sendFile = async (file: File) => {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    simulate({ kind: 'image', imageBase64: btoa(bin), mimeType: file.type || 'image/jpeg' }, `[📎 ${file.name}]`);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-4 space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 text-sm">
          <div>
            <h2 className="font-bold text-slate-900">🧪 LINE Test Lab (dev)</h2>
            <p className="text-xs text-slate-500 mt-1">
              Gửi sự kiện giả qua đúng bot handler. Người dùng hiện tại: <code>{currentDevUser()}</code> (đổi bằng <code>?dev_user=U...</code>).
            </p>
          </div>

          <div className="flex gap-1 p-0.5 bg-slate-100 rounded-lg text-xs">
            {(['group', 'user'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setChatType(t)}
                className={`flex-1 px-2 py-1.5 rounded-md flex items-center justify-center gap-1 ${chatType === t ? 'bg-white font-semibold shadow-xs' : 'text-slate-600'}`}
              >
                {t === 'group' ? <Users className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                {t === 'group' ? 'Nhóm gia đình' : 'Chat 1:1'}
              </button>
            ))}
          </div>

          <button
            onClick={() => simulate({ kind: 'join' }, chatType === 'group' ? '[Thêm bot vào nhóm]' : '[Kết bạn với bot]')}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <LogIn className="w-3.5 h-3.5" /> Join / Follow
          </button>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700">Giấy mẫu (mock khi chưa có API key)</label>
            <select value={preset} onChange={(e) => setPreset(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2 text-xs">
              {Object.keys(PRESET_DOCUMENTS).map((k) => (
                <option key={k} value={k}>{PRESET_LABELS[k] || k}</option>
              ))}
            </select>
            <div className="flex items-center gap-2 text-xs">
              <span>Số trang</span>
              <input type="number" min={1} max={6} value={pages} onChange={(e) => setPages(Number(e.target.value) || 1)} className="w-16 border border-slate-200 rounded p-1" />
            </div>
            <button onClick={sendPreset} disabled={busy} className="w-full px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50">
              <ImageIcon className="w-3.5 h-3.5" /> Gửi ảnh giấy mẫu
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700">Ảnh / PDF thật (cần ANTHROPIC_API_KEY)</label>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && sendFile(e.target.files[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="w-full px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold disabled:opacity-50">
              Chọn file…
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {['Đồng ý điều khoản', 'BETA2026', 'lịch', 'trạng thái', 'hướng dẫn', '/soạn Hôm nay bé bị sốt xin nghỉ học', 'xóa dữ liệu', '/whoami'].map((t) => (
              <button key={t} onClick={() => sendText(t)} className="px-2 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-[11px]">
                {t}
              </button>
            ))}
          </div>
          <button onClick={() => setMessages([])} className="text-xs text-slate-500 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Xóa khung chat
          </button>
        </div>
      </div>

      <div className="lg:col-span-8 bg-[#8cabd9] rounded-2xl flex flex-col h-[70vh]">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.from === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap text-[13px] leading-relaxed px-3 py-2 rounded-2xl ${m.from === 'user' ? 'bg-[#a6e07f] text-slate-900' : 'bg-white text-slate-900'}`}>
                {m.text}
              </div>
              {m.via && m.from === 'bot' && <span className="text-[10px] text-white/80 mt-0.5">{m.via === 'push' ? 'push (tốn quota)' : m.via}</span>}
              {m.quick && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {m.quick.map((q, i) => (
                    <button key={i} onClick={() => onQuick(q)} className="px-3 py-1 rounded-full bg-white/90 border border-slate-200 text-[12px] hover:bg-white">
                      {q.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="text-xs text-white">Bot đang đọc…</div>}
          <div ref={endRef} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendText(input);
          }}
          className="p-3 bg-white rounded-b-2xl flex gap-2"
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Nhập tin nhắn…" className="flex-1 border border-slate-200 rounded-full px-4 py-2 text-sm" />
          <button type="submit" disabled={busy} className="px-4 rounded-full bg-emerald-600 text-white disabled:opacity-50">
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
