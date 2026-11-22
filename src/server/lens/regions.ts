import fs from 'fs';
import { FamilyRegion } from '../../types/index.ts';
import { fold } from './gomi/rules.ts';

/** A city a family can pick. Everything else is "unsupported": still gets national rules + generic answers. */
export interface City {
  /** 5-digit JIS code (designated cities use their xx100 code; wards of one are folded into it). */
  code: string;
  prefecture_jp: string;
  name_jp: string;
  name_vi: string;
  aliases?: string[];
  /** 政令指定都市: addresses carry a ward (名古屋市中区栄…) that is skipped when reading the town. */
  designated?: boolean;
}

export function loadCities(file: string): City[] {
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as City[];
  for (const c of raw) {
    if (!/^\d{5}$/.test(c.code) || !c.name_jp || !c.prefecture_jp) throw new Error(`${file}: bad city entry ${JSON.stringify(c)}`);
  }
  return raw;
}

const norm = (s: string) => fold(s.normalize('NFKC'));
const bare = (s: string) => s.replace(/[都道府県]$/, '');

/** Typed by a person: Japanese, Vietnamese or romaji. Exact name beats partial; several hits are returned for the user to choose. */
export function findCities(cities: City[], query: string): City[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const keys = (c: City) => [c.name_jp, `${c.prefecture_jp}${c.name_jp}`, `${bare(c.prefecture_jp)}${c.name_jp}`, c.name_vi, ...(c.aliases ?? [])].map(norm);
  const exact = cities.filter(c => keys(c).includes(q));
  if (exact.length) return exact;
  // "thành phố Yokohama" / "quận Nakano" → contains an alias or the JP name without its 市/区 suffix.
  return cities.filter(c => keys(c).some(k => k.length >= 2 && (q.includes(k) || k.includes(q))));
}

/** Town + chome from the text after the city name ("西日暮里2-3-4" → "西日暮里"; "西日暮里二丁目5番" → "西日暮里二丁目"). Never the street number. */
export function chomeFrom(rest: string): string | undefined {
  const r = rest.normalize('NFKC').replace(/^[,、\s]+/, '');
  const m = r.match(/^([^\d\s,、\-ー]{1,15}?)(?:(\d{1,2})丁目|(?=[\d\-]|\s|,|、|$))/);
  const town = m?.[1]?.trim();
  if (!town || /[市区町村郡]$/.test(town) && !m?.[2]) return undefined;
  return m?.[2] ? `${town}${m[2]}丁目` : town;
}

/** "荒川区 西日暮里2丁目" typed after the city name → "西日暮里2丁目" (the town/chome part, if any). */
export function chomeAfterCity(city: City, query: string): string | undefined {
  const q = query.normalize('NFKC');
  const lower = q.toLowerCase();
  for (const key of [`${city.prefecture_jp}${city.name_jp}`, `${bare(city.prefecture_jp)}${city.name_jp}`, city.name_jp, ...(city.aliases ?? [])]) {
    const k = key.normalize('NFKC').toLowerCase();
    const i = lower.indexOf(k);
    if (i < 0) continue;
    let rest = q.slice(i + k.length);
    if (city.designated) rest = rest.replace(/^[,、\s]*[^\d\s,、]{1,4}区/, '');
    return chomeFrom(rest);
  }
  return undefined;
}

const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

/**
 * Match LINE's `address` string ("日本、〒116-0013 東京都荒川区西日暮里2-3-4") to a known city.
 * Ward names repeat across Japan (中央区, 北区, 西区…), so when the address names a prefecture only that
 * prefecture's cities can match: "大阪府大阪市中央区" is never Tokyo's 中央区. Without a prefecture a bare
 * name must be unambiguous. Longest name wins.
 */
export function cityFromAddress(cities: City[], address: string): { city: City; chome_label?: string } | null {
  const a = address.normalize('NFKC');
  const prefs = PREFECTURES.filter(p => a.includes(p));
  const named = [...cities]
    .filter(c => a.includes(c.name_jp) && (prefs.length ? prefs.includes(c.prefecture_jp) : true))
    .sort((x, y) => y.name_jp.length - x.name_jp.length);
  if (!named.length) return null;
  if (!prefs.length && new Set(named.map(c => c.name_jp)).size < named.length) return null;
  const c = named[0];
  const end = a.indexOf(c.name_jp) + c.name_jp.length;
  let rest = a.slice(end);
  if (c.designated) rest = rest.replace(/^[,、\s]*[^\d\s,、]{1,4}区/, ''); // ward of a designated city
  return { city: c, chome_label: chomeFrom(rest) };
}

/** GSI reports a ward code for designated cities (14109 → 14100 Yokohama). */
export function cityByMuniCd(cities: City[], muniCd: string): City | undefined {
  return cities.find(c => c.code === muniCd) ?? cities.find(c => c.code.endsWith('00') && c.code.slice(0, 3) === muniCd.slice(0, 3));
}

/** "Prefecture + city" out of an address no listed city matched, e.g. "さいたま市". */
export function cityNameFromAddress(address: string): string | undefined {
  const a = address.normalize('NFKC');
  return a.match(/(?:東京都|北海道|(?:京都|大阪)府|[^\d\s、,]{2,3}県)\s*([^\d\s、,]{1,8}?[市区町村])/)?.[1];
}

export function regionFor(city: City | null, name: string, chome: string | undefined, via: FamilyRegion['via'], now: Date): FamilyRegion {
  return city
    ? { city_code: city.code, city_name_jp: city.name_jp, label_vi: city.name_vi, chome_label: chome, set_at: now.toISOString(), via }
    : { city_code: 'unsupported', city_name_jp: name, label_vi: name, chome_label: chome, set_at: now.toISOString(), via };
}

export function describeRegion(r: FamilyRegion): string {
  return `${r.city_name_jp} (${r.label_vi})${r.chome_label ? ` · ${r.chome_label}` : ''}`;
}

/**
 * Optional fallback for a location pin without a usable address: GSI's reverse geocoder
 * (free, Japan only). It receives the coordinates, so it's only used when REGION_GEOCODER=gsi.
 * Response shape: { results: { muniCd: "13118", lv01Nm: "西日暮里二丁目" } }.
 */
export type Geocoder = (lat: number, lng: number) => Promise<{ muniCd: string; town?: string } | null>;

export const gsiGeocoder: Geocoder = async (lat, lng) => {
  try {
    const res = await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { results?: { muniCd?: string; lv01Nm?: string } };
    const muni = body.results?.muniCd;
    return muni && /^\d{5}$/.test(muni) ? { muniCd: muni, town: body.results?.lv01Nm } : null;
  } catch {
    return null;
  }
};
