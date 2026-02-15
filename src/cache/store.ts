import type { CacheConfig, CacheStats } from '../types/index.js';
import type { NormalizedEntity } from './normalizer.js';

interface CacheEntry {
  data: unknown;
  entities: NormalizedEntity[];
  expiry: number;
  lastAccess: number;
}

export class ResponseCache {
  private cache: Map<string, CacheEntry> = new Map();
  private typeIndex: Map<string, Set<string>> = new Map(); // typename -> Set<cacheKey>
  private maxSize: number;
  private ttl: number;
  private stats: CacheStats = { hits: 0, misses: 0, hitRate: 0, entries: 0 };

  constructor(config?: CacheConfig) {
    this.maxSize = config?.maxSize ?? 1000;
    this.ttl = config?.ttl ?? 60000;
  }

  set(cacheKey: string, data: unknown, entities: NormalizedEntity[]): void {
    // Evict LRU if over maxSize
    if (this.cache.size >= this.maxSize && !this.cache.has(cacheKey)) {
      this.evictLRU();
    }

    const entry: CacheEntry = {
      data,
      entities,
      expiry: Date.now() + this.ttl,
      lastAccess: Date.now(),
    };

    this.cache.set(cacheKey, entry);

    // Update type index
    for (const entity of entities) {
      let typeSet = this.typeIndex.get(entity.__typename);
      if (!typeSet) {
        typeSet = new Set();
        this.typeIndex.set(entity.__typename, typeSet);
      }
      typeSet.add(cacheKey);
    }

    this.updateEntryCount();
  }

  get(cacheKey: string): unknown | null {
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Check expiry
    if (Date.now() > entry.expiry) {
      this.deleteEntry(cacheKey);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    entry.lastAccess = Date.now();
    this.stats.hits++;
    this.updateHitRate();
    return entry.data;
  }

  invalidateByType(typename: string): number {
    const keys = this.typeIndex.get(typename);
    if (!keys) return 0;

    const count = keys.size;
    const keysToDelete = [...keys];
    for (const key of keysToDelete) {
      this.deleteEntry(key);
    }

    return count;
  }

  invalidateByEntity(typename: string, id: string): number {
    const keys = this.typeIndex.get(typename);
    if (!keys) return 0;

    let count = 0;
    const keysToDelete: string[] = [];

    for (const key of keys) {
      const entry = this.cache.get(key);
      if (entry) {
        const hasEntity = entry.entities.some(
          (e) => e.__typename === typename && e.id === String(id),
        );
        if (hasEntity) {
          keysToDelete.push(key);
          count++;
        }
      }
    }

    for (const key of keysToDelete) {
      this.deleteEntry(key);
    }

    return count;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  clear(): void {
    this.cache.clear();
    this.typeIndex.clear();
    this.stats = { hits: 0, misses: 0, hitRate: 0, entries: 0 };
  }

  private deleteEntry(cacheKey: string): void {
    const entry = this.cache.get(cacheKey);
    if (!entry) return;

    // Remove from type index
    for (const entity of entry.entities) {
      const typeSet = this.typeIndex.get(entity.__typename);
      if (typeSet) {
        typeSet.delete(cacheKey);
        if (typeSet.size === 0) {
          this.typeIndex.delete(entity.__typename);
        }
      }
    }

    this.cache.delete(cacheKey);
    this.updateEntryCount();
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.deleteEntry(oldestKey);
    }
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  private updateEntryCount(): void {
    this.stats.entries = this.cache.size;
  }
}
