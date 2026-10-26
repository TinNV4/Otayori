import { AppConfig } from './config.ts';
import { Repo } from './db/repo.ts';
import {
  ExtractionError, Extractor, MAX_IMAGE_BYTES, MAX_PDF_BYTES, Page, SONNET_MODEL, SUPPORTED_IMAGE_TYPES, toDocument,
} from './extract.ts';
import { Composer } from './renraku.ts';
import { LineApi, LineMessage, text } from './line.ts';
import { PageAggregator, PageBatch } from './aggregator.ts';
import { familyIdForChat, icsUrl, liffUrl, newFamily, normalizeCode, rollQuotaMonth, Services } from './service.ts';
import { jstDate, jstMonth } from './time.ts';
import { ExtractedDocument, Family } from '../types/index.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type LineEvent = any;

const MODEL_LABEL: Record<string, string> = {
  'claude-haiku-5-5': 'Haiku',
  'claude-sonnet-5-5': 'Sonnet (giấy quan trọng)',
  mock: 'Mock',
};

const DELETE_CONFIRM_MINUTES = 5;

/** Strip Vietnamese diacritics + lowercase, for forgiving command matching. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}

function chatOf(source: any): { chatId: string; chatType: Family['chat_type'] } | null {
  if (source?.groupId) return { chatId: source.groupId, chatType: 'group' };
  if (source?.roomId) return { chatId: source.roomId, chatType: 'room' };
  if (source?.userId) return { chatId: source.userId, chatType: 'user' };
  return null;
}

export function formatDocumentReply(doc: ExtractedDocument): string {
  const p: string[] = [];
  p.push(`📄 ${doc.title_vi}`);
  if (doc.title_jp) p.push(`🇯🇵 ${doc.title_jp}`);
  if (doc.issuer) p.push(`🏢 ${doc.issuer}`);
  p.push('', doc.summary_vi);

  if (doc.actions.length) {
    p.push('', '✅ Cần làm:');
    for (const a of doc.actions) {
      const dl = a.deadline ? ` — hạn ${a.deadline}${a.deadline_uncertain ? ' (?)' : ''}` : '';
      p.push(`• ${a.todo_vi}${dl}`);
    }
  }
  if (doc.items_to_bring.length) {
    p.push('', '🎒 Cần chuẩn bị:');
    doc.items_to_bring.forEach(i => p.push(`• ${i}`));
  }
  if (doc.events.length) {
    p.push('', '📅 Đã thêm vào lịch gia đình:');
    for (const e of doc.events) {
      p.push(`• ${e.date}${e.date_uncertain ? ' (?)' : ''}${e.time ? ` ${e.time}` : ''}: ${e.title_vi}${e.location ? ` @ ${e.location}` : ''}`);
    }
  }
  const warnings = [...(doc.warnings_vi || [])];
  if (doc.confidence < 0.7) warnings.unshift('Độ tin cậy thấp — hãy đối chiếu với giấy gốc.');
  if ([...doc.actions.map(a => a.deadline_uncertain), ...doc.events.map(e => e.date_uncertain)].some(Boolean)) {
    warnings.push('Ngày có dấu (?) là suy đoán — vui lòng kiểm tra lại.');
  }
  if (warnings.length) p.push('', ...warnings.map(w => `⚠️ ${w}`));
  if (doc.disclaimer) p.push('', `ℹ️ ${doc.disclaimer}`);
  p.push('', `🤖 ${MODEL_LABEL[doc.model_used] || doc.model_used} · tin cậy ${Math.round(doc.confidence * 100)}% · ${doc.pages_count} trang`);
  return p.join('\n');
}

export interface BotDeps {
  repo: Repo;
  line: LineApi;
  extractor: Extractor;
  composer: Composer;
  cfg: AppConfig;
  now?: () => Date;
}

export class Bot {
  readonly services: Services;
  readonly aggregator: PageAggregator;
  private seenEvents: string[] = [];
  private repo: Repo;
  private line: LineApi;
  private cfg: AppConfig;
  private now: () => Date;

  constructor(private readonly deps: BotDeps) {
    this.repo = deps.repo;
    this.line = deps.line;
    this.cfg = deps.cfg;
    this.now = deps.now || (() => new Date());
    this.services = new Services(deps.repo, deps.cfg);
    this.aggregator = new PageAggregator(deps.cfg.aggregationWindowMs, deps.cfg.maxPagesPerDoc, b => this.processBatch(b));
  }

  /** Process a verified webhook payload. Errors per event are isolated. */
  async handleWebhook(body: { events?: LineEvent[] }) {
    for (const ev of body.events || []) {
      if (ev.webhookEventId) {
        if (this.seenEvents.includes(ev.webhookEventId)) continue;
        this.seenEvents.push(ev.webhookEventId);
        if (this.seenEvents.length > 2000) this.seenEvents.splice(0, 1000);
      }
      try {
        await this.handleEvent(ev);
      } catch (err) {
        const chat = chatOf(ev.source);
        await this.services.logError(chat ? familyIdForChat(chat.chatId) : 'unknown', 'EVENT_HANDLER', String((err as Error)?.message || err));
      }
    }
  }

  private async reply(ev: LineEvent, messages: LineMessage[]) {
    if (!ev.replyToken) return;
    await this.line.reply(ev.replyToken, messages);
  }

  private async loadFamily(chatId: string, chatType: Family['chat_type'], userId?: string): Promise<Family> {
    const now = this.now();
    let family = await this.repo.getFamily(familyIdForChat(chatId));
    let dirty = false;
    if (!family) {
      family = newFamily(chatId, chatType, this.cfg, now);
      dirty = true;
    }
    if (rollQuotaMonth(family, now)) dirty = true;
    if (userId && !family.member_user_ids.includes(userId)) {
      family.member_user_ids = [...family.member_user_ids, userId].slice(-50);
      dirty = true;
    }
    if (dirty) await this.repo.saveFamily(family);
    return family;
  }

  async handleEvent(ev: LineEvent) {
    const chat = chatOf(ev.source);
    if (!chat) return;
    const userId: string | undefined = ev.source?.userId;

    switch (ev.type) {
      case 'join':
      case 'follow':
        return this.onJoin(ev, chat.chatId, chat.chatType);
      case 'leave':
      case 'unfollow':
        return this.onLeave(chat.chatId);
      case 'memberJoined': {
        const family = await this.repo.getFamily(familyIdForChat(chat.chatId));
        if (!family) return;
        const ids: string[] = (ev.joined?.members || []).map((m: { userId?: string }) => m.userId).filter(Boolean);
        family.member_user_ids = [...new Set([...family.member_user_ids, ...ids])].slice(-50);
        return this.repo.saveFamily(family);
      }
      case 'postback':
        return this.onPostback(ev, await this.loadFamily(chat.chatId, chat.chatType, userId), userId);
      case 'message': {
        const family = await this.loadFamily(chat.chatId, chat.chatType, userId);
        const type = ev.message?.type;
        if (type === 'text') return this.onText(ev, family, userId);
        if (type === 'image' || type === 'file') return this.onMedia(ev, family, userId);
        return;
      }
      default:
        return;
    }
  }

  private welcome(family: Family): LineMessage {
    const privacy = `${this.cfg.publicBaseUrl}/?tab=privacy`;
    return text(
      '👋 Xin chào! Mình là Trợ lý giấy tờ Nhật (bản Beta).\n\n' +
        'Chụp ảnh お便り, giấy 役所, form… gửi vào nhóm, mình sẽ trả lời bằng tiếng Việt: giấy này là gì, cần làm gì, hạn khi nào, cần chuẩn bị gì. Các hạn và sự kiện tự vào lịch điện thoại của gia đình.\n\n' +
        '🔒 Ảnh không được lưu. Nội dung đã đọc tự xóa sau ' + this.cfg.retentionDays + ' ngày. Có thể xóa hết bất cứ lúc nào bằng lệnh "xóa dữ liệu".\n' +
        `Chi tiết: ${privacy}\n\n` +
        (family.status === 'pending_terms'
          ? 'Bước 1: bấm "Đồng ý" bên dưới.\nBước 2: gửi mã mời của gia đình (ví dụ: BETA2026).'
          : 'Gửi mã mời để kích hoạt.'),
      family.status === 'pending_terms' ? [{ label: '✅ Đồng ý', data: 'action=accept_terms', text: 'Đồng ý điều khoản' }] : undefined,
    );
  }

  private async onJoin(ev: LineEvent, chatId: string, chatType: Family['chat_type']) {
    const family = await this.loadFamily(chatId, chatType);
    if (family.status === 'left') {
      // Rejoined within the grace period: keep data.
      family.status = family.invite_code && family.terms_accepted_at ? 'active' : family.terms_accepted_at ? 'pending_invite' : 'pending_terms';
      family.left_at = undefined;
      await this.repo.saveFamily(family);
    }
    if (chatType === 'group') {
      const n = await this.line.getGroupMemberCount(chatId).catch(() => null);
      if (n) { family.members_count = n; await this.repo.saveFamily(family); }
    }
    if (family.status === 'active') return this.reply(ev, [text('👋 Mình đã quay lại! Gửi ảnh giấy tờ bất cứ lúc nào nhé.')]);
    return this.reply(ev, [this.welcome(family)]);
  }

  private async onLeave(chatId: string) {
    const family = await this.repo.getFamily(familyIdForChat(chatId));
    if (!family) return;
    family.status = 'left';
    family.left_at = this.now().toISOString();
    await this.repo.saveFamily(family);
    await this.services.audit('system', 'BOT_LEFT', `Bot rời nhóm — dữ liệu sẽ bị xóa sau ${this.cfg.leftGroupPurgeDays} ngày`, family.family_id);
  }

  private async acceptTerms(ev: LineEvent, family: Family) {
    if (family.status === 'pending_terms') {
      family.status = family.invite_code ? 'active' : 'pending_invite';
      family.terms_accepted_at = this.now().toISOString();
      await this.repo.saveFamily(family);
    }
    if (family.status === 'active') return this.reply(ev, [text('✅ Gia đình đã kích hoạt. Gửi ảnh giấy tờ để bắt đầu!')]);
    return this.reply(ev, [text('Cảm ơn bạn đã đồng ý ✅\nBây giờ hãy gửi mã mời của gia đình (ví dụ: BETA2026).')]);
  }

  private async redeem(ev: LineEvent, family: Family, rawCode: string, userId?: string) {
    const code = normalizeCode(rawCode);
    if (family.status === 'pending_terms') {
      return this.reply(ev, [text('Vui lòng bấm "Đồng ý" điều khoản trước khi nhập mã mời.', [{ label: '✅ Đồng ý', data: 'action=accept_terms', text: 'Đồng ý điều khoản' }])]);
    }
    const res = await this.repo.redeemInviteCode(code, family.family_id, this.cfg.maxBetaFamilies, this.now());
    if (!res.ok) {
      const msg = {
        not_found: 'Mã mời không đúng. Vui lòng kiểm tra lại.',
        inactive: 'Mã mời này đã bị tạm dừng.',
        expired: 'Mã mời này đã hết hạn.',
        exhausted: 'Mã mời này đã hết lượt sử dụng.',
        beta_full: `Bản Beta đã đủ ${this.cfg.maxBetaFamilies} gia đình. Mình sẽ báo khi có chỗ trống.`,
      }[res.reason];
      return this.reply(ev, [text(`⚠️ ${msg}`)]);
    }
    family.status = 'active';
    family.invite_code = res.invite.code;
    family.quota_limit = res.invite.quota_per_family;
    await this.repo.saveFamily(family);
    await this.services.audit(userId || 'user', 'INVITE_REDEEMED', `Kích hoạt mã ${res.invite.code}`, family.family_id);
    return this.reply(ev, [
      text(
        `🎉 Kích hoạt thành công! Hạn mức: ${family.quota_limit} giấy/tháng.\n\n` +
          '📸 Cách dùng: chụp rõ cả trang giấy, gửi vào đây. Giấy nhiều trang thì gửi liên tiếp, mình sẽ gộp lại.\n' +
          '📅 Gõ "lịch" để lấy link thêm vào lịch điện thoại.\n' +
          '❓ Gõ "hướng dẫn" để xem các lệnh.',
      ),
    ]);
  }

  private calendarMessage(family: Family): LineMessage {
    const url = icsUrl(this.cfg, family);
    const liff = liffUrl(this.cfg, { tab: 'calendar' });
    return text(
      '📅 Link lịch bí mật của gia đình (đừng chia sẻ ra ngoài):\n' + url + '\n\n' +
        '• iPhone: Cài đặt → Lịch → Tài khoản → Thêm tài khoản → Khác → Thêm lịch đã đăng ký → dán link.\n' +
        '• Google Calendar (máy tính): calendar.google.com → Lịch khác (+) → Từ URL → dán link.\n' +
        'Lịch tự cập nhật mỗi khi có giấy mới. iPhone sẽ nhắc trước 1 ngày; Google dùng cài đặt nhắc mặc định của bạn.' +
        (liff ? `\n\nHoặc mở trang gia đình: ${liff}` : ''),
    );
  }

  private helpMessage(): LineMessage {
    return text(
      '❓ Hướng dẫn\n' +
        '• Gửi ảnh/PDF giấy tờ → mình đọc và tóm tắt\n' +
        '• "lịch" → link lịch gia đình\n' +
        '• "trạng thái" → hạn mức tháng này\n' +
        '• "/soạn <nội dung>" → soạn tin nhắn tiếng Nhật gửi cô giáo\n' +
        '  Ví dụ: /soạn Hôm nay bé bị sốt xin nghỉ học\n' +
        '• "xóa dữ liệu" → xóa toàn bộ dữ liệu gia đình',
    );
  }

  private async onText(ev: LineEvent, family: Family, userId?: string) {
    const raw: string = (ev.message.text || '').trim();
    const t = fold(raw);

    if (t === '/whoami') {
      return this.reply(ev, [text(`🆔 userId: ${userId || 'N/A'}\nfamily: ${family.family_id}`)]);
    }
    if (t === 'dong y dieu khoan' || t === 'dong y') return this.acceptTerms(ev, family);
    if (['huong dan', '/huongdan', '/help', 'help', '/start'].includes(t)) return this.reply(ev, [this.helpMessage()]);
    if (t === 'xoa du lieu' || t === '/xoa') {
      family.pending_delete_until = new Date(this.now().getTime() + DELETE_CONFIRM_MINUTES * 60_000).toISOString();
      await this.repo.saveFamily(family);
      return this.reply(ev, [text(
        `⚠️ Xóa TOÀN BỘ dữ liệu gia đình (giấy tờ, việc cần làm, lịch) và vô hiệu link lịch hiện tại?\nKhông thể hoàn tác. Xác nhận trong ${DELETE_CONFIRM_MINUTES} phút.`,
        [{ label: '🗑️ Xóa ngay', data: 'action=delete_confirm', text: 'Xác nhận xóa dữ liệu' }, { label: 'Hủy', data: 'action=delete_cancel', text: 'Hủy' }],
      )]);
    }
    if (t === 'xac nhan xoa du lieu' || t === 'xac nhan xoa tat ca du lieu') return this.confirmDelete(ev, family, userId);

    // Activation flow: only consider invite codes while not active, so normal chat isn't intercepted.
    if (family.status === 'pending_terms' || family.status === 'pending_invite') {
      const m = raw.match(/^(?:m[aã]\s*(?:m[oờ]i)?\s*[:：]?\s*)?([A-Za-z0-9-]{4,16})$/i);
      if (m) return this.redeem(ev, family, m[1], userId);
      if (family.chat_type === 'user') return this.reply(ev, [this.welcome(family)]);
      return;
    }
    if (family.status === 'suspended') {
      if (family.chat_type === 'user' || t.startsWith('/')) return this.reply(ev, [text('⏸️ Tài khoản gia đình đang tạm dừng. Vui lòng liên hệ quản trị viên.')]);
      return;
    }

    if (t === 'lich' || t === '/lich') return this.reply(ev, [this.calendarMessage(family)]);
    if (t === 'trang thai' || t === '/trangthai') {
      return this.reply(ev, [text(`📊 Tháng ${family.quota_month}: đã dùng ${family.quota_used}/${family.quota_limit} giấy.\nMã mời: ${family.invite_code}`)]);
    }
    if (t.startsWith('/soan')) return this.compose(ev, family, raw.replace(/^\/\S+\s*/, ''));

    // Unknown text: stay quiet in groups; hint in 1:1.
    if (family.chat_type === 'user') return this.reply(ev, [text('Gửi ảnh giấy tờ để mình đọc, hoặc gõ "hướng dẫn".')]);
  }

  private async confirmDelete(ev: LineEvent, family: Family, userId?: string) {
    if (!family.pending_delete_until || Date.parse(family.pending_delete_until) < this.now().getTime()) {
      return this.reply(ev, [text('Yêu cầu xóa đã hết hạn. Gõ "xóa dữ liệu" để bắt đầu lại.')]);
    }
    const n = await this.services.purgeFamilyData(family.family_id, userId || 'user');
    return this.reply(ev, [text(`✅ Đã xóa ${n} giấy tờ và vô hiệu link lịch cũ.\nNếu muốn dùng lại: bấm Đồng ý và nhập lại mã mời.`,
      [{ label: '✅ Đồng ý', data: 'action=accept_terms', text: 'Đồng ý điều khoản' }])]);
  }

  private async compose(ev: LineEvent, family: Family, content: string) {
    if (!content) {
      return this.reply(ev, [text('Gõ: /soạn <nội dung tiếng Việt>\nVí dụ: /soạn Sáng nay con sốt 38.5 độ, xin cho con nghỉ học hôm nay')]);
    }
    if (!(await this.withinBudget())) return this.reply(ev, [text('⚠️ Hệ thống tạm dừng do đã hết ngân sách tháng này. Xin lỗi gia đình!')]);
    const { result, cost_usd } = await this.deps.composer.compose({ topic: 'general', content_vi: content });
    await this.repo.addUsage(jstMonth(this.now()), { cost_usd });
    return this.reply(ev, [
      text(result.japanese_text),
      text(
        `🇻🇳 ${result.vietnamese_back_translation}` +
          (result.furigana_notes ? `\n\n🔤 ${result.furigana_notes}` : '') +
          (result.etiquette_tips ? `\n\n💡 ${result.etiquette_tips}` : '') +
          '\n\n👆 Tin trên là bản tiếng Nhật — giữ để sao chép gửi cô giáo.',
      ),
    ]);
  }

  private async onPostback(ev: LineEvent, family: Family, userId?: string) {
    const params = new URLSearchParams(ev.postback?.data || '');
    const action = params.get('action');
    if (action === 'accept_terms') return this.acceptTerms(ev, family);
    if (action === 'delete_confirm') return this.confirmDelete(ev, family, userId);
    if (action === 'delete_cancel') {
      family.pending_delete_until = undefined;
      await this.repo.saveFamily(family);
      return this.reply(ev, [text('Đã hủy. Dữ liệu được giữ nguyên.')]);
    }
    if (action === 'calendar' && family.status === 'active') return this.reply(ev, [this.calendarMessage(family)]);
    if (action === 'fb') {
      const doc = await this.repo.getDocument(family.family_id, params.get('doc') || '');
      const v = params.get('v');
      if (!doc || (v !== 'up' && v !== 'down')) return;
      doc.feedback = v;
      await this.repo.saveDocument(doc);
      if (v === 'up') return this.reply(ev, [text('Cảm ơn bạn! 🙏')]);
      const edit = liffUrl(this.cfg, { doc: doc.id });
      return this.reply(ev, [text(
        'Cảm ơn đã báo sai 🙏 Bạn có thể sửa ngày/việc cần làm trong trang gia đình' + (edit ? `:\n${edit}` : '.') +
          '\nMẹo: chụp thẳng, đủ sáng, không bị cắt mép giấy sẽ giúp đọc chính xác hơn.',
      )]);
    }
  }

  private async withinBudget(): Promise<boolean> {
    const usage = await this.repo.getUsage(jstMonth(this.now()));
    return usage.cost_usd < this.cfg.monthlyBudgetUsd;
  }

  /** Gate shared by intake and processing. Returns an error message or null. */
  private async intakeBlocker(family: Family): Promise<string | null> {
    if (family.status === 'pending_terms' || family.status === 'pending_invite') {
      return '⚠️ Gia đình chưa kích hoạt. Bấm "Đồng ý" điều khoản và gửi mã mời (ví dụ: BETA2026) trước nhé.';
    }
    if (family.status !== 'active') return '⏸️ Tài khoản gia đình đang tạm dừng. Vui lòng liên hệ quản trị viên.';
    if (family.quota_used >= family.quota_limit) {
      return `⚠️ Gia đình đã dùng hết ${family.quota_limit} giấy của tháng này. Hạn mức sẽ làm mới vào ngày 1 tháng sau.`;
    }
    if (!(await this.withinBudget())) return '⚠️ Hệ thống tạm dừng đọc giấy do đã hết ngân sách Beta tháng này. Xin lỗi gia đình!';
    return null;
  }

  private async onMedia(ev: LineEvent, family: Family, userId?: string) {
    const msg = ev.message;
    const blocker = await this.intakeBlocker(family);
    if (blocker) {
      // In groups, don't nag on every photo of a pending family — only active/suspended/quota cases.
      if (family.chat_type === 'user' || family.status !== 'pending_terms') await this.reply(ev, [text(blocker)]);
      return;
    }
    if (msg.type === 'file' && !/\.pdf$/i.test(msg.fileName || '')) {
      return this.reply(ev, [text('Hiện mình chỉ đọc được ảnh và file PDF.')]);
    }
    if (msg.contentProvider && msg.contentProvider.type !== 'line') return;

    let content: { data: Buffer; contentType: string; hint?: string };
    try {
      content = await this.line.getContent(msg.id);
    } catch (err) {
      await this.services.logError(family.family_id, 'CONTENT_DOWNLOAD', String((err as Error).message));
      return this.reply(ev, [text('⚠️ Không tải được ảnh từ LINE. Bạn gửi lại giúp mình nhé.')]);
    }
    const mediaType = msg.type === 'file' ? 'application/pdf' : content.contentType;
    if (mediaType === 'application/pdf' ? content.data.length > MAX_PDF_BYTES : content.data.length > MAX_IMAGE_BYTES) {
      return this.reply(ev, [text('⚠️ File quá lớn. Bạn chụp lại hoặc gửi file nhỏ hơn nhé.')]);
    }
    if (mediaType !== 'application/pdf' && !(SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mediaType)) {
      return this.reply(ev, [text('⚠️ Định dạng ảnh không hỗ trợ. Hãy gửi ảnh JPG/PNG.')]);
    }

    await this.line.showLoading(family.line_chat_id, 30);
    const page: Page = { data: content.data, mediaType, hint: content.hint };
    const res = this.aggregator.add({
      chatId: family.line_chat_id,
      familyId: family.family_id,
      page,
      replyToken: ev.replyToken,
      userId,
      imageSet: msg.imageSet,
    });
    if (res.dropped === 1) {
      await this.services.logError(family.family_id, 'TOO_MANY_PAGES', `Bỏ trang vượt quá ${this.cfg.maxPagesPerDoc}`);
    }
    // A PDF is a complete document on its own.
    if (mediaType === 'application/pdf') await this.aggregator.flush(family.line_chat_id);
  }

  private async send(batch: PageBatch, messages: LineMessage[]) {
    if (batch.replyToken && (await this.line.reply(batch.replyToken, messages))) return;
    // Reply token expired (slow extraction) — fall back to push, which counts against the monthly free quota.
    const usage = await this.repo.getUsage(jstMonth(this.now()));
    if (usage.push_messages >= this.cfg.pushLimit) {
      await this.services.logError(batch.familyId, 'PUSH_QUOTA', 'Không gửi được kết quả: hết quota push');
      return;
    }
    if (await this.line.push(batch.chatId, messages)) await this.repo.addUsage(jstMonth(this.now()), { push_messages: 1 });
  }

  /** Extract one (possibly multi-page) document and answer in the chat. */
  async processBatch(batch: PageBatch) {
    const now = this.now();
    const family = await this.repo.getFamily(batch.familyId);
    if (!family) return;
    rollQuotaMonth(family, now);
    const blocker = await this.intakeBlocker(family);
    if (blocker) return this.send(batch, [text(blocker)]);

    const month = jstMonth(now);
    let outcome;
    try {
      outcome = await this.deps.extractor.extract(batch.pages, { today: jstDate(now) });
    } catch (err) {
      if (err instanceof ExtractionError) {
        const cost = err.runs.reduce((s, r) => s + r.cost_usd, 0);
        if (cost) await this.repo.addUsage(month, { cost_usd: cost });
        await this.services.logError(family.family_id, `EXTRACT_${err.code.toUpperCase()}`, err.message);
        return this.send(batch, [text('😥 Mình chưa đọc được giấy này. Bạn thử chụp lại thẳng, đủ sáng, rõ chữ rồi gửi lại nhé.')]);
      }
      await this.services.logError(family.family_id, 'EXTRACT_UNKNOWN', String((err as Error)?.message || err));
      return this.send(batch, [text('😥 Có lỗi khi đọc giấy. Bạn thử lại sau ít phút nhé.')]);
    }

    const doc = toDocument(outcome, { familyId: family.family_id, pages: batch.pages.length, now, retentionDays: this.cfg.retentionDays });
    const isFirstDoc = (await this.repo.listDocuments(family.family_id)).length === 0;
    await this.repo.addDocument(doc);

    family.quota_used += 1;
    family.last_active = now.toISOString();
    await this.repo.saveFamily(family);
    await this.repo.addUsage(month, {
      cost_usd: doc.token_usage?.estimated_cost_usd || 0,
      docs: 1,
      pages: batch.pages.length,
      sonnet_docs: doc.model_used === SONNET_MODEL ? 1 : 0,
    });

    const quick: Array<{ label: string; text?: string; data?: string; uri?: string }> = [
      { label: '👍 Đúng', data: `action=fb&doc=${doc.id}&v=up`, text: '👍 Đúng' },
      { label: '👎 Sai', data: `action=fb&doc=${doc.id}&v=down`, text: '👎 Có chỗ sai' },
    ];
    const detail = liffUrl(this.cfg, { doc: doc.id });
    if (detail) quick.push({ label: '✏️ Sửa / chi tiết', uri: detail });
    quick.push({ label: '📅 Link lịch', data: 'action=calendar', text: 'Lịch' });

    // Quick replies only render on the last message of a reply.
    const body = formatDocumentReply(doc);
    const messages = isFirstDoc && (doc.events.length || doc.actions.some(a => a.deadline))
      ? [text(body), { ...this.calendarMessage(family), quickReply: text('', quick).quickReply }]
      : [text(body, quick)];
    await this.send(batch, messages);
  }
}
