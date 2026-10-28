import React, { useEffect, useState } from 'react';
import liff from '@line/liff';
import { ExternalLink, Loader2, Pencil, Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import {
  PolicyFeed, PolicyFeedEntry, PolicyProfile, SEVERITY_ICON, SEVERITY_LABEL, Severity,
} from '../../types/policy.ts';

function openExternal(url: string) {
  try {
    if (liff.isInClient()) return liff.openWindow({ url, external: true });
  } catch {
    /* not initialised in dev */
  }
  window.open(url, '_blank', 'noopener');
}

const fmtDay = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`;

/** Unread count for the tab badge. */
export function usePolicyUnread(): [number, (n: number) => void] {
  const [n, setN] = useState(0);
  useEffect(() => {
    apiFetch('/api/policy/feed')
      .then((r) => (r.ok ? r.json() : null))
      .then((f: PolicyFeed | null) => f && setN(f.unread_count))
      .catch(() => undefined);
  }, []);
  return [n, setN];
}

const TONE: Record<Severity, string> = {
  red: 'border-rose-200 bg-rose-50',
  yellow: 'border-amber-200 bg-amber-50',
  green: 'border-emerald-200 bg-emerald-50',
};

const EntryCard: React.FC<{ e: PolicyFeedEntry }> = ({ e }) => (
  <div className={`rounded-2xl border p-4 ${TONE[e.severity]}`}>
    <div className="flex items-start gap-2">
      <div className="text-[17px] font-bold text-slate-900 leading-snug flex-1">
        {SEVERITY_ICON[e.severity]} {e.title_vi}
      </div>
      {e.unread && <span className="shrink-0 mt-1 px-2 py-0.5 rounded-full bg-rose-500 text-white text-[11px] font-bold">MỚI</span>}
    </div>
    {(e.deadline || e.effective_date) && (
      <div className="mt-1 text-[14px] font-semibold text-slate-700">
        {[e.deadline && `Hạn: ${fmtDay(e.deadline)}`, e.effective_date && `Áp dụng từ: ${fmtDay(e.effective_date)}`].filter(Boolean).join(' · ')}
      </div>
    )}
    <p className="mt-2 text-[16px] text-slate-800 leading-relaxed">{e.personal_vi || e.summary_vi}</p>
    <p className="mt-2 text-[14px] text-slate-600">💡 Vì sao bạn nhận tin: {e.reason_vi}</p>
    {e.action_vi && <p className="mt-2 text-[16px] font-semibold text-slate-900">✅ Việc cần làm: {e.action_vi}</p>}
    <button onClick={() => openExternal(e.url)} className="mt-3 h-11 px-4 rounded-xl bg-white border border-slate-200 text-[15px] font-semibold text-emerald-700 flex items-center gap-2">
      <ExternalLink className="w-4 h-4" /> Nguồn: {e.issuer.split(' (')[0]}
    </button>
    <p className="mt-2 text-[12px] text-slate-500">Tóm tắt từ nguồn chính thức, không phải tư vấn pháp lý. Hãy kiểm tra lại trên trang gốc.</p>
  </div>
);

const ProfileForm: React.FC<{
  feed: PolicyFeed;
  onSaved: (f: PolicyFeed) => void;
  onCancel?: () => void;
  onDeleted: () => void;
}> = ({ feed, onSaved, onCancel, onDeleted }) => {
  const p = feed.profile;
  const [visa, setVisa] = useState<string>(p?.visa_type || '');
  const [expiry, setExpiry] = useState(p?.visa_expiry || '');
  const [city, setCity] = useState(p?.city || '');
  const [kids, setKids] = useState(p?.has_children || false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/policy/profile', {
        method: 'PUT',
        body: JSON.stringify({ visa_type: visa, visa_expiry: expiry, city, has_children: kids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || `Lỗi ${res.status}`);
      else onSaved(data as PolicyFeed);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm('Xóa hồ sơ chính sách? Bạn sẽ không nhận tin cá nhân hóa và nhắc hạn visa nữa.')) return;
    const res = await apiFetch('/api/policy/profile', { method: 'DELETE' });
    if (res.ok) onDeleted();
  };
  const field = 'w-full h-12 px-3 rounded-xl border border-slate-300 bg-white text-[16px]';

  return (
    <div className="p-4 space-y-4">
      <div>
        <div className="text-[20px] font-bold text-slate-900">📰 Bản tin chính sách của bạn</div>
        <p className="mt-1 text-[15px] text-slate-600">Chỉ báo thay đổi ảnh hưởng tới chính bạn, kèm hạn chót và việc cần làm. Trả lời 3 câu hỏi (30 giây):</p>
      </div>
      <label className="block">
        <span className="text-[15px] font-semibold text-slate-800">1. Tư cách lưu trú (在留資格)</span>
        <select value={visa} onChange={(e) => setVisa(e.target.value)} className={`${field} mt-1`}>
          <option value="">— Chọn —</option>
          {feed.options.visa_types.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-[15px] font-semibold text-slate-800">Ngày hết hạn trên thẻ 在留カード</span>
        <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={`${field} mt-1`} />
        <span className="text-[13px] text-slate-500">Để nhận nhắc gia hạn trước 3 tháng. Bỏ trống nếu chưa muốn nhập.</span>
      </label>
      <label className="block">
        <span className="text-[15px] font-semibold text-slate-800">2. Bạn sống ở đâu?</span>
        <select value={city} onChange={(e) => setCity(e.target.value)} className={`${field} mt-1`}>
          <option value="">— Chọn —</option>
          {feed.options.cities.map((c) => <option key={c.id} value={c.id}>{c.name_vi}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-3 min-h-12">
        <input type="checkbox" checked={kids} onChange={(e) => setKids(e.target.checked)} className="w-6 h-6 accent-emerald-600" />
        <span className="text-[16px] text-slate-800">3. Nhà mình có con nhỏ</span>
      </label>
      {error && <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-[15px] text-rose-700">{error}</div>}
      <button disabled={busy || !visa || !city} onClick={save} className="w-full h-12 rounded-2xl bg-emerald-600 disabled:bg-slate-300 text-white text-[16px] font-semibold flex items-center justify-center gap-2">
        {busy && <Loader2 className="w-5 h-5 animate-spin" />} Lưu
      </button>
      {onCancel && <button onClick={onCancel} className="w-full h-12 rounded-2xl border border-slate-200 text-[16px] font-semibold text-slate-700">Hủy</button>}
      <p className="text-[13px] text-slate-500">🔒 Thông tin này chỉ dùng để chọn tin phù hợp và nhắc hạn. Chỉ bạn xem được; người vận hành chỉ thấy số liệu tổng. Không hiện trong nhóm LINE.</p>
      {p && (
        <button onClick={remove} className="h-11 px-3 text-[15px] font-semibold text-rose-600 flex items-center gap-2">
          <Trash2 className="w-4 h-4" /> Xóa hồ sơ chính sách
        </button>
      )}
    </div>
  );
};

export const PolicyTab: React.FC<{ onSeen: () => void }> = ({ onSeen }) => {
  const [feed, setFeed] = useState<PolicyFeed | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await apiFetch('/api/policy/feed');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || `Lỗi ${res.status}`);
      setFeed(data);
      if (data.profile) {
        // Entries stay marked "MỚI" in this view; the badge clears for next time.
        apiFetch('/api/policy/seen', { method: 'POST' }).then(onSeen).catch(() => undefined);
      }
    } catch (err) {
      setError(String((err as Error).message || err));
    }
  };
  useEffect(() => { void load(); }, []);

  if (error) return <div className="p-6 text-[16px] text-slate-600">{error}</div>;
  if (!feed) return <div className="p-6 flex items-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /> Đang tải…</div>;

  if (!feed.profile || editing) {
    return (
      <ProfileForm
        feed={feed}
        onCancel={feed.profile ? () => setEditing(false) : undefined}
        onSaved={(f) => { setFeed(f); setEditing(false); }}
        onDeleted={() => { setFeed({ ...feed, profile: null, items: [], unread_count: 0 }); setEditing(false); onSeen(); }}
      />
    );
  }

  const profile: PolicyProfile = feed.profile;
  const visa = feed.options.visa_types.find((v) => v.id === profile.visa_type)?.label;
  const city = feed.options.cities.find((c) => c.id === profile.city)?.name_vi;
  const groups: Severity[] = ['red', 'yellow', 'green'];

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[20px] font-bold text-slate-900">📰 Chính sách cho bạn</div>
          <div className="mt-1 text-[14px] text-slate-600">
            {visa} · {city}{profile.has_children ? ' · có con nhỏ' : ''}{profile.visa_expiry ? ` · visa đến ${fmtDay(profile.visa_expiry)}` : ''}
          </div>
        </div>
        <button onClick={() => setEditing(true)} className="shrink-0 h-11 px-3 rounded-xl border border-slate-200 bg-white text-[15px] font-semibold text-slate-700 flex items-center gap-1">
          <Pencil className="w-4 h-4" /> Sửa
        </button>
      </div>

      {feed.items.length === 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center">
          <div className="text-4xl">👍</div>
          <p className="mt-2 text-[16px] font-semibold text-slate-900">Chưa có thay đổi nào ảnh hưởng tới bạn</p>
          <p className="mt-1 text-[14px] text-slate-500">Có tin khẩn mình sẽ nhắn ngay trong LINE. Nhắc hạn visa tự động trước 3 tháng.</p>
        </div>
      )}

      {groups.map((sev) => {
        const items = feed.items.filter((i) => i.severity === sev);
        if (!items.length) return null;
        return (
          <section key={sev} className="space-y-3">
            <h3 className="text-[15px] font-bold text-slate-700">{SEVERITY_ICON[sev]} {SEVERITY_LABEL[sev]} ({items.length})</h3>
            {items.map((e) => <EntryCard key={e.id} e={e} />)}
          </section>
        );
      })}
    </div>
  );
};
