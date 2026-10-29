import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import { createApp } from '../src/server/app.ts';
import { MemoryRepo } from '../src/server/db/memory.ts';
import { RecordingLineApi } from '../src/server/line.ts';
import { MockExtractor } from '../src/server/extract.ts';
import { TemplateComposer } from '../src/server/renraku.ts';
import { answerGomi } from '../src/server/lens/gomi/core.ts';
import { generateGomiIcs, rruleFor } from '../src/server/lens/gomi/gomiIcs.ts';
import { MockRecognizer } from '../src/server/lens/gomi/recognize.ts';
import {
  areaRows, firstDate, inSuspension, isoWeekday, nextCollectionFor, nextDate, normArea, ScheduleBook, scheduleFromStore, suspendedDates,
} from '../src/server/lens/gomi/schedule.ts';
import { getAdapter, SyncError } from '../src/server/lens/masterdata/adapters.ts';
import { validateSourceConfig } from '../src/server/lens/masterdata/registry.ts';
import { expandAreas, parseRuleText } from '../src/server/lens/masterdata/scheduleRule.ts';
import { MemoryMasterStore } from '../src/server/lens/masterdata/store.ts';
import { publishStaged, syncSource } from '../src/server/lens/masterdata/sync.ts';
import { CommonClass, GomiItem, ScheduleRow, ScheduleRule, SourceConfig } from '../src/server/lens/masterdata/types.ts';
import { loadCityInfo } from '../src/server/lens/cityinfo.ts';
import { familyIdForChat } from '../src/server/service.ts';
import { activate, ev, group, lastText, setup, textEv, testConfig } from './helpers.ts';
import fs from 'fs';

const NOW = new Date('2026-10-28T00:00:00Z'); // Wednesday, the 4th Wednesday of October 2026

describe('parseRuleText', () => {
  const w = (...days: number[]): ScheduleRule => ({ type: 'weekly', days });
  const n = (nths: number[], ...days: number[]): ScheduleRule => ({ type: 'nth', days, nths });
  it.each([
    ['月・木', w(1, 4)], ['月木', w(1, 4)], ['毎週月曜日', w(1)], ['毎週 火・金 曜日', w(2, 5)], ['月、水、金', w(1, 3, 5)],
    ['月曜日（祝日も収集）', w(1)], ['日', w(7)],
    ['水曜日;土曜日', w(3, 6)], ['月曜日～土曜日', w(1, 2, 3, 4, 5, 6)], ['月曜日・火曜日・水曜日\n金曜日・土曜日', w(1, 2, 3, 5, 6)], ['金曜日～月曜日', w(1, 5, 6, 7)],
    ['第1;第3土曜日', n([1, 3], 6)], ['第1・第3木曜日', n([1, 3], 4)],
    ['第2・4水曜日', n([2, 4], 3)], ['第1,3火', n([1, 3], 2)], ['第2第4水', n([2, 4], 3)], ['第１・３木曜', n([1, 3], 4)], ['第2週 金曜日', n([2], 5)],
  ])('%s', (text, rule) => expect(parseRuleText(text)).toEqual(rule));
  it.each(['', 'なし', '－', '-', '収集なし', '×'])('"%s" = no collection', t => expect(parseRuleText(t)).toBe('none'));
  it.each(['毎日', '随時', '月・？', '第6水', '年4回', 'abc'])('"%s" is not understood (never guessed)', t => expect(parseRuleText(t)).toBeNull());
});

const src: SourceConfig = {
  id: 'city-13118-schedule', city_code: '13118', kind: 'gomi_schedule', adapter: 'schedule_csv_v1', enabled: true, url: 'https://x/s.csv',
  encoding: 'utf-8', license: 'CC-BY-4.0', attribution: '荒川区 収集曜日一覧', cadence: 'monthly',
  schedule: {
    area_column: '町丁目', city_code_column: 'コード',
    categories: [
      { column: '燃やすごみ', local_category: '燃やすごみ', common_class: 'burnable' },
      { column: '燃やさないごみ', local_category: '燃やさないごみ', common_class: 'non_burnable' },
      { column: '有害ごみ', local_category: '有害ごみ', common_class: 'hazardous' },
    ],
    suspensions: [{ from: '12-29', to: '01-03' }],
  },
};
const HEAD = 'コード,町丁目,燃やすごみ,燃やさないごみ,有害ごみ';
const csv = (rows: string[]) => Buffer.from([HEAD, ...rows].join('\n'), 'utf8');
const ctx = { fetchedAt: NOW.toISOString(), sourceUrl: src.url, sourceUpdatedAt: '2026-04-01' };
const parse = (b: Buffer, s = src) => getAdapter('schedule_csv_v1').parse(b, s, ctx);
const SCHED = csv([
  '13118,西日暮里1丁目,月・木,第2・4水,第1金',
  '13118,西日暮里2丁目,火・金,第2・4水,なし',
  '13118,荒川1丁目,月・木,-,',
  '99999,他区,月,月,月',
]);

describe('expandAreas (town + 丁目 cell as real cities write it)', () => {
  it.each([
    ['江原町', '全域', ['江原町']], ['江原町', '', ['江原町']],
    ['野方', '3', ['野方3丁目']], ['野方', '3丁目', ['野方3丁目']],
    ['新井', '1;2;4;5', ['新井1丁目', '新井2丁目', '新井4丁目', '新井5丁目']], ['小石川', '2・3丁目', ['小石川2丁目', '小石川3丁目']],
    ['銀座', '1～2丁目', ['銀座1丁目', '銀座2丁目']], ['白山', '３～５丁目', ['白山3丁目', '白山4丁目', '白山5丁目']],
    ['小石川', '1丁目1～16番', ['小石川1丁目1~16番']], // a block inside a chome stays literal (～ is normalized to ~)
    ['一之江', '1から5丁目', ['一之江1丁目', '一之江2丁目', '一之江3丁目', '一之江4丁目', '一之江5丁目']],
    ['鹿骨', '1・2・3丁目 （1から17）', ['鹿骨1丁目(1から17)', '鹿骨2丁目(1から17)', '鹿骨3丁目(1から17)']], // blocks of several chomes
    ['鹿骨', '3丁目 （18から20）', ['鹿骨3丁目(18から20)']],
  ])('%s | %s', (town, cell, want) => expect(expandAreas(town, cell)).toEqual(want));
});

describe('schedule_csv_v1 adapter', () => {
  it('reads one rule per area × category, skips "none" cells and other cities, keeps provenance', () => {
    const { rows, warnings } = parse(SCHED);
    const sr = rows as ScheduleRow[];
    expect(sr).toHaveLength(3 + 2 + 1); // 西日暮里1: 3, 西日暮里2: 2, 荒川1: 1
    expect(sr.find(r => r.area_key === '西日暮里1丁目' && r.common_class === 'burnable')).toMatchObject({
      rule: { type: 'weekly', days: [1, 4] }, rule_text: '月・木', local_category: '燃やすごみ', city_code: '13118',
      source_id: src.id, source_updated_at: '2026-04-01', license: 'CC-BY-4.0', attribution: '荒川区 収集曜日一覧', status: 'draft',
    });
    expect(warnings.join()).toMatch(/other city_code/);
    expect(new Set(sr.map(r => r.id)).size).toBe(sr.length);
  });
  it('two area columns, 6-digit city codes (check digit), and ICS skips 粗大ごみ', () => {
    const cfg: SourceConfig = { ...src, schedule: { ...src.schedule!, area_column: undefined, area_columns: ['町名', '丁目'], city_code_column: 'コード', categories: [
      { column: '燃やすごみ', local_category: '燃やすごみ', common_class: 'burnable' }, { column: '粗大ごみ', local_category: '粗大ごみ', common_class: 'sodai' }] } };
    const bytes = Buffer.from('コード,町名,丁目,燃やすごみ,粗大ごみ\n131181,野方,1;2,月曜日;木曜日,金曜日\n131181,江原町,全域,火曜日～土曜日,\n131181,野方,3,水曜日;土曜日,\n999999,他,全域,月曜日,月曜日\n');
    const { rows, warnings } = parse(bytes, cfg);
    const sr = rows as ScheduleRow[];
    expect(sr.map(r => `${r.area_key}/${r.common_class}`).sort()).toEqual(['江原町/burnable', '野方1丁目/burnable', '野方1丁目/sodai', '野方2丁目/burnable', '野方2丁目/sodai', '野方3丁目/burnable'].sort());
    expect(warnings.join()).toMatch(/other city_code/);
    const region = { city_code: '13118', city_name_jp: '荒川区', label_vi: 'x', set_at: '', via: 'text' as const };
    const ics = generateGomiIcs(region, sr.filter(r => r.area_key === '野方1丁目'), [], '2026-10-28', NOW);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TH');
    expect(ics).not.toContain('Rác cồng kềnh'); // appointment-only: never a weekly reminder
    // a family in 江原町2丁目 is covered by the whole-town row
    expect(areaRows(sr, '江原町2丁目').rows.map(r => r.area_key)).toEqual(['江原町']);
    expect(areaRows(sr, '野方1丁目').rows.map(r => r.common_class).sort()).toEqual(['burnable', 'sodai']);
    expect(areaRows(sr, '野方').ambiguous).toBe(true); // 野方3丁目 differs from 1–2丁目
  });
  it('stops on text it cannot read, listing it', () => {
    let err: SyncError | undefined;
    try { parse(csv(['13118,A,月・木,毎日,', '13118,B,随時,毎日,'])); } catch (e) { err = e as SyncError; }
    expect(err?.code).toBe('unreadable_rule');
    expect(err?.message).toMatch(/"毎日" ×2/);
    expect(err?.message).toMatch(/"随時" ×1/);
  });
  it('stops on missing columns, and supports a city-wide file without an area column', () => {
    expect(() => parse(Buffer.from('a,b\n1,2'))).toThrow(/missing column.*町丁目/);
    const wide: SourceConfig = { ...src, schedule: { ...src.schedule!, area_column: undefined, city_code_column: undefined } };
    const rows = parse(Buffer.from('燃やすごみ,燃やさないごみ,有害ごみ\n月・木,第2水,'), wide).rows as ScheduleRow[];
    expect(rows.map(r => r.area_key)).toEqual(['*', '*']);
  });
  it('registry validates schedule sources', () => {
    const cfg = { ...src };
    expect(validateSourceConfig(cfg, 'data/sources/city-13118-schedule.json').kind).toBe('gomi_schedule');
    expect(() => validateSourceConfig({ ...cfg, schedule: { categories: [] } }, 'data/sources/city-13118-schedule.json')).toThrow(/schedule.categories/);
    expect(() => validateSourceConfig({ ...cfg, schedule: { ...cfg.schedule!, suspensions: [{ from: '1229', to: '01-03' }] } }, 'data/sources/city-13118-schedule.json')).toThrow(/MM-DD/);
  });
});

describe('sync of schedule data (same safety net as items)', () => {
  const run = (store: MemoryMasterStore, b: Buffer) => syncSource(src, { fetcher: { get: async () => { throw new Error('net'); } }, store, now: NOW, file: { bytes: b, source_updated_at: '2026-04-01' } });
  it('stages the first import, shows rule changes in the diff, never auto-publishes a lost 有害ごみ day', async () => {
    const store = new MemoryMasterStore();
    expect((await run(store, SCHED)).status).toBe('staged');
    publishStaged(store, src.id, 'tin', NOW);

    // 西日暮里1丁目 月・木 → 月・金 : 1 of 6 rows ≈ 17% > 5% → staged, and the diff says what changed
    const changed = await run(store, csv(['13118,西日暮里1丁目,月・金,第2・4水,第1金', '13118,西日暮里2丁目,火・金,第2・4水,なし', '13118,荒川1丁目,月・木,-,']));
    expect(changed.status).toBe('staged');
    expect(changed.diff!.changed).toHaveLength(1);
    expect(changed.diff!.changed[0].fields).toEqual(['rule', 'rule_text']);

    // the hazardous-waste day disappears → flagged as a safety review
    const lost = await run(store, csv(['13118,西日暮里1丁目,月・木,第2・4水,', '13118,西日暮里2丁目,火・金,第2・4水,なし', '13118,荒川1丁目,月・木,-,']));
    expect(lost.review_reasons.join()).toMatch(/safety item removed: "西日暮里1丁目 \/ 有害ごみ"/);
    expect(store.getLive(src.id)!.rows).toHaveLength(6);
  });
});

function book(rows: ScheduleRow[], sus = src.schedule!.suspensions!): ScheduleBook {
  return { rows: () => rows, suspensions: () => sus };
}
const ROWS = parse(SCHED).rows as ScheduleRow[];

describe('areas', () => {
  it('normalizes chome numerals and width', () => {
    expect(normArea('西日暮里二丁目')).toBe('西日暮里2丁目');
    expect(normArea(' 西日暮里 ２丁目')).toBe('西日暮里2丁目');
    expect(normArea('東十条十一丁目')).toBe('東十条11丁目');
  });
  it('exact chome → its rows', () => {
    const r = areaRows(ROWS, '西日暮里二丁目');
    expect(r.ambiguous).toBe(false);
    expect(new Set(r.rows.map(x => x.area_key))).toEqual(new Set(['西日暮里2丁目']));
  });
  it('a town whose chomes differ is ambiguous: never a guess', () => {
    expect(areaRows(ROWS, '西日暮里')).toEqual({ rows: [], ambiguous: true });
    expect(areaRows(ROWS, undefined)).toEqual({ rows: [], ambiguous: true });
  });
  it('a town whose chomes all agree is fine; an unknown area has no rows', () => {
    const same = ROWS.filter(r => r.area_key !== '西日暮里1丁目').map(r => ({ ...r }));
    const alike = [{ ...same.find(r => r.area_key === '荒川1丁目')!, area_key: '荒川2丁目', id: 'x' }, ...same.filter(r => r.area_key === '荒川1丁目')];
    const r = areaRows(alike, '荒川');
    expect(r.ambiguous).toBe(false);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(areaRows(ROWS, '日暮里9丁目')).toEqual({ rows: [], ambiguous: false });
  });
  it('city-wide rows apply to everyone', () => {
    const wide = ROWS.map(r => ({ ...r, area_key: '*' }));
    expect(areaRows(wide, undefined).rows).toHaveLength(wide.length);
  });
});

describe('dates', () => {
  it('weekdays and nth-weekday rules (Oct/Nov 2026)', () => {
    expect(isoWeekday('2026-10-28')).toBe(3);
    const weekly: ScheduleRule = { type: 'weekly', days: [1, 4] };
    expect(nextDate(weekly, '2026-10-28')).toBe('2026-10-29'); // Thursday
    expect(nextDate(weekly, '2026-10-29')).toBe('2026-10-29'); // today counts
    const nth: ScheduleRule = { type: 'nth', days: [3], nths: [2, 4] };
    expect(nextDate(nth, '2026-10-28')).toBe('2026-10-28'); // 4th Wednesday
    expect(nextDate(nth, '2026-10-29')).toBe('2026-11-11'); // 2nd Wednesday of November
    expect(nextDate({ type: 'nth', days: [3], nths: [5] }, '2026-10-01')).toBe('2026-12-30'); // a 5th Wednesday exists in Dec 2026
  });
  it('published suspensions are skipped, including ones that wrap the new year', () => {
    const sus = [{ from: '12-29', to: '01-03' }];
    expect(inSuspension('2026-12-31', sus)).toBe(true);
    expect(inSuspension('2027-01-02', sus)).toBe(true);
    expect(inSuspension('2026-12-28', sus)).toBe(false);
    expect(nextDate({ type: 'weekly', days: [1] }, '2026-12-29', sus)).toBe('2027-01-04');
    expect(nextDate({ type: 'weekly', days: [4] }, '2026-12-29', sus)).toBe('2027-01-07'); // Thu 31 Dec is suspended, next is 7 Jan
  });
  it('lists the dates a suspension removes (ICS EXDATE)', () => {
    expect(suspendedDates({ type: 'weekly', days: [4] }, '2026-12-01', [{ from: '12-29', to: '01-03' }], 60)).toEqual(['2026-12-31']);
    expect(firstDate({ type: 'weekly', days: [4] }, '2026-12-30')).toBe('2026-12-31'); // DTSTART ignores suspensions
  });
});

describe('nextCollectionFor', () => {
  it('earliest day among the classes asked about, with the city label', () => {
    const n = nextCollectionFor(book(ROWS), '13118', '西日暮里2丁目', ['burnable', 'non_burnable'], '2026-10-28');
    expect(n).toEqual({ date: '2026-10-28', label: 'Thứ Tư · 「燃やさないごみ」' }); // 4th Wed beats Fri
  });
  it('hints instead of guessing when the area is ambiguous; null without any schedule', () => {
    expect(nextCollectionFor(book(ROWS), '13118', '西日暮里', ['burnable'], '2026-10-28')).toMatchObject({ hint: expect.stringContaining('丁目') });
    expect(nextCollectionFor(book([]), '13118', '西日暮里2丁目', ['burnable'], '2026-10-28')).toBeNull();
  });
});

describe('garbage ICS', () => {
  const region = { city_code: '13118', city_name_jp: '荒川区', label_vi: 'quận Arakawa', chome_label: '西日暮里2丁目', set_at: '', via: 'text' as const };
  const rows = areaRows(ROWS, '西日暮里2丁目').rows;
  const raw = generateGomiIcs(region, rows, src.schedule!.suspensions!, '2026-10-28', NOW);
  const ics = raw.replace(/\r\n /g, ''); // unfolded, for matching text

  it('builds recurring all-day events with an alarm at 20:00 the evening before', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,FR');
    expect(ics).toContain('RRULE:FREQ=MONTHLY;BYDAY=2WE,4WE');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261030'); // first Friday on/after 28 Oct
    expect(ics).toContain('DTSTART;VALUE=DATE:20261028'); // the 4th Wednesday is today
    expect((ics.match(/TRIGGER:-PT4H/g) || []).length).toBe(rows.length);
    expect(ics).toContain('Nguồn: 荒川区 収集曜日一覧\\, cập nhật 2026-04-01.');
    expect(ics).toMatch(/X-WR-CALNAME:Lịch đổ rác · 荒川区 西日暮里2丁目/);
    expect(raw.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75)).toBe(true); // folded
  });
  it('excludes the published year-end suspension', () => {
    expect(ics).toContain('EXDATE;VALUE=DATE:20261229,20270101'); // 火・金 inside 12-29…01-03: Tue 29 Dec, Fri 1 Jan
  });
  it('rrule helper', () => {
    expect(rruleFor({ type: 'nth', days: [3, 5], nths: [1] })).toBe('FREQ=MONTHLY;BYDAY=1WE,1FR');
  });
});

describe('answers use the schedule', () => {
  const item = (name: string, cls: CommonClass): GomiItem => ({
    id: name, city_code: '13118', name_jp: name, kana: '', local_category: cls === 'sodai' ? '粗大ごみ' : '燃やすごみ', common_class: cls, note: '',
    source_id: 's', source_url: 'https://x', source_updated_at: '2026-04-01', fetched_at: NOW.toISOString(), license: 'CC-BY-4.0', attribution: '荒川区', status: 'verified',
  });
  const dict = { rows: () => [item('割り箸', 'burnable'), item('ソファ', 'sodai')] };
  const ask = (t: string, chome?: string, info = {}) =>
    answerGomi({ text: t }, { city_code: '13118', chome_label: chome }, {
      recognizer: new MockRecognizer(), dictionary: dict, schedule: book(ROWS), now: () => NOW, cityInfo: () => info,
    });
  const body = (a: { messages: Array<Record<string, unknown>> }) => a.messages.map(m => m.text).join('\n');

  it('adds the next day for the family’s area', async () => {
    const t = body(await ask('割り箸', '西日暮里2丁目'));
    expect(t).toMatch(/Ngày đổ gần nhất tại khu bạn: Thứ Sáu · 「燃やすごみ」 \(30\/10\/2026\)/);
    expect(t).toMatch(/Dịp lễ\/cuối năm có thể khác/);
  });
  it('says the day depends on the chome rather than guessing', async () => {
    expect(body(await ask('割り箸', '西日暮里'))).toMatch(/Ngày đổ khác nhau theo từng 丁目/);
  });
  it('粗大ごみ shows the booking info with its source and date, not a weekly day', async () => {
    const t = body(await ask('ソファ', '西日暮里2丁目', {
      sodai_booking_url: 'https://city.example/sodai', sodai_fee_note: 'ソファ 1,200円', source_url: 'https://city.example/fee', updated_at: '2026-09-01',
    }));
    expect(t).toContain('https://city.example/sodai');
    expect(t).toContain('ソファ 1,200円');
    expect(t).toContain('https://city.example/fee, kiểm tra ngày 01/09/2026');
    expect(t).not.toContain('Ngày đổ gần nhất');
  });
});

describe('scheduleFromStore + city info file', () => {
  it('serves only published, verified schedule rows and the source’s suspensions', async () => {
    const store = new MemoryMasterStore();
    const s = { ...src };
    expect(scheduleFromStore(store, [s]).rows('13118')).toEqual([]);
    await syncSource(s, { fetcher: { get: async () => { throw new Error('x'); } }, store, now: NOW, file: { bytes: SCHED, source_updated_at: '2026-04-01' } });
    expect(scheduleFromStore(store, [s]).rows('13118')).toEqual([]); // staged ≠ live
    publishStaged(store, s.id, 'tin', NOW);
    const b = scheduleFromStore(store, [s]);
    expect(b.rows('13118')).toHaveLength(6);
    expect(b.suspensions('13118')).toEqual([{ from: '12-29', to: '01-03' }]);
    expect(b.rows('99999')).toEqual([]);
  });
  it('city info must say where it comes from', () => {
    const f = '/tmp/claude-0/city-info-test.json';
    fs.writeFileSync(f, JSON.stringify({ '13118': { sodai_booking_url: 'https://c.example/x' } }));
    expect(() => loadCityInfo(f)).toThrow(/source_url.*updated_at/);
    fs.writeFileSync(f, JSON.stringify({ '13118': { sodai_booking_url: 'http://c.example/x', source_url: 'https://c.example', updated_at: '2026-09-01' } }));
    expect(() => loadCityInfo(f)).toThrow(/https/);
    fs.writeFileSync(f, JSON.stringify({ '13118': { sodai_booking_url: 'https://c.example/x', source_url: 'https://c.example', updated_at: '2026-09-01' } }));
    expect(loadCityInfo(f)['13118'].sodai_booking_url).toBe('https://c.example/x');
    expect(Object.keys(loadCityInfo('data/city-info.json'))).toEqual(['12204', '13121', '13123', '27100']); // the shipped file passes the same validation
  });
});

describe('bot + HTTP', () => {
  const cities = [{ code: '13118', prefecture_jp: '東京都', name_jp: '荒川区', name_vi: 'quận Arakawa (Tokyo)', aliases: ['arakawa'] }];
  const gomi = { recognizer: new MockRecognizer(), dictionary: { rows: () => [] as GomiItem[] }, schedule: book(ROWS) };

  it('"lịch rác": needs a region, then links the calendar page; region set mentions the schedule', async () => {
    const t = await setup({}, { cities, gomi });
    await activate(t.bot);
    const say = async (m: string) => { await t.bot.handleWebhook({ events: [textEv(group(), m)] }); return lastText(t.line); };
    expect(await say('lịch rác')).toMatch(/cần biết bạn ở đâu/);
    expect(await say('khu vực arakawa')).toMatch(/Lịch đổ rác khác nhau theo từng 丁目/); // town-less region: ambiguous
    expect(await say('lịch rác')).toMatch(/Lịch đổ rác khác nhau theo từng 丁目/);
    // region with a chome (as a LINE location would give)
    const fam = (await t.repo.getFamily(familyIdForChat('Cgroup1')))!;
    fam.region = { ...fam.region!, chome_label: '西日暮里2丁目' };
    await t.repo.saveFamily(fam);
    const out = await say('lịch rác');
    expect(out).toContain('Lịch đổ rác — 荒川区');
    expect(out).toContain(`/cal/${fam.ics_token}`);
  });

  it('serves /ics/<token>.gomi.ics for the family area and 404s without one; the calendar page offers it', async () => {
    const repo = new MemoryRepo();
    const line = new RecordingLineApi();
    const cfg = testConfig();
    const { app, bot } = createApp({ cfg, repo, line, extractor: new MockExtractor(), composer: new TemplateComposer(), verifyIdToken: null, gomi, cities });
    await repo.saveInviteCode((await import('../src/server/service.ts')).makeInvite('BETA2026', { quota: 50, maxUses: 20 }, new Date()));
    await activate(bot);
    const fam = (await repo.getFamily(familyIdForChat('Cgroup1')))!;
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/ics/${fam.ics_token}.gomi.ics`)).status).toBe(404); // no region yet
      expect(await (await fetch(`${base}/cal/${fam.ics_token}`)).text()).not.toContain('Lịch đổ rác');
      fam.region = { city_code: '13118', city_name_jp: '荒川区', label_vi: 'quận Arakawa', chome_label: '西日暮里2丁目', set_at: '', via: 'text' };
      await repo.saveFamily(fam);
      const res = await fetch(`${base}/ics/${fam.ics_token}.gomi.ics`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/calendar/);
      const body = await res.text();
      expect(body).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,FR');
      expect(body).not.toContain('Giấy Tờ Nhật · ');
      expect((await fetch(`${base}/ics/${'x'.repeat(30)}.gomi.ics`)).status).toBe(404);
      const page = await (await fetch(`${base}/cal/${fam.ics_token}`)).text();
      expect(page).toContain('Lịch đổ rác');
      expect(page).toContain(`webcal://bot.example.com/ics/${fam.ics_token}.gomi.ics`);
      // the paper-documents feed is unchanged
      expect(await (await fetch(`${base}/ics/${fam.ics_token}.ics`)).text()).toContain('Giấy Tờ Nhật');
    } finally {
      server.close();
    }
  });
});
