import React, { useEffect, useMemo, useRef, useState } from 'react';
import liff from '@line/liff';
import {
  ListTodo, FileText, CalendarDays, Settings, ThumbsUp, ThumbsDown, Trash2, MapPin, AlertTriangle, Search,
  RefreshCw, Shield, BarChart3, Wrench, Camera, Plus, X, Languages, Copy, CalendarPlus, Smartphone, Globe,
  CheckCircle2, Info, Package,
} from 'lucide-react';
import { DocAction, DocEvent, ExtractedDocument, Family, Translation } from '../../types/index.ts';
import {
  AppBar, Button, CheckButton, Chip, DocIcon, docKind, EmptyState, Group, Notice, Row, Screen, Section, Switch, TabBar, TextField, Toast,
} from '../ui/kit.tsx';

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
  onToggleDigest: (on: boolean) => Promise<void>;
  onRotateIcsToken: () => void;
  onDeleteFamilyData: () => void;
  onOpenPrivacy: () => void;
  onOpenAdmin: () => void;
  onOpenSimulator: () => void;
  /** Read photos/PDF taken inside the app. */
  onUpload: (files: File[]) => Promise<UploadOutcome>;
  /** "Chỉ dịch": translate line by line, nothing stored. */
  onTranslate: (files: File[]) => Promise<{ ok: true; translation: Translation } | { ok: false; error: string }>;
}

export type UploadOutcome =
  | { ok: true; result: 'new' | 'duplicate'; added?: number; document: ExtractedDocument }
  | { ok: false; error: string };

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

const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function openExternal(url: string) {
  try {
    if (liff.isInClient()) return liff.openWindow({ url, external: true });
  } catch {
    /* not initialised in dev */
  }
  window.open(url, '_blank', 'noopener');
}

/** Fixed-width time column for event rows. */
const TimeCell: React.FC<{ time?: string }> = ({ time }) => (
  <div className="w-11 pt-0.5 text-footnote font-semibold tabular-nums text-info">{time ? time.slice(0, 5) : 'Cả ngày'}</div>
);

// ---------- tab: upcoming ----------
type Item =
  | { kind: 'action'; date?: string; doc: ExtractedDocument; action: DocAction }
  | { kind: 'event'; date: string; doc: ExtractedDocument; event: DocEvent };

const UpcomingTab: React.FC<{ family: Family; documents: ExtractedDocument[]; onToggle: FamilyAppProps['onToggleAction']; onOpenDoc: (id: string) => void; onCapture: () => void }> = ({ family, documents, onToggle, onOpenDoc, onCapture }) => {
  const today = todayJst();
  const { overdue, byDay, undated, openCount } = useMemo(() => {
    const items: Item[] = [];
    for (const doc of documents) {
      for (const a of doc.actions) if (!a.completed) items.push({ kind: 'action', date: a.deadline, doc, action: a });
      for (const e of doc.events) if (e.date >= today) items.push({ kind: 'event', date: e.date, doc, event: e });
    }
    const sortKey = (i: Item) => `${i.date}${i.kind === 'event' ? i.event.start_time || '' : '00:00'}`;
    const byDay = new Map<string, Item[]>();
    items.filter((i) => i.date && i.date >= today).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      .forEach((i) => byDay.set(i.date!, [...(byDay.get(i.date!) || []), i]));
    return {
      overdue: items.filter((i) => i.kind === 'action' && i.date && i.date < today),
      undated: items.filter((i) => !i.date),
      byDay,
      openCount: items.filter((i) => i.kind === 'action').length,
    };
  }, [documents, today]);

  const render = (i: Item, idx: number) =>
    i.kind === 'action' ? (
      <Row
        key={`a${idx}`}
        onClick={() => onOpenDoc(i.doc.id)}
        chevron={false}
        leading={<CheckButton checked={i.action.completed} onChange={() => onToggle(i.doc.id, i.action.id)} label="Đánh dấu đã xong" />}
        title={i.action.todo_vi}
        subtitle={i.doc.title_vi}
        meta={
          <>
            {i.date && i.date < today && <Chip tone="danger">Hạn {shortDate(i.date)}</Chip>}
            {i.action.deadline_uncertain && <Chip tone="warn">Ngày chưa chắc</Chip>}
          </>
        }
      />
    ) : (
      <Row
        key={`e${idx}`}
        onClick={() => onOpenDoc(i.doc.id)}
        chevron={false}
        leading={<TimeCell time={i.event.start_time} />}
        title={i.event.title_vi}
        subtitle={i.event.location ? <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{i.event.location}</span> : i.doc.title_vi}
        meta={i.event.date_uncertain ? <Chip tone="warn">Ngày chưa chắc</Chip> : undefined}
      />
    );

  const subtitle = `${family.family_name} · ${openCount ? `${openCount} việc chưa làm` : 'không có việc chưa làm'}`;
  const empty = !overdue.length && !byDay.size && !undated.length;

  return (
    <>
      <AppBar title="Sắp tới" subtitle={subtitle} large />
      {empty ? (
        <EmptyState
          icon={CheckCircle2}
          title="Không có việc nào sắp tới"
          body="Chụp giấy tờ, hoặc gửi ảnh vào nhóm LINE — việc cần làm và hạn sẽ hiện ở đây."
          action={<Button icon={Camera} onClick={onCapture}>Chụp giấy</Button>}
        />
      ) : (
        <>
          {overdue.length > 0 && <Section title="Quá hạn" tone="danger"><Group>{overdue.map(render)}</Group></Section>}
          {[...byDay.entries()].map(([day, items]) => (
            <Section key={day} title={dayLabel(day, today)} tone={day === today ? 'brand' : 'default'}>
              <Group>{items.map(render)}</Group>
            </Section>
          ))}
          {undated.length > 0 && <Section title="Chưa có hạn"><Group>{undated.map(render)}</Group></Section>}
        </>
      )}
    </>
  );
};

// ---------- tab: documents ----------
const DocsTab: React.FC<{ documents: ExtractedDocument[]; onOpenDoc: (id: string) => void; onCapture: () => void }> = ({ documents, onOpenDoc, onCapture }) => {
  const [q, setQ] = useState('');
  const list = documents.filter((d) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return [d.title_vi, d.title_jp, d.issuer, d.summary_vi].some((x) => x?.toLowerCase().includes(s));
  });
  return (
    <>
      <AppBar title="Giấy tờ" subtitle={`${documents.length} giấy · tự xóa sau 90 ngày`} large />
      {documents.length === 0 ? (
        <EmptyState icon={FileText} title="Chưa có giấy tờ" body="Giấy đã đọc sẽ được lưu ở đây 90 ngày." action={<Button icon={Camera} onClick={onCapture}>Chụp giấy</Button>} />
      ) : (
        <>
          <div className="px-4 pt-2">
            <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, nơi gửi…" leading={<Search className="h-5 w-5 text-ink-3" />} />
          </div>
          <Section>
            {list.length === 0 ? (
              <p className="px-1 text-subhead text-ink-2">Không tìm thấy giấy nào.</p>
            ) : (
              <Group>
                {list.map((d) => {
                  const open = d.actions.filter((a) => !a.completed).length;
                  return (
                    <Row
                      key={d.id}
                      onClick={() => onOpenDoc(d.id)}
                      leading={<DocIcon doc={d} />}
                      title={<span className="line-clamp-2 font-medium">{d.title_vi}</span>}
                      subtitle={`${shortDate(d.created_at.slice(0, 10))} · ${docKind(d).label}`}
                      meta={
                        open || d.events.length || d.confidence < 0.7 ? (
                          <>
                            {open > 0 && <Chip tone="warn">{open} việc chưa làm</Chip>}
                            {d.events.length > 0 && <Chip tone="info">{d.events.length} sự kiện</Chip>}
                            {d.confidence < 0.7 && <Chip tone="danger">Cần kiểm tra</Chip>}
                          </>
                        ) : undefined
                      }
                    />
                  );
                })}
              </Group>
            )}
          </Section>
        </>
      )}
    </>
  );
};

// ---------- document detail ----------
const DocScreen: React.FC<{
  doc: ExtractedDocument;
  onClose: () => void;
  onToggle: FamilyAppProps['onToggleAction'];
  onFeedback: FamilyAppProps['onFeedback'];
  onEditDate: FamilyAppProps['onEditDate'];
  onDelete: FamilyAppProps['onDeleteDocument'];
}> = ({ doc, onClose, onToggle, onFeedback, onEditDate, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const today = todayJst();
  const warnings = [...(doc.warnings_vi || []), ...(doc.confidence < 0.7 ? ['Độ tin cậy thấp — hãy đối chiếu với giấy gốc.'] : [])];
  const dateInput = 'mt-2 h-11 rounded-control border border-line-strong bg-surface px-3 text-body';

  return (
    <Screen
      overlay
      bar={<AppBar back={{ onClick: onClose }} title={docKind(doc).label} right={<Button variant="plain" onClick={() => setEditing((v) => !v)}>{editing ? 'Xong' : 'Sửa ngày'}</Button>} />}
    >
      <div className="px-4 pt-5">
        <div className="flex items-center gap-2 text-footnote text-ink-2">
          <DocIcon doc={doc} size="sm" />
          {docKind(doc).label} · đọc ngày {shortDate(doc.created_at.slice(0, 10))}
        </div>
        <h1 className="mt-3 text-title font-bold">{doc.title_vi}</h1>
        {(doc.title_jp || doc.issuer) && (
          <p className="mt-1 text-footnote text-ink-2">
            {doc.title_jp}
            {doc.title_jp && doc.issuer && <br />}
            {doc.issuer}
          </p>
        )}
      </div>

      <Section>
        <div className="rounded-card border border-line bg-surface p-4 text-body">{doc.summary_vi}</div>
        {warnings.length > 0 && (
          <div className="mt-3">
            <Notice tone="warn" icon={AlertTriangle}>{warnings.map((w, i) => <p key={i}>{w}</p>)}</Notice>
          </div>
        )}
      </Section>

      {doc.actions.length > 0 && (
        <Section title="Việc cần làm">
          <Group>
            {doc.actions.map((a) => (
              <Row
                key={a.id}
                leading={<CheckButton checked={a.completed} onChange={() => onToggle(doc.id, a.id)} label="Đánh dấu đã xong" />}
                title={a.todo_vi}
                tone={a.completed ? 'muted' : 'default'}
                subtitle={
                  editing ? (
                    <input type="date" value={a.deadline || ''} onChange={(e) => onEditDate(doc.id, { actions: [{ id: a.id, deadline: e.target.value }] })} className={dateInput} aria-label="Hạn" />
                  ) : a.deadline ? (
                    <span className={a.deadline < today && !a.completed ? 'font-semibold text-danger' : 'font-semibold text-warn'}>
                      Hạn: {dayLabel(a.deadline, today)}{a.deadline_uncertain ? ' (chưa chắc)' : ''}
                    </span>
                  ) : undefined
                }
              />
            ))}
          </Group>
        </Section>
      )}

      {doc.events.length > 0 && (
        <Section title="Sự kiện" footer="Đã có trong lịch điện thoại của gia đình.">
          <Group>
            {doc.events.map((e) => (
              <Row
                key={e.id}
                leading={<TimeCell time={e.start_time} />}
                title={e.title_vi}
                subtitle={
                  editing ? (
                    <input type="date" value={e.date} onChange={(ev) => ev.target.value && onEditDate(doc.id, { events: [{ id: e.id, date: ev.target.value }] })} className={dateInput} aria-label="Ngày" />
                  ) : (
                    <>
                      <span className="font-semibold text-ink">{dayLabel(e.date, today)}</span>
                      {e.date_uncertain && ' (chưa chắc)'}
                      {e.time && ` · ${e.time}`}
                      {e.location && ` · ${e.location}`}
                    </>
                  )
                }
              />
            ))}
          </Group>
        </Section>
      )}

      {doc.items_to_bring.length > 0 && (
        <Section title="Cần chuẩn bị">
          <Group>
            {doc.items_to_bring.map((it, i) => (
              <Row key={i} leading={<Package className="mt-0.5 h-5 w-5 text-ink-3" />} title={it} />
            ))}
          </Group>
        </Section>
      )}

      {doc.disclaimer && (
        <Section>
          <Notice icon={Info}>{doc.disclaimer}</Notice>
        </Section>
      )}

      <Section title="Bot đọc có đúng không?">
        <div className="grid grid-cols-2 gap-3">
          <Button variant={doc.feedback === 'up' ? 'primary' : 'secondary'} icon={ThumbsUp} onClick={() => onFeedback(doc.id, 'up')} block>Đúng</Button>
          <Button variant="secondary" icon={ThumbsDown} onClick={() => { onFeedback(doc.id, 'down'); setEditing(true); }} block>
            {doc.feedback === 'down' ? 'Đã báo sai' : 'Có chỗ sai'}
          </Button>
        </div>
      </Section>

      <Section>
        <Button variant="danger" icon={Trash2} block onClick={async () => { if (window.confirm('Xóa giấy này khỏi danh sách và lịch?')) { await onDelete(doc.id); onClose(); } }}>
          Xóa giấy này
        </Button>
      </Section>
    </Screen>
  );
};

// ---------- tab: calendar ----------
const CalendarTab: React.FC<{ family: Family; onRotate: () => void }> = ({ family, onRotate }) => (
  <>
    <AppBar title="Lịch" subtitle="Hạn và sự kiện tự vào lịch điện thoại" large />
    <Section footer="Làm 1 lần trên mỗi điện thoại. Giấy mới sẽ tự xuất hiện.">
      <Button size="lg" icon={CalendarPlus} block onClick={() => openExternal(family.calendar_page_url || family.ics_url || '')}>
        Thêm vào lịch điện thoại
      </Button>
    </Section>
    <Section title="Cách hoạt động">
      <Group>
        <Row leading={<Smartphone className="mt-0.5 h-5 w-5 text-ink-2" />} title="iPhone / iPad" subtitle="Bấm nút trên → Đăng ký. Tự nhắc trước 1 ngày." />
        <Row leading={<Globe className="mt-0.5 h-5 w-5 text-ink-2" />} title="Google Calendar" subtitle="Cần mở ở giao diện máy tính một lần — trang tiếp theo có hướng dẫn. Cập nhật vài giờ một lần." />
      </Group>
    </Section>
    <Section title="Bảo mật" footer="Ai có link đều xem được lịch. Đổi link nếu lỡ chia sẻ ra ngoài — mọi người sẽ phải thêm lại.">
      <Group>
        <Row
          leading={<RefreshCw className="mt-0.5 h-5 w-5 text-ink-2" />}
          title="Đổi link lịch"
          onClick={() => { if (window.confirm('Đổi link lịch? Mọi người sẽ phải thêm lịch lại bằng link mới.')) onRotate(); }}
        />
      </Group>
    </Section>
  </>
);

// ---------- tab: settings ----------
const SettingsTab: React.FC<Pick<FamilyAppProps, 'family' | 'isAdmin' | 'devMode' | 'onRename' | 'onToggleDigest' | 'onDeleteFamilyData' | 'onOpenPrivacy' | 'onOpenAdmin' | 'onOpenSimulator'>> = (p) => {
  const [name, setName] = useState(p.family.family_name);
  const pct = Math.min(100, Math.round((p.family.quota_used / Math.max(1, p.family.quota_limit)) * 100));
  return (
    <>
      <AppBar title="Cài đặt" large />
      <Section title="Tên gia đình" footer="Hiện trên trang này và trên lịch thêm sau này.">
        <div className="flex gap-2">
          <TextField value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="flex-1" aria-label="Tên gia đình" />
          <Button disabled={!name.trim() || name === p.family.family_name} onClick={() => p.onRename(name.trim())}>Lưu</Button>
        </div>
      </Section>

      <Section title="Nhắc qua LINE">
        <Group>
          <Row
            title="Nhắc sáng 7:00"
            subtitle="Gửi vào nhóm việc hôm nay và ngày mai, chỉ khi có việc."
            trailing={<Switch checked={!!p.family.daily_digest} onChange={p.onToggleDigest} label="Nhắc sáng 7:00" />}
          />
        </Group>
      </Section>

      <Section title="Hạn mức tháng này" footer="Làm mới vào ngày 1 hằng tháng. Chỉ dịch và đề xuất từ tin nhắn không tính vào hạn mức.">
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-baseline gap-1">
            <span className="text-display font-bold tabular-nums">{p.family.quota_used}</span>
            <span className="text-subhead text-ink-2">/ {p.family.quota_limit} giấy</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={pct > 85 ? 'h-full rounded-full bg-danger' : 'h-full rounded-full bg-brand-600'} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </Section>

      <Section title="Khác">
        <Group>
          <Row leading={<Shield className="mt-0.5 h-5 w-5 text-ink-2" />} title="Quyền riêng tư và dữ liệu" onClick={p.onOpenPrivacy} />
          {p.isAdmin && <Row leading={<BarChart3 className="mt-0.5 h-5 w-5 text-ink-2" />} title="Quản trị" onClick={p.onOpenAdmin} />}
          {p.devMode && <Row leading={<Wrench className="mt-0.5 h-5 w-5 text-ink-2" />} title="LINE Test Lab (dev)" onClick={p.onOpenSimulator} />}
        </Group>
      </Section>

      <Section footer="Xóa hết giấy tờ, việc cần làm, lịch và đổi link lịch. Không thể hoàn tác.">
        <Group>
          <Row
            tone="danger"
            leading={<Trash2 className="mt-0.5 h-5 w-5 text-danger" />}
            title="Xóa toàn bộ dữ liệu gia đình"
            chevron={false}
            onClick={() => {
              const ok = window.prompt('Gõ XOA để xác nhận xóa toàn bộ dữ liệu:');
              if (ok?.trim().toUpperCase() === 'XOA') p.onDeleteFamilyData();
            }}
          />
        </Group>
      </Section>
    </>
  );
};

// ---------- in-app capture ----------
const MAX_PAGES = 6;

const CaptureScreen: React.FC<{
  files: File[];
  onAddMore: () => void;
  onRemove: (i: number) => void;
  onCancel: () => void;
  onSubmit: (mode: 'read' | 'translate') => void;
  busy: 'read' | 'translate' | null;
  error: string | null;
}> = ({ files, onAddMore, onRemove, onCancel, onSubmit, busy, error }) => {
  // Create + revoke preview URLs in the same effect (StrictMode-safe).
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const created = files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : ''));
    setUrls(created);
    return () => created.forEach((u) => u && URL.revokeObjectURL(u));
  }, [files]);
  return (
    <Screen
      overlay
      bar={<AppBar back={busy ? undefined : { label: 'Hủy', onClick: onCancel }} title={`${files.length} trang`} />}
      footer={
        <>
          <Button size="lg" block icon={CalendarPlus} loading={busy === 'read'} disabled={!!busy || !files.length} onClick={() => onSubmit('read')}>
            {busy === 'read' ? 'Đang đọc… 20–40 giây' : 'Đọc và thêm vào lịch'}
          </Button>
          <Button size="lg" variant="secondary" block icon={Languages} loading={busy === 'translate'} disabled={!!busy || !files.length} onClick={() => onSubmit('translate')}>
            {busy === 'translate' ? 'Đang dịch… 5–15 giây' : 'Chỉ dịch, không lưu'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3 px-4 pt-4">
        {files.map((f, i) => (
          <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-control border border-line bg-surface">
            {urls[i] ? <img src={urls[i]} alt={`Trang ${i + 1}`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><FileText className="h-8 w-8 text-ink-3" /></div>}
            <span className="absolute bottom-1.5 left-1.5 rounded bg-ink/70 px-1.5 text-caption font-semibold text-white">{i + 1}</span>
            {!busy && (
              <button onClick={() => onRemove(i)} aria-label={`Bỏ trang ${i + 1}`} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-ink/70 text-white">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {files.length < MAX_PAGES && !busy && (
          <button onClick={onAddMore} className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-control border-2 border-dashed border-line-strong text-footnote text-ink-2">
            <Plus className="h-6 w-6" /> Thêm trang
          </button>
        )}
      </div>
      <Section footer="Giấy nhiều trang: thêm đủ các trang rồi gửi một lần. Chụp thẳng, đủ sáng, không cắt mép giấy.">
        {error ? <Notice tone="danger" icon={AlertTriangle}>{error}</Notice> : null}
      </Section>
    </Screen>
  );
};

const TranslationScreen: React.FC<{ t: Translation; onBack: () => void; onRead: () => void; reading: boolean }> = ({ t, onBack, onRead, reading }) => {
  const [showJp, setShowJp] = useState(true);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(t.lines.map((l) => (showJp ? `${l.jp}\n→ ${l.vi}` : l.vi)).join('\n\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Screen
      overlay
      layer={55}
      bar={<AppBar back={{ onClick: onBack }} title="Bản dịch" right={<Button variant="plain" onClick={() => setShowJp((v) => !v)}>{showJp ? 'Ẩn JP' : 'Hiện JP'}</Button>} />}
      footer={
        <Button size="lg" block icon={CalendarPlus} loading={reading} onClick={onRead}>
          {reading ? 'Đang đọc…' : 'Đọc và thêm vào lịch'}
        </Button>
      }
    >
      {t.title_jp && <h1 className="px-4 pt-5 text-headline font-semibold">{t.title_jp}</h1>}
      <p className="px-4 pt-1 text-footnote text-ink-2">Có hạn hoặc việc cần làm? Bấm nút dưới để lưu vào lịch.</p>
      {t.notes_vi && <Section><Notice tone="warn" icon={AlertTriangle}>{t.notes_vi}</Notice></Section>}
      <Section footer="Bản dịch không được lưu lại.">
        <Group>
          {t.lines.map((l, i) => (
            <div key={i} className="px-4 py-3">
              <p className="text-body">{l.vi}</p>
              {showJp && <p className="mt-1 text-footnote text-ink-2">{l.jp}</p>}
            </div>
          ))}
        </Group>
        <div className="mt-3">
          <Button variant="plain" icon={Copy} block onClick={copy}>{copied ? 'Đã sao chép' : 'Sao chép bản dịch'}</Button>
        </div>
      </Section>
    </Screen>
  );
};

// ---------- shell ----------
export const FamilyApp: React.FC<FamilyAppProps> = (props) => {
  const { family, documents } = props;
  const [tab, setTab] = useState<Tab>(props.initialTab || 'upcoming');
  const [openDocId, setOpenDocId] = useState<string | null>(props.initialDocId || null);
  const openDoc = documents.find((d) => d.id === openDocId) || null;
  const openCount = documents.reduce((n, d) => n + d.actions.filter((a) => !a.completed).length, 0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [captured, setCaptured] = useState<File[] | null>(null);
  const [uploading, setUploading] = useState<'read' | 'translate' | null>(null);
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const pickFiles = () => fileInput.current?.click();
  const onPicked = (list: FileList | null) => {
    const picked = Array.from(list || []);
    if (fileInput.current) fileInput.current.value = '';
    if (!picked.length) return;
    setUploadError(null);
    setCaptured((prev) => [...(prev || []), ...picked].slice(0, MAX_PAGES));
  };
  const submit = async (mode: 'read' | 'translate') => {
    if (!captured?.length) return;
    setUploading(mode);
    setUploadError(null);
    if (mode === 'translate') {
      const t = await props.onTranslate(captured);
      setUploading(null);
      if (!t.ok) return setUploadError(t.error);
      return setTranslation(t.translation); // keep photos so "Đọc và thêm vào lịch" can reuse them
    }
    const r = await props.onUpload(captured);
    setUploading(null);
    if (!r.ok) {
      setTranslation(null);
      return setUploadError(r.error);
    }
    setTranslation(null);
    setCaptured(null);
    setOpenDocId(r.document.id);
    if (r.result === 'duplicate') {
      setToast(r.added ? `Giấy này đã có — đã bổ sung ${r.added} mục mới.` : 'Giấy này đã được đọc trước đó. Không tính thêm hạn mức.');
      setTimeout(() => setToast(null), 4000);
    }
  };

  useEffect(() => {
    document.body.style.overflow = openDoc || captured ? 'hidden' : '';
  }, [openDoc, captured]);

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <div className="mx-auto max-w-md pb-28">
        {tab === 'upcoming' && <UpcomingTab family={family} documents={documents} onToggle={props.onToggleAction} onOpenDoc={setOpenDocId} onCapture={pickFiles} />}
        {tab === 'docs' && <DocsTab documents={documents} onOpenDoc={setOpenDocId} onCapture={pickFiles} />}
        {tab === 'calendar' && <CalendarTab family={family} onRotate={props.onRotateIcsToken} />}
        {tab === 'settings' && <SettingsTab {...props} />}
      </div>

      <TabBar
        active={tab}
        onChange={setTab}
        items={[
          { id: 'upcoming', label: 'Sắp tới', icon: ListTodo, badge: openCount },
          { id: 'docs', label: 'Giấy tờ', icon: FileText },
          { id: 'calendar', label: 'Lịch', icon: CalendarDays },
          { id: 'settings', label: 'Cài đặt', icon: Settings },
        ]}
      />

      <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => onPicked(e.target.files)} />

      {(tab === 'upcoming' || tab === 'docs') && !openDoc && !captured && (
        <button
          onClick={pickFiles}
          className="fixed right-4 z-40 flex h-12 items-center gap-2 rounded-full bg-brand-600 pl-4 pr-5 text-subhead font-semibold text-white shadow-float active:bg-brand-700"
          style={{ bottom: 'calc(72px + env(safe-area-inset-bottom))' }}
        >
          <Camera className="h-5 w-5" /> Chụp giấy
        </button>
      )}

      {captured && (
        <CaptureScreen
          files={captured}
          busy={uploading}
          error={uploadError}
          onAddMore={pickFiles}
          onRemove={(i) => setCaptured((prev) => (prev || []).filter((_, j) => j !== i))}
          onCancel={() => { setCaptured(null); setUploadError(null); }}
          onSubmit={submit}
        />
      )}

      {translation && captured && <TranslationScreen t={translation} onBack={() => setTranslation(null)} onRead={() => submit('read')} reading={uploading === 'read'} />}

      {toast && <Toast>{toast}</Toast>}

      {openDoc && (
        <DocScreen
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
