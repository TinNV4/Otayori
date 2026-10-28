# Bản tin chính sách cá nhân hóa

Không gửi tin chung chung — chỉ báo thay đổi ảnh hưởng tới **chính người đó**, kèm hạn chót, việc cần làm, link nguồn chính thức.

## Luồng

```mermaid
flowchart LR
  S["5 nguồn chính thức\nISA · MHLW · NTA · NPA · Nagoya"] -->|"hằng ngày 7:30 JST\n/tasks/policy"| F["Lấy danh sách có ngày\n≤45 ngày, lọc từ khóa"]
  F --> A["Claude Haiku\nsoạn nháp (không tự gửi)"]
  A --> D[("policy_items\nstatus = pending")]
  D --> R{"Admin duyệt\nnpm run policy -- approve"}
  R -- reject --> X["Loại"]
  R -- "🟢 🟡" --> L["Tab Chính sách (LIFF)\n+ 'có gì mới' (reply, 0 quota)"]
  R -- "🔴" --> P["Push 1:1 cho đúng người\n(quota-aware)"]
  U[("policy_profiles\nvisa · hạn · nơi ở · có con")] --> M["Khớp bằng luật cố định\n(không dùng AI)"]
  M --> L
  M --> P
  U --> V["Nhắc hạn visa\n90 ngày trước · 1 lần"]
```

**Nguyên tắc:** AI chỉ *tóm tắt* một trang chính thức. Ai nhận tin nào do **luật cố định** quyết định (`src/server/policy/match.ts`), và không có gì được gửi nếu admin chưa duyệt.

## Ba loại tin

| | Khi nào | Gửi thế nào | Tốn quota push |
|---|---|---|---|
| 🔴 Khẩn | Đã chốt, mốc quan trọng (hạn / hiệu lực) trong ≤30 ngày | Push ngay khi admin duyệt | Có (1/người/tin) |
| 🟡 Sắp có hiệu lực | Đã chốt, còn >30 ngày | Tab "Chính sách" + `có gì mới` | Không |
| 🟢 Đang bàn | Dự thảo / パブコメ | Tab "Chính sách" + `có gì mới` | Không |

Màu chỉ là **gợi ý** (`suggestSeverity`); admin đổi được khi duyệt: `approve <id> --severity red`.

## Ví dụ tin 🔴

```
🔴 Phí gia hạn 在留 tăng
Hạn: … · Áp dụng từ: 1/10/2026
Visa của bạn hết hạn 3/2027 → bạn có thể nộp đơn gia hạn từ 12/2026 — sau ngày áp dụng (1/10/2026) nên sẽ theo quy định mới.
💡 Vì sao bạn nhận tin: Vì visa của bạn hết hạn 3/2027.
✅ Việc cần làm: Chuẩn bị giấy tờ sớm.
🔗 Nguồn: 出入国在留管理庁 …
```

Người có visa hết hạn **trước** ngày áp dụng sẽ **không** nhận tin này (họ nộp theo quy định cũ).

## Quota push LINE (gói free: 200 tin/tháng, dùng chung)

Chỉ có 3 thứ tiêu quota: tin 🔴, nhắc hạn visa (1 lần / mỗi ngày hết hạn), cảnh báo admin. Còn lại đi bằng reply (miễn phí) hoặc LIFF. Luôn giữ lại 20 tin dự phòng; hết quota thì tin 🔴 được hoãn (người dùng vẫn thấy trong app) và admin được báo 1 lần/tháng.

```mermaid
xychart-beta
  title "Push/tháng theo số người dùng (giả định 2 tin 🔴 + 1 nhắc visa mỗi người)"
  x-axis ["20", "40", "60", "80", "100"]
  y-axis "tin push" 0 --> 320
  bar [60, 120, 180, 240, 300]
  line [180, 180, 180, 180, 180]
```

Đường ngang = ngân sách dùng được (200 − 20 dự phòng). Vượt ~60 người dùng thì cần gói trả phí (hoặc chỉ push 🔴 loại nghiêm trọng nhất). `npm run policy -- stats` in ước tính theo số hồ sơ thật.

## Ranh giới pháp lý (đã cài trong code)

- Chỉ nêu thay đổi + việc cần làm chung; prompt cấm đánh giá "bạn có đủ điều kiện 永住 không" (việc của 行政書士).
- Chỉ đọc **trang chính thức** của cơ quan nhà nước, luôn kèm link; không dùng báo chí.
- **Bắt buộc admin duyệt** trước khi bất kỳ ai nhận tin.
- Mọi tin kèm dòng "Tóm tắt từ nguồn chính thức, không phải tư vấn pháp lý".
- Trong **nhóm LINE** bot không in dữ liệu cá nhân (visa, ngày hết hạn): chỉ gửi link mở app.

## Vận hành hằng ngày

```bash
npm run policy -- fetch --dry       # xem link mỗi nguồn trả về (không gọi Claude) — chạy khi nghi nguồn đổi giao diện
npm run policy -- fetch             # (job 7:30 tự chạy) tạo bản nháp, báo admin qua LINE
npm run policy -- list              # bản nháp chờ duyệt
npm run policy -- show <id>         # nội dung, đối tượng, sẽ tới bao nhiêu người
npm run policy -- approve <id>      # 🔴 push ngay nếu có LINE_CHANNEL_ACCESS_TOKEN; không thì job sáng hôm sau gửi
npm run policy -- reject <id>
npm run policy -- stats             # biểu đồ tin / người dùng / quota push
```

Cần `ANTHROPIC_API_KEY` để có bản tóm tắt thật (không có thì dùng bản mẫu để thử luồng). Chi phí ước tính < $0.001 / trang (Haiku), tối đa `POLICY_MAX_NEW_PER_RUN` (10) trang/nguồn/ngày, dùng chung `MONTHLY_BUDGET_USD`.

Đổi/thêm nguồn: sửa `src/server/policy/sources.ts` (URL trang "tin mới", `keywords`, `exclude`). Nguồn thành phố: đặt `city` và thêm vào `POLICY_CITIES`.

## Hồ sơ và nhắc hạn riêng

3 trường bắt buộc (visa + ngày hết hạn, nơi ở, có con) và các trường **không bắt buộc**. Bỏ trống một trường = người đó **không bị loại** khỏi tin liên quan tới trường đó (thà báo thừa còn hơn bỏ sót).

| Trường thêm | Dùng để |
|---|---|
| Ngành 特定技能 (chỉ hiện khi chọn 特定技能) | Chỉ nhận tin của ngành mình |
| Loại hợp đồng (正社員 / パート / khác / không đi làm) | Tin riêng cho từng loại hợp đồng |
| Bằng lái (chưa có / bằng Nhật / định đổi 外免) + ngày hết hạn | Tin 外免切替, **nhắc trước 60 ngày** |
| Kế hoạch (永住 / về nước / chưa quyết) | Tin riêng cho người xin 永住 hoặc sắp về nước |
| 住民税 (công ty trừ lương / tự đóng) | Chọn "tự đóng" → nhắc **7 ngày trước** các kỳ cuối tháng 6, 8, 10, 1 |

Nhắc hạn ghi chú rõ mốc 住民税 "thường là" cuối tháng đó và chỉ người dùng xem phiếu 納付書 của mình mới chắc chắn (mỗi thành phố khác nhau). Mỗi mốc chỉ nhắc 1 lần (`reminders_sent`).

## Chấm đỏ trên rich menu

Khi duyệt một tin (bất kỳ màu), bot đổi rich menu của những người liên quan sang bản có **chấm đỏ** trên nút "Trang gia đình" (bấm vào mở thẳng tab Chính sách). Đọc tin (mở tab hoặc gõ "có gì mới") thì chuyển lại menu thường. Đổi menu của từng người **không phải tin nhắn nên không tốn quota**.

```bash
python3 scripts/make-richmenu-dot.py   # tạo assets/richmenu-dot.png từ assets/richmenu.png (cần Pillow)
npx tsx scripts/richmenu.ts            # tạo 2 menu + alias "giaytonhat-dot" (chạy lại sau khi deploy lần đầu)
```

Chưa chạy `richmenu.ts` (hoặc người dùng chưa kết bạn với bot) thì việc đổi menu bị bỏ qua, không gây lỗi. Chỉ hiện trong chat 1:1, không có ở nhóm.

## Gói Premium (cờ, mặc định tắt)

`POLICY_PREMIUM_ONLY_PUSH=true` → chỉ người dùng Premium nhận **push** (🔴 và nhắc hạn); mọi người vẫn xem tin trong app và "có gì mới". Đặt gói: `npm run policy -- tier <userId> premium`. Giai đoạn beta để tắt. **Chưa có thanh toán**: chuyển gói là thao tác tay của admin.

## Duyệt trong LIFF

Admin mở app → Quản trị → "Duyệt bản tin chính sách": thấy nháp, link gốc, đối tượng, chọn 🔴🟡🟢 rồi Duyệt/Loại (🔴 push ngay). CLI `npm run policy` vẫn dùng được.

## Phạm vi

| Đã có | Chưa làm |
|---|---|
| 5 nguồn: 入管庁, 厚労省, 国税庁, 警察庁, Nagoya | **B2B 登録支援機関** (gửi bản tin cho người lao động do tổ chức quản lý): cần quyết định hợp đồng, đối tượng được xem dữ liệu của ai, và thanh toán — chưa dựng khi chưa chốt các điểm này |
| Hồ sơ 3 trường + 6 trường thêm, sửa/xóa trong LIFF | Thanh toán Premium tự động |
| 🔴 push · 🟡🟢 trong app · `có gì mới` | |
| Nhắc hạn: visa (90 ngày), bằng lái (60), 住民税 (7) | |
| Chấm đỏ rich menu theo từng người | |
| Admin duyệt (LIFF + CLI + API) | |
| Cờ Premium + `tier` | |

## Lưu ý đã kiểm chứng (2026-10-28)

- Danh sách "tin mới" của 5 nguồn đã được đối chiếu với trang thật. 国税庁 trả 0 mục khi không có thông cáo nào trong 45 ngày — bình thường, vì nguồn này ít tin dành cho cư dân.
- Trang ISA chặn User-Agent mặc định của `curl` (403) nhưng chấp nhận bot khai báo đúng tên (`GiayToNhat-PolicyReader`). Không giả User-Agent trình duyệt.
- Bản tóm tắt bằng Claude **chưa được chạy với dữ liệu thật** (thiếu API key trong môi trường phát triển): hãy chạy `fetch` với 10–20 trang thật và đối chiếu ngày/đối tượng trước khi mời người dùng.
