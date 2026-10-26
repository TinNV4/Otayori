import crypto from 'crypto';
import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { store } from './src/server/store.ts';
import { generateIcsCalendar } from './src/server/ics.ts';
import {
  processDocumentPipeline,
  formatLineDocumentReply,
  composeJapaneseRenraku,
} from './src/server/pipeline.ts';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'dev_line_channel_secret_beta2026';
const LINE_ADMIN_USER_ID = process.env.LINE_ADMIN_USER_ID || 'U_admin_beta_tester';

// Capture raw body for LINE signature verification
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
    limit: '25mb',
  })
);
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

/**
 * Verify LINE webhook signature using HMAC-SHA256
 */
function verifyLineSignature(signature: string | undefined, rawBody: Buffer | undefined): boolean {
  if (!signature || !rawBody) return false;
  // If in dev simulation mode and signature is 'dev_simulated_sig', allow
  if (signature === 'dev_simulated_sig') return true;
  try {
    const hash = crypto
      .createHmac('SHA256', LINE_CHANNEL_SECRET)
      .update(rawBody)
      .digest('base64');
    return hash === signature;
  } catch (err) {
    console.error('Signature verification error:', err);
    return false;
  }
}

// ----------------------------------------------------
// 1. ICS Calendar Endpoint (/ics/:token.ics)
// ----------------------------------------------------
app.get('/ics/:token.ics', (req: Request, res: Response) => {
  const token = req.params.token;
  const family = store.getFamilyByIcsToken(token);

  if (!family) {
    res.status(404).send('Calendar not found or token expired.');
    return;
  }

  const documents = store.getDocumentsByFamily(family.family_id);
  const icsData = generateIcsCalendar(family, documents);

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="giaytonhat_${family.family_id}.ics"`);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).send(icsData);
});

// ----------------------------------------------------
// 2. LINE Webhook Endpoint (/api/line/webhook)
// ----------------------------------------------------
app.post('/api/line/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['x-line-signature'] as string;
  const rawBody = (req as any).rawBody;

  if (process.env.NODE_ENV === 'production' && !verifyLineSignature(signature, rawBody)) {
    res.status(403).json({ error: 'Invalid LINE signature' });
    return;
  }

  const events = req.body?.events || [];
  const replies: any[] = [];

  for (const event of events) {
    const source = event.source || {};
    const chatId = source.groupId || source.roomId || source.userId || 'unknown_chat';
    const familyId = source.groupId ? `fam_${source.groupId.slice(-8)}` : `fam_${source.userId?.slice(-8) || 'single'}`;
    const family = store.getFamily(familyId);

    // Event 1: Join group or Follow (Add friend)
    if (event.type === 'join' || event.type === 'follow') {
      const greetingText =
        `👋 Chào mừng gia đình bạn đến với Trợ lý Giấy Tờ Nhật (Bản Beta)!\n\n` +
        `Tôi giúp các gia đình Việt tại Nhật dịch nhanh お便り, giấy tờ 役所, tự động nhắc việc và đồng bộ hạn chót vào lịch điện thoại.\n\n` +
        `📋 Để bắt đầu:\n` +
        `1. Vui lòng đọc Chính sách bảo mật: /privacy\n` +
        `2. Nhập Mã mời thử nghiệm của gia đình bạn (ví dụ: BETA2026).\n\n` +
        `Sau khi kích hoạt mã mời, bạn chỉ cần chụp và gửi ảnh giấy tờ vào nhóm, bot sẽ tự động phân tích!`;

      replies.push({
        type: 'text',
        text: greetingText,
        quickReply: {
          items: [
            {
              type: 'action',
              action: {
                type: 'message',
                label: '✅ Đồng ý điều khoản',
                text: 'Đồng ý điều khoản',
              },
            },
            {
              type: 'action',
              action: {
                type: 'message',
                label: '❌ Từ chối',
                text: 'Từ chối',
              },
            },
          ],
        },
      });
      continue;
    }

    // Event 2: Text message commands
    if (event.type === 'message' && event.message?.type === 'text') {
      const text = (event.message.text || '').trim();

      // Check /whoami
      if (text.toLowerCase() === '/whoami') {
        const isAdmin = source.userId === LINE_ADMIN_USER_ID;
        replies.push({
          type: 'text',
          text: `🆔 Thông tin LINE ID của bạn:\n• User ID: ${source.userId || 'N/A'}\n• Chat/Group ID: ${chatId}\n• Vai trò: ${isAdmin ? '👑 Quản trị viên (Admin)' : 'Gia đình tham gia'}`,
        });
        continue;
      }

      // Check /soan (Renrakucho composer)
      if (text.startsWith('/soạn') || text.startsWith('/soan')) {
        const promptText = text.replace(/^\/(soạn|soan)\s*/, '').trim();
        if (!promptText) {
          replies.push({
            type: 'text',
            text: '💡 Hướng dẫn soạn tin liên lạc tiếng Nhật:\nGõ: /soạn <nội dung tiếng Việt>\nVí dụ: /soạn Sáng nay con bị sốt 38.5 độ xin phép cho con nghỉ học hôm nay',
          });
          continue;
        }

        const composed = await composeJapaneseRenraku({
          topic: 'absence',
          content_vi: promptText,
          child_name: 'bé',
        });

        replies.push({
          type: 'text',
          text:
            `📝 [BẢN SOẠN TIN LIÊN LẠC TIẾNG NHẬT]\n\n` +
            `🇯🇵 Bản tiếng Nhật gửi cô giáo:\n${composed.japanese_text}\n\n` +
            `🇻🇳 ${composed.vietnamese_back_translation}\n\n` +
            `💡 Lưu ý: ${composed.etiquette_tips}`,
        });
        continue;
      }

      // Check "xóa dữ liệu" command
      if (text.toLowerCase() === 'xóa dữ liệu' || text.toLowerCase() === 'xoa du lieu') {
        replies.push({
          type: 'text',
          text: `⚠️ CẢNH BÁO: Bạn có chắc chắn muốn xóa TOÀN BỘ dữ liệu của gia đình mình không?\nThao tác này sẽ xóa sạch tài liệu, việc cần làm, sự kiện và vô hiệu hóa link lịch ICS ngay lập tức.`,
          quickReply: {
            items: [
              {
                type: 'action',
                action: {
                  type: 'message',
                  label: '🗑️ Xác nhận xóa ngay',
                  text: 'XÁC NHẬN XÓA TẤT CẢ DỮ LIỆU',
                },
              },
              {
                type: 'action',
                action: {
                  type: 'message',
                  label: '❌ Hủy bỏ',
                  text: 'Hủy xóa dữ liệu',
                },
              },
            ],
          },
        });
        continue;
      }

      // Confirmed delete
      if (text === 'XÁC NHẬN XÓA TẤT CẢ DỮ LIỆU') {
        store.deleteAllFamilyData(familyId);
        replies.push({
          type: 'text',
          text: `✅ Đã xóa toàn bộ dữ liệu của gia đình khỏi hệ thống theo chính sách bảo mật riêng tư. Để sử dụng lại trong tương lai, vui lòng nhập lại mã mời.`,
        });
        continue;
      }

      // Check Terms consent
      if (text === 'Đồng ý điều khoản') {
        replies.push({
          type: 'text',
          text: `Cảm ơn bạn đã đồng ý điều khoản bảo mật. Bây giờ vui lòng nhập Mã mời thử nghiệm Beta (ví dụ: BETA2026) để kích hoạt.`,
        });
        continue;
      }

      // Check Invite Code entry
      const inviteMatch = text.match(/^(?:mã\s*(?:mời)?[:\s]*)?([A-Z0-9]{4,12})$/i);
      if (inviteMatch) {
        const code = inviteMatch[1].toUpperCase();
        const resRedeem = store.validateAndRedeemInviteCode(code, familyId);
        replies.push({
          type: 'text',
          text: resRedeem.success
            ? `🎉 ${resRedeem.message}\n• Quota gia đình: 50 giấy tờ/tháng\n• Để đồng bộ lịch: Mở LIFF mini-app hoặc gõ /lich`
            : `⚠️ ${resRedeem.message}`,
        });
        continue;
      }
    }

    // Event 3: Image / Document event
    if (event.type === 'message' && event.message?.type === 'image') {
      if (!family || family.status !== 'active') {
        replies.push({
          type: 'text',
          text:
            `⚠️ Bot chưa thể xử lý ảnh do gia đình chưa kích hoạt mã mời hoặc chưa đồng ý điều khoản bảo mật.\n\n` +
            `Vui lòng nhập mã mời (ví dụ: BETA2026) hoặc bấm Đồng ý điều khoản.`,
        });
        continue;
      }

      if (family.quota_used >= family.quota_limit) {
        replies.push({
          type: 'text',
          text: `⚠️ Gia đình bạn đã đạt hạn mức ${family.quota_limit} giấy tờ trong tháng này. Quota sẽ tự động đặt lại vào ngày mùng 1 tháng sau.`,
        });
        continue;
      }

      // Process image
      const extracted = await processDocumentPipeline(familyId, {
        presetId: 'preschool_otayori',
        pageCount: 1,
      });

      store.addDocument(extracted);
      const replyBubble = formatLineDocumentReply(extracted);

      replies.push({
        type: 'text',
        text: replyBubble,
        quickReply: {
          items: [
            {
              type: 'action',
              action: {
                type: 'message',
                label: '👍 Đúng',
                text: `FEEDBACK_UP_${extracted.id}`,
              },
            },
            {
              type: 'action',
              action: {
                type: 'message',
                label: '👎 Sai',
                text: `FEEDBACK_DOWN_${extracted.id}`,
              },
            },
            {
              type: 'action',
              action: {
                type: 'message',
                label: '✏️ Sửa ngày',
                text: `EDIT_DATE_${extracted.id}`,
              },
            },
          ],
        },
      });
    }
  }

  res.status(200).json({ status: 'ok', replies_count: replies.length, replies });
});

// ----------------------------------------------------
// 3. User LIFF API Endpoints
// ----------------------------------------------------
app.get('/api/family', (req: Request, res: Response) => {
  const familyId = (req.query.familyId as string) || 'fam_tokyo_01';
  const family = store.getFamily(familyId);
  if (!family) {
    res.status(404).json({ error: 'Family not found' });
    return;
  }
  res.json({ family });
});

app.get('/api/documents', (req: Request, res: Response) => {
  const familyId = (req.query.familyId as string) || 'fam_tokyo_01';
  const docs = store.getDocumentsByFamily(familyId);
  res.json({ documents: docs });
});

app.post('/api/documents/:id/action-toggle', (req: Request, res: Response) => {
  const familyId = (req.body.familyId as string) || 'fam_tokyo_01';
  const docId = req.params.id;
  const actionId = req.body.actionId;

  const ok = store.toggleAction(docId, actionId, familyId);
  res.json({ success: ok });
});

app.post('/api/documents/:id/feedback', (req: Request, res: Response) => {
  const familyId = (req.body.familyId as string) || 'fam_tokyo_01';
  const docId = req.params.id;
  const feedback = req.body.feedback as 'up' | 'down';
  const note = req.body.note;

  const ok = store.submitFeedback(docId, feedback, familyId, note);
  res.json({ success: ok });
});

app.post('/api/family/delete-all', (req: Request, res: Response) => {
  const familyId = (req.body.familyId as string) || 'fam_tokyo_01';
  const ok = store.deleteAllFamilyData(familyId);
  res.json({ success: ok });
});

app.post('/api/family/ics-token/rotate', (req: Request, res: Response) => {
  const familyId = (req.body.familyId as string) || 'fam_tokyo_01';
  const newToken = store.rotateIcsToken(familyId);
  res.json({ success: !!newToken, ics_token: newToken });
});

app.post('/api/onboarding/verify-code', (req: Request, res: Response) => {
  const { code, familyId } = req.body;
  const result = store.validateAndRedeemInviteCode(code, familyId || 'fam_tokyo_01');
  res.json(result);
});

app.post('/api/compose-renraku', async (req: Request, res: Response) => {
  const { topic, content_vi, child_name, class_name } = req.body;
  const result = await composeJapaneseRenraku({ topic, content_vi, child_name, class_name });
  res.json(result);
});

app.post('/api/documents/:id/toggle-urgent', (req: Request, res: Response) => {
  const familyId = (req.body.familyId as string) || 'fam_tokyo_01';
  const docId = req.params.id;
  const reason = req.body.reason;

  const result = store.toggleUrgent(docId, familyId, reason);
  res.json(result);
});

// Interactive Simulator Webhook runner
app.post('/api/simulate/process-document', async (req: Request, res: Response) => {
  const { familyId = 'fam_tokyo_01', presetId, imageBase64, textSnippet, pageCount = 1, isUrgent = false } = req.body;
  const extracted = await processDocumentPipeline(familyId, { presetId, imageBase64, textSnippet, pageCount });
  
  if (isUrgent) {
    extracted.is_urgent = true;
    extracted.urgent_notified_at = new Date().toISOString();
    extracted.urgent_reason = 'Yêu cầu xử lý khẩn cấp & gửi nhắc hạn ngay lập tức';
  }

  store.addDocument(extracted);
  const formattedLineReply = formatLineDocumentReply(extracted);

  let urgentPushMessage: string | null = null;
  if (isUrgent) {
    const deadlines = extracted.actions.map(a => a.deadline).filter(Boolean);
    const nearestDeadline = deadlines.length > 0 ? deadlines.sort()[0] : 'Sớm nhất';
    urgentPushMessage = 
      `🚨 [THÔNG BÁO KHẨN CẤP / 緊急通知]\n` +
      `Giấy tờ đã được ưu tiên xử lý hoàn tất ngay lập tức!\n` +
      `📌 ${extracted.title_vi}\n` +
      `🏢 Nơi phát hành: ${extracted.issuer}\n` +
      `⚠️ HẠN CHÓT GẤP: ${nearestDeadline}\n\n` +
      `✅ Việc cần làm ngay:\n` +
      extracted.actions.map(a => `• ${a.todo_vi}${a.deadline ? ` (Hạn: ${a.deadline})` : ''}`).join('\n') +
      `\n\n📲 Đã đồng bộ cảnh báo vào ứng dụng Lịch (VALARM) và kích hoạt nhắc khẩn cấp!`;
  }

  res.json({
    document: extracted,
    line_message: formattedLineReply,
    urgent_push_message: urgentPushMessage,
  });
});

// ----------------------------------------------------
// 4. Admin LIFF Endpoints (Strictly Zero Document Text)
// ----------------------------------------------------
app.get('/api/admin/metrics', (_req: Request, res: Response) => {
  const metrics = store.getAdminMetrics();
  res.json({ metrics });
});

app.get('/api/admin/families', (_req: Request, res: Response) => {
  const families = store.getAllFamilies();
  // Return metadata only, zero document texts
  res.json({ families });
});

app.get('/api/admin/invite-codes', (_req: Request, res: Response) => {
  const codes = store.getInviteCodes();
  res.json({ invite_codes: codes });
});

app.post('/api/admin/invite-codes', (req: Request, res: Response) => {
  const { code, quota = 50, maxUses = 20, note } = req.body;
  if (!code) {
    res.status(400).json({ error: 'Code is required' });
    return;
  }
  const created = store.createInviteCode(code, quota, maxUses, note);
  res.json({ invite_code: created });
});

app.post('/api/admin/quota', (req: Request, res: Response) => {
  const { familyId, newQuota } = req.body;
  const ok = store.updateFamilyQuota(familyId, newQuota);
  res.json({ success: ok });
});

app.post('/api/admin/suspend', (req: Request, res: Response) => {
  const { familyId } = req.body;
  const ok = store.toggleFamilySuspension(familyId);
  res.json({ success: ok });
});

app.get('/api/admin/audit-logs', (_req: Request, res: Response) => {
  const logs = store.getAuditLogs();
  res.json({ audit_logs: logs });
});

// Mount Vite or static server
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => {
      res.sendFile('dist/index.html', { root: '.' });
    });
  } else {
    // In dev, mount Vite middleware so React runs on same port 3000
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [Giấy Tờ Nhật] Fullstack Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
