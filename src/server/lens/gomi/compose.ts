import { LineMessage, QuickItem, text } from '../../line.ts';
import { CommonClass, GomiItem } from '../masterdata/types.ts';
import { isStale } from '../masterdata/sync.ts';
import { Match } from './match.ts';
import { Guard } from './rules.ts';
import { Appliance, CityInfo, GomiQuery, Hazard } from './types.ts';

export const CLASS_VI: Record<CommonClass, string> = {
  burnable: 'Rác cháy được',
  non_burnable: 'Rác không cháy',
  plastic: 'Nhựa (bao bì, vỏ hộp)',
  pet: 'Chai nhựa PET',
  can: 'Lon (nhôm/sắt)',
  glass: 'Chai lọ thủy tinh',
  paper: 'Giấy cũ',
  cloth: 'Vải / quần áo cũ',
  hazardous: 'Rác nguy hại',
  sodai: 'Rác cồng kềnh (粗大ごみ)',
  kaden4: 'Đồ điện gia dụng thuộc luật tái chế (家電4品目)',
  pc: 'Máy tính (PC)',
  not_collected: 'Thành phố KHÔNG thu gom',
};

/** Generic habits, shown as "thường" and always followed by "check your city's rules". */
const TIPS: Partial<Record<CommonClass, string>> = {
  plastic: 'rửa sạch, để khô trước khi bỏ',
  pet: 'tháo nắp và bóc nhãn (nắp/nhãn thường bỏ vào loại nhựa), rửa sạch',
  can: 'rửa sạch, để khô',
  glass: 'rửa sạch, tháo nắp',
  paper: 'buộc dây theo từng loại',
  cloth: 'giặt sạch, bỏ vào túi trong',
  burnable: 'bỏ vào túi theo quy định của thành phố, buộc kín',
};

const APPLIANCE_VI: Record<Appliance, string> = {
  none: '', tv: 'Tivi', refrigerator: 'Tủ lạnh / tủ đông', washer: 'Máy giặt', dryer: 'Máy sấy quần áo', aircon: 'Điều hòa',
};
const HAZARD_VI: Record<Exclude<Hazard, 'none'>, { name: string; why: string }> = {
  battery: { name: 'Pin / pin sạc / pin dự phòng', why: 'bị ép trong xe rác có thể chập và gây cháy (pin lithium đặc biệt nguy hiểm)' },
  aerosol: { name: 'Bình xịt', why: 'còn khí bên trong có thể nổ hoặc cháy khi bị ép hoặc nóng' },
  lighter: { name: 'Bật lửa', why: 'còn gas có thể nổ hoặc cháy khi bị ép' },
  gas_canister: { name: 'Bình ga mini / bình ga', why: 'còn gas có thể nổ hoặc cháy khi bị ép hoặc nóng' },
};

/** 家電リサイクル券センター, as quoted on city guidance pages. Re-check against the official site before launch. */
export const KADEN_TICKET_CENTER_PHONE = '0120-319640';

export const QUICK_MORE: QuickItem[] = [
  { label: '📷 Hỏi món khác', camera: true },
  { label: '☰ Menu', text: 'menu' },
];

const name = (q: GomiQuery) => [q.name_jp, q.name_vi ? `(${q.name_vi})` : ''].filter(Boolean).join(' ');
const dateVi = (iso: string) => iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');

function sourceLine(rows: GomiItem[], now: Date): string {
  const r = rows[0];
  const stale = isStale(r.source_updated_at, now);
  return [
    `Nguồn: ${r.attribution}, dữ liệu cập nhật ${dateVi(r.source_updated_at)}.`,
    stale ? '⚠️ Dữ liệu đã cũ (hơn 13 tháng), hãy kiểm tra lại trên trang của thành phố.' : '',
  ].filter(Boolean).join('\n');
}

export function noRegionMessage(): LineMessage {
  return text('📍 Mình chưa biết bạn ở thành phố nào nên chưa tra được ngày và cách bỏ rác. Hãy cho mình biết khu vực (thành phố + 町丁目) trước nhé.');
}

export function notAnItemMessage(): LineMessage {
  return text('Mình không thấy đồ vật nào cần phân loại trong ảnh. Bạn chụp lại gần hơn, hoặc gõ tên đồ vật nhé.', QUICK_MORE);
}

export function kaden4Message(appliance: Appliance): LineMessage[] {
  const which = APPLIANCE_VI[appliance];
  return [text([
    `⚠️ ${which ? `${which} — ` : ''}KHÔNG bỏ như rác thường`,
    'Tivi, tủ lạnh/tủ đông, máy giặt/máy sấy quần áo và điều hòa thuộc luật tái chế đồ điện gia dụng (家電リサイクル法). Thành phố thường không thu gom các loại này, và phải trả phí tái chế.',
    '',
    '4 cách xử lý:',
    '1) Nhờ cửa hàng đã mua nó thu lại.',
    '2) Mua cái mới ở cửa hàng nào thì nhờ chính cửa hàng đó thu cái cũ.',
    '3) Không mua mới / không nhớ nơi mua: gọi trung tâm tiếp nhận tái chế đồ điện gia dụng (家電リサイクル受付センター) để hẹn thu gom.',
    '4) Tự mang đến điểm thu nhận chỉ định (指定引取場所): trả phí ở bưu điện bằng phiếu 家電リサイクル券, dán phiếu lên máy rồi mang đi.',
    '',
    `💴 Phí tái chế phụ thuộc hãng và kích cỡ. Tra phí, hỏi cách xử lý: tổng đài 家電リサイクル券センター ${KADEN_TICKET_CENTER_PHONE} (tiếng Nhật).`,
    '',
    '🚫 Cẩn thận xe thu gom đồ cũ chạy loa phóng thanh (不用品回収): nhiều xe không có giấy phép, hay đòi phí cao hoặc vứt trái phép.',
  ].join('\n'), QUICK_MORE)];
}

export function pcMessage(): LineMessage[] {
  return [text([
    '⚠️ Máy tính (PC) — KHÔNG bỏ như rác thường',
    'Máy tính có hệ thống thu hồi riêng (PC リサイクル): liên hệ nhà sản xuất hoặc cửa hàng đã mua, hoặc hỏi thành phố nơi bạn ở.',
    'Nhớ xóa dữ liệu cá nhân trước khi đưa đi.',
  ].join('\n'), QUICK_MORE)];
}

export function hazardMessage(hazard: Exclude<Hazard, 'none'>, matched: Match[] | null, now: Date): LineMessage[] {
  const h = HAZARD_VI[hazard];
  const lines = [
    `🔥 ${h.name} — NGUY CƠ CHÁY NỔ`,
    `Không bỏ lẫn vào rác thường: ${h.why}.`,
  ];
  if (matched?.length) {
    const labels = [...new Set(matched.map(m => m.item.local_category))].join(' / ');
    lines.push('', `Thành phố của bạn xếp vào: 「${labels}」`, ...matched.slice(0, 2).filter(m => m.item.note).map(m => `📝 Ghi chú của thành phố (tiếng Nhật): ${m.item.note}`));
    lines.push('', sourceLine(matched.map(m => m.item), now));
  } else {
    lines.push('', 'Cách bỏ (điểm thu gom riêng, ngày riêng, hay cần tháo/dán băng keo cực pin…) khác nhau theo thành phố — hãy làm đúng hướng dẫn của thành phố bạn.');
  }
  return [text(lines.join('\n'), QUICK_MORE)];
}

export interface NextCollection { date: string; label: string }

export function matchedMessage(q: GomiQuery, matches: Match[], city: CityInfo, now: Date, next?: NextCollection | null): LineMessage[] {
  const rows = matches.map(m => m.item);
  const exact = matches[0].score >= 0.9;
  const classes = [...new Set(rows.map(r => r.common_class))];
  const lines: string[] = [];

  lines.push(`🗑️ ${exact ? name(q) : `${name(q)} — gần giống mục 「${rows[0].name_jp}」 trong danh sách của thành phố`}`);
  if (rows.length === 1 || classes.length === 1) {
    const r = rows[0];
    lines.push(`→ ${CLASS_VI[r.common_class]}`, `   Thành phố gọi là: 「${r.local_category}」`);
  } else {
    lines.push('Tùy loại/chất liệu, thành phố phân thành:');
    for (const r of rows) lines.push(`• 「${r.local_category}」 (${CLASS_VI[r.common_class]})${r.note ? ` — ${r.note}` : ''}`);
  }
  if (!exact) lines.push('⚠️ Tên không khớp hoàn toàn — kiểm tra lại cho chắc.');

  const r0 = rows[0];
  if (classes.length === 1) {
    if (r0.note) lines.push(`📝 Ghi chú của thành phố (tiếng Nhật): ${r0.note}`);
    const tip = TIPS[r0.common_class];
    if (tip) lines.push(`🧼 Thường là: ${tip} (kiểm tra lại quy định thành phố).`);
  }

  if (classes.includes('sodai')) {
    lines.push('', '📅 Rác cồng kềnh (粗大ごみ): phải ĐẶT LỊCH TRƯỚC và mua tem/phiếu thanh toán — không tự mang ra điểm rác.');
    lines.push(city.sodai_booking_url ? `🔗 Đặt lịch: ${city.sodai_booking_url}` : '🔗 Xem trang đặt lịch 粗大ごみ của thành phố bạn.');
    if (city.sodai_phone) lines.push(`☎️ ${city.sodai_phone}`);
    lines.push(city.sodai_fee_note ? `💴 Phí: ${city.sodai_fee_note}` : '💴 Mức phí tùy kích cỡ/loại đồ — xem bảng phí của thành phố.');
  } else if (classes.includes('not_collected')) {
    lines.push('', 'Hãy hỏi cửa hàng bán đồ đó, hoặc công ty xử lý được thành phố giới thiệu.');
  } else if (next) {
    lines.push('', `📅 Ngày đổ gần nhất tại khu bạn: ${next.label} (${dateVi(next.date)})`);
  }

  lines.push('', sourceLine(rows, now));
  return [text(lines.join('\n'), QUICK_MORE)];
}

/** No dictionary entry: AI's generic answer, loudly labelled as unsure. */
export function fallbackMessage(q: GomiQuery, city: CityInfo): LineMessage[] {
  const lines = [
    `🗑️ ${name(q) || 'Đồ vật này'}`,
    '⚠️ Chưa có trong dữ liệu của thành phố bạn — đây chỉ là phân loại CHUNG, chưa chắc. Hãy kiểm tra lại quy định của thành phố.',
    '',
    `Có thể là: ${CLASS_VI[q.generic_class]}`,
  ];
  if (q.generic_how_to_vi) lines.push(`💡 ${q.generic_how_to_vi}`);
  if (q.size_cm_max > 0 && q.size_cm_max >= 30) lines.push('📏 Đồ lớn có thể bị tính là 粗大ごみ (phải đặt lịch trước) — tùy thành phố.');
  if (city.official_url) lines.push('', `🔗 ${city.official_url}`);
  lines.push('', 'Mình đã ghi lại món này để bổ sung vào dữ liệu.');
  return [text(lines.join('\n'), QUICK_MORE)];
}
