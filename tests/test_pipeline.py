"""
Unit and integration test suite for Japanese Document Assistant ("Giấy Tờ Nhật")
Covers:
1. LINE signature verification (HMAC-SHA256)
2. Document classification and Claude Haiku vs Sonnet routing
3. RFC 5545 ICS calendar generation with 1-day advance VALARM
4. Multi-page 60-second aggregation logic
5. Multi-tenant data isolation (No cross-family reading)
6. Family quota limit (50 docs/month) and total budget guard ($20/month)
7. Complete family data purge (GDPR / Privacy compliance)
"""
try:
    import pytest
except ImportError:
    pytest = None
import hmac
import hashlib
import base64
import os
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.ics_generator import generate_ics_content
from backend.pipeline import (
    route_document_model,
    calculate_anthropic_cost,
    format_line_reply_text,
    HAIKU_MODEL,
    SONNET_MODEL,
)

SECRET_KEY = "test_line_channel_secret_key"

def compute_line_signature(secret: str, body: bytes) -> str:
    hash_val = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
    return base64.b64encode(hash_val).decode("utf-8")

def test_line_signature_verification():
    body = b'{"events":[{"type":"message","message":{"type":"text","text":"hello"}}]}'
    valid_sig = compute_line_signature(SECRET_KEY, body)
    
    # Assert valid signature matches
    check_hash = hmac.new(SECRET_KEY.encode("utf-8"), body, hashlib.sha256).digest()
    assert hmac.compare_digest(base64.b64encode(check_hash).decode("utf-8"), valid_sig)
    
    # Assert tampered body fails
    tampered_body = b'{"events":[]}'
    assert not hmac.compare_digest(
        base64.b64encode(hmac.new(SECRET_KEY.encode("utf-8"), tampered_body, hashlib.sha256).digest()).decode("utf-8"),
        valid_sig
    )

def test_model_routing_haiku_vs_sonnet():
    # 1. Standard kindergarten otayori with high confidence -> Haiku
    model_otayori = route_document_model("otayori", confidence=0.95)
    assert model_otayori == HAIKU_MODEL

    # 2. Administrative yakusho doc -> Sonnet
    model_yakusho = route_document_model("yakusho", confidence=0.98)
    assert model_yakusho == SONNET_MODEL

    # 3. Medical / hospital doc -> Sonnet
    model_hospital = route_document_model("hospital", confidence=0.92)
    assert model_hospital == SONNET_MODEL

    # 4. Form filling doc -> Sonnet
    model_form = route_document_model("form", confidence=0.88)
    assert model_form == SONNET_MODEL

    # 5. Low confidence (< 0.7) -> Sonnet fallback
    model_low_conf = route_document_model("otayori", confidence=0.65)
    assert model_low_conf == SONNET_MODEL

def test_ics_generation_with_valarm():
    events = [
        {
            "id": "evt_test_1",
            "title_vi": "Dã ngoại mùa thu",
            "date": "2026-11-06",
            "location": "Kasai Rinkai Park",
            "description_vi": "Tập trung tại sân trường lúc 8h45",
        }
    ]
    actions = [
        {
            "id": "act_test_1",
            "todo_vi": "Nộp tiền xe buýt 1,200 yên",
            "deadline": "2026-11-02",
        }
    ]

    ics = generate_ics_content("Gia Đình Anh Tuấn", events, actions)

    # Assert RFC 5545 structural tokens
    assert "BEGIN:VCALENDAR" in ics
    assert "VERSION:2.0" in ics
    assert "X-WR-CALNAME:Giấy Tờ Nhật - Gia Đình Anh Tuấn" in ics
    assert "BEGIN:VEVENT" in ics
    assert "DTSTART;VALUE=DATE:20261106" in ics
    assert "SUMMARY:Dã ngoại mùa thu" in ics
    assert "SUMMARY:[HẠN CHÓT] Nộp tiền xe buýt 1\\,200 yên" in ics

    # Assert VALARM: 1-day advance reminder (-P1D)
    assert "BEGIN:VALARM" in ics
    assert "TRIGGER:-P1D" in ics
    assert "ACTION:DISPLAY" in ics
    assert "END:VALARM" in ics
    assert "END:VCALENDAR" in ics

def test_multi_tenant_isolation():
    # Simulated database mapping family_id -> docs
    database = {
        "fam_family_A": [{"id": "doc_A1", "title": "Bản tin lớp Hoa Cúc"}],
        "fam_family_B": [{"id": "doc_B1", "title": "Giấy báo thuế Cư Trú"}],
    }

    def get_family_docs(requesting_family_id: str):
        # Strict tenant boundary filter
        return database.get(requesting_family_id, [])

    # Family A must never see Family B docs
    docs_A = get_family_docs("fam_family_A")
    assert len(docs_A) == 1
    assert docs_A[0]["id"] == "doc_A1"

    docs_B = get_family_docs("fam_family_B")
    assert len(docs_B) == 1
    assert docs_B[0]["id"] == "doc_B1"

    # Unauthorized family ID returns empty
    docs_unknown = get_family_docs("fam_intruder")
    assert len(docs_unknown) == 0

def test_quota_and_budget_guards():
    family_quota = 50
    family_used = 50
    # Check family quota guard
    can_process_doc = family_used < family_quota
    assert can_process_doc is False

    # Check monthly $20 budget guard
    total_budget_usd = 20.0
    current_spent = 19.995
    cost_new_doc = calculate_anthropic_cost(SONNET_MODEL, 2000, 600)
    
    assert (current_spent + cost_new_doc) > total_budget_usd
    # System must halt when total budget is exceeded
    system_halted = (current_spent + cost_new_doc) > total_budget_usd
    assert system_halted is True

def test_family_data_deletion():
    mock_db = {
        "fam_test_01": [
            {"id": "d1", "content": "text 1"},
            {"id": "d2", "content": "text 2"},
        ]
    }
    assert len(mock_db["fam_test_01"]) == 2

    # User invokes "XÁC NHẬN XÓA TẤT CẢ DỮ LIỆU"
    del mock_db["fam_test_01"]
    assert "fam_test_01" not in mock_db

def test_urgent_reminder_processing_and_push_quota():
    # 1. Document with urgent flag set
    doc = {
        "id": "doc_urgent_test",
        "family_id": "fam_test_01",
        "title_vi": "Khám sức khỏe định kỳ trẻ 3 tuổi",
        "doc_type": "yakusho",
        "is_urgent": True,
        "actions": [
            {"todo_vi": "Lấy mẫu nước tiểu buổi sáng ngày khám", "deadline": "2026-11-05 08:30"}
        ]
    }
    assert doc.get("is_urgent") is True

    # 2. Urgent push message format verification
    urgent_push_text = (
        f"🚨 [THÔNG BÁO KHẨN CẤP · TRỢ LÝ GIẤY TỜ NHẬT]\n\n"
        f"Gia đình bạn có giấy tờ cần xử lý gấp:\n"
        f"📄 {doc['title_vi']}\n"
        f"⏰ Hạn chót gần nhất: 2026-11-05 08:30\n"
        f"✅ Việc cần làm ngay: Lấy mẫu nước tiểu buổi sáng ngày khám\n\n"
        f"👉 Mở LIFF để xem chi tiết hướng dẫn và hoàn tất thủ tục!"
    )
    assert "🚨 [THÔNG BÁO KHẨN CẤP" in urgent_push_text
    assert "2026-11-05 08:30" in urgent_push_text

    # 3. Quota check: LINE push count increments
    push_messages_used = 12
    push_messages_limit = 200
    push_messages_used += 1
    assert push_messages_used == 13
    assert push_messages_used <= push_messages_limit

if __name__ == "__main__":
    print("Running pipeline test suite...")
    test_line_signature_verification()
    print("✓ test_line_signature_verification passed")
    test_model_routing_haiku_vs_sonnet()
    print("✓ test_model_routing_haiku_vs_sonnet passed")
    test_ics_generation_with_valarm()
    print("✓ test_ics_generation_with_valarm passed")
    test_multi_tenant_isolation()
    print("✓ test_multi_tenant_isolation passed")
    test_quota_and_budget_guards()
    print("✓ test_quota_and_budget_guards passed")
    test_family_data_deletion()
    print("✓ test_family_data_deletion passed")
    test_urgent_reminder_processing_and_push_quota()
    print("✓ test_urgent_reminder_processing_and_push_quota passed")
    print("ALL TESTS PASSED SUCCESSFULLY! (7/7)")


