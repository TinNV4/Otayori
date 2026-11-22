#!/usr/bin/env python3
"""Turn day-by-day collection calendars into a schedule_csv_v1 file (one row per area, one cell = date list).

Input:
  --areas areas.json   {"<district>": [["<町名>", "<丁目 cell>"], ...], ...}
  --dir   out/         <district>.csv with header `date,category` (one row per date × category)
Output (stdout): CSV `地区,町名,丁目,<category 1>,<category 2>,...` where each category cell is
"YYYY-MM-DD YYYY-MM-DD …" — parseRuleText reads it as a { type: 'dates' } rule.

Checks (exit 1 on any): unknown district file, duplicate rows, bad dates, dates outside --from/--to.
Prints a per-district summary (count per category, usual weekdays) to stderr for review.

Usage: python3 scripts/calendar-dates-to-csv.py --areas data/raw/fuchu/areas.json --dir out --from 2026-04-01 --to 2027-03-31 > data/raw/fuchu/schedule.csv
"""
import argparse, collections, csv, datetime, json, os, sys

ap = argparse.ArgumentParser()
ap.add_argument('--areas', required=True)
ap.add_argument('--dir', required=True)
ap.add_argument('--from', dest='start', required=True)
ap.add_argument('--to', dest='end', required=True)
a = ap.parse_args()

areas = {k: v for k, v in json.load(open(a.areas, encoding='utf-8')).items() if not k.startswith('_')}
start, end = datetime.date.fromisoformat(a.start), datetime.date.fromisoformat(a.end)
WD = '月火水木金土日'
errors, data, cats = [], {}, []
for district in areas:
    path = os.path.join(a.dir, f'{district}.csv')
    if not os.path.exists(path):
        errors.append(f'{district}: missing {path}')
        continue
    seen, by_cat = set(), collections.defaultdict(list)
    for row in csv.DictReader(open(path, encoding='utf-8-sig')):
        d, c = row['date'].strip(), row['category'].strip()
        try:
            day = datetime.date.fromisoformat(d)
        except ValueError:
            errors.append(f'{district}: bad date {d!r}'); continue
        if not start <= day <= end:
            errors.append(f'{district}: {d} outside {a.start}..{a.end}')
        if (d, c) in seen:
            errors.append(f'{district}: duplicate {d} {c}')
        seen.add((d, c))
        by_cat[c].append(d)
        if c not in cats:
            cats.append(c)
    data[district] = by_cat
    summary = ', '.join(
        f"{c} {len(ds)} ({''.join(sorted({WD[datetime.date.fromisoformat(x).weekday()] for x in ds}, key=WD.index))})"
        for c, ds in sorted(by_cat.items(), key=lambda kv: cats.index(kv[0])))
    print(f'{district}: {summary}', file=sys.stderr)
for f in os.listdir(a.dir):
    if f.endswith('.csv') and f[:-4] not in areas:
        errors.append(f'unknown district file {f}')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)

w = csv.writer(sys.stdout, lineterminator='\n')
w.writerow(['地区', '町名', '丁目', *cats])
for district, towns in areas.items():
    for town, chome in towns:
        w.writerow([district, town, chome, *(' '.join(sorted(data[district].get(c, []))) for c in cats)])
