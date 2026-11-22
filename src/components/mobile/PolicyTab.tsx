import React, { useEffect, useState } from 'react';
import liff from '@line/liff';
import { CheckCircle2, ExternalLink, Info, Newspaper, Pencil, Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import { PolicyFeed, PolicyFeedEntry, PolicyProfile, SEVERITY_LABEL, Severity } from '../../types/policy.ts';
import { AppBar, Button, Chip, EmptyState, Group, Notice, Row, Section, Switch } from '../ui/kit.tsx';

function openExternal(url: string) {
  try {
    if (liff.isInClient()) return liff.openWindow({ url, external: true });
  } catch {
    /* not initialised in dev */
  }
  window.open(url, '_blank', 'noopener');
}

const fmtDay = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`;

/** Severity → status tone (design system: status colors only for status). */
export const SEVERITY_TONE: Record<Severity, 'danger' | 'warn' | 'info'> = { red: 'danger', yellow: 'warn', green: 'info' };

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

const EntryCard: React.FC<{ e: PolicyFeedEntry }> = ({ e }) => (
  <div className="rounded-card border border-line bg-surface p-4">
    <div className="flex flex-wrap gap-1.5">
      <Chip tone={SEVERITY_TONE[e.severity]}>{SEVERITY_LABEL[e.severity]}</Chip>
      {e.unread && <Chip tone="brand">Mới</Chip>}
      {e.deadline && <Chip tone="warn">Hạn {fmtDay(e.deadline)}</Chip>}
      {e.effective_date && <Chip>Áp dụng từ {fmtDay(e.effective_date)}</Chip>}
    </div>
    <h3 className="mt-2 text-headline font-semibold">{e.title_vi}</h3>
    <p className="mt-1.5 text-body text-ink">{e.personal_vi || e.summary_vi}</p>
    {e.action_vi && (
      <div className="mt-3 flex gap-2 rounded-control bg-brand-50 p-3 text-subhead text-brand-700">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
        <div><span className="font-semibold">Việc cần làm: </span>{e.action_vi}</div>
      </div>
    )}
    <p className="mt-3 flex gap-1.5 text-footnote text-ink-2">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>Vì sao bạn nhận tin: {e.reason_vi}</span>
    </p>
    <div className="mt-3">
      <Button variant="secondary" icon={ExternalLink} onClick={() => openExternal(e.url)}>Nguồn: {e.issuer.split(' (')[0]}</Button>
    </div>
    <p className="mt-2 text-caption text-ink-3">Tóm tắt từ nguồn chính thức, không phải tư vấn pháp lý. Hãy kiểm tra lại trên trang gốc.</p>
  </div>
);

const Select: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: Array<{ id: string; label: string }>; empty?: string }> = ({ label, value, onChange, options, empty = 'Chọn' }) => (
  <select
    aria-label={label}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="h-11 w-full rounded-control border border-line bg-surface px-3 text-body focus:border-brand-600 focus:outline-none"
  >
    <option value="">— {empty} —</option>
    {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
  </select>
);

const DateInput: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <input
    type="date"
    aria-label={label}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="h-11 w-full rounded-control border border-line bg-surface px-3 text-body focus:border-brand-600 focus:outline-none"
  />
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
  const [license, setLicense] = useState<string>(p?.license_status || '');
  const [licenseExpiry, setLicenseExpiry] = useState(p?.license_expiry || '');
  const [contract, setContract] = useState<string>(p?.contract_type || '');
  const [sector, setSector] = useState<string>(p?.sector || '');
  const [plan, setPlan] = useState<string>(p?.plan || '');
  const [tax, setTax] = useState<string>(p?.resident_tax || '');
  const [more, setMore] = useState(!!(p && (p.license_status || p.contract_type || p.plan || p.resident_tax || p.sector)));
  const isTokutei = visa === 'tokutei1' || visa === 'tokutei2';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const o = feed.options;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/policy/profile', {
        method: 'PUT',
        body: JSON.stringify({
          visa_type: visa, visa_expiry: expiry, city, has_children: kids,
          license_status: license, license_expiry: licenseExpiry, contract_type: contract, sector: isTokutei ? sector : '', plan, resident_tax: tax,
        }),
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

  return (
    <>
      <AppBar
        title={p ? 'Sửa hồ sơ' : 'Bản tin chính sách'}
        subtitle={p ? undefined : 'Chỉ báo thay đổi ảnh hưởng tới chính bạn, kèm hạn và việc cần làm. Trả lời 3 câu (30 giây).'}
        back={onCancel ? { onClick: onCancel } : undefined}
        large={!p}
      />

      <Section title="1. Tư cách lưu trú (在留資格)">
        <Select label="Tư cách lưu trú" value={visa} onChange={setVisa} options={o.visa_types} />
      </Section>
      <Section title="Ngày hết hạn trên thẻ 在留カード" footer="Để nhắc gia hạn trước 3 tháng. Bỏ trống nếu chưa muốn nhập.">
        <DateInput label="Ngày hết hạn visa" value={expiry} onChange={setExpiry} />
      </Section>
      <Section title="2. Bạn sống ở đâu?">
        <Select label="Nơi sống" value={city} onChange={setCity} options={o.cities.map((c) => ({ id: c.id, label: c.name_vi }))} />
      </Section>
      <Section title="3. Gia đình">
        <Group>
          <Row title="Nhà mình có con nhỏ" trailing={<Switch checked={kids} onChange={setKids} label="Nhà mình có con nhỏ" />} />
        </Group>
      </Section>

      <Section
        title="Thông tin thêm (không bắt buộc)"
        footer={more ? 'Càng điền, tin càng đúng người, và bạn được nhắc hạn bằng lái, 住民税. Bỏ trống thì vẫn nhận mọi tin chung.' : undefined}
      >
        <Group>
          <Row title="Thêm chi tiết" subtitle="Ngành, hợp đồng, bằng lái, kế hoạch, 住民税" trailing={<Switch checked={more} onChange={setMore} label="Thêm chi tiết" />} />
        </Group>
      </Section>
      {more && (
        <>
          {isTokutei && (
            <Section title="Ngành 特定技能">
              <Select label="Ngành 特定技能" value={sector} onChange={setSector} options={o.sectors} empty="Không chọn" />
            </Section>
          )}
          <Section title="Loại hợp đồng">
            <Select label="Loại hợp đồng" value={contract} onChange={setContract} options={o.contract_types} empty="Không chọn" />
          </Section>
          <Section title="Bằng lái xe">
            <Select label="Bằng lái xe" value={license} onChange={setLicense} options={o.license_statuses} empty="Không chọn" />
          </Section>
          {(license === 'japan' || license === 'converting') && (
            <Section title="Ngày hết hạn bằng lái">
              <DateInput label="Ngày hết hạn bằng lái" value={licenseExpiry} onChange={setLicenseExpiry} />
            </Section>
          )}
          <Section title="Kế hoạch sắp tới">
            <Select label="Kế hoạch sắp tới" value={plan} onChange={setPlan} options={o.plans} empty="Không chọn" />
          </Section>
          <Section title="住民税 (thuế cư trú) đóng thế nào?" footer='Chọn "tự đóng" để được nhắc trước hạn mỗi kỳ.'>
            <Select label="Cách đóng 住民税" value={tax} onChange={setTax} options={o.resident_tax} empty="Không chọn" />
          </Section>
        </>
      )}

      <Section footer="Thông tin này chỉ dùng để chọn tin phù hợp và nhắc hạn. Chỉ bạn xem được; người vận hành chỉ thấy số liệu tổng. Không hiện trong nhóm LINE.">
        {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}
        <div className="space-y-2">
          <Button size="lg" block loading={busy} disabled={!visa || !city} onClick={save}>Lưu</Button>
          {onCancel && <Button size="lg" variant="secondary" block onClick={onCancel}>Hủy</Button>}
        </div>
      </Section>

      {p && (
        <Section>
          <Group>
            <Row tone="danger" leading={<Trash2 className="mt-0.5 h-5 w-5 text-danger" />} title="Xóa hồ sơ chính sách" chevron={false} onClick={remove} />
          </Group>
        </Section>
      )}
    </>
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
        // Entries stay marked "Mới" in this view; the badge clears for next time.
        apiFetch('/api/policy/seen', { method: 'POST' }).then(onSeen).catch(() => undefined);
      }
    } catch (err) {
      setError(String((err as Error).message || err));
    }
  };
  useEffect(() => { void load(); }, []);

  if (error) {
    return (
      <>
        <AppBar title="Chính sách" large />
        <div className="px-4 pt-4"><Notice tone="danger">{error}</Notice></div>
      </>
    );
  }
  if (!feed) {
    return (
      <>
        <AppBar title="Chính sách" large />
        <p className="px-5 pt-4 text-subhead text-ink-2">Đang tải…</p>
      </>
    );
  }

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
  const summary = [visa, city, profile.has_children && 'có con nhỏ', profile.visa_expiry && `visa đến ${fmtDay(profile.visa_expiry)}`].filter(Boolean).join(' · ');

  return (
    <>
      <AppBar title="Chính sách" subtitle="Thay đổi ảnh hưởng tới riêng bạn" large />
      <Section title="Hồ sơ của bạn">
        <Group>
          <Row
            leading={<Pencil className="mt-0.5 h-5 w-5 text-ink-2" />}
            title={summary}
            subtitle="Sửa để nhận tin đúng hơn"
            onClick={() => setEditing(true)}
          />
        </Group>
      </Section>

      {feed.items.length === 0 && (
        <EmptyState icon={Newspaper} title="Chưa có thay đổi nào ảnh hưởng tới bạn" body="Có tin khẩn mình sẽ nhắn ngay trong LINE. Nhắc hạn visa tự động trước 3 tháng." />
      )}

      {groups.map((sev) => {
        const items = feed.items.filter((i) => i.severity === sev);
        if (!items.length) return null;
        return (
          <Section key={sev} title={`${SEVERITY_LABEL[sev]} (${items.length})`} tone={sev === 'red' ? 'danger' : 'default'}>
            <div className="space-y-3">{items.map((e) => <EntryCard key={e.id} e={e} />)}</div>
          </Section>
        );
      })}
    </>
  );
};
