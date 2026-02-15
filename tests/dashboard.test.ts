import { describe, it, expect } from 'vitest';
import { generateDashboard, calculatePerformanceScore } from '../src/reporter/dashboard.js';
import { generateReport } from '../src/reporter/index.js';
import type { PerformanceReport } from '../src/types/index.js';

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
    {
      operationName: 'GetUsers',
      duration: 80,
      resolverCalls: 5,
      costEstimate: 15,
    },
  ],
  n1Detections: [
    {
      field: 'Post.author',
      parentField: 'Query.posts',
      callCount: 10,
      suggestion: 'const authorLoader = new DataLoader(async (ids) => { /* batch */ });',
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

describe('Performance Dashboard', () => {
  describe('calculatePerformanceScore', () => {
    it('should return 100 for a perfect report', () => {
      const perfect: PerformanceReport = {
        timestamp: new Date().toISOString(),
        duration: 10,
        operations: [
          { operationName: 'Simple', duration: 10, resolverCalls: 2, costEstimate: 5 },
        ],
        n1Detections: [],
        cacheStats: { hits: 90, misses: 10, hitRate: 0.9, entries: 50 },
      };

      const score = calculatePerformanceScore(perfect);
      // Perfect: 100 base + 5 cache bonus = 100 (capped)
      expect(score).toBe(100);
    });

    it('should penalize critical N+1 detections', () => {
      const report: PerformanceReport = {
        timestamp: new Date().toISOString(),
        duration: 10,
        operations: [],
        n1Detections: [
          {
            field: 'Post.author',
            parentField: 'Query.posts',
            callCount: 10,
            suggestion: 'DataLoader',
            severity: 'critical',
          },
        ],
      };

      const score = calculatePerformanceScore(report);
      expect(score).toBe(85); // 100 - 15
    });

    it('should penalize warning N+1 detections less', () => {
      const report: PerformanceReport = {
        timestamp: new Date().toISOString(),
        duration: 10,
        operations: [],
        n1Detections: [
          {
            field: 'Post.comments',
            parentField: 'Query.posts',
            callCount: 5,
            suggestion: 'DataLoader',
            severity: 'warning',
          },
        ],
      };

      const score = calculatePerformanceScore(report);
      expect(score).toBe(92); // 100 - 8
    });

    it('should penalize low cache hit rate', () => {
      const report: PerformanceReport = {
        timestamp: new Date().toISOString(),
        duration: 10,
        operations: [],
        n1Detections: [],
        cacheStats: { hits: 5, misses: 95, hitRate: 0.05, entries: 100 },
      };

      const score = calculatePerformanceScore(report);
      expect(score).toBe(90); // 100 - 10
    });

    it('should penalize high cost operations', () => {
      const report: PerformanceReport = {
        timestamp: new Date().toISOString(),
        duration: 10,
        operations: [
          { operationName: 'Expensive', duration: 10, resolverCalls: 100, costEstimate: 600 },
        ],
        n1Detections: [],
      };

      const score = calculatePerformanceScore(report);
      expect(score).toBe(90); // 100 - 10
    });

    it('should never go below 0', () => {
      const report: PerformanceReport = {
        timestamp: new Date().toISOString(),
        duration: 5000,
        operations: Array.from({ length: 20 }, (_, i) => ({
          operationName: `Op${i}`,
          duration: 2000,
          resolverCalls: 100,
          costEstimate: 1000,
        })),
        n1Detections: Array.from({ length: 10 }, (_, i) => ({
          field: `Type${i}.field`,
          parentField: 'Query.list',
          callCount: 20,
          suggestion: 'DataLoader',
          severity: 'critical' as const,
        })),
        cacheStats: { hits: 0, misses: 100, hitRate: 0, entries: 0 },
      };

      const score = calculatePerformanceScore(report);
      expect(score).toBe(0);
    });

    it('should never exceed 100', () => {
      const report: PerformanceReport = {
        timestamp: new Date().toISOString(),
        duration: 1,
        operations: [],
        n1Detections: [],
        cacheStats: { hits: 100, misses: 0, hitRate: 1, entries: 50 },
      };

      const score = calculatePerformanceScore(report);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('generateDashboard', () => {
    it('should generate valid HTML', () => {
      const html = generateDashboard(sampleReport);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
      expect(html).toContain('<head>');
      expect(html).toContain('<body>');
    });

    it('should include dashboard title', () => {
      const html = generateDashboard(sampleReport);
      expect(html).toContain('graphql-watchdog Dashboard');
    });

    it('should include performance score', () => {
      const html = generateDashboard(sampleReport);
      expect(html).toContain('Performance Score');
    });

    it('should include N+1 hotspots table', () => {
      const html = generateDashboard(sampleReport);
      expect(html).toContain('N+1 Hotspots');
      expect(html).toContain('Post.author');
      // severity is rendered lowercase with CSS text-transform:uppercase
      expect(html).toContain('critical');
    });

    it('should show "no detections" when empty', () => {
      const report: PerformanceReport = {
        ...sampleReport,
        n1Detections: [],
      };

      const html = generateDashboard(report);
      expect(html).toContain('No N+1 queries detected');
    });

    it('should include cost breakdown section', () => {
      const html = generateDashboard(sampleReport);
      expect(html).toContain('Cost Breakdown');
    });

    it('should include operations table', () => {
      const html = generateDashboard(sampleReport);
      expect(html).toContain('Operations');
      expect(html).toContain('GetPosts');
      expect(html).toContain('GetUsers');
    });

    it('should include cache stats when available', () => {
      const html = generateDashboard(sampleReport);
      expect(html).toContain('Cache Performance');
      expect(html).toContain('Hits: 50');
      expect(html).toContain('Misses: 10');
    });

    it('should not include cache section when no cache stats', () => {
      const report: PerformanceReport = {
        ...sampleReport,
        cacheStats: undefined,
      };

      const html = generateDashboard(report);
      expect(html).not.toContain('Cache Performance');
    });

    it('should include inline styles (no external deps)', () => {
      const html = generateDashboard(sampleReport);
      expect(html).toContain('<style>');
      expect(html).not.toContain('rel="stylesheet"');
    });

    it('should include SVG charts', () => {
      const html = generateDashboard(sampleReport);
      expect(html).toContain('<svg');
    });

    it('should include localStorage script', () => {
      const html = generateDashboard(sampleReport);
      expect(html).toContain('localStorage');
      expect(html).toContain('gql-watchdog-reports');
    });

    it('should escape HTML in field names', () => {
      const report: PerformanceReport = {
        ...sampleReport,
        n1Detections: [
          {
            field: '<script>alert("xss")</script>',
            parentField: 'Query.posts',
            callCount: 5,
            suggestion: 'DataLoader',
            severity: 'warning',
          },
        ],
      };

      const html = generateDashboard(report);
      expect(html).not.toContain('<script>alert("xss")</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should include dark theme styling', () => {
      const html = generateDashboard(sampleReport);
      expect(html).toContain('background: #0f172a');
    });

    it('should include timestamp and duration', () => {
      const html = generateDashboard(sampleReport);
      expect(html).toContain('2026-02-14T00:00:00.000Z');
      expect(html).toContain('150ms');
    });
  });

  describe('generateReport with dashboard format', () => {
    it('should generate dashboard when format is "dashboard"', () => {
      const html = generateReport(sampleReport, 'dashboard');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('graphql-watchdog Dashboard');
    });
  });
});
