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
  ['tv', ['テレビ', '液晶テレビ', 'ブラウン管', '有機elテレビ', 'tivi', 'ti vi', 'television']],
  ['refrigerator', ['冷蔵庫', '冷凍庫', 'tủ lạnh', 'tu lanh', 'tủ đông']],
  ['washer', ['洗濯機', 'máy giặt', 'may giat']],
  ['dryer', ['衣類乾燥機', '乾燥機', 'máy sấy quần áo', 'may say quan ao']],
  ['aircon', ['エアコン', 'ルームエアコン', 'điều hòa', 'dieu hoa', 'máy lạnh', 'may lanh']],
];
/** Accessories that merely contain an appliance word. */
const APPLIANCE_EXCLUDE = ['テレビ台', 'テレビボード', 'テレビラック', 'テレビスタンド', 'リモコン'];

const HAZARD_KW: Array<[Exclude<Hazard, 'none'>, string[]]> = [
  ['battery', ['電池', 'バッテリー', '充電池', 'リチウム', 'ボタン電池', 'モバイルバッテリー', 'pin sạc', 'pin dự phòng', 'sạc dự phòng', 'ắc quy', 'battery']],
  ['aerosol', ['スプレー', 'エアゾール', 'スプレー缶', 'bình xịt', 'binh xit', 'aerosol']],
  ['lighter', ['ライター', 'bật lửa', 'bat lua', 'lighter']],
  ['gas_canister', ['ガスボンベ', 'カセットボンベ', 'ボンベ', 'bình ga', 'binh ga']],
];
const PC_KW = ['パソコン', 'ノートパソコン', 'ノートpc', 'デスクトップpc', 'máy tính xách tay', 'laptop', 'máy tính bàn'];

const hit = (haystack: string[], words: string[]) => words.some(w => haystack.some(h => h.includes(fold(w))));

/** Decide from both the AI's structured traits and the raw names (either one is enough to trigger). */
export function nationalGuard(q: GomiQuery, rawText = ''): Guard {
  const names = [q.name_jp, q.name_vi, ...q.alt_names_jp, rawText].filter(Boolean).map(fold);
  const excluded = hit(names, APPLIANCE_EXCLUDE);

  if (q.appliance !== 'none' && !excluded) return { kind: 'kaden4', appliance: q.appliance };
  if (!excluded) for (const [a, kws] of APPLIANCE_KW) if (hit(names, kws)) return { kind: 'kaden4', appliance: a };

  if (q.is_pc || hit(names, PC_KW)) return { kind: 'pc' };

  if (q.hazard !== 'none') return { kind: 'hazard', hazard: q.hazard };
  for (const [h, kws] of HAZARD_KW) if (hit(names, kws)) return { kind: 'hazard', hazard: h };
  return null;
}

