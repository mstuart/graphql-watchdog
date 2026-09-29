import { describe, it, expect } from 'vitest';
import { createAnalyzeCommand } from '../src/cli/analyze.js';
import { benchmarkOperation, createBenchmarkCommand } from '../src/cli/benchmark.js';

const fetchServiceUnavailable = async (): Promise<Response> =>
  new Response('{"errors":[{"message":"unavailable"}]}', {
    headers: { 'Content-Type': 'application/json' },
    status: 503,
    statusText: 'Service Unavailable',
  });

const fetchInvalidJson = async (): Promise<Response> =>
  new Response('not json', {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });

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

    it('rejects HTTP error responses instead of recording them as latency samples', async () => {
      await expect(
        benchmarkOperation({
          endpoint: 'https://example.test/graphql',
          fetchFunction: fetchServiceUnavailable,
          iterations: 1,
          operationName: 'Health',
          source: 'query Health { health }',
        }),
      ).rejects.toThrow('Health iteration 1 returned HTTP 503 Service Unavailable');
    });

    it('rejects invalid JSON responses instead of recording them as latency samples', async () => {
      await expect(
        benchmarkOperation({
          endpoint: 'https://example.test/graphql',
          fetchFunction: fetchInvalidJson,
          iterations: 1,
          operationName: 'Health',
          source: 'query Health { health }',
        }),
      ).rejects.toThrow();
    });
  });
});
