import { GomiItem } from '../masterdata/types.ts';
import { fold } from './rules.ts';
import { GomiQuery } from './types.ts';

export interface Match { item: GomiItem; score: number }

export const EXACT = 0.9;
export const MIN_SIMILAR = 0.6;

/** 1 = same name or same reading; lower for partial overlap; 0 = unrelated. */
export function scoreName(query: string, item: GomiItem): number {
  const q = fold(query);
  if (!q) return 0;
  const name = fold(item.name_jp);
  const kana = fold(item.kana);
  if (q === name) return 1;
  if (kana && q === kana) return 0.95;
  // Cities write "缶／飲食缶 缶詰の缶", "紙パック／牛乳" or "傘(金属製)": a part names the thing ("缶", "傘").
  const parts = item.name_jp.split(/[／/\s（）()]+/).map(fold).filter(Boolean);
  if (parts.length > 1 && parts.includes(q)) return 0.92;
  // A short query inside a long item name ("電池" in "ボタン電池") is only a loose hint.
  const [short, long] = q.length <= name.length ? [q, name] : [name, q];
  if (short.length >= 2 && long.includes(short)) return Math.min(0.85, 0.5 + 0.4 * (short.length / long.length));
  return 0;
}

/**
 * Best entries for the query. Several rows with the same name (a city lists "かばん" per material)
 * are returned together so the answer can show all of them.
 */
export function matchItems(rows: GomiItem[], q: GomiQuery, rawText = ''): Match[] {
  const names = [q.name_jp, ...q.alt_names_jp, rawText].filter(Boolean);
  const best = new Map<string, Match>();
  for (const item of rows) {
    if (item.status === 'retired') continue;
    const score = Math.max(0, ...names.map(n => scoreName(n, item)));
    if (score >= MIN_SIMILAR) best.set(item.id, { item, score });
  }
  const sorted = [...best.values()].sort((a, b) => b.score - a.score || a.item.name_jp.length - b.item.name_jp.length);
  if (!sorted.length) return [];
  const top = sorted[0].score;
  // Keep the best tier (same score), up to 4 rows.
  return sorted.filter(m => m.score === top).slice(0, 4);
}
