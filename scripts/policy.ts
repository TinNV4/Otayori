/**
 * Policy newsletter operations. Same storage as the server (STORAGE=firestore|file).
 *
 *   npm run policy -- sources                          # the official sources and their list URLs
 *   npm run policy -- fetch --dry [--source isa]       # show which links would be read (no Claude, nothing saved) — run this first
 *   npm run policy -- fetch [--source isa] [--max 10]  # read new official pages → AI drafts (pending review)
 *   npm run policy -- list [--status pending]          # drafts / approved / rejected
 *   npm run policy -- show <id>                        # full draft + who would receive it
 *   npm run policy -- approve <id> [--severity red|yellow|green]   # publish; 🔴 is pushed right away (needs LINE_CHANNEL_ACCESS_TOKEN)
 *   npm run policy -- reject <id>
 *   npm run policy -- tier <userId> free|premium       # Premium = gets pushes when POLICY_PREMIUM_ONLY_PUSH=true
 *   npm run policy -- stats                            # charts: items, users, push budget
 *
 * Nothing is ever sent without `approve`. Needs ANTHROPIC_API_KEY for real summaries (mock otherwise).
 */
import { loadConfig } from '../src/server/config.ts';
import { createRepo } from '../src/server/db/index.ts';
import { LineClient, RecordingLineApi } from '../src/server/line.ts';
import { ClaudePolicyAnalyzer, MockPolicyAnalyzer } from '../src/server/policy/analyzer.ts';
import { cityLabel, fmtDay, matchItem, visaLabel } from '../src/server/policy/match.ts';
import { PolicyService } from '../src/server/policy/service.ts';
import { POLICY_SOURCES } from '../src/server/policy/sources.ts';
import { jstMonth } from '../src/server/time.ts';
import { PolicyStatus, SEVERITY_ICON, Severity } from '../src/types/policy.ts';

const cfg = { ...loadConfig({ ...process.env, NODE_ENV: 'development' }), storage: (process.env.STORAGE as 'firestore' | 'file') || 'file' };
const repo = createRepo(cfg);
const canPush = !!cfg.lineChannelAccessToken;
const line = canPush ? new LineClient(cfg.lineChannelAccessToken) : new RecordingLineApi();
const analyzer = cfg.anthropicApiKey ? new ClaudePolicyAnalyzer(cfg.anthropicApiKey) : new MockPolicyAnalyzer();
const svc = new PolicyService({ repo, cfg, line, analyzer });

function flag(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);
const bar = (v: number, max: number, width = 24) => { const n = max ? Math.round((v / max) * width) : 0; return '█'.repeat(n) + '░'.repeat(width - n); };
const count = <T>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => { m[key(x)] = (m[key(x)] || 0) + 1; return m; }, {});

function chart(title: string, counts: Record<string, number>) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(r => r[1]));
  console.log(`\n  ${title}`);
  if (!rows.length) console.log('  (trống)');
  for (const [k, n] of rows) console.log(`  ${k.padEnd(22)} ${bar(n, max)} ${n}`);
}

async function main() {
  const [cmd, a1] = process.argv.slice(2);
  switch (cmd) {
    case 'sources':
      console.table(POLICY_SOURCES.map(s => ({ id: s.id, issuer: s.issuer, city: s.city || '-', url: s.listUrl })));
      break;
    case 'fetch': {
      if (!cfg.anthropicApiKey && !has('dry')) console.warn('⚠️  Không có ANTHROPIC_API_KEY — dùng bản tóm tắt MẪU (mock), chỉ để thử luồng.');
      const r = await svc.ingest({ dry: has('dry'), sourceId: flag('source'), maxNew: flag('max') ? Number(flag('max')) : undefined });
      for (const s of r.sources) {
        console.log(`\n${s.id}: ${s.links} link ứng viên · ${s.fresh} mới${has('dry') ? '' : ` · ${s.pending} chờ duyệt · ${s.ignored} bỏ qua`}`);
        s.sample?.forEach(l => console.log(`   • ${l.text.slice(0, 50)}  ${l.url}`));
        s.errors.forEach(e => console.log(`   ✗ ${e}`));
        if (has('dry') && s.links === 0 && !s.errors.length) console.log('   ⚠ 0 link: chỉnh listUrl/linkPattern/keywords trong src/server/policy/sources.ts');
      }
      if (!has('dry')) console.log(`\nChi phí Claude: $${r.cost_usd.toFixed(4)} · bản nháp mới: ${r.created}${r.created ? '  → npm run policy -- list' : ''}`);
      break;
    }
    case 'list': {
      const status = (flag('status', 'pending') as PolicyStatus | 'all');
      const items = await repo.listPolicyItems(status === 'all' ? undefined : status);
      console.table(items.map(i => ({
        id: i.id, sev: SEVERITY_ICON[i.severity], status: i.status, src: i.source_id, title: i.title_vi.slice(0, 40),
        effective: i.effective_date || '', deadline: i.deadline || '', conf: i.confidence.toFixed(2), sent: i.pushed_user_ids.length,
      })));
      break;
    }
    case 'show': {
      const i = await repo.getPolicyItem(a1 || '');
      if (!i) throw new Error('không tìm thấy');
      const profiles = await repo.listPolicyProfiles();
      const who = profiles.filter(p => matchItem(p, i));
      console.log(`\n${SEVERITY_ICON[i.severity]} ${i.title_vi}\n   ${i.title_jp}\n   ${i.issuer}\n   ${i.url}`);
      console.log(`\n${i.summary_vi}\n\n✅ ${i.action_vi || '(không có việc cần làm)'}`);
      console.log(`\nGiai đoạn: ${i.stage === 'proposed' ? 'đang lấy ý kiến' : 'đã chốt'} · áp dụng: ${i.effective_date ? fmtDay(i.effective_date) : '?'} · hạn: ${i.deadline ? fmtDay(i.deadline) : '-'} · tin cậy ${i.confidence}`);
      console.log(`Đối tượng: visa=${i.audience.visa_types.join(',') || 'mọi loại'} · thành phố=${i.audience.cities.join(',') || 'toàn quốc'} · chỉ nhà có con=${i.audience.children_only} · liên quan gia hạn=${i.audience.renewal_related}`);
      console.log(`Sẽ tới ${who.length}/${profiles.length} người dùng. ⚠ Mở link gốc, đối chiếu ngày & đối tượng trước khi duyệt.\n`);
      break;
    }
    case 'approve': {
      const sev = flag('severity') as Severity | undefined;
      if (sev && !['red', 'yellow', 'green'].includes(sev)) throw new Error('--severity phải là red|yellow|green');
      const r = await svc.approve(a1 || '', 'cli', sev, { dispatch: canPush });
      if (!r) throw new Error('không tìm thấy hoặc không ở trạng thái chờ duyệt');
      console.log(`${SEVERITY_ICON[r.item.severity]} Đã duyệt: ${r.item.title_vi}`);
      if (r.item.severity !== 'red') console.log('   Hiện trong tab Chính sách của người dùng (không push).');
      else if (!canPush) console.log('   🔴 Chưa push vì thiếu LINE_CHANNEL_ACCESS_TOKEN — job hằng ngày (/tasks/policy) hoặc duyệt qua API sẽ gửi.');
      else console.log(`   Đã push: ${r.dispatch.sent} · lỗi: ${r.dispatch.failed} · hoãn vì quota: ${r.dispatch.deferred}`);
      break;
    }
    case 'reject': {
      const i = await svc.reject(a1 || '', 'cli');
      if (!i) throw new Error('không tìm thấy');
      console.log(`Đã loại: ${i.title_vi}`);
      break;
    }
    case 'tier': {
      const tier = process.argv[4];
      if (tier !== 'free' && tier !== 'premium') throw new Error('dùng: tier <userId> free|premium');
      if (!(await svc.setTier(a1 || '', tier))) throw new Error('người dùng chưa có hồ sơ chính sách');
      console.log(`${a1} → ${tier}${cfg.policyPremiumOnlyPush ? '' : ' (POLICY_PREMIUM_ONLY_PUSH chưa bật: mọi người vẫn nhận push)'}`);
      break;
    }
    case 'stats': {
      const { items, profiles, usage } = await svc.stats();
      chart('Tin theo trạng thái', count(items, i => i.status));
      chart('Tin đã duyệt theo mức', count(items.filter(i => i.status === 'approved'), i => `${SEVERITY_ICON[i.severity]} ${i.severity}`));
      chart('Người dùng theo visa', count(profiles, p => visaLabel(p.visa_type).slice(0, 20)));
      chart('Người dùng theo nơi ở', count(profiles, p => cityLabel(p.city)));
      chart('Người dùng theo gói', count(profiles, p => p.tier || 'free'));
      chart('Hồ sơ đã điền thêm', {
        'bằng lái': profiles.filter(p => p.license_status).length,
        'hợp đồng': profiles.filter(p => p.contract_type).length,
        'kế hoạch': profiles.filter(p => p.plan).length,
        '住民税 tự đóng': profiles.filter(p => p.resident_tax === 'ordinary').length,
      });
      const reds = items.filter(i => i.status === 'approved' && i.severity === 'red');
      const redPush = reds.reduce((n, i) => n + i.pushed_user_ids.length, 0);
      const expiring = profiles.filter(p => p.visa_expiry || p.license_expiry).length;
      console.log(`\n  Push LINE ${jstMonth()}`);
      console.log(`  Đã dùng   ${bar(usage.push_messages, cfg.pushLimit)} ${usage.push_messages}/${cfg.pushLimit}`);
      console.log(`  Tin 🔴 đã gửi: ${redPush} (${reds.length} tin) · hồ sơ có ngày hết hạn visa/bằng lái (nhận nhắc 1 lần mỗi mốc): ${expiring}`);
      console.log(`  Ước tính tháng sau: ${profiles.length} người × ~2 tin 🔴 + ${expiring} nhắc visa ≈ ${profiles.length * 2 + expiring} push (giữ dự phòng 20)\n`);
      break;
    }
    default:
      console.log('Commands: sources fetch list show approve reject tier stats (xem đầu file scripts/policy.ts)');
  }
  if ('flushSync' in repo) (repo as { flushSync(): void }).flushSync();
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
