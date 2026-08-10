import { describe, it, expect } from 'vitest';
import { DynamicCostTracker } from '../src/cost/dynamic.js';
import { ResolverInstrumenter } from '../src/detector/instrumenter.js';

type InstrumentedResolver = (...parameters: unknown[]) => Promise<unknown>;

describe('DynamicCostTracker', () => {
  describe('recordTiming', () => {
    it('should record timing for a single call', () => {
      const tracker = new DynamicCostTracker();
      tracker.recordTiming('Query', 'posts', 50);

      const data = tracker.export();
      expect(data['Query.posts']).toBeDefined();
      expect(data['Query.posts'].avgDuration).toBe(50);
      expect(data['Query.posts'].callCount).toBe(1);
      expect(data['Query.posts'].p95Duration).toBe(50);
    });

    it('should compute running average for multiple calls', () => {
      const tracker = new DynamicCostTracker();
      tracker.recordTiming('Query', 'posts', 10);
      tracker.recordTiming('Query', 'posts', 20);
      tracker.recordTiming('Query', 'posts', 30);

      const data = tracker.export();
      expect(data['Query.posts'].avgDuration).toBeCloseTo(20, 5);
      expect(data['Query.posts'].callCount).toBe(3);
    });

    it('should track multiple fields independently', () => {
      const tracker = new DynamicCostTracker();
      tracker.recordTiming('Query', 'posts', 50);
      tracker.recordTiming('Post', 'author', 5);

      const data = tracker.export();
      expect(data['Query.posts'].avgDuration).toBe(50);
      expect(data['Post.author'].avgDuration).toBe(5);
    });

    it('should compute p95 duration', () => {
      const tracker = new DynamicCostTracker();
      // Record 20 calls with durations 1-20
      for (let index = 1; index <= 20; index += 1) {
        tracker.recordTiming('Query', 'posts', index);
      }

      const data = tracker.export();
      // p95 of 1-20 should be 19 (95th percentile)
      expect(data['Query.posts'].p95Duration).toBe(19);
    });
  });

  describe('toCostConfig', () => {
    it('should convert timing data to cost config', () => {
      const tracker = new DynamicCostTracker();
      // 50ms -> cost 5
      tracker.recordTiming('Query', 'posts', 50);
      // 5ms -> cost 1 (minimum)
      tracker.recordTiming('Post', 'author', 5);
      // 100ms -> cost 10
      tracker.recordTiming('Post', 'comments', 100);

      const config = tracker.toCostConfig({ baselineDuration: 10 });

      expect(config.costMap).toBeDefined();
      expect(config.costMap?.['Query.posts']).toBe(5);
      // minimum 1
      expect(config.costMap?.['Post.author']).toBe(1);
      expect(config.costMap?.['Post.comments']).toBe(10);
    });

    it('should use default baseline of 10ms', () => {
      const tracker = new DynamicCostTracker();
      tracker.recordTiming('Query', 'posts', 30);

      const config = tracker.toCostConfig();
      expect(config.costMap?.['Query.posts']).toBe(3);
    });

    it('should round costs to nearest integer by default', () => {
      const tracker = new DynamicCostTracker();
      // 1.5 -> rounds to 2
      tracker.recordTiming('Query', 'posts', 15);

      const config = tracker.toCostConfig({ baselineDuration: 10 });
      expect(config.costMap?.['Query.posts']).toBe(2);
    });

    it('should support custom rounding', () => {
      const tracker = new DynamicCostTracker();
      // 15 -> rounds to 15
      tracker.recordTiming('Query', 'posts', 150);

      const config = tracker.toCostConfig({ baselineDuration: 10, roundTo: 5 });
      expect(config.costMap?.['Query.posts']).toBe(15);
    });

    it('should enforce minimum cost of 1', () => {
      const tracker = new DynamicCostTracker();
      // 0.05 -> would be 0, enforced to 1
      tracker.recordTiming('Query', 'simple', 0.5);

      const config = tracker.toCostConfig({ baselineDuration: 10 });
      expect(config.costMap?.['Query.simple']).toBe(1);
    });

    it('should assign higher costs to slower fields', () => {
      const tracker = new DynamicCostTracker();
      tracker.recordTiming('Post', 'fast', 5);
      tracker.recordTiming('Post', 'slow', 200);

      const config = tracker.toCostConfig({ baselineDuration: 10 });
      expect(config.costMap?.['Post.slow']).toBeGreaterThan(config.costMap?.['Post.fast']);
    });
  });

  describe('export / import', () => {
    it('should export timing data', () => {
      const tracker = new DynamicCostTracker();
      tracker.recordTiming('Query', 'posts', 50);
      tracker.recordTiming('Post', 'author', 10);

      const exported = tracker.export();
      expect(Object.keys(exported)).toHaveLength(2);
      expect(exported['Query.posts']).toBeDefined();
      expect(exported['Post.author']).toBeDefined();
    });

    it('should import previously saved data', () => {
      const tracker = new DynamicCostTracker();
      tracker.import({
        'Post.author': { avgDuration: 10, callCount: 50, lastUpdated: Date.now(), p95Duration: 15 },
        'Query.posts': {
          avgDuration: 50,
          callCount: 100,
          lastUpdated: Date.now(),
          p95Duration: 60,
        },
      });

      const config = tracker.toCostConfig({ baselineDuration: 10 });
      expect(config.costMap?.['Query.posts']).toBe(5);
      expect(config.costMap?.['Post.author']).toBe(1);
    });

    it('should roundtrip export/import correctly', () => {
      const tracker1 = new DynamicCostTracker();
      tracker1.recordTiming('Query', 'posts', 50);
      tracker1.recordTiming('Post', 'author', 10);

      const exported = tracker1.export();

      const tracker2 = new DynamicCostTracker();
      tracker2.import(exported);

      const config1 = tracker1.toCostConfig();
      const config2 = tracker2.toCostConfig();

      expect(config1.costMap).toEqual(config2.costMap);
    });
  });

  describe('getStats', () => {
    it('should return correct summary stats', () => {
      const tracker = new DynamicCostTracker();
      tracker.recordTiming('Query', 'posts', 50);
      tracker.recordTiming('Query', 'posts', 60);
      tracker.recordTiming('Post', 'author', 10);

      const stats = tracker.getStats();
      expect(stats.trackedFields).toBe(2);
      expect(stats.totalCalls).toBe(3);
      expect(stats.slowestFields[0].field).toBe('Query.posts');
    });

    it('should return empty stats when no data', () => {
      const tracker = new DynamicCostTracker();
      const stats = tracker.getStats();

      expect(stats.trackedFields).toBe(0);
      expect(stats.totalCalls).toBe(0);
      expect(stats.slowestFields).toHaveLength(0);
    });

    it('should limit slowest fields to top 10', () => {
      const tracker = new DynamicCostTracker();
      for (let index = 0; index < 15; index += 1) {
        tracker.recordTiming('Type', `field${index}`, index * 10);
      }

      const stats = tracker.getStats();
      expect(stats.slowestFields.length).toBeLessThanOrEqual(10);
    });
  });

  describe('integration with ResolverInstrumenter', () => {
    it('should automatically feed timing data when costTracker is provided', async () => {
      const tracker = new DynamicCostTracker();
      const instrumenter = new ResolverInstrumenter({ costTracker: tracker });

      const resolvers = {
        Post: {
          author: async () => ({ id: 'a1', name: 'Author' }),
        },
        Query: {
          posts: async () =>
            // Simulate some work
            [{ id: '1' }, { id: '2' }],
        },
      };

      const instrumented = instrumenter.instrumentResolvers(resolvers);

      // Execute resolvers
      const posts = await (instrumented.Query.posts as InstrumentedResolver)(null, {}, {}, {});
      for (const post of posts as { id: string }[]) {
        // eslint-disable-next-line no-await-in-loop -- Resolver calls intentionally model sequential GraphQL execution.
        await (instrumented.Post.author as InstrumentedResolver)(post, {}, {}, {});
      }

      // Verify tracker received timing data
      const stats = tracker.getStats();
      expect(stats.trackedFields).toBe(2);
      // 1 posts + 2 author calls
      expect(stats.totalCalls).toBe(3);

      // Verify cost config can be generated
      const config = tracker.toCostConfig();
      expect(config.costMap).toBeDefined();
      expect(config.costMap?.['Query.posts']).toBeDefined();
      expect(config.costMap?.['Post.author']).toBeDefined();
    });

    it('should work without costTracker (backward compatible)', async () => {
      const instrumenter = new ResolverInstrumenter();

      const resolvers = {
        Query: {
          user: async () => ({ id: '1', name: 'Alice' }),
        },
      };

      const instrumented = instrumenter.instrumentResolvers(resolvers);
      await (instrumented.Query.user as InstrumentedResolver)(null, {}, {}, {});

      expect(instrumenter.getCalls()).toHaveLength(1);
    });

    it('should record timing even when resolver throws', async () => {
      const tracker = new DynamicCostTracker();
      const instrumenter = new ResolverInstrumenter({ costTracker: tracker });

      const resolvers = {
        Query: {
          failing: async () => {
            throw new Error('fail');
          },
        },
      };

      const instrumented = instrumenter.instrumentResolvers(resolvers);

      await expect(
        (instrumented.Query.failing as InstrumentedResolver)(null, {}, {}, {}),
      ).rejects.toThrow('fail');

      const stats = tracker.getStats();
      expect(stats.trackedFields).toBe(1);
      expect(stats.totalCalls).toBe(1);
    });
  });
});
