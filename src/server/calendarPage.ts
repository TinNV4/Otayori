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
  const isMobile = isAndroid || /iPhone|iPad|Mobile/i.test(userAgent);
  const items = upcoming(docs, jstDate());
  const list = items.length
    ? items.map(i => `<li><b>${esc(i.date.slice(5).replace('-', '/'))}</b> ${esc(i.label)}</li>`).join('')
    : '<li class="muted">Chưa có sự kiện sắp tới. Gửi ảnh giấy tờ cho bot là lịch tự cập nhật.</li>';

  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Thêm vào lịch · Giấy Tờ Nhật</title>
<style>
:root{--bg:#f3f4f6;--card:#fff;--fg:#111827;--muted:#4b5563;--line:#e5e7eb;--accent:#1b7a56;--warn-bg:#fff4dd;--warn:#9a5b00}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f14;--card:#151a21;--fg:#e5e7eb;--muted:#9ca3af;--line:#262c35;--accent:#2f9e74;--warn-bg:#3a2a07;--warn:#f5c15c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:520px;margin:0 auto;padding:20px 16px 40px}
h1{font-size:26px;line-height:32px;margin:4px 0 4px;letter-spacing:-.01em}.muted{color:var(--muted);font-size:15px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-top:12px}
.btn{display:flex;align-items:center;justify-content:center;min-height:52px;text-decoration:none;font-weight:600;font-size:17px;border-radius:10px;padding:0 16px;margin-top:12px;border:1px solid #d1d5db;color:var(--fg);background:var(--card)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.warn{background:var(--warn-bg);color:var(--warn);border-radius:14px;padding:12px;font-size:15px;margin-top:12px}
ol{padding-left:20px;margin:8px 0 0}li{margin:4px 0}ul{padding-left:18px;margin:8px 0 0}
input{width:100%;font:13px ui-monospace,monospace;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
h2{font-size:17px;font-weight:600;margin:0}
</style></head><body><main>
<div class="muted">Giấy Tờ Nhật · lịch gia đình</div>
<h1>${esc(family.family_name)}</h1>
<div class="muted">Thêm 1 lần, sau đó lịch tự cập nhật mỗi khi bot đọc giấy mới.</div>
${inLine ? `<div class="warn">Bạn đang mở trong LINE. Bấm <b>⋯</b> (góc trên phải) → <b>Mở bằng trình duyệt</b> (Safari/Chrome), rồi bấm nút bên dưới.</div>` : ''}

<div class="card">
  <h2>iPhone · iPad · Mac</h2>
  <a class="btn primary" href="${esc(links.webcal)}">Thêm vào lịch iPhone</a>
  <ol class="muted">
    <li>Bấm nút trên → chọn <b>Đăng ký</b> (Subscribe).</li>
    <li>Màn hình tiếp theo: nếu có mục <b>Xóa cảnh báo</b> (Remove Alerts) thì <b>tắt</b> đi để được nhắc trước 1 ngày → <b>Thêm</b>.</li>
  </ol>
</div>

<div class="card">
  <h2>Google Calendar${isAndroid ? ' (Android)' : ''}</h2>
  <div class="muted">Google chỉ cho thêm lịch theo link trên <b>giao diện máy tính</b>. Làm 1 lần, sau đó lịch tự hiện trong app Google Calendar trên điện thoại.</div>
  ${isMobile ? `<ol class="muted">
    <li>Trong Chrome bấm <b>⋮</b> → bật <b>Trang web cho máy tính</b> (Desktop site).</li>
    <li>Bấm nút dưới → đăng nhập Google → bấm <b>Thêm</b> (Add).</li>
  </ol>` : ''}
  <a class="btn${isAndroid ? ' primary' : ''}" href="${esc(links.google)}" target="_blank" rel="noopener">Thêm vào Google Calendar</a>
  <a class="btn" href="#" data-copy="${esc(links.google)}" data-done="Đã sao chép ✓ — dán vào trình duyệt máy tính">Sao chép link để mở trên máy tính</a>
  <ol class="muted">
    <li>Không thấy hộp thoại <b>Thêm lịch?</b> → mở link trên máy tính (gửi link qua LINE cho chính mình).</li>
    <li>Không thấy lịch trong app điện thoại → app Google Calendar → ☰ → Cài đặt → lịch "Giấy Tờ Nhật" → bật <b>Đồng bộ hóa</b>.</li>
    <li>Google tự làm mới vài giờ/lần và dùng giờ nhắc mặc định của bạn (không dùng nhắc trước 1 ngày như iPhone).</li>
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
  <a class="btn" href="#" data-copy="${esc(links.https)}" data-done="Đã sao chép ✓">Sao chép link</a>
</div>
</main>
<script>
document.querySelectorAll('[data-copy]').forEach(function (el) {
  el.addEventListener('click', function (e) {
    e.preventDefault();
    navigator.clipboard.writeText(el.getAttribute('data-copy')).then(function () { el.textContent = el.getAttribute('data-done'); });
  });
});
</script>
</body></html>`;
}
