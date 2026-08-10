import { describe, it, expect } from 'vitest';
import { buildSchema, parse } from 'graphql';
import { ResolverInstrumenter } from '../../src/detector/instrumenter.js';
import { analyzeForN1 } from '../../src/detector/analyzer.js';
import { analyzeCost } from '../../src/cost/analyzer.js';
import { ResponseCache } from '../../src/cache/store.js';
import { normalizeResponse } from '../../src/cache/normalizer.js';
import { getMutationTypes } from '../../src/cache/invalidator.js';
import type { CostConfig } from '../../src/types/index.js';

type InstrumentedResolver = (...parameters: unknown[]) => Promise<unknown>;

// Build a realistic schema with N+1-prone relationships
const schema = buildSchema(`
  type Query {
    posts(first: Int): [Post!]!
    user(id: ID!): User
  }

  type Mutation {
    createPost(title: String!, authorId: ID!): Post!
    updateUser(id: ID!, name: String): User!
  }

  type Post {
    id: ID!
    title: String!
    body: String!
    author: User!
    comments(first: Int): [Comment!]!
  }

  type User {
    id: ID!
    name: String!
    email: String!
  }

  type Comment {
    id: ID!
    text: String!
    author: User!
  }
`);

describe('Integration: Full Flow', () => {
  it('should detect N+1 in a realistic resolver scenario', async () => {
    const instrumenter = new ResolverInstrumenter();

    // Simulate resolvers with intentional N+1 pattern
    const resolvers = {
      Post: {
        author: async (parent: { id: string }) =>
          // This simulates an N+1 — each post makes a separate DB call for author
          ({
            email: 'test@test.com',
            id: `author-${parent.id}`,
            name: `Author of ${parent.id}`,
          }),
      },
      Query: {
        posts: async () => [
          { body: 'Content 1', id: 'p1', title: 'First Post' },
          { body: 'Content 2', id: 'p2', title: 'Second Post' },
          { body: 'Content 3', id: 'p3', title: 'Third Post' },
          { body: 'Content 4', id: 'p4', title: 'Fourth Post' },
          { body: 'Content 5', id: 'p5', title: 'Fifth Post' },
        ],
      },
    };

    const instrumented = instrumenter.instrumentResolvers(resolvers);

    // Execute the query flow
    const posts = await (instrumented.Query.posts as InstrumentedResolver)(null, {}, {}, {});

    // Simulate N+1: resolve author for each post
    for (const post of posts as { id: string }[]) {
      // eslint-disable-next-line no-await-in-loop -- Resolver calls intentionally model sequential GraphQL execution.
      await (instrumented.Post.author as InstrumentedResolver)(post, {}, {}, {});
    }

    // Analyze
    const calls = instrumenter.getCalls();
    const detections = analyzeForN1(calls);

    expect(detections).toHaveLength(1);
    expect(detections[0].field).toBe('Post.author');
    expect(detections[0].callCount).toBe(5);
    expect(detections[0].severity).toBe('warning');
    expect(detections[0].suggestion).toContain('DataLoader');
    expect(detections[0].parentField).toBe('Query.posts');
  });

  it('should analyze cost for a complex query', () => {
    const query = parse(`
      query GetPosts {
        posts(first: 10) {
          id
          title
          body
          author {
            id
            name
            email
          }
          comments(first: 5) {
            id
            text
            author {
              id
              name
            }
          }
        }
      }
    `);

    const config: CostConfig = {
      maxCost: 1000,
    };

    const result = analyzeCost(query, schema, config);

    // posts(1) + id(10) + title(10) + body(10) + author(10) + id(10) + name(10) + email(10)
    // + comments(10) + id(50) + text(50) + author(50) + id(50) + name(50) = 331
    expect(result.totalCost).toBe(331);
    expect(result.exceeds).toBe(false);
    expect(result.fieldCosts.length).toBeGreaterThan(0);
  });

  it('should detect cost exceeding limit on deep queries', () => {
    const query = parse(`
      query DeepQuery {
        posts(first: 100) {
          title
          comments(first: 100) {
            text
            author {
              name
            }
          }
        }
      }
    `);

    const config: CostConfig = {
      maxCost: 500,
    };

    const result = analyzeCost(query, schema, config);
    expect(result.exceeds).toBe(true);
    expect(result.totalCost).toBeGreaterThan(500);
  });

  it('should cache a response and retrieve it', () => {
    const cache = new ResponseCache({ maxSize: 100, ttl: 60_000 });

    const responseData = {
      posts: [
        {
          __typename: 'Post',
          author: { __typename: 'User', id: 'u1', name: 'Alice' },
          id: 'p1',
          title: 'Hello',
        },
        {
          __typename: 'Post',
          author: { __typename: 'User', id: 'u2', name: 'Bob' },
          id: 'p2',
          title: 'World',
        },
      ],
    };

    const { entities, cacheKey } = normalizeResponse(responseData, 'GetPosts', { first: 10 });

    // Verify entities were extracted
    // 2 posts + 2 users
    expect(entities.length).toBeGreaterThanOrEqual(4);

    // Store and retrieve
    cache.set(cacheKey, responseData, entities);
    const cached = cache.get(cacheKey);
    expect(cached).toEqual(responseData);

    // Stats
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.entries).toBe(1);
  });

  it('should invalidate cache entries after detecting mutation types', () => {
    const cache = new ResponseCache({ maxSize: 100, ttl: 60_000 });

    // Cache a query response
    const data = { posts: [{ __typename: 'Post', id: 'p1', title: 'Hello' }] };
    const { entities, cacheKey } = normalizeResponse(data, 'GetPosts');
    cache.set(cacheKey, data, entities);

    expect(cache.get(cacheKey)).not.toBeNull();

    // Parse a mutation that returns a Post type
    const mutation = parse(`
      mutation {
        createPost(title: "New Post", authorId: "u1") {
          id
          title
        }
      }
    `);

    // Detect affected types
    const affectedTypes = getMutationTypes(mutation, schema);
    expect(affectedTypes).toContain('Post');

    // Invalidate
    for (const typeName of affectedTypes) {
      cache.invalidateByType(typeName);
    }

    // Cache should be invalidated
    expect(cache.get(cacheKey)).toBeNull();
  });

  it('should work end-to-end: instrument, detect, analyze cost, cache', async () => {
    // Step 1: Instrument resolvers
    const instrumenter = new ResolverInstrumenter();
    const resolvers = {
      Post: {
        author: async (parent: { id: string }) => ({
          __typename: 'User',
          id: `u${parent.id}`,
          name: `User ${parent.id}`,
        }),
      },
      Query: {
        posts: async () => [
          { id: '1', title: 'A' },
          { id: '2', title: 'B' },
          { id: '3', title: 'C' },
        ],
      },
    };

    const instrumented = instrumenter.instrumentResolvers(resolvers);

    // Step 2: Execute
    const posts = await (instrumented.Query.posts as InstrumentedResolver)(null, {}, {}, {});
    for (const post of posts as { id: string }[]) {
      // eslint-disable-next-line no-await-in-loop -- Resolver calls intentionally model sequential GraphQL execution.
      await (instrumented.Post.author as InstrumentedResolver)(post, {}, {}, {});
    }

    // Step 3: Detect N+1
    const detections = analyzeForN1(instrumenter.getCalls());
    expect(detections).toHaveLength(1);

    // Step 4: Analyze cost
    const query = parse(`
      query {
        posts(first: 3) {
          title
          author { name }
        }
      }
    `);
    const costResult = analyzeCost(query, schema, { maxCost: 100 });
    expect(costResult.exceeds).toBe(false);

    // Step 5: Cache the response
    const cache = new ResponseCache({ maxSize: 10, ttl: 5000 });
    const responseData = {
      posts: (posts as { id: string; title: string }[]).map((p) => ({
        __typename: 'Post',
        ...p,
        author: { __typename: 'User', id: `u${p.id}`, name: `User ${p.id}` },
      })),
    };

    const { entities, cacheKey } = normalizeResponse(responseData, 'GetPosts');
    cache.set(cacheKey, responseData, entities);
    expect(cache.get(cacheKey)).toEqual(responseData);
  });
});
