import dotenv from 'dotenv';

dotenv.config();

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be a number, got "${v}"`);
  return n;
}

function list(name: string): string[] {
  return (process.env[name] || '').split(',').map(s => s.trim()).filter(Boolean);
}

export interface AppConfig {
  isProduction: boolean;
  /** Dev mode: unsigned webhooks, `x-dev-user-id` auth, simulator endpoints. Never on in production. */
  devMode: boolean;
  port: number;
  publicBaseUrl: string;
  lineChannelSecret: string;
  lineChannelAccessToken: string;
  liffId: string | null;
  /** LINE Login channel ID that owns the LIFF app (used to verify ID tokens). */
  liffChannelId: string | null;
  adminUserIds: string[];
  anthropicApiKey: string | null;
  storage: 'memory' | 'file' | 'firestore';
  dataFile: string;
  maxBetaFamilies: number;
  defaultQuota: number;
  monthlyBudgetUsd: number;
  pushLimit: number;
  maxPagesPerDoc: number;
  /** Wait window to group consecutive images (without LINE imageSet) into one document. */
  aggregationWindowMs: number;
  retentionDays: number;
  leftGroupPurgeDays: number;
  cronSecret: string | null;
  /** Waste/lookup questions per family per month (cheap, separate from the paper quota). */
  lookupQuota: number;
  /** Published master data (data/masterdata/<source>/live.json) and the source registry. */
  masterdataDir: string;
  masterdataSources: string;
  citiesFile: string;
  cityInfoFile: string;
  /** "Đi chợ" tables (ingredients, dishes, substitutes). */
  groceryDir: string;
  /** 'gsi' = fall back to GSI's reverse geocoder when a LINE location has no usable address. Sends coordinates to a third party, so off by default. */
  regionGeocoder: 'off' | 'gsi';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  const devMode = !isProduction && env.DEV_MODE !== 'false';
  const port = env.PORT ? parseInt(env.PORT, 10) : 3000;

  const cfg: AppConfig = {
    isProduction,
    devMode,
    port,
    publicBaseUrl: (env.PUBLIC_BASE_URL || env.APP_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    lineChannelSecret: env.LINE_CHANNEL_SECRET || '',
    lineChannelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
    liffId: env.LIFF_ID || null,
    liffChannelId: env.LIFF_CHANNEL_ID || (env.LIFF_ID ? env.LIFF_ID.split('-')[0] : null),
    adminUserIds: list('ADMIN_USER_IDS').concat(list('LINE_ADMIN_USER_ID')),
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    storage: (env.STORAGE as AppConfig['storage']) || (isProduction ? 'firestore' : 'file'),
    dataFile: env.DATA_FILE || '.data/dev-db.json',
    maxBetaFamilies: num('MAX_BETA_FAMILIES', 20),
    defaultQuota: num('DEFAULT_FAMILY_QUOTA', 50),
    monthlyBudgetUsd: num('MONTHLY_BUDGET_USD', 20),
    pushLimit: num('PUSH_LIMIT', 200),
    maxPagesPerDoc: num('MAX_PAGES_PER_DOC', 6),
    aggregationWindowMs: num('AGGREGATION_WINDOW_MS', 15000),
    retentionDays: num('RETENTION_DAYS', 90),
    leftGroupPurgeDays: num('LEFT_GROUP_PURGE_DAYS', 7),
    cronSecret: env.CRON_SECRET || null,
    lookupQuota: num('LOOKUP_QUOTA', 60),
    masterdataDir: env.MASTERDATA_DIR || 'data/masterdata',
    masterdataSources: env.MASTERDATA_SOURCES || 'data/sources',
    citiesFile: env.CITIES_FILE || 'data/cities.json',
    cityInfoFile: env.CITY_INFO_FILE || 'data/city-info.json',
    groceryDir: env.GROCERY_DIR || 'data/grocery',
    regionGeocoder: env.REGION_GEOCODER === 'gsi' ? 'gsi' : 'off',
  };

  if (isProduction) {
    const missing = [
      ['LINE_CHANNEL_SECRET', cfg.lineChannelSecret],
      ['LINE_CHANNEL_ACCESS_TOKEN', cfg.lineChannelAccessToken],
      ['ANTHROPIC_API_KEY', cfg.anthropicApiKey],
      ['PUBLIC_BASE_URL', env.PUBLIC_BASE_URL],
      ['CRON_SECRET', cfg.cronSecret],
    ].filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error(`Missing required env in production: ${missing.join(', ')}`);
    if (cfg.adminUserIds.length === 0) console.warn('[config] ADMIN_USER_IDS is empty — admin dashboard disabled.');
    if (!cfg.liffId) console.warn('[config] LIFF_ID is empty — LIFF pages cannot authenticate until it is set.');
  }
  return cfg;
}
