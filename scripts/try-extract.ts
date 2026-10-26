/**
 * Run the real extraction pipeline on local photos/PDFs (one document, pages in order).
 *
 *   ANTHROPIC_API_KEY=... npx tsx scripts/try-extract.ts page1.jpg [page2.jpg ...] [--json] [--ics]
 *
 * Prints the LINE reply exactly as families would see it, model routing, tokens and cost.
 * Without ANTHROPIC_API_KEY it uses the offline mock (useful to check formatting only).
 */
import fs from 'fs';
import path from 'path';
import { ClaudeExtractor, MockExtractor, Page, toDocument } from '../src/server/extract.ts';
import { formatDocumentReply } from '../src/server/bot.ts';
import { generateIcsCalendar } from '../src/server/ics.ts';
import { jstDate } from '../src/server/time.ts';
import { Family } from '../src/types/index.ts';
import '../src/server/config.ts'; // loads .env

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
};

async function main() {
  const args = process.argv.slice(2);
  const files = args.filter(a => !a.startsWith('--'));
  if (!files.length) {
    console.error('Usage: npx tsx scripts/try-extract.ts <image|pdf> [...more pages] [--json] [--ics]');
    process.exit(1);
  }
  const pages: Page[] = files.map(f => {
    const mediaType = MIME[path.extname(f).toLowerCase()];
    if (!mediaType) throw new Error(`Unsupported file type: ${f}`);
    return { data: fs.readFileSync(f), mediaType };
  });

  const live = !!process.env.ANTHROPIC_API_KEY;
  const extractor = live ? new ClaudeExtractor(process.env.ANTHROPIC_API_KEY) : new MockExtractor();
  const started = Date.now();
  const outcome = await extractor.extract(pages, { today: jstDate() });
  const doc = toDocument(outcome, { familyId: 'local', pages: pages.length, now: new Date(), retentionDays: 90 });

  console.log(`\n=== ${live ? 'Claude' : 'MOCK (no ANTHROPIC_API_KEY)'} · ${((Date.now() - started) / 1000).toFixed(1)}s ===`);
  for (const r of outcome.runs) {
    console.log(`  ${r.model.padEnd(18)} in=${r.input_tokens} out=${r.output_tokens} $${r.cost_usd.toFixed(5)}`);
  }
  console.log(`  → used: ${outcome.model} · doc_type=${doc.doc_type} · confidence=${doc.confidence}`);
  console.log(`  → total $${doc.token_usage?.estimated_cost_usd.toFixed(5)} (≈ ¥${((doc.token_usage?.estimated_cost_usd || 0) * 155).toFixed(2)})`);
  console.log('\n=== LINE reply ===\n' + formatDocumentReply(doc));
  if (args.includes('--json')) console.log('\n=== JSON ===\n' + JSON.stringify(doc, null, 2));
  if (args.includes('--ics')) console.log('\n=== ICS ===\n' + generateIcsCalendar({ family_name: 'Thử nghiệm' } as Family, [doc]));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
