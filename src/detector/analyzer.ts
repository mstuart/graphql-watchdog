import type { ResolverCall, N1Detection } from '../types/index.js';

export function analyzeForN1(calls: ResolverCall[], threshold = 3): N1Detection[] {
  // Group calls by batchKey
  const groups = new Map<string, ResolverCall[]>();

  for (const call of calls) {
    const existing = groups.get(call.batchKey) ?? [];
    existing.push(call);
    groups.set(call.batchKey, existing);
  }

  const detections: N1Detection[] = [];

  for (const [batchKey, groupCalls] of groups) {
    if (groupCalls.length >= threshold) {
      // Find the likely parent field by looking at other calls that happened before
      // and had only 1 call (the "1" in N+1)
      const parentField = findParentField(batchKey, calls, groups);
      const [typeName, fieldName] = batchKey.split('.');

      const severity: 'critical' | 'warning' = groupCalls.length >= 10 ? 'critical' : 'warning';

      const suggestion = `const ${fieldName}Loader = new DataLoader(async (ids) => { /* batch load ${typeName} by ids */ });`;

      detections.push({
        field: batchKey,
        parentField,
        callCount: groupCalls.length,
        suggestion,
        severity,
      });
    }
  }

  // Sort by callCount descending
  detections.sort((a, b) => b.callCount - a.callCount);

  return detections;
}

function findParentField(
  batchKey: string,
  allCalls: ResolverCall[],
  groups: Map<string, ResolverCall[]>,
): string {
  const targetCalls = groups.get(batchKey) ?? [];
  if (targetCalls.length === 0) return 'unknown';

  const firstTargetTimestamp = Math.min(...targetCalls.map((c) => c.timestamp));

  // Find calls that happened before the N+1 calls and are likely the parent query
  // The parent is typically a list-returning field that triggered the repeated calls
  let bestCandidate = 'unknown';
  let bestTimestamp = -Infinity;

  for (const [key, keyCalls] of groups) {
    if (key === batchKey) continue;
    // The parent field should have fewer calls and happened before
    if (keyCalls.length < targetCalls.length) {
      const maxTimestamp = Math.max(...keyCalls.map((c) => c.timestamp));
      if (maxTimestamp <= firstTargetTimestamp && maxTimestamp > bestTimestamp) {
        bestTimestamp = maxTimestamp;
        bestCandidate = key;
      }
    }
  }

  return bestCandidate;
}
