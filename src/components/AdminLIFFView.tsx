import React, { useState } from 'react';
import {
  Users, Wallet, ThumbsUp, MessageSquare, RefreshCw, AlertTriangle, Plus, ScrollText, CheckCircle2, LucideIcon,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { AdminMetrics, AuditLog, DOC_TYPES, DocType, Family, InviteCode, MonthlyUsage } from '../types/index.ts';
import { Button, Chip, DocIcon, docKind, EmptyState, Group, Notice, Row, Section, Segmented, Switch, TextField, Toast } from './ui/kit.tsx';
import { PolicyAdminPanel } from './PolicyAdminPanel.tsx';

/**
 * Operator dashboard (admin LINE userIds only). Metadata only — never document content.
 * Built from the shared UI kit (docs/design-system.md).
 */
interface AdminLIFFViewProps {
  initialTab?: 'policy';
  metrics: AdminMetrics;
  usage?: MonthlyUsage | null;
  families: Family[];
  inviteCodes: InviteCode[];
  auditLogs: AuditLog[];
  onRefresh: () => void | Promise<void>;
}

type AdminTab = 'overview' | 'families' | 'invites' | 'policy' | 'log';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Tokyo' });
};
const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
};

const STATUS: Record<Family['status'], { label: string; tone: 'brand' | 'warn' | 'danger' | 'neutral' }> = {
  active: { label: 'Đang dùng', tone: 'brand' },
  pending_terms: { label: 'Chờ đồng ý', tone: 'neutral' },
  pending_invite: { label: 'Chờ mã mời', tone: 'neutral' },
  suspended: { label: 'Tạm dừng', tone: 'warn' },
  left: { label: 'Đã rời nhóm', tone: 'danger' },
};

const AUDIT_LABEL: Record<string, string> = {
  CREATE_INVITE_CODE: 'Tạo mã mời',
  UPDATE_INVITE_CODE: 'Sửa mã mời',
  INVITE_REDEEMED: 'Kích hoạt mã',
  UPDATE_QUOTA: 'Đổi hạn mức',
  TOGGLE_SUSPEND: 'Tạm dừng / mở lại',
  DELETE_FAMILY_DATA: 'Gia đình xóa dữ liệu',
  ROTATE_ICS_TOKEN: 'Đổi link lịch',
  BOT_LEFT: 'Bot bị xóa khỏi nhóm',
  PURGE_LEFT_FAMILY: 'Xóa dữ liệu sau 7 ngày',
};

/** Thin progress bar; turns warn/danger as it fills. */
const Meter: React.FC<{ value: number; max: number; label: string }> = ({ value, max, label }) => {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  const color = pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warn' : 'bg-brand-600';
  return (
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
};

const Kpi: React.FC<{ icon: LucideIcon; label: string; value: React.ReactNode; unit?: string; hint?: React.ReactNode; meter?: { value: number; max: number } }> = ({ icon: Icon, label, value, unit, hint, meter }) => (
  <div className="rounded-card border border-line bg-surface p-4">
    <div className="flex items-center gap-1.5 text-footnote text-ink-2">
      <Icon className="h-4 w-4" />
      {label}
    </div>
    <div className="mt-2 flex items-baseline gap-1">
      <span className="text-display font-bold tabular-nums">{value}</span>
      {unit && <span className="text-footnote text-ink-2">{unit}</span>}
    </div>
    {meter && <Meter value={meter.value} max={meter.max} label={label} />}
    {hint && <div className="mt-2 text-caption text-ink-3">{hint}</div>}
  </div>
);

// ---------- overview ----------
const Overview: React.FC<{ metrics: AdminMetrics; usage?: MonthlyUsage | null }> = ({ metrics: m, usage }) => {
  const rated = m.thumbs_up + m.thumbs_down;
  const byType = DOC_TYPES.map((t) => [t, m.docs_by_type[t] || 0] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const maxType = Math.max(1, ...byType.map(([, n]) => n));
  const sonnetPct = usage && usage.docs ? Math.round((usage.sonnet_docs / usage.docs) * 100) : null;

  return (
    <>
      <Section title="Tháng này">
        <div className="grid grid-cols-2 gap-3">
          <Kpi icon={Users} label="Gia đình" value={m.active_families} unit={`/ ${m.max_beta_families}`} meter={{ value: m.active_families, max: m.max_beta_families }} hint={`${m.total_families} đã tham gia`} />
          <Kpi icon={Wallet} label="Chi phí AI" value={`$${m.monthly_cost_usd.toFixed(2)}`} unit={`/ $${m.monthly_budget_usd}`} meter={{ value: m.monthly_cost_usd, max: m.monthly_budget_usd }} hint={sonnetPct !== null ? `${sonnetPct}% giấy dùng Sonnet` : undefined} />
          <Kpi icon={ThumbsUp} label="Đọc đúng" value={m.accuracy_rate === null ? '—' : `${m.accuracy_rate}%`} hint={rated ? `${m.thumbs_up} đúng · ${m.thumbs_down} sai` : 'Chưa có đánh giá'} />
          <Kpi icon={MessageSquare} label="Tin LINE chủ động" value={m.push_messages_used} unit={`/ ${m.push_messages_limit}`} meter={{ value: m.push_messages_used, max: m.push_messages_limit }} hint="Reply miễn phí, không tính" />
        </div>
        {usage && (
          <p className="mt-3 px-1 text-footnote text-ink-2">
            {usage.docs} giấy · {usage.pages} trang đã đọc trong tháng {usage.month.slice(5)}/{usage.month.slice(0, 4)}
          </p>
        )}
      </Section>

      <Section title="Giấy đang lưu theo loại" footer={`${m.total_documents_processed} giấy · tự xóa sau 90 ngày`}>
        {byType.length === 0 ? (
          <div className="rounded-card border border-line bg-surface p-4 text-subhead text-ink-2">Chưa có giấy nào.</div>
        ) : (
          <Group>
            {byType.map(([t, n]) => (
              <div key={t} className="flex items-center gap-3 px-4 py-3">
                <DocIcon doc={{ doc_type: t as DocType }} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-subhead">{docKind({ doc_type: t as DocType }).label}</span>
                    <span className="text-subhead font-semibold tabular-nums">{n}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-info" style={{ width: `${(n / maxType) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </Group>
        )}
      </Section>

      <Section title="Lỗi gần đây" tone={m.recent_errors.length ? 'danger' : 'default'}>
        {m.recent_errors.length === 0 ? (
          <div className="flex items-center gap-2 rounded-card border border-line bg-surface p-4 text-subhead text-ink-2">
            <CheckCircle2 className="h-5 w-5 text-brand-600" /> Không có lỗi.
          </div>
        ) : (
          <Group>
            {m.recent_errors.slice(0, 10).map((e) => (
              <Row
                key={e.id}
                leading={<AlertTriangle className="mt-0.5 h-5 w-5 text-danger" />}
                title={<span className="font-mono text-subhead">{e.error_type}</span>}
                subtitle={<>{fmtDateTime(e.timestamp)} · {e.message}</>}
              />
            ))}
          </Group>
        )}
      </Section>
    </>
  );
};

// ---------- families ----------
const Families: React.FC<{ families: Family[]; onAction: (msg: string) => void }> = ({ families, onAction }) => {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...families].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || b.last_active.localeCompare(a.last_active));

  const changeQuota = async (f: Family) => {
    const v = window.prompt(`Hạn mức mới cho “${f.family_name}” (giấy/tháng):`, String(f.quota_limit));
    const n = Number(v);
    if (v === null || !Number.isInteger(n) || n < 0) return;
    const res = await apiFetch('/api/admin/quota', { method: 'POST', body: JSON.stringify({ familyId: f.family_id, newQuota: n }) });
    onAction(res.ok ? `Đã đổi hạn mức thành ${n}/tháng.` : 'Không đổi được hạn mức.');
  };
  const toggleSuspend = async (f: Family) => {
    const suspend = f.status === 'active';
    if (suspend && !window.confirm(`Tạm dừng “${f.family_name}”? Bot sẽ không đọc giấy cho gia đình này.`)) return;
    const res = await apiFetch('/api/admin/suspend', { method: 'POST', body: JSON.stringify({ familyId: f.family_id }) });
    onAction(res.ok ? (suspend ? 'Đã tạm dừng.' : 'Đã mở lại.') : 'Không đổi được trạng thái.');
  };

  if (!families.length) return <EmptyState icon={Users} title="Chưa có gia đình" body="Gửi tin mời kèm mã cho gia đình đầu tiên." />;

  return (
    <Section footer="Chỉ hiện tên, trạng thái và số liệu — không xem được giấy tờ hay lịch của gia đình.">
      <Group>
        {sorted.map((f) => {
          const expanded = open === f.family_id;
          const st = STATUS[f.status];
          return (
            <div key={f.family_id}>
              <Row
                onClick={() => setOpen(expanded ? null : f.family_id)}
                chevron={false}
                title={<span className="font-medium">{f.family_name}</span>}
                subtitle={`Mã ${f.invite_code || '—'} · ${f.members_count ?? 0} thành viên · hoạt động ${fmtDate(f.last_active)}`}
                meta={
                  <>
                    <Chip tone={st.tone}>{st.label}</Chip>
                    <Chip tone={f.quota_used >= f.quota_limit ? 'danger' : 'neutral'}>{f.quota_used}/{f.quota_limit} giấy</Chip>
                    {f.daily_digest && <Chip tone="info">Nhắc sáng</Chip>}
                  </>
                }
              />
              {expanded && (
                <div className="flex gap-2 bg-sunken px-4 py-3">
                  <Button variant="secondary" onClick={() => changeQuota(f)}>Đổi hạn mức</Button>
                  {(f.status === 'active' || f.status === 'suspended') && (
                    <Button variant={f.status === 'active' ? 'danger' : 'secondary'} onClick={() => toggleSuspend(f)}>
                      {f.status === 'active' ? 'Tạm dừng' : 'Mở lại'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Group>
    </Section>
  );
};

// ---------- invites ----------
const Invites: React.FC<{ invites: InviteCode[]; onAction: (msg: string) => void }> = ({ invites, onAction }) => {
  const [code, setCode] = useState('');
  const [maxUses, setMaxUses] = useState('5');
  const [quota, setQuota] = useState('50');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  const create = async () => {
    setBusy(true);
    setError(null);
    const res = await apiFetch('/api/admin/invite-codes', {
      method: 'POST',
      body: JSON.stringify({ code, maxUses: Number(maxUses), quota: Number(quota), note: note || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setError(res.status === 409 ? 'Mã này đã tồn tại.' : j.error || 'Không tạo được mã.');
    }
    setCode('');
    setNote('');
    onAction('Đã tạo mã mời.');
  };
  const toggle = async (inv: InviteCode) => {
    const res = await apiFetch(`/api/admin/invite-codes/${encodeURIComponent(inv.code)}`, { method: 'PATCH', body: JSON.stringify({ is_active: !inv.is_active }) });
    onAction(res.ok ? (inv.is_active ? `Đã tắt mã ${inv.code}.` : `Đã bật mã ${inv.code}.`) : 'Không đổi được mã.');
  };

  const label = (text: string, input: React.ReactNode) => (
    <label className="block">
      <span className="mb-1 block px-1 text-footnote text-ink-2">{text}</span>
      {input}
    </label>
  );

  return (
    <>
      <Section title="Tạo mã mới">
        <div className="space-y-3 rounded-card border border-line bg-surface p-4">
          {label('Mã (chữ, số, gạch nối · ≥ 6 ký tự, khó đoán)', <TextField value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="VD: DOT2-HOA" autoCapitalize="characters" className="font-mono" />)}
          <div className="grid grid-cols-2 gap-3">
            {label('Số gia đình tối đa', <TextField value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />)}
            {label('Giấy / tháng mỗi nhà', <TextField value={quota} onChange={(e) => setQuota(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />)}
          </div>
          {label('Ghi chú (tùy chọn)', <TextField value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Đợt 2 — nhóm phụ huynh lớp Hoa" />)}
          {error && <Notice tone="danger" icon={AlertTriangle}>{error}</Notice>}
          <Button icon={Plus} block loading={busy} disabled={code.trim().length < 6 || !Number(maxUses) || !Number(quota)} onClick={create}>Tạo mã</Button>
        </div>
      </Section>

      <Section title="Mã hiện có" footer="Tắt mã: gia đình chưa kích hoạt không dùng được nữa; gia đình đã kích hoạt vẫn dùng bình thường.">
        {invites.length === 0 ? (
          <div className="rounded-card border border-line bg-surface p-4 text-subhead text-ink-2">Chưa có mã nào.</div>
        ) : (
          <Group>
            {invites.map((inv) => {
              const expired = Date.parse(inv.expires_at) < now;
              const full = inv.used_count >= inv.max_uses;
              return (
                <div key={inv.code} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-headline font-semibold">{inv.code}</div>
                      <div className="mt-0.5 text-footnote text-ink-2">
                        {inv.quota_per_family} giấy/tháng · hết hạn {fmtDate(inv.expires_at)}{inv.note ? ` · ${inv.note}` : ''}
                      </div>
                    </div>
                    <Switch checked={inv.is_active} onChange={() => toggle(inv)} label={`Bật mã ${inv.code}`} />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1"><Meter value={inv.used_count} max={inv.max_uses} label={`Đã dùng mã ${inv.code}`} /></div>
                    <span className="mt-3 text-footnote tabular-nums text-ink-2">{inv.used_count}/{inv.max_uses}</span>
                  </div>
                  {(expired || full || !inv.is_active) && (
                    <div className="mt-2 flex gap-1.5">
                      {!inv.is_active && <Chip>Đã tắt</Chip>}
                      {expired && <Chip tone="danger">Hết hạn</Chip>}
                      {full && <Chip tone="warn">Hết lượt</Chip>}
                    </div>
                  )}
                </div>
              );
            })}
          </Group>
        )}
      </Section>
    </>
  );
};

// ---------- audit log ----------
const Log: React.FC<{ logs: AuditLog[] }> = ({ logs }) =>
  logs.length === 0 ? (
    <EmptyState icon={ScrollText} title="Chưa có nhật ký" />
  ) : (
    <Section footer="Ghi lại thao tác quản trị và các sự kiện dữ liệu — không chứa nội dung giấy tờ.">
      <Group>
        {logs.slice(0, 100).map((l) => (
          <Row
            key={l.id}
            title={<span className="font-medium">{AUDIT_LABEL[l.action] || l.action}</span>}
            subtitle={
              <>
                {fmtDateTime(l.timestamp)}
                {l.details ? ` · ${l.details}` : ''}
              </>
            }
          />
        ))}
      </Group>
    </Section>
  );

// ---------- shell ----------
export const AdminLIFFView: React.FC<AdminLIFFViewProps> = ({ initialTab, metrics, usage, families, inviteCodes, auditLogs, onRefresh }) => {
  const [tab, setTab] = useState<AdminTab>(initialTab || 'overview');
  const [toast, setToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
    onRefresh();
  };
  const refresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };

  return (
    <div className="mx-auto max-w-md pb-16">
      <div className="flex items-center gap-2 px-4 pt-4">
        <div className="flex-1">
          <Segmented
            value={tab}
            onChange={setTab}
            items={[
              { id: 'overview', label: 'Tổng quan' },
              { id: 'families', label: `Gia đình` },
              { id: 'invites', label: 'Mã mời' },
              { id: 'policy', label: 'Tin' },
              { id: 'log', label: 'Nhật ký' },
            ]}
          />
        </div>
        <button onClick={refresh} aria-label="Làm mới" className="flex h-10 w-10 items-center justify-center rounded-control text-ink-2 active:bg-sunken">
          <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {tab === 'overview' && <Overview metrics={metrics} usage={usage} />}
      {tab === 'families' && <Families families={families} onAction={notify} />}
      {tab === 'invites' && <Invites invites={inviteCodes} onAction={notify} />}
      {tab === 'policy' && <PolicyAdminPanel />}
      {tab === 'log' && <Log logs={auditLogs} />}

      {toast && <Toast>{toast}</Toast>}
    </div>
  );
};
