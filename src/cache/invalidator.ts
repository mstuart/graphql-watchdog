import {
  type DocumentNode,
  type GraphQLSchema,
  visit,
  TypeInfo,
  visitWithTypeInfo,
  isObjectType,
  isNonNullType,
  isListType,
  type GraphQLOutputType,
} from 'graphql';

function unwrapType(type: GraphQLOutputType): GraphQLOutputType {
  if (isNonNullType(type) || isListType(type)) {
    return unwrapType(type.ofType);
  }
  return type;
}

export function getMutationTypes(document: DocumentNode, schema: GraphQLSchema): string[] {
  const typeNames = new Set<string>();
  const typeInfo = new TypeInfo(schema);

  visit(
    document,
    visitWithTypeInfo(typeInfo, {
      OperationDefinition(node) {
        if (node.operation !== 'mutation') {
          return false; // Skip non-mutation operations
        }
        return undefined;
      },
      Field() {
        const fieldDef = typeInfo.getFieldDef();
        if (fieldDef) {
          const returnType = unwrapType(fieldDef.type);
          if (isObjectType(returnType)) {
            typeNames.add(returnType.name);
          }
        }
      },
    }),
  );

  return [...typeNames];
}
