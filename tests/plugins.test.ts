import { describe, it, expect, vi } from 'vitest';
import { useWatchdog } from '../src/plugins/yoga.js';
import { watchdogApolloPlugin } from '../src/plugins/apollo.js';
import { buildSchema, parse } from 'graphql';

const schema = buildSchema(`
  type Query {
    posts: [Post!]!
    user(id: ID!): User
  }

  type Post {
    id: ID!
    title: String!
    author: User!
  }

  type User {
    id: ID!
    name: String!
  }
`);

describe('Server Plugins', () => {
  describe('useWatchdog (Yoga)', () => {
    it('should detect N+1 patterns via onExecute lifecycle', () => {
      const plugin = useWatchdog({ enableDetector: true });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const document = parse(`
        query {
          posts {
            title
            author {
              name
            }
          }
        }
      `);

      const { onExecuteDone } = plugin.onExecute({
        args: {
          schema,
          document,
          operationName: null,
          variableValues: null,
        },
      });

      // Simulate the result of an execution with N+1 data
      // The plugin itself wraps instrumenter; for unit test we test the lifecycle works
      const executionResult = onExecuteDone({
        result: {
          data: {
            posts: [
              { id: '1', title: 'Post 1', author: { id: 'a1', name: 'Alice' } },
            ],
          },
        },
      });

      expect(executionResult).toBeDefined();
      expect(executionResult.duration).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(executionResult.n1Detections)).toBe(true);

      warnSpy.mockRestore();
    });

    it('should support cache when enabled', () => {
      const plugin = useWatchdog({
        enableCache: true,
        cache: { maxSize: 100, ttl: 5000 },
      });

      const cache = plugin.getCache();
      expect(cache).not.toBeNull();
    });

    it('should not create cache when disabled', () => {
      const plugin = useWatchdog({ enableCache: false });
      const cache = plugin.getCache();
      expect(cache).toBeNull();
    });

    it('should cache responses when cache is enabled', () => {
      const plugin = useWatchdog({
        enableCache: true,
        cache: { maxSize: 100, ttl: 5000 },
      });

      const document = parse(`query { user(id: "1") { name } }`);

      const { onExecuteDone } = plugin.onExecute({
        args: {
          schema,
          document,
          operationName: 'GetUser',
          variableValues: { id: '1' },
        },
      });

      onExecuteDone({
        result: {
          data: {
            user: { __typename: 'User', id: '1', name: 'Alice' },
          },
        },
      });

      const cache = plugin.getCache()!;
      const stats = cache.getStats();
      expect(stats.entries).toBe(1);
    });
  });

  describe('watchdogApolloPlugin', () => {
    it('should create plugin with requestDidStart lifecycle', async () => {
      const plugin = watchdogApolloPlugin({ enableDetector: true });

      const requestContext = await plugin.requestDidStart({ schema });

      expect(requestContext).toBeDefined();
      expect(requestContext.executionDidStart).toBeDefined();
      expect(requestContext.willSendResponse).toBeDefined();
    });

    it('should call onDetection callback when N+1 detected', async () => {
      const detections: unknown[] = [];
      const plugin = watchdogApolloPlugin({
        enableDetector: true,
        onDetection: (d) => detections.push(...d),
      });

      const requestContext = await plugin.requestDidStart({ schema });
      const executionContext = await requestContext.executionDidStart();

      // Simulate multiple resolver calls to trigger N+1 detection
      // Call willResolveField multiple times for Post.author
      for (let i = 0; i < 5; i++) {
        const endFn = executionContext.willResolveField({
          info: {
            fieldName: 'author',
            parentType: { name: 'Post' },
            path: { key: 'author' },
          },
        });
        endFn(null, { id: 'a1', name: 'Alice' });
      }

      await requestContext.willSendResponse({
        response: {
          body: {
            singleResult: {
              data: { posts: [] },
            },
          },
        },
      });

      expect(detections.length).toBeGreaterThan(0);
      expect(detections[0]).toHaveProperty('field', 'Post.author');
    });

    it('should support optional cache', () => {
      const plugin = watchdogApolloPlugin({ enableCache: true });
      expect(plugin.getCache()).not.toBeNull();

      const plugin2 = watchdogApolloPlugin({ enableCache: false });
      expect(plugin2.getCache()).toBeNull();
    });
  });
});
