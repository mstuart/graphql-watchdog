import type { CacheBackend } from '../cache/backend.js';

export interface ResolverCall {
  fieldName: string;
  typeName: string;
  parentId: string | null;
  timestamp: number;
  duration: number;
  // typeName.fieldName
  batchKey: string;
}

export interface N1Detection {
  // e.g., "Post.author"
  field: string;
  // e.g., "Query.posts"
  parentField: string;
  callCount: number;
  // DataLoader suggestion code
  suggestion: string;
  severity: 'critical' | 'warning';
}

export interface PerformanceReport {
  timestamp: string;
  duration: number;
  operations: OperationReport[];
  n1Detections: N1Detection[];
  cacheStats?: CacheStats;
}

export interface OperationReport {
  operationName: string | null;
  duration: number;
  resolverCalls: number;
  costEstimate: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  entries: number;
}

export interface CostConfig {
  // default 1
  defaultFieldCost?: number;
  // default 10
  defaultListMultiplier?: number;
  costMap?: Record<string, number>;
  maxCost?: number;
}

export interface WatchdogConfig {
  // default true
  enableDetector?: boolean;
  // default true
  enableCost?: boolean;
  // default false
  enableCache?: boolean;
  cost?: CostConfig;
  cache?: CacheConfig;
  // enable dynamic cost tracking
  dynamicCost?: boolean;
  // ms per cost unit (default 10)
  dynamicCostBaseline?: number;
}

export interface CacheConfig {
  // default 1000
  maxSize?: number;
  // ms, default 60000
  ttl?: number;
  // default true
  invalidateOnMutation?: boolean;
  backend?: CacheBackend;
}
