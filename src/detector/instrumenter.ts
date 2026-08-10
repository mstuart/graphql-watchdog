import type { ResolverCall } from '../types/index.js';
import type { DynamicCostTracker } from '../cost/dynamic.js';

type ResolverFunction = (
  ...parameters: [
    parent: Record<string, unknown> | null | undefined,
    resolverArguments: unknown,
    context: unknown,
    info: unknown,
  ]
) => unknown;

export class ResolverInstrumenter {
  private calls: ResolverCall[] = [];
  private costTracker: DynamicCostTracker | null = null;

  constructor(options?: { costTracker?: DynamicCostTracker }) {
    this.costTracker = options?.costTracker ?? null;
  }

  instrumentResolvers(
    resolvers: Record<string, Record<string, unknown>>,
  ): Record<string, Record<string, unknown>> {
    const instrumented: Record<string, Record<string, unknown>> = {};

    for (const [typeName, typeResolvers] of Object.entries(resolvers)) {
      instrumented[typeName] = {};

      for (const [fieldName, originalResolver] of Object.entries(typeResolvers)) {
        if (typeof originalResolver !== 'function') {
          instrumented[typeName][fieldName] = originalResolver;
          // eslint-disable-next-line unicorn/no-break-in-nested-loop -- Non-function resolver entries pass through unchanged.
          continue;
        }
        const resolver = originalResolver as ResolverFunction;
        instrumented[typeName][fieldName] = async (...parameters: Parameters<ResolverFunction>) => {
          const [parent, resolverArguments, context, info] = parameters;
          const parentId = parent ? String(parent.id ?? parent._id ?? null) : null;
          const batchKey = `${typeName}.${fieldName}`;
          const timestamp = Date.now();
          // eslint-disable-next-line compat/compat -- This package targets Node.js 22.
          const startTime = performance.now();

          // eslint-disable-next-line unicorn/try-complexity -- Both resolver outcomes must record the same timing metadata.
          try {
            const result = await resolver(parent, resolverArguments, context, info);
            // eslint-disable-next-line compat/compat -- This package targets Node.js 22.
            const duration = performance.now() - startTime;

            this.calls.push({
              batchKey,
              duration,
              fieldName,
              parentId,
              timestamp,
              typeName,
            });

            // Feed timing data to dynamic cost tracker
            if (this.costTracker) {
              this.costTracker.recordTiming(typeName, fieldName, duration);
            }

            return result;
          } catch (error) {
            // eslint-disable-next-line compat/compat -- This package targets Node.js 22.
            const duration = performance.now() - startTime;

            this.calls.push({
              batchKey,
              duration,
              fieldName,
              parentId,
              timestamp,
              typeName,
            });

            // Feed timing data even on errors
            if (this.costTracker) {
              this.costTracker.recordTiming(typeName, fieldName, duration);
            }

            throw error;
          }
        };
      }
    }

    return instrumented;
  }

  getCalls(): ResolverCall[] {
    return [...this.calls];
  }

  recordCall(call: ResolverCall): void {
    this.calls.push(call);
  }

  reset(): void {
    this.calls = [];
  }
}
