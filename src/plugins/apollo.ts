import type { WatchdogConfig, N1Detection } from '../types/index.js';
import { ResolverInstrumenter } from '../detector/instrumenter.js';
import { analyzeForN1 } from '../detector/analyzer.js';
import { ResponseCache } from '../cache/store.js';
import type { GraphQLSchema } from 'graphql';

export interface ApolloWatchdogContext {
  _watchdogInstrumenter?: ResolverInstrumenter;
  _watchdogStartTime?: number;
}

export interface WatchdogApolloPluginOptions extends WatchdogConfig {
  onDetection?: (detections: N1Detection[]) => void;
}

export function watchdogApolloPlugin(config?: WatchdogApolloPluginOptions) {
  const cache = config?.enableCache ? new ResponseCache(config.cache) : null;

  return {
    async requestDidStart({ schema: _schema }: { schema?: GraphQLSchema } = {}) {
      const instrumenter = new ResolverInstrumenter();

      return {
        async executionDidStart() {
          return {
            willResolveField({ info }: { info: { fieldName: string; parentType: { name: string }; path: { key: string | number } } }) {
              const fieldStartTime = performance.now();
              return (_error: unknown, _result: unknown) => {
                const duration = performance.now() - fieldStartTime;
                // Record the resolver call manually since we can't wrap resolvers in Apollo
                instrumenter['calls'].push({
                  fieldName: info.fieldName,
                  typeName: info.parentType.name,
                  parentId: null,
                  timestamp: Date.now(),
                  duration,
                  batchKey: `${info.parentType.name}.${info.fieldName}`,
                });
              };
            },
          };
        },

        async willSendResponse({ response: _response }: { response: { body?: { singleResult?: { data?: Record<string, unknown>; errors?: unknown[] } } } }) {
          const calls = instrumenter.getCalls();

          // Analyze for N+1
          if (config?.enableDetector !== false) {
            const n1Detections = analyzeForN1(calls);

            if (n1Detections.length > 0) {
              if (config?.onDetection) {
                config.onDetection(n1Detections);
              } else {
                for (const detection of n1Detections) {
                  console.warn(
                    `[graphql-watchdog] N+1 detected: ${detection.field} (${detection.callCount} calls)`,
                  );
                }
              }
            }
          }
        },
      };
    },

    getCache(): ResponseCache | null {
      return cache;
    },
  };
}
