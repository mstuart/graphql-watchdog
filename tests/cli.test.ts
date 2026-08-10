import { describe, it, expect } from 'vitest';
import { createAnalyzeCommand } from '../src/cli/analyze.js';
import { createBenchmarkCommand } from '../src/cli/benchmark.js';

describe('CLI Commands', () => {
  describe('analyze command', () => {
    it('should create analyze command with expected options', () => {
      const command = createAnalyzeCommand();

      expect(command.name()).toBe('analyze');
      expect(command.description()).toContain('Analyze');

      const options = command.options.map((o) => o.long);
      expect(options).toContain('--schema');
      expect(options).toContain('--operations');
      expect(options).toContain('--max-cost');
      expect(options).toContain('--format');
    });
  });

  describe('benchmark command', () => {
    it('should create benchmark command with expected options', () => {
      const command = createBenchmarkCommand();

      expect(command.name()).toBe('benchmark');
      expect(command.description()).toContain('Benchmark');

      const options = command.options.map((o) => o.long);
      expect(options).toContain('--endpoint');
      expect(options).toContain('--operations');
      expect(options).toContain('--baseline');
      expect(options).toContain('--iterations');
      expect(options).toContain('--output');
      expect(options).toContain('--threshold');
    });
  });
});
