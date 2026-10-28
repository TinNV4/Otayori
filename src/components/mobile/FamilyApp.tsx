import React, { useEffect, useMemo, useState } from 'react';
import liff from '@line/liff';
import {
  ListTodo, FileText, CalendarDays, Settings, ChevronLeft, ChevronRight, Check, ThumbsUp, ThumbsDown,
  Trash2, MapPin, Clock, AlertTriangle, Search, RefreshCw, Shield, Pencil, Wrench, BarChart3,
} from 'lucide-react';
import { DocAction, DocEvent, DocType, ExtractedDocument, Family } from '../../types/index.ts';

type Tab = 'upcoming' | 'docs' | 'calendar' | 'settings';

export interface FamilyAppProps {
  family: Family;
  documents: ExtractedDocument[];
  isAdmin: boolean;
  devMode: boolean;
  initialDocId?: string | null;
  initialTab?: Tab;
  onToggleAction: (docId: string, actionId: string) => void;
  onFeedback: (docId: string, v: 'up' | 'down') => void;
  onEditDate: (docId: string, patch: { events?: Array<{ id: string; date: string }>; actions?: Array<{ id: string; deadline: string }> }) => Promise<ExtractedDocument | null>;
  onDeleteDocument: (docId: string) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onRotateIcsToken: () => void;
  onDeleteFamilyData: () => void;
  onOpenPrivacy: () => void;
  onOpenAdmin: () => void;
  onOpenSimulator: () => void;
}

// ---------- helpers ----------
const todayJst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function dayLabel(iso: string, today: string) {
  if (iso === today) return 'Hôm nay';
  if (iso === addDaysIso(today, 1)) return 'Ngày mai';
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WD[d.getUTCDay()]}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const TYPE: Record<DocType, { icon: string; label: string }> = {
  otayori: { icon: '🏫', label: 'Thông báo trường' },
  nenkan_yotei: { icon: '🗓️', label: 'Lịch năm học' },
  kondate: { icon: '🍱', label: 'Thực đơn' },
  yakusho: { icon: '🏛️', label: 'Giấy 役所' },
  form: { icon: '📝', label: 'Form cần nộp' },
  hospital: { icon: '🏥', label: 'Y tế / khám' },
  kairanban: { icon: '🏘️', label: 'Khu phố' },
  meisai: { icon: '🧾', label: 'Hóa đơn' },
  other: { icon: '📄', label: 'Khác' },
};

function openExternal(url: string) {
  try {
    if (liff.isInClient()) return liff.openWindow({ url, external: true });
  } catch {
    /* not initialised in dev */
  }
  window.open(url, '_blank', 'noopener');
}

// ---------- small building blocks ----------
const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-white rounded-2xl border border-slate-200 ${className}`}>{children}</div>
);

const CheckCircle: React.FC<{ done: boolean; onClick: () => void }> = ({ done, onClick }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    aria-label={done ? 'Bỏ đánh dấu xong' : 'Đánh dấu đã xong'}
    className={`w-8 h-8 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${done ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300 bg-white'}`}
  >
    {done && <Check className="w-5 h-5" strokeWidth={3} />}
  </button>
);

// ---------- tab: upcoming ----------
type Row =
  | { kind: 'action'; date?: string; doc: ExtractedDocument; action: DocAction }
  | { kind: 'event'; date: string; doc: ExtractedDocument; event: DocEvent };

const UpcomingTab: React.FC<{ documents: ExtractedDocument[]; onToggle: FamilyAppProps['onToggleAction']; onOpenDoc: (id: string) => void }> = ({ documents, onToggle, onOpenDoc }) => {
  const today = todayJst();
  const { overdue, byDay, undated } = useMemo(() => {
    const rows: Row[] = [];
    for (const doc of documents) {
      for (const a of doc.actions) if (!a.completed) rows.push({ kind: 'action', date: a.deadline, doc, action: a });
      for (const e of doc.events) if (e.date >= today) rows.push({ kind: 'event', date: e.date, doc, event: e });
    }
    const overdue = rows.filter((r) => r.kind === 'action' && r.date && r.date < today);
    const undated = rows.filter((r) => !r.date);
    const byDay = new Map<string, Row[]>();
    rows
      .filter((r) => r.date && r.date >= today)
      .sort((a, b) => (a.date! + (a.kind === 'event' ? a.event.start_time || '' : '')).localeCompare(b.date! + (b.kind === 'event' ? b.event.start_time || '' : '')))
      .forEach((r) => byDay.set(r.date!, [...(byDay.get(r.date!) || []), r]));
    return { overdue, byDay, undated };
  }, [documents, today]);

  const renderRow = (r: Row, i: number) =>
    r.kind === 'action' ? (
      <div key={`a${i}`} onClick={() => onOpenDoc(r.doc.id)} className="flex items-start gap-3 p-4 active:bg-slate-50">
        <CheckCircle done={r.action.completed} onClick={() => onToggle(r.doc.id, r.action.id)} />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-medium text-slate-900 leading-snug">{r.action.todo_vi}</div>
          <div className="text-[13px] text-slate-500 mt-0.5 truncate">{TYPE[r.doc.doc_type]?.icon} {r.doc.title_vi}</div>
          {r.action.deadline_uncertain && <div className="text-[13px] text-amber-700 mt-0.5">⚠️ Hạn chưa chắc — xem giấy gốc</div>}
        </div>
      </div>
    ) : (
      <div key={`e${i}`} onClick={() => onOpenDoc(r.doc.id)} className="flex items-start gap-3 p-4 active:bg-slate-50">
        <div className="w-8 h-8 shrink-0 rounded-full bg-sky-50 text-sky-700 flex items-center justify-center"><CalendarDays className="w-4 h-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-medium text-slate-900 leading-snug">{r.event.title_vi}</div>
          <div className="text-[13px] text-slate-500 mt-0.5 flex flex-wrap gap-x-3">
            {r.event.time && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{r.event.time}</span>}
            {r.event.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{r.event.location}</span>}
          </div>
        </div>
      </div>
    );

  if (!overdue.length && !byDay.size && !undated.length) {
    return (
      <div className="px-6 pt-20 text-center">
        <div className="text-5xl">🎉</div>
        <p className="mt-4 text-lg font-semibold text-slate-900">Không có việc nào sắp tới</p>
        <p className="mt-2 text-[15px] text-slate-500">Chụp giấy tờ gửi vào nhóm LINE, việc cần làm và hạn sẽ hiện ở đây.</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-5">
      {overdue.length > 0 && (
        <section>
          <h2 className="px-1 mb-2 text-[13px] font-bold uppercase tracking-wide text-rose-600">Quá hạn</h2>
          <Card className="divide-y divide-slate-100 border-rose-200">{overdue.map(renderRow)}</Card>
        </section>
      )}
      {[...byDay.entries()].map(([day, rows]) => (
        <section key={day}>
          <h2 className={`px-1 mb-2 text-[13px] font-bold uppercase tracking-wide ${day === today ? 'text-emerald-700' : 'text-slate-500'}`}>{dayLabel(day, today)}</h2>
          <Card className="divide-y divide-slate-100">{rows.map(renderRow)}</Card>
        </section>
      ))}
      {undated.length > 0 && (
        <section>
          <h2 className="px-1 mb-2 text-[13px] font-bold uppercase tracking-wide text-slate-500">Không có hạn</h2>
          <Card className="divide-y divide-slate-100">{undated.map(renderRow)}</Card>
        </section>
      )}
    </div>
  );
};

// ---------- tab: documents ----------
const DocsTab: React.FC<{ documents: ExtractedDocument[]; onOpenDoc: (id: string) => void }> = ({ documents, onOpenDoc }) => {
  const [q, setQ] = useState('');
  const list = documents.filter((d) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return [d.title_vi, d.title_jp, d.issuer, d.summary_vi].some((x) => x?.toLowerCase().includes(s));
  });
  return (
    <div className="px-4 pt-4 space-y-3">
      <label className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 h-12">
        <Search className="w-5 h-5 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm giấy tờ…" className="flex-1 text-[16px] outline-none bg-transparent" />
      </label>
      {list.length === 0 && <p className="text-center text-[15px] text-slate-500 pt-10">Chưa có giấy tờ nào.</p>}
      {list.map((d) => {
        const open = d.actions.filter((a) => !a.completed).length;
        return (
          <button key={d.id} onClick={() => onOpenDoc(d.id)} className="w-full text-left">
            <Card className="p-4 flex items-start gap-3 active:bg-slate-50">
              <div className="text-2xl leading-none mt-0.5">{TYPE[d.doc_type]?.icon || '📄'}</div>
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-semibold text-slate-900 leading-snug line-clamp-2">{d.title_vi}</div>
                <div className="text-[13px] text-slate-500 mt-1">
                  {new Date(d.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} · {TYPE[d.doc_type]?.label}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {open > 0 && <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{open} việc chưa làm</span>}
                  {d.events.length > 0 && <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">{d.events.length} sự kiện</span>}
                  {d.confidence < 0.7 && <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">Cần kiểm tra</span>}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300 mt-1" />
            </Card>
          </button>
        );
      })}
    </div>
  );
};

// ---------- document detail (full screen) ----------
const DocSheet: React.FC<{
  doc: ExtractedDocument;
  onClose: () => void;
  onToggle: FamilyAppProps['onToggleAction'];
  onFeedback: FamilyAppProps['onFeedback'];
  onEditDate: FamilyAppProps['onEditDate'];
  onDelete: FamilyAppProps['onDeleteDocument'];
}> = ({ doc, onClose, onToggle, onFeedback, onEditDate, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const warnings = [...(doc.warnings_vi || []), ...(doc.confidence < 0.7 ? ['Độ tin cậy thấp — hãy đối chiếu với giấy gốc.'] : [])];

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto">
      <div className="max-w-md mx-auto pb-10">
        <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 h-14 flex items-center px-2">
          <button onClick={onClose} className="h-11 px-2 flex items-center gap-1 text-[16px] text-emerald-700 font-medium">
            <ChevronLeft className="w-6 h-6" /> Quay lại
          </button>
          <div className="flex-1" />
          <button onClick={() => setEditing((v) => !v)} className={`h-11 px-3 rounded-lg text-[15px] font-medium flex items-center gap-1.5 ${editing ? 'bg-emerald-600 text-white' : 'text-slate-700'}`}>
            <Pencil className="w-4 h-4" /> {editing ? 'Xong' : 'Sửa ngày'}
          </button>
        </header>

        <div className="px-4 pt-4 space-y-4">
          <div>
            <div className="text-[13px] text-slate-500">{TYPE[doc.doc_type]?.icon} {TYPE[doc.doc_type]?.label}</div>
            <h1 className="text-[22px] font-bold text-slate-900 leading-tight mt-1">{doc.title_vi}</h1>
            {doc.title_jp && <div className="text-[14px] text-slate-500 mt-1">{doc.title_jp}</div>}
            {doc.issuer && <div className="text-[14px] text-slate-500">{doc.issuer}</div>}
          </div>

          <Card className="p-4 text-[16px] leading-relaxed text-slate-800">{doc.summary_vi}</Card>

          {warnings.length > 0 && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-[15px] text-amber-900 space-y-1">
              {warnings.map((w, i) => <div key={i} className="flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{w}</div>)}
            </div>
          )}

          {doc.actions.length > 0 && (
            <section>
              <h2 className="px-1 mb-2 text-[13px] font-bold uppercase tracking-wide text-slate-500">Việc cần làm</h2>
              <Card className="divide-y divide-slate-100">
                {doc.actions.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 p-4">
                    <CheckCircle done={a.completed} onClick={() => onToggle(doc.id, a.id)} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[16px] leading-snug ${a.completed ? 'line-through text-slate-400' : 'text-slate-900'}`}>{a.todo_vi}</div>
                      {editing ? (
                        <input
                          type="date"
                          value={a.deadline || ''}
                          onChange={(e) => onEditDate(doc.id, { actions: [{ id: a.id, deadline: e.target.value }] })}
                          className="mt-2 h-11 px-3 border border-slate-300 rounded-lg text-[16px] bg-white"
                        />
                      ) : a.deadline ? (
                        <div className="text-[14px] text-amber-700 font-medium mt-1">
                          Hạn {dayLabel(a.deadline, todayJst())}{a.deadline_uncertain ? ' (?)' : ''}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </Card>
            </section>
          )}

          {doc.items_to_bring.length > 0 && (
            <section>
              <h2 className="px-1 mb-2 text-[13px] font-bold uppercase tracking-wide text-slate-500">Cần chuẩn bị</h2>
              <Card className="p-4">
                <ul className="space-y-2 text-[16px] text-slate-800">
                  {doc.items_to_bring.map((it, i) => <li key={i} className="flex gap-2"><span>🎒</span><span>{it}</span></li>)}
                </ul>
              </Card>
            </section>
          )}

          {doc.events.length > 0 && (
            <section>
              <h2 className="px-1 mb-2 text-[13px] font-bold uppercase tracking-wide text-slate-500">Sự kiện (đã vào lịch)</h2>
              <Card className="divide-y divide-slate-100">
                {doc.events.map((e) => (
                  <div key={e.id} className="p-4">
                    <div className="text-[16px] font-medium text-slate-900">{e.title_vi}</div>
                    {editing ? (
                      <input
                        type="date"
                        value={e.date}
                        onChange={(ev) => ev.target.value && onEditDate(doc.id, { events: [{ id: e.id, date: ev.target.value }] })}
                        className="mt-2 h-11 px-3 border border-slate-300 rounded-lg text-[16px] bg-white"
                      />
                    ) : (
                      <div className="text-[14px] text-slate-600 mt-1 flex flex-wrap gap-x-3">
                        <span className="font-semibold text-sky-700">{dayLabel(e.date, todayJst())}{e.date_uncertain ? ' (?)' : ''}</span>
                        {e.time && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{e.time}</span>}
                        {e.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{e.location}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </Card>
            </section>
          )}

          {doc.disclaimer && <p className="text-[14px] text-slate-500 px-1">ℹ️ {doc.disclaimer}</p>}

          <section>
            <h2 className="px-1 mb-2 text-[13px] font-bold uppercase tracking-wide text-slate-500">Bot đọc có đúng không?</h2>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => onFeedback(doc.id, 'up')} className={`h-14 rounded-2xl border text-[16px] font-semibold flex items-center justify-center gap-2 ${doc.feedback === 'up' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-800'}`}>
                <ThumbsUp className="w-5 h-5" /> Đúng
              </button>
              <button onClick={() => { onFeedback(doc.id, 'down'); setEditing(true); }} className={`h-14 rounded-2xl border text-[16px] font-semibold flex items-center justify-center gap-2 ${doc.feedback === 'down' ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-800'}`}>
                <ThumbsDown className="w-5 h-5" /> Có chỗ sai
              </button>
            </div>
          </section>

          <button
            onClick={async () => { if (window.confirm('Xóa giấy này khỏi danh sách và lịch?')) { await onDelete(doc.id); onClose(); } }}
            className="w-full h-12 rounded-2xl text-[15px] font-medium text-rose-600 flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> Xóa giấy này
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------- tab: calendar ----------
const CalendarTab: React.FC<{ family: Family; onRotate: () => void }> = ({ family, onRotate }) => (
  <div className="px-4 pt-6 space-y-4">
    <div className="text-center px-4">
      <div className="text-5xl">📅</div>
      <h2 className="mt-3 text-[20px] font-bold text-slate-900">Hạn & sự kiện vào lịch điện thoại</h2>
      <p className="mt-2 text-[15px] text-slate-500">Làm 1 lần. Sau đó giấy mới tự vào lịch của mọi người trong nhà.</p>
    </div>
    <button
      onClick={() => openExternal(family.calendar_page_url || family.ics_url || '')}
      className="w-full h-14 rounded-2xl bg-emerald-600 active:bg-emerald-700 text-white text-[17px] font-semibold"
    >
      Thêm vào lịch iPhone / Google
    </button>
    <Card className="p-4 text-[15px] text-slate-600 space-y-2">
      <p>🍎 <b>iPhone</b>: bấm nút trên → <b>Đăng ký</b>. Nhắc trước 1 ngày.</p>
      <p>🟦 <b>Google</b>: cần bật “Trang web cho máy tính” hoặc mở trên máy tính (trang tiếp theo có hướng dẫn).</p>
    </Card>
    <button
      onClick={() => { if (window.confirm('Đổi link lịch? Mọi người sẽ phải thêm lịch lại bằng link mới.')) onRotate(); }}
      className="w-full h-12 rounded-2xl text-[15px] text-slate-600 flex items-center justify-center gap-2"
    >
      <RefreshCw className="w-4 h-4" /> Đổi link lịch (nếu lỡ chia sẻ ra ngoài)
    </button>
  </div>
);

// ---------- tab: settings ----------
const SettingsTab: React.FC<Pick<FamilyAppProps, 'family' | 'isAdmin' | 'devMode' | 'onRename' | 'onDeleteFamilyData' | 'onOpenPrivacy' | 'onOpenAdmin' | 'onOpenSimulator'>> = (p) => {
  const [name, setName] = useState(p.family.family_name);
  const pct = Math.min(100, Math.round((p.family.quota_used / Math.max(1, p.family.quota_limit)) * 100));
  const Row: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }> = ({ icon, label, onClick, danger }) => (
    <button onClick={onClick} className={`w-full h-14 px-4 flex items-center gap-3 text-[16px] active:bg-slate-50 ${danger ? 'text-rose-600' : 'text-slate-900'}`}>
      {icon}<span className="flex-1 text-left">{label}</span><ChevronRight className="w-5 h-5 text-slate-300" />
    </button>
  );
  return (
    <div className="px-4 pt-4 space-y-5">
      <section>
        <h2 className="px-1 mb-2 text-[13px] font-bold uppercase tracking-wide text-slate-500">Tên gia đình</h2>
        <Card className="p-2 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="flex-1 h-12 px-3 text-[16px] outline-none rounded-xl" />
          <button disabled={!name.trim() || name === p.family.family_name} onClick={() => p.onRename(name.trim())} className="h-12 px-4 rounded-xl bg-emerald-600 text-white text-[15px] font-semibold disabled:opacity-30">Lưu</button>
        </Card>
      </section>

      <section>
        <h2 className="px-1 mb-2 text-[13px] font-bold uppercase tracking-wide text-slate-500">Hạn mức tháng này</h2>
        <Card className="p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[28px] font-bold text-slate-900 tabular-nums">{p.family.quota_used}<span className="text-[16px] font-normal text-slate-400"> / {p.family.quota_limit} giấy</span></span>
            <span className="text-[13px] text-slate-500">làm mới ngày 1</span>
          </div>
          <div className="mt-3 h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${pct > 85 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
          </div>
        </Card>
      </section>

      <Card className="divide-y divide-slate-100 overflow-hidden">
        <Row icon={<Shield className="w-5 h-5 text-slate-500" />} label="Quyền riêng tư & dữ liệu" onClick={p.onOpenPrivacy} />
        {p.isAdmin && <Row icon={<BarChart3 className="w-5 h-5 text-slate-500" />} label="Quản trị (admin)" onClick={p.onOpenAdmin} />}
        {p.devMode && <Row icon={<Wrench className="w-5 h-5 text-slate-500" />} label="LINE Test Lab (dev)" onClick={p.onOpenSimulator} />}
      </Card>

      <Card className="overflow-hidden">
        <Row
          danger
          icon={<Trash2 className="w-5 h-5" />}
          label="Xóa toàn bộ dữ liệu gia đình"
          onClick={() => {
            const ok = window.prompt('Xóa hết giấy tờ, việc cần làm, lịch và đổi link lịch. Không thể hoàn tác.\nGõ XOA để xác nhận:');
            if (ok?.trim().toUpperCase() === 'XOA') p.onDeleteFamilyData();
          }}
        />
      </Card>
      <p className="text-center text-[13px] text-slate-400 pb-4">Ảnh không được lưu · nội dung tự xóa sau 90 ngày</p>
    </div>
  );
};

// ---------- shell ----------
const TABS: Array<{ id: Tab; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'upcoming', label: 'Sắp tới', icon: ListTodo },
  { id: 'docs', label: 'Giấy tờ', icon: FileText },
  { id: 'calendar', label: 'Lịch', icon: CalendarDays },
  { id: 'settings', label: 'Cài đặt', icon: Settings },
];

export const FamilyApp: React.FC<FamilyAppProps> = (props) => {
  const { family, documents } = props;
  const [tab, setTab] = useState<Tab>(props.initialTab || 'upcoming');
  const [openDocId, setOpenDocId] = useState<string | null>(props.initialDocId || null);
  const openDoc = documents.find((d) => d.id === openDocId) || null;
  const openCount = documents.reduce((n, d) => n + d.actions.filter((a) => !a.completed).length, 0);

  useEffect(() => {
    document.body.style.overflow = openDoc ? 'hidden' : '';
  }, [openDoc]);

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <div className="max-w-md mx-auto pb-24">
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-4 h-14 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[17px] font-bold text-slate-900 truncate">{family.family_name}</div>
          </div>
          <div className="text-[13px] text-slate-500 tabular-nums shrink-0">{family.quota_used}/{family.quota_limit} giấy</div>
        </header>

        {tab === 'upcoming' && <UpcomingTab documents={documents} onToggle={props.onToggleAction} onOpenDoc={setOpenDocId} />}
        {tab === 'docs' && <DocsTab documents={documents} onOpenDoc={setOpenDocId} />}
        {tab === 'calendar' && <CalendarTab family={family} onRotate={props.onRotateIcsToken} />}
        {tab === 'settings' && <SettingsTab {...props} />}
      </div>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="max-w-md mx-auto grid grid-cols-4">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)} className={`h-16 flex flex-col items-center justify-center gap-1 relative ${tab === id ? 'text-emerald-700' : 'text-slate-400'}`}>
              <Icon className="w-6 h-6" />
              <span className="text-[12px] font-semibold">{label}</span>
              {id === 'upcoming' && openCount > 0 && (
                <span className="absolute top-2 left-1/2 ml-2 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center">{openCount}</span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {openDoc && (
        <DocSheet
          doc={openDoc}
          onClose={() => setOpenDocId(null)}
          onToggle={props.onToggleAction}
          onFeedback={props.onFeedback}
          onEditDate={props.onEditDate}
          onDelete={props.onDeleteDocument}
        />
      )}
    </div>
  );
};
