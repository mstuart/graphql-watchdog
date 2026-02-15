import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { buildSchema, parse } from 'graphql';
import { analyzeCost } from '../cost/analyzer.js';
import { formatCostBreakdown } from '../reporter/terminal.js';
import { formatCostAsJson } from '../reporter/json.js';
import type { CostConfig } from '../types/index.js';

export function createAnalyzeCommand(): Command {
  return new Command('analyze')
    .description('Analyze GraphQL operations for cost')
    .requiredOption('--schema <path>', 'Path to GraphQL schema SDL file')
    .requiredOption('--operations <glob>', 'Glob pattern for .graphql operation files')
    .option('--max-cost <number>', 'Maximum allowed query cost', parseInt)
    .option('--default-list-multiplier <number>', 'Default list multiplier', parseInt)
    .option('--format <format>', 'Output format (terminal|json)', 'terminal')
    .action(async (options) => {
      try {
        const schemaSource = readFileSync(options.schema, 'utf-8');
        const schema = buildSchema(schemaSource);

        // Use glob to find operation files
        const { glob } = await import('node:fs');
        const files = findFiles(options.operations);

        if (files.length === 0) {
          console.error('No operation files found matching:', options.operations);
          process.exit(1);
        }

        const costConfig: CostConfig = {
          maxCost: options.maxCost,
          defaultListMultiplier: options.defaultListMultiplier,
        };

        let hasExceeded = false;

        for (const file of files) {
          const source = readFileSync(file, 'utf-8');
          const document = parse(source);
          const breakdown = analyzeCost(document, schema, costConfig);

          if (breakdown.exceeds) hasExceeded = true;

          console.log(`\n--- ${file} ---`);
          if (options.format === 'json') {
            console.log(formatCostAsJson(breakdown));
          } else {
            console.log(formatCostBreakdown(breakdown));
          }
        }

        if (hasExceeded) {
          process.exit(1);
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}

function findFiles(pattern: string): string[] {
  // Simple glob implementation using node:fs
  const { readdirSync, statSync } = require('node:fs');
  const { resolve, join } = require('node:path');

  if (pattern.includes('*')) {
    // Convert glob to regex
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
