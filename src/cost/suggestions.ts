import {
  type DocumentNode,
  type GraphQLSchema,
  type GraphQLOutputType,
  visit,
  Kind,
  TypeInfo,
  visitWithTypeInfo,
  isListType,
  isNonNullType,
  isObjectType,
} from 'graphql';
import type { CostBreakdown } from './analyzer.js';
import type { CostConfig } from '../types/index.js';

export interface OptimizationSuggestion {
  type: 'pagination' | 'field-pruning' | 'fragment' | 'dataloader' | 'depth-reduction';
  severity: 'high' | 'medium' | 'low';
  field: string;
  message: string;
  estimatedSaving: number;
}

function isListLikeType(type: GraphQLOutputType): boolean {
  if (isListType(type)) return true;
  if (isNonNullType(type)) return isListLikeType(type.ofType);
  return false;
}

function unwrapType(type: GraphQLOutputType): GraphQLOutputType {
  if (isNonNullType(type) || isListType(type)) {
    return unwrapType(type.ofType);
  }
  return type;
}

function getMaxDepth(node: DocumentNode): number {
  let maxDepth = 0;
  let currentDepth = 0;

  visit(node, {
    Field: {
      enter() {
        currentDepth++;
        if (currentDepth > maxDepth) maxDepth = currentDepth;
      },
      leave() {
        currentDepth--;
      },
    },
  });

  return maxDepth;
}

interface SelectionFingerprint {
  fieldNames: string;
  path: string;
}

function getSelectionFingerprints(document: DocumentNode): SelectionFingerprint[] {
  const fingerprints: SelectionFingerprint[] = [];
  const pathStack: string[] = [];

  visit(document, {
    Field: {
      enter(node) {
        pathStack.push(node.name.value);

        if (node.selectionSet && node.selectionSet.selections.length > 0) {
          const fieldNames = node.selectionSet.selections
            .filter((s) => s.kind === Kind.FIELD)
            .map((s) => (s as { name: { value: string } }).name.value)
            .sort()
            .join(',');

          if (fieldNames) {
            fingerprints.push({
              fieldNames,
              path: pathStack.join('.'),
            });
          }
        }
      },
      leave() {
        pathStack.pop();
      },
    },
  });

  return fingerprints;
}

export function suggestOptimizations(
  breakdown: CostBreakdown,
  document: DocumentNode,
  schema: GraphQLSchema,
  config?: CostConfig,
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];
  const defaultListMultiplier = config?.defaultListMultiplier ?? 10;

  // 1. PAGINATION: If a list field has no first/limit arg and high multiplier
  const typeInfo = new TypeInfo(schema);
  visit(
    document,
    visitWithTypeInfo(typeInfo, {
      Field(node) {
        const fieldDef = typeInfo.getFieldDef();
        if (!fieldDef) return;

        if (isListLikeType(fieldDef.type)) {
          const hasPaginationArg = node.arguments?.some((arg) =>
            ['first', 'limit', 'last', 'take'].includes(arg.name.value),
          );

          if (!hasPaginationArg) {
            const parentType = typeInfo.getParentType();
            const fieldPath = parentType
              ? `${parentType.name}.${node.name.value}`
              : node.name.value;

            // Estimate saving: defaultListMultiplier contributes to unbounded results
            const fieldCostEntry = breakdown.fieldCosts.find((fc) =>
              fc.path.endsWith(node.name.value),
            );
            const estimatedSaving = fieldCostEntry
              ? fieldCostEntry.cost * 0.5
              : defaultListMultiplier;

            suggestions.push({
              type: 'pagination',
              severity: 'high',
              field: fieldPath,
              message: `Add \`first: N\` argument to ${fieldPath} to limit results and reduce cost`,
              estimatedSaving,
            });
          }
        }
      },
    }),
  );

  // 2. FIELD PRUNING: If a field contributes >30% of total cost
  if (breakdown.totalCost > 0) {
    for (const fc of breakdown.fieldCosts) {
      const contribution = fc.cost / breakdown.totalCost;
      if (contribution > 0.3 && fc.path.split('.').length >= 3) {
        suggestions.push({
          type: 'field-pruning',
          severity: 'medium',
          field: fc.path,
          message: `Field ${fc.path} contributes ${(contribution * 100).toFixed(0)}% of query cost (${fc.cost}/${breakdown.totalCost}). Consider removing or simplifying`,
          estimatedSaving: fc.cost * 0.3,
        });
      }
    }
  }

  // 3. DEPTH REDUCTION: If query depth exceeds 5 levels
  const depth = getMaxDepth(document);
  if (depth > 5) {
    suggestions.push({
      type: 'depth-reduction',
      severity: depth > 8 ? 'high' : 'medium',
      field: '<root>',
      message: `Query depth is ${depth} levels; consider splitting into separate queries or reducing nesting`,
      estimatedSaving: breakdown.totalCost * 0.2,
    });
  }

  // 4. FRAGMENT: If the same selection set appears multiple times
  const fingerprints = getSelectionFingerprints(document);
  const seen = new Map<string, string[]>();
  for (const fp of fingerprints) {
    const existing = seen.get(fp.fieldNames) ?? [];
    existing.push(fp.path);
    seen.set(fp.fieldNames, existing);
  }
  for (const [fieldNames, paths] of seen) {
    if (paths.length >= 2) {
      const fields = fieldNames.split(',').join(', ');
      suggestions.push({
        type: 'fragment',
        severity: 'low',
        field: paths[0],
        message: `Selection set (${fields}) appears ${paths.length} times at ${paths.join(', ')}; use a fragment to reduce duplication`,
        estimatedSaving: breakdown.totalCost * 0.05,
      });
    }
  }

  // 5. DATALOADER: Look for fields that appear under list parents (potential N+1)
  const typeInfo2 = new TypeInfo(schema);
  const listParentStack: boolean[] = [false];

  visit(
    document,
    visitWithTypeInfo(typeInfo2, {
      Field: {
        enter(node) {
          const fieldDef = typeInfo2.getFieldDef();
          const isUnderList = listParentStack[listParentStack.length - 1];

          if (fieldDef && isUnderList && isObjectType(unwrapType(fieldDef.type))) {
            const parentType = typeInfo2.getParentType();
            const fieldPath = parentType
              ? `${parentType.name}.${node.name.value}`
              : node.name.value;

            suggestions.push({
              type: 'dataloader',
              severity: 'high',
              field: fieldPath,
              message: `${fieldPath} resolves an object under a list parent, likely causing N+1 queries. Use DataLoader for batching`,
              estimatedSaving: breakdown.totalCost * 0.3,
            });
          }

          const isList = fieldDef ? isListLikeType(fieldDef.type) : false;
          listParentStack.push(isList || isUnderList);
        },
        leave() {
          listParentStack.pop();
        },
      },
    }),
  );

  // Sort by estimated saving descending
  suggestions.sort((a, b) => b.estimatedSaving - a.estimatedSaving);

  return suggestions;
}
