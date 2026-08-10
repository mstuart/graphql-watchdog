import { createHash } from 'node:crypto';

export interface NormalizedEntity {
  __typename: string;
  id: string;
  data: Record<string, unknown>;
}

export const generateCacheKey = (
  operationName: string | null,
  variables?: Record<string, unknown>,
): string => {
  const raw = JSON.stringify({ op: operationName, vars: variables ?? {} });
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
};

export const normalizeResponse = (
  data: Record<string, unknown>,
  operationName: string | null,
  variables?: Record<string, unknown>,
): { entities: NormalizedEntity[]; cacheKey: string } => {
  const entities: NormalizedEntity[] = [];

  const extractEntities = (object: unknown): unknown => {
    if (object === null || object === undefined) {
      return object;
    }

    if (Array.isArray(object)) {
      return object.map((item) => extractEntities(item));
    }

    if (typeof object === 'object') {
      const record = object as Record<string, unknown>;
      const typename = record.__typename as string | undefined;
      const id = record.id ?? record._id;

      if (typename && id !== undefined) {
        const entityData: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(record)) {
          if (['__typename', '_id', 'id'].includes(key)) {
            continue;
          }
          entityData[key] = extractEntities(value);
        }

        entities.push({
          __typename: typename,
          data: entityData,
          id: String(id),
        });

        return { __ref: `${typename}:${id}` };
      }

      // Non-entity object, recurse into values
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        result[key] = extractEntities(value);
      }
      return result;
    }

    return object;
  };

  extractEntities(data);

  const cacheKey = generateCacheKey(operationName, variables);

  return { cacheKey, entities };
};
