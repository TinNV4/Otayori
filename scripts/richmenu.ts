/**
 * Create the bot's rich menu (button panel under the 1:1 chat) and make it the default for all users.
 * Re-running replaces the previous menu with the same name. Rich menus don't show in group chats —
 * there the bot attaches the same commands as quick-reply buttons ("menu").
 *
 *   LINE_CHANNEL_ACCESS_TOKEN=... LIFF_ID=... npx tsx scripts/richmenu.ts [assets/richmenu.png]
 */
import fs from 'fs';
import '../src/server/config.ts'; // loads .env

const NAME = 'giaytonhat-main';
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const liffId = process.env.LIFF_ID;
const image = process.argv[2] || 'assets/richmenu.png';
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
  const actions = [
    { type: 'uri', label: 'Chụp giấy', uri: 'https://line.me/R/nv/camera/' },
    { type: 'message', label: 'Lịch', text: 'lịch' },
    { type: 'message', label: 'Soạn tin', text: '/soạn' },
    { type: 'uri', label: 'Trang gia đình', uri: home },
    { type: 'message', label: 'Dịch giấy', text: 'dịch' },
    { type: 'message', label: 'Hướng dẫn', text: 'hướng dẫn' },
  ];
  const areas = actions.map((action, i) => {
    const [x, width] = cols[i % 3];
    const [y, height] = rows[Math.floor(i / 3)];
    return { bounds: { x, y, width, height }, action };
  });

  const { richmenus } = await call('GET', `${API}/richmenu/list`);
  for (const m of richmenus as Array<{ richMenuId: string; name: string }>) {
    if (m.name === NAME) {
      await call('DELETE', `${API}/richmenu/${m.richMenuId}`);
      console.log(`🗑️  removed old menu ${m.richMenuId}`);
    }
  }

  const { richMenuId } = await call('POST', `${API}/richmenu`, JSON.stringify({
    size: { width: 2500, height: 843 }, selected: true, name: NAME, chatBarText: 'Menu ☰', areas,
  }));
  await call('POST', `${DATA_API}/richmenu/${richMenuId}/content`, fs.readFileSync(image), image.endsWith('.png') ? 'image/png' : 'image/jpeg');
  await call('POST', `${API}/user/all/richmenu/${richMenuId}`);
  console.log(`✅ rich menu ${richMenuId} is now the default (reopen the chat to see it)`);
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
