import { CommonClass } from '../masterdata/types.ts';

export type Appliance = 'none' | 'tv' | 'refrigerator' | 'washer' | 'dryer' | 'aircon';
export type Hazard = 'none' | 'battery' | 'aerosol' | 'lighter' | 'gas_canister';

/** What the recognizer saw: one item, described so master data and the national rules can act on it. */
export interface GomiQuery {
  /** Japanese name as a city dictionary would write it ("モバイルバッテリー"). Empty when unknown. */
  name_jp: string;
  name_vi: string;
  /** Other Japanese names/spellings to try against the dictionary. */
  alt_names_jp: string[];
  appliance: Appliance;
  hazard: Hazard;
  is_pc: boolean;
  /** Longest side in cm; 0 = unknown. */
  size_cm_max: number;
  /** AI's best generic class, used ONLY when the city dictionary has no entry. */
  generic_class: CommonClass;
  generic_how_to_vi: string;
  confidence: number;
  /** Photo/text is not a discardable item (person, scenery, blank…). */
  not_an_item: boolean;
}

export interface CityInfo {
  /** Official 粗大ごみ booking page / phone / fee note, as published by the city. */
  sodai_booking_url?: string;
  sodai_phone?: string;
  sodai_fee_note?: string;
  /** City's own waste-separation page, linked from fallback answers. */
  official_url?: string;
  /** Where these facts were read and when (YYYY-MM-DD); required, and shown to users. */
  source_url?: string;
  updated_at?: string;
}

/** Read access to the live master data of a city. */
export interface GomiDictionary {
  rows(cityCode: string): import('../masterdata/types.ts').GomiItem[];
}
