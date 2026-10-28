import { MasterStore } from '../masterdata/store.ts';
import { GomiItem, SourceConfig } from '../masterdata/types.ts';
import { StoreDictionary } from './core.ts';

/** Verified rows of every source for a city. A source with no published version contributes nothing (staged data is never served). */
export function dictionaryFromStore(store: MasterStore, sources: SourceConfig[]): StoreDictionary {
  return new StoreDictionary(cityCode => {
    const seen = new Map<string, GomiItem>();
    for (const s of sources.filter(x => x.city_code === cityCode && x.kind === 'gomi_items')) {
      for (const r of store.getLive(s.id)?.rows ?? []) if (r.status === 'verified') seen.set(r.id, r);
    }
    return [...seen.values()];
  });
}
