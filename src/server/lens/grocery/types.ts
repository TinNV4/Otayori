export type Where = 'supermarket' | 'asian_store' | 'vn_store' | 'online';
export const WHERE_VALUES: Where[] = ['supermarket', 'asian_store', 'vn_store', 'online'];

/** Hand-curated tables: Claude drafts, an admin verifies (scripts/grocery.ts), git keeps the history. */
export type Review = 'draft' | 'verified';
export interface Reviewed {
  status: Review;
  /** Who/what produced the row, e.g. "claude-draft-2026-10-28". */
  source: string;
  verified_by?: string;
  verified_at?: string; // ISO
}

export interface Ingredient extends Reviewed {
  id: string;
  /** Vietnamese name; text in parentheses is an alternative name ("rau mùi (ngò rí)"). */
  vi: string;
  aliases_vi: string[];
  /** What to look for on the shelf / label. */
  jp: string;
  jp_alt: string[];
  /** Where the actual item (not an approximation) is sold, easiest first. Approximations live in `substitutes`. */
  where: Where[];
  storage_vi: string;
  note_vi: string;
  /** Kitchen basics most homes already have (salt, sugar, oil…): listed on one line, not as shopping. */
  pantry?: boolean;
}

export type DishRole = 'main' | 'carb' | 'herb' | 'seasoning' | 'optional';

export interface Dish extends Reviewed {
  id: string;
  vi: string;
  aliases_vi: string[];
  jp: string;
  desc_vi: string;
  ingredients: Array<{ id: string; role: DishRole }>;
}

export type Similarity = 'high' | 'medium' | 'low';

export interface Substitute extends Reviewed {
  /** Ingredient id this replaces. */
  from: string;
  options: Array<{ vi: string; jp: string; similarity: Similarity; note_vi: string; ingredient_id?: string }>;
}

export interface GroceryData {
  ingredients: Ingredient[];
  dishes: Dish[];
  substitutes: Substitute[];
}

/** What the recognizer read off a product label. Allergen text is copied, never judged. */
export interface LabelQuery {
  product_name_jp: string;
  product_name_vi: string;
  /** What kind of product it is, in Vietnamese ("nước tương", "mì ăn liền"). */
  category_vi: string;
  /** Best guess of the matching Vietnamese ingredient name, to look up the master data. */
  ingredient_vi: string;
  expiry_type: 'shomi' | 'shohi' | 'unknown';
  /** YYYY-MM-DD or ''. */
  expiry_date: string;
  expiry_uncertain: boolean;
  /** 保存方法 exactly as printed, and its Vietnamese translation. */
  storage_text_jp: string;
  storage_vi: string;
  /** アレルギー表示 exactly as printed ('' if not visible), and its Vietnamese translation. */
  allergens_text_jp: string;
  allergens_vi: string;
  /** Short uses suggested by the AI (shown as AI suggestions, below the master data). */
  suggested_uses_vi: string[];
  is_medicine: boolean;
  not_a_food_label: boolean;
  confidence: number;
  warnings_vi: string[];
}
