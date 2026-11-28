import { isJsonObject, isJsonValue } from "../api/guards";
import type { JsonObject, JsonValue } from "../api/types";
import { ADVANCED_KEYS, type Field, type FieldShape, HIDDEN_KEYS } from "./field-types";
import { resolve } from "./schema-resolve";

const LONG_TEXT_KEYS: ReadonlySet<string> = new Set([
  "prompt",
  "system",
  "instructions",
  "task",
  "description",
]);
const LONG_TEXT_LENGTH = 200;
const MAX_FIELD_DEPTH = 6;

function humanize(key: string): string {
  const spaced = key.replaceAll("_", " ").trim();
  return spaced === "" ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const numberOf = (value: JsonValue | undefined): number | undefined =>
  typeof value === "number" ? value : undefined;

function stringList(value: JsonValue | undefined): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === "string") ? value.map(String) : null;
}

function stringShape(schema: JsonObject, key: string): FieldShape {
  const max = numberOf(schema.maxLength);
  const multiline = LONG_TEXT_KEYS.has(key) || (max !== undefined && max > LONG_TEXT_LENGTH);
  const pattern = typeof schema.pattern === "string" ? { pattern: schema.pattern } : {};
  return { type: "string", multiline, ...pattern };
}

function numberShape(schema: JsonObject): FieldShape {
  const min = numberOf(schema.minimum) ?? numberOf(schema.exclusiveMinimum);
  const max = numberOf(schema.maximum) ?? numberOf(schema.exclusiveMaximum);
  return {
    type: "number",
    integer: schema.type === "integer",
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
}

function shapeOf(schema: JsonObject, key: string, defs: JsonObject, depth: number): FieldShape {
  if (schema.const !== undefined) return { type: "const", value: schema.const };
  const options = stringList(schema.enum);
  if (options) return { type: "enum", options };
  switch (schema.type) {
    case "string":
      return stringShape(schema, key);
    case "integer":
    case "number":
      return numberShape(schema);
    case "boolean":
      return { type: "boolean" };
    case "array": {
      const items = isJsonObject(schema.items) ? schema.items : {};
      const item = buildField("", items, defs, true, depth + 1);
      return { type: "array", item, minItems: numberOf(schema.minItems) ?? 0 };
    }
    case "object":
      if (isJsonObject(schema.properties) && depth < MAX_FIELD_DEPTH) {
        return { type: "object", fields: buildFields(schema, defs, depth + 1) };
      }
      return { type: "json" };
    default:
      return { type: "json" };
  }
}

function buildField(
  key: string,
  raw: JsonObject,
  defs: JsonObject,
  required: boolean,
  depth: number,
): Field {
  const { schema, nullable } = resolve(raw, defs);
  const description =
    typeof schema.description === "string" ? { description: schema.description } : {};
  const defaultValue = isJsonValue(schema.default) ? { defaultValue: schema.default } : {};
  const shape = shapeOf(schema, key, defs, depth);
  return {
    key,
    label: humanize(key),
    required,
    nullable,
    ...description,
    ...defaultValue,
    ...shape,
  };
}

function buildFields(schema: JsonObject, defs: JsonObject, depth: number): readonly Field[] {
  const props = isJsonObject(schema.properties) ? schema.properties : {};
  const required = new Set(stringList(schema.required) ?? []);
  const fields: Field[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (isJsonObject(value)) fields.push(buildField(key, value, defs, required.has(key), depth));
  }
  return fields;
}

export function fieldsFromSchema(root: JsonObject): readonly Field[] {
  const defs = isJsonObject(root.$defs) ? root.$defs : {};
  return buildFields(root, defs, 0);
}

export interface FieldGroups {
  readonly main: readonly Field[];
  readonly advanced: readonly Field[];
}

export function groupFields(fields: readonly Field[]): FieldGroups {
  const advanced = fields.filter((field) => ADVANCED_KEYS.includes(field.key));
  const main = fields.filter(
    (field) => !HIDDEN_KEYS.has(field.key) && !ADVANCED_KEYS.includes(field.key),
  );
  return { main, advanced };
}
