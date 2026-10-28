import { AppConfig } from './config.ts';
import { Repo, UsageDelta } from './db/repo.ts';
import {
  ExtractionError, Extractor, MAX_IMAGE_BYTES, MAX_PDF_BYTES, Page, SONNET_MODEL, SUPPORTED_IMAGE_TYPES, toDocument,
} from './extract.ts';
import { Composer } from './renraku.ts';
import { MockTranslator, Translator } from './translate.ts';
import { LineApi, LineMessage, QuickItem, text } from './line.ts';
import { PageAggregator, PageBatch } from './aggregator.ts';
import { findExactDuplicate, findSameDocument, mergeInto, pageHash } from './dedupe.ts';
import { calendarPageUrl, familyIdForChat, liffUrl, newFamily, normalizeCode, rollQuotaMonth, Services } from './service.ts';
import { jstDate, jstMonth } from './time.ts';
import { MockPolicyAnalyzer, PolicyAnalyzer } from './policy/analyzer.ts';
import { PolicyService } from './policy/service.ts';
import { ExtractedDocument, Family, Translation } from '../types/index.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type LineEvent = any;

const MODEL_LABEL: Record<string, string> = {
  'claude-haiku-5-5': 'Haiku',
  'claude-sonnet-5-5': 'Sonnet (giấy quan trọng)',
  mock: 'Mock',
};

const DELETE_CONFIRM_MINUTES = 5;
const TRANSLATE_MODE_MS = 5 * 60_000;
/** Push messages kept back from digests for reply-token fallbacks and admin alerts. */
const PUSH_RESERVE = 20;
const LAST_PAGES_TTL_MS = 10 * 60_000;

/** Bilingual line list split across LINE messages (≤5 per reply, 5000 chars each). Quick replies go on the last one. */
export function formatTranslation(t: Translation, quick: QuickItem[]): LineMessage[] {
  const blocks = t.lines.map(l => (l.jp && l.jp !== l.vi ? `${l.vi}\n（${l.jp}）` : l.vi));
  const header = `🌐 Bản dịch (không lưu)${t.title_jp ? `\n📄 ${t.title_jp}` : ''}`;
  const chunks: string[] = [header];
  for (const b of blocks) {
    const cur = chunks[chunks.length - 1];
    if (cur.length + b.length + 2 > 4500) chunks.push(b);
    else chunks[chunks.length - 1] = `${cur}\n\n${b}`;
  }
  if (t.notes_vi) chunks[chunks.length - 1] += `\n\n⚠️ ${t.notes_vi}`;
  if (chunks.length > 5) {
    chunks.length = 5;
    chunks[4] += '\n\n… (còn tiếp — mở app "Chụp giấy → Chỉ dịch" để xem đầy đủ)';
  }
  return chunks.map((c, i) => text(c, i === chunks.length - 1 ? quick : undefined));
}

export type IngestResult =
  | { kind: 'blocked'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'duplicate'; family: Family; doc: ExtractedDocument; added: number }
  | { kind: 'new'; family: Family; doc: ExtractedDocument; isFirstDoc: boolean };

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
  translator?: Translator;
  policyAnalyzer?: PolicyAnalyzer;
  cfg: AppConfig;
  now?: () => Date;
}

export class Bot {
  readonly services: Services;
  readonly aggregator: PageAggregator;
  readonly policy: PolicyService;
  private seenEvents: string[] = [];
  /** Chats that typed "dịch": the next photos are translated only (one-shot, expires). */
  private translateUntil = new Map<string, number>();
  /** Last translated pages per chat (RAM only, 10 min) so "Đọc & thêm lịch" doesn't need a re-send. */
  private lastPages = new Map<string, { pages: Page[]; at: number }>();
  private translator: Translator;
  private repo: Repo;
  private line: LineApi;
  private cfg: AppConfig;
  private now: () => Date;

  constructor(private readonly deps: BotDeps) {
    this.translator = deps.translator || new MockTranslator();
    this.repo = deps.repo;
    this.line = deps.line;
    this.cfg = deps.cfg;
    this.now = deps.now || (() => new Date());
    this.services = new Services(deps.repo, deps.cfg);
    this.services.onError = (_familyId, type) => this.trackError(type);
    this.policy = new PolicyService({
      repo: deps.repo, cfg: deps.cfg, line: deps.line, analyzer: deps.policyAnalyzer || new MockPolicyAnalyzer(),
      recordUsage: (m, d) => this.recordUsage(m, d), notify: msg => this.notifyAdmins(`🔔 [Admin] ${msg}`), now: this.now,
    });
    this.aggregator = new PageAggregator(deps.cfg.aggregationWindowMs, deps.cfg.maxPagesPerDoc, b => this.processBatch(b));
  }

  // ---------- usage + admin alerts ----------
  private errorTimes: number[] = [];
  private lastErrorAlert = 0;

  /** All usage writes go through here so budget/push thresholds alert the admin once per month. */
  async recordUsage(month: string, delta: UsageDelta) {
    await this.repo.addUsage(month, delta);
    if (!delta.cost_usd && !delta.push_messages) return;
    const u = await this.repo.getUsage(month);
    const budget = this.cfg.monthlyBudgetUsd;
    const checks: Array<[string, boolean, string]> = [
      ['budget100', u.cost_usd >= budget, `⛔ Đã dùng hết ngân sách tháng ${month}: $${u.cost_usd.toFixed(2)} / $${budget}. Bot đã ngừng đọc giấy cho đến tháng sau (hoặc tăng MONTHLY_BUDGET_USD rồi deploy lại).`],
      ['budget80', u.cost_usd >= budget * 0.8, `⚠️ Ngân sách tháng ${month} đã dùng 80%: $${u.cost_usd.toFixed(2)} / $${budget}.`],
      ['push80', u.push_messages >= this.cfg.pushLimit * 0.8, `⚠️ Đã dùng ${u.push_messages}/${this.cfg.pushLimit} tin LINE gửi chủ động tháng ${month}.`],
    ];
    for (const [key, hit, msg] of checks) {
      if (hit && (await this.repo.markUsageAlert(month, key))) {
        await this.notifyAdmins(`🔔 [Admin] ${msg}`);
        if (key === 'budget100') await this.repo.markUsageAlert(month, 'budget80'); // don't send both
        break;
      }
    }
  }

  /** Error spike: ≥5 reading/LINE errors within an hour → one alert (at most every 3 hours). */
  private trackError(type: string) {
    if (!/^(EXTRACT_|TRANSLATE|EVENT_HANDLER|CONTENT_DOWNLOAD)/.test(type)) return;
    const now = Date.now();
    this.errorTimes = [...this.errorTimes.filter(t => now - t < 3600_000), now];
    if (this.errorTimes.length >= 5 && now - this.lastErrorAlert > 3 * 3600_000) {
      this.lastErrorAlert = now;
      void this.notifyAdmins(`🔔 [Admin] ${this.errorTimes.length} lỗi đọc/dịch trong 1 giờ qua (mới nhất: ${type}). Xem: gcloud run services logs read giaytonhat --region asia-northeast1 --limit 100`);
    }
  }

  /** Push to admins' 1:1 chats (counts against the monthly push quota; admins must have added the bot). */
  async notifyAdmins(message: string) {
    for (const id of this.cfg.adminUserIds) {
      if (await this.line.push(id, [text(message)]).catch(() => false)) {
        await this.repo.addUsage(jstMonth(this.now()), { push_messages: 1 });
      }
    }
  }

  /**
   * 7:00 JST digest for families that opted in. Only sends when something is due today/tomorrow,
   * and keeps PUSH_RESERVE messages of the monthly quota for reply fallbacks and admin alerts.
   */
  async sendDailyDigests(now = this.now()) {
    const month = jstMonth(now);
    const today = jstDate(now);
    const tomorrow = jstDate(new Date(now.getTime() + 86400_000));
    let sent = 0;
    let skippedQuota = 0;
    for (const family of await this.repo.listFamilies()) {
      if (!family.daily_digest || family.status !== 'active') continue;
      const docs = await this.repo.listDocuments(family.family_id);
      const lines = (day: string) => {
        const out: string[] = [];
        for (const d of docs) {
          for (const a of d.actions) if (!a.completed && a.deadline === day) out.push(`• [HẠN] ${a.todo_vi}`);
          for (const e of d.events) if (e.date === day) out.push(`• ${e.time ? e.time + ' ' : ''}${e.title_vi}${e.location ? ` @ ${e.location}` : ''}`);
        }
        return out;
      };
      const weekAgo = jstDate(new Date(now.getTime() - 7 * 86400_000)); // don't nag about old items forever
      const overdue = docs.flatMap(d => d.actions.filter(a => !a.completed && a.deadline && a.deadline < today && a.deadline >= weekAgo).map(a => `• ${a.todo_vi} (hạn ${a.deadline!.slice(5).replace('-', '/')})`));
      const t = lines(today);
      const tm = lines(tomorrow);
      if (!t.length && !tm.length && !overdue.length) continue;
      const usage = await this.repo.getUsage(month);
      if (usage.push_messages >= this.cfg.pushLimit - PUSH_RESERVE) {
        skippedQuota++;
        continue;
      }
      const body = [
        '☀️ Chào buổi sáng! Việc của gia đình:',
        t.length ? `\n📌 Hôm nay:\n${t.join('\n')}` : '',
        tm.length ? `\n📅 Ngày mai:\n${tm.join('\n')}` : '',
        overdue.length ? `\n⚠️ Quá hạn chưa xong:\n${overdue.slice(0, 5).join('\n')}` : '',
        '\n(Tắt nhắc: gõ "nhắc sáng tắt")',
      ].filter(Boolean).join('\n');
      const home = liffUrl(this.cfg);
      if (await this.line.push(family.line_chat_id, [text(body, home ? [{ label: '📱 Xem & đánh dấu xong', uri: home }] : undefined)])) {
        await this.recordUsage(month, { push_messages: 1 });
        sent++;
      }
    }
    if (skippedQuota) await this.notifyAdmins(`🔔 [Admin] Nhắc sáng: bỏ qua ${skippedQuota} gia đình vì sắp hết quota tin LINE tháng này.`);
    return { sent, skippedQuota };
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
          '📅 Gõ "lịch" để thêm hạn & sự kiện vào lịch điện thoại.\n' +
          '❓ Gõ "menu" bất cứ lúc nào để hiện các nút bên dưới.',
      ),
      text(
        `✏️ Đặt tên cho gia đình (hiện trên lịch điện thoại), gõ:\nđặt tên <tên>\nVí dụ: đặt tên Nhà Tuấn Mai\n(Tên hiện tại: ${family.family_name})`,
        this.menuItems(),
      ),
    ]);
  }

  private calendarMessage(family: Family): LineMessage {
    return text(
      '📅 Thêm hạn & sự kiện vào lịch điện thoại (làm 1 lần):\n' + calendarPageUrl(this.cfg, family) + '\n\n' +
        'Mở link → bấm nút "Thêm vào lịch iPhone" hoặc "Thêm vào Google Calendar". ' +
        'Sau đó lịch tự cập nhật mỗi khi mình đọc giấy mới.\n🔒 Link riêng của gia đình, đừng chia sẻ ra ngoài.',
    );
  }

  /** Tap-able command list. Rich menus don't show in groups, so quick replies carry the menu there. */
  private menuItems(): QuickItem[] {
    const items: QuickItem[] = [
      { label: '📷 Chụp giấy', camera: true },
      { label: '🖼️ Chọn ảnh', cameraRoll: true },
      { label: '📅 Lịch', data: 'action=calendar', text: 'Lịch' },
      { label: '📰 Chính sách', text: 'có gì mới' },
      { label: '🌐 Chỉ dịch', data: 'action=translate_mode', text: 'dịch' },
      { label: '📊 Hạn mức', text: 'trạng thái' },
      { label: '✍️ Soạn tin cô', text: '/soạn' },
    ];
    const home = liffUrl(this.cfg);
    if (home) items.push({ label: '📱 Trang gia đình', uri: home });
    items.push({ label: '❓ Hướng dẫn', text: 'hướng dẫn' });
    return items;
  }

  private helpMessage(): LineMessage {
    return text(
      '❓ Hướng dẫn — bấm nút bên dưới, hoặc gõ:\n' +
        '• Gửi ảnh/PDF giấy tờ → mình đọc và tóm tắt\n' +
        '• "lịch" → thêm hạn & sự kiện vào lịch điện thoại\n' +
        '• "dịch" rồi gửi ảnh → chỉ dịch từng dòng (không lưu, không thêm lịch)\n' +
        '• "dịch <chữ tiếng Nhật>" → dịch đoạn chữ đó\n' +
        '• "có gì mới" → thay đổi chính sách ảnh hưởng tới riêng bạn (nhắn riêng với bot)\n' +
        '• "trạng thái" → hạn mức tháng này\n' +
        '• "đặt tên <tên>" → đổi tên gia đình\n' +
        '• "nhắc sáng bật/tắt" → 7:00 nhắn việc hôm nay & ngày mai\n' +
        '• "/soạn <nội dung>" → soạn tin tiếng Nhật gửi cô giáo\n' +
        '  Ví dụ: /soạn Hôm nay bé bị sốt xin nghỉ học\n' +
        '• "xóa dữ liệu" → xóa toàn bộ dữ liệu gia đình\n\n' +
        '💡 Trong nhóm: gõ "menu" hoặc nhắc tên bot (@) để hiện lại các nút.',
      this.menuItems(),
    );
  }

  private async onText(ev: LineEvent, family: Family, userId?: string) {
    let raw: string = ev.message.text || '';
    const selfMentions = (ev.message.mention?.mentionees || []).filter((m: { isSelf?: boolean }) => m.isSelf)
      .sort((a: { index: number }, b: { index: number }) => b.index - a.index);
    for (const m of selfMentions) raw = raw.slice(0, m.index) + raw.slice(m.index + m.length);
    raw = raw.trim();
    if (selfMentions.length && !raw) raw = 'menu';
    const t = fold(raw);

    if (t === '/whoami') {
      return this.reply(ev, [text(`🆔 userId: ${userId || 'N/A'}\nfamily: ${family.family_id}`)]);
    }
    if (t === 'dong y dieu khoan' || t === 'dong y') return this.acceptTerms(ev, family);
    if (['huong dan', '/huongdan', '/help', 'help', '/start', 'menu', '/menu', '?', 'lenh'].includes(t)) return this.reply(ev, [this.helpMessage()]);
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
    if (/^(co gi moi|\/cogimoi|chinh sach|\/chinhsach|ban tin)\??$/.test(t)) {
      const mode = t.startsWith('co gi moi') || t === '/cogimoi' ? 'whatsnew' : 'intro';
      return this.reply(ev, await this.policy.chatReply(userId, family.chat_type === 'user', mode));
    }
    if (t === 'nhac sang bat' || t === 'nhac sang tat' || t === 'nhac sang') {
      if (t !== 'nhac sang') {
        family.daily_digest = t.endsWith('bat');
        await this.repo.saveFamily(family);
      }
      return this.reply(ev, [text(
        family.daily_digest
          ? '⏰ Nhắc sáng: ĐANG BẬT. 7:00 mỗi sáng mình gửi việc của hôm nay & ngày mai (chỉ khi có việc).\nTắt: gõ "nhắc sáng tắt".'
          : '⏰ Nhắc sáng: ĐANG TẮT. Hạn & sự kiện vẫn nhắc qua lịch điện thoại.\nBật: gõ "nhắc sáng bật".',
      )]);
    }
    if (/^\/?dat ten\s+\S/.test(t)) {
      const name = raw.replace(/^\/?\S+\s+\S+\s+/, '').trim().slice(0, 40);
      family.family_name = name;
      await this.repo.saveFamily(family);
      return this.reply(ev, [text(`✅ Đã đổi tên thành “${name}”. Lịch thêm sau này sẽ mang tên mới (lịch đã thêm trên điện thoại giữ tên cũ, đổi được trong app Lịch).`)]);
    }
    if (t === 'dich' || t === '/dich') return this.startTranslateMode(ev, family);
    if (/^\/?dich\s/.test(t)) return this.translateText(ev, family, raw.replace(/^\S+\s+/, ''));
    if ((t === 'huy' || t === '/huy') && this.translateUntil.has(family.line_chat_id)) {
      this.translateUntil.delete(family.line_chat_id);
      return this.reply(ev, [text('Đã tắt chế độ dịch. Ảnh gửi tiếp sẽ được đọc và thêm vào lịch như bình thường.')]);
    }
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
    await this.recordUsage(jstMonth(this.now()), { cost_usd });
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
    if (action === 'translate_mode' && family.status === 'active') return this.startTranslateMode(ev, family);
    if (action === 'read_last' && family.status === 'active') {
      const last = this.lastPages.get(family.line_chat_id);
      if (!last || Date.now() - last.at > LAST_PAGES_TTL_MS) {
        return this.reply(ev, [text('Ảnh đã hết hạn lưu tạm (10 phút). Bạn gửi lại ảnh giấy nhé.')]);
      }
      this.lastPages.delete(family.line_chat_id);
      return this.processBatch({ chatId: family.line_chat_id, familyId: family.family_id, pages: last.pages, replyToken: ev.replyToken, userId, mode: 'read' });
    }
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
    const translating = (this.translateUntil.get(family.line_chat_id) || 0) > Date.now();
    const blocker = translating ? await this.translateBlocker(family) : await this.intakeBlocker(family);
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
      mode: translating ? 'translate' : 'read',
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
    if (await this.line.push(batch.chatId, messages)) await this.recordUsage(jstMonth(this.now()), { push_messages: 1 });
  }

  private duplicateMessage(doc: ExtractedDocument, added: number): LineMessage {
    const when = new Date(Date.parse(doc.created_at) + 9 * 3600_000).toISOString();
    const stamp = `${when.slice(11, 16)} ngày ${when.slice(8, 10)}/${when.slice(5, 7)}`;
    const detail = liffUrl(this.cfg, { doc: doc.id });
    return text(
      `📌 Giấy này đã được đọc lúc ${stamp}:\n「${doc.title_vi}」\n\n` +
        (added
          ? `Đã bổ sung ${added} mục mới vào giấy cũ và lịch.`
          : 'Không thêm lại vào lịch và không tính vào hạn mức.') +
        (detail ? `\n\nXem lại chi tiết: ${detail}` : ''),
    );
  }

  /** Extract one (possibly multi-page) document and answer in the chat. */
  /**
   * Shared pipeline for LINE photos and in-app uploads: gates (status/quota/budget),
   * dedupe, Claude extraction, storage, quota + cost accounting.
   */
  async ingest(familyId: string, rawPages: Page[]): Promise<IngestResult> {
    const now = this.now();
    const family = await this.repo.getFamily(familyId);
    if (!family) return { kind: 'blocked', message: 'Không tìm thấy gia đình.' };
    rollQuotaMonth(family, now);
    const blocker = await this.intakeBlocker(family);
    if (blocker) return { kind: 'blocked', message: blocker };

    const month = jstMonth(now);

    // Layer 1: identical photos (forwarded / sent twice) — answer from storage, no Claude call, no quota.
    const seen = new Set<string>();
    const pages = rawPages.filter(p => {
      const h = pageHash(p.data);
      if (seen.has(h)) return false;
      seen.add(h);
      return true;
    });
    const hashes = [...seen];
    const existingDocs = await this.repo.listDocuments(family.family_id);
    const exact = findExactDuplicate(hashes, existingDocs);
    if (exact) return { kind: 'duplicate', family, doc: exact, added: 0 };

    let outcome;
    try {
      outcome = await this.deps.extractor.extract(pages, { today: jstDate(now) });
    } catch (err) {
      if (err instanceof ExtractionError) {
        const cost = err.runs.reduce((s, r) => s + r.cost_usd, 0);
        if (cost) await this.recordUsage(month, { cost_usd: cost });
        await this.services.logError(family.family_id, `EXTRACT_${err.code.toUpperCase()}`, err.message);
        return { kind: 'error', message: '😥 Mình chưa đọc được giấy này. Bạn thử chụp lại thẳng, đủ sáng, rõ chữ rồi gửi lại nhé.' };
      }
      await this.services.logError(family.family_id, 'EXTRACT_UNKNOWN', String((err as Error)?.message || err));
      return { kind: 'error', message: '😥 Có lỗi khi đọc giấy. Bạn thử lại sau ít phút nhé.' };
    }

    const doc = toDocument(outcome, { familyId: family.family_id, pages: pages.length, now, retentionDays: this.cfg.retentionDays });
    doc.source_hashes = hashes;

    // Layer 2: same paper, different photo — merge anything new into the stored document, no quota.
    const same = findSameDocument(doc, existingDocs, now);
    if (same) {
      const added = mergeInto(same, doc);
      await this.repo.saveDocument(same);
      await this.recordUsage(month, { cost_usd: doc.token_usage?.estimated_cost_usd || 0, pages: pages.length });
      return { kind: 'duplicate', family, doc: same, added };
    }

    await this.repo.addDocument(doc);
    family.quota_used += 1;
    family.last_active = now.toISOString();
    await this.repo.saveFamily(family);
    await this.recordUsage(month, {
      cost_usd: doc.token_usage?.estimated_cost_usd || 0,
      docs: 1,
      pages: pages.length,
      sonnet_docs: doc.model_used === SONNET_MODEL ? 1 : 0,
    });
    return { kind: 'new', family, doc, isFirstDoc: existingDocs.length === 0 };
  }

  private async startTranslateMode(ev: LineEvent, family: Family) {
    this.translateUntil.set(family.line_chat_id, Date.now() + TRANSLATE_MODE_MS);
    return this.reply(ev, [text(
      '🌐 Chế độ CHỈ DỊCH: gửi ảnh giấy (1–6 trang) trong 5 phút tới.\nMình sẽ dịch từng dòng Nhật → Việt. Không lưu, không thêm vào lịch, không tính hạn mức.',
      [{ label: '📷 Chụp giấy', camera: true }, { label: '🖼️ Chọn ảnh', cameraRoll: true }, { label: 'Hủy', text: 'hủy' }],
    )]);
  }

  /** Translation shares the monthly budget but not the paper quota. */
  private async translateBlocker(family: Family): Promise<string | null> {
    if (family.status !== 'active') return '⚠️ Gia đình chưa kích hoạt hoặc đang tạm dừng.';
    if (!(await this.withinBudget())) return '⚠️ Hệ thống tạm dừng do đã hết ngân sách Beta tháng này. Xin lỗi gia đình!';
    return null;
  }

  private async translateText(ev: LineEvent, family: Family, content: string) {
    const blocker = await this.translateBlocker(family);
    if (blocker) return this.reply(ev, [text(blocker)]);
    try {
      const { result, cost_usd } = await this.translator.translate([], content.slice(0, 3000));
      await this.recordUsage(jstMonth(this.now()), { cost_usd });
      return this.reply(ev, formatTranslation(result, [{ label: '☰ Menu', text: 'menu' }]));
    } catch (err) {
      await this.services.logError(family.family_id, 'TRANSLATE', String((err as Error).message || err));
      return this.reply(ev, [text('😥 Chưa dịch được. Bạn thử lại sau ít phút nhé.')]);
    }
  }

  /** LINE "dịch" mode: translate the batch, keep pages in RAM briefly for a one-tap full read. */
  private async translateBatch(batch: PageBatch) {
    this.translateUntil.delete(batch.chatId); // one-shot
    const family = await this.repo.getFamily(batch.familyId);
    if (!family) return;
    const blocker = await this.translateBlocker(family);
    if (blocker) return this.send(batch, [text(blocker)]);
    const seen = new Set<string>();
    const pages = batch.pages.filter(p => !seen.has(pageHash(p.data)) && seen.add(pageHash(p.data)));
    try {
      const { result, cost_usd } = await this.translator.translate(pages);
      await this.recordUsage(jstMonth(this.now()), { cost_usd, pages: pages.length });
      this.lastPages.set(batch.chatId, { pages, at: Date.now() });
      setTimeout(() => {
        const last = this.lastPages.get(batch.chatId);
        if (last && Date.now() - last.at >= LAST_PAGES_TTL_MS) this.lastPages.delete(batch.chatId);
      }, LAST_PAGES_TTL_MS + 1000).unref?.();
      return this.send(batch, formatTranslation(result, [
        { label: '📋 Đọc & thêm lịch', data: 'action=read_last', text: '📋 Đọc & thêm vào lịch' },
        { label: '🌐 Dịch tiếp', data: 'action=translate_mode', text: 'dịch' },
        { label: '☰ Menu', text: 'menu' },
      ]));
    } catch (err) {
      await this.services.logError(family.family_id, 'TRANSLATE', String((err as Error).message || err));
      return this.send(batch, [text('😥 Chưa dịch được. Bạn thử chụp lại thẳng, đủ sáng, rõ chữ rồi gõ "dịch" và gửi lại nhé.')]);
    }
  }

  /** LINE path: ingest a batch from the chat and answer there. */
  async processBatch(batch: PageBatch) {
    if (batch.mode === 'translate') return this.translateBatch(batch);
    const r = await this.ingest(batch.familyId, batch.pages);
    if (r.kind === 'blocked' || r.kind === 'error') return this.send(batch, [text(r.message)]);
    if (r.kind === 'duplicate') return this.send(batch, [this.duplicateMessage(r.doc, r.added)]);

    const { doc, family } = r;
    const quick: QuickItem[] = [
      { label: '👍 Đúng', data: `action=fb&doc=${doc.id}&v=up`, text: '👍 Đúng' },
      { label: '👎 Sai', data: `action=fb&doc=${doc.id}&v=down`, text: '👎 Có chỗ sai' },
    ];
    const detail = liffUrl(this.cfg, { doc: doc.id });
    if (detail) quick.push({ label: '✏️ Sửa / chi tiết', uri: detail });
    quick.push({ label: '📅 Link lịch', data: 'action=calendar', text: 'Lịch' });
    quick.push({ label: '📷 Giấy khác', camera: true }, { label: '☰ Menu', text: 'menu' });

    // Quick replies only render on the last message of a reply.
    const body = formatDocumentReply(doc);
    const messages = r.isFirstDoc && (doc.events.length || doc.actions.some(a => a.deadline))
      ? [text(body), { ...this.calendarMessage(family), quickReply: text('', quick).quickReply }]
      : [text(body, quick)];
    await this.send(batch, messages);
  }
}
