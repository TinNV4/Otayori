import { Repo } from '../../db/repo.ts';
import { LineMessage } from '../../line.ts';
import { jstDate } from '../../time.ts';
import { Page } from '../../extract.ts';
import { dishMessage, helpMessage, ingredientMessage, labelMessage, medicineMessage, notALabelMessage, substituteMessage, unknownMessage } from './compose.ts';
import { LabelRecognizer } from './recognize.ts';
import { findMentions, foldVi } from './text.ts';
import { GroceryData, Ingredient } from './types.ts';

export type GroceryOutcome = 'help' | 'dish' | 'substitute' | 'ingredient' | 'label' | 'medicine' | 'not_a_label' | 'unknown';

export interface GroceryDeps {
  data: GroceryData;
  recognizer?: LabelRecognizer;
  /** Unmatched questions are counted (text only: no user, no photo) so the tables grow where people actually ask. */
  repo?: Pick<Repo, 'logUnknownItem'>;
  now?: () => Date;
}

export interface GroceryAnswer { outcome: GroceryOutcome; messages: LineMessage[]; cost_usd: number }

const SUBSTITUTE_INTENT = /\b(thay|thay the|thay bang|khong co|ko co|k co|het|thieu|substitute|dung gi|thay gi)\b/;
const MEDICINE_WORDS = /医薬品|第[1-3１-３一二三]類|指定第2類|薬剤師|処方/;

const ingredientAliases = (i: Ingredient) => [i.vi, ...i.aliases_vi, i.jp, ...i.jp_alt];

/**
 * Typed questions never touch the model: dish names and ingredient names are matched against the tables.
 * Only photos of labels use Claude (read-only: transcribe + translate, never judge).
 */
export async function answerGrocery(input: { text?: string; pages?: Page[] }, deps: GroceryDeps): Promise<GroceryAnswer> {
  const now = deps.now?.() ?? new Date();
  const { data } = deps;
  const none = (outcome: GroceryOutcome, messages: LineMessage[], cost_usd = 0): GroceryAnswer => ({ outcome, messages, cost_usd });

  if (input.pages?.length) {
    if (!deps.recognizer) return none('unknown', unknownMessage(data));
    const { query: q, cost_usd } = await deps.recognizer.recognize(input.pages, { today: jstDate(now) });
    if (q.not_a_food_label) return none('not_a_label', notALabelMessage(), cost_usd);
    if (q.is_medicine || MEDICINE_WORDS.test(`${q.product_name_jp} ${q.category_vi}`)) return none('medicine', medicineMessage(), cost_usd);
    const ing = q.ingredient_vi ? findMentions(q.ingredient_vi, data.ingredients, ingredientAliases)[0]?.item : undefined;
    return none('label', labelMessage(q, ing, data, jstDate(now)), cost_usd);
  }

  const raw = (input.text ?? '').trim().slice(0, 200);
  if (!raw) return none('help', [helpMessage(data)]);
  const log = async (what: string) => { if (deps.repo) await deps.repo.logUnknownItem('grocery', what.slice(0, 60), '', now); };

  // 1. "thay rau răm" / "không có húng quế"
  if (SUBSTITUTE_INTENT.test(foldVi(raw))) {
    const ings = findMentions(raw, data.ingredients, ingredientAliases).map(m => m.item);
    if (ings.length) {
      const found = ings.slice(0, 3).map(ing => ({ ing, sub: data.substitutes.find(s => s.from === ing.id) }));
      for (const f of found) if (!f.sub) await log(`thay ${f.ing.vi}`);
      return none('substitute', substituteMessage(found));
    }
  }

  // 2. dish names (several allowed: "bún bò và canh chua")
  const dishes = findMentions(raw, data.dishes, d => [d.vi, ...d.aliases_vi, d.jp]).map(m => m.item);
  if (dishes.length) return none('dish', dishMessage(dishes.slice(0, 4), data));

  // 3. an ingredient on its own
  const ing = findMentions(raw, data.ingredients, ingredientAliases)[0]?.item;
  if (ing) return none('ingredient', ingredientMessage(ing, data));

  await log(raw);
  return none('unknown', unknownMessage(data));
}
