import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export interface BenchmarkResult {
  operationName: string;
  iterations: number;
  latencies: number[];
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}

export interface BenchmarkReport {
  timestamp: string;
  endpoint: string;
  results: BenchmarkResult[];
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function createBenchmarkCommand(): Command {
  return new Command('benchmark')
    .description('Benchmark GraphQL operations against an endpoint')
    .requiredOption('--endpoint <url>', 'GraphQL endpoint URL')
    .requiredOption('--operations <glob>', 'Glob pattern for .graphql operation files')
    .option('--baseline <file>', 'Baseline JSON file for regression comparison')
    .option('--iterations <n>', 'Number of iterations per operation', parseInt, '10')
    .option('--output <file>', 'Save results to JSON file')
    .option('--threshold <percent>', 'Regression threshold percentage', parseInt, '20')
    .action(async (options) => {
      try {
        const files = findOperationFiles(options.operations);

        if (files.length === 0) {
          console.error('No operation files found matching:', options.operations);
          process.exit(1);
        }

        const iterations = parseInt(options.iterations) || 10;
        const results: BenchmarkResult[] = [];

        for (const file of files) {
          const source = readFileSync(file, 'utf-8');
          const operationName = extractOperationName(source) ?? file;

          console.log(`Benchmarking: ${operationName} (${iterations} iterations)`);

          const latencies: number[] = [];

          for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            try {
              const response = await fetch(options.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: source }),
              });
              await response.json();
            } catch (error) {
              console.error(`  Error on iteration ${i + 1}:`, (error as Error).message);
            }
            latencies.push(performance.now() - start);
          }

          const sorted = [...latencies].sort((a, b) => a - b);
          const result: BenchmarkResult = {
            operationName,
            iterations,
            latencies: sorted,
            p50: percentile(sorted, 50),
            p95: percentile(sorted, 95),
            p99: percentile(sorted, 99),
            mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
          };

          results.push(result);

          console.log(`  p50: ${result.p50.toFixed(2)}ms`);
          console.log(`  p95: ${result.p95.toFixed(2)}ms`);
          console.log(`  p99: ${result.p99.toFixed(2)}ms`);
          console.log(`  mean: ${result.mean.toFixed(2)}ms`);
          console.log('');
        }

        const report: BenchmarkReport = {
          timestamp: new Date().toISOString(),
          endpoint: options.endpoint,
          results,
        };

        // Save output
        if (options.output) {
          writeFileSync(options.output, JSON.stringify(report, null, 2));
          console.log(`Results saved to: ${options.output}`);
        }

        // Compare against baseline
        if (options.baseline && existsSync(options.baseline)) {
          const baseline: BenchmarkReport = JSON.parse(
            readFileSync(options.baseline, 'utf-8'),
          );
          const threshold = parseInt(options.threshold) || 20;
          let hasRegression = false;

          console.log('\n--- Regression Analysis ---\n');

          for (const result of results) {
            const baselineResult = baseline.results.find(
              (b) => b.operationName === result.operationName,
            );

            if (baselineResult) {
              const regressionPercent =
                ((result.p95 - baselineResult.p95) / baselineResult.p95) * 100;

              if (regressionPercent > threshold) {
                hasRegression = true;
                console.log(
                  `  REGRESSION: ${result.operationName} p95 regressed by ${regressionPercent.toFixed(1)}% (${baselineResult.p95.toFixed(2)}ms -> ${result.p95.toFixed(2)}ms)`,
                );
              } else if (regressionPercent < -5) {
                console.log(
                  `  IMPROVED: ${result.operationName} p95 improved by ${Math.abs(regressionPercent).toFixed(1)}%`,
                );
              } else {
                console.log(
                  `  OK: ${result.operationName} p95 within threshold (${regressionPercent.toFixed(1)}%)`,
                );
              }
            }
          }

          if (hasRegression) {
            console.error(`\nPerformance regression detected (threshold: ${threshold}%)`);
            process.exit(1);
          }
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}

function extractOperationName(source: string): string | null {
  const match = source.match(/(?:query|mutation|subscription)\s+(\w+)/);
  return match ? match[1] : null;
}

function findOperationFiles(pattern: string): string[] {
  const { readdirSync, statSync } = require('node:fs');
  const { join } = require('node:path');

  if (pattern.includes('*')) {
    const regexStr = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '___DOUBLE___')
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLE___/g, '.*');
    const regex = new RegExp(`^${regexStr}$`);

    const results: string[] = [];
    function walk(dir: string) {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            walk(fullPath);
          } else if (regex.test(fullPath)) {
            results.push(fullPath);
          }
        }
      } catch {
        // ignore errors
      }
    }
    walk(process.cwd());
    return results;
  }

  return [pattern];
}
