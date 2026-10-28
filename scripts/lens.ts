/**
 * Try the garbage-sorting module from the terminal, with the same code the bot will call.
 *
 *   npx tsx scripts/lens.ts "pin sạc" --city 12345
 *   npx tsx scripts/lens.ts --file photo.jpg --city 12345 [--json]
 *
 * Reads the live master data written by `npm run data` ($MASTERDATA_DIR, default data/masterdata).
 * Uses Claude when ANTHROPIC_API_KEY is set; otherwise an offline mock that treats your text as the
 * Japanese item name (good for checking the dictionary and the national rules, not for photos).
 * Items missing from the dictionary are counted in the dev database (`npm run admin -- unknown`).
 */
import fs from 'fs';
import path from 'path';
import '../src/server/config.ts'; // loads .env
import { loadConfig } from '../src/server/config.ts';
import { createRepo } from '../src/server/db/index.ts';
import { Page } from '../src/server/extract.ts';
import { answerGomi } from '../src/server/lens/gomi/core.ts';
import { dictionaryFromStore } from '../src/server/lens/gomi/dictionary.ts';
import { ClaudeRecognizer, MockRecognizer } from '../src/server/lens/gomi/recognize.ts';
import { loadSources } from '../src/server/lens/masterdata/registry.ts';
import { FileMasterStore } from '../src/server/lens/masterdata/store.ts';

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

async function main() {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const city = flag('city');
  const file = flag('file');
  const query = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--json'));
  if (!city || (!query && !file)) {
    console.error('Usage: npx tsx scripts/lens.ts "<item name>" | --file <photo> --city <5-digit JIS code> [--chome <code>] [--json]');
    process.exit(1);
  }

  const pages: Page[] | undefined = file
    ? [{ data: fs.readFileSync(file), mediaType: MIME[path.extname(file).toLowerCase()] ?? (() => { throw new Error(`Unsupported image: ${file}`); })() }]
    : undefined;

  const live = !!process.env.ANTHROPIC_API_KEY;
  const store = new FileMasterStore(process.env.MASTERDATA_DIR || 'data/masterdata');
  const sources = loadSources(process.env.MASTERDATA_SOURCES || 'data/sources');
  const cfg = { ...loadConfig({ ...process.env, NODE_ENV: 'development' }), storage: 'file' as const };
  const repo = createRepo(cfg);

  const started = Date.now();
  const answer = await answerGomi({ pages, text: pages ? undefined : query }, { city_code: city, chome_code: flag('chome') }, {
    recognizer: live ? new ClaudeRecognizer(process.env.ANTHROPIC_API_KEY) : new MockRecognizer(),
    dictionary: dictionaryFromStore(store, sources),
    repo,
  });
  if ('flushSync' in repo) (repo as { flushSync(): void }).flushSync();

  console.log(`\n=== ${live ? 'Claude' : 'MOCK (no ANTHROPIC_API_KEY)'} · ${((Date.now() - started) / 1000).toFixed(1)}s · outcome=${answer.outcome} · $${answer.cost_usd.toFixed(5)} ===`);
  if (args.includes('--json')) console.log(JSON.stringify(answer.query, null, 2));
  console.log('\n=== LINE reply ===');
  for (const m of answer.messages) console.log(String(m.text) + '\n---');
}

main().catch(err => { console.error(err.message); process.exit(1); });
