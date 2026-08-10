import { describe, it, expect } from 'vitest';
import { generateReport } from '../src/reporter/index.js';
import { formatN1Detections, formatCostBreakdown } from '../src/reporter/terminal.js';
import { formatReportAsJson, formatCostAsJson } from '../src/reporter/json.js';
import type { PerformanceReport, N1Detection } from '../src/types/index.js';
import type { CostBreakdown } from '../src/cost/analyzer.js';

describe('Reporter', () => {
  const sampleReport: PerformanceReport = {
    cacheStats: {
      entries: 25,
      hitRate: 0.833,
      hits: 50,
      misses: 10,
    },
    duration: 150,
    n1Detections: [
      {
        callCount: 10,
        field: 'Post.author',
        parentField: 'Query.posts',
        severity: 'critical',
        suggestion:
          'const authorLoader = new DataLoader(async (ids) => { /* batch load Post by ids */ });',
      },
    ],
    operations: [
      {
        costEstimate: 31,
        duration: 120,
        operationName: 'GetPosts',
        resolverCalls: 11,
      },
    ],
    timestamp: '2026-02-14T00:00:00.000Z',
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
          callCount: 10,
          field: 'Post.author',
          parentField: 'Query.posts',
          severity: 'critical',
          suggestion: 'Use DataLoader',
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
          callCount: 5,
          field: 'Post.comments',
          parentField: 'Query.posts',
          severity: 'warning',
          suggestion: 'Use DataLoader',
        },
      ];

      const output = formatN1Detections(detections);
      expect(output).toContain('WARNING');
    });
  });

  describe('formatCostBreakdown', () => {
    it('should format cost within limit', () => {
      const breakdown: CostBreakdown = {
        exceeds: false,
        fieldCosts: [
          { cost: 1, path: 'user' },
          { cost: 1, path: 'user.name' },
        ],
        limit: 100,
        totalCost: 10,
      };

      const output = formatCostBreakdown(breakdown);
      expect(output).toContain('10');
      expect(output).toContain('WITHIN LIMIT');
    });

    it('should format cost exceeding limit', () => {
      const breakdown: CostBreakdown = {
        exceeds: true,
        fieldCosts: [],
        limit: 100,
        totalCost: 500,
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
        exceeds: false,
        fieldCosts: [{ cost: 42, path: 'user' }],
        limit: Infinity,
        totalCost: 42,
      };
      const output = formatCostAsJson(breakdown);
      const parsed = JSON.parse(output);
      expect(parsed.totalCost).toBe(42);
    });
  });
});
