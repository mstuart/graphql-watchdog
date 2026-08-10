import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { buildSchema, parse } from 'graphql';
import { analyzeCost } from '../cost/analyzer.js';
import { formatCostBreakdown } from '../reporter/terminal.js';
import { formatCostAsJson } from '../reporter/json.js';
import type { CostConfig } from '../types/index.js';

export const createAnalyzeCommand = (): Command => {
  const command = new Command('analyze');
  return command
    .description('Analyze GraphQL operations for cost')
    .requiredOption('--schema <path>', 'Path to GraphQL schema SDL file')
    .requiredOption('--operations <glob>', 'Glob pattern for .graphql operation files')
    .option('--max-cost <number>', 'Maximum allowed query cost', Number.parseInt)
    .option('--default-list-multiplier <number>', 'Default list multiplier', Number.parseInt)
    .option('--format <format>', 'Output format (terminal|json)', 'terminal')
    .action(async (options) => {
      // eslint-disable-next-line unicorn/try-complexity -- The CLI boundary reports all command failures consistently.
      try {
        const schemaSource = readFileSync(options.schema, 'utf-8');
        const schema = buildSchema(schemaSource);

        // eslint-disable-next-line @typescript-eslint/no-use-before-define -- File discovery is kept below the command definition.
        const files = findFiles(options.operations);

        if (files.length === 0) {
          console.error('No operation files found matching:', options.operations);
          process.exit(1);
        }

        const costConfig: CostConfig = {
          defaultListMultiplier: options.defaultListMultiplier,
          maxCost: options.maxCost,
        };

        let hasExceeded = false;

        for (const file of files) {
          const source = readFileSync(file, 'utf-8');
          const document = parse(source);
          const breakdown = analyzeCost(document, schema, costConfig);

          if (breakdown.exceeds) {
            hasExceeded = true;
          }

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
};

const findFiles = (pattern: string): string[] => {
  if (pattern.includes('*')) {
    // Convert glob to regex
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
