import type { PerformanceReport, N1Detection } from '../types/index.js';
import type { CostBreakdown } from '../cost/analyzer.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

export function formatN1Detections(detections: N1Detection[]): string {
  if (detections.length === 0) {
    return `${GREEN}${BOLD}No N+1 queries detected${RESET}\n`;
  }

  const lines: string[] = [
    `${RED}${BOLD}N+1 Query Detections (${detections.length})${RESET}`,
    '',
  ];

  for (const d of detections) {
    const severityColor = d.severity === 'critical' ? RED : YELLOW;
    const severityLabel = d.severity.toUpperCase();

    lines.push(
      `  ${severityColor}${BOLD}[${severityLabel}]${RESET} ${BOLD}${d.field}${RESET}`,
    );
    lines.push(`    Parent: ${DIM}${d.parentField}${RESET}`);
    lines.push(`    Calls:  ${d.callCount}`);
    lines.push(`    Fix:    ${CYAN}${d.suggestion}${RESET}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function formatCostBreakdown(breakdown: CostBreakdown): string {
  const statusColor = breakdown.exceeds ? RED : GREEN;
  const statusLabel = breakdown.exceeds ? 'EXCEEDS LIMIT' : 'WITHIN LIMIT';

  const lines: string[] = [
    `${BOLD}Query Cost Analysis${RESET}`,
    '',
    `  Total Cost: ${statusColor}${BOLD}${breakdown.totalCost}${RESET}${breakdown.limit < Infinity ? ` / ${breakdown.limit}` : ''}`,
    `  Status:     ${statusColor}${statusLabel}${RESET}`,
    '',
    `  ${DIM}Field Costs:${RESET}`,
  ];

  for (const fc of breakdown.fieldCosts) {
    lines.push(`    ${fc.path}: ${fc.cost}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function formatPerformanceReport(report: PerformanceReport): string {
  const lines: string[] = [
    `${BOLD}${CYAN}graphql-watchdog Performance Report${RESET}`,
    `${DIM}${report.timestamp}${RESET}`,
    `${DIM}Total Duration: ${report.duration}ms${RESET}`,
    '',
  ];

  if (report.operations.length > 0) {
    lines.push(`${BOLD}Operations:${RESET}`);
    lines.push(
      `  ${'Operation'.padEnd(30)} ${'Duration'.padStart(10)} ${'Resolvers'.padStart(10)} ${'Cost'.padStart(8)}`,
    );
    lines.push(`  ${'-'.repeat(30)} ${'-'.repeat(10)} ${'-'.repeat(10)} ${'-'.repeat(8)}`);

    for (const op of report.operations) {
      const name = op.operationName ?? '<anonymous>';
      lines.push(
        `  ${name.padEnd(30)} ${(op.duration + 'ms').padStart(10)} ${String(op.resolverCalls).padStart(10)} ${String(op.costEstimate).padStart(8)}`,
      );
    }
    lines.push('');
  }

  lines.push(formatN1Detections(report.n1Detections));

  if (report.cacheStats) {
    const { hits, misses, hitRate, entries } = report.cacheStats;
    lines.push(`${BOLD}Cache Stats:${RESET}`);
    lines.push(`  Entries:  ${entries}`);
    lines.push(`  Hits:     ${hits}`);
    lines.push(`  Misses:   ${misses}`);
    lines.push(`  Hit Rate: ${(hitRate * 100).toFixed(1)}%`);
    lines.push('');
  }

  return lines.join('\n');
}
