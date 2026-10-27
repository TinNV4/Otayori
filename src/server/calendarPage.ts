import { ExtractedDocument, Family } from '../types/index.ts';
import { jstDate } from './time.ts';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface CalendarLinks {
  https: string; // raw feed
  webcal: string; // iPhone/Mac: opens the "Subscribe" dialog directly
  google: string; // Google Calendar "add by URL" dialog
}

export function calendarLinks(publicBaseUrl: string, token: string): CalendarLinks {
  const https = `${publicBaseUrl}/ics/${token}.ics`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  return { https, webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}

/** Upcoming items so the family can see the calendar is not empty. */
function upcoming(docs: ExtractedDocument[], today: string) {
  const items: Array<{ date: string; label: string }> = [];
  for (const d of docs) {
    for (const e of d.events) if (e.date >= today) items.push({ date: e.date, label: `${e.time ? e.time + ' · ' : ''}${e.title_vi}` });
    for (const a of d.actions) if (a.deadline && !a.completed && a.deadline >= today) items.push({ date: a.deadline, label: `[HẠN] ${a.todo_vi}` });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
}

/**
 * Human page behind the link the bot sends. A raw .ics opens as a blank page in browsers,
 * so this page offers one-tap subscribe buttons instead.
 */
export function renderCalendarPage(family: Family, docs: ExtractedDocument[], links: CalendarLinks, userAgent = ''): string {
  const inLine = / Line\//i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  const items = upcoming(docs, jstDate());
  const list = items.length
    ? items.map(i => `<li><b>${esc(i.date.slice(5).replace('-', '/'))}</b> ${esc(i.label)}</li>`).join('')
    : '<li class="muted">Chưa có sự kiện sắp tới. Gửi ảnh giấy tờ cho bot là lịch tự cập nhật.</li>';

  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Thêm vào lịch · Giấy Tờ Nhật</title>
<style>
:root{--bg:#f8fafc;--card:#fff;--fg:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#059669}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--card:#111a2e;--fg:#e2e8f0;--muted:#94a3b8;--line:#1e293b;--accent:#34d399}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,system-ui,"Segoe UI",sans-serif}
main{max-width:520px;margin:0 auto;padding:20px 16px 40px}
h1{font-size:22px;margin:4px 0 2px}.muted{color:var(--muted);font-size:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-top:14px}
.btn{display:block;text-align:center;text-decoration:none;font-weight:600;border-radius:12px;padding:14px;margin-top:10px;border:1px solid var(--line);color:var(--fg);background:var(--card)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.warn{background:#fef3c7;color:#78350f;border-radius:12px;padding:12px;font-size:14px;margin-top:14px}
ol{padding-left:20px;margin:8px 0 0}li{margin:4px 0}ul{padding-left:18px;margin:8px 0 0}
input{width:100%;font:13px ui-monospace,monospace;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
h2{font-size:16px;margin:0}
</style></head><body><main>
<div class="muted">Giấy Tờ Nhật · lịch gia đình</div>
<h1>📅 ${esc(family.family_name)}</h1>
<div class="muted">Thêm 1 lần, sau đó lịch tự cập nhật mỗi khi bot đọc giấy mới.</div>
${inLine ? `<div class="warn">Bạn đang mở trong LINE. Bấm <b>⋯</b> (góc trên phải) → <b>Mở bằng trình duyệt</b> (Safari/Chrome), rồi bấm nút bên dưới.</div>` : ''}

<div class="card">
  <h2>🍎 iPhone / iPad / Mac</h2>
  <a class="btn primary" href="${esc(links.webcal)}">Thêm vào lịch iPhone</a>
  <ol class="muted">
    <li>Bấm nút trên → chọn <b>Đăng ký</b> (Subscribe).</li>
    <li>Màn hình tiếp theo: nếu có mục <b>Xóa cảnh báo</b> (Remove Alerts) thì <b>tắt</b> đi để được nhắc trước 1 ngày → <b>Thêm</b>.</li>
  </ol>
</div>

<div class="card">
  <h2>🟦 Google Calendar ${isAndroid ? '(Android)' : ''}</h2>
  <a class="btn${isAndroid ? ' primary' : ''}" href="${esc(links.google)}">Thêm vào Google Calendar</a>
  <ol class="muted">
    <li>Mở bằng Chrome, đăng nhập tài khoản Google bạn dùng trên điện thoại → bấm <b>Thêm</b>.</li>
    <li>Android: lịch hiện trong app Google Calendar sau vài phút. Nếu không thấy: app → ☰ → Cài đặt → chọn lịch "Giấy Tờ Nhật" → bật <b>Đồng bộ hóa</b>.</li>
    <li>Google tự làm mới vài giờ/lần và dùng giờ nhắc mặc định của bạn.</li>
  </ol>
</div>

<div class="card">
  <h2>Sắp tới</h2>
  <ul>${list}</ul>
</div>

<div class="card">
  <h2>Link thủ công</h2>
  <div class="muted">Cho Outlook / app lịch khác (mục "Đăng ký từ URL"). Đừng chia sẻ link này ra ngoài gia đình.</div>
  <input readonly value="${esc(links.https)}" onclick="this.select()">
  <a class="btn" href="#" onclick="navigator.clipboard.writeText('${esc(links.https)}').then(()=>{this.textContent='Đã sao chép ✓'});return false;">Sao chép link</a>
</div>
</main></body></html>`;
}
