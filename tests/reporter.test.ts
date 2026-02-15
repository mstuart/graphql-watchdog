import { describe, it, expect } from 'vitest';
import { generateReport } from '../src/reporter/index.js';
import { formatN1Detections, formatCostBreakdown } from '../src/reporter/terminal.js';
import { formatReportAsJson, formatCostAsJson } from '../src/reporter/json.js';
import type { PerformanceReport, N1Detection } from '../src/types/index.js';
import type { CostBreakdown } from '../src/cost/analyzer.js';

describe('Reporter', () => {
  const sampleReport: PerformanceReport = {
    timestamp: '2026-02-14T00:00:00.000Z',
    duration: 150,
    operations: [
      {
        operationName: 'GetPosts',
        duration: 120,
        resolverCalls: 11,
        costEstimate: 31,
      },
    ],
    n1Detections: [
      {
        field: 'Post.author',
        parentField: 'Query.posts',
        callCount: 10,
        suggestion: 'const authorLoader = new DataLoader(async (ids) => { /* batch load Post by ids */ });',
        severity: 'critical',
      },
    ],
    cacheStats: {
      hits: 50,
      misses: 10,
      hitRate: 0.833,
      entries: 25,
    },
  };

  describe('generateReport', () => {
    it('should generate terminal report', () => {
      const output = generateReport(sampleReport, 'terminal');

      expect(output).toContain('graphql-watchdog Performance Report');
      expect(output).toContain('GetPosts');
      expect(output).toContain('Post.author');
      expect(output).toContain('CRITICAL');
      expect(output).toContain('Cache Stats');
      expect(output).toContain('83.3%');
    });

    it('should generate JSON report', () => {
      const output = generateReport(sampleReport, 'json');
      const parsed = JSON.parse(output);

      expect(parsed.timestamp).toBe('2026-02-14T00:00:00.000Z');
      expect(parsed.n1Detections).toHaveLength(1);
      expect(parsed.operations).toHaveLength(1);
      expect(parsed.cacheStats.hitRate).toBeCloseTo(0.833);
    });

    it('should default to terminal format', () => {
      const output = generateReport(sampleReport);
      expect(output).toContain('graphql-watchdog Performance Report');
    });
  });

  describe('formatN1Detections', () => {
    it('should format detections with severity', () => {
      const detections: N1Detection[] = [
        {
          field: 'Post.author',
          parentField: 'Query.posts',
          callCount: 10,
          suggestion: 'Use DataLoader',
          severity: 'critical',
        },
      ];

      const output = formatN1Detections(detections);
      expect(output).toContain('CRITICAL');
      expect(output).toContain('Post.author');
      expect(output).toContain('Use DataLoader');
    });

    it('should show success message when no detections', () => {
      const output = formatN1Detections([]);
      expect(output).toContain('No N+1 queries detected');
    });

    it('should format warning severity', () => {
      const detections: N1Detection[] = [
        {
          field: 'Post.comments',
          parentField: 'Query.posts',
          callCount: 5,
          suggestion: 'Use DataLoader',
          severity: 'warning',
        },
      ];

      const output = formatN1Detections(detections);
      expect(output).toContain('WARNING');
    });
  });

  describe('formatCostBreakdown', () => {
    it('should format cost within limit', () => {
      const breakdown: CostBreakdown = {
        totalCost: 10,
        fieldCosts: [
          { path: 'user', cost: 1 },
          { path: 'user.name', cost: 1 },
        ],
        exceeds: false,
        limit: 100,
      };

      const output = formatCostBreakdown(breakdown);
      expect(output).toContain('10');
      expect(output).toContain('WITHIN LIMIT');
    });

    it('should format cost exceeding limit', () => {
      const breakdown: CostBreakdown = {
        totalCost: 500,
        fieldCosts: [],
        exceeds: true,
        limit: 100,
      };

      const output = formatCostBreakdown(breakdown);
      expect(output).toContain('500');
      expect(output).toContain('EXCEEDS LIMIT');
    });
  });

  describe('JSON reporter', () => {
    it('should produce valid JSON for reports', () => {
      const output = formatReportAsJson(sampleReport);
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('should produce valid JSON for cost breakdown', () => {
      const breakdown: CostBreakdown = {
        totalCost: 42,
        fieldCosts: [{ path: 'user', cost: 42 }],
        exceeds: false,
        limit: Infinity,
      };
      const output = formatCostAsJson(breakdown);
      const parsed = JSON.parse(output);
      expect(parsed.totalCost).toBe(42);
    });
  });
});
