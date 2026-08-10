import { isObjectType } from 'graphql';
import { analyzeForN1 } from '../detector/analyzer.js';
import { ResponseCache } from '../cache/store.js';
import { normalizeResponse } from '../cache/normalizer.js';
import { getMutationTypes } from '../cache/invalidator.js';
import type { WatchdogConfig, N1Detection, ResolverCall } from '../types/index.js';
import type { GraphQLSchema, DocumentNode } from 'graphql';

export interface WatchdogYogaPluginOptions extends WatchdogConfig {
  onDetection?: (detections: N1Detection[]) => void;
}

export interface WatchdogPluginResult {
  n1Detections: N1Detection[];
}

// Track which schemas have already been instrumented to avoid double-wrapping
const instrumentedSchemas = new WeakSet<GraphQLSchema>();

/**
 * Walk the schema's types and wrap every custom resolver so it records
 * calls to `context._watchdogCalls` (set per-request in onExecute).
 */
const instrumentSchemaResolvers = (schema: GraphQLSchema): void => {
  if (instrumentedSchemas.has(schema)) {
    return;
  }
  instrumentedSchemas.add(schema);

  const typeMap = schema.getTypeMap();
  for (const [typeName, type] of Object.entries(typeMap)) {
    if (typeName.startsWith('__') || !isObjectType(type)) {
      continue;
    }
    const fields = type.getFields();
    for (const [fieldName, field] of Object.entries(fields)) {
      const originalResolve = field.resolve;
      if (originalResolve) {
        // eslint-disable-next-line @typescript-eslint/max-params -- GraphQL resolver signatures have four positional parameters.
        field.resolve = async (source, resolverArguments, context, info) => {
          const calls: ResolverCall[] | undefined = context?._watchdogCalls;
          if (!calls) {
            return originalResolve(source, resolverArguments, context, info);
          }

          const parentId = source
            ? String(
                (source as Record<string, unknown>).id ??
                  (source as Record<string, unknown>)._id ??
                  null,
              )
            : null;
          const batchKey = `${typeName}.${fieldName}`;
          const timestamp = Date.now();
          const startTime = performance.now();

          try {
            return await originalResolve(source, resolverArguments, context, info);
          } finally {
            calls.push({
              batchKey,
              duration: performance.now() - startTime,
              fieldName,
              parentId,
              timestamp,
              typeName,
            });
          }
        };
      }
    }
  }
};

export const useWatchdog = (config?: WatchdogYogaPluginOptions) => {
  const cache = config?.enableCache ? new ResponseCache(config.cache) : null;

  return {
    getCache: (): ResponseCache | null => cache,
    onExecute({
      args,
    }: {
      args: {
        schema: GraphQLSchema;
        document: DocumentNode;
        contextValue?: Record<string, unknown>;
        operationName?: string | null;
        variableValues?: Record<string, unknown> | null;
      };
    }) {
      // Instrument schema resolvers on first use
      if (config?.enableDetector !== false) {
        instrumentSchemaResolvers(args.schema);
        // Store per-request call tracking in context
        if (args.contextValue) {
          args.contextValue._watchdogCalls = [];
        }
      }

      const startTime = Date.now();

      return {
        onExecuteDone({
          result,
        }: {
          result: { data?: Record<string, unknown> | null; errors?: unknown[] };
        }) {
          const duration = Date.now() - startTime;
          const calls = (args.contextValue?._watchdogCalls ?? []) as ResolverCall[];

          // Analyze for N+1
          let n1Detections: N1Detection[] = [];
          if (config?.enableDetector !== false) {
            n1Detections = analyzeForN1(calls);

            if (n1Detections.length > 0) {
              if (config?.onDetection) {
                config.onDetection(n1Detections);
              } else {
                for (const detection of n1Detections) {
                  console.warn(
                    `[graphql-watchdog] N+1 detected: ${detection.field} (${detection.callCount} calls) — ${detection.suggestion}`,
                  );
                }
              }
            }
          }

          // Handle caching
          if (cache && result.data && !result.errors?.length) {
            const operationName = args.operationName ?? null;
            const variables = args.variableValues ?? undefined;
            const { entities, cacheKey } = normalizeResponse(
              result.data,
              operationName,
              variables ?? undefined,
            );
            cache.set(cacheKey, result.data, entities);

            // Invalidate cache on mutations
            const mutationTypes = getMutationTypes(args.document, args.schema);
            for (const typeName of mutationTypes) {
              cache.invalidateByType(typeName);
            }
          }

          return { duration, n1Detections };
        },
      };
    },
  };
};
