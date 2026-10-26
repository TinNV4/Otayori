"""
RFC 5545 iCalendar generator with 1-day advance VALARM for Japanese document assistant.
"""
from datetime import datetime
from typing import List, Dict, Any

def generate_ics_content(family_name: str, events: List[Dict[str, Any]], actions: List[Dict[str, Any]]) -> str:
    now_stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    
    clean_name = family_name.replace(";", "\\;").replace(",", "\\,")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//GiayToNhat//TroLyGiaDinh//VI",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:Giấy Tờ Nhật - {clean_name}",
        "X-WR-TIMEZONE:Asia/Tokyo",
        "REFRESH-INTERVAL;VALUE=DURATION:P1H",
        "X-PUBLISHED-TTL:PT1H",
    ]

    # Add events
    for evt in events:
        date_str = (evt.get("date") or "").replace("-", "")
        if len(date_str) != 8:
            continue
        uid = f"evt-{evt.get('id', 'uid')}@giaytonhat.app"
        title = (evt.get("title_vi") or "Sự kiện trường").replace(",", "\\,").replace(";", "\\;")
        location = (evt.get("location") or "").replace(",", "\\,").replace(";", "\\;")
        desc = (evt.get("description_vi") or "").replace("\n", "\\n")
        
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{now_stamp}",
            f"DTSTART;VALUE=DATE:{date_str}",
            f"DTEND;VALUE=DATE:{date_str}",
            f"SUMMARY:{title}",
            f"DESCRIPTION:{desc}",
        ])
        if location:
            lines.append(f"LOCATION:{location}")
            
        # VALARM: 1 day advance notification (-P1D)
        lines.extend([
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"DESCRIPTION:Nhắc trước 1 ngày: {title}",
            "TRIGGER:-P1D",
            "END:VALARM",
            "END:VEVENT",
        ])

    # Add actionable deadlines
    for act in actions:
        deadline_str = (act.get("deadline") or "").replace("-", "")
        if len(deadline_str) != 8:
            continue
        uid = f"act-{act.get('id', 'uid')}@giaytonhat.app"
        todo = (act.get("todo_vi") or "").replace(",", "\\,").replace(";", "\\;")
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{now_stamp}",
            f"DTSTART;VALUE=DATE:{deadline_str}",
            f"DTEND;VALUE=DATE:{deadline_str}",
            f"SUMMARY:[HẠN CHÓT] {todo}",
            f"DESCRIPTION:Việc cần làm đúng hạn từ giấy tờ Nhật.",
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"DESCRIPTION:HẠN CHÓT NGÀY MAI: {todo}",
            "TRIGGER:-P1D",
            "END:VALARM",
            "END:VEVENT",
        ])

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)
