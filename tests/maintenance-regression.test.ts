import { afterEach, expect, it, vi } from 'vitest';
import { buildSchema, parse, validate } from 'graphql';
import { MemoryCacheBackend } from '../src/cache/backend.js';
import { ResponseCache } from '../src/cache/store.js';
import { analyzeCost } from '../src/cost/analyzer.js';
import { costLimitRule } from '../src/cost/rules.js';

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

it('deduplicates repeated acyclic spreads within each selection context', () => {
  const schema = buildSchema('type Query { value: String }');
  const fragments = Array.from(
    { length: 12 },
    (_, index) => `fragment F${index} on Query { ...F${index + 1} ...F${index + 1} }`,
  ).join('\n');
  const document = parse(`{ ...F0 } ${fragments} fragment F12 on Query { value }`);
  expect(analyzeCost(document, schema).fieldCosts).toEqual([{ cost: 1, path: 'value' }]);
});

it('reports cyclic-fragment failures as GraphQL validation errors', () => {
  const schema = buildSchema('type Query { value: String }');
  const document = parse('{ ...A } fragment A on Query { ...A }');
  const errors = validate(schema, document, [costLimitRule(schema, { maxCost: 10 })]);
  expect(errors).toHaveLength(1);
  expect(errors[0].message).toContain('cyclic fragment');
});
