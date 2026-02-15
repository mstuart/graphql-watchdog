import type { ResolverCall } from '../types/index.js';
import type { DynamicCostTracker } from '../cost/dynamic.js';

export class ResolverInstrumenter {
  private calls: ResolverCall[] = [];
  private costTracker: DynamicCostTracker | null = null;

  constructor(options?: { costTracker?: DynamicCostTracker }) {
    this.costTracker = options?.costTracker ?? null;
  }

  instrumentResolvers(resolvers: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
    const instrumented: Record<string, Record<string, unknown>> = {};

    for (const typeName of Object.keys(resolvers)) {
      instrumented[typeName] = {};
      const typeResolvers = resolvers[typeName];

      for (const fieldName of Object.keys(typeResolvers)) {
        const originalResolver = typeResolvers[fieldName];

        if (typeof originalResolver === 'function') {
          instrumented[typeName][fieldName] = async (
            parent: Record<string, unknown> | null | undefined,
            args: unknown,
            context: unknown,
            info: unknown,
          ) => {
            const parentId = parent ? String(parent.id ?? parent._id ?? null) : null;
            const batchKey = `${typeName}.${fieldName}`;
            const timestamp = Date.now();
            const startTime = performance.now();

            try {
              const result = await (originalResolver as Function)(parent, args, context, info);
              const duration = performance.now() - startTime;

              this.calls.push({
                fieldName,
                typeName,
                parentId,
                timestamp,
                duration,
                batchKey,
              });

              // Feed timing data to dynamic cost tracker
              if (this.costTracker) {
                this.costTracker.recordTiming(typeName, fieldName, duration);
              }

              return result;
            } catch (error) {
              const duration = performance.now() - startTime;

              this.calls.push({
                fieldName,
                typeName,
                parentId,
                timestamp,
                duration,
                batchKey,
              });

              // Feed timing data even on errors
              if (this.costTracker) {
                this.costTracker.recordTiming(typeName, fieldName, duration);
              }

              throw error;
            }
          };
        } else {
          instrumented[typeName][fieldName] = originalResolver;
        }
      }
    }

    return instrumented;
  }

  getCalls(): ResolverCall[] {
    return [...this.calls];
  }

  reset(): void {
    this.calls = [];
  }
}
