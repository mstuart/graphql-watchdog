import type { CacheConfig, CacheStats } from '../types/index.js';
import type { NormalizedEntity } from './normalizer.js';
import type { CacheBackend } from './backend.js';

interface CacheEntry {
  data: unknown;
  entities: NormalizedEntity[];
  expiry: number;
  lastAccess: number;
}

const updateEntryCount = (stats: CacheStats, cache: Map<string, CacheEntry>): void => {
  stats.entries = cache.size;
};

const updateHitRate = (stats: CacheStats): void => {
  const total = stats.hits + stats.misses;
  stats.hitRate = total > 0 ? stats.hits / total : 0;
};

const updateTypeIndex = (
  typeIndex: Map<string, Set<string>>,
  cacheKey: string,
  entities: NormalizedEntity[],
): void => {
  for (const entity of entities) {
    let typeSet = typeIndex.get(entity.__typename);
    if (!typeSet) {
      typeSet = new Set();
      typeIndex.set(entity.__typename, typeSet);
    }
    typeSet.add(cacheKey);
  }
};

interface DeleteEntryOptions {
  cache: Map<string, CacheEntry>;
  cacheKey: string;
  stats: CacheStats;
  typeIndex: Map<string, Set<string>>;
}

const deleteEntry = ({ cache, cacheKey, stats, typeIndex }: DeleteEntryOptions): void => {
  const entry = cache.get(cacheKey);
  if (!entry) {
    return;
  }

  for (const entity of entry.entities) {
    const typeSet = typeIndex.get(entity.__typename);
    if (typeSet) {
      typeSet.delete(cacheKey);
      if (typeSet.size === 0) {
        typeIndex.delete(entity.__typename);
      }
    }
  }

  cache.delete(cacheKey);
  updateEntryCount(stats, cache);
};

const evictLRU = (
  cache: Map<string, CacheEntry>,
  typeIndex: Map<string, Set<string>>,
  stats: CacheStats,
): void => {
  let oldestKey: string | null = null;
  let oldestAccess = Infinity;

  for (const [key, entry] of cache) {
    if (entry.lastAccess >= oldestAccess) {
      continue;
    }
    oldestAccess = entry.lastAccess;
    oldestKey = key;
  }

  if (oldestKey) {
    deleteEntry({ cache, cacheKey: oldestKey, stats, typeIndex });
  }
};

interface ReadBackendEntryOptions {
  backend: CacheBackend;
  cacheKey: string;
  raw: string;
  stats: CacheStats;
  ttl: number;
}

const readBackendEntry = async ({
  backend,
  cacheKey,
  raw,
  stats,
  ttl,
}: ReadBackendEntryOptions): Promise<unknown | null> => {
  const entry = JSON.parse(raw) as CacheEntry;
  if (Date.now() > entry.expiry) {
    await backend.del(cacheKey);
    stats.misses += 1;
    updateHitRate(stats);
    return null;
  }

  entry.lastAccess = Date.now();
  await backend.set(cacheKey, JSON.stringify(entry), ttl);
  stats.hits += 1;
  updateHitRate(stats);
  return entry.data;
};

const runInBackground = async (operation: Promise<unknown>): Promise<void> => {
  try {
    await operation;
  } catch {
    // A synchronous cache API cannot expose asynchronous backend failures.
  }
};

export class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  // typename -> Set<cacheKey>
  private typeIndex = new Map<string, Set<string>>();
  private maxSize: number;
  private ttl: number;
  private stats: CacheStats = { entries: 0, hitRate: 0, hits: 0, misses: 0 };
  private backend: CacheBackend | null;

  constructor(config?: CacheConfig) {
    this.maxSize = config?.maxSize ?? 1000;
    this.ttl = config?.ttl ?? 60_000;
    this.backend = config?.backend ?? null;
  }

  set(cacheKey: string, data: unknown, entities: NormalizedEntity[]): void {
    if (this.backend) {
      // Use backend asynchronously, fire-and-forget for sync interface compat
      const entry: CacheEntry = {
        data,
        entities,
        expiry: Date.now() + this.ttl,
        lastAccess: Date.now(),
      };
      void runInBackground(this.backend.set(cacheKey, JSON.stringify(entry), this.ttl));
      // Still maintain type index in memory for invalidation
      updateTypeIndex(this.typeIndex, cacheKey, entities);
      updateEntryCount(this.stats, this.cache);
      return;
    }

    // Evict LRU if over maxSize
    if (this.cache.size >= this.maxSize && !this.cache.has(cacheKey)) {
      evictLRU(this.cache, this.typeIndex, this.stats);
    }

    const entry: CacheEntry = {
      data,
      entities,
      expiry: Date.now() + this.ttl,
      lastAccess: Date.now(),
    };

    this.cache.set(cacheKey, entry);
    updateTypeIndex(this.typeIndex, cacheKey, entities);
    updateEntryCount(this.stats, this.cache);
  }

  get(cacheKey: string): unknown | null {
    if (this.backend) {
      // For sync compatibility, backend-based get is async-only
      // Use getAsync for backend-based retrieval
      // Fallback: return null for sync calls with a backend
      this.stats.misses += 1;
      updateHitRate(this.stats);
      return null;
    }

    const entry = this.cache.get(cacheKey);

    if (!entry) {
      this.stats.misses += 1;
      updateHitRate(this.stats);
      return null;
    }

    // Check expiry
    if (Date.now() > entry.expiry) {
      deleteEntry({
        cache: this.cache,
        cacheKey,
        stats: this.stats,
        typeIndex: this.typeIndex,
      });
      this.stats.misses += 1;
      updateHitRate(this.stats);
      return null;
    }

    entry.lastAccess = Date.now();
    this.stats.hits += 1;
    updateHitRate(this.stats);
    return entry.data;
  }

  async getAsync(cacheKey: string): Promise<unknown | null> {
    if (this.backend) {
      const raw = await this.backend.get(cacheKey);
      if (!raw) {
        this.stats.misses += 1;
        updateHitRate(this.stats);
        return null;
      }

      try {
        return await readBackendEntry({
          backend: this.backend,
          cacheKey,
          raw,
          stats: this.stats,
          ttl: this.ttl,
        });
      } catch {
        this.stats.misses += 1;
        updateHitRate(this.stats);
        return null;
      }
    }

    // Delegate to sync get for in-memory
    return this.get(cacheKey);
  }

  invalidateByType(typename: string): number {
    const keys = this.typeIndex.get(typename);
    if (!keys) {
      return 0;
    }

    const count = keys.size;
    const keysToDelete = [...keys];

    if (this.backend) {
      // Async deletion, fire-and-forget
      void runInBackground(this.backend.delMany(keysToDelete));
    }

    for (const key of keysToDelete) {
      deleteEntry({
        cache: this.cache,
        cacheKey: key,
        stats: this.stats,
        typeIndex: this.typeIndex,
      });
    }

    return count;
  }

  invalidateByEntity(typename: string, id: string): number {
    const keys = this.typeIndex.get(typename);
    if (!keys) {
      return 0;
    }

    let count = 0;
    const keysToDelete: string[] = [];

    for (const key of keys) {
      const entry = this.cache.get(key);
      if (entry) {
        const hasEntity = entry.entities.some(
          (entity) => entity.__typename === typename && entity.id === id,
        );
        if (hasEntity) {
          keysToDelete.push(key);
          count += 1;
        }
      }
    }

    if (this.backend && keysToDelete.length > 0) {
      void runInBackground(this.backend.delMany(keysToDelete));
    }

    for (const key of keysToDelete) {
      deleteEntry({
        cache: this.cache,
        cacheKey: key,
        stats: this.stats,
        typeIndex: this.typeIndex,
      });
    }

    return count;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  clear(): void {
    if (this.backend) {
      void runInBackground(this.backend.clear());
    }
    this.cache.clear();
    this.typeIndex.clear();
    this.stats = { entries: 0, hitRate: 0, hits: 0, misses: 0 };
  }
}
