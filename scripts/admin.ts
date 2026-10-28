/**
 * Beta operations CLI. Talks to the same storage as the server (STORAGE=firestore|file).
 *
 *   npx tsx scripts/admin.ts invite:create <CODE> [--max 20] [--quota 50] [--days 90] [--note "..."]
 *   npx tsx scripts/admin.ts invite:list
 *   npx tsx scripts/admin.ts invite:disable <CODE>
 *   npx tsx scripts/admin.ts families
 *   npx tsx scripts/admin.ts usage [YYYY-MM]          # cost/docs + bar chart by doc type
 *   npx tsx scripts/admin.ts quota <familyId> <n>
 *   npx tsx scripts/admin.ts unknown [--top 30]        # items asked about but missing from city dictionaries
 *   npx tsx scripts/admin.ts cleanup                   # purge left families (>7d) + expired docs
 *
 * Firestore: run with STORAGE=firestore and Application Default Credentials
 * (`gcloud auth application-default login`, project set via GOOGLE_CLOUD_PROJECT).
 */
import { loadConfig } from '../src/server/config.ts';
import { createRepo } from '../src/server/db/index.ts';
import { makeInvite, normalizeCode, Services } from '../src/server/service.ts';
import { jstMonth } from '../src/server/time.ts';
import { DOC_TYPES } from '../src/types/index.ts';

const cfg = { ...loadConfig({ ...process.env, NODE_ENV: 'development' }), storage: (process.env.STORAGE as 'firestore' | 'file') || 'file' };
const repo = createRepo(cfg);
const services = new Services(repo, cfg);

function flag(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

function bar(value: number, max: number, width = 30) {
  const n = max ? Math.round((value / max) * width) : 0;
  return '█'.repeat(n) + '░'.repeat(width - n);
}

async function main() {
  const [cmd, a1, a2] = process.argv.slice(2);
  switch (cmd) {
    case 'invite:create': {
      if (!a1) throw new Error('code required');
      const code = normalizeCode(a1);
      if (await repo.getInviteCode(code)) throw new Error(`${code} already exists`);
      const inv = makeInvite(code, {
        maxUses: Number(flag('max', String(cfg.maxBetaFamilies))),
        quota: Number(flag('quota', String(cfg.defaultQuota))),
        days: Number(flag('days', '90')),
        note: flag('note'),
      }, new Date());
      await repo.saveInviteCode(inv);
      await services.audit('cli', 'CREATE_INVITE_CODE', `Tạo mã ${inv.code} (max ${inv.max_uses}, quota ${inv.quota_per_family})`);
      console.table([inv]);
      break;
    }
    case 'invite:list':
      console.table((await repo.listInviteCodes()).map(i => ({ ...i, expires_at: i.expires_at.slice(0, 10), created_at: i.created_at.slice(0, 10) })));
      break;
    case 'invite:disable': {
      const inv = await repo.getInviteCode(normalizeCode(a1 || ''));
      if (!inv) throw new Error('not found');
      inv.is_active = false;
      await repo.saveInviteCode(inv);
      await services.audit('cli', 'UPDATE_INVITE_CODE', `Tắt mã ${inv.code}`);
      console.log(`Disabled ${inv.code}`);
      break;
    }
    case 'families':
      console.table((await repo.listFamilies()).map(f => ({
        id: f.family_id, name: f.family_name, status: f.status, code: f.invite_code,
        quota: `${f.quota_used}/${f.quota_limit} (${f.quota_month})`, members: f.members_count ?? f.member_user_ids.length,
        last_active: f.last_active.slice(0, 16),
      })));
      break;
    case 'quota': {
      const fam = await repo.getFamily(a1 || '');
      if (!fam) throw new Error('family not found');
      fam.quota_limit = Number(a2);
      await repo.saveFamily(fam);
      await services.audit('cli', 'UPDATE_QUOTA', `Quota → ${fam.quota_limit}`, fam.family_id);
      console.log(`${fam.family_id} quota → ${fam.quota_limit}`);
      break;
    }
    case 'usage': {
      const month = a1 || jstMonth();
      const u = await repo.getUsage(month);
      const meta = (await repo.listDocumentMeta()).filter(d => jstMonth(new Date(d.created_at)) === month);
      console.log(`\nUsage ${month}`);
      console.log(`  Cost   ${bar(u.cost_usd, cfg.monthlyBudgetUsd)} $${u.cost_usd.toFixed(3)} / $${cfg.monthlyBudgetUsd}`);
      console.log(`  Push   ${bar(u.push_messages, cfg.pushLimit)} ${u.push_messages} / ${cfg.pushLimit}`);
      console.log(`  Docs ${u.docs} · pages ${u.pages} · Sonnet ${u.sonnet_docs} (${u.docs ? Math.round((u.sonnet_docs / u.docs) * 100) : 0}%)`);
      const counts = DOC_TYPES.map(t => [t, meta.filter(d => d.doc_type === t).length] as const).filter(([, n]) => n);
      const max = Math.max(1, ...counts.map(([, n]) => n));
      if (counts.length) console.log('\n  Docs by type (stored, this month)');
      for (const [t, n] of counts) console.log(`  ${t.padEnd(13)} ${bar(n, max, 24)} ${n}`);
      const up = meta.filter(d => d.feedback === 'up').length;
      const down = meta.filter(d => d.feedback === 'down').length;
      console.log(`\n  Feedback 👍 ${up} · 👎 ${down}${up + down ? ` · accuracy ${Math.round((up / (up + down)) * 100)}%` : ''}\n`);
      break;
    }
    case 'unknown': {
      const list = await repo.listUnknownItems(Number(flag('top', '30')));
      if (!list.length) { console.log('Nothing missing — every question matched a dictionary entry.'); break; }
      const max = Math.max(...list.map(u => u.count));
      console.log('\nAsked, but not in the city dictionary (most asked first)\n');
      for (const u of list) console.log(`  ${u.city_code}  ${(u.name_jp + (u.name_vi ? ` (${u.name_vi})` : '')).padEnd(34)} ${bar(u.count, max, 20)} ${u.count}  last ${u.last_seen.slice(0, 10)}`);
      console.log();
      break;
    }
    case 'cleanup':
      console.log(await services.runCleanup());
      break;
    default:
      console.log('Commands: invite:create invite:list invite:disable families usage quota unknown cleanup (see header of scripts/admin.ts)');
  }
  if ('flushSync' in repo) (repo as { flushSync(): void }).flushSync();
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
