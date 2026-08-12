import type { CacheBackend } from './backend.js';

/**
Type stub for Cloudflare Workers KV namespace binding (no dependency needed)
*/
export interface KVNamespace {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (options?: { prefix?: string; cursor?: string }) => Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface CloudflareKVConfig {
  namespace: KVNamespace;
  // default 'gql-watchdog:'
  keyPrefix?: string;
}

const prefixedKey = (keyPrefix: string, key: string): string => `${keyPrefix}${key}`;
const unprefixKey = (keyPrefix: string, key: string): string =>
  key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key;

export class CloudflareKVBackend implements CacheBackend {
  private ns: KVNamespace;
  private keyPrefix: string;

  constructor(config: CloudflareKVConfig) {
    this.ns = config.namespace;
    this.keyPrefix = config.keyPrefix ?? 'gql-watchdog:';
  }

  async get(key: string): Promise<string | null> {
    return this.ns.get(prefixedKey(this.keyPrefix, key));
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    const options: { expirationTtl?: number } = {};
    if (ttlMs && ttlMs > 0) {
      // KV expirationTtl is in seconds, minimum 60 seconds
      const ttlSec = Math.max(60, Math.ceil(ttlMs / 1000));
      options.expirationTtl = ttlSec;
    }
    await this.ns.put(prefixedKey(this.keyPrefix, key), value, options);
  }

  async del(key: string): Promise<void> {
    await this.ns.delete(prefixedKey(this.keyPrefix, key));
  }

  async keys(pattern: string): Promise<string[]> {
    // KV list only supports prefix-based listing, not glob patterns
    // Extract a prefix from the pattern (everything before the first wildcard)
    const prefixEnd = pattern.indexOf('*');
    const patternPrefix = prefixEnd === -1 ? pattern : pattern.slice(0, prefixEnd);
    const searchPrefix = prefixedKey(this.keyPrefix, patternPrefix);

    const result: string[] = [];
    let cursor: string | undefined;

    // Paginate through all matching keys
    do {
      // eslint-disable-next-line no-await-in-loop -- Each KV page requires the prior page's cursor.
      const listResult = await this.ns.list({
        cursor,
        prefix: searchPrefix,
      });

      for (const key of listResult.keys) {
        const unprefixed = unprefixKey(this.keyPrefix, key.name);
        if (prefixEnd !== -1 || key.name === prefixedKey(this.keyPrefix, pattern)) {
          result.push(unprefixed);
        }
      }

      cursor = listResult.list_complete ? undefined : listResult.cursor;
    } while (cursor);

    return result;
  }

  async delMany(keys: string[]): Promise<number> {
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop -- Sequential deletes avoid overwhelming the KV provider.
      await this.ns.delete(prefixedKey(this.keyPrefix, key));
    }
    return keys.length;
  }

  async clear(): Promise<void> {
    let cursor: string | undefined;

    do {
      // eslint-disable-next-line no-await-in-loop -- Each KV page requires the prior page's cursor.
      const listResult = await this.ns.list({
        cursor,
        prefix: this.keyPrefix,
      });

      for (const key of listResult.keys) {
        // eslint-disable-next-line no-await-in-loop -- Sequential deletes avoid overwhelming the KV provider.
        await this.ns.delete(key.name);
      }

      cursor = listResult.list_complete ? undefined : listResult.cursor;
    } while (cursor);
  }
}
