import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, Inbox, Link2, ListChecks, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { PolicyItem, SEVERITY_LABEL, Severity } from '../types/policy.ts';
import { Button, Chip, EmptyState, Group, Notice, Row, Section, Segmented, Toast } from './ui/kit.tsx';
import { SEVERITY_TONE } from './mobile/PolicyTab.tsx';

const SEVERITIES: Severity[] = ['red', 'yellow', 'green'];
interface SourceReport { id: string; links: number; fresh: number; pending: number; ignored: number; duplicates?: number; errors: string[]; sample?: Array<{ text: string; url: string; date?: string }> }
interface Status {
  counts: { pending: number; approved: number; rejected: number; ignored: number };
  llm: 'claude' | 'mock';
  running: boolean;
  last: { at: string; dry: boolean; error?: string; report: { sources: SourceReport[]; cost_usd: number; created: number; merged?: number } | null } | null;
}

const fmt = (iso?: string) => (iso ? `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}` : '—');
const COUNTS = [['pending', 'Chờ duyệt'], ['approved', 'Đã duyệt'], ['rejected', 'Đã loại'], ['ignored', 'AI bỏ qua']] as const;

const ext = (url: string, children: React.ReactNode) => (
  <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand-600 active:opacity-60">{children}</a>
);

/** Review queue: AI drafts stay invisible to users until approved here (or via `npm run policy`). */
export const PolicyAdminPanel: React.FC = () => {
  const [items, setItems] = useState<PolicyItem[] | null>(null);
  const [sev, setSev] = useState<Record<string, Severity>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [ignored, setIgnored] = useState<PolicyItem[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), 3500);
  };
  const loadStatus = async () => {
    const res = await apiFetch('/api/admin/policy-status');
    if (!res.ok) return;
    const st: Status = await res.json();
    setStatus(st);
    clearTimeout(timer.current);
    if (st.running) timer.current = setTimeout(loadStatus, 3000); // poll while a read is running
    else void load();
  };
  const load = async () => {
    const res = await apiFetch('/api/admin/policy?status=pending');
    if (res.ok) setItems((await res.json()).items);
  };
  useEffect(() => { void load(); void loadStatus(); return () => clearTimeout(timer.current); }, []);

  const runIngest = async (dry: boolean) => {
    const res = await apiFetch('/api/admin/policy-ingest', { method: 'POST', body: JSON.stringify({ dry }) });
    if (res.status === 409) toast('Đang chạy rồi, đợi một lát.');
    await loadStatus();
  };
  const toggleIgnored = async () => {
    if (ignored) return setIgnored(null);
    const res = await apiFetch('/api/admin/policy?status=ignored');
    if (res.ok) setIgnored((await res.json()).items);
  };

  const act = async (item: PolicyItem, kind: 'approve' | 'reject') => {
    setBusy(item.id);
    try {
      const res = await apiFetch(`/api/admin/policy/${item.id}/${kind}`, {
        method: 'POST',
        body: JSON.stringify(kind === 'approve' ? { severity: sev[item.id] || item.severity } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast('Không thực hiện được (đã được xử lý?).');
      else if (kind === 'approve') {
        const d = data.dispatch || { sent: 0, failed: 0, deferred: 0 };
        toast(`Đã duyệt. Push: ${d.sent} gửi · ${d.failed} lỗi · ${d.deferred} hoãn (quota).`);
      } else toast('Đã loại.');
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (!items) return <p className="px-5 pt-6 text-subhead text-ink-2">Đang tải…</p>;
  const last = status?.last;

  return (
    <>
      {status && (
        <Section title="Bản tin chính sách" footer="Bản nháp do AI tóm tắt từ trang chính thức. Mở trang gốc, đối chiếu ngày và đối tượng trước khi duyệt. Tin Khẩn được push ngay cho người phù hợp.">
          <div className="grid grid-cols-4 gap-2">
            {COUNTS.map(([k, label]) => (
              <div key={k} className="rounded-card border border-line bg-surface px-2 py-3 text-center">
                <div className="text-title font-bold tabular-nums">{status.counts[k]}</div>
                <div className="text-caption text-ink-2">{label}</div>
              </div>
            ))}
          </div>
          {status.llm === 'mock' && (
            <div className="mt-3">
              <Notice tone="warn" icon={AlertTriangle}>Chưa có ANTHROPIC_API_KEY trên máy chủ nên bản tóm tắt chỉ là bản mẫu, không phải do Claude viết.</Notice>
            </div>
          )}
        </Section>
      )}

      {status && (
        <Section
          title="Đọc nguồn"
          footer={last ? undefined : 'Chưa có lần chạy nào kể từ khi máy chủ khởi động. Job tự chạy 7:30 sáng (giờ Nhật).'}
        >
          <div className="flex gap-2">
            <div className="flex-1">
              <Button block icon={RefreshCw} loading={status.running} onClick={() => runIngest(false)}>
                {status.running ? 'Đang đọc nguồn…' : 'Đọc nguồn ngay'}
              </Button>
            </div>
            <Button variant="secondary" icon={ListChecks} disabled={status.running} onClick={() => runIngest(true)}>Chỉ liệt kê</Button>
          </div>
          {last && (
            <div className="mt-3">
              <Group>
                <Row
                  title={`Lần chạy gần nhất${last.dry ? ' (chỉ liệt kê)' : ''}`}
                  subtitle={`${new Date(last.at).toLocaleString('vi-VN')}${last.report && !last.dry ? ` · ${last.report.created} nháp mới · $${last.report.cost_usd.toFixed(4)}` : ''}`}
                />
                {last.error && <Row tone="danger" leading={<AlertTriangle className="mt-0.5 h-5 w-5 text-danger" />} title={last.error} />}
                {last.report?.sources.map((src) => (
                  <Row
                    key={src.id}
                    title={<span className="font-mono text-subhead">{src.id}</span>}
                    subtitle={
                      <>
                        {src.links} link · {src.fresh} mới{last.dry ? '' : ` · ${src.pending} chờ duyệt · ${src.ignored} bỏ qua${src.duplicates ? ` (${src.duplicates} trùng)` : ''}`}
                        {src.errors.map((e) => <span key={e} className="block break-all text-danger">{e}</span>)}
                        {last.dry && src.sample?.map((l) => <span key={l.url} className="block truncate text-ink-3">{l.date} {l.text}</span>)}
                      </>
                    }
                  />
                ))}
              </Group>
            </div>
          )}
        </Section>
      )}

      <Section title={`Chờ duyệt (${items.length})`}>
        {items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Chưa có bản nháp nào chờ duyệt"
            body={status && status.counts.ignored > 0 ? `AI đã đọc ${status.counts.ignored} trang nhưng cho là không liên quan tới người dân. Xem danh sách bên dưới.` : undefined}
          />
        ) : (
          <div className="space-y-3">
            {items.map((i) => {
              const chosen = sev[i.id] || i.severity;
              const a = i.audience;
              const who = [
                `visa ${a.visa_types.join(', ') || 'mọi loại'}`, a.cities.join(', ') || 'toàn quốc',
                a.children_only && 'nhà có con', a.renewal_related && 'liên quan gia hạn', a.license_only && 'có bằng lái',
                a.sectors?.length && `ngành ${a.sectors.join(', ')}`, a.contract_types?.length && `hợp đồng ${a.contract_types.join(', ')}`, a.plans?.length && `kế hoạch ${a.plans.join(', ')}`,
              ].filter(Boolean).join(' · ');
              return (
                <div key={i.id} className="rounded-card border border-line bg-surface p-4">
                  <div className="flex flex-wrap gap-1.5">
                    <Chip tone={SEVERITY_TONE[i.severity]}>AI: {SEVERITY_LABEL[i.severity]}</Chip>
                    <Chip>{i.stage === 'proposed' ? 'Đang lấy ý kiến' : 'Đã chốt'}</Chip>
                    <Chip tone={i.confidence < 0.7 ? 'warn' : 'neutral'}>Tin cậy {Math.round(i.confidence * 100)}%</Chip>
                  </div>
                  <h3 className="mt-2 text-headline font-semibold">{i.title_vi}</h3>
                  <p className="mt-0.5 text-footnote text-ink-2">{i.issuer}</p>
                  <p className="mt-2 text-subhead">{i.summary_vi}</p>
                  {i.action_vi && <p className="mt-2 text-subhead font-semibold">Việc cần làm: {i.action_vi}</p>}
                  <p className="mt-2 text-footnote text-ink-2">Áp dụng {fmt(i.effective_date)} · Hạn {fmt(i.deadline)}<br />Đối tượng: {who}</p>
                  <p className="mt-2 flex items-center gap-1 text-subhead font-semibold">
                    <ExternalLink className="h-4 w-4 shrink-0 text-brand-600" />
                    {ext(i.url, <span className="truncate">Mở trang gốc ({i.title_jp.slice(0, 30)})</span>)}
                  </p>
                  {!!i.related_urls?.length && (
                    <div className="mt-2 text-footnote text-ink-2">
                      <div className="flex items-center gap-1"><Link2 className="h-4 w-4" /> Cùng nội dung, đã gộp vào tin này ({i.related_urls.length} trang):</div>
                      {i.related_urls.slice(0, 5).map((u) => <div key={u} className="truncate pl-5">{ext(u, u.replace(/^https?:\/\//, ''))}</div>)}
                    </div>
                  )}
                  <div className="mt-3">
                    <Segmented
                      value={chosen}
                      onChange={(s) => setSev((m) => ({ ...m, [i.id]: s }))}
                      items={SEVERITIES.map((s) => ({ id: s, label: SEVERITY_LABEL[s] }))}
                    />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <div className="flex-1">
                      <Button block loading={busy === i.id} onClick={() => act(i, 'approve')}>Duyệt: {SEVERITY_LABEL[chosen]}</Button>
                    </div>
                    <Button variant="secondary" disabled={busy === i.id} onClick={() => act(i, 'reject')}>Loại</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {status && status.counts.ignored > 0 && (
        <Section footer="Kiểm tra xem AI có bỏ sót tin nào không.">
          <Group>
            <Row title={`Tin AI đã bỏ qua (${status.counts.ignored})`} subtitle={ignored ? 'Bấm để ẩn' : 'Bấm để xem'} chevron={false} onClick={toggleIgnored} />
            {ignored?.slice(0, 40).map((i) => (
              <div key={i.id} className="truncate px-4 py-2.5 text-footnote">{ext(i.url, i.title_jp || i.title_vi)}</div>
            ))}
          </Group>
        </Section>
      )}

      {note && <Toast>{note}</Toast>}
    </>
  );
};
