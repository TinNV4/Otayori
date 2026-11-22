import React, { useEffect, useRef, useState } from 'react';
import { Send, Image as ImageIcon, FileUp, LogIn, AtSign, Trash2, Bot, ChevronDown, ExternalLink } from 'lucide-react';
import { PRESET_DOCUMENTS } from '../shared/presets.ts';
import { apiFetch, currentDevUser } from '../lib/api.ts';
import { Button, Chip, Segmented } from './ui/kit.tsx';

interface QuickItem {
  label: string;
  kind: 'message' | 'postback' | 'uri' | 'camera';
  value: string;
  displayText?: string;
}

interface ChatMessage {
  id: string;
  from: 'user' | 'bot' | 'system';
  sender?: string;
  text: string;
  via?: string;
  quick?: QuickItem[];
}

interface LineSimulatorViewProps {
  onRefreshData: () => void;
}

const PRESET_LABELS: Record<string, string> = {
  preschool_otayori: 'お便り · Dã ngoại mùa thu',
  yakusho_health: '役所 · Khám sức khỏe 3 tuổi',
  school_lunch_kondate: '献立表 · Thực đơn tháng 11',
  nenkan_yotei: '年間行事 · Lịch năm học',
};

const COMMANDS = ['Đồng ý', 'BETA2026', 'menu', 'lịch', 'dịch', 'trạng thái', 'nhắc sáng bật', '/soạn Hôm nay bé bị sốt xin nghỉ học', 'xóa dữ liệu', '/whoami'];

/** Pretend group members (sender ids in the dev group). The first one is you. */
const MEMBERS = [
  { id: 'me', label: 'Bạn' },
  { id: 'U_dev_mom', label: 'Mẹ' },
  { id: 'U_dev_dad', label: 'Bố' },
] as const;

function parseQuick(msg: any): QuickItem[] | undefined {
  const items = msg.quickReply?.items;
  if (!items) return undefined;
  return items.map((it: any) => {
    const a = it.action;
    if (a.type === 'postback') return { label: a.label, kind: 'postback', value: a.data, displayText: a.displayText };
    if (a.type === 'uri') return { label: a.label, kind: 'uri', value: a.uri };
    if (a.type === 'camera' || a.type === 'cameraRoll') return { label: a.label, kind: 'camera', value: '' };
    return { label: a.label, kind: 'message', value: a.text };
  });
}

const VIA_LABEL: Record<string, string> = { reply: 'reply', push: 'push · tốn quota', none: 'không trả lời', error: 'lỗi' };

/**
 * Dev-only LINE chat simulator. Sends synthetic webhook events through the real bot handler
 * (`/api/dev/simulate`) and shows exactly what would be replied/pushed to LINE.
 * With ANTHROPIC_API_KEY set, uploaded photos/PDFs and tag-analysis use Claude for real.
 */
export const LineSimulatorView: React.FC<LineSimulatorViewProps> = ({ onRefreshData }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatType, setChatType] = useState<'group' | 'user'>('group');
  const [sender, setSender] = useState<(typeof MEMBERS)[number]['id']>('me');
  const [tagBot, setTagBot] = useState(false);
  const [preset, setPreset] = useState('preschool_otayori');
  const [pages, setPages] = useState(1);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Braces matter: newer browsers return a Promise from scrollIntoView, which React would treat as a cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  const push = (m: Omit<ChatMessage, 'id'>) => setMessages((prev) => [...prev, { ...m, id: `${Date.now()}_${Math.random()}` }]);
  const senderLabel = chatType === 'group' ? MEMBERS.find((m) => m.id === sender)!.label : 'Bạn';

  const simulate = async (payload: Record<string, unknown>, userLabel: string) => {
    push({ from: 'user', sender: senderLabel, text: userLabel });
    setBusy(true);
    try {
      const asUserId = chatType === 'group' && sender !== 'me' ? sender : undefined;
      const res = await apiFetch('/api/dev/simulate', { method: 'POST', body: JSON.stringify({ chatType, asUserId, ...payload }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      for (const m of data.messages as any[]) push({ from: 'bot', text: m.text || `[${m.type}]`, via: m.via, quick: parseQuick(m) });
      if (!data.messages.length) push({ from: 'system', text: 'Bot không trả lời (đúng hành vi khi không bị tag trong nhóm).' });
    } catch (err) {
      push({ from: 'bot', text: `Lỗi: ${String((err as Error).message || err)}`, via: 'error' });
    } finally {
      setBusy(false);
      onRefreshData();
    }
  };

  const sendText = (t: string, opts: { tag?: boolean } = {}) => {
    const text = t.trim();
    const mention = opts.tag ?? (tagBot && chatType === 'group');
    if (!text && !mention) return;
    setInput('');
    simulate({ kind: 'text', textMessage: text, mention }, mention ? `@Kami Việt ${text}`.trim() : text);
  };

  const onQuick = (q: QuickItem) => {
    if (q.kind === 'uri') window.open(q.value, '_blank');
    else if (q.kind === 'camera') fileRef.current?.click();
    else if (q.kind === 'postback') simulate({ kind: 'postback', postbackData: q.value }, q.displayText || q.label);
    else sendText(q.value, { tag: false });
  };

  const sendPreset = () => simulate({ kind: 'image', presetId: preset, pages }, `[Ảnh · ${pages} trang] ${PRESET_LABELS[preset] || preset}`);

  const sendFile = async (file: File) => {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    simulate({ kind: 'image', imageBase64: btoa(bin), mimeType: file.type || 'image/jpeg' }, `[Tệp] ${file.name}`);
  };

  const lastBot = [...messages].reverse().find((m) => m.from === 'bot');

  return (
    <div className="mx-auto flex max-w-md flex-col" style={{ minHeight: 'calc(100dvh - 48px)' }}>
      {/* Controls */}
      <div className="space-y-3 border-b border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Segmented value={chatType} onChange={(v) => setChatType(v)} items={[{ id: 'group', label: 'Nhóm gia đình' }, { id: 'user', label: 'Chat 1:1' }]} />
          </div>
          <button onClick={() => setMessages([])} aria-label="Xóa khung chat" className="flex h-10 w-10 items-center justify-center rounded-control text-ink-2 active:bg-sunken">
            <Trash2 className="h-5 w-5" />
          </button>
        </div>

        {chatType === 'group' && (
          <div className="flex items-center gap-2">
            <span className="text-footnote text-ink-2">Người gửi</span>
            <div className="flex-1">
              <Segmented value={sender} onChange={setSender} items={MEMBERS.map((m) => ({ id: m.id, label: m.label }))} />
            </div>
          </div>
        )}

        <button onClick={() => setToolsOpen((v) => !v)} className="flex w-full items-center justify-between text-footnote font-semibold text-ink-2" aria-expanded={toolsOpen}>
          Công cụ thử
          <ChevronDown className={`h-4 w-4 transition-transform ${toolsOpen ? 'rotate-180' : ''}`} />
        </button>

        {toolsOpen && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" icon={LogIn} disabled={busy} onClick={() => simulate({ kind: 'join' }, chatType === 'group' ? '[Thêm bot vào nhóm]' : '[Kết bạn với bot]')}>
                {chatType === 'group' ? 'Thêm bot' : 'Kết bạn'}
              </Button>
              <Button variant="secondary" icon={FileUp} disabled={busy} onClick={() => fileRef.current?.click()}>Ảnh / PDF thật</Button>
            </div>
            <div className="flex gap-2">
              <select value={preset} onChange={(e) => setPreset(e.target.value)} className="h-11 min-w-0 flex-1 rounded-control border border-line bg-surface px-2 text-subhead" aria-label="Giấy mẫu">
                {Object.keys(PRESET_DOCUMENTS).map((k) => <option key={k} value={k}>{PRESET_LABELS[k] || k}</option>)}
              </select>
              <select value={pages} onChange={(e) => setPages(Number(e.target.value))} className="h-11 w-[72px] rounded-control border border-line bg-surface px-2 text-subhead" aria-label="Số trang">
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} tr</option>)}
              </select>
              <Button icon={ImageIcon} disabled={busy} onClick={sendPreset}>Gửi giấy</Button>
            </div>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {COMMANDS.map((c) => (
                <button key={c} onClick={() => sendText(c, { tag: false })} disabled={busy} className="h-8 shrink-0 rounded-full border border-line bg-surface px-3 text-footnote text-ink active:bg-sunken disabled:opacity-50">
                  {c.length > 22 ? `${c.slice(0, 20)}…` : c}
                </button>
              ))}
            </div>
            <p className="text-caption text-ink-3">
              Đi qua đúng bot handler thật. Người dùng: <code>{currentDevUser()}</code>. Giấy mẫu dùng mock khi chưa có ANTHROPIC_API_KEY.
            </p>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) sendFile(f); }} />
      </div>

      {/* Transcript */}
      <div className="flex-1 space-y-3 bg-canvas px-3 py-4 pb-36">
        {messages.length === 0 && (
          <p className="pt-8 text-center text-footnote text-ink-3">Bắt đầu: “Thêm vào nhóm” → “Đồng ý” → “BETA2026” → gửi giấy mẫu.</p>
        )}
        {messages.map((m) =>
          m.from === 'system' ? (
            <p key={m.id} className="text-center text-caption text-ink-3">{m.text}</p>
          ) : (
            <div key={m.id} className={`flex gap-2 ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.from === 'bot' && (
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white"><Bot className="h-4 w-4" /></span>
              )}
              <div className={`flex max-w-[80%] flex-col ${m.from === 'user' ? 'items-end' : 'items-start'}`}>
                {m.from === 'user' && chatType === 'group' && <span className="mb-0.5 px-1 text-caption text-ink-3">{m.sender}</span>}
                <div
                  className={`whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2 text-subhead ${
                    m.from === 'user' ? 'rounded-br-md bg-brand-600 text-white' : m.via === 'error' ? 'rounded-bl-md bg-danger-soft text-danger' : 'rounded-bl-md border border-line bg-surface text-ink'
                  }`}
                >
                  {m.text}
                </div>
                {m.via && m.from === 'bot' && m.via !== 'reply' && (
                  <span className="mt-1"><Chip tone={m.via === 'push' ? 'warn' : m.via === 'error' ? 'danger' : 'neutral'}>{VIA_LABEL[m.via] || m.via}</Chip></span>
                )}
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 pl-10 text-footnote text-ink-3">
            <span className="inline-flex gap-1">
              {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-3" style={{ animationDelay: `${i * 150}ms` }} />)}
            </span>
            Bot đang xử lý…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Quick replies + composer (fixed, like LINE) */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-surface shadow-bar" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto max-w-md">
          {lastBot?.quick && (
            <div className="flex gap-2 overflow-x-auto px-3 pt-2">
              {lastBot.quick.map((q, i) => (
                <button key={i} onClick={() => onQuick(q)} disabled={busy} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-brand-600 bg-surface px-3 text-footnote font-semibold text-brand-600 active:bg-brand-50 disabled:opacity-50">
                  {q.label}
                  {q.kind === 'uri' && <ExternalLink className="h-3.5 w-3.5" />}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); sendText(input); }} className="flex items-center gap-2 px-3 py-2">
            {chatType === 'group' && (
              <button
                type="button"
                onClick={() => setTagBot((v) => !v)}
                aria-pressed={tagBot}
                aria-label="Tag bot"
                className={`flex h-10 shrink-0 items-center gap-1 rounded-full px-3 text-footnote font-semibold ${tagBot ? 'bg-brand-600 text-white' : 'bg-sunken text-ink-2 ring-1 ring-inset ring-line'}`}
              >
                <AtSign className="h-4 w-4" /> Bot
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={tagBot && chatType === 'group' ? 'Tag bot: “lưu lịch giúp”…' : 'Nhập tin nhắn…'}
              className="h-10 min-w-0 flex-1 rounded-full bg-sunken px-4 text-body outline-none ring-1 ring-inset ring-line placeholder:text-ink-3 focus:ring-brand-600"
            />
            <button type="submit" disabled={busy || (!input.trim() && !(tagBot && chatType === 'group'))} aria-label="Gửi tin nhắn" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
