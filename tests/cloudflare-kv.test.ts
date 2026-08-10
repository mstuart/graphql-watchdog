import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudflareKVBackend } from '../src/cache/cloudflare-kv.js';
import type { KVNamespace } from '../src/cache/cloudflare-kv.js';

const createMockKV = (): KVNamespace & { _store: Map<string, string> } => {
  const store = new Map<string, string>();

  return {
    _store: store,
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    get: async (key: string): Promise<string | null> => store.get(key) ?? null,
    async list(options?: Parameters<KVNamespace['list']>[0]) {
      const prefix = options?.prefix ?? '';
      const keys: { name: string }[] = [];
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          keys.push({ name: key });
        }
      }
      return { keys, list_complete: true };
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
  };
};

describe('CloudflareKVBackend', () => {
  let mockKV: ReturnType<typeof createMockKV>;
  let backend: CloudflareKVBackend;

  beforeEach(() => {
    mockKV = createMockKV();
    backend = new CloudflareKVBackend({ namespace: mockKV });
  });

  it('should store and retrieve a value', async () => {
    await backend.set('key1', 'value1');
    const result = await backend.get('key1');
    expect(result).toBe('value1');
  });

  it('should return null for missing key', async () => {
    const result = await backend.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should store with TTL', async () => {
    const putSpy = vi.spyOn(mockKV, 'put');
    // 120s
    await backend.set('key1', 'value1', 120_000);

    expect(putSpy).toHaveBeenCalledWith('gql-watchdog:key1', 'value1', { expirationTtl: 120 });
  });

  it('should enforce minimum 60s TTL for KV', async () => {
    const putSpy = vi.spyOn(mockKV, 'put');
    // 5s should become 60s
    await backend.set('key1', 'value1', 5000);

    expect(putSpy).toHaveBeenCalledWith('gql-watchdog:key1', 'value1', { expirationTtl: 60 });
  });

  it('should delete a key', async () => {
    await backend.set('key1', 'value1');
    await backend.del('key1');
    const result = await backend.get('key1');
    expect(result).toBeNull();
  });

  it('should find keys matching pattern', async () => {
    await backend.set('user:1', 'a');
    await backend.set('user:2', 'b');
    await backend.set('post:1', 'c');

    const userKeys = await backend.keys('user:*');
    expect(userKeys).toHaveLength(2);
    expect(userKeys).toContain('user:1');
    expect(userKeys).toContain('user:2');
  });

  it('should delete multiple keys', async () => {
    await backend.set('a', '1');
    await backend.set('b', '2');
    await backend.set('c', '3');

    const count = await backend.delMany(['a', 'c']);
    expect(count).toBe(2);
    expect(await backend.get('a')).toBeNull();
    expect(await backend.get('b')).toBe('2');
    expect(await backend.get('c')).toBeNull();
  });

  it('should clear all entries', async () => {
    await backend.set('a', '1');
    await backend.set('b', '2');

    await backend.clear();

    expect(await backend.get('a')).toBeNull();
    expect(await backend.get('b')).toBeNull();
  });

  it('should use default key prefix', async () => {
    await backend.set('test', 'value');
    // Verify internal storage uses prefix
    expect(mockKV._store.has('gql-watchdog:test')).toBe(true);
  });

  it('should use custom key prefix', async () => {
    const customBackend = new CloudflareKVBackend({
      keyPrefix: 'custom:',
      namespace: mockKV,
    });

    await customBackend.set('test', 'value');
    expect(mockKV._store.has('custom:test')).toBe(true);
  });

  it('should return empty array for keys with no matches', async () => {
    const keys = await backend.keys('nonexistent:*');
    expect(keys).toHaveLength(0);
  });
});
