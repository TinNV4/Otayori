import { LineMessage, QuickItem, text } from '../../line.ts';
import { Dish, DishRole, GroceryData, Ingredient, LabelQuery, Reviewed, Similarity, Substitute, Where } from './types.ts';

export const QUICK: QuickItem[] = [
  { label: '📷 Chụp nhãn', camera: true },
  { label: '🖼️ Chọn ảnh', cameraRoll: true },
  { label: '☰ Menu', text: 'menu' },
];

const WHERE_VI: Record<Where, string> = {
  supermarket: '🛒 Siêu thị thường (スーパー)',
  asian_store: '🏪 Tiệm đồ châu Á (アジア食材店)',
  vn_store: '🇻🇳 Tiệm đồ Việt (ベトナム食材店)',
  online: '🌐 Mua online (通販)',
};
const WHERE_ORDER: Where[] = ['supermarket', 'asian_store', 'vn_store', 'online'];
const SIM_VI: Record<Similarity, string> = { high: 'rất gần', medium: 'khá gần', low: 'hơi khác' };
const ROLE_VI: Record<DishRole, string> = { main: 'chính', carb: 'tinh bột', herb: 'rau thơm/ăn kèm', seasoning: 'gia vị', optional: 'tùy chọn' };

/** Shown whenever an answer rests on rows nobody has verified yet. */
export const DRAFT_NOTICE = 'ℹ️ Bảng đối chiếu này do Claude soạn và đang chờ admin kiểm duyệt: tên Nhật/nơi bán có thể khác tùy cửa hàng.';
const draftNote = (rows: Reviewed[]) => (rows.some(r => r.status !== 'verified') ? `\n\n${DRAFT_NOTICE}` : '');

export const EXPIRY_CARD = [
  '📌 賞味期限 và 消費期限 khác nhau:',
  '• 賞味期限 (shōmi kigen) = hạn "ăn NGON nhất", ghi trên đồ ít hỏng (snack, đồ hộp, mì gói, gia vị). Qua hạn không có nghĩa là hỏng ngay.',
  '• 消費期限 (shōhi kigen) = hạn AN TOÀN, ghi trên đồ dễ hỏng (cơm hộp, sandwich, thịt cá tươi, bánh kem). Qua hạn là không ăn.',
  'Cả hai chỉ đúng khi chưa mở và giữ đúng cách bảo quản ghi trên bao bì.',
].join('\n');

const dateVi = (iso: string) => iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');
const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export function helpMessage(data: GroceryData): LineMessage {
  const dishes = data.dishes.slice(0, 8).map(d => d.vi).join(', ');
  return text([
    '🛒 ĐI CHỢ NHẬT — mình giúp được:',
    '• Chụp NHÃN sản phẩm → đọc nhãn, hạn dùng, cách bảo quản (không đánh giá dị ứng).',
    '• Gõ tên MÓN → danh sách đồ cần mua và nơi mua. Ví dụ: "phở bò", "bún bò và canh chua".',
    '• Gõ "thay <nguyên liệu>" → đồ thay thế. Ví dụ: "thay rau răm", "không có húng quế".',
    '• Gõ tên NGUYÊN LIỆU → tên tiếng Nhật, nơi bán, cách bảo quản.',
    dishes ? `\nMón mình có: ${dishes}…` : '',
  ].filter(Boolean).join('\n'), QUICK);
}

export function unknownMessage(data: GroceryData): LineMessage[] {
  const dishes = data.dishes.map(d => d.vi).join(', ');
  return [text([
    'Mình chưa có món/nguyên liệu này trong bảng. Mình đã ghi lại để bổ sung.',
    dishes ? `\nCác món hiện có: ${dishes}.` : '',
    '\nBạn cũng có thể chụp nhãn sản phẩm để mình đọc.',
  ].filter(Boolean).join('\n'), QUICK)];
}

function offOtherSub(ing: Ingredient, data: GroceryData): string {
  const s = data.substitutes.find(x => x.from === ing.id)?.options.find(o => o.similarity !== 'low');
  return s ? ` (thay: ${s.vi})` : '';
}

/** Shopping list for one or more dishes, grouped by the easiest place to buy each thing. */
export function dishMessage(dishes: Dish[], data: GroceryData): LineMessage[] {
  const byId = new Map(data.ingredients.map(i => [i.id, i]));
  const merged = new Map<string, DishRole>();
  const order: DishRole[] = ['main', 'carb', 'herb', 'seasoning', 'optional'];
  for (const d of dishes) for (const l of d.ingredients) {
    const cur = merged.get(l.id);
    if (!cur || order.indexOf(l.role) < order.indexOf(cur)) merged.set(l.id, l.role);
  }
  const used = [...merged].map(([id, role]) => ({ ing: byId.get(id)!, role }));
  const pantry = used.filter(u => u.ing.pantry);
  const shop = used.filter(u => !u.ing.pantry);

  const lines: string[] = [];
  lines.push(`🍜 ${dishes.map(d => `${d.vi} (${d.jp})`).join(' + ')}`);
  if (dishes.length === 1) lines.push(dishes[0].desc_vi);
  lines.push('', '🧾 Cần mua:');
  for (const w of WHERE_ORDER) {
    const group = shop.filter(u => u.ing.where[0] === w);
    if (!group.length) continue;
    lines.push('', WHERE_VI[w]);
    for (const { ing, role } of group) {
      lines.push(`• ${ing.vi} — ${ing.jp}${role === 'optional' ? ' (tùy chọn)' : ''}${w !== 'supermarket' ? offOtherSub(ing, data) : ''}`);
    }
  }
  if (pantry.length) lines.push('', `🧂 Gia vị cơ bản (thường nhà có sẵn): ${pantry.map(u => u.ing.vi).join(', ')}`);
  lines.push('', '💡 Không mua được món nào? Gõ "thay <nguyên liệu>".');
  return [text(lines.join('\n') + draftNote([...dishes, ...used.map(u => u.ing)]), QUICK)];
}

function subLines(sub: Substitute): string[] {
  return sub.options.map(o => `• ${o.vi} — ${o.jp} (${SIM_VI[o.similarity]})${o.note_vi ? `\n   ${o.note_vi}` : ''}`);
}

export function substituteMessage(found: Array<{ ing: Ingredient; sub: Substitute | undefined }>): LineMessage[] {
  const lines: string[] = [];
  const rows: Reviewed[] = [];
  for (const { ing, sub } of found) {
    lines.push(`🔁 Thay ${ing.vi} (${ing.jp}):`);
    if (sub) { lines.push(...subLines(sub)); rows.push(sub); } else lines.push('Mình chưa có gợi ý thay thế tốt cho món này. Đã ghi lại để bổ sung.');
    lines.push('');
  }
  lines.push('Vị sẽ không giống hệt — nêm từ từ và nếm.');
  return [text(lines.join('\n') + draftNote(rows), QUICK)];
}

export function ingredientMessage(ing: Ingredient, data: GroceryData): LineMessage[] {
  const sub = data.substitutes.find(s => s.from === ing.id);
  const usedIn = data.dishes.filter(d => d.ingredients.some(l => l.id === ing.id)).map(d => d.vi);
  const lines = [
    `🥬 ${ing.vi}`,
    `🇯🇵 Tìm trên kệ: ${[ing.jp, ...ing.jp_alt].join(' / ')}`,
    `📍 Nơi bán: ${ing.where.map(w => WHERE_VI[w]).join(' · ')}`,
  ];
  if (ing.note_vi) lines.push(`📝 ${ing.note_vi}`);
  if (ing.storage_vi) lines.push(`🧊 Bảo quản: ${ing.storage_vi}`);
  if (usedIn.length) lines.push(`🍳 Dùng trong: ${usedIn.slice(0, 8).join(', ')}${usedIn.length > 8 ? '…' : ''}`);
  if (sub) lines.push('', '🔁 Nếu không có, thay bằng:', ...subLines(sub));
  return [text(lines.join('\n') + draftNote([ing, ...(sub ? [sub] : [])]), QUICK)];
}

export function medicineMessage(): LineMessage[] {
  return [text([
    '💊 Đây có vẻ là thuốc / sản phẩm y tế, không phải thực phẩm.',
    'Mình không đọc liều dùng hay công dụng của thuốc. Hãy hỏi 薬剤師 (dược sĩ) ở quầy thuốc: họ giải thích được liều dùng, tác dụng phụ và dùng chung với thuốc khác.',
  ].join('\n'), QUICK)];
}

export function notALabelMessage(): LineMessage[] {
  return [text('Mình không thấy nhãn sản phẩm trong ảnh. Bạn chụp gần hơn, rõ cả mặt sau (chỗ ghi thành phần, hạn dùng) rồi gửi lại nhé.', QUICK)];
}

/** Date line + a plain statement per label type. Never says an expired 賞味 item is fine to eat. */
export function expiryLines(q: LabelQuery, today: string): string[] {
  const kind = q.expiry_type === 'shomi' ? '賞味期限 (hạn ngon nhất)' : q.expiry_type === 'shohi' ? '消費期限 (hạn an toàn)' : 'Hạn dùng';
  if (!q.expiry_date) return [`⏳ ${kind}: mình không đọc được ngày trong ảnh. Hãy tự kiểm tra trên bao bì.`];
  const left = days(q.expiry_date, today);
  const base = `⏳ ${kind}: ${dateVi(q.expiry_date)}${q.expiry_uncertain ? ' ⚠️ ngày chưa chắc, hãy nhìn lại bao bì' : ''}`;
  if (q.expiry_type === 'shohi') {
    if (left < 0) return [base, `🚫 Đã quá hạn ${-left} ngày. Đồ có 消費期限 qua hạn thì đừng ăn.`];
    if (left === 0) return [base, '⚠️ Hôm nay là ngày cuối: dùng trong hôm nay, nếu không thì bỏ.'];
    return [base, `Còn ${left} ngày (chỉ đúng khi chưa mở và giữ đúng cách bảo quản).`];
  }
  if (q.expiry_type === 'shomi') {
    if (left < 0) return [base, `⚠️ Đã quá ${-left} ngày. 賞味期限 chỉ là hạn "ngon nhất", không phải hạn an toàn, nhưng mình không thể nói món này còn ăn được hay không: tùy loại thực phẩm và cách bảo quản. Có mùi/màu/vị lạ hoặc nghi ngờ thì bỏ.`];
    return [base, left === 0 ? 'Hôm nay là ngày cuối của hạn ngon nhất.' : `Còn ${left} ngày (chỉ đúng khi chưa mở và giữ đúng cách bảo quản).`];
  }
  return [base, 'Mình chưa biết đây là 賞味期限 hay 消費期限 — xem chữ in cạnh ngày trên bao bì.'];
}

export function labelMessage(q: LabelQuery, ing: Ingredient | undefined, data: GroceryData, today: string): LineMessage[] {
  const out: LineMessage[] = [];
  const lines: string[] = [];
  lines.push(`🏷️ ${q.product_name_jp || 'Sản phẩm'}${q.product_name_vi ? ` (${q.product_name_vi})` : ''}${q.category_vi ? ` — ${q.category_vi}` : ''}`);

  const dishes = ing ? data.dishes.filter(d => d.ingredients.some(l => l.id === ing.id)).map(d => d.vi) : [];
  if (dishes.length) lines.push(`🍳 Dùng nấu: ${dishes.slice(0, 8).join(', ')}`);
  else if (q.suggested_uses_vi.length) lines.push(`🍳 Gợi ý (AI, tham khảo): ${q.suggested_uses_vi.join('; ')}`);

  if (q.storage_text_jp) lines.push(`🧊 Bảo quản (nhãn ghi): 「${q.storage_text_jp}」${q.storage_vi ? `\n   → ${q.storage_vi} (AI dịch)` : ''}`);
  else lines.push('🧊 Mình không thấy mục cách bảo quản trong ảnh (có thể ở mặt khác của bao bì).');
  if (ing?.storage_vi) lines.push(`   Thông thường với ${ing.vi}: ${ing.storage_vi}`);

  lines.push('', ...expiryLines(q, today));

  lines.push('');
  if (q.allergens_text_jp) {
    lines.push('⚠️ Mục dị ứng trên nhãn (chép nguyên văn):', `「${q.allergens_text_jp}」`);
    if (q.allergens_vi) lines.push(`→ ${q.allergens_vi} (AI dịch, có thể sai)`);
  } else {
    lines.push('⚠️ Mình không đọc thấy mục dị ứng (アレルギー表示) trong ảnh; có thể nó nằm ở mặt khác của bao bì.');
  }
  lines.push('Mình chỉ đọc lại nhãn, không thể kết luận món này có hợp với cơ địa hay dị ứng của bạn. Hãy tự đọc lại nhãn gốc, nhất là khi bạn hoặc con bị dị ứng.');

  for (const w of q.warnings_vi) lines.push(`⚠️ ${w}`);
  out.push(text(lines.join('\n') + draftNote(ing ? [ing] : []), undefined));
  out.push(text(EXPIRY_CARD, QUICK));
  return out;
}
