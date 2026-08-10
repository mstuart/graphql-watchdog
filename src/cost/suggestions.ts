import {
  visit,
  Kind,
  TypeInfo,
  visitWithTypeInfo,
  isListType,
  isNonNullType,
  isObjectType,
} from 'graphql';
import type { DocumentNode, GraphQLSchema, GraphQLOutputType } from 'graphql';
import type { CostBreakdown } from './analyzer.js';
import type { CostConfig } from '../types/index.js';

export interface OptimizationSuggestion {
  type: (typeof SUGGESTION_TYPES)[keyof typeof SUGGESTION_TYPES];
  severity: 'high' | 'medium' | 'low';
  field: string;
  message: string;
  estimatedSaving: number;
}

const SUGGESTION_TYPES = {
  dataloader: 'dataloader',
  depthReduction: 'depth-reduction',
  fieldPruning: 'field-pruning',
  fragment: 'fragment',
  pagination: 'pagination',
} as const;

const isListLikeType = (type: GraphQLOutputType): boolean => {
  if (isListType(type)) {
    return true;
  }
  if (isNonNullType(type)) {
    return isListLikeType(type.ofType);
  }
  return false;
};

const unwrapType = (type: GraphQLOutputType): GraphQLOutputType => {
  if (isNonNullType(type) || isListType(type)) {
    return unwrapType(type.ofType);
  }
  return type;
};

const getMaxDepth = (node: DocumentNode): number => {
  let maxDepth = 0;
  let currentDepth = 0;

  visit(node, {
    Field: {
      enter() {
        currentDepth += 1;
        if (currentDepth > maxDepth) {
          maxDepth = currentDepth;
        }
      },
      leave() {
        currentDepth -= 1;
      },
    },
  });

  return maxDepth;
};

interface SelectionFingerprint {
  fieldNames: string;
  path: string;
}

const getSelectionFingerprints = (document: DocumentNode): SelectionFingerprint[] => {
  const fingerprints: SelectionFingerprint[] = [];
  const pathStack: string[] = [];

  visit(document, {
    Field: {
      enter(node) {
        pathStack.push(node.name.value);

        if (node.selectionSet && node.selectionSet.selections.length > 0) {
          const selectedFieldNames = node.selectionSet.selections
            .filter((s) => s.kind === Kind.FIELD)
            .map((s) => (s as { name: { value: string } }).name.value);
          selectedFieldNames.sort((left, right) => left.localeCompare(right));
          const fieldNames = selectedFieldNames.join(',');

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
};

export const suggestOptimizations = (
  breakdown: CostBreakdown,
  document: DocumentNode,
  schema: GraphQLSchema,
  config?: CostConfig,
  // eslint-disable-next-line @typescript-eslint/max-params -- Optimization suggestions accept the established public API arguments.
): OptimizationSuggestion[] => {
  const suggestions: OptimizationSuggestion[] = [];
  const defaultListMultiplier = config?.defaultListMultiplier ?? 10;

  // 1. PAGINATION: If a list field has no first/limit arg and high multiplier
  const typeInfo = new TypeInfo(schema);
  visit(
    document,
    visitWithTypeInfo(typeInfo, {
      // eslint-disable-next-line sonarjs/function-name -- GraphQL visitor keys use AST node names.
      Field: (node) => {
        const fieldDefinition = typeInfo.getFieldDef();
        if (!fieldDefinition) {
          return;
        }

        if (isListLikeType(fieldDefinition.type)) {
          const hasPaginationArgument = node.arguments?.some((argument) =>
            ['first', 'limit', 'last', 'take'].includes(argument.name.value),
          );

          if (!hasPaginationArgument) {
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
              estimatedSaving,
              field: fieldPath,
              message: `Add \`first: N\` argument to ${fieldPath} to limit results and reduce cost`,
              severity: 'high',
              type: SUGGESTION_TYPES.pagination,
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
          estimatedSaving: fc.cost * 0.3,
          field: fc.path,
          message: `Field ${fc.path} contributes ${(contribution * 100).toFixed(0)}% of query cost (${fc.cost}/${breakdown.totalCost}). Consider removing or simplifying`,
          severity: 'medium',
          type: SUGGESTION_TYPES.fieldPruning,
        });
      }
    }
  }

  // 3. DEPTH REDUCTION: If query depth exceeds 5 levels
  const depth = getMaxDepth(document);
  if (depth > 5) {
    suggestions.push({
      estimatedSaving: breakdown.totalCost * 0.2,
      field: '<root>',
      message: `Query depth is ${depth} levels; consider splitting into separate queries or reducing nesting`,
      severity: depth > 8 ? 'high' : 'medium',
      type: SUGGESTION_TYPES.depthReduction,
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
    if (paths.length < 2) {
      continue;
    }

    const fields = fieldNames.replaceAll(',', ', ');
    suggestions.push({
      estimatedSaving: breakdown.totalCost * 0.05,
      field: paths[0],
      message: `Selection set (${fields}) appears ${paths.length} times at ${paths.join(', ')}; use a fragment to reduce duplication`,
      severity: 'low',
      type: SUGGESTION_TYPES.fragment,
    });
  }

  // 5. DATALOADER: Look for fields that appear under list parents (potential N+1)
  const typeInfo2 = new TypeInfo(schema);
  const listParentStack: boolean[] = [false];

  visit(
    document,
    visitWithTypeInfo(typeInfo2, {
      Field: {
        enter(node) {
          const fieldDefinition = typeInfo2.getFieldDef();
          const isUnderList = listParentStack.at(-1) ?? false;

          if (fieldDefinition && isUnderList && isObjectType(unwrapType(fieldDefinition.type))) {
            const parentType = typeInfo2.getParentType();
            const fieldPath = parentType
              ? `${parentType.name}.${node.name.value}`
              : node.name.value;

            suggestions.push({
              estimatedSaving: breakdown.totalCost * 0.3,
              field: fieldPath,
              message: `${fieldPath} resolves an object under a list parent, likely causing N+1 queries. Use DataLoader for batching`,
              severity: 'high',
              type: SUGGESTION_TYPES.dataloader,
            });
          }

          const isList = fieldDefinition ? isListLikeType(fieldDefinition.type) : false;
          listParentStack.push(isList || isUnderList);
        },
        leave() {
          listParentStack.pop();
        },
      },
    }),
  );

  // Sort by estimated saving descending
  // eslint-disable-next-line unicorn/no-array-sort -- The project targets the ES2022 TypeScript library.
  return suggestions.sort((a, b) => b.estimatedSaving - a.estimatedSaving);
};
