import { LineMessage } from '../../line.ts';
import { Repo } from '../../db/repo.ts';
import { EXACT, matchItems } from './match.ts';
import { CityInfo, GomiDictionary, GomiQuery } from './types.ts';
import { fallbackMessage, hazardMessage, kaden4Message, matchedMessage, NextCollection, noRegionMessage, notAnItemMessage, pcMessage } from './compose.ts';
import { nationalGuard } from './rules.ts';
import { GomiInput, Recognizer } from './recognize.ts';
import { GomiItem } from '../masterdata/types.ts';

export type GomiOutcome = 'no_region' | 'not_an_item' | 'kaden4' | 'pc' | 'hazard' | 'matched' | 'similar' | 'fallback';

export interface GomiDeps {
  recognizer: Recognizer;
  dictionary: GomiDictionary;
  /** Missing-from-dictionary log (name + city only). */
  repo?: Pick<Repo, 'logUnknownItem'>;
  cityInfo?: (cityCode: string) => CityInfo;
  /** Next collection day of the family's area for a common class (wired up once schedule data exists). */
  nextCollection?: (cityCode: string, area: string | undefined, rows: GomiItem[]) => NextCollection | null;
  now?: () => Date;
}

export interface GomiAnswer {
  outcome: GomiOutcome;
  messages: LineMessage[];
  cost_usd: number;
  query?: GomiQuery;
}

/**
 * The module's whole decision procedure. Order matters:
 *   1. national rules (家電4品目, PC, hazards) — never overridden by city data;
 *   2. city dictionary (verified rows, with source + date);
 *   3. AI generic fallback, labelled unsure, and logged for an admin.
 */
export async function answerGomi(
  input: GomiInput,
  region: { city_code: string; chome_code?: string } | undefined,
  deps: GomiDeps,
): Promise<GomiAnswer> {
  const now = deps.now?.() ?? new Date();
  const rawText = input.text?.trim() ?? '';
  if (!region) return { outcome: 'no_region', messages: [noRegionMessage()], cost_usd: 0 };

  const { query: q, cost_usd } = await deps.recognizer.recognize(input);
  if (q.not_an_item) return { outcome: 'not_an_item', messages: [notAnItemMessage()], cost_usd, query: q };

  const city = deps.cityInfo?.(region.city_code) ?? {};
  const rows = deps.dictionary.rows(region.city_code);
  const matches = matchItems(rows, q, rawText);
  const guard = nationalGuard(q, rawText);

  if (guard?.kind === 'kaden4') return { outcome: 'kaden4', messages: kaden4Message(guard.appliance), cost_usd, query: q };
  if (guard?.kind === 'pc') return { outcome: 'pc', messages: pcMessage(), cost_usd, query: q };
  if (guard?.kind === 'hazard') {
    return { outcome: 'hazard', messages: hazardMessage(guard.hazard, matches.length ? matches : null, now), cost_usd, query: q };
  }

  if (matches.length) {
    const next = deps.nextCollection?.(region.city_code, region.chome_code, matches.map(m => m.item)) ?? null;
    return {
      outcome: matches[0].score >= EXACT ? 'matched' : 'similar',
      messages: matchedMessage(q, matches, city, now, next),
      cost_usd,
      query: q,
    };
  }

  const asked = q.name_jp || rawText;
  if (asked && deps.repo) await deps.repo.logUnknownItem(region.city_code, asked, q.name_vi, now);
  return { outcome: 'fallback', messages: fallbackMessage(q, city), cost_usd, query: q };
}

/** Dictionary over live master data (all sources of a city, newest source wins on duplicate ids). */
export class StoreDictionary implements GomiDictionary {
  private cache = new Map<string, GomiItem[]>();
  constructor(private readonly load: (cityCode: string) => GomiItem[]) {}
  rows(cityCode: string): GomiItem[] {
    let r = this.cache.get(cityCode);
    if (!r) { r = this.load(cityCode); this.cache.set(cityCode, r); }
    return r;
  }
  invalidate() { this.cache.clear(); }
}
