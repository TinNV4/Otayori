import { describe, expect, it } from 'vitest';
import { chomeAfterCity, chomeFrom, City, cityByMuniCd, cityFromAddress, cityNameFromAddress, findCities, loadCities } from '../src/server/lens/regions.ts';

const CITIES: City[] = [
  { code: '13118', prefecture_jp: '東京都', name_jp: '荒川区', name_vi: 'quận Arakawa (Tokyo)', aliases: ['arakawa'] },
  { code: '13114', prefecture_jp: '東京都', name_jp: '中野区', name_vi: 'quận Nakano (Tokyo)', aliases: ['nakano'] },
  { code: '14100', prefecture_jp: '神奈川県', name_jp: '横浜市', name_vi: 'thành phố Yokohama', aliases: ['yokohama'], designated: true },
  { code: '28100', prefecture_jp: '兵庫県', name_jp: '神戸市', name_vi: 'thành phố Kobe', aliases: ['kobe'], designated: true },
  { code: '27103', prefecture_jp: '大阪府', name_jp: '大阪市北区', name_vi: 'quận Kita (Osaka)', aliases: [] },
  { code: '26101', prefecture_jp: '京都府', name_jp: '京都市北区', name_vi: 'quận Kita (Kyoto)', aliases: [] },
];

describe('findCities (typed by a person)', () => {
  it.each([
    ['荒川区', ['13118']], ['東京都荒川区', ['13118']], ['arakawa', ['13118']], ['Arakawa', ['13118']],
    ['thành phố Yokohama', ['14100']], ['yokohama', ['14100']], ['ｙｏｋｏｈａｍａ', ['14100']],
    ['kobe', ['28100']],
  ])('%s → %j', (q, codes) => {
    expect(findCities(CITIES, q).map(c => c.code)).toEqual(codes);
  });
  it('returns several when ambiguous, and nothing for gibberish or one character', () => {
    expect(findCities(CITIES, '北区').map(c => c.code).sort()).toEqual(['26101', '27103']);
    expect(findCities(CITIES, 'zzzz')).toEqual([]);
    expect(findCities(CITIES, '区')).toEqual([]);
  });
});

describe('chomeFrom (never keeps the street number)', () => {
  it.each([
    ['西日暮里2-3-4', '西日暮里'],
    ['西日暮里2丁目3番4号', '西日暮里2丁目'],
    ['西日暮里２丁目３−４', '西日暮里2丁目'],
    ['西日暮里二丁目5番', '西日暮里二丁目'],
    [' 、西日暮里 2-3-4 ABCビル', '西日暮里'],
  ])('%s → %s', (rest, out) => expect(chomeFrom(rest)).toBe(out));
  it('returns nothing when there is no town', () => {
    expect(chomeFrom('')).toBeUndefined();
    expect(chomeFrom('123')).toBeUndefined();
  });
});

describe('chomeAfterCity (typed "khu vực <city> <town>")', () => {
  const [arakawa, , yokohama] = CITIES;
  it.each([
    [arakawa, '荒川区 西日暮里2丁目', '西日暮里2丁目'],
    [arakawa, '東京都荒川区西日暮里二丁目', '西日暮里二丁目'],
    [arakawa, 'arakawa 西日暮里', '西日暮里'],
    [arakawa, '荒川区', undefined],
    [yokohama, '横浜市港北区新横浜2丁目', '新横浜2丁目'],
  ])('%s %s → %s', (city, q, out) => expect(chomeAfterCity(city, q)).toBe(out));
});

describe('cityFromAddress (LINE location address)', () => {
  it('matches prefecture + city and keeps only town + chome', () => {
    const r = cityFromAddress(CITIES, '日本、〒116-0013 東京都荒川区西日暮里2-3-4')!;
    expect(r.city.code).toBe('13118');
    expect(r.chome_label).toBe('西日暮里');
    expect(JSON.stringify(r)).not.toMatch(/2-3-4|116-0013/);
  });
  it('uses the prefecture to tell same-named wards apart', () => {
    expect(cityFromAddress(CITIES, '日本、大阪府大阪市北区梅田1-1')!.city.code).toBe('27103');
    expect(cityFromAddress(CITIES, '日本、京都府京都市北区紫野1-1')!.city.code).toBe('26101');
  });
  it('skips the ward of a designated city when reading the town', () => {
    const r = cityFromAddress(CITIES, '日本、〒222-0033 神奈川県横浜市港北区新横浜2丁目1-1')!;
    expect(r.city.code).toBe('14100');
    expect(r.chome_label).toBe('新横浜2丁目');
  });
  it('returns null for an unlisted city, and names it for the "unsupported" path', () => {
    const a = '日本、〒330-0063 埼玉県さいたま市浦和区高砂1-1';
    expect(cityFromAddress(CITIES, a)).toBeNull();
    expect(cityNameFromAddress(a)).toBe('さいたま市');
    expect(cityNameFromAddress('Somewhere 1-2-3')).toBeUndefined();
  });
});

describe('cityByMuniCd (GSI geocoder)', () => {
  it('maps a ward code to its designated city', () => {
    expect(cityByMuniCd(CITIES, '13118')?.name_jp).toBe('荒川区');
    expect(cityByMuniCd(CITIES, '14109')?.name_jp).toBe('横浜市'); // 港北区 → 横浜市
    expect(cityByMuniCd(CITIES, '28105')?.name_jp).toBe('神戸市');
    expect(cityByMuniCd(CITIES, '11100')).toBeUndefined();
  });
});

describe('data/cities.json (MVP cities)', () => {
  const cities = loadCities('data/cities.json');
  it('is valid and has unique codes', () => {
    expect(cities.map(c => c.name_jp)).toEqual(['川口市', '船橋市', '松戸市', '江戸川区', '足立区', '名古屋市', '大阪市']);
    expect(new Set(cities.map(c => c.code)).size).toBe(cities.length);
  });
  it('finds every MVP city by Japanese, romaji, or a LINE address', () => {
    for (const c of cities) {
      expect(findCities(cities, c.name_jp).map(x => x.code)).toEqual([c.code]);
      expect(findCities(cities, c.aliases![0]).map(x => x.code)).toEqual([c.code]);
      expect(cityFromAddress(cities, `日本、${c.prefecture_jp}${c.name_jp}テスト町1-2-3`)?.city.code).toBe(c.code);
    }
  });
  it('reads the town past a ward in Nagoya and Osaka (designated cities)', () => {
    expect(cityFromAddress(cities, '日本、〒460-0008 愛知県名古屋市中区栄3-1-1')).toMatchObject({ city: { code: '23100' }, chome_label: '栄' });
    expect(cityFromAddress(cities, '日本、大阪府大阪市浪速区日本橋4丁目1-1')).toMatchObject({ city: { code: '27100' }, chome_label: '日本橋4丁目' });
    expect(cityFromAddress(cities, '日本、東京都足立区綾瀬3-1-1')).toMatchObject({ city: { code: '13121' }, chome_label: '綾瀬' });
    expect(cityFromAddress(cities, '日本、埼玉県川口市並木1-1')?.chome_label).toBe('並木');
  });
});
