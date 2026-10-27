import { describe, expect, it } from 'vitest';
import { signBody, verifyLineSignature } from '../src/server/line.ts';
import { foldLine, generateIcsCalendar } from '../src/server/ics.ts';
import { calculateCostUsd, ClaudeExtractor, HAIKU_MODEL, needsSonnet, SONNET_MODEL, toDocument } from '../src/server/extract.ts';
import { findSameDocument, mergeInto } from '../src/server/dedupe.ts';
import { nextDayCompact } from '../src/server/time.ts';
import { ExtractedDocument, Family } from '../src/types/index.ts';

describe('LINE signature', () => {
  it('accepts valid and rejects tampered bodies', () => {
    const body = Buffer.from('{"events":[]}');
    const sig = signBody('secret', body);
    expect(verifyLineSignature('secret', body, sig)).toBe(true);
    expect(verifyLineSignature('secret', Buffer.from('{"events":[1]}'), sig)).toBe(false);
    expect(verifyLineSignature('other', body, sig)).toBe(false);
    expect(verifyLineSignature('secret', body, undefined)).toBe(false);
    expect(verifyLineSignature('secret', body, 'dev_simulated_sig')).toBe(false);
  });
});

describe('model routing + cost', () => {
  it('routes complex or low-confidence docs to Sonnet', () => {
    expect(needsSonnet('otayori', 0.95)).toBe(false);
    expect(needsSonnet('kondate', 0.8)).toBe(false);
    for (const t of ['yakusho', 'form', 'hospital'] as const) expect(needsSonnet(t, 0.99)).toBe(true);
    expect(needsSonnet('otayori', 0.65)).toBe(true);
  });
  it('prices per 1M tokens', () => {
    expect(calculateCostUsd(HAIKU_MODEL, 1_000_000, 1_000_000)).toBeCloseTo(0.6);
    expect(calculateCostUsd(SONNET_MODEL, 2000, 600)).toBeCloseTo(0.01);
  });
});

const raw = {
  doc_type: 'otayori' as const, title_jp: '遠足', title_vi: 'Dã ngoại', issuer: 'さくら保育園', summary_vi: 'Đi dã ngoại.',
  actions: [
    { todo_vi: 'Nộp phiếu', deadline: '2026-11-02', deadline_uncertain: false, priority: 'high' as const },
    { todo_vi: 'Nộp tiền', deadline: '2026-02-30', deadline_uncertain: false, priority: 'normal' as const },
  ],
  items_to_bring: ['Bình nước (水筒)'],
  events: [
    { title_vi: 'Dã ngoại', title_jp: '遠足', date: '2026-11-06', date_uncertain: false, start_time: '08:45', end_time: '14:30', location: 'Kasai, Rinkai', description_vi: '' },
    { title_vi: 'Bịa', title_jp: '', date: 'không rõ', date_uncertain: true, start_time: '', end_time: '', location: '', description_vi: '' },
  ],
  warnings_vi: [], disclaimer: '', confidence: 0.93,
};

describe('toDocument normalization', () => {
  it('drops impossible dates and flags them uncertain', () => {
    const doc = toDocument({ raw, model: HAIKU_MODEL, runs: [] }, { familyId: 'f', pages: 1, now: new Date('2026-10-26T00:00:00Z'), retentionDays: 90 });
    expect(doc.events).toHaveLength(1);
    expect(doc.events[0].time).toBe('08:45 - 14:30');
    expect(doc.actions[1].deadline).toBeUndefined();
    expect(doc.actions[1].deadline_uncertain).toBe(true);
    expect(doc.expire_at.slice(0, 10)).toBe('2027-01-24');
  });
});

describe('ICS', () => {
  const family = { family_name: 'Gia đình Tuấn, Mai' } as Family;
  const doc = toDocument({ raw, model: HAIKU_MODEL, runs: [] }, { familyId: 'f', pages: 1, now: new Date(), retentionDays: 90 });
  doc.events.push({ id: 'e9', title_vi: 'Họp phụ huynh', title_jp: '', date: '2026-11-20' });
  doc.actions.push({ id: 'a9', todo_vi: 'Đã làm', deadline: '2026-11-01', completed: true });
  const ics = generateIcsCalendar(family, [doc as ExtractedDocument], new Date('2026-10-26T00:00:00Z'));
  const unfolded = ics.replace(/\r\n /g, '');

  it('is RFC 5545 shaped', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(unfolded).toContain('X-WR-CALNAME:Giấy Tờ Nhật · Gia đình Tuấn\\, Mai');
    expect(unfolded).toContain('BEGIN:VTIMEZONE');
  });
  it('uses TZID for timed events and exclusive DTEND for all-day', () => {
    expect(unfolded).toContain('DTSTART;TZID=Asia/Tokyo:20261106T084500');
    expect(unfolded).toContain('DTEND;TZID=Asia/Tokyo:20261106T143000');
    expect(unfolded).toContain('DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121');
    expect(unfolded).toContain('SUMMARY:[HẠN] Nộp phiếu');
    expect(unfolded).toContain('LOCATION:Kasai\\, Rinkai');
  });
  it('has 1-day VALARMs and skips completed actions', () => {
    expect((unfolded.match(/TRIGGER:-P1D/g) || []).length).toBe(3);
    expect(unfolded).not.toContain('Đã làm');
  });
  it('folds lines at 75 octets without breaking UTF-8', () => {
    for (const l of ics.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    const long = 'SUMMARY:' + 'ギ'.repeat(60);
    expect(foldLine(long).replace(/\r\n /g, '')).toBe(long);
  });
  it('handles month/year rollover', () => {
    expect(nextDayCompact('20261231')).toBe('20270101');
    expect(nextDayCompact('20280228')).toBe('20280229');
  });
});

describe('ClaudeExtractor escalation', () => {
  function fakeClient(responses: Record<string, object>) {
    const calls: string[] = [];
    const client = {
      beta: {
        messages: {
          create: async (p: { model: string }) => {
            calls.push(p.model);
            const r = responses[p.model];
            return { stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 500 }, content: [{ type: 'text', text: JSON.stringify(r) }] };
          },
        },
      },
    };
    return { client: client as never, calls };
  }

  it('keeps Haiku for a confident お便り', async () => {
    const { client, calls } = fakeClient({ [HAIKU_MODEL]: raw });
    const out = await new ClaudeExtractor(undefined, client).extract([{ data: Buffer.from('x'), mediaType: 'image/jpeg' }], { today: '2026-10-26' });
    expect(calls).toEqual([HAIKU_MODEL]);
    expect(out.model).toBe(HAIKU_MODEL);
  });

  it('escalates 役所 to Sonnet and sums both costs', async () => {
    const yak = { ...raw, doc_type: 'yakusho', confidence: 0.9 };
    const { client, calls } = fakeClient({ [HAIKU_MODEL]: yak, [SONNET_MODEL]: { ...yak, title_vi: 'sonnet' } });
    const out = await new ClaudeExtractor(undefined, client).extract([{ data: Buffer.from('x'), mediaType: 'image/jpeg' }], { today: '2026-10-26' });
    expect(calls).toEqual([HAIKU_MODEL, SONNET_MODEL]);
    expect(out.raw.title_vi).toBe('sonnet');
    expect(out.runs).toHaveLength(2);
  });
});

describe('dedupe', () => {
  const base = () => toDocument({ raw, model: HAIKU_MODEL, runs: [] }, { familyId: 'f', pages: 1, now: new Date('2026-10-26T00:00:00Z'), retentionDays: 90 });

  it('merges only new dated items into the stored doc', () => {
    const a = base();
    const b = base();
    b.events.push({ id: 'x', title_vi: 'Họp', title_jp: '保護者会', date: '2026-11-20', start_time: '13:30' });
    expect(findSameDocument(b, [a], new Date('2026-10-27T00:00:00Z'))?.id).toBe(a.id);
    expect(mergeInto(a, b)).toBe(1);
    expect(a.events).toHaveLength(2);
    expect(mergeInto(a, b)).toBe(0);
  });

  it('does not treat a different paper as a duplicate', () => {
    const a = base();
    const b = { ...base(), title_jp: '運動会のお知らせ', events: [], actions: [] };
    expect(findSameDocument(b, [a], new Date())).toBeNull();
  });

  it('ICS shows the same event once even if stored in two documents', () => {
    const ics = generateIcsCalendar({ family_name: 'x' } as Family, [base(), base()]);
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(2); // 1 event + 1 dated action
  });
});
