import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';

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

const percentile = (sorted: number[], p: number): number => {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
};

export const createBenchmarkCommand = (): Command => {
  const command = new Command('benchmark');
  return (
    command
      .description('Benchmark GraphQL operations against an endpoint')
      .requiredOption('--endpoint <url>', 'GraphQL endpoint URL')
      .requiredOption('--operations <glob>', 'Glob pattern for .graphql operation files')
      .option('--baseline <file>', 'Baseline JSON file for regression comparison')
      .option('--iterations <n>', 'Number of iterations per operation', Number.parseInt, 10)
      .option('--output <file>', 'Save results to JSON file')
      .option('--threshold <percent>', 'Regression threshold percentage', Number.parseInt, 20)
      // eslint-disable-next-line sonarjs/cognitive-complexity -- The CLI action coordinates the benchmark lifecycle.
      .action(async (options) => {
        // eslint-disable-next-line unicorn/try-complexity -- The CLI boundary reports all command failures consistently.
        try {
          // eslint-disable-next-line @typescript-eslint/no-use-before-define -- File discovery is kept below the command definition.
          const files = findOperationFiles(options.operations);

          if (files.length === 0) {
            console.error('No operation files found matching:', options.operations);
            process.exit(1);
          }

          const iterations = Number(options.iterations) || 10;
          const results: BenchmarkResult[] = [];

          for (const file of files) {
            const source = readFileSync(file, 'utf-8');
            // eslint-disable-next-line @typescript-eslint/no-use-before-define -- Operation parsing is kept below the command definition.
            const operationName = extractOperationName(source) ?? file;

            console.log(`Benchmarking: ${operationName} (${iterations} iterations)`);

            const latencies: number[] = [];

            for (let index = 0; index < iterations; index += 1) {
              // eslint-disable-next-line compat/compat -- This package targets Node.js 22.
              const start = performance.now();
              try {
                // eslint-disable-next-line compat/compat, no-await-in-loop -- Sequential requests are required for latency measurement.
                const response = await fetch(options.endpoint, {
                  body: JSON.stringify({ query: source }),
                  headers: { 'Content-Type': 'application/json' },
                  method: 'POST',
                });
                // eslint-disable-next-line no-await-in-loop -- Each measured response must complete before the next iteration.
                await response.json();
              } catch (error) {
                console.error(`  Error on iteration ${index + 1}:`, (error as Error).message);
              }
              // eslint-disable-next-line compat/compat -- This package targets Node.js 22.
              latencies.push(performance.now() - start);
            }

            // eslint-disable-next-line unicorn/no-array-sort -- The project targets the ES2022 TypeScript library.
            const sorted = [...latencies].sort((a, b) => a - b);
            const result: BenchmarkResult = {
              iterations,
              latencies: sorted,
              mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
              operationName,
              p50: percentile(sorted, 50),
              p95: percentile(sorted, 95),
              p99: percentile(sorted, 99),
            };

            results.push(result);

            console.log(`  p50: ${result.p50.toFixed(2)}ms`);
            console.log(`  p95: ${result.p95.toFixed(2)}ms`);
            console.log(`  p99: ${result.p99.toFixed(2)}ms`);
            console.log(`  mean: ${result.mean.toFixed(2)}ms`);
            console.log('');
          }

          const now = new Date();
          const report: BenchmarkReport = {
            endpoint: options.endpoint,
            results,
            timestamp: now.toISOString(),
          };

          // Save output
          if (options.output) {
            writeFileSync(options.output, JSON.stringify(report, null, 2));
            console.log(`Results saved to: ${options.output}`);
          }

          // Compare against baseline
          if (options.baseline && existsSync(options.baseline)) {
            const baseline: BenchmarkReport = JSON.parse(readFileSync(options.baseline, 'utf-8'));
            const threshold = Number(options.threshold) || 20;
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
      })
  );
};

const extractOperationName = (source: string): string | null => {
  const match = source.match(/(?:query|mutation|subscription)\s+(?<operationName>\w+)/u);
  return match?.groups?.operationName ?? null;
};

const findOperationFiles = (pattern: string): string[] => {
  if (pattern.includes('*')) {
    const regexString = pattern
      .replaceAll('.', '\\.')
      .replaceAll('**', '___DOUBLE___')
      .replaceAll('*', '[^/]*')
      .replaceAll('___DOUBLE___', '.*');
    const regex = new RegExp(`^${regexString}$`, 'u');

    const results: string[] = [];
    const readDirectory = (directory: string): string[] => {
      try {
        return readdirSync(directory);
      } catch {
        return [];
      }
    };
    const readStat = (filePath: string): ReturnType<typeof statSync> | undefined => {
      try {
        return statSync(filePath);
      } catch {
        return undefined;
      }
    };
    const walk = (directory: string): void => {
      for (const entry of readDirectory(directory)) {
        const fullPath = path.join(directory, entry);
        const stat = readStat(fullPath);
        if (!stat) {
          continue;
        }
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (regex.test(fullPath)) {
          results.push(fullPath);
        }
      }
    };
    walk(process.cwd());
    return results;
  }

  return [pattern];
};
