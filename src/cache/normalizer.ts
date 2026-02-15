import { createHash } from 'node:crypto';

export interface NormalizedEntity {
  __typename: string;
  id: string;
  data: Record<string, unknown>;
}

export function normalizeResponse(
  data: Record<string, unknown>,
  operationName: string | null,
  variables?: Record<string, unknown>,
): { entities: NormalizedEntity[]; cacheKey: string } {
  const entities: NormalizedEntity[] = [];

  function extractEntities(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => extractEntities(item));
    }

    if (typeof obj === 'object') {
      const record = obj as Record<string, unknown>;
      const typename = record.__typename as string | undefined;
      const id = record.id ?? record._id;

      if (typename && id !== undefined) {
        const data: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(record)) {
          if (key === '__typename' || key === 'id' || key === '_id') continue;
          data[key] = extractEntities(value);
        }

        entities.push({
          __typename: typename,
          id: String(id),
          data,
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

    return obj;
  }

  extractEntities(data);

  const cacheKey = generateCacheKey(operationName, variables);

  return { entities, cacheKey };
}

export function generateCacheKey(
  operationName: string | null,
  variables?: Record<string, unknown>,
): string {
  const raw = JSON.stringify({ op: operationName, vars: variables ?? {} });
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}
