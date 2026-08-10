import { visit, Kind, TypeInfo, visitWithTypeInfo, isListType, isNonNullType } from 'graphql';
import type { DocumentNode, GraphQLSchema, GraphQLOutputType } from 'graphql';
import type { CostConfig } from '../types/index.js';

export interface CostBreakdown {
  totalCost: number;
  fieldCosts: { path: string; cost: number }[];
  exceeds: boolean;
  limit: number;
}

const isListLikeType = (type: GraphQLOutputType): boolean => {
  if (isListType(type)) {
    return true;
  }
  if (isNonNullType(type)) {
    return isListLikeType(type.ofType);
  }
  return false;
};

export const analyzeCost = (
  document: DocumentNode,
  schema: GraphQLSchema,
  config: CostConfig = {},
  variables?: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/max-params -- Cost analysis accepts the established public API arguments.
): CostBreakdown => {
  const defaultFieldCost = config.defaultFieldCost ?? 1;
  const defaultListMultiplier = config.defaultListMultiplier ?? 10;
  const maxCost = config.maxCost ?? Infinity;
  const costMap = config.costMap ?? {};

  const fieldCosts: { path: string; cost: number }[] = [];
  const typeInfo = new TypeInfo(schema);

  // Stack to track multipliers at each nesting level
  const multiplierStack: number[] = [1];
  const pathStack: string[] = [];

  visit(
    document,
    visitWithTypeInfo(typeInfo, {
      Field: {
        // eslint-disable-next-line sonarjs/cognitive-complexity -- GraphQL cost traversal keeps multiplier and path state together.
        enter(node) {
          const fieldName = node.name.value;
          const parentType = typeInfo.getParentType();
          const fieldDefinition = typeInfo.getFieldDef();
          const typeName = parentType?.name ?? '';

          pathStack.push(fieldName);
          const path = pathStack.join('.');

          // Determine field cost from costMap or default
          const costKey = `${typeName}.${fieldName}`;
          const baseCost = costMap[costKey] ?? defaultFieldCost;

          // Get current multiplier from parent
          const currentMultiplier = multiplierStack.at(-1) ?? 1;
          const fieldCost = baseCost * currentMultiplier;

          fieldCosts.push({ cost: fieldCost, path });

          // Determine multiplier for children
          let childMultiplier = currentMultiplier;
          if (fieldDefinition) {
            const returnType = fieldDefinition.type;
            if (isListLikeType(returnType)) {
              // Check for first/limit/last arguments in variables or literal args
              let listSize = defaultListMultiplier;
              if (node.arguments) {
                for (const argument of node.arguments) {
                  if (['first', 'limit', 'last'].includes(argument.name.value)) {
                    if (argument.value.kind === Kind.INT) {
                      listSize = Number(argument.value.value);
                    } else if (variables && argument.value.kind === Kind.VARIABLE) {
                      const variableName = argument.value.name.value;
                      if (typeof variables[variableName] === 'number') {
                        listSize = variables[variableName] as number;
                      }
                    }
                  }
                }
              }
              childMultiplier = currentMultiplier * listSize;
            }
          }

          multiplierStack.push(childMultiplier);
        },
        leave() {
          pathStack.pop();
          multiplierStack.pop();
        },
      },
    }),
  );

  const totalCost = fieldCosts.reduce((sum, f) => sum + f.cost, 0);

  return {
    exceeds: totalCost > maxCost,
    fieldCosts,
    limit: maxCost,
    totalCost,
  };
};
