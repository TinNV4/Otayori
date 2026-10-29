import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { PolicyItem, SEVERITY_ICON, SEVERITY_LABEL, Severity } from '../types/policy.ts';

const SEVERITIES: Severity[] = ['red', 'yellow', 'green'];
interface SourceReport { id: string; links: number; fresh: number; pending: number; ignored: number; errors: string[]; sample?: Array<{ text: string; url: string; date?: string }> }
interface Status {
  counts: { pending: number; approved: number; rejected: number; ignored: number };
  llm: 'claude' | 'mock';
  running: boolean;
  last: { at: string; dry: boolean; error?: string; report: { sources: SourceReport[]; cost_usd: number; created: number } | null } | null;
}

const fmt = (iso?: string) => (iso ? `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}` : '—');

/** Review queue: AI drafts stay invisible to users until approved here (or via `npm run policy`). */
export const PolicyAdminPanel: React.FC = () => {
  const [items, setItems] = useState<PolicyItem[] | null>(null);
  const [sev, setSev] = useState<Record<string, Severity>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [ignored, setIgnored] = useState<PolicyItem[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
    setNote(null);
    const res = await apiFetch('/api/admin/policy-ingest', { method: 'POST', body: JSON.stringify({ dry }) });
    if (res.status === 409) setNote('Đang chạy rồi, đợi một lát.');
    await loadStatus();
  };
  const showIgnored = async () => {
    const res = await apiFetch('/api/admin/policy?status=ignored');
    if (res.ok) setIgnored((await res.json()).items);
  };

  const act = async (item: PolicyItem, kind: 'approve' | 'reject') => {
    setBusy(item.id);
    setNote(null);
    try {
      const res = await apiFetch(`/api/admin/policy/${item.id}/${kind}`, {
        method: 'POST',
        body: JSON.stringify(kind === 'approve' ? { severity: sev[item.id] || item.severity } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setNote('Không thực hiện được (đã được xử lý?).');
      else if (kind === 'approve') {
        const d = data.dispatch || { sent: 0, failed: 0, deferred: 0 };
        setNote(`Đã duyệt. Push: ${d.sent} gửi · ${d.failed} lỗi · ${d.deferred} hoãn (quota).`);
      } else setNote('Đã loại.');
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (!items) return <div className="p-6 flex items-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /> Đang tải…</div>;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-slate-500">
        Bản nháp do AI tóm tắt từ trang chính thức. Mở link gốc, đối chiếu <b>ngày</b> và <b>đối tượng</b> trước khi duyệt. 🔴 sẽ được push ngay cho người dùng phù hợp.
      </p>
      {status && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="grid grid-cols-4 gap-2 text-center">
            {([['pending', 'Chờ duyệt'], ['approved', 'Đã duyệt'], ['rejected', 'Đã loại'], ['ignored', 'AI bỏ qua']] as const).map(([k, label]) => (
              <div key={k} className="rounded-xl bg-slate-50 py-2">
                <div className="text-[20px] font-bold text-slate-900 tabular-nums">{status.counts[k]}</div>
                <div className="text-[11px] text-slate-500">{label}</div>
              </div>
            ))}
          </div>
          {status.llm === 'mock' && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-[13px] text-amber-800">
              ⚠️ Chưa có <b>ANTHROPIC_API_KEY</b> trên máy chủ nên bản tóm tắt chỉ là <b>bản mẫu</b>, không phải do Claude viết.
            </div>
          )}
          <div className="flex gap-2">
            <button disabled={status.running} onClick={() => runIngest(false)} className="flex-1 h-11 rounded-xl bg-slate-900 disabled:bg-slate-300 text-white text-[14px] font-semibold flex items-center justify-center gap-2">
              {status.running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {status.running ? 'Đang đọc nguồn…' : 'Đọc nguồn ngay'}
            </button>
            <button disabled={status.running} onClick={() => runIngest(true)} className="h-11 px-3 rounded-xl border border-slate-200 text-[14px] font-semibold text-slate-700">Chỉ liệt kê link</button>
          </div>
          {status.last ? (
            <div className="text-[13px] text-slate-600 space-y-1">
              <div className="font-semibold text-slate-800">
                Lần chạy gần nhất: {new Date(status.last.at).toLocaleString('vi-VN')}{status.last.dry ? ' (chỉ liệt kê)' : ''}
                {status.last.report && !status.last.dry ? ` · ${status.last.report.created} nháp mới · $${status.last.report.cost_usd.toFixed(4)}` : ''}
              </div>
              {status.last.error && <div className="text-rose-700">✗ {status.last.error}</div>}
              {status.last.report?.sources.map((src) => (
                <div key={src.id}>
                  <b>{src.id}</b>: {src.links} link · {src.fresh} mới{status.last!.dry ? '' : ` · ${src.pending} chờ duyệt · ${src.ignored} bỏ qua`}
                  {src.errors.map((e) => <div key={e} className="text-rose-700 break-all">✗ {e}</div>)}
                  {status.last!.dry && src.sample?.map((l) => <div key={l.url} className="text-slate-500 truncate">• {l.date} {l.text}</div>)}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-slate-500">Chưa có lần chạy nào kể từ khi máy chủ khởi động. Job tự động chạy 7:30 sáng (giờ Nhật); bấm "Đọc nguồn ngay" để chạy ngay.</p>
          )}
        </div>
      )}
      {note && <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-[14px] text-emerald-800">{note}</div>}
      {items.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-slate-500 text-[14px]">
          Chưa có bản nháp nào chờ duyệt.
          {status && status.counts.ignored > 0 && status.counts.pending === 0 && <div className="mt-1">AI đã đọc {status.counts.ignored} trang nhưng cho là không liên quan tới người dân — xem danh sách bên dưới.</div>}
        </div>
      )}
      {items.map((i) => {
        const chosen = sev[i.id] || i.severity;
        const a = i.audience;
        return (
          <div key={i.id} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
            <div className="text-[16px] font-bold text-slate-900">{i.title_vi}</div>
            <div className="text-[13px] text-slate-500">{i.issuer} · {i.stage === 'proposed' ? 'đang lấy ý kiến' : 'đã chốt'} · tin cậy {Math.round(i.confidence * 100)}%</div>
            <p className="text-[15px] text-slate-800">{i.summary_vi}</p>
            {i.action_vi && <p className="text-[15px] font-semibold text-slate-900">✅ {i.action_vi}</p>}
            <div className="text-[13px] text-slate-600">
              Áp dụng: {fmt(i.effective_date)} · Hạn: {fmt(i.deadline)}<br />
              Đối tượng: visa {a.visa_types.join(', ') || 'mọi loại'} · {a.cities.join(', ') || 'toàn quốc'}
              {a.children_only ? ' · nhà có con' : ''}{a.renewal_related ? ' · liên quan gia hạn' : ''}{a.license_only ? ' · có bằng lái' : ''}
              {a.sectors?.length ? ` · ngành ${a.sectors.join(', ')}` : ''}{a.contract_types?.length ? ` · hợp đồng ${a.contract_types.join(', ')}` : ''}{a.plans?.length ? ` · kế hoạch ${a.plans.join(', ')}` : ''}
            </div>
            <a href={i.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[14px] font-semibold text-emerald-700">
              <ExternalLink className="w-4 h-4" /> Mở trang gốc ({i.title_jp.slice(0, 30)})
            </a>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {SEVERITIES.map((s) => (
                <button
                  key={s}
                  onClick={() => setSev((m) => ({ ...m, [i.id]: s }))}
                  className={`h-10 px-3 rounded-xl border text-[14px] font-semibold ${chosen === s ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}
                >
                  {SEVERITY_ICON[s]} {SEVERITY_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button disabled={busy === i.id} onClick={() => act(i, 'approve')} className="flex-1 h-11 rounded-xl bg-emerald-600 disabled:bg-slate-300 text-white text-[15px] font-semibold">
                {busy === i.id ? '…' : `Duyệt ${SEVERITY_ICON[chosen]}`}
              </button>
              <button disabled={busy === i.id} onClick={() => act(i, 'reject')} className="h-11 px-4 rounded-xl border border-slate-200 text-[15px] font-semibold text-slate-700">Loại</button>
            </div>
          </div>
        );
      })}
      {status && status.counts.ignored > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <button onClick={() => (ignored ? setIgnored(null) : showIgnored())} className="text-[14px] font-semibold text-slate-700">
            {ignored ? '▾' : '▸'} Tin AI đã bỏ qua ({status.counts.ignored}) — kiểm tra xem có bỏ sót không
          </button>
          {ignored && (
            <ul className="mt-2 space-y-1 text-[13px] text-slate-600">
              {ignored.slice(0, 40).map((i) => (
                <li key={i.id} className="truncate">• <a href={i.url} target="_blank" rel="noopener noreferrer" className="text-emerald-700">{i.title_jp || i.title_vi}</a></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
