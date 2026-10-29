/**
 * Master-data sync CLI (waste-sorting dictionary now; grocery tables later use the same pipeline).
 * Sources live in data/sources/<id>.json; results in $MASTERDATA_DIR (default data/masterdata).
 *
 *   npx tsx scripts/data.ts status
 *   npx tsx scripts/data.ts inspect <source-id> [--file x.csv] [--updated YYYY-MM-DD]
 *   npx tsx scripts/data.ts sync <source-id>|--all [--dry-run] [--force] [--file x.csv] [--updated YYYY-MM-DD]
 *   npx tsx scripts/data.ts review <source-id>                # staged: class mix, city labels, how dangerous items are filed
 *   npx tsx scripts/data.ts diff <source-id>                  # staged vs live
 *   npx tsx scripts/data.ts publish <source-id> [--by name]   # staged → live
 *   npx tsx scripts/data.ts reject <source-id>                # drop staged
 *   npx tsx scripts/data.ts rollback <source-id> [--to N] [--by name]
 *   npx tsx scripts/data.ts check-links
 *   npx tsx scripts/data.ts discover <ckan-api> [--query ごみ分別] [--rows 30] [--start 0] [--org 神奈川|川崎] [--json]   # find datasets on a CKAN portal
 *   npx tsx scripts/data.ts scaffold <source-id> --city <JIS> [--kind gomi_items|gomi_schedule]
 *        (--ckan <api> --dataset <name> [--resource-match r] | --file x.csv --url <dataset page>)
 *        [--license ...] [--attribution ...] [--updated YYYY-MM-DD] [--write] [--force]   # draft a registry entry from a real file
 *
 * `sync --all` only runs sources that are due (monthly; weekly Jan–Apr for fiscal-year calendars);
 * add --force to run all. Exit code 1 if any sync failed, so a scheduler can alert.
 */
import fs from 'fs';
import path from 'path';
import { ckanAction, CkanPackage, fetchSource, httpFetcher, isCsvResource } from '../src/server/lens/masterdata/adapters.ts';
import { renderScaffold, scaffoldSource } from '../src/server/lens/masterdata/scaffold.ts';
import { diffRows, formatDiff } from '../src/server/lens/masterdata/diff.ts';
import { loadCityInfo } from '../src/server/lens/cityinfo.ts';
import { loadSources, validateSourceConfig } from '../src/server/lens/masterdata/registry.ts';
import { renderInspect, renderReview, renderStatus } from '../src/server/lens/masterdata/report.ts';
import { FileMasterStore } from '../src/server/lens/masterdata/store.ts';
import { isDue, publishStaged, rejectStaged, rollback, syncSource } from '../src/server/lens/masterdata/sync.ts';
import { SourceConfig } from '../src/server/lens/masterdata/types.ts';

const sourcesDir = process.env.MASTERDATA_SOURCES || 'data/sources';
const store = new FileMasterStore(process.env.MASTERDATA_DIR || 'data/masterdata');

const args = process.argv.slice(2);
const [cmd, ...rest] = args;
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string) => args.includes(`--${name}`);
const positional = rest[0] && !rest[0].startsWith('--') ? [rest[0]] : [];

function pick(id: string | undefined): SourceConfig {
  const all = loadSources(sourcesDir);
  const s = all.find(x => x.id === id);
  if (!s) throw new Error(`unknown source "${id ?? ''}". Have: ${all.map(x => x.id).join(', ') || '(none in ' + sourcesDir + ')'}`);
  return s;
}

function localFile() {
  const f = flag('file');
  if (!f) return undefined;
  return { bytes: fs.readFileSync(path.resolve(f)), source_updated_at: flag('updated'), url: `file:${path.basename(f)}` };
}

async function main() {
  switch (cmd) {
    case 'status':
      console.log(renderStatus(loadSources(sourcesDir), store));
      break;

    case 'inspect': {
      const src = pick(positional[0]);
      const file = localFile() ?? await fetchSource(src, httpFetcher);
      console.log(renderInspect(src, file.bytes, { url: file.url, source_updated_at: file.source_updated_at ?? src.source_updated_at }));
      break;
    }

    case 'sync': {
      const now = new Date();
      const targets = has('all')
        ? loadSources(sourcesDir).filter(s => s.enabled && (has('force') || isDue(s, store.getState(s.id).last_fetched_at, now)))
        : [pick(positional[0])];
      if (has('all') && !targets.length) console.log('Nothing due.');
      let failed = 0;
      for (const src of targets) {
        const r = await syncSource(src, { fetcher: httpFetcher, store, now, dryRun: has('dry-run'), force: has('force'), file: has('all') ? undefined : localFile() });
        const icon = { published: '✅', staged: '🕓', unchanged: '＝', failed: '❌', dry_run: '🔍' }[r.status];
        console.log(`${icon} ${src.id}: ${r.status} — ${r.detail}`);
        if (r.diff && r.status !== 'unchanged') console.log(formatDiff(r.diff).replace(/^/gm, '    '));
        for (const w of r.warnings.slice(0, 5)) console.log(`    ⚠ ${w}`);
        if (r.status === 'failed') failed++;
      }
      if (failed) process.exitCode = 1;
      break;
    }

    case 'review': {
      const id = pick(positional[0]).id;
      const snap = store.getStaged(id) ?? store.getLive(id);
      if (!snap) throw new Error('nothing staged or live: run sync first');
      console.log(renderReview(snap));
      break;
    }

    case 'diff': {
      const id = pick(positional[0]).id;
      const staged = store.getStaged(id);
      if (!staged) { console.log('Nothing staged.'); break; }
      console.log(`staged (source date ${staged.meta.source_updated_at})${staged.meta.review_reasons?.length ? `\nreview: ${staged.meta.review_reasons.join('; ')}` : ''}\n`);
      console.log(formatDiff(diffRows(store.getLive(id)?.rows ?? [], staged.rows), 40));
      break;
    }

    case 'publish': {
      const s = publishStaged(store, pick(positional[0]).id, flag('by') || process.env.USER || 'admin');
      console.log(`Published v${s.meta.version} (${s.rows.length} rows, verified by ${s.meta.verified_by})`);
      break;
    }

    case 'reject': {
      rejectStaged(store, pick(positional[0]).id);
      console.log('Staged version dropped.');
      break;
    }

    case 'rollback': {
      const to = flag('to');
      const s = rollback(store, pick(positional[0]).id, to ? Number(to) : undefined, flag('by') || process.env.USER || 'admin');
      console.log(`Live is now v${s.meta.version} (${s.meta.note}).`);
      break;
    }

    case 'discover': {
      const api = positional[0];
      if (!api) throw new Error('usage: discover <ckan-api-base>, e.g. https://catalog.data.metro.tokyo.lg.jp/api/3/action');
      const res = await ckanAction<{ count: number; results: CkanPackage[] }>(httpFetcher, api, 'package_search', { q: flag('query') || 'ごみ分別', rows: flag('rows') || '30', start: flag('start') || '0' });
      // --org filters on publisher and title (portals like data.go.jp hold every municipality)
      const org = flag('org') ? new RegExp(flag('org')!) : null;
      const shown = org ? res.results.filter(p => org.test(`${p.organization?.title ?? ''} ${p.title ?? ''}`)) : res.results;
      if (has('json')) { console.log(JSON.stringify(shown, null, 1)); break; }
      console.log(`${res.count} dataset(s) match; fetched ${res.results.length} from ${flag('start') || 0}${org ? `, ${shown.length} match --org` : ''}\n`);
      for (const p of shown) {
        const csv = (p.resources ?? []).filter(isCsvResource).length;
        const formats = [...new Set((p.resources ?? []).map(r => (r.format || '?').toUpperCase()))].join('/');
        console.log(`${(p.name ?? p.id ?? '').padEnd(24)} ${(p.organization?.title ?? '').padEnd(12)} ${(p.license_title || p.license_id || 'license?').padEnd(18)} ${`csv×${csv} (${formats})`.padEnd(16)} ${(p.metadata_modified ?? '').slice(0, 10)}  ${p.title ?? ''}`);
      }
      console.log('\nNext: scaffold <source-id> --city <JIS> --kind gomi_items|gomi_schedule --ckan <api> --dataset <name>');
      break;
    }

    case 'scaffold': {
      const id = positional[0];
      const city = flag('city');
      const kind = (flag('kind') || 'gomi_items') as 'gomi_items' | 'gomi_schedule';
      if (!id || !city) throw new Error('usage: scaffold <source-id> --city <JIS 5 digits> [--kind ...] (--ckan <api> --dataset <name> | --file x.csv --url <page>)');
      if (kind !== 'gomi_items' && kind !== 'gomi_schedule') throw new Error('--kind must be gomi_items or gomi_schedule');
      const ckanApi = flag('ckan');
      const dataset = flag('dataset');
      const local = localFile();
      if (!local && !(ckanApi && dataset)) throw new Error('give --ckan <api> --dataset <name>, or --file <csv> --url <dataset page>');
      let bytes: Buffer;
      let license = flag('license');
      let attribution = flag('attribution');
      let url = flag('url');
      let ckan: { api: string; dataset: string; resource_match?: string } | undefined;
      if (local) {
        if (!url) throw new Error('--url <dataset page> is required with --file: every row must say where it came from');
        bytes = local.bytes;
      } else {
        ckan = { api: ckanApi!, dataset: dataset!, ...(flag('resource-match') ? { resource_match: flag('resource-match') } : {}) };
        const pkg = await ckanAction<CkanPackage>(httpFetcher, ckan.api, 'package_show', { id: ckan.dataset });
        license ||= pkg.license_title || pkg.license_id;
        attribution ||= `${pkg.organization?.title ?? ''} 「${pkg.title ?? dataset}」${license ? ` (${license})` : ''}`.trim();
        bytes = (await fetchSource({ id, ckan, url: '' } as SourceConfig, httpFetcher)).bytes;
      }
      if (!license) throw new Error('--license is required (the dataset page says which)');
      attribution ||= `${id} (${license})`;
      const r = scaffoldSource({ id, city_code: city, kind, bytes, license, attribution, url, ckan, source_updated_at: flag('updated') });
      console.log(renderScaffold(r));
      const out = path.join(sourcesDir, `${id}.json`);
      if (!has('write')) { console.log(`\n(dry run: add --write to create ${out})`); break; }
      if (fs.existsSync(out) && !has('force')) throw new Error(`${out} exists (use --force to overwrite)`);
      try {
        validateSourceConfig(r.config, out); // an invalid file would break every command that loads the registry
      } catch (err) {
        console.log(`\nNot written: ${(err as Error).message}\nFix the TODO items (e.g. pass the right columns by editing a copy), then re-run.\n${JSON.stringify(r.config, null, 2)}`);
        process.exitCode = 1;
        break;
      }
      fs.mkdirSync(sourcesDir, { recursive: true });
      fs.writeFileSync(out, JSON.stringify(r.config, null, 2) + '\n');
      console.log(`\nWrote ${out} (enabled:false). Next: data inspect ${id}${local ? ` --file ${flag('file')}` : ''} → data sync ${id}${local ? ` --file ${flag('file')} --updated YYYY-MM-DD` : ''} → data diff / publish → set enabled:true.`);
      break;
    }

    case 'check-links': {
      let bad = 0;
      for (const src of loadSources(sourcesDir).filter(s => s.enabled)) {
        try {
          const f = await fetchSource(src, httpFetcher);
          console.log(`✅ ${src.id}  ${f.url}  (${f.bytes.length} bytes)`);
        } catch (err) {
          bad++;
          console.log(`❌ ${src.id}  ${(err as Error).message}`);
        }
      }
      // City facts shown to users as fact (粗大ごみ booking page, official page): a dead link there is worse than a dead dataset.
      const info = loadCityInfo(process.env.CITY_INFO_FILE || 'data/city-info.json');
      for (const [code, i] of Object.entries(info)) {
        for (const url of [i.sodai_booking_url, i.official_url, i.source_url].filter((u): u is string => !!u)) {
          try {
            await httpFetcher.get(url);
            console.log(`✅ city ${code}  ${url}`);
          } catch (err) {
            bad++;
            console.log(`❌ city ${code}  ${(err as Error).message}`);
          }
        }
      }
      if (bad) process.exitCode = 1;
      break;
    }

    default:
      console.log('Commands: status inspect sync review diff publish reject rollback check-links (see header of scripts/data.ts)');
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
