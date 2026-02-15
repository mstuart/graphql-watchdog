export interface ResolverCall {
  fieldName: string;
  typeName: string;
  parentId: string | null;
  timestamp: number;
  duration: number;
  batchKey: string; // typeName.fieldName
}

export interface N1Detection {
  field: string; // e.g., "Post.author"
  parentField: string; // e.g., "Query.posts"
  callCount: number;
  suggestion: string; // DataLoader suggestion code
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
  defaultFieldCost?: number; // default 1
  defaultListMultiplier?: number; // default 10
  costMap?: Record<string, number>;
  maxCost?: number;
}

export interface WatchdogConfig {
  enableDetector?: boolean; // default true
  enableCost?: boolean; // default true
  enableCache?: boolean; // default false
  cost?: CostConfig;
  cache?: CacheConfig;
}

export interface CacheConfig {
  maxSize?: number; // default 1000
  ttl?: number; // ms, default 60000
  invalidateOnMutation?: boolean; // default true
}
