import type { JsonValue } from "../api/types";

export interface FieldBase {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly required: boolean;
  readonly nullable: boolean;
  readonly defaultValue?: JsonValue;
}

export type FieldShape =
  | { readonly type: "string"; readonly multiline: boolean; readonly pattern?: string }
  | { readonly type: "enum"; readonly options: readonly string[] }
  | {
      readonly type: "number";
      readonly integer: boolean;
      readonly min?: number;
      readonly max?: number;
    }
  | { readonly type: "boolean" }
  | { readonly type: "array"; readonly item: Field; readonly minItems: number }
  | { readonly type: "object"; readonly fields: readonly Field[] }
  | { readonly type: "json" }
  | { readonly type: "const"; readonly value: JsonValue };

export type Field = FieldBase & FieldShape;

export const HIDDEN_KEYS: ReadonlySet<string> = new Set(["id", "kind"]);
export const ADVANCED_KEYS: readonly string[] = [
  "retry",
  "timeout_seconds",
  "queue",
  "continue_on_error",
];
