import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSchema, parse } from 'graphql';
import { ResponseCache } from '../src/cache/store.js';
import { normalizeResponse } from '../src/cache/normalizer.js';
import { getMutationTypes } from '../src/cache/invalidator.js';
import type { NormalizedEntity } from '../src/cache/normalizer.js';

const makeEntities = (typename: string, id: string): NormalizedEntity[] => [
  { __typename: typename, data: {}, id },
];

describe('Normalized Response Cache', () => {
  describe('normalizeResponse', () => {
    it('should extract entities with __typename and id', () => {
      const data = {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
          posts: [
            { __typename: 'Post', id: 'p1', title: 'Hello' },
            { __typename: 'Post', id: 'p2', title: 'World' },
          ],
        },
      };

      const result = normalizeResponse(data, 'GetUser', { id: '1' });

      expect(result.entities).toHaveLength(3);
      expect(result.entities.find((entity) => entity.__typename === 'User')?.id).toBe('1');
      expect(result.entities.filter((entity) => entity.__typename === 'Post')).toHaveLength(2);
      expect(result.cacheKey).toBeTruthy();
    });

    it('should generate consistent cache keys', () => {
      const key1 = normalizeResponse({}, 'GetUser', { id: '1' }).cacheKey;
      const key2 = normalizeResponse({}, 'GetUser', { id: '1' }).cacheKey;
      const key3 = normalizeResponse({}, 'GetUser', { id: '2' }).cacheKey;

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
    });

    it('should handle data without entities', () => {
      const data = { count: 42, message: 'hello' };
      const result = normalizeResponse(data, 'GetCount');

      expect(result.entities).toHaveLength(0);
    });
  });

  describe('ResponseCache', () => {
    let cache: ResponseCache;

    beforeEach(() => {
      vi.useFakeTimers();
      cache = new ResponseCache({ maxSize: 5, ttl: 1000 });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should store and retrieve cached response', () => {
      const data = { user: { name: 'Alice' } };
      cache.set('key1', data, makeEntities('User', '1'));

      const result = cache.get('key1');
      expect(result).toEqual(data);
    });

    it('should return null for missing keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('should expire entries after TTL', () => {
      cache.set('key1', { data: 'test' }, makeEntities('User', '1'));

      expect(cache.get('key1')).not.toBeNull();

      // Advance past TTL
      vi.advanceTimersByTime(1500);

      expect(cache.get('key1')).toBeNull();
    });

    it('should invalidate by type', () => {
      cache.set('key1', { data: 1 }, makeEntities('User', '1'));
      cache.set('key2', { data: 2 }, makeEntities('User', '2'));
      cache.set('key3', { data: 3 }, makeEntities('Post', '1'));

      const count = cache.invalidateByType('User');

      expect(count).toBe(2);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
      expect(cache.get('key3')).not.toBeNull();
    });

    it('should invalidate by specific entity', () => {
      cache.set('key1', { data: 1 }, makeEntities('User', '1'));
      cache.set('key2', { data: 2 }, makeEntities('User', '2'));
      cache.set('key3', { data: 3 }, makeEntities('Post', '1'));

      const count = cache.invalidateByEntity('User', '1');

      expect(count).toBe(1);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).not.toBeNull();
      expect(cache.get('key3')).not.toBeNull();
    });

    it('should evict LRU when cache is full', () => {
      // Fill cache to maxSize (5) with staggered timestamps
      for (let index = 0; index < 5; index += 1) {
        vi.advanceTimersByTime(10);
        cache.set(`key${index}`, { data: index }, makeEntities('Item', String(index)));
      }

      // Access key0 to make it the most recently used
      vi.advanceTimersByTime(10);
      cache.get('key0');

      // Advance time again before adding new entry
      vi.advanceTimersByTime(10);

      // Add one more — should evict key1 (oldest lastAccess after key0 was refreshed)
      cache.set('key5', { data: 5 }, makeEntities('Item', '5'));

      // Verify the cache still has maxSize entries
      const stats = cache.getStats();
      expect(stats.entries).toBe(5);

      // key0 should still be there (was recently accessed)
      expect(cache.get('key0')).not.toBeNull();
      // key5 should be there (newly added)
      expect(cache.get('key5')).not.toBeNull();
      // key1 was the LRU (oldest lastAccess) so it should be evicted
      expect(cache.get('key1')).toBeNull();
    });

    it('should track stats accurately', () => {
      cache.set('key1', { data: 1 }, makeEntities('User', '1'));

      // hit
      cache.get('key1');
      // hit
      cache.get('key1');
      // miss
      cache.get('missing');

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3, 5);
      expect(stats.entries).toBe(1);
    });

    it('should clear all entries and stats', () => {
      cache.set('key1', { data: 1 }, makeEntities('User', '1'));
      cache.get('key1');

      cache.clear();

      const stats = cache.getStats();
      expect(stats.entries).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(cache.get('key1')).toBeNull();
    });

    it('should return 0 when invalidating non-existent type', () => {
      expect(cache.invalidateByType('NonExistent')).toBe(0);
    });

    it('should return 0 when invalidating non-existent entity', () => {
      expect(cache.invalidateByEntity('User', '999')).toBe(0);
    });
  });

  describe('getMutationTypes', () => {
    const schema = buildSchema(`
      type Query {
        user(id: ID!): User
      }

      type Mutation {
        createUser(name: String!): User!
        createPost(title: String!): Post!
        deleteUser(id: ID!): Boolean
      }

      type User {
        id: ID!
        name: String!
      }

      type Post {
        id: ID!
        title: String!
      }
    `);

    it('should detect return types from mutations', () => {
      const document = parse(`
        mutation {
          createUser(name: "Alice") {
            id
            name
          }
        }
      `);

      const types = getMutationTypes(document, schema);
      expect(types).toContain('User');
    });

    it('should detect multiple return types', () => {
      const document = parse(`
        mutation {
          createUser(name: "Alice") {
            id
          }
          createPost(title: "Hello") {
            id
          }
        }
      `);

      const types = getMutationTypes(document, schema);
      expect(types).toContain('User');
      expect(types).toContain('Post');
    });

    it('should return empty for queries (non-mutations)', () => {
      const document = parse(`
        query {
          user(id: "1") {
            id
            name
          }
        }
      `);

      const types = getMutationTypes(document, schema);
      expect(types).toHaveLength(0);
    });
  });
});
