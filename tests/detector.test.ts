import { describe, it, expect } from 'vitest';
import { analyzeForN1 } from '../src/detector/analyzer.js';
import { ResolverInstrumenter } from '../src/detector/instrumenter.js';
import type { ResolverCall } from '../src/types/index.js';

type InstrumentedResolver = (...parameters: unknown[]) => Promise<unknown>;

describe('N+1 Detector', () => {
  describe('analyzeForN1', () => {
    it('should detect N+1 pattern with Post.author called 10 times', () => {
      const calls: ResolverCall[] = [
        // The "1" call: Query.posts returns a list
        {
          batchKey: 'Query.posts',
          duration: 50,
          fieldName: 'posts',
          parentId: null,
          timestamp: 1000,
          typeName: 'Query',
        },
        // The "N" calls: Post.author called for each post
        ...Array.from({ length: 10 }, (_, index) => ({
          batchKey: 'Post.author',
          duration: 5,
          fieldName: 'author',
          parentId: `post-${index}`,
          timestamp: 1100 + index,
          typeName: 'Post',
        })),
      ];

      const detections = analyzeForN1(calls);

      expect(detections).toHaveLength(1);
      expect(detections[0].field).toBe('Post.author');
      expect(detections[0].parentField).toBe('Query.posts');
      expect(detections[0].callCount).toBe(10);
      expect(detections[0].severity).toBe('critical');
      expect(detections[0].suggestion).toContain('DataLoader');
      expect(detections[0].suggestion).toContain('authorLoader');
    });

    it('should detect warning severity for calls between threshold and 10', () => {
      const calls: ResolverCall[] = [
        {
          batchKey: 'Query.posts',
          duration: 50,
          fieldName: 'posts',
          parentId: null,
          timestamp: 1000,
          typeName: 'Query',
        },
        ...Array.from({ length: 5 }, (_, index) => ({
          batchKey: 'Post.author',
          duration: 5,
          fieldName: 'author',
          parentId: `post-${index}`,
          timestamp: 1100 + index,
          typeName: 'Post',
        })),
      ];

      const detections = analyzeForN1(calls);

      expect(detections).toHaveLength(1);
      expect(detections[0].severity).toBe('warning');
      expect(detections[0].callCount).toBe(5);
    });

    it('should return empty results for normal queries (no N+1)', () => {
      const calls: ResolverCall[] = [
        {
          batchKey: 'Query.user',
          duration: 50,
          fieldName: 'user',
          parentId: null,
          timestamp: 1000,
          typeName: 'Query',
        },
        {
          batchKey: 'User.name',
          duration: 2,
          fieldName: 'name',
          parentId: 'user-1',
          timestamp: 1100,
          typeName: 'User',
        },
        {
          batchKey: 'User.email',
          duration: 2,
          fieldName: 'email',
          parentId: 'user-1',
          timestamp: 1102,
          typeName: 'User',
        },
      ];

      const detections = analyzeForN1(calls);
      expect(detections).toHaveLength(0);
    });

    it('should respect custom threshold', () => {
      const calls: ResolverCall[] = Array.from({ length: 5 }, (_, index) => ({
        batchKey: 'Post.author',
        duration: 5,
        fieldName: 'author',
        parentId: `post-${index}`,
        timestamp: 1100 + index,
        typeName: 'Post',
      }));

      // With threshold 10, should not detect
      expect(analyzeForN1(calls, 10)).toHaveLength(0);

      // With threshold 3, should detect
      expect(analyzeForN1(calls, 3)).toHaveLength(1);

      // With threshold 5, should detect (equal to count)
      expect(analyzeForN1(calls, 5)).toHaveLength(1);
    });

    it('should sort detections by callCount descending', () => {
      const calls: ResolverCall[] = [
        ...Array.from({ length: 5 }, (_, index) => ({
          batchKey: 'Post.author',
          duration: 5,
          fieldName: 'author',
          parentId: `post-${index}`,
          timestamp: 1100 + index,
          typeName: 'Post',
        })),
        ...Array.from({ length: 15 }, (_, index) => ({
          batchKey: 'Post.comments',
          duration: 8,
          fieldName: 'comments',
          parentId: `post-${index}`,
          timestamp: 1200 + index,
          typeName: 'Post',
        })),
      ];

      const detections = analyzeForN1(calls);

      expect(detections).toHaveLength(2);
      expect(detections[0].field).toBe('Post.comments');
      expect(detections[0].callCount).toBe(15);
      expect(detections[1].field).toBe('Post.author');
      expect(detections[1].callCount).toBe(5);
    });
  });

  describe('ResolverInstrumenter', () => {
    it('should instrument resolvers and record calls', async () => {
      const instrumenter = new ResolverInstrumenter();

      const resolvers = {
        Post: {
          author: async () => ({ id: 'a1', name: 'Author' }),
        },
        Query: {
          posts: async () => [{ id: '1', title: 'Test' }],
        },
      };

      const instrumented = instrumenter.instrumentResolvers(resolvers);

      // Execute the instrumented resolvers
      await instrumented.Query.posts(null, {}, {}, {});
      await (instrumented.Post.author as InstrumentedResolver)({ id: '1' }, {}, {}, {});
      await (instrumented.Post.author as InstrumentedResolver)({ id: '2' }, {}, {}, {});

      const calls = instrumenter.getCalls();
      expect(calls).toHaveLength(3);
      expect(calls[0].batchKey).toBe('Query.posts');
      expect(calls[1].batchKey).toBe('Post.author');
      expect(calls[1].parentId).toBe('1');
      expect(calls[2].parentId).toBe('2');
    });

    it('should reset calls', async () => {
      const instrumenter = new ResolverInstrumenter();
      const resolvers = {
        Query: {
          user: async () => ({ id: '1' }),
        },
      };

      const instrumented = instrumenter.instrumentResolvers(resolvers);
      await instrumented.Query.user(null, {}, {}, {});

      expect(instrumenter.getCalls()).toHaveLength(1);
      instrumenter.reset();
      expect(instrumenter.getCalls()).toHaveLength(0);
    });

    it('should preserve non-function values in resolvers', () => {
      const instrumenter = new ResolverInstrumenter();
      const resolvers = {
        Post: {
          __resolveType: 'BlogPost',
        },
      };

      const instrumented = instrumenter.instrumentResolvers(resolvers);
      expect(instrumented.Post.__resolveType).toBe('BlogPost');
    });

    it('should record calls even when resolver throws', async () => {
      const instrumenter = new ResolverInstrumenter();
      const resolvers = {
        Query: {
          failing: async () => {
            throw new Error('DB connection failed');
          },
        },
      };

      const instrumented = instrumenter.instrumentResolvers(resolvers);

      await expect(
        (instrumented.Query.failing as InstrumentedResolver)(null, {}, {}, {}),
      ).rejects.toThrow('DB connection failed');

      expect(instrumenter.getCalls()).toHaveLength(1);
      expect(instrumenter.getCalls()[0].batchKey).toBe('Query.failing');
    });
  });
});
