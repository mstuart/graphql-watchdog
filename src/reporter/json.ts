import type { PerformanceReport } from '../types/index.js';
import type { CostBreakdown } from '../cost/analyzer.js';

export const formatReportAsJson = (report: PerformanceReport): string =>
  JSON.stringify(report, null, 2);

export const formatCostAsJson = (breakdown: CostBreakdown): string =>
  JSON.stringify(breakdown, null, 2);
