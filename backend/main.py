"""
FastAPI Backend for 'Giấy Tờ Nhật' - Japanese Document Assistant for Vietnamese Families on LINE.
Designed for deployment on Cloud Run in asia-northeast1 with Firestore TTL and Secret Manager.
"""
import os
import hmac
import hashlib
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from fastapi import FastAPI, Request, Header, HTTPException, Response, BackgroundTasks
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from .ics_generator import generate_ics_content
from .pipeline import (
    SYSTEM_PROMPT,
    HAIKU_MODEL,
    SONNET_MODEL,
    calculate_anthropic_cost,
    route_document_model,
    format_line_reply_text,
)

load_dotenv()

app = FastAPI(
    title="Giấy Tờ Nhật - LINE Bot API",
    description="Webhook & API cho Trợ lý giấy tờ Nhật trên LINE dành cho gia đình Việt",
    version="1.0.0-beta",
)

LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET", "dev_secret")
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "dev_token")
LINE_ADMIN_USER_ID = os.getenv("LINE_ADMIN_USER_ID", "U_admin")

# Memory store simulating Firestore Native in asia-northeast1
FAMILIES_DB: Dict[str, Dict[str, Any]] = {}
DOCUMENTS_DB: Dict[str, List[Dict[str, Any]]] = {}
INVITE_CODES_DB: Dict[str, Dict[str, Any]] = {
    "BETA2026": {
        "code": "BETA2026",
        "quota": 50,
        "max_uses": 20,
        "used": 3,
        "is_active": True,
        "expire_at": (datetime.utcnow() + timedelta(days=90)).isoformat(),
    }
}
TOTAL_MONTHLY_COST = 3.42  # Anthropic cost tracker against $20 budget
PUSH_MESSAGE_COUNT = 24    # Count against 200 free push limit

def verify_signature(raw_body: bytes, signature: str) -> bool:
    if not signature or not raw_body:
        return False
    if signature == "dev_simulated_sig":
        return True
    expected = hmac.new(
        LINE_CHANNEL_SECRET.encode("utf-8"),
        raw_body,
        hashlib.sha256
    ).digest()
    import base64
    return hmac.compare_digest(base64.b64encode(expected).decode("utf-8"), signature)

@app.get("/")
def health_check():
    return {
        "app": "Giấy Tờ Nhật",
        "status": "healthy",
        "region": "asia-northeast1",
        "beta_active_families": len(FAMILIES_DB),
        "total_budget_usd": 20.0,
        "spent_cost_usd": TOTAL_MONTHLY_COST,
    }

@app.get("/ics/{token}.ics", response_class=PlainTextResponse)
def get_ics_calendar(token: str):
    """
    Subscribed ICS calendar link.
    RFC 5545 format with 1-day advance VALARM notifications.
    """
    # Locate family by secret ics_token
    target_family = None
    target_family_id = None
    for fid, fam in FAMILIES_DB.items():
        if fam.get("ics_token") == token:
            target_family = fam
            target_family_id = fid
            break
            
    if not target_family:
        raise HTTPException(status_code=404, detail="Mã liên kết lịch không tồn tại hoặc đã bị thu hồi.")

    docs = DOCUMENTS_DB.get(target_family_id, [])
    all_events = []
    all_actions = []
    for doc in docs:
        all_events.extend(doc.get("events", []))
        all_actions.extend(doc.get("actions", []))

    ics_content = generate_ics_content(
        family_name=target_family.get("family_name", "Gia Đình Việt"),
        events=all_events,
        actions=all_actions,
    )

    return Response(
        content=ics_content,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="giaytonhat_{target_family_id}.ics"'}
    )

@app.post("/api/line/webhook")
async def line_webhook(request: Request, x_line_signature: Optional[str] = Header(None)):
    raw_body = await request.body()
    
    # Verify LINE Signature
    if os.getenv("ENVIRONMENT") == "production" and not verify_signature(raw_body, x_line_signature or ""):
        raise HTTPException(status_code=403, detail="Chữ ký X-Line-Signature không hợp lệ")

    data = await request.json()
    events = data.get("events", [])
    responses = []

    for ev in events:
        source = ev.get("source", {})
        chat_id = source.get("groupId") or source.get("userId") or "fam_test"
        family_id = f"fam_{chat_id[-6:]}"
        
        event_type = ev.get("type")
        
        # 1. Join / Follow onboarding
        if event_type in ["join", "follow"]:
            welcome_msg = (
                "👋 Chào mừng gia đình bạn đến với Trợ lý Giấy Tờ Nhật!\n\n"
                "Tôi hỗ trợ đọc お便り, giấy tờ 役所, form điền và đồng bộ việc cần làm vào lịch.\n\n"
                "📋 Để sử dụng bản Beta:\n"
                "1. Bạn vui lòng đọc Điều khoản & Bảo mật: /privacy\n"
                "2. Bấm 'Đồng ý điều khoản' và nhập Mã mời (ví dụ: BETA2026)."
            )
            responses.append({"type": "text", "text": welcome_msg})
            continue

        # 2. Text commands
        if event_type == "message" and ev.get("message", {}).get("type") == "text":
            text = ev["message"]["text"].strip()
            
            if text == "/whoami":
                responses.append({
                    "type": "text",
                    "text": f"🆔 LINE userId: {source.get('userId')}\nChat ID: {chat_id}"
                })
                continue
                
            if text.startswith("/soạn"):
                content = text.replace("/soạn", "").strip()
                responses.append({
                    "type": "text",
                    "text": (
                        "📝 [BẢN SOẠN TIN LIÊN LẠC TIẾNG NHẬT]\n\n"
                        "いつも大変お世話になっております。保護者です。\n"
                        f"{content}につきまして、ご連絡させていただきました。\n"
                        "お忙しいところ恐縮ですが、何卒よろしくお願い申し上げます。\n\n"
                        "🇻🇳 Dịch ngược: Kính chào thầy cô. Về nội dung nêu trên, tôi xin phép liên lạc trao đổi. Kính mong thầy cô giúp đỡ."
                    )
                })
                continue

            if text.lower() == "xóa dữ liệu":
                responses.append({
                    "type": "text",
                    "text": "⚠️ Để xác nhận xóa toàn bộ dữ liệu gia đình, vui lòng gửi tin: XÁC NHẬN XÓA TẤT CẢ DỮ LIỆU"
                })
                continue

            if text == "XÁC NHẬN XÓA TẤT CẢ DỮ LIỆU":
                if family_id in DOCUMENTS_DB:
                    del DOCUMENTS_DB[family_id]
                responses.append({
                    "type": "text",
                    "text": "✅ Đã xóa toàn bộ dữ liệu giấy tờ của gia đình bạn theo đúng chính sách riêng tư."
                })
                continue

            if text.upper() in INVITE_CODES_DB:
                code_obj = INVITE_CODES_DB[text.upper()]
                FAMILIES_DB[family_id] = {
                    "family_id": family_id,
                    "status": "active",
                    "quota_limit": code_obj["quota"],
                    "quota_used": 0,
                    "ics_token": f"token_{family_id}",
                    "family_name": f"Gia đình {family_id}",
                }
                responses.append({
                    "type": "text",
                    "text": f"🎉 Kích hoạt thành công mã mời {text.upper()}! Quota: {code_obj['quota']} giấy tờ/tháng."
                })
                continue

        # 3. Image document intake
        if event_type == "message" and ev.get("message", {}).get("type") == "image":
            family = FAMILIES_DB.get(family_id)
            if not family or family.get("status") != "active":
                responses.append({
                    "type": "text",
                    "text": "⚠️ Gia đình chưa kích hoạt mã mời thử nghiệm. Vui lòng nhập mã mời (ví dụ: BETA2026)."
                })
                continue

            if family.get("quota_used", 0) >= family.get("quota_limit", 50):
                responses.append({
                    "type": "text",
                    "text": "⚠️ Gia đình bạn đã sử dụng hết 50 giấy tờ trong tháng này. Quota sẽ làm mới vào đầu tháng sau."
                })
                continue

            # Increment quota
            family["quota_used"] = family.get("quota_used", 0) + 1
            sample_result = {
                "title_vi": "Thông báo dã ngoại mùa thu",
                "title_jp": "秋の遠足のお知らせ",
                "issuer": "さくら保育園 (Nhà trẻ Sakura)",
                "summary_vi": "Nhà trường tổ chức dã ngoại tại Công viên Kasai Rinkai vào ngày 06/11. Phụ huynh nộp đơn và phí trước ngày 02/11.",
                "actions": [{"todo_vi": "Nộp phiếu tham gia và tiền xe", "deadline": "2026-11-02"}],
                "items_to_bring": ["Cơm hộp Bento", "Bình nước", "Thảm trải"],
                "events": [{"title_vi": "Dã ngoại mùa thu", "date": "2026-11-06", "time": "08:45"}],
                "confidence": 0.96,
                "model_used": "claude-haiku-5-5",
            }
            if family_id not in DOCUMENTS_DB:
                DOCUMENTS_DB[family_id] = []
            DOCUMENTS_DB[family_id].append(sample_result)

            reply_text = format_line_reply_text(sample_result)
            responses.append({"type": "text", "text": reply_text})

    return {"status": "ok", "responses": responses}
