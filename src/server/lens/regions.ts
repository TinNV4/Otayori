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

/** Match LINE's `address` string ("日本、〒116-0013 東京都荒川区西日暮里2-3-4") to a known city. Longest name wins. */
export function cityFromAddress(cities: City[], address: string): { city: City; chome_label?: string } | null {
  const a = address.normalize('NFKC');
  const hit = [...cities]
    .sort((x, y) => y.name_jp.length - x.name_jp.length)
    .map(c => {
      for (const full of [`${c.prefecture_jp}${c.name_jp}`, `${bare(c.prefecture_jp)}${c.name_jp}`, c.name_jp]) {
        const i = a.indexOf(full);
        if (i >= 0) return { c, end: i + full.length, withPref: full !== c.name_jp };
      }
      return null;
    })
    .find(Boolean);
  if (!hit) return null;
  let rest = a.slice(hit.end);
  if (hit.c.name_jp.endsWith('市')) rest = rest.replace(/^[^\d\s,、]{1,4}区/, ''); // ward of a designated city
  return { city: hit.c, chome_label: chomeFrom(rest) };
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
