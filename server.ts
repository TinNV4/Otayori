import express from 'express';
import path from 'path';
import { loadConfig } from './src/server/config.ts';
import { createApp } from './src/server/app.ts';
import { createRepo } from './src/server/db/index.ts';
import { ClaudeExtractor, MockExtractor } from './src/server/extract.ts';
import { ClaudeComposer, TemplateComposer } from './src/server/renraku.ts';
import { ClaudeTranslator, MockTranslator } from './src/server/translate.ts';
import { LineClient, RecordingLineApi } from './src/server/line.ts';
import { lineIdTokenVerifier } from './src/server/auth.ts';
import { makeInvite } from './src/server/service.ts';
import { ClaudeRecognizer, MockRecognizer } from './src/server/lens/gomi/recognize.ts';
import { dictionaryFromStore } from './src/server/lens/gomi/dictionary.ts';
import { loadSources } from './src/server/lens/masterdata/registry.ts';
import { FileMasterStore } from './src/server/lens/masterdata/store.ts';
import { loadCities, gsiGeocoder } from './src/server/lens/regions.ts';
import { loadCityInfo } from './src/server/lens/cityinfo.ts';
import { scheduleFromStore } from './src/server/lens/gomi/schedule.ts';

const cfg = loadConfig();
const repo = createRepo(cfg);
const line = cfg.lineChannelAccessToken ? new LineClient(cfg.lineChannelAccessToken) : new RecordingLineApi();
const extractor = cfg.anthropicApiKey ? new ClaudeExtractor(cfg.anthropicApiKey) : new MockExtractor();
const composer = cfg.anthropicApiKey ? new ClaudeComposer(cfg.anthropicApiKey) : new TemplateComposer();
const translator = cfg.anthropicApiKey ? new ClaudeTranslator(cfg.anthropicApiKey) : new MockTranslator();
const verifyIdToken = cfg.liffChannelId ? lineIdTokenVerifier(cfg.liffChannelId) : null;

// Waste sorting: published master data ships with the image (data/masterdata/<source>/live.json).
// A broken registry must not take the bot down: log it loudly and fall back to national rules + generic answers.
let sources: ReturnType<typeof loadSources> = [];
let cities: ReturnType<typeof loadCities> = [];
let cityInfo: ReturnType<typeof loadCityInfo> = {};
try {
  sources = loadSources(cfg.masterdataSources);
  cities = loadCities(cfg.citiesFile);
  cityInfo = loadCityInfo(cfg.cityInfoFile);
} catch (err) {
  console.error('[gomi] master data registry failed to load, serving generic answers only:', (err as Error).message);
}
const masterStore = new FileMasterStore(cfg.masterdataDir);
const gomi = {
  recognizer: cfg.anthropicApiKey ? new ClaudeRecognizer(cfg.anthropicApiKey) : new MockRecognizer(),
  dictionary: dictionaryFromStore(masterStore, sources),
  schedule: scheduleFromStore(masterStore, sources),
  cityInfo: (code: string) => cityInfo[code] ?? {},
};

const { app, bot } = createApp({
  cfg, repo, line, extractor, composer, translator, verifyIdToken, gomi, cities,
  geocoder: cfg.regionGeocoder === 'gsi' ? gsiGeocoder : undefined,
});

async function start() {
  if (cfg.devMode && (await repo.listInviteCodes()).length === 0) {
    await repo.saveInviteCode(makeInvite('BETA2026', { quota: cfg.defaultQuota, maxUses: cfg.maxBetaFamilies, note: 'dev seed' }, new Date()));
  }

  if (cfg.isProduction) {
    const dist = path.resolve('dist');
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  // Hourly housekeeping in-process (Cloud Scheduler → /tasks/cleanup is the primary trigger in prod).
  setInterval(() => void bot.services.runCleanup().catch(err => console.error('[cleanup]', err)), 60 * 60 * 1000).unref();

  const server = app.listen(cfg.port, '0.0.0.0', () => {
    console.log(`[giaytonhat] http://0.0.0.0:${cfg.port} storage=${cfg.storage} line=${line instanceof LineClient ? 'live' : 'recording'} llm=${cfg.anthropicApiKey ? 'claude' : 'mock'} dev=${cfg.devMode}`);
  });

  // Cloud Run sends SIGTERM before stopping an instance: finish pending multi-page batches first.
  process.on('SIGTERM', async () => {
    await bot.aggregator.flushAll();
    server.close(() => process.exit(0));
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
