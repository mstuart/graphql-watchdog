import type { CostConfig } from '../types/index.js';

export interface ResolverTimingEntry {
  // ms
  avgDuration: number;
  // ms
  p95Duration: number;
  callCount: number;
  // timestamp
  lastUpdated: number;
}

export type ResolverTimingData = Record<string, ResolverTimingEntry>;

export class DynamicCostTracker {
  private timingData: ResolverTimingData = {};
  // Track sorted durations for p95 calculation (bounded)
  private durationSamples = new Map<string, number[]>();
  private maxSamples = 1000;

  /**
   * Record resolver timing from instrumentation.
   * Uses a running average to avoid unbounded memory growth.
   */
  recordTiming(typeName: string, fieldName: string, durationMs: number): void {
    const key = `${typeName}.${fieldName}`;
    const existing = this.timingData[key];

    if (existing) {
      // Update running average
      const newCount = existing.callCount + 1;
      const newAvg = existing.avgDuration + (durationMs - existing.avgDuration) / newCount;

      // Update p95 samples (bounded ring buffer approach)
      let samples = this.durationSamples.get(key) ?? [];
      if (samples.length >= this.maxSamples) {
        samples = samples.slice(1);
      }
      samples.push(durationMs);
      this.durationSamples.set(key, samples);

      // eslint-disable-next-line unicorn/no-array-sort -- The project targets the ES2022 TypeScript library.
      const sorted = [...samples].sort((a, b) => a - b);
      const p95Index = Math.ceil(sorted.length * 0.95) - 1;

      this.timingData[key] = {
        avgDuration: newAvg,
        callCount: newCount,
        lastUpdated: Date.now(),
        p95Duration: sorted[Math.max(0, p95Index)],
      };
    } else {
      this.timingData[key] = {
        avgDuration: durationMs,
        callCount: 1,
        lastUpdated: Date.now(),
        p95Duration: durationMs,
      };
      this.durationSamples.set(key, [durationMs]);
    }
  }

  /**
   * Get dynamic cost config based on recorded data.
   * Maps actual resolver performance to cost weights.
   * Fields taking baselineDuration ms = cost 1, linear scaling.
   */
  toCostConfig(options?: {
    // ms -- cost=1 equivalent (default 10ms)
    baselineDuration?: number;
    // round costs to nearest N (default 1)
    roundTo?: number;
  }): CostConfig {
    const baseline = options?.baselineDuration ?? 10;
    const roundTo = options?.roundTo ?? 1;

    const costMap: Record<string, number> = {};

    for (const [field, timing] of Object.entries(this.timingData)) {
      let cost = timing.avgDuration / baseline;
      if (roundTo > 0) {
        cost = Math.round(cost / roundTo) * roundTo;
      }
      // Ensure minimum cost of 1
      costMap[field] = Math.max(1, cost);
    }

    return { costMap };
  }

  /**
  Export timing data for persistence
  */
  export(): ResolverTimingData {
    return structuredClone(this.timingData);
  }

  /**
  Import previously saved timing data
  */
  import(data: ResolverTimingData): void {
    for (const [key, entry] of Object.entries(data)) {
      this.timingData[key] = { ...entry };
      // Reconstruct approximate samples from the existing data
      // We cannot recover the full sample set, so we use the avg as a single representative
      if (!this.durationSamples.has(key)) {
        this.durationSamples.set(key, [entry.avgDuration]);
      }
    }
  }

  /**
  Get stats summary
  */
  getStats(): {
    trackedFields: number;
    totalCalls: number;
    slowestFields: { field: string; avgDuration: number }[];
  } {
    const entries = Object.entries(this.timingData);
    const totalCalls = entries.reduce((sum, [, entry]) => sum + entry.callCount, 0);
    const slowestFields = entries
      // eslint-disable-next-line unicorn/no-array-sort -- The project targets the ES2022 TypeScript library.
      .sort(([, a], [, b]) => b.avgDuration - a.avgDuration)
      .slice(0, 10)
      .map(([field, entry]) => ({ avgDuration: entry.avgDuration, field }));

    return {
      slowestFields,
      totalCalls,
      trackedFields: entries.length,
    };
  }
}
