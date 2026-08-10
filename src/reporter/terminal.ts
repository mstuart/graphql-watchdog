import type { PerformanceReport, N1Detection } from '../types/index.js';
import type { CostBreakdown } from '../cost/analyzer.js';

const RESET = '\u{1B}[0m';
const BOLD = '\u{1B}[1m';
const RED = '\u{1B}[31m';
const YELLOW = '\u{1B}[33m';
const GREEN = '\u{1B}[32m';
const CYAN = '\u{1B}[36m';
const DIM = '\u{1B}[2m';

export const formatN1Detections = (detections: N1Detection[]): string => {
  if (detections.length === 0) {
    return `${GREEN}${BOLD}No N+1 queries detected${RESET}\n`;
  }

  const lines: string[] = [`${RED}${BOLD}N+1 Query Detections (${detections.length})${RESET}`, ''];

  for (const d of detections) {
    const severityColor = d.severity === 'critical' ? RED : YELLOW;
    const severityLabel = d.severity.toUpperCase();

    lines.push(
      `  ${severityColor}${BOLD}[${severityLabel}]${RESET} ${BOLD}${d.field}${RESET}`,
      `    Parent: ${DIM}${d.parentField}${RESET}`,
      `    Calls:  ${d.callCount}`,
      `    Fix:    ${CYAN}${d.suggestion}${RESET}`,
      '',
    );
  }

  return lines.join('\n');
};

export const formatCostBreakdown = (breakdown: CostBreakdown): string => {
  const statusColor = breakdown.exceeds ? RED : GREEN;
  const statusLabel = breakdown.exceeds ? 'EXCEEDS LIMIT' : 'WITHIN LIMIT';
  const limitSuffix = breakdown.limit < Infinity ? ` / ${breakdown.limit}` : '';

  const lines: string[] = [
    `${BOLD}Query Cost Analysis${RESET}`,
    '',
    `  Total Cost: ${statusColor}${BOLD}${breakdown.totalCost}${RESET}${limitSuffix}`,
    `  Status:     ${statusColor}${statusLabel}${RESET}`,
    '',
    `  ${DIM}Field Costs:${RESET}`,
  ];

  for (const fc of breakdown.fieldCosts) {
    lines.push(`    ${fc.path}: ${fc.cost}`);
  }

  lines.push('');
  return lines.join('\n');
};

export const formatPerformanceReport = (report: PerformanceReport): string => {
  const lines: string[] = [
    `${BOLD}${CYAN}graphql-watchdog Performance Report${RESET}`,
    `${DIM}${report.timestamp}${RESET}`,
    `${DIM}Total Duration: ${report.duration}ms${RESET}`,
    '',
  ];

  if (report.operations.length > 0) {
    lines.push(
      `${BOLD}Operations:${RESET}`,
      `  ${'Operation'.padEnd(30)} ${'Duration'.padStart(10)} ${'Resolvers'.padStart(10)} ${'Cost'.padStart(8)}`,
      `  ${'-'.repeat(30)} ${'-'.repeat(10)} ${'-'.repeat(10)} ${'-'.repeat(8)}`,
    );

    for (const op of report.operations) {
      const name = op.operationName ?? '<anonymous>';
      const duration = `${op.duration}ms`;
      lines.push(
        `  ${name.padEnd(30)} ${duration.padStart(10)} ${String(op.resolverCalls).padStart(10)} ${String(op.costEstimate).padStart(8)}`,
      );
    }
    lines.push('');
  }

  lines.push(formatN1Detections(report.n1Detections));

  if (report.cacheStats) {
    const { hits, misses, hitRate, entries } = report.cacheStats;
    lines.push(
      `${BOLD}Cache Stats:${RESET}`,
      `  Entries:  ${entries}`,
      `  Hits:     ${hits}`,
      `  Misses:   ${misses}`,
      `  Hit Rate: ${(hitRate * 100).toFixed(1)}%`,
      '',
    );
  }

  return lines.join('\n');
};
