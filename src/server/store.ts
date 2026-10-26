import crypto from 'crypto';
import { DocType, ExtractedDocument, Family, InviteCode, AdminMetrics, AuditLog } from '../types/index.ts';

// In-memory persistent database for dev & full demo mode
class AppDataStore {
  private families: Map<string, Family> = new Map();
  private documents: Map<string, ExtractedDocument> = new Map();
  private inviteCodes: Map<string, InviteCode> = new Map();
  private auditLogs: AuditLog[] = [];
  private pushMessagesCount: number = 24; // out of 200 quota
  private totalMonthlyCost: number = 3.42; // out of $20 budget

  // 60-second multi-page aggregation buffer
  private imageAggregationBuffer: Map<string, {
    family_id: string;
    chat_id: string;
    images: Array<{ url: string; timestamp: number; name?: string }>;
    timer: NodeJS.Timeout | null;
  }> = new Map();

  constructor() {
    this.seedInitialData();
  }

  private seedInitialData() {
    // Seed Invite Codes
    this.inviteCodes.set('BETA2026', {
      code: 'BETA2026',
      quota_per_family: 50,
      max_uses: 20,
      used_count: 5,
      is_active: true,
      created_at: '2026-10-01T08:00:00Z',
      expires_at: '2026-12-31T23:59:59Z',
      note: 'Mã mời đợt 1 cho 20 gia đình đầu tiên',
    });

    this.inviteCodes.set('TOKYO2026', {
      code: 'TOKYO2026',
      quota_per_family: 50,
      max_uses: 10,
      used_count: 2,
      is_active: true,
      created_at: '2026-10-10T08:00:00Z',
      expires_at: '2026-12-31T23:59:59Z',
      note: 'Gia đình khu vực Kanto',
    });

    // Seed Active Families
    const sampleFamilies: Family[] = [
      {
        family_id: 'fam_tokyo_01',
        line_chat_id: 'C_tokyo_group_9823',
        chat_type: 'group',
        family_name: 'Gia Đình Anh Tuấn & Chị Mai (Edogawa-ku)',
        invite_code: 'BETA2026',
        status: 'active',
        quota_limit: 50,
        quota_used: 14,
        ics_token: 'sec_token_fam_tokyo_01_99x8',
        created_at: '2026-10-02T10:15:00Z',
        last_active: '2026-10-26T03:12:00Z',
        members_count: 3,
      },
      {
        family_id: 'fam_saitama_02',
        line_chat_id: 'C_saitama_group_1241',
        chat_type: 'group',
        family_name: 'Gia Đình Kenji & Linh (Kawaguchi)',
        invite_code: 'BETA2026',
        status: 'active',
        quota_limit: 50,
        quota_used: 28,
        ics_token: 'sec_token_fam_saitama_02_14z2',
        created_at: '2026-10-05T14:30:00Z',
        last_active: '2026-10-25T19:40:00Z',
        members_count: 2,
      },
      {
        family_id: 'fam_osaka_03',
        line_chat_id: 'C_osaka_group_7761',
        chat_type: 'group',
        family_name: 'Gia Đình Hải Yến (Osaka Chuo-ku)',
        invite_code: 'BETA2026',
        status: 'active',
        quota_limit: 50,
        quota_used: 8,
        ics_token: 'sec_token_fam_osaka_03_77q1',
        created_at: '2026-10-12T09:00:00Z',
        last_active: '2026-10-24T11:22:00Z',
        members_count: 4,
      },
      {
        family_id: 'fam_chiba_04',
        line_chat_id: 'U_chiba_single_3321',
        chat_type: 'user',
        family_name: 'Minh Hoàng (Matsudo)',
        invite_code: 'BETA2026',
        status: 'active',
        quota_limit: 50,
        quota_used: 6,
        ics_token: 'sec_token_fam_chiba_04_88m3',
        created_at: '2026-10-15T08:20:00Z',
        last_active: '2026-10-23T15:10:00Z',
        members_count: 1,
      },
      {
        family_id: 'fam_kanagawa_05',
        line_chat_id: 'C_kanagawa_group_6541',
        chat_type: 'group',
        family_name: 'Gia Đình Bé Bắp & Bo (Yokohama)',
        invite_code: 'TOKYO2026',
        status: 'active',
        quota_limit: 50,
        quota_used: 19,
        ics_token: 'sec_token_fam_kanagawa_05_44w9',
        created_at: '2026-10-18T16:00:00Z',
        last_active: '2026-10-26T02:45:00Z',
        members_count: 4,
      },
    ];

    sampleFamilies.forEach(f => this.families.set(f.family_id, f));

    // Seed Documents for fam_tokyo_01 (within 90-day retention window)
    const now = new Date('2026-10-26T03:00:00Z');
    const expireDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();

    const sampleDocs: ExtractedDocument[] = [
      {
        id: 'doc_otayori_11',
        family_id: 'fam_tokyo_01',
        created_at: '2026-10-24T09:30:00Z',
        expire_at: expireDate,
        doc_type: 'otayori',
        title_jp: '11月のお便り・秋の遠足のお知らせ',
        title_vi: 'Bản tin tháng 11: Thông báo dã ngoại mùa thu',
        issuer: 'Trường mầm non Sakura (さくら保育園)',
        summary_vi: 'Nhà trường tổ chức buổi dã ngoại mùa thu tại Công viên Kasai Rinkai cho các lớp Mầm và Chồi. Trẻ sẽ tập trung tại sân trường lúc 08:45 và trở về lúc 14:30. Cha mẹ cần chuẩn bị cơm hộp (お弁当), bình nước và khăn ướt.',
        actions: [
          {
            id: 'act_1',
            todo_vi: 'Điền phiếu đồng ý tham gia dã ngoại (参加承諾書) và nộp lại cho cô giáo phụ trách lớp',
            deadline: '2026-11-02',
            completed: false,
            priority: 'high',
          },
          {
            id: 'act_2',
            todo_vi: 'Nộp tiền xe bus dã ngoại 1,200 yên (để vào phong bì có ghi tên bé)',
            deadline: '2026-11-04',
            completed: false,
            priority: 'high',
          },
          {
            id: 'act_3',
            todo_vi: 'Chuẩn bị cơm hộp không có đồ dễ thiu và dán nhãn tên vào tất cả đồ đạc',
            deadline: '2026-11-06',
            completed: true,
            priority: 'normal',
          },
        ],
        items_to_bring: [
          'Hộp cơm trưa (お弁当 - thức ăn gọn, dễ ăn)',
          'Bình nước có quai đeo (水筒)',
          'Khăn ướt / khăn tay (おしぼり)',
          'Tấm thảm trải ngồi ăn (レジャーシート)',
          'Áo mưa bộ (trong trường hợp thời tiết thay đổi)',
          'Túi nilong đựng rác cá nhân (ゴミ袋)',
        ],
        events: [
          {
            id: 'evt_1',
            title_vi: 'Dã ngoại mùa thu tại CV Kasai Rinkai (秋の遠足)',
            title_jp: '秋の遠足（葛西臨海公園）',
            date: '2026-11-06',
            time: '08:45 - 14:30',
            location: 'Công viên Kasai Rinkai, Edogawa-ku',
            description_vi: 'Tập trung tại sân trường lúc 08:45. Mang theo đồ dùng dã ngoại.',
          },
          {
            id: 'evt_2',
            title_vi: 'Hạn nộp đơn & phí dã ngoại',
            title_jp: '遠足参加費・承諾書 提出期日',
            date: '2026-11-02',
            time: '09:00',
            location: 'Phòng giáo viên Sakura',
            description_vi: 'Hạn chót nộp 1,200 yên và phiếu đồng ý.',
          },
        ],
        confidence: 0.96,
        model_used: 'claude-haiku-5-5',
        pages_count: 2,
        feedback: 'up',
        token_usage: {
          input_tokens: 1420,
          output_tokens: 410,
          estimated_cost_usd: 0.0034,
        },
      },
      {
        id: 'doc_yakusho_health',
        family_id: 'fam_tokyo_01',
        created_at: '2026-10-20T14:15:00Z',
        expire_at: expireDate,
        doc_type: 'yakusho',
        title_jp: '3歳児健康診査のご案内',
        title_vi: 'Giấy hẹn khám sức khỏe định kỳ cho trẻ 3 tuổi',
        issuer: 'Trung tâm Y tế sức khỏe Edogawa (江戸川区健康サポートセンター)',
        summary_vi: 'Thông báo khám sức khỏe và kiểm tra răng miệng định kỳ bắt buộc cho trẻ tròn 3 tuổi. Khám hoàn toàn miễn phí. Gia đình cần hoàn thành bảng khảo sát dinh dưỡng và kiểm tra thị lực tại nhà trước ngày khám.',
        actions: [
          {
            id: 'act_y1',
            todo_vi: 'Hoàn thành phiếu điều tra thói quen ăn uống & phát triển của bé (問診票)',
            deadline: '2026-11-10',
            completed: true,
            priority: 'high',
          },
          {
            id: 'act_y2',
            todo_vi: 'Lấy mẫu nước tiểu sáng sớm của bé vào lọ đi kèm trong phong bì',
            deadline: '2026-11-12',
            completed: false,
            priority: 'high',
          },
        ],
        items_to_bring: [
          'Sổ tay mẹ và bé (母子健康手帳 - Bắt buộc)',
          'Phiếu điều tra đã điền đầy đủ (問診票)',
          'Lọ đựng mẫu nước tiểu buổi sáng',
          'Khăn bông nhỏ & bàn chải đánh răng của bé',
          'Thẻ bảo hiểm y tế & Thẻ hỗ trợ chi phí y tế trẻ em (医療証)',
        ],
        events: [
          {
            id: 'evt_y1',
            title_vi: 'Khám sức khỏe trẻ 3 tuổi (3歳児健診)',
            title_jp: '3歳児健康診査',
            date: '2026-11-12',
            time: '13:00 - 14:15',
            location: 'Trung tâm Hỗ trợ Sức khỏe Edogawa (Tầng 2)',
            description_vi: 'Khám nhi khoa, thị lực, kiểm tra răng miệng và tư vấn dinh dưỡng.',
          },
        ],
        confidence: 0.94,
        model_used: 'claude-sonnet-5-5',
        pages_count: 1,
        feedback: 'up',
        disclaimer: 'Lưu ý: Giấy tờ y tế hành chính Nhật Bản. Thông tin chỉ giải thích quy trình; vui lòng xác nhận trực tiếp với Trung tâm Y tế nếu cần đổi lịch.',
        is_urgent: true,
        urgent_notified_at: '2026-10-20T14:15:30Z',
        urgent_reason: 'Phiếu khám sức khỏe và mẫu nước tiểu cần nộp đúng ngày hẹn',
        token_usage: {
          input_tokens: 1890,
          output_tokens: 580,
          estimated_cost_usd: 0.0142,
        },
      },
      {
        id: 'doc_kondate_11',
        family_id: 'fam_tokyo_01',
        created_at: '2026-10-25T11:00:00Z',
        expire_at: expireDate,
        doc_type: 'kondate',
        title_jp: '11月分 給食こんだて表',
        title_vi: 'Thực đơn cơm trưa trường học tháng 11',
        issuer: 'Ban dinh dưỡng trường mầm non Sakura',
        summary_vi: 'Bảng thực đơn hàng ngày tháng 11. Nhà trường lưu ý các món ăn có chứa thành phần dễ gây dị ứng (trứng, sữa, hải sản). Ngày 15/11 là thực đơn đặc biệt chào mừng Lễ hội 7-5-3 (Shichi-Go-San) với xôi đậu đỏ (赤飯) và súp thịt gà.',
        actions: [
          {
            id: 'act_k1',
            todo_vi: 'Kiểm tra kỹ các ngày có món chứa trứng (ngày 05/11 và 19/11) nếu bé có tiền sử dị ứng',
            deadline: '2026-11-01',
            completed: false,
            priority: 'normal',
          },
        ],
        items_to_bring: [
          'Khăn trải bàn ăn nhỏ (ランチョンマット - thay sạch mỗi ngày)',
          'Đũa hoặc thìa nĩa trong hộp có dán tên',
          'Cốc nhựa uống nước súc miệng',
        ],
        events: [
          {
            id: 'evt_k1',
            title_vi: 'Bữa trưa mừng Shichi-Go-San (七五三祝い給食)',
            title_jp: '七五三 お祝い献立',
            date: '2026-11-13',
            time: '11:45',
            location: 'Nhà trẻ Sakura',
            description_vi: 'Thực đơn lễ hội: Xôi Sekihan, cá thu nướng muối, súp gà rau củ, quýt mikan.',
          },
        ],
        confidence: 0.92,
        model_used: 'claude-haiku-5-5',
        pages_count: 1,
        feedback: null,
        token_usage: {
          input_tokens: 1150,
          output_tokens: 380,
          estimated_cost_usd: 0.0028,
        },
      },
    ];

    sampleDocs.forEach(d => this.documents.set(d.id, d));

    // Audit logs
    this.auditLogs.push(
      {
        id: 'aud_1',
        timestamp: '2026-10-01T08:00:00Z',
        admin_id: 'admin_sys',
        action: 'CREATE_INVITE_CODE',
        details: 'Tạo mã mời BETA2026 cho 20 gia đình đầu tiên (quota: 50 docs/tháng)',
      },
      {
        id: 'aud_2',
        timestamp: '2026-10-10T08:00:00Z',
        admin_id: 'admin_sys',
        action: 'CREATE_INVITE_CODE',
        details: 'Tạo mã mời TOKYO2026 (max 10 gia đình)',
      },
      {
        id: 'aud_3',
        timestamp: '2026-10-20T16:00:00Z',
        admin_id: 'admin_sys',
        action: 'AUDIT_PRIVACY_CHECK',
        details: 'Kiểm tra bảo mật: Hệ thống đảm bảo 100% không lưu trữ ảnh tài liệu và không có chế độ xem nội dung văn bản cho tài khoản admin.',
      }
    );
  }

  // Multi-tenant safe document access
  public getDocumentsByFamily(familyId: string): ExtractedDocument[] {
    const list: ExtractedDocument[] = [];
    for (const doc of this.documents.values()) {
      if (doc.family_id === familyId) {
        list.push(doc);
      }
    }
    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public getDocumentById(id: string, familyId: string): ExtractedDocument | null {
    const doc = this.documents.get(id);
    if (!doc || doc.family_id !== familyId) {
      return null; // Strict isolation
    }
    return doc;
  }

  public addDocument(doc: ExtractedDocument): void {
    this.documents.set(doc.id, doc);
    // increment family quota
    const family = this.families.get(doc.family_id);
    if (family) {
      family.quota_used += 1;
      family.last_active = new Date().toISOString();
    }
    if (doc.token_usage) {
      this.totalMonthlyCost += doc.token_usage.estimated_cost_usd;
    }
  }

  public toggleAction(docId: string, actionId: string, familyId: string): boolean {
    const doc = this.getDocumentById(docId, familyId);
    if (!doc) return false;
    const action = doc.actions.find(a => a.id === actionId);
    if (!action) return false;
    action.completed = !action.completed;
    return true;
  }

  public submitFeedback(docId: string, feedback: 'up' | 'down', familyId: string, note?: string): boolean {
    const doc = this.getDocumentById(docId, familyId);
    if (!doc) return false;
    doc.feedback = feedback;
    if (note && !doc.date_corrections) {
      doc.date_corrections = [note];
    } else if (note) {
      doc.date_corrections?.push(note);
    }
    return true;
  }

  // Urgent Reminder Feature: Toggle document urgent status and dispatch immediate LINE notification
  public toggleUrgent(docId: string, familyId: string, reason?: string): {
    success: boolean;
    is_urgent: boolean;
    notified_at?: string;
    notification_text?: string;
  } {
    const doc = this.getDocumentById(docId, familyId);
    if (!doc) return { success: false, is_urgent: false };

    doc.is_urgent = !doc.is_urgent;

    if (doc.is_urgent) {
      doc.urgent_notified_at = new Date().toISOString();
      doc.urgent_reason = reason || 'Người dùng yêu cầu nhắc hạn khẩn cấp';
      
      // Increment push messages quota used
      this.pushMessagesCount += 1;

      // Find nearest deadline
      const deadlines = doc.actions.map(a => a.deadline).filter(Boolean) as string[];
      const nearestDeadline = deadlines.length > 0 ? deadlines.sort()[0] : (doc.events[0]?.date || 'Sớm nhất');

      const notificationText = [
        `🚨 [THÔNG BÁO KHẨN CẤP / 緊急通知]`,
        `Tài liệu: ${doc.title_vi}`,
        doc.title_jp ? `🇯🇵 ${doc.title_jp}` : '',
        `🏢 Nơi gửi: ${doc.issuer}`,
        `⚠️ HẠN CHÓT GẦN NHẤT: ${nearestDeadline}`,
        '',
        `📋 Việc cần làm gấp:`,
        ...doc.actions.map(a => `• ${a.todo_vi}${a.deadline ? ` (Hạn: ${a.deadline})` : ''}`),
        doc.items_to_bring.length > 0 ? `\n🎒 Đồ cần chuẩn bị:\n${doc.items_to_bring.map(i => `• ${i}`).join('\n')}` : '',
        '',
        `📲 Đã gửi cảnh báo khẩn cấp trực tiếp tới nhóm LINE gia đình của bạn!`,
      ].filter(Boolean).join('\n');

      this.logAdminAction(
        'admin_sys',
        'URGENT_NOTIFICATION_DISPATCHED',
        `Gửi thông báo khẩn cấp cho tài liệu ${doc.id} tới gia đình ${familyId}. Hạn chót: ${nearestDeadline}.`,
        familyId
      );

      return {
        success: true,
        is_urgent: true,
        notified_at: doc.urgent_notified_at,
        notification_text: notificationText,
      };
    } else {
      doc.urgent_reason = undefined;
      return {
        success: true,
        is_urgent: false,
      };
    }
  }

  // Delete all family data (GDPR / Privacy compliance)
  public deleteAllFamilyData(familyId: string): boolean {
    const family = this.families.get(familyId);
    if (!family) return false;

    // Delete all docs
    for (const [id, doc] of this.documents.entries()) {
      if (doc.family_id === familyId) {
        this.documents.delete(id);
      }
    }

    // Reset family or mark deactivated
    family.quota_used = 0;
    family.status = 'pending_invite';
    this.logAdminAction('admin_sys', 'DELETE_FAMILY_DATA', `Người dùng yêu cầu xóa toàn bộ dữ liệu gia đình ID ${familyId}. Đã xóa sạch tài liệu và sự kiện.`);
    return true;
  }

  // Rotate secret ICS token
  public rotateIcsToken(familyId: string): string | null {
    const family = this.families.get(familyId);
    if (!family) return null;
    const newToken = `sec_token_${familyId}_${crypto.randomBytes(6).toString('hex')}`;
    family.ics_token = newToken;
    return newToken;
  }

  public getFamilyByIcsToken(token: string): Family | null {
    for (const fam of this.families.values()) {
      if (fam.ics_token === token) {
        return fam;
      }
    }
    return null;
  }

  public getFamily(familyId: string): Family | null {
    return this.families.get(familyId) || null;
  }

  public getAllFamilies(): Family[] {
    return Array.from(this.families.values());
  }

  public getInviteCodes(): InviteCode[] {
    return Array.from(this.inviteCodes.values());
  }

  public createInviteCode(code: string, quota: number = 50, maxUses: number = 20, note?: string): InviteCode {
    const newCode: InviteCode = {
      code: code.trim().toUpperCase(),
      quota_per_family: quota,
      max_uses: maxUses,
      used_count: 0,
      is_active: true,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      note: note || 'Mã mời tạo từ Admin LIFF',
    };
    this.inviteCodes.set(newCode.code, newCode);
    this.logAdminAction('admin_sys', 'CREATE_INVITE_CODE', `Tạo mã mời ${newCode.code} (max: ${maxUses}, quota: ${quota})`);
    return newCode;
  }

  public validateAndRedeemInviteCode(code: string, familyId: string): { success: boolean; message: string } {
    const codeObj = this.inviteCodes.get(code.trim().toUpperCase());
    if (!codeObj) {
      return { success: false, message: 'Mã mời không tồn tại. Vui lòng kiểm tra lại.' };
    }
    if (!codeObj.is_active) {
      return { success: false, message: 'Mã mời này đã bị tạm dừng hoặc hết hạn.' };
    }
    if (codeObj.used_count >= codeObj.max_uses) {
      return { success: false, message: 'Mã mời này đã đạt giới hạn số lượng gia đình kích hoạt.' };
    }
    if (this.families.size >= 20) {
      return { success: false, message: 'Chương trình thử nghiệm Beta đã đạt mức tối đa 20 gia đình.' };
    }

    codeObj.used_count += 1;
    let family = this.families.get(familyId);
    if (!family) {
      family = {
        family_id: familyId,
        line_chat_id: familyId,
        chat_type: 'group',
        family_name: `Gia đình ${familyId.slice(-4)}`,
        invite_code: codeObj.code,
        status: 'active',
        quota_limit: codeObj.quota_per_family,
        quota_used: 0,
        ics_token: `sec_token_${familyId}_${crypto.randomBytes(6).toString('hex')}`,
        created_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
      };
      this.families.set(familyId, family);
    } else {
      family.status = 'active';
      family.invite_code = codeObj.code;
      family.quota_limit = codeObj.quota_per_family;
    }

    this.logAdminAction('admin_sys', 'INVITE_REDEEMED', `Gia đình ${familyId} đã kích hoạt thành công mã ${codeObj.code}`);
    return { success: true, message: 'Kích hoạt thành công mã mời! Bot đã sẵn sàng nhận ảnh giấy tờ.' };
  }

  public updateFamilyQuota(familyId: string, newQuota: number): boolean {
    const family = this.families.get(familyId);
    if (!family) return false;
    family.quota_limit = newQuota;
    this.logAdminAction('admin_sys', 'UPDATE_QUOTA', `Cập nhật quota gia đình ${familyId} thành ${newQuota} docs/tháng`);
    return true;
  }

  public toggleFamilySuspension(familyId: string): boolean {
    const family = this.families.get(familyId);
    if (!family) return false;
    family.status = family.status === 'suspended' ? 'active' : 'suspended';
    this.logAdminAction('admin_sys', 'TOGGLE_SUSPEND', `Chuyển trạng thái gia đình ${familyId} sang ${family.status}`);
    return true;
  }

  public getAdminMetrics(): AdminMetrics {
    const docs = Array.from(this.documents.values());
    const docsByType: Record<DocType, number> = {
      otayori: 0,
      nenkan_yotei: 0,
      kondate: 0,
      yakusho: 0,
      form: 0,
      hospital: 0,
      kairanban: 0,
      meisai: 0,
      other: 0,
    };

    let thumbsUp = 0;
    let thumbsDown = 0;

    docs.forEach(d => {
      if (docsByType[d.doc_type] !== undefined) {
        docsByType[d.doc_type] += 1;
      } else {
        docsByType.other += 1;
      }
      if (d.feedback === 'up') thumbsUp += 1;
      if (d.feedback === 'down') thumbsDown += 1;
    });

    const ratedCount = thumbsUp + thumbsDown;
    const accuracyRate = ratedCount > 0 ? Math.round((thumbsUp / ratedCount) * 100) : 98;

    return {
      total_families: this.families.size,
      active_families: Array.from(this.families.values()).filter(f => f.status === 'active').length,
      max_beta_families: 20,
      total_documents_processed: docs.length,
      docs_by_type: docsByType,
      monthly_cost_usd: Number(this.totalMonthlyCost.toFixed(3)),
      monthly_budget_usd: 20.0,
      accuracy_rate: accuracyRate,
      thumbs_up: thumbsUp,
      thumbs_down: thumbsDown,
      push_messages_used: this.pushMessagesCount,
      push_messages_limit: 200,
      urgent_docs_count: docs.filter(d => d.is_urgent).length,
      recent_errors: [
        {
          id: 'err_1',
          timestamp: '2026-10-23T04:12:00Z',
          family_id: 'fam_saitama_02',
          error_type: 'LOW_IMAGE_RESOLUTION',
          message: 'Ảnh mờ không rõ chữ, đã tự động chuyển Sonnet giải mã và thông báo người dùng',
        },
      ],
    };
  }

  public getAuditLogs(): AuditLog[] {
    return [...this.auditLogs].reverse();
  }

  public logAdminAction(adminId: string, action: string, details: string, familyId?: string): void {
    this.auditLogs.push({
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      admin_id: adminId,
      action,
      target_family_id: familyId,
      details,
    });
  }

  // 60-second multi-page aggregation logic
  public queueImage(chatId: string, familyId: string, imageUrl: string, imageName?: string, onBatchReady?: (images: Array<{ url: string; name?: string }>) => void) {
    let existing = this.imageAggregationBuffer.get(chatId);
    if (!existing) {
      existing = {
        family_id: familyId,
        chat_id: chatId,
        images: [],
        timer: null,
      };
      this.imageAggregationBuffer.set(chatId, existing);
    }

    if (existing.timer) {
      clearTimeout(existing.timer);
    }

    existing.images.push({ url: imageUrl, timestamp: Date.now(), name: imageName });

    // Set 60-second aggregation window (in interactive simulation we can also trigger manually or after 4 seconds)
    existing.timer = setTimeout(() => {
      const batch = existing?.images || [];
      this.imageAggregationBuffer.delete(chatId);
      if (onBatchReady && batch.length > 0) {
        onBatchReady(batch);
      }
    }, 60000);

    return existing.images.length;
  }
}

export const store = new AppDataStore();
