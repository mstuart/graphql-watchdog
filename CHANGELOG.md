# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-15

### Added

- N+1 query detection via resolver instrumentation with DataLoader suggestions
- AST-based query cost analysis with configurable field costs and list multipliers
- Query optimization suggestions (pagination, fragments, DataLoader, depth reduction)
- Dynamic cost tracking from actual resolver performance data
- Normalized response cache with LRU eviction, TTL, and type/entity-based invalidation
- Pluggable cache backends: in-memory, Redis, and Cloudflare KV
- Plugins for GraphQL Yoga and Apollo Server with automatic N+1 detection
- Performance dashboard with score gauges and trend tracking
- Report generation in terminal and JSON formats
- CI benchmark command with p50/p95/p99 tracking and regression detection
- CLI commands: `analyze` and `benchmark`
- Dual ESM/CJS output with full TypeScript declarations
