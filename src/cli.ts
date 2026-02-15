#!/usr/bin/env node
import { Command } from 'commander';
import { createAnalyzeCommand } from './cli/analyze.js';
import { createBenchmarkCommand } from './cli/benchmark.js';

const program = new Command()
  .name('graphql-watchdog')
  .description('GraphQL performance toolkit — N+1 detection, cost analysis, caching, and CI benchmarking')
  .version('0.1.0');

program.addCommand(createAnalyzeCommand());
program.addCommand(createBenchmarkCommand());

program.parse();
