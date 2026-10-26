# 🇯🇵 Giấy Tờ Nhật - Trợ Lý Giấy Tờ Cho Gia Đình Việt Trên LINE

> **Bản dùng thử (Beta)**: Hỗ trợ khoảng 20 gia đình Việt Nam tại Nhật Bản đọc và dịch nghĩa thông báo trường học (お便り), thực đơn (献立表), thông báo hành chính (役所), tự động trích xuất việc cần làm và đồng bộ lịch sự kiện qua đường dẫn bí mật ICS.

---

## 📑 Mục Lục
1. [Kiến Trúc Hệ Thống (Stack)](#-kiến-trúc-hệ-thống-stack)
2. [Tạo & Cấu Hình LINE Channel](#-1-tạo--cấu-hình-line-channel)
3. [Tạo Ứng Dụng LIFF (LINE Front-end Framework)](#-2-tạo-ứng-dụng-liff-line-front-end-framework)
4. [Thiết Lập Google Cloud (asia-northeast1)](#-3-thiết-lập-google-cloud-asia-northeast1)
5. [Cấu Hình Bí Mật (Secret Manager)](#-4-cấu-hình-bí-mật-secret-manager)
6. [Triển Khai Cloud Run (Deployment)](#-5-triển-khai-cloud-run-deployment)
7. [Quản Lý & Tạo Mã Mời (Beta Invite Codes)](#-6-quản-lý--tạo-mã-mời-beta-invite-codes)
8. [Lịch ICS & Lưu Ý VALARM (iOS vs Google Calendar)](#-7-lịch-ics--lưu-ý-valarm-ios-vs-google-calendar)
9. [Chính Sách Riêng Tư & Xóa Dữ Liệu](#-8-chính-sách-riêng-tư--xóa-dữ-liệu)
10. [Kiểm Thử Pytest & Chạy Local](#-9-kiểm-thử-pytest--chạy-local)
11. [Checklist Trước Khi Mời Thử Nghiệm](#-10-checklist-trước-khi-mời-thử-nghiệm)

---

## 🏛️ Kiến Trúc Hệ Thống (Stack)

- **Webhook + API**: Cloud Run (Python 3.12, FastAPI hoặc Node.js / Express), region `asia-northeast1` (Tokyo).
- **Cơ sở dữ liệu**: Firestore Native (`asia-northeast1`), kích hoạt **TTL policy** trên trường `expire_at` (tự động xóa sau 90 ngày).
- **Bộ nhớ tạm hình ảnh**: Cloud Storage (`asia-northeast1`), cấu hình lifecycle tự động xóa sau 1 ngày; mã nguồn xóa ảnh gốc ngay lập tức sau khi xử lý OCR thành công.
- **Bảo mật bí mật**: Google Secret Manager (`LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `ICS_SIGNING_KEY`).
- **LIFF (Web mini-app trong LINE)**: Vite + React 19 + TypeScript + Tailwind CSS, tối ưu mobile-first.
- **Mô hình AI (LLM)**:
  - `claude-3-5-haiku` (mặc định): Phân loại, đọc ảnh, trích xuất sự kiện và việc cần làm (tối ưu chi phí).
  - `claude-3-5-sonnet`: Tự động kích hoạt khi giấy tờ là `yakusho` (hành chính/thuế), `form` (phiếu điều tra nộp lại), `hospital` (y tế) hoặc khi Haiku trả độ tin cậy `< 0.7`.
  - Fallback: Tích hợp sẵn `@google/genai` (Gemini 2.5 Flash) đảm bảo hoạt động liên tục.

---

## 🚀 1. Tạo & Cấu Hình LINE Channel

### Bước 1.1: Tạo LINE Official Account & Messaging API
1. Truy cập [LINE Developers Console](https://developers.line.biz/console/).
2. Chọn Provider của bạn (hoặc tạo Provider mới, ví dụ: `Gia Dinh Viet Japan`).
3. Nhấn **Create a new channel** → Chọn **Messaging API**.
4. Điền các thông tin:
   - **Channel name**: `Giấy Tờ Nhật` (hoặc tên bạn muốn đặt).
   - **Channel description**: Trợ lý đọc giấy tờ tiếng Nhật cho gia đình Việt.
   - **Category / Subcategory**: Education / Family.
5. Sau khi tạo xong, chuyển sang tab **Messaging API**:
   - Nhấn **Issue** tại mục **Channel access token (long-lived)** để lấy Access Token.
   - Tại tab **Basic settings**, lưu lại **Channel secret**.

### Bước 1.2: Tắt chế độ Chat thủ công (BẮT BUỘC)
1. Đăng nhập vào [LINE Official Account Manager](https://manager.line.biz/).
2. Chọn tài khoản bot vừa tạo → Vào **Settings (Cài đặt)** ở góc trên bên phải.
3. Vào mục **Response settings (Cài đặt phản hồi)**:
   - **Response mode**: Chọn **Bot** (TUYỆT ĐỐI KHÔNG chọn Chat, nếu chọn Chat thì Webhook sẽ không nhận được tin nhắn sự kiện).
   - **Auto-response messages**: Chọn **Disabled (Tắt)**.
   - **Webhooks**: Chọn **Enabled (Bật)**.

### Bước 1.3: Cài đặt Webhook URL
1. Quay lại [LINE Developers Console](https://developers.line.biz/console/) → tab **Messaging API**.
2. Tại mục **Webhook settings**:
   - **Webhook URL**: `https://YOUR_CLOUD_RUN_URL/api/line/webhook`
   - Bật gạt **Use webhook**.
   - Bật **Auto-retry** (để LINE gửi lại nếu có gián đoạn mạng tạm thời).

---

## 📱 2. Tạo Ứng Dụng LIFF (LINE Front-end Framework)

1. Trong LINE Developers Console, tại cùng Provider, nhấn **Create a new channel** → Chọn **LINE Front-end Framework (LIFF)** (hoặc thêm LIFF tab vào Messaging API channel).
2. Tại tab **LIFF**, nhấn **Add**:
   - **LIFF app name**: `Giấy Tờ Nhật LIFF`
   - **Size**: **Full** (hoặc Tall)
   - **Endpoint URL**: `https://YOUR_APP_URL`
   - **Scopes**: Tích chọn `profile`, `chat_message.write`.
   - **Bot link feature**: Chọn **Normal** (tự động gợi ý add friend bot nếu người dùng mở LIFF trước).
3. Lưu lại **LIFF ID** (dạng `1234567890-abcdefgh`).

---

## ☁️ 3. Thiết Lập Google Cloud (asia-northeast1)

### Bước 3.1: Đặt biến môi trường và kích hoạt API
```bash
export PROJECT_ID="YOUR_GCP_PROJECT_ID"
export REGION="asia-northeast1"

gcloud config set project $PROJECT_ID

# Kích hoạt các API cần thiết
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  cloudbuild.googleapis.com
```

### Bước 3.2: Tạo Firestore Database & Thiết lập TTL (90 ngày)
1. Tạo Firestore Native database tại Tokyo:
```bash
gcloud firestore databases create \
  --location=asia-northeast1 \
  --type=firestore-native
```

2. Bật TTL policy tự động xóa dữ liệu sau 90 ngày trên collection `documents`:
```bash
gcloud firestore fields ttls update expire_at \
  --collection-group=documents \
  --enable-ttl
```

### Bước 3.3: Tạo Cloud Storage Bucket tạm thời (Lifecycle 1 ngày)
```bash
gcloud storage buckets create gs://${PROJECT_ID}-line-temp \
  --location=asia-northeast1 \
  --uniform-bucket-level-access

# Cấu hình tự động xóa ảnh sau 1 ngày (dự phòng trường hợp lỗi pipeline)
cat <<EOF > lifecycle.json
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 1}
    }
  ]
}
EOF

gcloud storage buckets update gs://${PROJECT_ID}-line-temp --lifecycle-file=lifecycle.json
```

---

## 🔐 4. Cấu Hình Bí Mật (Secret Manager)

Tạo và lưu trữ an toàn các bí mật:
```bash
# 1. LINE Channel Secret
printf "YOUR_LINE_CHANNEL_SECRET" | gcloud secrets create line-channel-secret --data-file=-

# 2. LINE Channel Access Token
printf "YOUR_LINE_ACCESS_TOKEN" | gcloud secrets create line-channel-token --data-file=-

# 3. Anthropic API Key (Ngân sách beta $20/tháng)
printf "YOUR_ANTHROPIC_API_KEY" | gcloud secrets create anthropic-api-key --data-file=-

# 4. Khóa ký mã HMAC cho link ICS
printf "RANDOM_HMAC_SECRET_KEY_2026" | gcloud secrets create ics-signing-key --data-file=-
```

---

## 🚢 5. Triển Khai Cloud Run (Deployment)

### Triển khai Python FastAPI Backend:
```bash
gcloud run deploy giay-to-nhat-api \
  --source=./backend \
  --region=asia-northeast1 \
  --platform=managed \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=5 \
  --memory=512Mi \
  --set-env-vars=ENVIRONMENT=production,MAX_BETA_FAMILIES=20,MONTHLY_BUDGET_USD=20 \
  --set-secrets=LINE_CHANNEL_SECRET=line-channel-secret:latest,LINE_CHANNEL_ACCESS_TOKEN=line-channel-token:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,ICS_SIGNING_KEY=ics-signing-key:latest
```

Sau khi deploy thành công, lấy URL dịch vụ (ví dụ: `https://giay-to-nhat-api-xxx.a.run.app`) và cập nhật vào mục **Webhook URL** của LINE Developers Console.

---

## 🎟️ 6. Quản Lý & Tạo Mã Mời (Beta Invite Codes)

Để kiểm soát số lượng tối đa 20 gia đình và tránh phát sinh chi phí ngoài dự kiến:
1. Mở trang quản trị **LIFF Quản Trị** (tab Admin) hoặc gọi API:
   - `POST /api/admin/invite-codes`
   - Payload:
     ```json
     {
       "code": "BETA2026",
       "quota": 50,
       "maxUses": 20,
       "note": "Đợt 1 dành cho 20 gia đình đầu tiên"
     }
     ```
2. Mỗi gia đình khi thêm bot vào nhóm chỉ cần gõ mã mời (ví dụ: `BETA2026`).
3. Nếu nhóm chưa có mã mời hoặc mã mời đã hết lượt, bot sẽ lịch sự từ chối đọc ảnh và hướng dẫn liên hệ quản trị viên.

---

## 📅 7. Lịch ICS & Lưu Ý VALARM (iOS vs Google Calendar)

Mỗi gia đình được cấp một link lịch bí mật dạng:
`https://YOUR_DOMAIN/ics/{token}.ics`

### Cơ chế cảnh báo nhắc trước 1 ngày (`VALARM -P1D`):
- **iOS Calendar (Apple)**: Hoạt động **100% hoàn hảo**. Khi đăng ký Subscribed Calendar trên iPhone, iOS tôn trọng thẻ `VALARM` và gửi thông báo nhắc vào ngày hôm trước sự kiện.
- **Google Calendar**: Google Calendar hỗ trợ hiển thị sự kiện; tuy nhiên, theo tài liệu kỹ thuật của Google, ứng dụng Google Calendar **bỏ qua thẻ VALARM mặc định** của các lịch subscribe bên thứ 3 và áp dụng thông báo mặc định do người dùng cấu hình trong Settings của Google Calendar.
- **Tiết kiệm Quota Push**: Bot nhắc hạn thông qua ứng dụng Lịch điện thoại của người dùng, **KHÔNG sử dụng tin nhắn LINE Push** (nhằm bảo vệ hạn mức 200 tin push miễn phí/tháng của LINE).

---

## 🛡️ 8. Chính Sách Riêng Tư & Xóa Dữ Liệu

1. **Cách ly dữ liệu (Multi-tenant Isolation)**:
   - Mọi truy vấn database đều bắt buộc filter theo `family_id`.
   - Gia đình A tuyệt đối không thể đọc hay thấy dữ liệu của gia đình B.
2. **Quyền xóa dữ liệu bất kỳ lúc nào**:
   - Gửi tin nhắn `xóa dữ liệu` trong nhóm LINE → Bot hỏi xác nhận → Gửi `XÁC NHẬN XÓA TẤT CẢ DỮ LIỆU` → Hệ thống xóa vĩnh viễn toàn bộ tài liệu, việc cần làm, sự kiện và vô hiệu hóa link lịch ICS ngay lập tức.
   - Nút **Xóa toàn bộ dữ liệu gia đình** trong tab Cài đặt của LIFF.
   - Nếu bot bị kick khỏi group LINE, hệ thống sẽ tự động lên lịch xóa dữ liệu sau 7 ngày.
3. **Bảo mật tuyệt đối phía Quản trị viên (Admin)**:
   - Dashboard Admin được lập trình **KHÔNG CÓ API HOẶC GIAO DIỆN XEM NỘI DUNG VĂN BẢN HAY ẢNH**. Admin chỉ thấy số lượng, chi phí API, loại giấy tờ và tỷ lệ phản hồi đúng/sai.

---

## 🧪 9. Kiểm Thử Pytest & Chạy Local

### Chạy toàn bộ pytest:
```bash
pytest -v tests/test_pipeline.py
```
Bộ test bao gồm:
- Xác thực chữ ký `X-Line-Signature` (HMAC-SHA256).
- Phân loại tài liệu và định tuyến thông minh (Haiku vs Sonnet).
- Tạo định dạng chuẩn RFC 5545 ICS có `VALARM -P1D`.
- Gom nhóm ảnh gửi liên tiếp trong 60 giây thành 1 tài liệu nhiều trang.
- Đảm bảo cô lập dữ liệu gia đình (Tenant separation).
- Giới hạn quota gia đình (50 giấy) và kiểm soát ngân sách tổng ($20).
- Xóa sạch dữ liệu gia đình khi có yêu cầu.

### Chạy pipeline thử nghiệm trên terminal:
```bash
python scripts/try_local.py preset:otayori
python scripts/try_local.py preset:yakusho
python scripts/try_local.py path/to/real_image.jpg
```

---

## ✅ 10. Checklist Trước Khi Mời Thử Nghiệm

- [x] Đã tắt chế độ Chat thủ công trong LINE Official Account Manager (chỉ bật chế độ Bot).
- [x] Đã thiết lập Webhook URL và bật gạt "Use Webhook".
- [x] Đã thiết lập Firestore TTL policy trên trường `expire_at` (90 ngày).
- [x] Đã tạo mã mời thử nghiệm (`BETA2026`) với hạn mức tối đa 20 gia đình.
- [x] Đã cấu hình ngân sách cảnh báo Anthropic API ($20/tháng).
- [x] Đã kiểm tra tính năng xóa dữ liệu tức thì.
- [x] Đã gửi thông báo kèm hướng dẫn add lịch ICS cho các gia đình tham gia.
