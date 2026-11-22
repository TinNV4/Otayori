# Design system — Giấy Tờ Nhật (LIFF app)

Mobile-first, calm, native-feeling (iOS/LINE "inset grouped" lists). One brand color, used sparingly. No emoji as UI icons — use `lucide-react`.

- Tokens: `src/index.css` (`@theme`) — Tailwind utilities are generated from them.
- Components: `src/components/ui/kit.tsx` — screens are composed only from these.
- Server-rendered pages (`src/server/calendarPage.ts`) mirror the same values in plain CSS.

## Tokens

### Color
| Token | Value | Use |
|---|---|---|
| `canvas` | #F3F4F6 | App background |
| `surface` | #FFFFFF | Cards, groups, bars |
| `sunken` | #F7F8FA | Pressed rows, neutral chips, progress track |
| `line` / `line-strong` | #E5E7EB / #D1D5DB | Dividers, borders / control borders |
| `ink` / `ink-2` / `ink-3` | #111827 / #4B5563 / #8B929E | Primary text / secondary / tertiary & placeholders |
| `brand-600` / `700` / `50` / `100` | #1B7A56 / #146145 / #EDF6F1 / #D5EAE0 | Primary button, active tab, "Hôm nay" / pressed / tints |
| `danger` + `-soft` | #C0362C / #FDECEA | Overdue, destructive |
| `warn` + `-soft` | #9A5B00 / #FFF4DD | Deadlines, uncertain dates, warnings |
| `info` + `-soft` | #1D5FBF / #EAF1FC | Events, times, neutral info |

Rules: brand color only for the single primary action, the active tab and "today". Status colors only for status. Never raw Tailwind palette colors (`slate-*`, `emerald-*` …) in app code.

### Typography (system UI stack: SF/Hiragino on iOS, Roboto/Noto on Android)
| Utility | Size/line | Use |
|---|---|---|
| `text-display` | 26/32 bold | Large screen titles |
| `text-title` | 20/28 bold | Document title |
| `text-headline` | 17/24 semibold | Bar title, card heading, large buttons |
| `text-body` | 16/24 | Row titles, paragraphs (minimum for reading) |
| `text-subhead` | 15/22 | Buttons, notices, secondary paragraphs |
| `text-footnote` | 13/18 | Section headers, row subtitles, helper text |
| `text-caption` | 12/16 | Chips, tab labels |

Sentence case everywhere — no ALL-CAPS headers.

### Spacing, radius, elevation
- 4px grid. Page gutter 16px; section top 24px; row padding 12×16; min row height 52px; min tap target 44px.
- Radius: `rounded-control` 10px (buttons, inputs, thumbnails) · `rounded-card` 14px (groups, notices) · `rounded-sheet` 20px.
- Elevation: flat by default (hairline borders). `shadow-bar` for fixed bars, `shadow-float` only for the floating "Chụp giấy" button and toasts.
- Motion: color transitions only, ≤150ms; disabled under `prefers-reduced-motion`.

## Components (`kit.tsx`)

| Component | Variants / props | Notes |
|---|---|---|
| `Screen` | `bar`, `footer`, `overlay`, `layer` | Full-height page; `footer` = sticky action area above safe area |
| `AppBar` | `title`, `back`, `right`, `large`, `subtitle` | Home tabs use `large` (title only); pushed screens use `back` |
| `TabBar` | items with `badge` | Max 4 items; active = brand + bolder stroke |
| `Section` | `title`, `tone` (default/brand/danger), `footer` | Sentence-case 13px header, optional footnote below |
| `Group` | — | White rounded container with dividers |
| `Row` | `leading`, `title`, `subtitle`, `meta`, `trailing`, `onClick`, `chevron`, `tone` | Chevron auto when navigable |
| `Button` | `primary` · `secondary` · `plain` · `danger`; `md` 44px · `lg` 52px; `icon`, `loading`, `block` | One primary per screen |
| `Chip` | `neutral` · `brand` · `warn` · `danger` · `info` | Status only, 24px |
| `Switch` | — | `role="switch"`, 51×31 |
| `CheckButton` | — | 26px visual, 44px hit area, `aria-pressed` |
| `TextField` | `leading` | 44px, focus ring = brand |
| `Notice` | `info` · `warn` · `danger`, `icon` | Inline message |
| `EmptyState` | `icon`, `title`, `body`, `action` | Neutral icon in a ring — no illustrations/emoji |
| `Toast` | — | `role="status"`, auto-hide by caller |
| `DocIcon` / `docKind()` | per document type (+ `chat`) | Tinted square + lucide icon |

## Do / Don't
| Do | Don't |
|---|---|
| Compose screens from `kit.tsx` | Hand-roll buttons/cards with ad-hoc classes |
| Use tokens (`text-ink-2`, `bg-surface`) | `text-slate-500`, `text-[15px]`, hex values |
| lucide icons, 20–24px | Emoji as icons or headings |
| One clear primary action per screen | Several green buttons competing |
| Explain with a short footnote under a section | Long paragraphs above the content |

## Known gaps
- Admin dashboard (`AdminLIFFView`) and dev Test Lab still use the old styles (operator-only screens).
