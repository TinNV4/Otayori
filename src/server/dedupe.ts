import crypto from 'crypto';
import { DocAction, DocEvent, ExtractedDocument } from '../types/index.ts';

const SAME_DOC_WINDOW_DAYS = 60;

export function pageHash(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
}

/** Loose text key: NFKC, lowercase, letters/digits only (works for 日本語 and Vietnamese). */
export function normText(s: string | undefined): string {
  return (s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Wording of model output varies between runs, so key events by date + time (or Japanese title). */
export function eventKey(e: Pick<DocEvent, 'date' | 'start_time' | 'title_jp' | 'title_vi'>): string {
  return `${e.date}|${e.start_time || normText(e.title_jp || e.title_vi)}`;
}

/** Same photo(s) already read: every page hash is in one stored document. */
export function findExactDuplicate(hashes: string[], docs: ExtractedDocument[]): ExtractedDocument | null {
  if (!hashes.length) return null;
  return docs.find(d => d.source_hashes && hashes.every(h => d.source_hashes!.includes(h))) || null;
}

/**
 * Same paper photographed again (different bytes): same Japanese title and issuer,
 * and the dated items overlap (or neither has dates). Only looks at recent documents.
 */
export function findSameDocument(doc: ExtractedDocument, docs: ExtractedDocument[], now: Date): ExtractedDocument | null {
  const title = normText(doc.title_jp);
  const dates = (d: ExtractedDocument) => new Set([...d.events.map(e => e.date), ...d.actions.map(a => a.deadline).filter(Boolean) as string[]]);
  const mine = dates(doc);
  const mineKeys = new Set(doc.events.map(eventKey));
  for (const other of docs) {
    if (other.id === doc.id) continue;
    if (now.getTime() - Date.parse(other.created_at) > SAME_DOC_WINDOW_DAYS * 86400_000) continue;
    const sharedEvents = other.events.filter(e => mineKeys.has(eventKey(e))).length;
    if (sharedEvents >= 2) return other;
    if (!title || normText(other.title_jp) !== title) continue;
    const issuerA = normText(doc.issuer);
    const issuerB = normText(other.issuer);
    if (issuerA && issuerB && !issuerA.includes(issuerB.slice(0, 6)) && !issuerB.includes(issuerA.slice(0, 6))) continue;
    const theirs = dates(other);
    if ((!mine.size && !theirs.size) || [...mine].some(d => theirs.has(d))) return other;
  }
  return null;
}

/**
 * Fold anything new from a re-sent paper (e.g. a page that was missing) into the stored document.
 * Returns how many calendar items were added.
 */
export function mergeInto(target: ExtractedDocument, incoming: ExtractedDocument): number {
  let added = 0;
  const keys = new Set(target.events.map(eventKey));
  for (const e of incoming.events) {
    if (keys.has(eventKey(e))) continue;
    keys.add(eventKey(e));
    target.events.push({ ...e, id: `e${target.events.length}m${added}` });
    added++;
  }
  const deadlines = new Set(target.actions.map(a => a.deadline).filter(Boolean));
  for (const a of incoming.actions) {
    if (!a.deadline || deadlines.has(a.deadline)) continue; // undated actions are too fuzzy to match safely
    deadlines.add(a.deadline);
    target.actions.push({ ...(a as DocAction), id: `a${target.actions.length}m${added}` });
    added++;
  }
  const items = new Set(target.items_to_bring.map(normText));
  for (const i of incoming.items_to_bring) if (!items.has(normText(i))) { target.items_to_bring.push(i); items.add(normText(i)); }
  target.source_hashes = [...new Set([...(target.source_hashes || []), ...(incoming.source_hashes || [])])];
  if (incoming.pages_count > target.pages_count) target.pages_count = incoming.pages_count;
  return added;
}
