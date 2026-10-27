/**
 * Point the LINE channel's webhook at the deployed service and verify it, then send a
 * signed synthetic event to make sure signature checking works end to end.
 *
 *   LINE_CHANNEL_ACCESS_TOKEN=... LINE_CHANNEL_SECRET=... \
 *     npx tsx scripts/line-setup.ts https://giaytonhat-xxxx.a.run.app
 */
import { signBody } from '../src/server/line.ts';
import '../src/server/config.ts'; // loads .env

const base = (process.argv[2] || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const secret = process.env.LINE_CHANNEL_SECRET;

async function step(name: string, fn: () => Promise<string>) {
  try {
    console.log(`✅ ${name}: ${await fn()}`);
  } catch (err) {
    console.log(`❌ ${name}: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

async function main() {
  if (!base || !token || !secret) {
    console.error('Usage: LINE_CHANNEL_ACCESS_TOKEN=.. LINE_CHANNEL_SECRET=.. npx tsx scripts/line-setup.ts <PUBLIC_BASE_URL>');
    process.exit(1);
  }
  const endpoint = `${base}/api/line/webhook`;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  await step('health', async () => {
    const r = await fetch(`${base}/health`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return 'ok';
  });
  await step('unsigned webhook rejected', async () => {
    const r = await fetch(endpoint, { method: 'POST', body: '{"events":[]}', headers: { 'Content-Type': 'application/json' } });
    if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`);
    return '401';
  });
  await step('signed webhook accepted', async () => {
    const body = JSON.stringify({ destination: 'test', events: [] });
    const r = await fetch(endpoint, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'x-line-signature': signBody(secret, body) } });
    if (r.status !== 200) throw new Error(`HTTP ${r.status} — LINE_CHANNEL_SECRET differs from the deployed one?`);
    return '200';
  });
  await step('set webhook endpoint', async () => {
    const r = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', { method: 'PUT', headers: auth, body: JSON.stringify({ endpoint }) });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`);
    return endpoint;
  });
  await step('LINE → webhook test', async () => {
    const r = await fetch('https://api.line.me/v2/bot/channel/webhook/test', { method: 'POST', headers: auth, body: JSON.stringify({ endpoint }) });
    const j = (await r.json()) as { success?: boolean; statusCode?: number; reason?: string };
    if (!j.success) throw new Error(`${j.statusCode} ${j.reason}`);
    return `status ${j.statusCode}`;
  });
  await step('bot info', async () => {
    const r = await fetch('https://api.line.me/v2/bot/info', { headers: auth });
    const j = (await r.json()) as { displayName?: string; basicId?: string; chatMode?: string };
    if (j.chatMode && j.chatMode !== 'bot') throw new Error(`chatMode=${j.chatMode} — switch Response mode to "Bot" in LINE OA Manager`);
    return `${j.displayName} (${j.basicId}) chatMode=${j.chatMode}`;
  });
  await step('push quota', async () => {
    const [q, c] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', { headers: auth }).then(r => r.json()) as Promise<{ value?: number }>,
      fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: auth }).then(r => r.json()) as Promise<{ totalUsage?: number }>,
    ]);
    return `${c.totalUsage ?? '?'} / ${q.value ?? '?'} used this month`;
  });
}

main();
