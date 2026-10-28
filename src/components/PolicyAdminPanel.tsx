import React, { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { PolicyItem, SEVERITY_ICON, SEVERITY_LABEL, Severity } from '../types/policy.ts';

const SEVERITIES: Severity[] = ['red', 'yellow', 'green'];
const fmt = (iso?: string) => (iso ? `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}` : '—');

/** Review queue: AI drafts stay invisible to users until approved here (or via `npm run policy`). */
export const PolicyAdminPanel: React.FC = () => {
  const [items, setItems] = useState<PolicyItem[] | null>(null);
  const [sev, setSev] = useState<Record<string, Severity>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    const res = await apiFetch('/api/admin/policy?status=pending');
    if (res.ok) setItems((await res.json()).items);
  };
  useEffect(() => { void load(); }, []);

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
      {note && <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-[14px] text-emerald-800">{note}</div>}
      {items.length === 0 && <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-slate-500">Không có bản nháp nào chờ duyệt 🎉</div>}
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
    </div>
  );
};
