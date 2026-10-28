import fs from 'fs';
import path from 'path';
import { baseNames, foldVi } from './text.ts';
import { Dish, GroceryData, Ingredient, Reviewed, Substitute, WHERE_VALUES } from './types.ts';

const FILES = ['ingredients', 'dishes', 'substitutes'] as const;

/** Everything wrong with the tables, as readable lines (empty = fine). */
export function checkGrocery(d: GroceryData): string[] {
  const issues: string[] = [];
  const ingIds = new Set<string>();
  const rowCheck = (kind: string, id: string, r: Reviewed) => {
    if (r.status !== 'draft' && r.status !== 'verified') issues.push(`${kind} ${id}: status must be draft|verified`);
    if (!r.source) issues.push(`${kind} ${id}: "source" is required`);
    if (r.status === 'verified' && (!r.verified_by || !r.verified_at)) issues.push(`${kind} ${id}: verified rows need verified_by + verified_at`);
  };

  const aliasOwner = new Map<string, string>();
  for (const i of d.ingredients) {
    if (ingIds.has(i.id)) issues.push(`ingredient ${i.id}: duplicate id`);
    ingIds.add(i.id);
    rowCheck('ingredient', i.id, i);
    if (!i.vi || !i.jp) issues.push(`ingredient ${i.id}: "vi" and "jp" are required`);
    if (!i.where?.length || i.where.some(w => !WHERE_VALUES.includes(w))) issues.push(`ingredient ${i.id}: "where" must list ${WHERE_VALUES.join('|')}`);
    for (const a of [i.vi, ...i.aliases_vi].flatMap(baseNames)) {
      const key = foldVi(a);
      const owner = aliasOwner.get(key);
      if (owner && owner !== i.id) issues.push(`ingredient ${i.id}: alias "${a}" is also used by ${owner}`);
      aliasOwner.set(key, i.id);
    }
  }
  const dishIds = new Set<string>();
  for (const x of d.dishes) {
    if (dishIds.has(x.id)) issues.push(`dish ${x.id}: duplicate id`);
    dishIds.add(x.id);
    rowCheck('dish', x.id, x);
    if (!x.ingredients?.length) issues.push(`dish ${x.id}: no ingredients`);
    const seen = new Set<string>();
    for (const l of x.ingredients) {
      if (!ingIds.has(l.id)) issues.push(`dish ${x.id}: unknown ingredient "${l.id}"`);
      if (seen.has(l.id)) issues.push(`dish ${x.id}: ingredient "${l.id}" listed twice`);
      seen.add(l.id);
    }
  }
  const subFrom = new Set<string>();
  for (const s of d.substitutes) {
    rowCheck('substitute', s.from, s);
    if (subFrom.has(s.from)) issues.push(`substitute ${s.from}: listed twice (merge the options)`);
    subFrom.add(s.from);
    if (!ingIds.has(s.from)) issues.push(`substitute: unknown ingredient "${s.from}"`);
    if (!s.options?.length) issues.push(`substitute ${s.from}: no options`);
    for (const o of s.options ?? []) {
      if (!['high', 'medium', 'low'].includes(o.similarity)) issues.push(`substitute ${s.from}: bad similarity "${o.similarity}"`);
      if (o.ingredient_id && !ingIds.has(o.ingredient_id)) issues.push(`substitute ${s.from}: unknown ingredient_id "${o.ingredient_id}"`);
    }
  }
  return issues;
}

export function loadGrocery(dir: string): GroceryData {
  const read = <T>(name: (typeof FILES)[number]): T[] => {
    const f = path.join(dir, `${name}.json`);
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as T[]) : [];
  };
  const data: GroceryData = { ingredients: read<Ingredient>('ingredients'), dishes: read<Dish>('dishes'), substitutes: read<Substitute>('substitutes') };
  const issues = checkGrocery(data);
  if (issues.length) throw new Error(`${dir}: ${issues.length} problem(s):\n  ${issues.slice(0, 12).join('\n  ')}`);
  return data;
}

export const EMPTY_GROCERY: GroceryData = { ingredients: [], dishes: [], substitutes: [] };

export function reviewStats(d: GroceryData) {
  const count = (rows: Reviewed[]) => ({ total: rows.length, verified: rows.filter(r => r.status === 'verified').length });
  return { ingredients: count(d.ingredients), dishes: count(d.dishes), substitutes: count(d.substitutes) };
}
