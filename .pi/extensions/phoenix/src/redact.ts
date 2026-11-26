export const SECRET_REDACTION_MARK = "[redacted-secret]";
export const CYCLE_MARK = "[circular-ref]";
const TOKEN_PATTERNS = [String.raw`\bsk-[\w-]{16,}`, String.raw`\bBearer\s+[\w.~+/=-]{16,}`];

function escapeRegExpLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createSecretRedactor(...extraSecrets: string[]): (value: unknown) => unknown {
  const literals = extraSecrets.filter((secret) => secret.length > 0).map(escapeRegExpLiteral);
  const pattern = new RegExp([...literals, ...TOKEN_PATTERNS].join("|"), "g");
  const walk = (value: unknown, ancestors: readonly object[]): unknown => {
    if (typeof value === "string") return value.replace(pattern, SECRET_REDACTION_MARK);
    if (value === null || typeof value !== "object") return value;
    if (ancestors.includes(value)) return CYCLE_MARK;
    const chain = [...ancestors, value];
    if (Array.isArray(value)) return value.map((item) => walk(item, chain));
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      Object.defineProperty(fields, key, {
        value: walk(field, chain),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return fields;
  };
  return (value) => walk(value, []);
}
