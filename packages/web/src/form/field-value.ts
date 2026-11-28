import type { JsonObject, JsonValue } from "../api/types";
import { type Field, HIDDEN_KEYS } from "./field-types";
import { fieldsFromSchema } from "./schema-model";

function seedArray(field: Field & { readonly type: "array" }): JsonValue {
  const seed = seedValue({ ...field.item, required: true });
  return seed === undefined ? [] : Array.from({ length: field.minItems }, () => seed);
}

export function seedValue(field: Field): JsonValue | undefined {
  if (!field.required) return undefined;
  if (field.defaultValue !== undefined) return field.defaultValue;
  switch (field.type) {
    case "string":
      return "";
    case "enum":
      return field.options[0] ?? "";
    case "number":
      return field.min ?? 0;
    case "boolean":
      return false;
    case "array":
      return seedArray(field);
    case "object":
      return seedObject(field.fields);
    case "const":
      return field.value;
    case "json":
      return null;
  }
}

function seedObject(fields: readonly Field[]): JsonObject {
  const out: Record<string, JsonValue> = {};
  for (const field of fields) {
    const value = seedValue(field);
    if (value !== undefined) out[field.key] = value;
  }
  return out;
}

export function nodeFromSchema(schema: JsonObject, kind: string, id: string): JsonObject {
  const fields = fieldsFromSchema(schema).filter((field) => !HIDDEN_KEYS.has(field.key));
  return { id, kind, ...seedObject(fields) };
}

function isEmpty(field: Field, value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  return (field.type === "string" || field.type === "enum") && value === "";
}

export function setKey(object: JsonObject, field: Field, value: JsonValue | undefined): JsonObject {
  const { [field.key]: _old, ...rest } = object;
  if (value === undefined || (!field.required && isEmpty(field, value))) return rest;
  return { ...rest, [field.key]: value };
}

export function fieldValue(field: Field, object: JsonObject): JsonValue | undefined {
  const own = object[field.key];
  return own === undefined ? field.defaultValue : own;
}
