import crypto from 'crypto';

/** LINE Messaging API message object (subset we send). */
export type LineMessage = Record<string, unknown> & { type: string };

export function verifyLineSignature(channelSecret: string, rawBody: Buffer | undefined, signature: string | undefined): boolean {
  if (!channelSecret || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha256', channelSecret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export function signBody(channelSecret: string, body: string | Buffer): string {
  return crypto.createHmac('sha256', channelSecret).update(body).digest('base64');
}

export interface LineApi {
  reply(replyToken: string, messages: LineMessage[]): Promise<boolean>;
  push(to: string, messages: LineMessage[]): Promise<boolean>;
  getContent(messageId: string): Promise<{ data: Buffer; contentType: string; hint?: string }>;
  showLoading(chatId: string, seconds?: number): Promise<void>;
  getGroupMemberCount(groupId: string): Promise<number | null>;
  /** Show this user a different rich menu (by alias). Doesn't use the message quota. */
  linkRichMenu(userId: string, alias: string): Promise<boolean>;
  /** Back to the default rich menu. */
  unlinkRichMenu(userId: string): Promise<boolean>;
}

/** Alias of the rich menu with the red dot on "Trang gia đình" (created by scripts/richmenu.ts). */
export const DOT_MENU_ALIAS = 'giaytonhat-dot';

const API = 'https://api.line.me/v2/bot';
const DATA_API = 'https://api-data.line.me/v2/bot';

export class LineClient implements LineApi {
  constructor(private readonly accessToken: string) {}

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Bearer ${this.accessToken}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async reply(replyToken: string, messages: LineMessage[]): Promise<boolean> {
    const res = await fetch(`${API}/message/reply`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) }),
    });
    if (!res.ok) console.warn(`[line] reply failed ${res.status}: ${await res.text()}`);
    return res.ok;
  }

  async push(to: string, messages: LineMessage[]): Promise<boolean> {
    const res = await fetch(`${API}/message/push`, {
      method: 'POST',
      headers: { ...this.headers(), 'X-Line-Retry-Key': crypto.randomUUID() },
      body: JSON.stringify({ to, messages: messages.slice(0, 5) }),
    });
    if (!res.ok) console.warn(`[line] push failed ${res.status}: ${await res.text()}`);
    return res.ok;
  }

  async getContent(messageId: string) {
    const res = await fetch(`${DATA_API}/message/${encodeURIComponent(messageId)}/content`, { headers: this.headers(false) });
    if (!res.ok) throw new Error(`LINE content ${res.status}`);
    return {
      data: Buffer.from(await res.arrayBuffer()),
      contentType: (res.headers.get('content-type') || 'application/octet-stream').split(';')[0],
    };
  }

  /** Loading animation — only supported in 1:1 chats with users. */
  async showLoading(chatId: string, seconds = 20) {
    if (!chatId.startsWith('U')) return;
    await fetch(`${API}/chat/loading/start`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ chatId, loadingSeconds: seconds }),
    }).catch(() => undefined);
  }

  async getGroupMemberCount(groupId: string) {
    const res = await fetch(`${API}/group/${encodeURIComponent(groupId)}/members/count`, { headers: this.headers(false) });
    if (!res.ok) return null;
    return ((await res.json()) as { count: number }).count;
  }

  private menuIds = new Map<string, string>();

  async linkRichMenu(userId: string, alias: string) {
    let id = this.menuIds.get(alias);
    if (!id) {
      const res = await fetch(`${API}/richmenu/alias/${encodeURIComponent(alias)}`, { headers: this.headers(false) });
      if (!res.ok) return false; // alias not created yet (run scripts/richmenu.ts)
      id = ((await res.json()) as { richMenuId: string }).richMenuId;
      this.menuIds.set(alias, id);
    }
    const res = await fetch(`${API}/user/${encodeURIComponent(userId)}/richmenu/${id}`, { method: 'POST', headers: this.headers(false) });
    if (res.status === 404) this.menuIds.delete(alias); // menu was recreated
    return res.ok;
  }

  async unlinkRichMenu(userId: string) {
    const res = await fetch(`${API}/user/${encodeURIComponent(userId)}/richmenu`, { method: 'DELETE', headers: this.headers(false) });
    return res.ok;
  }
}

/** Records outgoing messages instead of calling LINE (dev simulator + tests). */
export class RecordingLineApi implements LineApi {
  sent: Array<{ kind: 'reply' | 'push'; target: string; messages: LineMessage[] }> = [];
  contents = new Map<string, { data: Buffer; contentType: string; hint?: string }>();
  replyOk = true;

  async reply(replyToken: string, messages: LineMessage[]) {
    this.sent.push({ kind: 'reply', target: replyToken, messages });
    return this.replyOk;
  }
  async push(to: string, messages: LineMessage[]) {
    this.sent.push({ kind: 'push', target: to, messages });
    return true;
  }
  async getContent(messageId: string) {
    const c = this.contents.get(messageId);
    if (!c) throw new Error(`no content for ${messageId}`);
    return c;
  }
  async showLoading() {}
  async getGroupMemberCount() { return null; }
  /** userId → alias of the menu they currently see (absent = default menu). */
  menus = new Map<string, string>();
  async linkRichMenu(userId: string, alias: string) { this.menus.set(userId, alias); return true; }
  async unlinkRichMenu(userId: string) { this.menus.delete(userId); return true; }
}

export interface QuickItem {
  label: string;
  text?: string;
  data?: string;
  uri?: string;
  /** Opens the phone camera / photo picker straight from the chat (quick reply only). */
  camera?: boolean;
  cameraRoll?: boolean;
}

export function text(t: string, quickReply?: QuickItem[]): LineMessage {
  const msg: LineMessage = { type: 'text', text: t.length > 5000 ? t.slice(0, 4990) + '…' : t };
  if (quickReply?.length) {
    msg.quickReply = {
      items: quickReply.slice(0, 13).map(q => ({
        type: 'action',
        action: q.camera
          ? { type: 'camera', label: q.label.slice(0, 20) }
          : q.cameraRoll
            ? { type: 'cameraRoll', label: q.label.slice(0, 20) }
            : q.uri
          ? { type: 'uri', label: q.label.slice(0, 20), uri: q.uri }
          : q.data
            ? { type: 'postback', label: q.label.slice(0, 20), data: q.data, displayText: q.text }
            : { type: 'message', label: q.label.slice(0, 20), text: q.text || q.label },
      })),
    };
  }
  return msg;
}
