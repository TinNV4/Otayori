import { loadConfig, AppConfig } from '../src/server/config.ts';
import { MemoryRepo } from '../src/server/db/memory.ts';
import { RecordingLineApi } from '../src/server/line.ts';
import { MockExtractor } from '../src/server/extract.ts';
import { TemplateComposer } from '../src/server/renraku.ts';
import { Bot } from '../src/server/bot.ts';
import { makeInvite } from '../src/server/service.ts';

export function testConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv),
    storage: 'memory',
    aggregationWindowMs: 20,
    publicBaseUrl: 'https://bot.example.com',
    lineChannelSecret: 'test_secret',
    adminUserIds: ['U_admin'],
    ...over,
  };
}

export async function setup(over: Partial<AppConfig> = {}) {
  const cfg = testConfig(over);
  const repo = new MemoryRepo();
  const line = new RecordingLineApi();
  const extractor = new MockExtractor();
  const bot = new Bot({ repo, line, extractor, composer: new TemplateComposer(), cfg });
  await repo.saveInviteCode(makeInvite('BETA2026', { quota: 50, maxUses: 20 }, new Date()));
  return { cfg, repo, line, extractor, bot };
}

let n = 0;
export function ev(source: object, extra: object) {
  n++;
  return { webhookEventId: `e${n}`, timestamp: Date.now(), replyToken: `rt${n}`, source, ...extra };
}
export const group = (groupId = 'Cgroup1', userId = 'Uuser1') => ({ type: 'group', groupId, userId });
export const textEv = (source: object, t: string) => ev(source, { type: 'message', message: { id: `m${n}`, type: 'text', text: t } });

/** Join + consent + invite → active family. */
export async function activate(bot: Bot, source: object = group()) {
  await bot.handleWebhook({ events: [ev(source, { type: 'join' })] });
  await bot.handleWebhook({ events: [textEv(source, 'Đồng ý điều khoản')] });
  await bot.handleWebhook({ events: [textEv(source, 'BETA2026')] });
}

export function lastText(line: RecordingLineApi): string {
  const last = line.sent[line.sent.length - 1];
  return last.messages.map(m => m.text as string).join('\n---\n');
}
