/**
 * Create the bot's rich menus (button panel under the 1:1 chat): the default one for all users, plus a
 * variant with a red dot on "Trang gia đình" that the server switches on per user when there is unread
 * policy news (alias `giaytonhat-dot`; switching a user's menu is not a message, so it costs no quota).
 * Re-running replaces the previous menus with the same names. Rich menus don't show in group chats —
 * there the bot attaches the same commands as quick-reply buttons ("menu").
 *
 *   LINE_CHANNEL_ACCESS_TOKEN=... LIFF_ID=... npx tsx scripts/richmenu.ts [assets/richmenu.png] [assets/richmenu-dot.png]
 *   (the dot image comes from: python3 scripts/make-richmenu-dot.py)
 */
import fs from 'fs';
import '../src/server/config.ts'; // loads .env

const NAME = 'giaytonhat-main';
const DOT_NAME = 'giaytonhat-dot';
const DOT_ALIAS = 'giaytonhat-dot'; // must match DOT_MENU_ALIAS in src/server/line.ts
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const liffId = process.env.LIFF_ID;
const image = process.argv[2] || 'assets/richmenu.png';
const dotImage = process.argv[3] || 'assets/richmenu-dot.png';
const API = 'https://api.line.me/v2/bot';
const DATA_API = 'https://api-data.line.me/v2/bot';

async function call(method: string, url: string, body?: BodyInit, contentType = 'application/json') {
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': contentType } : {}) }, body });
  const textBody = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${textBody}`);
  return textBody ? JSON.parse(textBody) : {};
}

async function main() {
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is required');
  if (!liffId) console.warn('⚠️  LIFF_ID not set — "Trang gia đình" button will open the privacy page instead.');
  const home = liffId ? `https://liff.line.me/${liffId}` : `${process.env.PUBLIC_BASE_URL || 'https://line.me'}/?tab=privacy`;

  // 2500x843, 3 columns x 2 rows — must match assets/richmenu.png.
  const cols = [[0, 833], [833, 833], [1666, 834]];
  const rows = [[0, 421], [421, 422]];
  const actionsFor = (familyUri: string) => [
    { type: 'uri', label: 'Chụp giấy', uri: 'https://line.me/R/nv/camera/' },
    { type: 'message', label: 'Lịch', text: 'lịch' },
    { type: 'message', label: 'Soạn tin', text: '/soạn' },
    { type: 'uri', label: 'Trang gia đình', uri: familyUri },
    { type: 'message', label: 'Dịch giấy', text: 'dịch' },
    { type: 'message', label: 'Hướng dẫn', text: 'hướng dẫn' },
  ];
  const areasFor = (familyUri: string) => actionsFor(familyUri).map((action, i) => {
    const [x, width] = cols[i % 3];
    const [y, height] = rows[Math.floor(i / 3)];
    return { bounds: { x, y, width, height }, action };
  });

  const { richmenus } = await call('GET', `${API}/richmenu/list`);
  for (const m of richmenus as Array<{ richMenuId: string; name: string }>) {
    if (m.name === NAME || m.name === DOT_NAME) {
      await call('DELETE', `${API}/richmenu/${m.richMenuId}`);
      console.log(`🗑️  removed old menu ${m.name} ${m.richMenuId}`);
    }
  }
  await call('DELETE', `${API}/richmenu/alias/${DOT_ALIAS}`).catch(() => undefined); // 404 when absent

  const create = async (name: string, img: string, familyUri: string) => {
    const { richMenuId } = await call('POST', `${API}/richmenu`, JSON.stringify({
      size: { width: 2500, height: 843 }, selected: true, name, chatBarText: 'Menu ☰', areas: areasFor(familyUri),
    }));
    await call('POST', `${DATA_API}/richmenu/${richMenuId}/content`, fs.readFileSync(img), img.endsWith('.png') ? 'image/png' : 'image/jpeg');
    return richMenuId as string;
  };

  const mainId = await create(NAME, image, home);
  await call('POST', `${API}/user/all/richmenu/${mainId}`);
  console.log(`✅ rich menu ${mainId} is now the default (reopen the chat to see it)`);

  if (fs.existsSync(dotImage)) {
    // With the dot, "Trang gia đình" opens straight on the policy tab.
    const dotId = await create(DOT_NAME, dotImage, liffId ? `${home}?tab=policy` : `${home}&tab=policy`);
    await call('POST', `${API}/richmenu/alias`, JSON.stringify({ richMenuAliasId: DOT_ALIAS, richMenuId: dotId }));
    console.log(`✅ red-dot menu ${dotId} registered as alias "${DOT_ALIAS}" (shown per user when there is unread policy news)`);
  } else {
    console.warn(`⚠️  ${dotImage} not found — run: python3 scripts/make-richmenu-dot.py`);
  }
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
