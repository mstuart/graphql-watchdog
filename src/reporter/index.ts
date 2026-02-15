import type { PerformanceReport } from '../types/index.js';
import { formatPerformanceReport } from './terminal.js';
import { formatReportAsJson } from './json.js';

export type ReportFormat = 'terminal' | 'json';

export function generateReport(report: PerformanceReport, format: ReportFormat = 'terminal'): string {
  switch (format) {
    case 'json':
      return formatReportAsJson(report);
    case 'terminal':
    default:
      return formatPerformanceReport(report);
  }
}

export { formatN1Detections, formatCostBreakdown, formatPerformanceReport } from './terminal.js';
export { formatReportAsJson, formatCostAsJson } from './json.js';
