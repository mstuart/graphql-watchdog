import type { ResolverCall, N1Detection } from '../types/index.js';

export const analyzeForN1 = (calls: ResolverCall[], threshold = 3): N1Detection[] => {
  // Group calls by batchKey
  const groups = new Map<string, ResolverCall[]>();

  for (const call of calls) {
    const existing = groups.get(call.batchKey) ?? [];
    existing.push(call);
    groups.set(call.batchKey, existing);
  }

  const detections: N1Detection[] = [];

  for (const [batchKey, groupCalls] of groups) {
    if (groupCalls.length < threshold) {
      continue;
    }

    // Find the likely parent field by looking at other calls that happened before
    // and had only 1 call (the "1" in N+1)
    // eslint-disable-next-line @typescript-eslint/no-use-before-define -- The helper follows the exported analysis entry point.
    const parentField = findParentField(batchKey, calls, groups);
    const [typeName, fieldName] = batchKey.split('.', 2);

    const severity: 'critical' | 'warning' = groupCalls.length >= 10 ? 'critical' : 'warning';

    const suggestion = `const ${fieldName}Loader = new DataLoader(async (ids) => { /* batch load ${typeName} by ids */ });`;

    detections.push({
      callCount: groupCalls.length,
      field: batchKey,
      parentField,
      severity,
      suggestion,
    });
  }

  // Sort by callCount descending
  // eslint-disable-next-line unicorn/no-array-sort -- The project targets the ES2022 TypeScript library.
  return detections.sort((a, b) => b.callCount - a.callCount);
};

const findParentField = (
  batchKey: string,
  _allCalls: ResolverCall[],
  groups: Map<string, ResolverCall[]>,
): string => {
  const targetCalls = groups.get(batchKey) ?? [];
  if (targetCalls.length === 0) {
    return 'unknown';
  }

  const firstTargetTimestamp = Math.min(...targetCalls.map((c) => c.timestamp));

  // Find calls that happened before the N+1 calls and are likely the parent query
  // The parent is typically a list-returning field that triggered the repeated calls
  let bestCandidate = 'unknown';
  let bestTimestamp = -Infinity;

  for (const [key, keyCalls] of groups) {
    if (key === batchKey) {
      continue;
    }
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
};
