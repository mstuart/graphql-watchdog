import { afterEach, expect, it, vi } from 'vitest';
import { buildSchema, parse } from 'graphql';
import { MemoryCacheBackend } from '../src/cache/backend.js';
import { ResponseCache } from '../src/cache/store.js';
import { analyzeCost } from '../src/cost/analyzer.js';

afterEach(() => vi.useRealTimers());

it('evicts an empty cache key and removes its entity index', () => {
  const cache = new ResponseCache({ maxSize: 1 });
  cache.set('', 'old', [{ __typename: 'Old', data: {}, id: '1' }]);
  cache.set('new', 'new', []);
  expect(cache.getStats().entries).toBe(1);
  expect(cache.get('')).toBeNull();
  expect(cache.invalidateByType('Old')).toBe(0);
  expect(cache.get('new')).toBe('new');
});

it('expires memory and backend responses at their TTL boundary', async () => {
  vi.useFakeTimers();
  const memory = new ResponseCache({ ttl: 100 });
  const backend = new MemoryCacheBackend();
  const external = new ResponseCache({ backend, ttl: 100 });
  memory.set('key', 'value', []);
  external.set('key', 'value', []);
  await backend.set('direct', 'value', 100);
  vi.advanceTimersByTime(100);
  expect(memory.get('key')).toBeNull();
  expect(await external.getAsync('key')).toBeNull();
  expect(await backend.get('direct')).toBeNull();
  expect(await backend.keys('*')).toEqual([]);
});

it('prices named fragments at each list selection rather than as detached definitions', () => {
  const schema = buildSchema(
    'type Query { users: [User] } type User { name: String friends: [User] }',
  );
  const inline = parse('{ users { name friends { name } } }');
  const fragmented = parse(`
    { users { ...Fields friends { ...Fields } } }
    fragment Fields on User { name }
    fragment Unused on User { friends { name } }
  `);
  expect(analyzeCost(fragmented, schema)).toEqual(analyzeCost(inline, schema));
});

it('rejects cyclic fragments instead of recursing without a bound', () => {
  const schema = buildSchema('type Query { users: [User] } type User { friends: [User] }');
  const document = parse('{ users { ...A } } fragment A on User { friends { ...A } }');
  expect(() => analyzeCost(document, schema)).toThrow('cyclic fragment');
});
