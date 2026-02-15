# graphql-watchdog

[![CI](https://github.com/mstuart/graphql-watchdog/actions/workflows/ci.yml/badge.svg)](https://github.com/mstuart/graphql-watchdog/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/graphql-watchdog)](https://www.npmjs.com/package/graphql-watchdog)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

GraphQL performance toolkit -- N+1 detection, normalized caching, cost analysis, and CI regression testing.

## Features

- **N+1 Query Detection** -- Automatically detects N+1 patterns in resolver execution and suggests DataLoader fixes
- **Query Cost Analysis** -- AST-based cost calculation with configurable field costs, list multipliers, and hard limits
- **Normalized Response Cache** -- Entity-level caching with LRU eviction, TTL expiration, and type/entity-based invalidation
- **Server Plugins** -- Drop-in plugins for GraphQL Yoga and Apollo Server
- **CLI Tooling** -- Static analysis and benchmarking commands for CI/CD pipelines
- **CI Regression Testing** -- Benchmark operations against endpoints with p50/p95/p99 tracking and regression detection

## Quick Start

```bash
npm install graphql-watchdog graphql
```

### With GraphQL Yoga

```typescript
import { createYoga, createSchema } from 'graphql-yoga';
import { useWatchdog } from 'graphql-watchdog';

const yoga = createYoga({
  schema: createSchema({ /* your schema */ }),
  plugins: [
    useWatchdog({
      enableDetector: true,
      enableCost: true,
      cost: {
        maxCost: 1000,
        defaultListMultiplier: 10,
      },
      enableCache: true,
      cache: {
        maxSize: 500,
        ttl: 60000,
      },
    }),
  ],
});
```

### With Apollo Server

```typescript
import { ApolloServer } from '@apollo/server';
import { watchdogApolloPlugin } from 'graphql-watchdog';

const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [
    watchdogApolloPlugin({
      enableDetector: true,
      onDetection: (detections) => {
        detections.forEach((d) => {
          console.warn(`N+1 detected: ${d.field} (${d.callCount} calls)`);
        });
      },
    }),
  ],
});
```

## Usage

### N+1 Detection

The detector instruments resolver functions to track execution patterns and identify N+1 queries:

```typescript
import { ResolverInstrumenter, analyzeForN1 } from 'graphql-watchdog';

const instrumenter = new ResolverInstrumenter();
const instrumented = instrumenter.instrumentResolvers(resolvers);

// ... execute GraphQL operations using instrumented resolvers ...

const detections = analyzeForN1(instrumenter.getCalls());
// [{ field: 'Post.author', callCount: 10, severity: 'critical', suggestion: '...' }]
```

### Cost Analysis

Analyze query cost statically from the AST:

```typescript
import { analyzeCost, costLimitRule } from 'graphql-watchdog';
import { parse, validate } from 'graphql';

const query = parse(`
  query {
    posts(first: 20) {
      title
      author { name }
      comments(first: 10) { text }
    }
  }
`);

const breakdown = analyzeCost(query, schema, {
  maxCost: 500,
  defaultListMultiplier: 10,
  costMap: {
    'Query.posts': 2,
    'Post.comments': 5,
  },
});

console.log(breakdown.totalCost);  // calculated cost
console.log(breakdown.exceeds);     // true if over maxCost

// Or use as a validation rule
const errors = validate(schema, query, [costLimitRule(schema, { maxCost: 500 })]);
```

### Response Cache

Normalized caching with automatic invalidation:

```typescript
import { ResponseCache, normalizeResponse, getMutationTypes } from 'graphql-watchdog';

const cache = new ResponseCache({
  maxSize: 1000,
  ttl: 60000, // 1 minute
});

// Cache a response
const { entities, cacheKey } = normalizeResponse(data, 'GetPosts', variables);
cache.set(cacheKey, data, entities);

// Retrieve from cache
const cached = cache.get(cacheKey);

// Invalidate after mutations
const affectedTypes = getMutationTypes(mutationDocument, schema);
affectedTypes.forEach((type) => cache.invalidateByType(type));

// Check stats
const stats = cache.getStats();
// { hits: 50, misses: 10, hitRate: 0.833, entries: 25 }
```

### Reporting

Generate performance reports in terminal or JSON format:

```typescript
import { generateReport } from 'graphql-watchdog';

const report = generateReport(performanceReport, 'terminal'); // colored terminal output
const json = generateReport(performanceReport, 'json');        // machine-readable JSON
```

## CLI

### Analyze

Run static cost analysis on GraphQL operations:

```bash
graphql-watchdog analyze --schema schema.graphql --operations "queries/**/*.graphql" --max-cost 500
```

Options:
- `--schema <path>` -- Path to GraphQL schema SDL file (required)
- `--operations <glob>` -- Glob pattern for .graphql operation files (required)
- `--max-cost <number>` -- Maximum allowed query cost
- `--default-list-multiplier <number>` -- Default multiplier for list fields
- `--format <terminal|json>` -- Output format (default: terminal)

### Benchmark

Benchmark GraphQL operations with regression detection:

```bash
# Run benchmarks
graphql-watchdog benchmark \
  --endpoint http://localhost:4000/graphql \
  --operations "queries/**/*.graphql" \
  --iterations 50 \
  --output baseline.json

# Compare against baseline (exits 1 on regression)
graphql-watchdog benchmark \
  --endpoint http://localhost:4000/graphql \
  --operations "queries/**/*.graphql" \
  --baseline baseline.json \
  --threshold 20
```

Options:
- `--endpoint <url>` -- GraphQL endpoint URL (required)
- `--operations <glob>` -- Glob pattern for .graphql files (required)
- `--baseline <file>` -- Baseline JSON for regression comparison
- `--iterations <n>` -- Iterations per operation (default: 10)
- `--output <file>` -- Save results to JSON file
- `--threshold <percent>` -- Regression threshold % (default: 20)

## Configuration Reference

### WatchdogConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableDetector` | `boolean` | `true` | Enable N+1 detection |
| `enableCost` | `boolean` | `true` | Enable cost analysis |
| `enableCache` | `boolean` | `false` | Enable response caching |
| `cost` | `CostConfig` | `{}` | Cost analysis configuration |
| `cache` | `CacheConfig` | `{}` | Cache configuration |

### CostConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultFieldCost` | `number` | `1` | Default cost per field |
| `defaultListMultiplier` | `number` | `10` | Default multiplier for list fields |
| `costMap` | `Record<string, number>` | `{}` | Custom costs by `TypeName.fieldName` |
| `maxCost` | `number` | `Infinity` | Maximum allowed query cost |

### CacheConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxSize` | `number` | `1000` | Maximum cache entries |
| `ttl` | `number` | `60000` | Time-to-live in milliseconds |
| `invalidateOnMutation` | `boolean` | `true` | Auto-invalidate on mutations |

## API Reference

### Detection

- `ResolverInstrumenter` -- Wraps resolvers to track execution
  - `.instrumentResolvers(resolvers)` -- Returns instrumented resolver map
  - `.getCalls()` -- Returns recorded resolver calls
  - `.reset()` -- Clears recorded calls
- `analyzeForN1(calls, threshold?)` -- Analyzes calls for N+1 patterns

### Cost

- `analyzeCost(document, schema, config?, variables?)` -- Returns cost breakdown
- `costLimitRule(schema, config)` -- GraphQL validation rule for cost limits

### Cache

- `ResponseCache` -- LRU cache with TTL and entity normalization
  - `.set(key, data, entities)` -- Store response
  - `.get(key)` -- Retrieve response (null if expired/missing)
  - `.invalidateByType(typename)` -- Invalidate by type name
  - `.invalidateByEntity(typename, id)` -- Invalidate by specific entity
  - `.getStats()` -- Get hit/miss statistics
  - `.clear()` -- Clear all entries
- `normalizeResponse(data, operationName, variables?)` -- Normalize response data
- `getMutationTypes(document, schema)` -- Extract mutation return types

### Plugins

- `useWatchdog(config?)` -- GraphQL Yoga plugin
- `watchdogApolloPlugin(config?)` -- Apollo Server plugin

### Reporting

- `generateReport(report, format?)` -- Generate formatted report

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Run tests (`npm test`)
4. Commit your changes (`git commit -am 'Add my feature'`)
5. Push to the branch (`git push origin feature/my-feature`)
6. Open a Pull Request

## License

MIT
