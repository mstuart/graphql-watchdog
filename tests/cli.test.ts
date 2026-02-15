import { describe, it, expect } from 'vitest';
import { createAnalyzeCommand } from '../src/cli/analyze.js';
import { createBenchmarkCommand } from '../src/cli/benchmark.js';

describe('CLI Commands', () => {
  describe('analyze command', () => {
    it('should create analyze command with expected options', () => {
      const cmd = createAnalyzeCommand();

      expect(cmd.name()).toBe('analyze');
      expect(cmd.description()).toContain('Analyze');

      const options = cmd.options.map((o) => o.long);
      expect(options).toContain('--schema');
      expect(options).toContain('--operations');
      expect(options).toContain('--max-cost');
      expect(options).toContain('--format');
    });
  });

  describe('benchmark command', () => {
    it('should create benchmark command with expected options', () => {
      const cmd = createBenchmarkCommand();

      expect(cmd.name()).toBe('benchmark');
      expect(cmd.description()).toContain('Benchmark');

      const options = cmd.options.map((o) => o.long);
      expect(options).toContain('--endpoint');
      expect(options).toContain('--operations');
      expect(options).toContain('--baseline');
      expect(options).toContain('--iterations');
      expect(options).toContain('--output');
      expect(options).toContain('--threshold');
    });
  });
});
