import fs from 'fs';
import { CityInfo } from './gomi/types.ts';

/**
 * Per-city facts that aren't rows of a table: where to book a 粗大ごみ pickup, the phone number, the fee note.
 * data/city-info.json: { "<city_code>": { sodai_booking_url, sodai_phone, sodai_fee_note, official_url, source_url, updated_at } }
 * Every entry must say where it comes from and when it was checked, because it is shown to people as fact.
 */
export function loadCityInfo(file: string): Record<string, CityInfo> {
  if (!fs.existsSync(file)) return {};
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, CityInfo>;
  for (const [code, info] of Object.entries(raw)) {
    const bad = (m: string) => new Error(`${file}[${code}]: ${m}`);
    if (!/^\d{5}$/.test(code)) throw bad('key must be a 5-digit city code');
    for (const k of ['sodai_booking_url', 'official_url', 'source_url'] as const) {
      if (info[k] && !/^https:\/\//.test(info[k]!)) throw bad(`"${k}" must be an https URL`);
    }
    const facts = info.sodai_booking_url || info.sodai_phone || info.sodai_fee_note || info.official_url;
    if (facts && (!info.source_url || !/^\d{4}-\d{2}-\d{2}$/.test(info.updated_at ?? ''))) {
      throw bad('needs "source_url" and "updated_at" (YYYY-MM-DD): shown to users as fact');
    }
  }
  return raw;
}
