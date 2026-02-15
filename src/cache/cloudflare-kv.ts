import type { CacheBackend } from './backend.js';

/** Type stub for Cloudflare Workers KV namespace binding (no dependency needed) */
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface CloudflareKVConfig {
  namespace: KVNamespace;
  keyPrefix?: string; // default 'gql-watchdog:'
}

export class CloudflareKVBackend implements CacheBackend {
  private ns: KVNamespace;
  private keyPrefix: string;

  constructor(config: CloudflareKVConfig) {
    this.ns = config.namespace;
    this.keyPrefix = config.keyPrefix ?? 'gql-watchdog:';
  }

  private prefixedKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private unprefixKey(key: string): string {
    return key.startsWith(this.keyPrefix) ? key.slice(this.keyPrefix.length) : key;
  }

  async get(key: string): Promise<string | null> {
    return this.ns.get(this.prefixedKey(key));
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    const options: { expirationTtl?: number } = {};
    if (ttlMs && ttlMs > 0) {
      // KV expirationTtl is in seconds, minimum 60 seconds
      const ttlSec = Math.max(60, Math.ceil(ttlMs / 1000));
      options.expirationTtl = ttlSec;
    }
    await this.ns.put(this.prefixedKey(key), value, options);
  }

  async del(key: string): Promise<void> {
    await this.ns.delete(this.prefixedKey(key));
  }

  async keys(pattern: string): Promise<string[]> {
    // KV list only supports prefix-based listing, not glob patterns
    // Extract a prefix from the pattern (everything before the first wildcard)
    const prefixEnd = pattern.indexOf('*');
    const searchPrefix =
      prefixEnd >= 0
        ? this.prefixedKey(pattern.slice(0, prefixEnd))
        : this.prefixedKey(pattern);

    const result: string[] = [];
    let cursor: string | undefined;

    // Paginate through all matching keys
    do {
      const listResult = await this.ns.list({
        prefix: searchPrefix,
        cursor,
      });

      for (const key of listResult.keys) {
        const unprefixed = this.unprefixKey(key.name);
        // If pattern has a wildcard, do a simple match
        if (prefixEnd >= 0) {
          result.push(unprefixed);
        } else if (key.name === this.prefixedKey(pattern)) {
          result.push(unprefixed);
        }
      }

      cursor = listResult.list_complete ? undefined : listResult.cursor;
    } while (cursor);

    return result;
  }

  async delMany(keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      await this.ns.delete(this.prefixedKey(key));
      count++;
    }
    return count;
  }

  async clear(): Promise<void> {
    let cursor: string | undefined;

    do {
      const listResult = await this.ns.list({
        prefix: this.keyPrefix,
        cursor,
      });

      for (const key of listResult.keys) {
        await this.ns.delete(key.name);
      }

      cursor = listResult.list_complete ? undefined : listResult.cursor;
    } while (cursor);
  }
}
