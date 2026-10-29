import { AppConfig } from '../config.ts';
import { Repo, UsageDelta } from '../db/repo.ts';
import { DOT_MENU_ALIAS, LineApi, LineMessage, QuickItem, text } from '../line.ts';
import { liffUrl } from '../service.ts';
import { isValidIsoDate, jstDate, jstMonth } from '../time.ts';
import {
  CONTRACT_TYPES, FUTURE_PLANS, LICENSE_STATUSES, PolicyFeed, PolicyItem, PolicyProfile, PolicyProfileInput, RESIDENT_TAX, SEVERITY_ICON,
  Severity, Tier, TOKUTEI_SECTORS, VISA_TYPES,
} from '../../types/policy.ts';
import { PolicyAnalyzer, toPolicyItem, policyId } from './analyzer.ts';
import { candidateLinks, fetchHtml, htmlToText, Link, PageFetcher, pageTitle } from './fetch.ts';
import { buildFeed, fmtDay, formatPolicyMessage, isActive, matchItem, remindersDue } from './match.ts';
import { POLICY_CITIES, POLICY_SOURCES, PolicySource } from './sources.ts';

/** Push messages kept back for reply-token fallbacks and admin alerts (same reserve as the daily digest). */
const PUSH_RESERVE = 20;
/** Pages shorter than this are navigation/redirect shells, not notices. */
const MIN_TEXT = 200;

export interface PolicyDeps {
  repo: Repo;
  cfg: AppConfig;
  line: LineApi;
  analyzer: PolicyAnalyzer;
  fetchPage?: PageFetcher;
  sources?: PolicySource[];
  /** Usage writes should go through the bot so budget/push alerts fire; defaults to the repo. */
  recordUsage?: (month: string, delta: UsageDelta) => Promise<void>;
  /** `link` becomes a tap-able button under the message. */
  notify?: (message: string, link?: { label: string; uri: string }) => Promise<void>;
  now?: () => Date;
}

export interface SourceReport {
  id: string;
  links: number;
  fresh: number;
  pending: number;
  ignored: number;
  errors: string[];
  /** --dry only: what would be analysed. */
  sample?: Link[];
}

export interface DispatchReport {
  sent: number;
  failed: number;
  deferred: number;
}

export interface IngestReport {
  sources: SourceReport[];
  cost_usd: number;
  created: number;
}

/** What the admin screen shows about the last read of the official sources. */
export interface IngestStatus {
  running: boolean;
  last: { at: string; dry: boolean; report: IngestReport | null; error?: string } | null;
}

export type ProfileResult = { ok: true; value: PolicyProfileInput } | { ok: false; error: string };

const oneOf = (list: Array<{ id: string }>, v: unknown) => (typeof v === 'string' && list.some(x => x.id === v) ? v : undefined);

export function validateProfileInput(body: Record<string, unknown>, today: string): ProfileResult {
  const visa_type = String(body.visa_type || '');
  if (!VISA_TYPES.some(v => v.id === visa_type)) return { ok: false, error: 'Chọn loại visa.' };
  const city = String(body.city || '');
  if (!POLICY_CITIES.some(c => c.id === city)) return { ok: false, error: 'Chọn nơi ở.' };

  const date = (raw: unknown, what: string): { ok: true; value?: string } | { ok: false; error: string } => {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) return { ok: true };
    if (!isValidIsoDate(v)) return { ok: false, error: `Ngày hết hạn ${what} không hợp lệ.` };
    if (v < addYears(today, -1) || v > addYears(today, 15)) return { ok: false, error: `Ngày hết hạn ${what} có vẻ sai — kiểm tra lại.` };
    return { ok: true, value: v };
  };
  const visaExpiry = date(body.visa_expiry, 'visa');
  if (!visaExpiry.ok) return visaExpiry;
  const licenseExpiry = date(body.license_expiry, 'bằng lái');
  if (!licenseExpiry.ok) return licenseExpiry;

  const license_status = oneOf(LICENSE_STATUSES, body.license_status) as PolicyProfileInput['license_status'];
  const tokutei = visa_type === 'tokutei1' || visa_type === 'tokutei2';
  return {
    ok: true,
    value: {
      visa_type: visa_type as PolicyProfileInput['visa_type'],
      city,
      visa_expiry: visaExpiry.value,
      has_children: body.has_children === true,
      license_status,
      license_expiry: license_status && license_status !== 'none' ? licenseExpiry.value : undefined,
      contract_type: oneOf(CONTRACT_TYPES, body.contract_type) as PolicyProfileInput['contract_type'],
      sector: tokutei ? oneOf(TOKUTEI_SECTORS, body.sector) : undefined,
      plan: oneOf(FUTURE_PLANS, body.plan) as PolicyProfileInput['plan'],
      resident_tax: oneOf(RESIDENT_TAX, body.resident_tax) as PolicyProfileInput['resident_tax'],
    },
  };
}

function addYears(iso: string, n: number) {
  return `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`;
}

export class PolicyService {
  private repo: Repo;
  private cfg: AppConfig;
  private line: LineApi;
  private sources: PolicySource[];
  private fetchPage: PageFetcher;
  private now: () => Date;
  /** Serialises pushes so an approval and the daily job can never double-send. */
  private pushQueue: Promise<unknown> = Promise.resolve();
  private ingestState: IngestStatus = { running: false, last: null };

  constructor(private readonly deps: PolicyDeps) {
    this.repo = deps.repo;
    this.cfg = deps.cfg;
    this.line = deps.line;
    this.sources = deps.sources || POLICY_SOURCES;
    this.fetchPage = deps.fetchPage || fetchHtml;
    this.now = deps.now || (() => new Date());
  }

  private record(month: string, delta: UsageDelta) {
    return (this.deps.recordUsage || ((m, d) => this.repo.addUsage(m, d)))(month, delta);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.pushQueue.then(fn, fn);
    this.pushQueue = run.catch(() => undefined);
    return run;
  }

  // ---------- ingest: official pages → AI drafts (never auto-published) ----------

  get ingestStatus(): IngestStatus {
    return this.ingestState;
  }

  /** Kick off an ingest without waiting (it can take minutes). false = one is already running. */
  startIngest(opts: { dry?: boolean } = {}): boolean {
    if (this.ingestState.running) return false;
    void this.ingest(opts).catch(() => undefined); // failures are recorded in ingestStatus.last
    return true;
  }

  async ingest(opts: { dry?: boolean; sourceId?: string; maxNew?: number } = {}): Promise<IngestReport> {
    this.ingestState.running = true;
    const at = this.now().toISOString();
    try {
      const report = await this.runIngest(opts);
      this.ingestState = { running: false, last: { at, dry: !!opts.dry, report } };
      return report;
    } catch (err) {
      this.ingestState = { running: false, last: { at, dry: !!opts.dry, report: null, error: String((err as Error).message || err) } };
      throw err;
    }
  }

  private async runIngest(opts: { dry?: boolean; sourceId?: string; maxNew?: number }): Promise<IngestReport> {
    const now = this.now();
    const today = jstDate(now);
    const month = jstMonth(now);
    const maxNew = opts.maxNew ?? this.cfg.policyMaxNewPerRun;
    const reports: SourceReport[] = [];
    let cost = 0;
    let created = 0;

    for (const source of this.sources.filter(s => !opts.sourceId || s.id === opts.sourceId)) {
      const rep: SourceReport = { id: source.id, links: 0, fresh: 0, pending: 0, ignored: 0, errors: [] };
      reports.push(rep);
      const links: Link[] = [];
      for (const listUrl of source.listUrlsFor ? source.listUrlsFor(now) : [source.listUrl]) {
        try {
          const found = candidateLinks(source, await this.fetchPage(listUrl), { baseUrl: listUrl, today, maxAgeDays: this.cfg.policyMaxAgeDays });
          for (const l of found) if (!links.some(x => x.url === l.url)) links.push(l);
        } catch (err) {
          rep.errors.push(`list ${listUrl}: ${(err as Error).message}`);
        }
      }
      links.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      rep.links = links.length;
      const fresh: Link[] = [];
      for (const l of links) if (!(await this.repo.getPolicyItem(policyId(l.url)))) fresh.push(l);
      rep.fresh = fresh.length;
      if (opts.dry) {
        rep.sample = fresh.slice(0, 10);
        continue;
      }

      for (const link of fresh.slice(0, maxNew)) {
        if ((await this.repo.getUsage(month)).cost_usd >= this.cfg.monthlyBudgetUsd) {
          rep.errors.push('budget: đã hết ngân sách tháng, dừng đọc.');
          break;
        }
        try {
          const html = await this.fetchPage(link.url);
          const body = htmlToText(html);
          const title = pageTitle(html) || link.text;
          if (body.length < MIN_TEXT) {
            await this.repo.savePolicyItem(this.shell(source, link, now));
            rep.ignored++;
            continue;
          }
          const { raw, cost_usd } = await this.deps.analyzer.analyze({ source, url: link.url, title, text: body, today });
          cost += cost_usd;
          await this.record(month, { cost_usd });
          const item = toPolicyItem(raw, source, { url: link.url, title }, now, today);
          await this.repo.savePolicyItem(item);
          if (item.status === 'pending') { rep.pending++; created++; } else rep.ignored++;
        } catch (err) {
          rep.errors.push(`${link.url}: ${(err as Error).message}`);
        }
      }
    }
    if (created && this.deps.notify) {
      const url = liffUrl(this.cfg, { admin: 'policy' });
      await this.deps.notify(
        `📰 Có ${created} bản tin chính sách mới chờ bạn duyệt.\n\n` +
          (url ? `👉 Bấm nút bên dưới (hoặc mở link ${url}), đối chiếu từng tin với trang gốc rồi bấm "Duyệt" hoặc "Loại".\n` : '👉 Mở app → Quản trị → "Duyệt bản tin chính sách".\n') +
          'Chưa duyệt thì chưa ai nhận được tin. Tin 🔴 sẽ được gửi ngay cho người liên quan sau khi bạn duyệt.',
        url ? { label: '📰 Duyệt ngay', uri: url } : undefined,
      );
    }
    return { sources: reports, cost_usd: Number(cost.toFixed(6)), created };
  }

  /** Remember an unusable page so it isn't downloaded again every day. */
  private shell(source: PolicySource, link: Link, now: Date): PolicyItem {
    return {
      id: policyId(link.url), source_id: source.id, issuer: source.issuer, url: link.url, title_jp: link.text.slice(0, 200), title_vi: link.text.slice(0, 120),
      summary_vi: '', action_vi: '', stage: 'decided', severity: 'yellow',
      audience: { visa_types: [], cities: source.city ? [source.city] : [], children_only: false, renewal_related: false },
      status: 'ignored', confidence: 0, created_at: now.toISOString(), pushed_user_ids: [], push_failed_user_ids: [],
    };
  }

  // ---------- admin review ----------

  async approve(id: string, actor: string, severity?: Severity, opts: { dispatch?: boolean } = {}): Promise<{ item: PolicyItem; dispatch: DispatchReport } | null> {
    const item = await this.repo.getPolicyItem(id);
    if (!item || (item.status !== 'pending' && item.status !== 'rejected')) return null;
    item.status = 'approved';
    item.approved_at = this.now().toISOString();
    item.approved_by = actor;
    if (severity) item.severity = severity;
    await this.repo.savePolicyItem(item);
    await this.repo.addAudit({
      id: `aud_${Date.now().toString(36)}_${id.slice(-4)}`, timestamp: this.now().toISOString(), admin_id: actor,
      action: 'POLICY_APPROVE', details: `${item.severity} ${item.title_vi.slice(0, 80)}`,
    });
    // dispatch:false lets the CLI approve without a LINE token; the daily job (or the next approval) sends it.
    const dispatch = opts.dispatch === false ? { sent: 0, failed: 0, deferred: 0 } : await this.dispatch();
    if (opts.dispatch !== false) await this.refreshDots(item);
    return { item, dispatch };
  }

  async reject(id: string, actor: string): Promise<PolicyItem | null> {
    const item = await this.repo.getPolicyItem(id);
    if (!item || item.status === 'ignored') return null;
    item.status = 'rejected';
    await this.repo.savePolicyItem(item);
    await this.repo.addAudit({
      id: `aud_${Date.now().toString(36)}_${id.slice(-4)}`, timestamp: this.now().toISOString(), admin_id: actor,
      action: 'POLICY_REJECT', details: item.title_vi.slice(0, 80),
    });
    return item;
  }

  // ---------- push: only 🔴 and visa reminders (LINE free tier = 200 pushes/month, shared) ----------

  private async pushBudgetLeft(): Promise<number> {
    const u = await this.repo.getUsage(jstMonth(this.now()));
    return this.cfg.pushLimit - PUSH_RESERVE - u.push_messages;
  }

  /** Send approved 🔴 items to every matching user who hasn't received them. Stops (and alerts once) when the push quota runs low. */
  dispatch(): Promise<DispatchReport> {
    return this.serial(async () => {
      const now = this.now();
      const today = jstDate(now);
      const month = jstMonth(now);
      const rep: DispatchReport = { sent: 0, failed: 0, deferred: 0 };
      const profiles = await this.repo.listPolicyProfiles();
      let budget = await this.pushBudgetLeft();

      for (const item of (await this.repo.listPolicyItems('approved')).filter(i => i.severity === 'red' && isActive(i, today))) {
        let changed = false;
        for (const p of profiles) {
          if (item.pushed_user_ids.includes(p.user_id) || item.push_failed_user_ids.includes(p.user_id)) continue;
          const m = matchItem(p, item);
          if (!m || !this.mayPush(p)) continue;
          if (budget <= 0) { rep.deferred++; continue; }
          const ok = await this.line.push(p.user_id, [text(formatPolicyMessage({ ...item, ...m }))]).catch(() => false);
          (ok ? item.pushed_user_ids : item.push_failed_user_ids).push(p.user_id);
          changed = true;
          if (ok) { rep.sent++; budget--; await this.record(month, { push_messages: 1 }); } else rep.failed++;
        }
        if (changed) await this.repo.savePolicyItem(item);
      }
      if (rep.deferred && this.deps.notify && (await this.repo.markUsageAlert(month, 'policy_deferred'))) {
        await this.deps.notify(`⚠️ Bản tin chính sách: ${rep.deferred} tin 🔴 chưa gửi vì sắp hết quota push LINE tháng này. Người dùng vẫn xem được trong app.`);
      }
      return rep;
    });
  }

  /** Premium gating (off during beta): free users keep the app + "có gì mới", only pushes are withheld. */
  private mayPush(p: PolicyProfile): boolean {
    return !this.cfg.policyPremiumOnlyPush || p.tier === 'premium';
  }

  /** Personal deadlines (visa 90d, licence 60d, 住民税 7d) — each key is sent once. */
  sendReminders(): Promise<DispatchReport> {
    return this.serial(async () => {
      const now = this.now();
      const today = jstDate(now);
      const month = jstMonth(now);
      const rep: DispatchReport = { sent: 0, failed: 0, deferred: 0 };
      let budget = await this.pushBudgetLeft();

      for (const p of await this.repo.listPolicyProfiles()) {
        const due = remindersDue(p, today).filter(r => !p.reminders_sent.includes(r.key));
        if (!due.length || !this.mayPush(p)) continue;
        let changed = false;
        for (const r of due) {
          if (budget <= 0) { rep.deferred++; continue; }
          const ok = await this.line.push(p.user_id, [text(r.text)]).catch(() => false);
          p.reminders_sent = [...p.reminders_sent, r.key].slice(-20); // mark even on failure: users who never added the bot would retry forever
          changed = true;
          if (ok) { rep.sent++; budget--; await this.record(month, { push_messages: 1 }); } else rep.failed++;
        }
        if (changed) await this.repo.savePolicyProfile(p);
      }
      return rep;
    });
  }

  // ---------- red dot on the rich menu (per-user menu switch: not a message, costs no quota) ----------

  private async setDot(p: PolicyProfile, on: boolean) {
    if (!!p.menu_dot === on) return;
    const ok = await (on ? this.line.linkRichMenu(p.user_id, DOT_MENU_ALIAS) : this.line.unlinkRichMenu(p.user_id)).catch(() => false);
    if (!ok) return; // best effort: not a friend yet / menus not set up
    p.menu_dot = on;
    await this.repo.savePolicyProfile(p);
  }

  /** After approving an item: light the dot for everyone it concerns. */
  private async refreshDots(item: PolicyItem) {
    for (const p of await this.repo.listPolicyProfiles()) {
      if (matchItem(p, item)) await this.setDot((await this.repo.getPolicyProfile(p.user_id)) || p, true);
    }
  }

  /** What the daily Cloud Scheduler job runs. */
  async runDaily() {
    const ingest = await this.ingest();
    const dispatch = await this.dispatch();
    const reminders = await this.sendReminders();
    return { ingest, dispatch, reminders };
  }

  // ---------- users ----------

  getProfile(userId: string) {
    return this.repo.getPolicyProfile(userId);
  }

  async saveProfile(userId: string, input: PolicyProfileInput): Promise<PolicyProfile> {
    const now = this.now().toISOString();
    const prev = await this.repo.getPolicyProfile(userId);
    const profile: PolicyProfile = {
      ...input,
      user_id: userId,
      created_at: prev?.created_at || now,
      updated_at: now,
      last_seen_at: prev?.last_seen_at,
      tier: prev?.tier,
      menu_dot: prev?.menu_dot,
      reminders_sent: prev?.reminders_sent || [],
    };
    await this.repo.savePolicyProfile(profile);
    return profile;
  }

  async feed(userId: string): Promise<PolicyFeed> {
    const profile = await this.repo.getPolicyProfile(userId);
    const items = profile ? buildFeed(profile, await this.repo.listPolicyItems('approved'), jstDate(this.now())) : [];
    return {
      profile,
      options: {
        visa_types: VISA_TYPES, cities: POLICY_CITIES, contract_types: CONTRACT_TYPES, license_statuses: LICENSE_STATUSES,
        plans: FUTURE_PLANS, resident_tax: RESIDENT_TAX, sectors: TOKUTEI_SECTORS,
      },
      items,
      unread_count: items.filter(i => i.unread).length,
    };
  }

  async markSeen(userId: string): Promise<void> {
    const p = await this.repo.getPolicyProfile(userId);
    if (!p) return;
    p.last_seen_at = this.now().toISOString();
    await this.repo.savePolicyProfile(p);
    await this.setDot(p, false);
  }

  /** Admin: Premium gating (see POLICY_PREMIUM_ONLY_PUSH). */
  async setTier(userId: string, tier: Tier): Promise<boolean> {
    const p = await this.repo.getPolicyProfile(userId);
    if (!p) return false;
    p.tier = tier;
    await this.repo.savePolicyProfile(p);
    return true;
  }

  // ---------- LINE chat ("có gì mới?" is a reply: free, no push quota) ----------

  async chatReply(userId: string | undefined, inPrivateChat: boolean, mode: 'whatsnew' | 'intro'): Promise<LineMessage[]> {
    const url = liffUrl(this.cfg, { tab: 'policy' });
    const open: QuickItem[] = url ? [{ label: '📰 Mở bản tin', uri: url }] : [];
    const profile = userId ? await this.repo.getPolicyProfile(userId) : null;

    if (!inPrivateChat) {
      // Visa dates are private: never print them in a family group.
      return [text(
        '📰 Bản tin chính sách được cá nhân hóa theo visa & nơi ở của từng người, nên mình chỉ hiển thị riêng (không đăng trong nhóm).\n' +
          (url ? `Mở app để xem / thiết lập: ${url}` : 'Nhắn riêng cho bot gõ "có gì mới" để xem.'),
        open,
      )];
    }
    if (!profile) {
      return [text(
        '📰 Bản tin chính sách cá nhân hóa: chỉ báo thay đổi ảnh hưởng tới chính bạn, kèm hạn chót và việc cần làm.\n\n' +
          'Cần 3 thông tin (30 giây): loại visa + ngày hết hạn, nơi ở, nhà có con không.' + (url ? `\n👉 ${url}` : ''),
        open,
      )];
    }
    const feed = await this.feed(userId!);
    if (mode === 'intro' || !feed.items.length) {
      return [text(
        feed.items.length
          ? `📰 Bạn có ${feed.items.length} tin còn hiệu lực. Gõ "có gì mới" để xem nhanh.`
          : '📰 Hiện chưa có thay đổi chính sách nào ảnh hưởng tới bạn. Có tin khẩn mình sẽ nhắn ngay; nhắc hạn visa tự động trước 3 tháng. 👍',
        open,
      )];
    }
    const lines = feed.items.slice(0, 4).map(e => {
      const when = e.deadline ? ` — hạn ${fmtDay(e.deadline)}` : e.effective_date ? ` — từ ${fmtDay(e.effective_date)}` : '';
      return [`${SEVERITY_ICON[e.severity]} ${e.title_vi}${when}`, e.personal_vi || e.summary_vi, e.action_vi && `✅ ${e.action_vi}`, `🔗 ${e.url}`].filter(Boolean).join('\n');
    });
    await this.markSeen(userId!); // reading them here counts as seen (also clears the red dot)
    const more = feed.items.length > 4 ? `\n\n… và ${feed.items.length - 4} tin nữa trong app.` : '';
    return [text(`📰 Có gì mới cho bạn (${feed.items.length} tin):\n\n${lines.join('\n\n')}${more}\n\nℹ️ Tóm tắt từ nguồn chính thức, không phải tư vấn pháp lý.`, open)];
  }

  // ---------- admin stats ----------

  async stats() {
    const [items, profiles, usage] = await Promise.all([this.repo.listPolicyItems(), this.repo.listPolicyProfiles(), this.repo.getUsage(jstMonth(this.now()))]);
    return { items, profiles, usage };
  }
}
