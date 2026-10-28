import { PolicyCity } from '../../types/policy.ts';

/**
 * Official sources the newsletter reads. ONLY official sites (no press) — copyright + accuracy.
 *
 * Each source points at the site's own "what's new" list (checked against the live pages on 2026-10-28).
 * Sites change their layout; when a source stops yielding links run
 *
 *   npm run policy -- fetch --dry        # prints the dated links each source yields, calls no Claude
 *
 * and adjust `listUrl` / `linkPattern` / `keywords` here.
 */
export interface PolicySource {
  id: string;
  /** Shown to users as "Nguồn". */
  issuer: string;
  /** The "what's new" list page. */
  listUrl: string;
  /** Lists that are split by period (MHLW: one page per month) — overrides `listUrl` when running. */
  listUrlsFor?: (now: Date) => string[];
  /** Only follow links whose host is one of these (SSRF + scope guard). */
  hosts: string[];
  /** Keep only links whose path matches (cheap pre-filter). */
  linkPattern?: RegExp;
  /** Keep only links whose anchor text matches (cheap pre-filter before spending a Claude call). */
  keywords?: RegExp;
  /** Drop links whose anchor text matches (meeting notices, awards, procurement … never residents' business). */
  exclude?: RegExp;
  /** Set for city sources: items from it only go to residents of that city. */
  city?: string;
}

export const POLICY_CITIES: PolicyCity[] = [
  { id: 'nagoya', name_vi: 'Nagoya (Aichi)' },
  { id: 'other', name_vi: 'Nơi khác (chỉ nhận tin toàn quốc)' },
];

/** This and the previous month (JST), so the first days of a month still see late items from the month before. */
const mhlwMonths = (now: Date) =>
  [0, -1].map(offset => {
    const d = new Date(now.getTime() + 9 * 3600_000);
    d.setUTCMonth(d.getUTCMonth() + offset, 1);
    return `https://www.mhlw.go.jp/stf/houdou/houdou_list_${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}.html`;
  });

export const POLICY_SOURCES: PolicySource[] = [
  {
    id: 'isa',
    issuer: '出入国在留管理庁 (Cục Quản lý XNC & lưu trú)',
    listUrl: 'https://www.moj.go.jp/isa/publications/newslist/index.html',
    hosts: ['www.moj.go.jp'],
    linkPattern: /^\/isa\//,
  },
  {
    id: 'mhlw',
    issuer: '厚生労働省 (Bộ Y tế, Lao động & Phúc lợi)',
    listUrl: mhlwMonths(new Date())[0],
    listUrlsFor: mhlwMonths,
    hosts: ['www.mhlw.go.jp'],
    keywords: /外国|在留|雇用|労働|年金|保険|医療|子ども|児童|育児|手当|介護|感染|ワクチン|予防接種/,
    exclude: /記者会見|表彰|審議会|審査会|検討会|開催案内|開催します|公募|入札/,
  },
  {
    id: 'nta',
    issuer: '国税庁 (Tổng cục Thuế)',
    listUrl: 'https://www.nta.go.jp/information/release/index.htm',
    hosts: ['www.nta.go.jp'],
    // Few releases a month: no keyword filter, the model decides.
  },
  {
    id: 'npa',
    issuer: '警察庁 (Cục Cảnh sát quốc gia)',
    // The homepage "新着情報" box is an iframe onto this page.
    listUrl: 'https://www.npa.go.jp/newlyarrived/common_top_news.html',
    hosts: ['www.npa.go.jp'],
    exclude: /サイバー警察局便り|統計月報|入札|採用/,
  },
  {
    id: 'city_nagoya',
    issuer: '名古屋市 (Thành phố Nagoya)',
    listUrl: 'https://www.city.nagoya.jp/newslist.html',
    hosts: ['www.city.nagoya.jp'],
    city: 'nagoya',
    keywords: /外国|在留|多文化|国際|ベトナム|子ども|子育て|保育|手当|給付|助成|国民健康保険|保険料|住民税|予防接種|マイナ|ごみ|引っ越し|転入|転出/,
    exclude: /開催結果|協議会|懇談会|審議会|委員会|部会|入札|募集要項|採用|新設等届出書|展示場|イベント|デジタルチラシ/,
  },
];

export function sourceById(id: string): PolicySource | undefined {
  return POLICY_SOURCES.find(s => s.id === id);
}
