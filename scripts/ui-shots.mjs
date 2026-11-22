// Screenshot LIFF screens in dev mode (phone size) for visual review.
// Usage: start the dev server (DEV_MODE, no LIFF_ID, ADMIN_USER_IDS=U_dev_parent), then
//   node scripts/ui-shots.mjs [baseUrl] [outDir]
// Seeds a family via /api/dev/simulate (join + invite code BETA2026) and a policy profile.
import { createRequire } from 'module';
const { chromium, devices } = createRequire(import.meta.url)('playwright'); // global install is fine (CJS resolve)
import fs from 'fs';

const base = process.argv[2] || 'http://localhost:3000';
const out = process.argv[3] || 'shots';
fs.mkdirSync(out, { recursive: true });
const H = { 'content-type': 'application/json', 'x-dev-user-id': 'U_dev_parent' };
const post = (p, body) => fetch(base + p, { method: 'POST', headers: H, body: JSON.stringify(body) }).then(r => r.json());

await post('/api/dev/simulate', { kind: 'join' });
await post('/api/dev/simulate', { kind: 'postback', postbackData: 'action=accept_terms' });
await post('/api/dev/simulate', { textMessage: 'BETA2026' });
const browser = await chromium.launch();
async function shot(name, url) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await page.goto(base + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log('saved', `${out}/${name}.png`);
  await ctx.close();
}

const feed = await fetch(base + '/api/policy/feed', { headers: H }).then(r => r.json());
await fetch(base + '/api/policy/profile', { method: 'DELETE', headers: H }); // start from the empty form
await shot('policy-form', '/?tab=policy');
await fetch(base + '/api/policy/profile', {
  method: 'PUT', headers: H,
  body: JSON.stringify({ visa_type: feed.options.visa_types[0].id, city: feed.options.cities[0].id, has_children: true, visa_expiry: '2027-03-15' }),
});
await shot('policy-feed', '/?tab=policy');
await shot('admin-policy', '/?admin=policy');
await shot('upcoming', '/');
await browser.close();
