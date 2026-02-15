import type { CacheConfig, CacheStats } from '../types/index.js';
import type { NormalizedEntity } from './normalizer.js';
import type { CacheBackend } from './backend.js';

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
  private backend: CacheBackend | null;

  constructor(config?: CacheConfig) {
    this.maxSize = config?.maxSize ?? 1000;
    this.ttl = config?.ttl ?? 60000;
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
      this.backend.set(cacheKey, JSON.stringify(entry), this.ttl).catch(() => {});
      // Still maintain type index in memory for invalidation
      this.updateTypeIndex(cacheKey, entities);
      this.updateEntryCount();
      return;
    }

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
    this.updateTypeIndex(cacheKey, entities);
    this.updateEntryCount();
  }

  get(cacheKey: string): unknown | null {
    if (this.backend) {
      // For sync compatibility, backend-based get is async-only
      // Use getAsync for backend-based retrieval
      // Fallback: return null for sync calls with a backend
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

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

  async getAsync(cacheKey: string): Promise<unknown | null> {
    if (this.backend) {
      const raw = await this.backend.get(cacheKey);
      if (!raw) {
        this.stats.misses++;
        this.updateHitRate();
        return null;
      }

      try {
        const entry: CacheEntry = JSON.parse(raw);
        if (Date.now() > entry.expiry) {
          await this.backend.del(cacheKey);
          this.stats.misses++;
          this.updateHitRate();
          return null;
        }

        entry.lastAccess = Date.now();
        // Update in backend
        await this.backend.set(cacheKey, JSON.stringify(entry), this.ttl);
        this.stats.hits++;
        this.updateHitRate();
        return entry.data;
      } catch {
        this.stats.misses++;
        this.updateHitRate();
        return null;
      }
    }

    // Delegate to sync get for in-memory
    return this.get(cacheKey);
  }

  invalidateByType(typename: string): number {
    const keys = this.typeIndex.get(typename);
    if (!keys) return 0;

    const count = keys.size;
    const keysToDelete = [...keys];

    if (this.backend) {
      // Async deletion, fire-and-forget
      this.backend.delMany(keysToDelete).catch(() => {});
    }

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

    if (this.backend && keysToDelete.length > 0) {
      this.backend.delMany(keysToDelete).catch(() => {});
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
    if (this.backend) {
      this.backend.clear().catch(() => {});
    }
    this.cache.clear();
    this.typeIndex.clear();
    this.stats = { hits: 0, misses: 0, hitRate: 0, entries: 0 };
  }

  private updateTypeIndex(cacheKey: string, entities: NormalizedEntity[]): void {
    for (const entity of entities) {
      let typeSet = this.typeIndex.get(entity.__typename);
      if (!typeSet) {
        typeSet = new Set();
        this.typeIndex.set(entity.__typename, typeSet);
      }
      typeSet.add(cacheKey);
    }
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
