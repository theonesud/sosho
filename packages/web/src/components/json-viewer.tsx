import type { ReactNode } from "react";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const INDENT = 2;

function pad(depth: number): string {
  return " ".repeat(depth * INDENT);
}

function renderValue(value: JsonValue, depth: number, keyPath: string): ReactNode {
  if (value === null) return <span className="json-literal">null</span>;
  if (typeof value === "string") return <span className="json-string">"{value}"</span>;
  if (typeof value === "number") return <span className="json-number">{value}</span>;
  if (typeof value === "boolean") return <span className="json-literal">{String(value)}</span>;
  const isArray = Array.isArray(value);
  const entries: [string, JsonValue][] = isArray
    ? value.map((item, index): [string, JsonValue] => [String(index), item])
    : Object.entries(value);
  const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) return <span className="json-punct">{open + close}</span>;
  return (
    <>
      <span className="json-punct">{open}</span>
      {"\n"}
      {entries.map(([key, child], index) => (
        <span key={`${keyPath}.${key}`}>
          {pad(depth + 1)}
          {isArray ? null : (
            <>
              <span className="json-key">"{key}"</span>
              <span className="json-punct">: </span>
            </>
          )}
          {renderValue(child, depth + 1, `${keyPath}.${key}`)}
          <span className="json-punct">{index < entries.length - 1 ? "," : ""}</span>
          {"\n"}
        </span>
      ))}
      {pad(depth)}
      <span className="json-punct">{close}</span>
    </>
  );
}

interface JsonViewerProps {
  readonly value: JsonValue;
  readonly label: string;
}

export function JsonViewer({ value, label }: JsonViewerProps) {
  return (
    <section className="json-viewer" aria-label={label}>
      <pre>
        <code>{renderValue(value, 0, "$")}</code>
      </pre>
    </section>
  );
}
