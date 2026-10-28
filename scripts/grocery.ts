/**
 * Curate the "đi chợ" tables (data/grocery/*.json): Claude drafts, an admin verifies, git keeps the history.
 *
 *   npx tsx scripts/grocery.ts check                              # integrity + how much is verified (bars)
 *   npx tsx scripts/grocery.ts list [--status draft] [--table ingredients|dishes|substitutes]
 *   npx tsx scripts/grocery.ts verify <id>... --table <t> --by <name>   # or: verify --all --table <t> --by <name>
 *   npx tsx scripts/grocery.ts export [--status draft] > review.csv     # to check in a spreadsheet
 *   npx tsx scripts/grocery.ts ask "phở bò"                       # the bot's answer, offline (typed questions need no model)
 *   npx tsx scripts/grocery.ts ask --file label.jpg               # read a label with Claude (needs ANTHROPIC_API_KEY)
 *
 * Verify only after checking the Japanese name on a real shelf/label and where it is really sold.
 */
import fs from 'fs';
import path from 'path';
import '../src/server/config.ts'; // loads .env
import { Page } from '../src/server/extract.ts';
import { answerGrocery } from '../src/server/lens/grocery/core.ts';
import { checkGrocery, loadGrocery, reviewStats } from '../src/server/lens/grocery/data.ts';
import { ClaudeLabelRecognizer, MockLabelRecognizer } from '../src/server/lens/grocery/recognize.ts';
import { GroceryData, Reviewed } from '../src/server/lens/grocery/types.ts';

const dir = process.env.GROCERY_DIR || 'data/grocery';
const args = process.argv.slice(2);
const [cmd, ...rest] = args;
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n: string) => args.includes(`--${n}`);
const TABLES = ['ingredients', 'dishes', 'substitutes'] as const;
type Table = (typeof TABLES)[number];
const idOf = (t: Table, r: { id?: string; from?: string }) => (t === 'substitutes' ? r.from! : r.id!);
const bar = (v: number, max: number, w = 24) => '█'.repeat(max ? Math.round((v / max) * w) : 0).padEnd(w, '░');

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

async function main() {
  switch (cmd) {
    case 'check': {
      // read raw (not loadGrocery) so problems are listed instead of thrown
      const raw = Object.fromEntries(TABLES.map(t => [t, fs.existsSync(path.join(dir, `${t}.json`)) ? JSON.parse(fs.readFileSync(path.join(dir, `${t}.json`), 'utf8')) : []])) as unknown as GroceryData;
      const issues = checkGrocery(raw);
      const s = reviewStats(raw);
      console.log('Verified rows (an admin has checked them)\n');
      for (const t of TABLES) console.log(`  ${t.padEnd(12)} ${bar(s[t].verified, s[t].total)} ${s[t].verified}/${s[t].total}`);
      console.log(issues.length ? `\n❌ ${issues.length} problem(s):\n  ${issues.join('\n  ')}` : '\n✅ References and aliases are consistent.');
      if (issues.length) process.exitCode = 1;
      break;
    }

    case 'list': {
      const data = loadGrocery(dir);
      const status = flag('status');
      for (const t of TABLES.filter(x => !flag('table') || x === flag('table'))) {
        const rows = (data[t] as Array<Reviewed & { id?: string; from?: string; vi?: string; jp?: string }>).filter(r => !status || r.status === status);
        console.log(`\n${t} (${rows.length})`);
        for (const r of rows) console.log(`  ${r.status === 'verified' ? '✅' : '📝'} ${idOf(t, r).padEnd(22)} ${r.vi ?? ''}${r.jp ? ` — ${r.jp}` : ''}`);
      }
      break;
    }

    case 'verify': {
      const table = flag('table') as Table | undefined;
      const by = flag('by');
      if (!table || !TABLES.includes(table)) throw new Error('--table ingredients|dishes|substitutes required');
      if (!by) throw new Error('--by <your name> required: this is the audit trail');
      const ids = rest.filter((a, i) => !a.startsWith('--') && !['--table', '--by'].includes(rest[i - 1]));
      if (!ids.length && !has('all')) throw new Error('give ids, or --all');
      const file = path.join(dir, `${table}.json`);
      const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<Reviewed & { id?: string; from?: string }>;
      const at = new Date().toISOString();
      let n = 0;
      for (const r of rows) {
        if (r.status === 'verified' || (!has('all') && !ids.includes(idOf(table, r)))) continue;
        r.status = 'verified'; r.verified_by = by; r.verified_at = at; n++;
      }
      const unknown = ids.filter(id => !rows.some(r => idOf(table, r) === id));
      if (unknown.length) throw new Error(`no such id in ${table}: ${unknown.join(', ')}`);
      fs.writeFileSync(file, JSON.stringify(rows, null, 1) + '\n');
      console.log(`Verified ${n} row(s) in ${table} as ${by}.`);
      break;
    }

    case 'export': {
      const data = loadGrocery(dir);
      const status = flag('status');
      const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      console.log('table,id,vi,jp,where,storage_vi,note_vi,status');
      for (const i of data.ingredients.filter(r => !status || r.status === status)) console.log(['ingredients', i.id, i.vi, [i.jp, ...i.jp_alt].join(' / '), i.where.join('+'), i.storage_vi, i.note_vi, i.status].map(q).join(','));
      for (const d of data.dishes.filter(r => !status || r.status === status)) console.log(['dishes', d.id, d.vi, d.jp, '', d.desc_vi, d.ingredients.map(l => l.id).join(' '), d.status].map(q).join(','));
      for (const s of data.substitutes.filter(r => !status || r.status === status)) console.log(['substitutes', s.from, '', '', '', s.options.map(o => `${o.vi} [${o.similarity}]`).join(' | '), '', s.status].map(q).join(','));
      break;
    }

    case 'ask': {
      const data = loadGrocery(dir);
      const file = flag('file');
      const text = rest.find((a, i) => !a.startsWith('--') && rest[i - 1] !== '--file');
      if (!file && !text) throw new Error('give a question or --file <label photo>');
      const live = !!process.env.ANTHROPIC_API_KEY;
      const pages: Page[] | undefined = file ? [{ data: fs.readFileSync(file), mediaType: MIME[path.extname(file).toLowerCase()] ?? (() => { throw new Error(`Unsupported image: ${file}`); })() }] : undefined;
      const a = await answerGrocery({ text, pages }, { data, recognizer: live ? new ClaudeLabelRecognizer(process.env.ANTHROPIC_API_KEY) : new MockLabelRecognizer() });
      console.log(`\n=== ${file ? (live ? 'Claude' : 'MOCK (no ANTHROPIC_API_KEY)') : 'no model'} · outcome=${a.outcome} · $${a.cost_usd.toFixed(5)} ===\n`);
      for (const m of a.messages) console.log(String(m.text) + '\n---');
      break;
    }

    default:
      console.log('Commands: check list verify export ask (see header of scripts/grocery.ts)');
  }
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
