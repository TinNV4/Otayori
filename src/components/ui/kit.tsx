/**
 * UI kit for the LIFF app — every screen is built from these. Tokens live in src/index.css;
 * usage rules in docs/design-system.md. Mobile-first: 44px+ targets, 16px body text, one primary action per screen.
 */
import React from 'react';
import {
  Check, ChevronLeft, ChevronRight, Loader2, School, CalendarRange, UtensilsCrossed, Landmark, FileSignature,
  Stethoscope, Home, Receipt, File, MessageCircle, LucideIcon,
} from 'lucide-react';
import { DocType, ExtractedDocument } from '../../types/index.ts';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ---------- layout ----------

/** Full-height screen with an app bar; `footer` sticks above the safe area. */
export const Screen: React.FC<{ bar: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; overlay?: boolean; layer?: number; className?: string }> = ({ bar, children, footer, overlay, layer = 50, className }) => (
  <div className={cx(overlay ? 'fixed inset-0 overflow-y-auto' : 'min-h-[100dvh]', 'bg-canvas', className)} style={overlay ? { zIndex: layer } : undefined}>
    <div className={cx('mx-auto max-w-md', footer ? 'pb-40' : 'pb-24')}>
      {bar}
      {children}
    </div>
    {footer && (
      <div className="fixed inset-x-0 bottom-0 z-30 bg-surface shadow-bar px-4 pt-3" style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto max-w-md space-y-2">{footer}</div>
      </div>
    )}
  </div>
);

/** Top bar. `back` renders a back button; `large` shows a big title under the bar (home screens). */
export const AppBar: React.FC<{ title?: string; subtitle?: string; back?: { label?: string; onClick: () => void }; right?: React.ReactNode; large?: boolean }> = ({ title, subtitle, back, right, large }) =>
  large && !back && !right ? (
    // Home screens: just the large title, no empty bar above it.
    <div className="px-4 pb-2" style={{ paddingTop: 'calc(20px + env(safe-area-inset-top))' }}>
      <h1 className="truncate text-display font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-0.5 text-footnote text-ink-2">{subtitle}</p>}
    </div>
  ) : (
  <>
    <header className="sticky top-0 z-20 flex h-12 items-center gap-1 border-b border-line bg-surface/95 px-1 backdrop-blur">
      {back ? (
        <button onClick={back.onClick} className="flex h-11 items-center gap-0.5 rounded-control pl-1 pr-3 text-body text-brand-600 active:opacity-60">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          {back.label ?? 'Quay lại'}
        </button>
      ) : (
        <div className="w-3" />
      )}
      <div className="min-w-0 flex-1 truncate text-center text-headline font-semibold">{!large && title}</div>
      <div className="flex min-w-[64px] justify-end pr-1">{right}</div>
    </header>
    {large && (
      <div className="px-4 pb-2 pt-4">
        <h1 className="truncate text-display font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-footnote text-ink-2">{subtitle}</p>}
      </div>
    )}
  </>
  );

/** Grouped list section (iOS "inset grouped"): sentence-case header, white group, optional footnote. */
export const Section: React.FC<{ title?: React.ReactNode; tone?: 'default' | 'danger' | 'brand'; action?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, tone = 'default', action, footer, children, className }) => (
  <section className={cx('px-4 pt-6', className)}>
    {(title || action) && (
      <div className="mb-2 flex items-end justify-between px-1">
        <h2 className={cx('text-footnote font-semibold', tone === 'danger' ? 'text-danger' : tone === 'brand' ? 'text-brand-600' : 'text-ink-2')}>{title}</h2>
        {action}
      </div>
    )}
    {children}
    {footer && <p className="mt-2 px-1 text-footnote text-ink-3">{footer}</p>}
  </section>
);

export const Group: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cx('overflow-hidden rounded-card border border-line bg-surface divide-y divide-line', className)}>{children}</div>
);

/** List row. Use `onClick` for navigation (shows chevron) — rows with their own controls pass `chevron={false}`. */
export const Row: React.FC<{
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  tone?: 'default' | 'danger' | 'muted';
}> = ({ leading, title, subtitle, meta, trailing, onClick, chevron, tone = 'default' }) => {
  const body = (
    <>
      {leading && <div className="shrink-0 pt-0.5">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className={cx('text-body', tone === 'danger' ? 'text-danger' : tone === 'muted' ? 'text-ink-3 line-through' : 'text-ink')}>{title}</div>
        {subtitle && <div className="mt-0.5 text-footnote text-ink-2">{subtitle}</div>}
        {meta && <div className="mt-1.5 flex flex-wrap gap-1.5">{meta}</div>}
      </div>
      {trailing}
      {(chevron ?? !!onClick) && <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-ink-3" />}
    </>
  );
  const cls = 'flex w-full min-h-[52px] items-start gap-3 px-4 py-3 text-left';
  return onClick ? (
    <button onClick={onClick} className={cx(cls, 'active:bg-sunken')}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
};

// ---------- controls ----------

type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'danger';
export const Button: React.FC<{
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  icon?: LucideIcon;
  loading?: boolean;
  block?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  type?: 'button' | 'submit';
}> = ({ variant = 'primary', size = 'md', icon: Icon, loading, block, disabled, onClick, children, type = 'button' }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled || loading}
    className={cx(
      'inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors disabled:opacity-50',
      size === 'lg' ? 'h-[52px] px-5 text-headline' : 'h-11 px-4 text-subhead',
      block && 'w-full',
      variant === 'primary' && 'bg-brand-600 text-white active:bg-brand-700',
      variant === 'secondary' && 'border border-line-strong bg-surface text-ink active:bg-sunken',
      variant === 'plain' && 'text-brand-600 active:opacity-60',
      variant === 'danger' && 'text-danger active:opacity-60',
    )}
  >
    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : Icon && <Icon className="h-5 w-5" />}
    {children}
  </button>
);

export const Chip: React.FC<{ tone?: 'neutral' | 'brand' | 'warn' | 'danger' | 'info'; children: React.ReactNode }> = ({ tone = 'neutral', children }) => (
  <span
    className={cx(
      'inline-flex h-6 items-center rounded-full px-2 text-caption font-semibold',
      tone === 'neutral' && 'bg-sunken text-ink-2 ring-1 ring-inset ring-line',
      tone === 'brand' && 'bg-brand-50 text-brand-700',
      tone === 'warn' && 'bg-warn-soft text-warn',
      tone === 'danger' && 'bg-danger-soft text-danger',
      tone === 'info' && 'bg-info-soft text-info',
    )}
  >
    {children}
  </span>
);

export const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <button
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={cx('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-line-strong')}
  >
    <span className={cx('absolute left-0.5 top-0.5 h-[27px] w-[27px] rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
  </button>
);

/** Round checkbox for to-dos (44px hit area, 26px visual). */
export const CheckButton: React.FC<{ checked: boolean; onChange: () => void; label: string }> = ({ checked, onChange, label }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onChange(); }}
    aria-label={label}
    aria-pressed={checked}
    className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center"
  >
    <span className={cx('flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 transition-colors', checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface')}>
      {checked && <Check className="h-4 w-4" strokeWidth={3} />}
    </span>
  </button>
);

export const TextField: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { leading?: React.ReactNode }> = ({ leading, className, ...rest }) => (
  <label className={cx('flex h-11 items-center gap-2 rounded-control border border-line bg-surface px-3 focus-within:border-brand-600', className)}>
    {leading}
    <input {...rest} className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-ink-3" />
  </label>
);

// ---------- feedback ----------

export const Notice: React.FC<{ tone?: 'warn' | 'danger' | 'info'; icon?: LucideIcon; children: React.ReactNode }> = ({ tone = 'info', icon: Icon, children }) => (
  <div
    className={cx(
      'flex gap-2.5 rounded-card p-3 text-subhead',
      tone === 'warn' && 'bg-warn-soft text-warn',
      tone === 'danger' && 'bg-danger-soft text-danger',
      tone === 'info' && 'bg-info-soft text-info',
    )}
  >
    {Icon && <Icon className="mt-0.5 h-5 w-5 shrink-0" />}
    <div className="min-w-0">{children}</div>
  </div>
);

export const EmptyState: React.FC<{ icon: LucideIcon; title: string; body?: string; action?: React.ReactNode }> = ({ icon: Icon, title, body, action }) => (
  <div className="flex flex-col items-center px-8 pt-16 text-center">
    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface ring-1 ring-line">
      <Icon className="h-7 w-7 text-ink-3" />
    </div>
    <p className="mt-4 text-headline font-semibold">{title}</p>
    {body && <p className="mt-1.5 text-subhead text-ink-2">{body}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const Toast: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div role="status" className="fixed inset-x-4 top-14 z-[60] mx-auto max-w-md rounded-card bg-ink px-4 py-3 text-subhead text-white shadow-float">
    {children}
  </div>
);

// ---------- domain ----------

const DOC_KIND: Record<DocType | 'chat', { icon: LucideIcon; label: string; tint: string }> = {
  otayori: { icon: School, label: 'Thông báo trường', tint: 'bg-brand-50 text-brand-700' },
  nenkan_yotei: { icon: CalendarRange, label: 'Lịch năm học', tint: 'bg-info-soft text-info' },
  kondate: { icon: UtensilsCrossed, label: 'Thực đơn', tint: 'bg-warn-soft text-warn' },
  yakusho: { icon: Landmark, label: 'Giấy 役所', tint: 'bg-info-soft text-info' },
  form: { icon: FileSignature, label: 'Form cần nộp', tint: 'bg-warn-soft text-warn' },
  hospital: { icon: Stethoscope, label: 'Y tế · khám', tint: 'bg-danger-soft text-danger' },
  kairanban: { icon: Home, label: 'Khu phố', tint: 'bg-sunken text-ink-2' },
  meisai: { icon: Receipt, label: 'Hóa đơn', tint: 'bg-sunken text-ink-2' },
  other: { icon: File, label: 'Giấy khác', tint: 'bg-sunken text-ink-2' },
  chat: { icon: MessageCircle, label: 'Từ tin nhắn', tint: 'bg-brand-50 text-brand-700' },
};

export const docKind = (d: Pick<ExtractedDocument, 'doc_type' | 'source'>) => DOC_KIND[d.source === 'chat' ? 'chat' : d.doc_type] || DOC_KIND.other;

export const DocIcon: React.FC<{ doc: Pick<ExtractedDocument, 'doc_type' | 'source'>; size?: 'sm' | 'md' }> = ({ doc, size = 'md' }) => {
  const k = docKind(doc);
  const Icon = k.icon;
  return (
    <span className={cx('flex items-center justify-center rounded-control', k.tint, size === 'sm' ? 'h-8 w-8' : 'h-10 w-10')} aria-hidden>
      <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} />
    </span>
  );
};

/** iOS-style segmented control. */
export const Segmented = <T extends string>({ items, value, onChange }: { items: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void }) => (
  <div className="grid rounded-control bg-line/60 p-0.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} role="tablist">
    {items.map((it) => (
      <button
        key={it.id}
        role="tab"
        aria-selected={value === it.id}
        onClick={() => onChange(it.id)}
        className={`h-9 rounded-[8px] text-footnote font-semibold ${value === it.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-2'}`}
      >
        {it.label}
      </button>
    ))}
  </div>
);

/** Bottom tab bar (4 items max). */
export const TabBar = <T extends string>({ items, active, onChange }: { items: Array<{ id: T; label: string; icon: LucideIcon; badge?: number }>; active: T; onChange: (id: T) => void }) => (
  <nav className="fixed inset-x-0 bottom-0 z-30 bg-surface/95 shadow-bar backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
    <div className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map(({ id, label, icon: Icon, badge }) => {
        const on = id === active;
        return (
          <button key={id} onClick={() => onChange(id)} aria-current={on ? 'page' : undefined} className={cx('relative flex h-14 flex-col items-center justify-center gap-0.5', on ? 'text-brand-600' : 'text-ink-3')}>
            <Icon className="h-6 w-6" strokeWidth={on ? 2.25 : 1.75} />
            <span className="text-caption font-medium">{label}</span>
            {!!badge && (
              <span className="absolute left-1/2 top-1.5 ml-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold leading-none text-white">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  </nav>
);
