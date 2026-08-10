import {
  visit,
  TypeInfo,
  visitWithTypeInfo,
  isObjectType,
  isNonNullType,
  isListType,
} from 'graphql';
import type { DocumentNode, GraphQLSchema, GraphQLOutputType } from 'graphql';

const unwrapType = (type: GraphQLOutputType): GraphQLOutputType => {
  if (isNonNullType(type) || isListType(type)) {
    return unwrapType(type.ofType);
  }
  return type;
};

export const getMutationTypes = (document: DocumentNode, schema: GraphQLSchema): string[] => {
  const typeNames = new Set<string>();
  const typeInfo = new TypeInfo(schema);

  visit(
    document,
    visitWithTypeInfo(typeInfo, {
      // eslint-disable-next-line sonarjs/function-name -- GraphQL visitor keys use AST node names.
      Field: () => {
        const fieldDefinition = typeInfo.getFieldDef();
        if (fieldDefinition) {
          const returnType = unwrapType(fieldDefinition.type);
          if (isObjectType(returnType)) {
            typeNames.add(returnType.name);
          }
        }
      },
      // eslint-disable-next-line sonarjs/function-name -- GraphQL visitor keys use AST node names.
      OperationDefinition: (node) => {
        if (node.operation !== 'mutation') {
          // Skip non-mutation operations
          return false;
        }
        // eslint-disable-next-line unicorn/no-useless-undefined -- GraphQL uses undefined to continue visitor traversal.
        return undefined;
      },
    }),
  );

  return [...typeNames];
};
