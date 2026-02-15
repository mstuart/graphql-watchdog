import {
  type DocumentNode,
  type GraphQLSchema,
  type GraphQLOutputType,
  type GraphQLField,
  visit,
  Kind,
  TypeInfo,
  visitWithTypeInfo,
  isListType,
  isNonNullType,
  isObjectType,
  isAbstractType,
} from 'graphql';
import type { CostConfig } from '../types/index.js';

export interface CostBreakdown {
  totalCost: number;
  fieldCosts: { path: string; cost: number }[];
  exceeds: boolean;
  limit: number;
}

function isListLikeType(type: GraphQLOutputType): boolean {
  if (isListType(type)) return true;
  if (isNonNullType(type)) return isListLikeType(type.ofType);
  return false;
}

export function analyzeCost(
  document: DocumentNode,
  schema: GraphQLSchema,
  config: CostConfig = {},
  variables?: Record<string, unknown>,
): CostBreakdown {
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
        enter(node) {
          const fieldName = node.name.value;
          const parentType = typeInfo.getParentType();
          const fieldDef = typeInfo.getFieldDef();
          const typeName = parentType?.name ?? '';

          pathStack.push(fieldName);
          const path = pathStack.join('.');

          // Determine field cost from costMap or default
          const costKey = `${typeName}.${fieldName}`;
          const baseCost = costMap[costKey] ?? defaultFieldCost;

          // Get current multiplier from parent
          const currentMultiplier = multiplierStack[multiplierStack.length - 1];
          const fieldCost = baseCost * currentMultiplier;

          fieldCosts.push({ path, cost: fieldCost });

          // Determine multiplier for children
          let childMultiplier = currentMultiplier;
          if (fieldDef) {
            const returnType = fieldDef.type;
            if (isListLikeType(returnType)) {
              // Check for first/limit/last arguments in variables or literal args
              let listSize = defaultListMultiplier;
              if (node.arguments) {
                for (const arg of node.arguments) {
                  if (['first', 'limit', 'last'].includes(arg.name.value)) {
                    if (arg.value.kind === Kind.INT) {
                      listSize = parseInt(arg.value.value, 10);
                    } else if (arg.value.kind === Kind.VARIABLE && variables) {
                      const varName = arg.value.name.value;
                      if (typeof variables[varName] === 'number') {
                        listSize = variables[varName] as number;
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
    totalCost,
    fieldCosts,
    exceeds: totalCost > maxCost,
    limit: maxCost,
  };
}
