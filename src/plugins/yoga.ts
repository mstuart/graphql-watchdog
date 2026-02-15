import type { WatchdogConfig, N1Detection, ResolverCall } from '../types/index.js';
import { analyzeForN1 } from '../detector/analyzer.js';
import { ResponseCache } from '../cache/store.js';
import { normalizeResponse } from '../cache/normalizer.js';
import { getMutationTypes } from '../cache/invalidator.js';
import { isObjectType } from 'graphql';
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
function instrumentSchemaResolvers(schema: GraphQLSchema): void {
  if (instrumentedSchemas.has(schema)) return;
  instrumentedSchemas.add(schema);

  const typeMap = schema.getTypeMap();
  for (const typeName of Object.keys(typeMap)) {
    if (typeName.startsWith('__')) continue;
    const type = typeMap[typeName];
    if (!isObjectType(type)) continue;

    const fields = type.getFields();
    for (const fieldName of Object.keys(fields)) {
      const field = fields[fieldName];
      const originalResolve = field.resolve;
      if (!originalResolve) continue;

      field.resolve = (source, args, context, info) => {
        const calls: ResolverCall[] | undefined = context?._watchdogCalls;
        if (!calls) {
          return originalResolve(source, args, context, info);
        }

        const parentId = source
          ? String((source as Record<string, unknown>).id ?? (source as Record<string, unknown>)._id ?? null)
          : null;
        const batchKey = `${typeName}.${fieldName}`;
        const timestamp = Date.now();
        const startTime = performance.now();

        try {
          const result = originalResolve(source, args, context, info);

          // Handle async resolvers
          if (result && typeof (result as { then?: unknown }).then === 'function') {
            return (result as Promise<unknown>).then(
              (value) => {
                calls.push({ fieldName, typeName, parentId, timestamp, duration: performance.now() - startTime, batchKey });
                return value;
              },
              (error) => {
                calls.push({ fieldName, typeName, parentId, timestamp, duration: performance.now() - startTime, batchKey });
                throw error;
              },
            );
          }

          calls.push({ fieldName, typeName, parentId, timestamp, duration: performance.now() - startTime, batchKey });
          return result;
        } catch (error) {
          calls.push({ fieldName, typeName, parentId, timestamp, duration: performance.now() - startTime, batchKey });
          throw error;
        }
      };
    }
  }
}

export function useWatchdog(config?: WatchdogYogaPluginOptions) {
  const cache = config?.enableCache ? new ResponseCache(config.cache) : null;

  return {
    onExecute({ args }: { args: { schema: GraphQLSchema; document: DocumentNode; contextValue?: Record<string, unknown>; operationName?: string | null; variableValues?: Record<string, unknown> | null } }) {
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
        onExecuteDone({ result }: { result: { data?: Record<string, unknown> | null; errors?: unknown[] } }) {
          const duration = Date.now() - startTime;
          const calls = ((args.contextValue?._watchdogCalls ?? []) as ResolverCall[]);

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

          return { n1Detections, duration };
        },
      };
    },

    getCache(): ResponseCache | null {
      return cache;
    },
  };
}
