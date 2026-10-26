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
          let breakdown;
          try {
            breakdown = analyzeCost(node, schema, config);
          } catch (error) {
            if (!(error instanceof GraphQLError)) {
              throw error;
            }
            (context as unknown as { reportError: (error: GraphQLError) => void }).reportError(
              error,
            );
            return;
          }
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
