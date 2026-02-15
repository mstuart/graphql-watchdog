import { GraphQLError, type GraphQLSchema, type ASTVisitor } from 'graphql';
import type { CostConfig } from '../types/index.js';
import { analyzeCost } from './analyzer.js';

export function costLimitRule(
  schema: GraphQLSchema,
  config: CostConfig,
): (context: { getDocument: () => import('graphql').DocumentNode }) => ASTVisitor {
  return function costLimitValidationRule(context) {
    return {
      Document: {
        leave(node) {
          const breakdown = analyzeCost(node, schema, config);
          if (breakdown.exceeds) {
            (context as unknown as { reportError: (e: GraphQLError) => void }).reportError(
              new GraphQLError(
                `Query cost ${breakdown.totalCost} exceeds maximum allowed cost of ${config.maxCost}`,
              ),
            );
          }
        },
      },
    };
  };
}
