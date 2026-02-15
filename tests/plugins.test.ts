import { describe, it, expect, vi } from 'vitest';
import { useWatchdog } from '../src/plugins/yoga.js';
import { watchdogApolloPlugin } from '../src/plugins/apollo.js';
import { buildSchema, parse, execute, GraphQLSchema, GraphQLObjectType, GraphQLString, GraphQLList, GraphQLNonNull, GraphQLID } from 'graphql';
import type { N1Detection } from '../src/types/index.js';

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

// Schema with real resolvers for N+1 testing
function createSchemaWithResolvers(): GraphQLSchema {
  const users = [
    { id: '1', name: 'Alice' },
    { id: '2', name: 'Bob' },
    { id: '3', name: 'Charlie' },
  ];
  const posts = [
    { id: 'p1', title: 'Post 1', authorId: '1' },
    { id: 'p2', title: 'Post 2', authorId: '1' },
    { id: 'p3', title: 'Post 3', authorId: '2' },
    { id: 'p4', title: 'Post 4', authorId: '2' },
    { id: 'p5', title: 'Post 5', authorId: '3' },
  ];

  const UserType = new GraphQLObjectType({
    name: 'User',
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID) },
      name: { type: new GraphQLNonNull(GraphQLString) },
    }),
  });

  const PostType = new GraphQLObjectType({
    name: 'Post',
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID) },
      title: { type: new GraphQLNonNull(GraphQLString) },
      author: {
        type: new GraphQLNonNull(UserType),
        resolve: (post: { authorId: string }) => users.find(u => u.id === post.authorId),
      },
    }),
  });

  const QueryType = new GraphQLObjectType({
    name: 'Query',
    fields: {
      posts: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(PostType))),
        resolve: () => posts,
      },
    },
  });

  return new GraphQLSchema({ query: QueryType });
}

describe('Server Plugins', () => {
  describe('useWatchdog (Yoga)', () => {
    it('should detect N+1 patterns via schema resolver instrumentation', async () => {
      const detections: N1Detection[] = [];
      const testSchema = createSchemaWithResolvers();
      const plugin = useWatchdog({
        enableDetector: true,
        onDetection: (d) => detections.push(...d),
      });

      const document = parse(`{
        posts {
          id
          title
          author { id name }
        }
      }`);

      const contextValue: Record<string, unknown> = {};

      // onExecute instruments schema and sets up context
      const { onExecuteDone } = plugin.onExecute({
        args: {
          schema: testSchema,
          document,
          contextValue,
          operationName: null,
          variableValues: null,
        },
      });

      // Actually execute the query — resolvers will record calls to context
      const result = await execute({
        schema: testSchema,
        document,
        contextValue,
      });

      expect(result.errors).toBeUndefined();
      expect(result.data?.posts).toHaveLength(5);

      // onExecuteDone analyzes the recorded calls
      const executionResult = onExecuteDone({
        result: { data: result.data as Record<string, unknown> },
      });

      expect(executionResult).toBeDefined();
      expect(executionResult.duration).toBeGreaterThanOrEqual(0);

      // Should detect N+1 on Post.author (5 calls — one per post)
      expect(detections.length).toBeGreaterThan(0);
      expect(detections[0].field).toBe('Post.author');
      expect(detections[0].callCount).toBe(5);
    });

    it('should not detect N+1 when detector is disabled', async () => {
      const testSchema = createSchemaWithResolvers();
      const plugin = useWatchdog({ enableDetector: false });

      const document = parse(`{ posts { id title author { name } } }`);
      const contextValue: Record<string, unknown> = {};

      const { onExecuteDone } = plugin.onExecute({
        args: { schema: testSchema, document, contextValue, operationName: null, variableValues: null },
      });

      await execute({ schema: testSchema, document, contextValue });

      const executionResult = onExecuteDone({
        result: { data: { posts: [] } },
      });

      expect(executionResult.n1Detections).toHaveLength(0);
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
          contextValue: {},
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
