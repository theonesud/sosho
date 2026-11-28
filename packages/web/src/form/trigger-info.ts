export function statusPhrase(onStatus: string): string {
  return onStatus === "any" ? "finishes" : onStatus;
}

export function formatNextFire(iso: string, timezone: string | null): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZone: timezone ?? "UTC",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return null;
  }
}

export function maskToken(token: string): string {
  return `${"•".repeat(8)}${token.slice(-4)}`;
}

export function curlCommand(url: string, token: string): string {
  return `curl -X POST ${url} -H 'X-Sosho-Token: ${token}' -H 'Content-Type: application/json' -d '{"example":"body"}'`;
}
