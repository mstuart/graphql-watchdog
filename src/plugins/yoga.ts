import type { WatchdogConfig, N1Detection } from '../types/index.js';
import { ResolverInstrumenter } from '../detector/instrumenter.js';
import { analyzeForN1 } from '../detector/analyzer.js';
import { analyzeCost } from '../cost/analyzer.js';
import { ResponseCache } from '../cache/store.js';
import { normalizeResponse } from '../cache/normalizer.js';
import { getMutationTypes } from '../cache/invalidator.js';
import type { GraphQLSchema, DocumentNode } from 'graphql';

export interface WatchdogPluginResult {
  n1Detections: N1Detection[];
}

export function useWatchdog(config?: WatchdogConfig) {
  const cache = config?.enableCache ? new ResponseCache(config.cache) : null;

  return {
    onExecute({ args }: { args: { schema: GraphQLSchema; document: DocumentNode; operationName?: string | null; variableValues?: Record<string, unknown> | null } }) {
      const instrumenter = new ResolverInstrumenter();
      const startTime = Date.now();

      return {
        onExecuteDone({ result }: { result: { data?: Record<string, unknown> | null; errors?: unknown[] } }) {
          const duration = Date.now() - startTime;
          const calls = instrumenter.getCalls();

          // Analyze for N+1
          let n1Detections: N1Detection[] = [];
          if (config?.enableDetector !== false) {
            n1Detections = analyzeForN1(calls);

            if (n1Detections.length > 0) {
              for (const detection of n1Detections) {
                console.warn(
                  `[graphql-watchdog] N+1 detected: ${detection.field} (${detection.callCount} calls) — ${detection.suggestion}`,
                );
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

    onValidate({ addValidationRule }: { addValidationRule: (rule: unknown) => void }) {
      if (config?.enableCost !== false && config?.cost?.maxCost) {
        // Import dynamically to avoid circular issues
        const { costLimitRule } = require('../cost/rules.js');
        // Note: We'd need the schema here, which Yoga provides
        // This is a simplified version
      }
    },

    getCache(): ResponseCache | null {
      return cache;
    },
  };
}
