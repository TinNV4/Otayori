import fs from 'fs';
import path from 'path';
import { SOURCE_ID_RE } from './registry.ts';
import { Snapshot, SourceState } from './types.ts';

/**
 * Persistence boundary for master data. File-backed here (dev + scheduled job on a mounted disk);
 * a Firestore implementation can satisfy the same interface later.
 *
 * Layout: <root>/<source-id>/{live.json, staged.json, state.json, history/v<n>.json}
 */
export interface MasterStore {
  getLive(id: string): Snapshot | null;
  getStaged(id: string): Snapshot | null;
  saveStaged(id: string, s: Snapshot): void;
  clearStaged(id: string): void;
  /** Make a snapshot the live one and keep a copy under history/. Returns the version number used. */
  setLive(id: string, s: Snapshot): number;
  versions(id: string): number[];
  getVersion(id: string, v: number): Snapshot | null;
  getState(id: string): SourceState;
  saveState(state: SourceState): void;
  sourceIds(): string[];
}

export class FileMasterStore implements MasterStore {
  constructor(private readonly root: string) {}

  private dir(id: string) {
    if (!SOURCE_ID_RE.test(id)) throw new Error(`invalid source id "${id}"`);
    return path.join(this.root, id);
  }

  private read<T>(file: string): T | null {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
  }

  private write(file: string, data: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, file);
  }

  getLive = (id: string) => this.read<Snapshot>(path.join(this.dir(id), 'live.json'));
  getStaged = (id: string) => this.read<Snapshot>(path.join(this.dir(id), 'staged.json'));
  saveStaged = (id: string, s: Snapshot) => this.write(path.join(this.dir(id), 'staged.json'), s);
  clearStaged = (id: string) => fs.rmSync(path.join(this.dir(id), 'staged.json'), { force: true });

  versions(id: string): number[] {
    const h = path.join(this.dir(id), 'history');
    if (!fs.existsSync(h)) return [];
    return fs.readdirSync(h).map(f => /^v(\d+)\.json$/.exec(f)?.[1]).filter((v): v is string => !!v).map(Number).sort((a, b) => a - b);
  }

  getVersion = (id: string, v: number) => this.read<Snapshot>(path.join(this.dir(id), 'history', `v${v}.json`));

  setLive(id: string, s: Snapshot): number {
    const version = Math.max(0, ...this.versions(id), this.getLive(id)?.meta.version ?? 0) + 1;
    const snap: Snapshot = { meta: { ...s.meta, version }, rows: s.rows };
    this.write(path.join(this.dir(id), 'history', `v${version}.json`), snap);
    this.write(path.join(this.dir(id), 'live.json'), snap);
    return version;
  }

  getState(id: string): SourceState {
    return this.read<SourceState>(path.join(this.dir(id), 'state.json')) ?? { source_id: id };
  }
  saveState = (state: SourceState) => this.write(path.join(this.dir(state.source_id), 'state.json'), state);

  sourceIds(): string[] {
    return fs.existsSync(this.root) ? fs.readdirSync(this.root).filter(f => SOURCE_ID_RE.test(f)) : [];
  }
}

/** In-memory store for tests. */
export class MemoryMasterStore implements MasterStore {
  private live = new Map<string, Snapshot>();
  private staged = new Map<string, Snapshot>();
  private hist = new Map<string, Map<number, Snapshot>>();
  private states = new Map<string, SourceState>();
  getLive = (id: string) => this.live.get(id) ?? null;
  getStaged = (id: string) => this.staged.get(id) ?? null;
  saveStaged = (id: string, s: Snapshot) => void this.staged.set(id, s);
  clearStaged = (id: string) => void this.staged.delete(id);
  versions = (id: string) => [...(this.hist.get(id)?.keys() ?? [])].sort((a, b) => a - b);
  getVersion = (id: string, v: number) => this.hist.get(id)?.get(v) ?? null;
  setLive(id: string, s: Snapshot): number {
    const version = Math.max(0, ...this.versions(id)) + 1;
    const snap: Snapshot = { meta: { ...s.meta, version }, rows: s.rows };
    if (!this.hist.has(id)) this.hist.set(id, new Map());
    this.hist.get(id)!.set(version, snap);
    this.live.set(id, snap);
    return version;
  }
  getState = (id: string) => this.states.get(id) ?? { source_id: id };
  saveState = (s: SourceState) => void this.states.set(s.source_id, s);
  sourceIds = () => [...new Set([...this.live.keys(), ...this.states.keys()])];
}
