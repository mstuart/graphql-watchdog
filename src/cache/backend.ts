export interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Get all keys matching a pattern */
  keys(pattern: string): Promise<string[]>;
  /** Delete multiple keys */
  delMany(keys: string[]): Promise<number>;
  clear(): Promise<void>;
}

export class MemoryCacheBackend implements CacheBackend {
  private store = new Map<string, { value: string; expiry: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiry > 0 && Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    const expiry = ttlMs && ttlMs > 0 ? Date.now() + ttlMs : 0;
    this.store.set(key, { value, expiry });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = this.patternToRegex(pattern);
    const result: string[] = [];
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        // Also check expiry
        const entry = this.store.get(key);
        if (entry && (entry.expiry === 0 || Date.now() <= entry.expiry)) {
          result.push(key);
        }
      }
    }
    return result;
  }

  async delMany(keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        count++;
      }
    }
    return count;
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  private patternToRegex(pattern: string): RegExp {
    // Convert glob-like pattern to regex (supports * as wildcard)
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
  }
}
