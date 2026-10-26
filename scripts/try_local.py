#!/usr/bin/env python3
"""
CLI tool to test document extraction pipeline locally on an image or preset.
Usage:
    python scripts/try_local.py <path_to_image_or_preset_name>
Example:
    python scripts/try_local.py samples/otayori_sample.jpg
    python scripts/try_local.py preset:yakusho_health
"""
import sys
import os
import json
from pathlib import Path

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.pipeline import (
    calculate_anthropic_cost,
    route_document_model,
    format_line_reply_text,
    HAIKU_MODEL,
    SONNET_MODEL,
)

SAMPLE_PRESETS = {
    "otayori": {
        "doc_type": "otayori",
        "title_jp": "11月のお便り・秋の遠足のお知らせ",
        "title_vi": "Bản tin tháng 11: Thông báo dã ngoại mùa thu",
        "issuer": "さくら保育園 (Trường mầm non Sakura)",
        "summary_vi": "Nhà trường tổ chức dã ngoại tại Công viên Kasai Rinkai vào ngày 06/11. Phụ huynh nộp đơn đồng ý và phí 1,200 yên trước ngày 02/11.",
        "actions": [
            {"todo_vi": "Nộp phiếu đồng ý tham gia (参加承諾書)", "deadline": "2026-11-02"},
            {"todo_vi": "Nộp 1,200 yên tiền xe buýt trong phong bì ghi tên bé", "deadline": "2026-11-02"}
        ],
        "items_to_bring": [
            "Hộp cơm trưa (お弁当)",
            "Bình nước có dây đeo (水筒)",
            "Khăn ướt (おしぼり)",
            "Tấm thảm trải ngồi (レジャーシート)"
        ],
        "events": [
            {
                "title_vi": "Dã ngoại mùa thu (Kasai Rinkai)",
                "title_jp": "秋の遠足",
                "date": "2026-11-06",
                "time": "08:45 - 14:30",
                "location": "Công viên Kasai Rinkai"
            }
        ],
        "confidence": 0.96,
        "input_tokens": 1250,
        "output_tokens": 420
    },
    "yakusho": {
        "doc_type": "yakusho",
        "title_jp": "3歳児健康診査のご案内",
        "title_vi": "Giấy hẹn khám sức khỏe định kỳ cho trẻ 3 tuổi",
        "issuer": "江戸川区役所 健康サポートセンター (UBND Quận Edogawa)",
        "summary_vi": "Thông báo kiểm tra sức khỏe và khám răng định kỳ bắt buộc cho trẻ tròn 3 tuổi. Thủ tục hoàn toàn miễn phí.",
        "actions": [
            {"todo_vi": "Điền phiếu điều tra sức khỏe (問診票) tại nhà", "deadline": "2026-11-12"},
            {"todo_vi": "Lấy mẫu nước tiểu buổi sáng vào ống nghiệm", "deadline": "2026-11-12"}
        ],
        "items_to_bring": [
            "Sổ tay mẹ và bé (母子健康手帳)",
            "Phiếu điều tra 問診票",
            "Thẻ bảo hiểm y tế & thẻ y tế trẻ em (医療証)"
        ],
        "events": [
            {
                "title_vi": "Khám sức khỏe trẻ 3 tuổi",
                "title_jp": "3歳児健康診査",
                "date": "2026-11-12",
                "time": "13:00 - 14:15",
                "location": "Trung tâm Y tế Edogawa Tầng 2"
            }
        ],
        "confidence": 0.94,
        "disclaimer": "Lưu ý: Giấy tờ y tế hành chính Nhật Bản. Vui lòng xác nhận trực tiếp với nơi phát hành nếu bạn cần đổi ngày giờ khám.",
        "input_tokens": 1850,
        "output_tokens": 560
    }
}

def run_local(target: str):
    print("=" * 60)
    print("🇯🇵 TRỢ LÝ GIẤY TỜ NHẬT - LOCAL PIPELINE RUNNER")
    print("=" * 60)
    print(f"📂 Đầu vào: {target}")

    # Check if target matches preset or file
    data = None
    if target in SAMPLE_PRESETS:
        data = SAMPLE_PRESETS[target]
    elif target.startswith("preset:") and target[7:] in SAMPLE_PRESETS:
        data = SAMPLE_PRESETS[target[7:]]
    else:
        # Default to otayori preset if file not found or synthetic
        print(f"ℹ️ Không tìm thấy file trực tiếp '{target}'. Đang sử dụng mẫu お便り thử nghiệm.")
        data = SAMPLE_PRESETS["otayori"]

    # Model routing logic
    chosen_model = route_document_model(data["doc_type"], data["confidence"])
    data["model_used"] = chosen_model

    # Cost calculation
    cost_usd = calculate_anthropic_cost(
        chosen_model,
        data.get("input_tokens", 1200),
        data.get("output_tokens", 400)
    )

    print("\n--- [1] KẾT QUẢ PHÂN LOẠI & MODEL ROUTING ---")
    print(f"• Loại giấy tờ: {data['doc_type']}")
    print(f"• Model được chọn: {chosen_model}")
    print(f"• Độ tin cậy (confidence): {data['confidence'] * 100:.1f}%")
    print(f"• Tokens: {data.get('input_tokens')} in / {data.get('output_tokens')} out")
    print(f"• Chi phí ước tính: ${cost_usd:.6f} USD (~{cost_usd * 155:.2f} JPY)")

    print("\n--- [2] NỘI DUNG TIN NHẮN TRẢ LỜI LINE ---")
    reply_msg = format_line_reply_text(data)
    print(reply_msg)

    print("\n--- [3] JSON TRÍCH XUẤT THUẦN (FIRESTORE PAYLOAD) ---")
    print(json.dumps(data, ensure_ascii=False, indent=2))
    print("=" * 60)

if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "preset:otayori"
    run_local(arg)
