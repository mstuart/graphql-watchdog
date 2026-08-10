import { describe, it, expect } from 'vitest';
import { generateDashboard, calculatePerformanceScore } from '../src/reporter/dashboard.js';
import { generateReport } from '../src/reporter/index.js';
import type { PerformanceReport } from '../src/types/index.js';

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
      suggestion: 'const authorLoader = new DataLoader(async (ids) => { /* batch */ });',
    },
  ],
  operations: [
    {
      costEstimate: 31,
      duration: 120,
      operationName: 'GetPosts',
      resolverCalls: 11,
    },
    {
      costEstimate: 15,
      duration: 80,
      operationName: 'GetUsers',
      resolverCalls: 5,
    },
  ],
  timestamp: '2026-02-14T00:00:00.000Z',
};

describe('Performance Dashboard', () => {
  describe('calculatePerformanceScore', () => {
    it('should return 100 for a perfect report', () => {
      const perfect: PerformanceReport = {
        cacheStats: { entries: 50, hitRate: 0.9, hits: 90, misses: 10 },
        duration: 10,
        n1Detections: [],
        operations: [{ costEstimate: 5, duration: 10, operationName: 'Simple', resolverCalls: 2 }],
        timestamp: sampleReport.timestamp,
      };

      const score = calculatePerformanceScore(perfect);
      // Perfect: 100 base + 5 cache bonus = 100 (capped)
      expect(score).toBe(100);
    });

    it('should penalize critical N+1 detections', () => {
      const report: PerformanceReport = {
        duration: 10,
        n1Detections: [
          {
            callCount: 10,
            field: 'Post.author',
            parentField: 'Query.posts',
            severity: 'critical',
            suggestion: 'DataLoader',
          },
        ],
        operations: [],
        timestamp: sampleReport.timestamp,
      };

      const score = calculatePerformanceScore(report);
      // 100 - 15
      expect(score).toBe(85);
    });

    it('should penalize warning N+1 detections less', () => {
      const report: PerformanceReport = {
        duration: 10,
        n1Detections: [
          {
            callCount: 5,
            field: 'Post.comments',
            parentField: 'Query.posts',
            severity: 'warning',
            suggestion: 'DataLoader',
          },
        ],
        operations: [],
        timestamp: sampleReport.timestamp,
      };

      const score = calculatePerformanceScore(report);
      // 100 - 8
      expect(score).toBe(92);
    });

    it('should penalize low cache hit rate', () => {
      const report: PerformanceReport = {
        cacheStats: { entries: 100, hitRate: 0.05, hits: 5, misses: 95 },
        duration: 10,
        n1Detections: [],
        operations: [],
        timestamp: sampleReport.timestamp,
      };

      const score = calculatePerformanceScore(report);
      // 100 - 10
      expect(score).toBe(90);
    });

    it('should penalize high cost operations', () => {
      const report: PerformanceReport = {
        duration: 10,
        n1Detections: [],
        operations: [
          { costEstimate: 600, duration: 10, operationName: 'Expensive', resolverCalls: 100 },
        ],
        timestamp: sampleReport.timestamp,
      };

      const score = calculatePerformanceScore(report);
      // 100 - 10
      expect(score).toBe(90);
    });

    it('should never go below 0', () => {
      const report: PerformanceReport = {
        cacheStats: { entries: 0, hitRate: 0, hits: 0, misses: 100 },
        duration: 5000,
        n1Detections: Array.from({ length: 10 }, (_, index) => ({
          callCount: 20,
          field: `Type${index}.field`,
          parentField: 'Query.list',
          severity: 'critical' as const,
          suggestion: 'DataLoader',
        })),
        operations: Array.from({ length: 20 }, (_, index) => ({
          costEstimate: 1000,
          duration: 2000,
          operationName: `Op${index}`,
          resolverCalls: 100,
        })),
        timestamp: sampleReport.timestamp,
      };

      const score = calculatePerformanceScore(report);
      expect(score).toBe(0);
    });

    it('should never exceed 100', () => {
      const report: PerformanceReport = {
        cacheStats: { entries: 50, hitRate: 1, hits: 100, misses: 0 },
        duration: 1,
        n1Detections: [],
        operations: [],
        timestamp: sampleReport.timestamp,
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

    // eslint-disable-next-line sonarjs/parameterized-tests -- Each assertion documents a distinct dashboard section.
    it('should include dashboard title', () => {
      const html = generateDashboard(sampleReport);
      expect(html).toContain('graphql-watchdog Dashboard');
    });

    it('should include performance score', () => {
      const html = generateDashboard(sampleReport);
      expect(html).toContain('Performance Score');
    });

    // eslint-disable-next-line sonarjs/parameterized-tests -- Each assertion documents a distinct dashboard section.
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
      };
      delete report.cacheStats;

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
            callCount: 5,
            field: '<script>alert("xss")</script>',
            parentField: 'Query.posts',
            severity: 'warning',
            suggestion: 'DataLoader',
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
