import { AppConfig } from '../config.ts';
import { FirestoreRepo } from './firestore.ts';
import { MemoryRepo } from './memory.ts';
import { Repo } from './repo.ts';

export function createRepo(cfg: AppConfig): Repo {
  if (cfg.storage === 'firestore') return new FirestoreRepo();
  if (cfg.storage === 'file') return new MemoryRepo(cfg.dataFile);
  return new MemoryRepo();
}
