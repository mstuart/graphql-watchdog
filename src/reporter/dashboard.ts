import type { PerformanceReport, CacheStats } from '../types/index.js';

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export const calculatePerformanceScore = (report: PerformanceReport): number => {
  let score = 100;

  // N+1 detections penalty
  for (const d of report.n1Detections) {
    score -= d.severity === 'critical' ? 15 : 8;
  }

  // Cost penalty: high cost operations
  for (const op of report.operations) {
    if (op.costEstimate > 500) {
      score -= 10;
    } else if (op.costEstimate > 200) {
      score -= 5;
    }
  }

  // Cache hit rate bonus/penalty
  if (report.cacheStats) {
    if (report.cacheStats.hitRate < 0.3) {
      score -= 10;
    } else if (report.cacheStats.hitRate < 0.5) {
      score -= 5;
    } else if (report.cacheStats.hitRate > 0.8) {
      score += 5;
    }
  }

  // Slow operations penalty
  for (const op of report.operations) {
    if (op.duration > 1000) {
      score -= 10;
    } else if (op.duration > 500) {
      score -= 5;
    }
  }

  return Math.max(0, Math.min(100, score));
};

const scoreColor = (score: number): string => {
  if (score >= 80) {
    return '#22c55e';
  }
  if (score >= 60) {
    return '#eab308';
  }
  if (score >= 40) {
    return '#f97316';
  }
  return '#ef4444';
};

const severityColor = (severity: string): string => {
  if (severity === 'critical') {
    return '#ef4444';
  }
  return '#eab308';
};

const cacheColor = (hitRate: number): string => {
  if (hitRate >= 80) {
    return '#22c55e';
  }
  if (hitRate >= 50) {
    return '#eab308';
  }
  return '#ef4444';
};

const performanceStatus = (score: number): string => {
  if (score >= 80) {
    return 'Good';
  }
  if (score >= 60) {
    return 'Fair';
  }
  if (score >= 40) {
    return 'Needs Improvement';
  }
  return 'Critical';
};

const generateScoreGauge = (score: number): string => {
  const color = scoreColor(score);
  const angle = (score / 100) * 360;
  const radians = ((angle - 90) * Math.PI) / 180;
  const x = 50 + 40 * Math.cos(radians);
  const y = 50 + 40 * Math.sin(radians);
  const largeArc = angle > 180 ? 1 : 0;

  return `<svg viewBox="0 0 100 100" width="120" height="120">
    <circle cx="50" cy="50" r="40" fill="none" stroke="#334155" stroke-width="8"/>
    ${
      score > 0
        ? `<path d="M 50 10 A 40 40 0 ${largeArc} 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>`
        : ''
    }
    <text x="50" y="55" text-anchor="middle" fill="${color}" font-size="20" font-weight="bold">${score}</text>
  </svg>`;
};

const generateCostBarChart = (fieldCosts: { path: string; cost: number }[]): string => {
  // eslint-disable-next-line unicorn/no-array-sort -- The project targets the ES2022 TypeScript library.
  const top = [...fieldCosts].sort((a, b) => b.cost - a.cost).slice(0, 10);

  if (top.length === 0) {
    return '<p style="color:#94a3b8">No cost data</p>';
  }

  const maxCost = top[0].cost;
  const barHeight = 28;
  const chartHeight = top.length * barHeight + 20;

  const bars = top
    .map((fc, index) => {
      const barWidth = maxCost > 0 ? (fc.cost / maxCost) * 300 : 0;
      const y = index * barHeight + 10;
      const label = fc.path.length > 25 ? `...${fc.path.slice(-22)}` : fc.path;
      return `
        <g>
          <rect x="120" y="${y}" width="${barWidth}" height="20" rx="3" fill="#6366f1" opacity="0.8"/>
          <text x="115" y="${y + 14}" text-anchor="end" fill="#94a3b8" font-size="11">${escapeHtml(label)}</text>
          <text x="${125 + barWidth}" y="${y + 14}" fill="#e2e8f0" font-size="11">${fc.cost}</text>
        </g>`;
    })
    .join('');

  return `<svg viewBox="0 0 500 ${chartHeight}" width="100%" height="${chartHeight}">
    ${bars}
  </svg>`;
};

const generateScoreGaugeGeneric = (value: number, color: string, suffix: string): string => {
  const angle = (Math.min(value, 100) / 100) * 360;
  const radians = ((angle - 90) * Math.PI) / 180;
  const x = 50 + 40 * Math.cos(radians);
  const y = 50 + 40 * Math.sin(radians);
  const largeArc = angle > 180 ? 1 : 0;

  return `<svg viewBox="0 0 100 100" width="100" height="100">
    <circle cx="50" cy="50" r="40" fill="none" stroke="#334155" stroke-width="8"/>
    ${
      value > 0
        ? `<path d="M 50 10 A 40 40 0 ${largeArc} 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>`
        : ''
    }
    <text x="50" y="50" text-anchor="middle" fill="${color}" font-size="14" font-weight="bold">${value.toFixed(0)}${suffix}</text>
  </svg>`;
};

const generateCacheGauge = (stats: CacheStats): string => {
  const hitRate = stats.hitRate * 100;
  const color = cacheColor(hitRate);

  return `<div style="text-align:center">
    ${generateScoreGaugeGeneric(hitRate, color, '%')}
    <div style="margin-top:8px;color:#94a3b8;font-size:13px">
      <span>Hits: ${stats.hits}</span> | <span>Misses: ${stats.misses}</span> | <span>Entries: ${stats.entries}</span>
    </div>
  </div>`;
};

export const generateDashboard = (report: PerformanceReport): string => {
  const score = calculatePerformanceScore(report);
  const scoreGauge = generateScoreGauge(score);

  // N+1 Hotspots
  const n1Rows = report.n1Detections
    .map(
      (d) => `<tr>
      <td style="color:${severityColor(d.severity)};font-weight:600">${escapeHtml(d.field)}</td>
      <td>${d.callCount}</td>
      <td><span style="color:${severityColor(d.severity)};text-transform:uppercase;font-size:12px;font-weight:600">${d.severity}</span></td>
      <td style="font-size:12px;color:#94a3b8">${escapeHtml(d.suggestion)}</td>
    </tr>`,
    )
    .join('');

  // Cost breakdown
  const allFieldCosts =
    report.operations.length > 0
      ? report.operations.map((op) => ({
          cost: op.costEstimate,
          path: op.operationName ?? '<anonymous>',
        }))
      : [];

  // Slowest operations
  // eslint-disable-next-line unicorn/no-array-sort -- The project targets the ES2022 TypeScript library.
  const sortedOps = [...report.operations].sort((a, b) => b.duration - a.duration);
  const slowOpsRows = sortedOps
    .map(
      (op) => `<tr>
      <td>${escapeHtml(op.operationName ?? '<anonymous>')}</td>
      <td>${op.duration}ms</td>
      <td>${op.resolverCalls}</td>
      <td>${op.costEstimate}</td>
    </tr>`,
    )
    .join('');

  // Cache stats section
  const cacheSection = report.cacheStats
    ? `<div class="card">
      <h2>Cache Performance</h2>
      ${generateCacheGauge(report.cacheStats)}
    </div>`
    : '';
  const status = performanceStatus(score);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>graphql-watchdog Performance Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
    background: #0f172a;
    color: #e2e8f0;
    padding: 24px;
    line-height: 1.6;
  }
  h1 { color: #f1f5f9; font-size: 24px; margin-bottom: 4px; }
  h2 { color: #cbd5e1; font-size: 16px; margin-bottom: 12px; border-bottom: 1px solid #1e293b; padding-bottom: 8px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .header-meta { color: #64748b; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 16px; }
  .card {
    background: #1e293b;
    border-radius: 8px;
    padding: 20px;
    border: 1px solid #334155;
  }
  .score-card { display: flex; align-items: center; gap: 20px; }
  .score-label { font-size: 14px; color: #94a3b8; }
  .score-status { font-size: 18px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #64748b; font-weight: 600; padding: 8px 12px; border-bottom: 1px solid #334155; font-size: 12px; text-transform: uppercase; }
  td { padding: 8px 12px; border-bottom: 1px solid #1e293b; }
  tr:hover td { background: #334155; }
  .no-data { color: #64748b; font-style: italic; padding: 16px; }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>graphql-watchdog Dashboard</h1>
    <div class="header-meta">${escapeHtml(report.timestamp)} | Duration: ${report.duration}ms</div>
  </div>
</div>

<div class="grid">
  <div class="card">
    <h2>Performance Score</h2>
    <div class="score-card">
      ${scoreGauge}
      <div>
        <div class="score-label">Overall Health</div>
        <div class="score-status" style="color:${scoreColor(score)}">${status}</div>
        <div class="score-label" style="margin-top:4px">
          ${report.n1Detections.length} N+1 issues |
          ${report.operations.length} operations
          ${report.cacheStats ? ` | ${(report.cacheStats.hitRate * 100).toFixed(0)}% cache hit rate` : ''}
        </div>
      </div>
    </div>
  </div>

  ${cacheSection}
</div>

<div class="grid">
  <div class="card">
    <h2>N+1 Hotspots</h2>
    ${
      report.n1Detections.length > 0
        ? `<table>
      <thead><tr><th>Field</th><th>Calls</th><th>Severity</th><th>Suggestion</th></tr></thead>
      <tbody>${n1Rows}</tbody>
    </table>`
        : '<div class="no-data">No N+1 queries detected</div>'
    }
  </div>

  <div class="card">
    <h2>Cost Breakdown</h2>
    ${generateCostBarChart(allFieldCosts)}
  </div>
</div>

<div class="card" style="margin-top:16px">
  <h2>Operations</h2>
  ${
    report.operations.length > 0
      ? `<table>
    <thead><tr><th>Operation</th><th>Duration</th><th>Resolver Calls</th><th>Cost</th></tr></thead>
    <tbody>${slowOpsRows}</tbody>
  </table>`
      : '<div class="no-data">No operations recorded</div>'
  }
</div>

<script>
(function() {
  try {
    var key = 'gql-watchdog-reports';
    var stored = JSON.parse(localStorage.getItem(key) || '[]');
    stored.push({
      timestamp: ${JSON.stringify(report.timestamp)},
      score: ${score},
      n1Count: ${report.n1Detections.length},
      opCount: ${report.operations.length},
      cacheHitRate: ${report.cacheStats ? report.cacheStats.hitRate : 0}
    });
    if (stored.length > 50) stored = stored.slice(-50);
    localStorage.setItem(key, JSON.stringify(stored));
  } catch(e) {}
})();
</script>

</body>
</html>`;
};
