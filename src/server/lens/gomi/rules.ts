import { Appliance, GomiQuery, Hazard } from './types.ts';

/**
 * National rules. They sit OUTSIDE any city's data on purpose: a city missing a row, or a
 * bad import, must never turn a TV or a lithium battery into "ordinary waste".
 */
export type Guard =
  | { kind: 'kaden4'; appliance: Appliance }
  | { kind: 'pc' }
  | { kind: 'hazard'; hazard: Exclude<Hazard, 'none'> }
  | null;

export const fold = (s: string) =>
  s.normalize('NFKC').toLowerCase()
    // katakana → hiragana so "テレビ" and "てれび" meet
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・･,、.。()（）「」\-_/]/g, '');


const APPLIANCE_KW: Array<[Exclude<Appliance, 'none'>, string[]]> = [
  ['tv', ['テレビ', 'ブラウン管', 'tivi', 'ti vi', 'television']],
  ['refrigerator', ['冷蔵庫', '冷凍庫', 'tủ lạnh', 'tu lanh', 'tủ đông']],
  ['washer', ['洗濯機', 'máy giặt', 'may giat']],
  // only clothes dryers are under the law: 布団乾燥機, 靴乾燥機, 食器乾燥機 are not
  ['dryer', ['衣類乾燥機', 'máy sấy quần áo', 'may say quan ao']],
  ['aircon', ['エアコン', 'điều hòa', 'dieu hoa', 'máy lạnh', 'may lanh']],
];
const DRYER_FOR_CLOTHES = /乾燥機.{0,6}衣類|衣類.{0,6}乾燥機/;

/**
 * Things that merely contain an appliance word (real city lists are full of them): テレビ台, エアコンカバー,
 * 洗濯機防水パン, テレビアンテナ, 戸棚・冷蔵庫の仕切り板… Judged on the text right after the word, or the start of the name.
 */
const ACCESSORY_AFTER = ['台', 'ボード', 'ラック', 'スタンド', '用', 'カバー', 'フィルター', 'ホース', 'リモコン', 'アンテナ', 'ゲーム', 'マット', 'ネット', '防水',
  'パン', '回転', '仕切', '窓枠', 'ダクト', '部品', '脱臭', '洗浄', 'クリーナー', 'ケース', 'の仕切', 'の棚'].map(w => fold(w));
const ACCESSORY_START = ['アンテナ', 'フィルター', '戸棚', 'ホース', 'カバー'].map(w => fold(w));

/** Name contains the appliance word as the appliance itself, not as part of an accessory. */
function namesAppliance(name: string, kws: string[]): boolean {
  if (ACCESSORY_START.some(a => name.startsWith(a))) return false;
  for (const kw of kws.map(fold)) {
    let i = name.indexOf(kw);
    while (i >= 0) {
      const after = name.slice(i + kw.length).replace(/^の/, ''); // "テレビのリモコン"
      if (!ACCESSORY_AFTER.some(a => after.startsWith(a))) return true;
      i = name.indexOf(kw, i + 1);
    }
  }
  return false;
}

const HAZARD_KW: Array<[Exclude<Hazard, 'none'>, string[]]> = [
  ['battery', ['電池', 'バッテリー', '充電池', 'リチウム', 'ボタン電池', 'モバイルバッテリー', 'pin sạc', 'pin dự phòng', 'sạc dự phòng', 'ắc quy', 'battery']],
  ['aerosol', ['スプレー', 'エアゾール', 'スプレー缶', 'bình xịt', 'binh xit', 'aerosol']],
  ['lighter', ['ライター', 'bật lửa', 'bat lua', 'lighter']],
  ['gas_canister', ['ガスボンベ', 'カセットボンベ', 'ボンベ', 'bình ga', 'binh ga']],
];
const PC_KW = ['パソコン', 'ノートパソコン', 'ノートpc', 'デスクトップpc', 'máy tính xách tay', 'laptop', 'máy tính bàn'];

const hit = (haystack: string[], words: string[]) => words.some(w => haystack.some(h => h.includes(fold(w))));

/** Which appliance a folded name is (as itself, not as an accessory), if any. */
function applianceIn(name: string): Exclude<Appliance, 'none'> | null {
  for (const [a, kws] of APPLIANCE_KW) if (namesAppliance(name, kws)) return a;
  if (DRYER_FOR_CLOTHES.test(name) && !ACCESSORY_AFTER.some(w => name.includes(fold('乾燥機') + w))) return 'dryer';
  return null;
}
/** The name uses an appliance word but only inside an accessory ("テレビ台", "エアコンカバー"). */
const onlyAccessory = (name: string) => !applianceIn(name) && APPLIANCE_KW.some(([, kws]) => kws.some(k => name.includes(fold(k))));

/** Decide from both the AI's structured traits and the raw names (either one is enough to trigger). */
export function nationalGuard(q: GomiQuery, rawText = ''): Guard {
  const names = [q.name_jp, q.name_vi, ...q.alt_names_jp, rawText].filter(Boolean).map(fold);

  const byName = names.map(applianceIn).find(Boolean);
  if (byName) return { kind: 'kaden4', appliance: byName };
  // the recognizer's trait is trusted unless the name says it is an accessory (a "テレビ台" is not a TV)
  if (q.appliance !== 'none' && !names.some(onlyAccessory)) return { kind: 'kaden4', appliance: q.appliance };

  if (q.is_pc || hit(names, PC_KW)) return { kind: 'pc' };

  if (q.hazard !== 'none') return { kind: 'hazard', hazard: q.hazard };
  for (const [h, kws] of HAZARD_KW) if (hit(names, kws)) return { kind: 'hazard', hazard: h };
  return null;
}

