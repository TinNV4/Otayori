import { LineMessage } from '../../line.ts';
import { Repo } from '../../db/repo.ts';
import { EXACT, matchItems } from './match.ts';
import { CityInfo, GomiDictionary, GomiQuery } from './types.ts';
import { fallbackMessage, hazardMessage, kaden4Message, matchedMessage, NextCollection, noRegionMessage, notAnItemMessage, pcMessage } from './compose.ts';
import { nationalGuard } from './rules.ts';
import { EMPTY_QUERY, GomiInput, Recognizer } from './recognize.ts';
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
  const city = region ? deps.cityInfo?.(region.city_code) ?? {} : {};
  const rows = region ? deps.dictionary.rows(region.city_code) : [];

  const respond = (q: GomiQuery, cost_usd: number): GomiAnswer => {
    const matches = matchItems(rows, q, rawText);
    const guard = nationalGuard(q, rawText);
    const done = (outcome: GomiOutcome, messages: LineMessage[]): GomiAnswer => ({ outcome, messages, cost_usd, query: q });

    // 1. National rules work even before the family has told us where they live.
    if (guard?.kind === 'kaden4') return done('kaden4', kaden4Message(guard.appliance));
    if (guard?.kind === 'pc') return done('pc', pcMessage());
    if (guard?.kind === 'hazard') return done('hazard', hazardMessage(guard.hazard, matches.length ? matches : null, now));
    if (!region) return done('no_region', [noRegionMessage()]);

    // 2. City dictionary.
    if (matches.length) {
      const next = deps.nextCollection?.(region.city_code, region.chome_code, matches.map(m => m.item)) ?? null;
      return done(matches[0].score >= EXACT ? 'matched' : 'similar', matchedMessage(q, matches, city, now, next));
    }
    return done('fallback', fallbackMessage(q, city));
  };

  // A typed name that the national rules or the dictionary settle exactly needs no model call.
  if (rawText && !input.pages?.length) {
    const q0: GomiQuery = { ...EMPTY_QUERY, name_jp: rawText, confidence: 1 };
    const top = matchItems(rows, q0, rawText)[0];
    if (nationalGuard(q0, rawText) || (top && top.score >= 0.95)) return respond(q0, 0);
  }

  const { query: q, cost_usd } = await deps.recognizer.recognize(input);
  if (q.not_an_item) return { outcome: 'not_an_item', messages: [notAnItemMessage()], cost_usd, query: q };

  const answer = respond(q, cost_usd);
  if (answer.outcome === 'fallback') {
    // 3. Not in the dictionary: remember what was asked (name + city only) so an admin can add it.
    const asked = q.name_jp || rawText;
    if (asked && deps.repo) await deps.repo.logUnknownItem(region!.city_code, asked, q.name_vi, now);
  }
  return answer;
}

/** Dictionary over live master data (all sources of a city, newest source wins on duplicate ids). */
export class StoreDictionary implements GomiDictionary {
  private cache = new Map<string, { rows: GomiItem[]; at: number }>();
  /** `ttlMs`: re-read after this long, so a `data publish` shows up without a restart. */
  constructor(private readonly load: (cityCode: string) => GomiItem[], private readonly ttlMs = 10 * 60_000) {}
  rows(cityCode: string): GomiItem[] {
    const hit = this.cache.get(cityCode);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.rows;
    const rows = this.load(cityCode);
    this.cache.set(cityCode, { rows, at: Date.now() });
    return rows;
  }
  invalidate() { this.cache.clear(); }
}
