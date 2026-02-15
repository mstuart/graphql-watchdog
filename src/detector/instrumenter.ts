import type { ResolverCall } from '../types/index.js';

export class ResolverInstrumenter {
  private calls: ResolverCall[] = [];

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
