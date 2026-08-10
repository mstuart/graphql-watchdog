import { formatPerformanceReport } from './terminal.js';
import { formatReportAsJson } from './json.js';
import { generateDashboard } from './dashboard.js';
import type { PerformanceReport } from '../types/index.js';

export type ReportFormat = 'terminal' | 'json' | 'dashboard';

export const generateReport = (
  report: PerformanceReport,
  format: ReportFormat = 'terminal',
): string => {
  switch (format) {
    case 'json': {
      return formatReportAsJson(report);
    }
    case 'dashboard': {
      return generateDashboard(report);
    }
    default: {
      return formatPerformanceReport(report);
    }
  }
};

export { formatN1Detections, formatCostBreakdown, formatPerformanceReport } from './terminal.js';
export { formatReportAsJson, formatCostAsJson } from './json.js';
export { generateDashboard, calculatePerformanceScore } from './dashboard.js';
