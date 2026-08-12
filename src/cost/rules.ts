import { GraphQLError } from 'graphql';
import { analyzeCost } from './analyzer.js';
import type { ASTVisitor, DocumentNode, GraphQLSchema } from 'graphql';
import type { CostConfig } from '../types/index.js';

export const costLimitRule = (
  schema: GraphQLSchema,
  config: CostConfig,
): ((context: { getDocument: () => DocumentNode }) => ASTVisitor) => {
  return (context) => {
    return {
      Document: {
        leave(node: DocumentNode) {
          const breakdown = analyzeCost(node, schema, config);
          if (breakdown.exceeds) {
            (context as unknown as { reportError: (error: GraphQLError) => void }).reportError(
              new GraphQLError(
                `Query cost ${breakdown.totalCost} exceeds maximum allowed cost of ${config.maxCost}`,
              ),
            );
          }
        },
      },
    };
  };
};
