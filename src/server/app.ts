import express, { Response } from 'express';
import { AppConfig } from './config.ts';
import { Repo } from './db/repo.ts';
import { Bot } from './bot.ts';
import { Extractor, MAX_IMAGE_BYTES, MAX_PDF_BYTES, Page, SUPPORTED_IMAGE_TYPES } from './extract.ts';
import { Composer } from './renraku.ts';
import { LineApi, RecordingLineApi, verifyLineSignature } from './line.ts';
import { AuthedRequest, authMiddleware, IdTokenVerifier, requireAdmin } from './auth.ts';
import { generateIcsCalendar } from './ics.ts';
import { calendarLinks, renderCalendarPage } from './calendarPage.ts';
import { calendarPageUrl, icsUrl, makeInvite, normalizeCode, rollQuotaMonth } from './service.ts';
import { isValidHm, isValidIsoDate, jstMonth } from './time.ts';
import { AdminMetrics, DOC_TYPES, DocType, ExtractedDocument, Family, MeResponse } from '../types/index.ts';
import { text } from './line.ts';

export interface AppDeps {
  cfg: AppConfig;
  repo: Repo;
  line: LineApi;
  extractor: Extractor;
  composer: Composer;
  verifyIdToken: IdTokenVerifier | null;
}

/** Client-safe family view: no LINE ids, plus derived links. */
function publicFamily(cfg: AppConfig, f: Family) {
  const { member_user_ids, line_chat_id, pending_delete_until, ...rest } = f;
  return { ...rest, members_count: f.members_count ?? member_user_ids.length, ics_url: icsUrl(cfg, f), calendar_page_url: calendarPageUrl(cfg, f) };
}

/** Admin view: metadata only. */
function adminFamily(f: Family) {
  const { member_user_ids, line_chat_id, ics_token, pending_delete_until, ...rest } = f;
  return { ...rest, ics_token: '', members_count: f.members_count ?? member_user_ids.length };
}

export function createApp(deps: AppDeps) {
  const { cfg, repo, line } = deps;
  const bot = new Bot({ repo, line, extractor: deps.extractor, composer: deps.composer, cfg });
  const services = bot.services;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // ---------- Health ----------
  // Cloud Run reserves paths ending in "z" (e.g. /healthz), so expose /health.
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // ---------- ICS feed (secret token in URL) ----------
  app.get('/ics/:file', async (req, res) => {
    const token = req.params.file.replace(/\.ics$/, '');
    const family = token.length >= 16 ? await repo.getFamilyByIcsToken(token) : null;
    if (!family || family.status === 'left') {
      res.status(404).type('text/plain').send('Calendar not found.');
      return;
    }
    const docs = await repo.listDocuments(family.family_id);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', 'inline; filename="giaytonhat.ics"');
    res.send(generateIcsCalendar(family, docs));
  });

  // ---------- "Add to calendar" page (what the bot links to) ----------
  app.get('/cal/:token', async (req, res) => {
    const token = req.params.token;
    const family = token.length >= 16 ? await repo.getFamilyByIcsToken(token) : null;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!family || family.status === 'left') {
      res.status(404).type('text/plain; charset=utf-8').send('Link lịch không tồn tại hoặc đã được đổi. Gõ "lịch" trong LINE để lấy link mới.');
      return;
    }
    const docs = await repo.listDocuments(family.family_id);
    res.type('html').send(renderCalendarPage(family, docs, calendarLinks(cfg.publicBaseUrl, token), req.headers['user-agent']));
  });

  // ---------- LINE webhook ----------
  app.post('/api/line/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    const raw = req.body as Buffer;
    const sig = req.headers['x-line-signature'] as string | undefined;
    const unsignedDevOk = cfg.devMode && !cfg.lineChannelSecret;
    if (!unsignedDevOk && !verifyLineSignature(cfg.lineChannelSecret, raw, sig)) {
      res.status(401).json({ error: 'invalid signature' });
      return;
    }
    let body: { events?: unknown[] };
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'bad json' });
      return;
    }
    // Ack immediately (LINE retries on slow responses); processing continues in the background.
    // Cloud Run must run with --no-cpu-throttling for this.
    res.status(200).json({ ok: true });
    void bot.handleWebhook(body as { events?: unknown[] });
  });

  // ---------- Scheduled housekeeping (Cloud Scheduler) ----------
  app.post('/tasks/cleanup', async (req, res) => {
    if (!cfg.cronSecret || req.headers['x-cron-secret'] !== cfg.cronSecret) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    res.json(await services.runCleanup());
  });

  // Public: lets the SPA decide between LIFF login and dev auth.
  app.get('/api/config', (_req, res) => res.json({ liff_id: cfg.liffId, dev_mode: cfg.devMode }));

  // ---------- Authenticated LIFF API ----------
  const api = express.Router();
  // Photos uploaded from the LIFF app need a bigger body; everything else stays small.
  const smallJson = express.json({ limit: cfg.devMode ? '15mb' : '100kb' });
  const uploadJson = express.json({ limit: '25mb' });
  api.use((req, res, next) => (req.path === '/documents/upload' ? uploadJson : smallJson)(req, res, next));
  api.use(authMiddleware(cfg, deps.verifyIdToken));

  /** Resolve the family the caller may access (must be a member of the LINE chat). */
  async function memberFamily(req: AuthedRequest, res: Response): Promise<Family | null> {
    const wanted = (req.query.familyId as string) || (req.body?.familyId as string) || '';
    const families = (await repo.findFamiliesByMember(req.userId!)).filter(f => f.status !== 'left');
    const fam = wanted ? families.find(f => f.family_id === wanted) : families[0];
    if (!fam) {
      res.status(404).json({ error: 'family_not_found' });
      return null;
    }
    if (rollQuotaMonth(fam, new Date())) await repo.saveFamily(fam);
    return fam;
  }

  api.get('/me', async (req: AuthedRequest, res) => {
    const families = (await repo.findFamiliesByMember(req.userId!)).filter(f => f.status !== 'left');
    const me: MeResponse = {
      user_id: req.userId!,
      is_admin: !!req.isAdmin,
      dev_mode: cfg.devMode,
      liff_id: cfg.liffId,
      families: families.map(f => ({ family_id: f.family_id, family_name: f.family_name })),
    };
    res.json(me);
  });

  api.get('/family', async (req: AuthedRequest, res) => {
    const fam = await memberFamily(req, res);
    if (fam) res.json({ family: publicFamily(cfg, fam) });
  });

  api.patch('/family', async (req: AuthedRequest, res) => {
    const fam = await memberFamily(req, res);
    if (!fam) return;
    const name = String(req.body.family_name || '').trim().slice(0, 60);
    if (name) fam.family_name = name;
    await repo.saveFamily(fam);
    res.json({ family: publicFamily(cfg, fam) });
  });

  api.get('/documents', async (req: AuthedRequest, res) => {
    const fam = await memberFamily(req, res);
    if (fam) res.json({ documents: await repo.listDocuments(fam.family_id) });
  });

  async function memberDoc(req: AuthedRequest, res: Response): Promise<{ fam: Family; doc: ExtractedDocument } | null> {
    const fam = await memberFamily(req, res);
    if (!fam) return null;
    const doc = await repo.getDocument(fam.family_id, req.params.id);
    if (!doc) {
      res.status(404).json({ error: 'document_not_found' });
      return null;
    }
    return { fam, doc };
  }

  api.post('/documents/:id/action-toggle', async (req: AuthedRequest, res) => {
    const r = await memberDoc(req, res);
    if (!r) return;
    const action = r.doc.actions.find(a => a.id === req.body.actionId);
    if (!action) { res.status(404).json({ error: 'action_not_found' }); return; }
    action.completed = !action.completed;
    await repo.saveDocument(r.doc);
    res.json({ success: true, completed: action.completed });
  });

  api.post('/documents/:id/feedback', async (req: AuthedRequest, res) => {
    const r = await memberDoc(req, res);
    if (!r) return;
    const fb = req.body.feedback;
    if (fb !== 'up' && fb !== 'down') { res.status(400).json({ error: 'bad_feedback' }); return; }
    r.doc.feedback = fb;
    const note = String(req.body.note || '').trim().slice(0, 300);
    if (note) r.doc.date_corrections = [...(r.doc.date_corrections || []), note];
    await repo.saveDocument(r.doc);
    res.json({ success: true });
  });

  /** Correct dates/times the model got wrong (feeds the ICS feed immediately). */
  api.patch('/documents/:id', async (req: AuthedRequest, res) => {
    const r = await memberDoc(req, res);
    if (!r) return;
    const { doc } = r;
    for (const patch of (req.body.events || []) as Array<Record<string, string>>) {
      const e = doc.events.find(x => x.id === patch.id);
      if (!e) continue;
      if (patch.date !== undefined) { if (!isValidIsoDate(patch.date)) { res.status(400).json({ error: 'bad_date' }); return; } e.date = patch.date; e.date_uncertain = false; }
      if (patch.start_time !== undefined) e.start_time = isValidHm(patch.start_time) ? patch.start_time : undefined;
      if (patch.end_time !== undefined) e.end_time = isValidHm(patch.end_time) && e.start_time && patch.end_time > e.start_time ? patch.end_time : undefined;
      e.time = e.start_time ? (e.end_time ? `${e.start_time} - ${e.end_time}` : e.start_time) : undefined;
      if (patch.title_vi) e.title_vi = String(patch.title_vi).slice(0, 200);
    }
    for (const patch of (req.body.actions || []) as Array<Record<string, string>>) {
      const a = doc.actions.find(x => x.id === patch.id);
      if (!a) continue;
      if (patch.deadline !== undefined) {
        if (patch.deadline && !isValidIsoDate(patch.deadline)) { res.status(400).json({ error: 'bad_date' }); return; }
        a.deadline = patch.deadline || undefined;
        a.deadline_uncertain = false;
      }
      if (patch.todo_vi) a.todo_vi = String(patch.todo_vi).slice(0, 500);
    }
    doc.date_corrections = [...(doc.date_corrections || []), `edited ${new Date().toISOString()}`];
    await repo.saveDocument(doc);
    res.json({ document: doc });
  });

  api.delete('/documents/:id', async (req: AuthedRequest, res) => {
    const r = await memberDoc(req, res);
    if (!r) return;
    res.json({ success: await repo.deleteDocument(r.fam.family_id, r.doc.id) });
  });

  /** Mark urgent → one LINE push to the family chat (counts against the monthly push quota). */
  api.post('/documents/:id/toggle-urgent', async (req: AuthedRequest, res) => {
    const r = await memberDoc(req, res);
    if (!r) return;
    const { doc, fam } = r;
    doc.is_urgent = !doc.is_urgent;
    let notification_text: string | undefined;
    if (doc.is_urgent) {
      doc.urgent_reason = String(req.body.reason || '').slice(0, 200) || undefined;
      const usage = await repo.getUsage(jstMonth());
      const open = doc.actions.filter(a => !a.completed);
      const nearest = open.map(a => a.deadline).filter(Boolean).sort()[0] || doc.events.map(e => e.date).sort()[0];
      notification_text = [
        `🚨 GẤP: ${doc.title_vi}`,
        nearest ? `⏰ Hạn gần nhất: ${nearest}` : '',
        ...open.map(a => `• ${a.todo_vi}${a.deadline ? ` (hạn ${a.deadline})` : ''}`),
        doc.urgent_reason ? `📝 ${doc.urgent_reason}` : '',
      ].filter(Boolean).join('\n');
      if (usage.push_messages < cfg.pushLimit && (await line.push(fam.line_chat_id, [text(notification_text)]))) {
        await repo.addUsage(jstMonth(), { push_messages: 1 });
        doc.urgent_notified_at = new Date().toISOString();
      }
    } else {
      doc.urgent_reason = undefined;
    }
    await repo.saveDocument(doc);
    res.json({ success: true, is_urgent: doc.is_urgent, notified_at: doc.urgent_notified_at, notification_text });
  });

  api.post('/family/delete-all', async (req: AuthedRequest, res) => {
    const fam = await memberFamily(req, res);
    if (!fam) return;
    const n = await services.purgeFamilyData(fam.family_id, req.userId!);
    res.json({ success: true, deleted: n });
  });

  api.post('/family/ics-token/rotate', async (req: AuthedRequest, res) => {
    const fam = await memberFamily(req, res);
    if (!fam) return;
    const token = await services.rotateIcsToken(fam.family_id, req.userId!);
    res.json({ success: !!token, ics_token: token, ics_url: token ? icsUrl(cfg, { ...fam, ics_token: token }) : null });
  });

  /**
   * Read a paper photographed inside the LIFF app (same pipeline as LINE photos).
   * Body: { familyId, pages: [{ data: base64, mediaType }] } — the client downsizes images first.
   */
  api.post('/documents/upload', async (req: AuthedRequest, res) => {
    const fam = await memberFamily(req, res);
    if (!fam) return;
    const raw = Array.isArray(req.body.pages) ? req.body.pages : [];
    if (!raw.length || raw.length > cfg.maxPagesPerDoc) {
      res.status(400).json({ error: `1–${cfg.maxPagesPerDoc} trang` });
      return;
    }
    const pages: Page[] = [];
    for (const p of raw) {
      const mediaType = String(p?.mediaType || '');
      const data = Buffer.from(String(p?.data || ''), 'base64');
      const isPdf = mediaType === 'application/pdf';
      if (!isPdf && !(SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mediaType)) {
        res.status(400).json({ error: 'Chỉ nhận ảnh JPG/PNG/WebP hoặc PDF' });
        return;
      }
      if (!data.length || data.length > (isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
        res.status(413).json({ error: 'File quá lớn' });
        return;
      }
      pages.push({ data, mediaType });
    }
    const r = await bot.ingest(fam.family_id, pages);
    if (r.kind === 'blocked' || r.kind === 'error') {
      res.status(r.kind === 'blocked' ? 403 : 422).json({ error: r.message });
      return;
    }
    res.json({ result: r.kind, added: r.kind === 'duplicate' ? r.added : undefined, document: r.doc });
  });

  api.post('/compose-renraku', async (req: AuthedRequest, res) => {
    const fam = await memberFamily(req, res);
    if (!fam) return;
    const content = String(req.body.content_vi || '').trim();
    if (!content) { res.status(400).json({ error: 'empty' }); return; }
    const usage = await repo.getUsage(jstMonth());
    if (usage.cost_usd >= cfg.monthlyBudgetUsd) { res.status(429).json({ error: 'budget_exhausted' }); return; }
    const { result, cost_usd } = await deps.composer.compose({
      topic: req.body.topic || 'general', content_vi: content, child_name: req.body.child_name, class_name: req.body.class_name,
    });
    await repo.addUsage(jstMonth(), { cost_usd });
    res.json(result);
  });

  // ---------- Admin (metadata only — never document content) ----------
  const admin = express.Router();
  admin.use(requireAdmin);

  admin.get('/metrics', async (_req, res) => {
    const [families, meta, usage, errors] = await Promise.all([
      repo.listFamilies(), repo.listDocumentMeta(), repo.getUsage(jstMonth()), repo.listErrors(20),
    ]);
    const docsByType = Object.fromEntries(DOC_TYPES.map(t => [t, 0])) as Record<DocType, number>;
    let up = 0, down = 0, urgent = 0;
    for (const d of meta) {
      docsByType[DOC_TYPES.includes(d.doc_type) ? d.doc_type : 'other']++;
      if (d.feedback === 'up') up++;
      if (d.feedback === 'down') down++;
      if (d.is_urgent) urgent++;
    }
    const metrics: AdminMetrics = {
      total_families: families.filter(f => f.status !== 'left').length,
      active_families: families.filter(f => f.status === 'active').length,
      max_beta_families: cfg.maxBetaFamilies,
      total_documents_processed: meta.length,
      docs_by_type: docsByType,
      monthly_cost_usd: Number(usage.cost_usd.toFixed(4)),
      monthly_budget_usd: cfg.monthlyBudgetUsd,
      accuracy_rate: up + down ? Math.round((up / (up + down)) * 100) : null,
      thumbs_up: up,
      thumbs_down: down,
      push_messages_used: usage.push_messages,
      push_messages_limit: cfg.pushLimit,
      urgent_docs_count: urgent,
      recent_errors: errors,
    };
    res.json({ metrics, usage });
  });

  admin.get('/families', async (_req, res) => {
    res.json({ families: (await repo.listFamilies()).map(adminFamily) });
  });

  admin.get('/invite-codes', async (_req, res) => {
    res.json({ invite_codes: await repo.listInviteCodes() });
  });

  admin.post('/invite-codes', async (req: AuthedRequest, res) => {
    const code = normalizeCode(String(req.body.code || ''));
    if (code.length < 4) { res.status(400).json({ error: 'code must be ≥4 chars [A-Z0-9-]' }); return; }
    if (await repo.getInviteCode(code)) { res.status(409).json({ error: 'exists' }); return; }
    const invite = makeInvite(code, {
      quota: Number(req.body.quota) || cfg.defaultQuota,
      maxUses: Number(req.body.maxUses) || cfg.maxBetaFamilies,
      days: Number(req.body.days) || 90,
      note: req.body.note,
    }, new Date());
    await repo.saveInviteCode(invite);
    await services.audit(req.userId!, 'CREATE_INVITE_CODE', `Tạo mã ${invite.code} (max ${invite.max_uses}, quota ${invite.quota_per_family})`);
    res.json({ invite_code: invite });
  });

  admin.patch('/invite-codes/:code', async (req: AuthedRequest, res) => {
    const inv = await repo.getInviteCode(normalizeCode(req.params.code));
    if (!inv) { res.status(404).json({ error: 'not_found' }); return; }
    if (typeof req.body.is_active === 'boolean') inv.is_active = req.body.is_active;
    if (req.body.maxUses) inv.max_uses = Number(req.body.maxUses);
    await repo.saveInviteCode(inv);
    await services.audit(req.userId!, 'UPDATE_INVITE_CODE', `Cập nhật mã ${inv.code}: active=${inv.is_active}, max=${inv.max_uses}`);
    res.json({ invite_code: inv });
  });

  admin.post('/quota', async (req: AuthedRequest, res) => {
    const fam = await repo.getFamily(String(req.body.familyId || ''));
    const q = Number(req.body.newQuota);
    if (!fam || !Number.isInteger(q) || q < 0 || q > 1000) { res.status(400).json({ success: false }); return; }
    fam.quota_limit = q;
    await repo.saveFamily(fam);
    await services.audit(req.userId!, 'UPDATE_QUOTA', `Quota → ${q}/tháng`, fam.family_id);
    res.json({ success: true });
  });

  admin.post('/suspend', async (req: AuthedRequest, res) => {
    const fam = await repo.getFamily(String(req.body.familyId || ''));
    if (!fam || (fam.status !== 'active' && fam.status !== 'suspended')) { res.status(400).json({ success: false }); return; }
    fam.status = fam.status === 'suspended' ? 'active' : 'suspended';
    await repo.saveFamily(fam);
    await services.audit(req.userId!, 'TOGGLE_SUSPEND', `Trạng thái → ${fam.status}`, fam.family_id);
    res.json({ success: true, status: fam.status });
  });

  admin.get('/audit-logs', async (_req, res) => {
    res.json({ audit_logs: await repo.listAudit(100) });
  });

  api.use('/admin', admin);

  // ---------- Dev simulator (never mounted in production) ----------
  if (cfg.devMode && line instanceof RecordingLineApi) {
    const rec = line;
    let seq = 0;
    api.post('/dev/simulate', async (req: AuthedRequest, res) => {
      const { chatType = 'group', kind = 'text', textMessage, imageBase64, mimeType = 'image/jpeg', presetId, postbackData, pages = 1 } = req.body;
      const source = chatType === 'group'
        ? { type: 'group', groupId: 'Cdev_group_0001', userId: req.userId }
        : { type: 'user', userId: req.userId };
      const before = rec.sent.length;
      const events: unknown[] = [];
      const mk = (extra: object) => ({ webhookEventId: `dev${Date.now()}${seq++}`, timestamp: Date.now(), source, replyToken: `rt_${seq}`, ...extra });
      if (kind === 'join') events.push(mk({ type: chatType === 'group' ? 'join' : 'follow' }));
      if (kind === 'text') events.push(mk({ type: 'message', message: { id: `m${seq}`, type: 'text', text: String(textMessage || '') } }));
      if (kind === 'postback') events.push(mk({ type: 'postback', postback: { data: String(postbackData || '') } }));
      if (kind === 'image') {
        const n = Math.min(Number(pages) || 1, cfg.maxPagesPerDoc);
        for (let i = 0; i < n; i++) {
          const id = `img${Date.now()}${seq++}`;
          const data = imageBase64 ? Buffer.from(imageBase64, 'base64') : Buffer.from(`preset:${presetId}:${Date.now()}:${i}`);
          rec.contents.set(id, { data, contentType: mimeType, hint: presetId });
          events.push(mk({ type: 'message', message: { id, type: mimeType === 'application/pdf' ? 'file' : 'image', fileName: mimeType === 'application/pdf' ? 'doc.pdf' : undefined, imageSet: n > 1 ? { id: 'set', index: i + 1, total: n } : undefined } }));
        }
      }
      await bot.handleWebhook({ events });
      await bot.aggregator.flushAll();
      res.json({ messages: rec.sent.slice(before).flatMap(s => s.messages.map(m => ({ ...m, via: s.kind }))) });
    });
  }

  app.use('/api', api);
  return { app, bot };
}

