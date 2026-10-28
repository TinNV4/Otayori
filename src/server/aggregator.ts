import { Page } from './extract.ts';

export interface PageBatch {
  chatId: string;
  familyId: string;
  pages: Page[];
  /** Most recent reply token (freshest one is the most likely to still be valid). */
  replyToken?: string;
  userId?: string;
  /** 'translate' = "dịch" mode: line-by-line translation only, nothing stored. */
  mode?: 'read' | 'translate';
}

interface Pending extends PageBatch {
  timer: NodeJS.Timeout | null;
  expectedTotal?: number;
  received: number;
}

/**
 * Groups consecutive pages sent to one chat into a single document.
 * - LINE `imageSet` (several photos sent at once): flush as soon as all `total` images arrived.
 * - Otherwise: flush `windowMs` after the last page.
 * Single-instance state: deploy with max-instances=1 (fine for a 20-family beta).
 */
export class PageAggregator {
  private pending = new Map<string, Pending>();

  constructor(
    private readonly windowMs: number,
    private readonly maxPages: number,
    private readonly onFlush: (batch: PageBatch) => Promise<void>,
  ) {}

  add(item: { chatId: string; familyId: string; page: Page; replyToken?: string; userId?: string; imageSet?: { total: number }; mode?: 'read' | 'translate' }) {
    let p = this.pending.get(item.chatId);
    if (!p) {
      p = { chatId: item.chatId, familyId: item.familyId, pages: [], timer: null, received: 0 };
      this.pending.set(item.chatId, p);
    }
    if (p.timer) clearTimeout(p.timer);
    p.received += 1;
    if (p.pages.length < this.maxPages) p.pages.push(item.page);
    if (item.replyToken) p.replyToken = item.replyToken;
    if (item.userId) p.userId = item.userId;
    if (item.mode === 'translate') p.mode = 'translate';
    if (item.imageSet?.total) p.expectedTotal = Math.max(p.expectedTotal || 0, item.imageSet.total);

    const complete = p.expectedTotal !== undefined && p.received >= p.expectedTotal;
    const wait = complete ? 0 : p.expectedTotal ? this.windowMs * 2 : this.windowMs;
    p.timer = setTimeout(() => void this.flush(item.chatId), wait);
    return { pages: p.pages.length, dropped: p.received - p.pages.length };
  }

  async flush(chatId: string) {
    const p = this.pending.get(chatId);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    this.pending.delete(chatId);
    const { timer, expectedTotal, received, ...batch } = p;
    try {
      await this.onFlush(batch);
    } catch (err) {
      console.error('[aggregator] flush failed', err);
    }
  }

  async flushAll() {
    await Promise.all([...this.pending.keys()].map(k => this.flush(k)));
  }

  size() {
    return this.pending.size;
  }
}
