import {
  visit,
  Kind,
  TypeInfo,
  visitWithTypeInfo,
  isListType,
  isNonNullType,
  GraphQLError,
} from 'graphql';
import type {
  ASTVisitor,
  DocumentNode,
  FragmentDefinitionNode,
  GraphQLSchema,
  GraphQLOutputType,
} from 'graphql';
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
  const fragments = new Map<string, FragmentDefinitionNode>();
  const activeFragments = new Set<string>();
  const fragmentContexts: Set<string>[] = [new Set()];
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  }

  const visitor: ASTVisitor = {
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
        fragmentContexts.push(new Set());
      },
      leave() {
        pathStack.pop();
        multiplierStack.pop();
        fragmentContexts.pop();
      },
    },
    // eslint-disable-next-line sonarjs/function-name -- GraphQL visitor keys use AST node names.
    FragmentDefinition: () => false,
    // eslint-disable-next-line sonarjs/function-name -- GraphQL visitor keys use AST node names.
    FragmentSpread(node) {
      const name = node.name.value;
      const fragment = fragments.get(name);
      if (!fragment) {
        return;
      }
      if (activeFragments.has(name)) {
        throw new GraphQLError(`Cannot analyze cyclic fragment "${name}"`);
      }
      const seen = fragmentContexts.at(-1);
      if (seen?.has(name)) {
        return;
      }
      seen?.add(name);
      activeFragments.add(name);
      visit(
        {
          kind: Kind.INLINE_FRAGMENT,
          selectionSet: fragment.selectionSet,
          typeCondition: fragment.typeCondition,
        },
        visitWithTypeInfo(typeInfo, visitor),
      );
      activeFragments.delete(name);
    },
    // eslint-disable-next-line sonarjs/function-name -- GraphQL visitor keys use AST node names.
    OperationDefinition() {
      fragmentContexts[0].clear();
    },
  };
  visit(document, visitWithTypeInfo(typeInfo, visitor));

  const totalCost = fieldCosts.reduce((sum, f) => sum + f.cost, 0);

  return {
    exceeds: totalCost > maxCost,
    fieldCosts,
    limit: maxCost,
    totalCost,
  };
};
