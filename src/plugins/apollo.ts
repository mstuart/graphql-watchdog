import { ResolverInstrumenter } from '../detector/instrumenter.js';
import { analyzeForN1 } from '../detector/analyzer.js';
import { ResponseCache } from '../cache/store.js';
import type { WatchdogConfig, N1Detection } from '../types/index.js';

export interface ApolloWatchdogContext {
  _watchdogInstrumenter?: ResolverInstrumenter;
  _watchdogStartTime?: number;
}

export interface WatchdogApolloPluginOptions extends WatchdogConfig {
  onDetection?: (detections: N1Detection[]) => void;
}

interface ApolloFieldInfo {
  fieldName: string;
  parentType: { name: string };
  path: { key: string | number };
}

const createFieldCompletion =
  (
    instrumenter: ResolverInstrumenter,
    info: ApolloFieldInfo,
    fieldStartTime: number,
  ): (() => void) =>
  () => {
    // eslint-disable-next-line compat/compat -- This package targets Node.js 22.
    const duration = performance.now() - fieldStartTime;
    instrumenter.recordCall({
      batchKey: `${info.parentType.name}.${info.fieldName}`,
      duration,
      fieldName: info.fieldName,
      parentId: null,
      timestamp: Date.now(),
      typeName: info.parentType.name,
    });
  };

export const watchdogApolloPlugin = (config?: WatchdogApolloPluginOptions) => {
  const cache = config?.enableCache ? new ResponseCache(config.cache) : null;

  return {
    getCache: (): ResponseCache | null => cache,
    async requestDidStart() {
      const instrumenter = new ResolverInstrumenter();

      return {
        executionDidStart: async () => ({
          willResolveField: ({ info }: { info: ApolloFieldInfo }) => {
            // eslint-disable-next-line compat/compat -- This package targets Node.js 22.
            const fieldStartTime = performance.now();
            return createFieldCompletion(instrumenter, info, fieldStartTime);
          },
        }),

        async willSendResponse() {
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
  };
};
