import type { PerformanceReport } from '../types/index.js';
import type { CostBreakdown } from '../cost/analyzer.js';

export function formatReportAsJson(report: PerformanceReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatCostAsJson(breakdown: CostBreakdown): string {
  return JSON.stringify(breakdown, null, 2);
}
