import { isJsonObject } from "../api/guards";
import type { JsonObject, JsonValue } from "../api/types";

export interface Resolved {
  readonly schema: JsonObject;
  readonly nullable: boolean;
}

const MAX_DEPTH = 8;
const DEFS_PREFIX = "#/$defs/";

function lookup(defs: JsonObject, ref: string): JsonObject | null {
  if (!ref.startsWith(DEFS_PREFIX)) return null;
  const found = defs[ref.slice(DEFS_PREFIX.length)];
  return isJsonObject(found) ? found : null;
}

const isNullType = (schema: JsonValue): boolean => isJsonObject(schema) && schema.type === "null";

function unionOf(schema: JsonObject): readonly JsonValue[] | null {
  if (Array.isArray(schema.anyOf)) return schema.anyOf;
  return Array.isArray(schema.oneOf) ? schema.oneOf : null;
}

function resolveRef(schema: JsonObject, ref: string, defs: JsonObject, depth: number): Resolved {
  const { $ref: _ref, ...own } = schema;
  const target = lookup(defs, ref);
  return target
    ? resolve({ ...target, ...own }, defs, depth + 1)
    : { schema: own, nullable: false };
}

function resolveUnion(
  schema: JsonObject,
  union: readonly JsonValue[],
  defs: JsonObject,
  depth: number,
): Resolved {
  const nullable = union.some(isNullType);
  const rest = union.filter((entry) => !isNullType(entry));
  const { anyOf: _a, oneOf: _o, ...own } = schema;
  const only = rest.length === 1 ? rest[0] : undefined;
  if (only !== undefined && isJsonObject(only)) {
    const inner = resolve({ ...only, ...own }, defs, depth + 1);
    return { schema: inner.schema, nullable: nullable || inner.nullable };
  }
  return { schema: own, nullable };
}

function resolveTypeList(schema: JsonObject, types: readonly JsonValue[]): Resolved {
  const real = types.filter((type) => type !== "null");
  const [first] = real;
  const { type: _type, ...own } = schema;
  const single = real.length === 1 && first !== undefined ? { type: first } : {};
  return { schema: { ...own, ...single }, nullable: real.length !== types.length };
}

export function resolve(schema: JsonObject, defs: JsonObject, depth = 0): Resolved {
  if (depth > MAX_DEPTH) return { schema: {}, nullable: false };
  if (typeof schema.$ref === "string") return resolveRef(schema, schema.$ref, defs, depth);
  const union = unionOf(schema);
  if (union) return resolveUnion(schema, union, defs, depth);
  const [single] = Array.isArray(schema.allOf) ? schema.allOf : [];
  if (isJsonObject(single) && Array.isArray(schema.allOf) && schema.allOf.length === 1) {
    const { allOf: _all, ...own } = schema;
    return resolve({ ...single, ...own }, defs, depth + 1);
  }
  if (Array.isArray(schema.type)) return resolveTypeList(schema, schema.type);
  return { schema, nullable: false };
}
