// graphql-watchdog - GraphQL performance toolkit
// N+1 detection, normalized caching, cost analysis, and CI regression testing

export { ResolverInstrumenter } from './detector/index.js';
export { analyzeForN1 } from './detector/analyzer.js';
export { analyzeCost, costLimitRule } from './cost/index.js';
export type { CostBreakdown } from './cost/index.js';
export { ResponseCache } from './cache/index.js';
export { normalizeResponse, generateCacheKey } from './cache/normalizer.js';
export type { NormalizedEntity } from './cache/normalizer.js';
export { getMutationTypes } from './cache/invalidator.js';
export { useWatchdog } from './plugins/yoga.js';
export { watchdogApolloPlugin } from './plugins/apollo.js';
export { generateReport } from './reporter/index.js';
export type { ReportFormat } from './reporter/index.js';
export type {
  WatchdogConfig,
  CostConfig,
  CacheConfig,
  N1Detection,
  PerformanceReport,
  CacheStats,
  ResolverCall,
  OperationReport,
} from './types/index.js';
