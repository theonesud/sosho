export function getStoredToken(): string {
  if (typeof window !== "undefined") {
    const ls = window.localStorage.getItem("sosho_studio_token");
    if (ls) return ls;
  }
  return process.env.NEXT_PUBLIC_SOSHO_STUDIO_TOKEN || "";
}

export function setStoredToken(token: string): void {
  if (typeof window === "undefined") return;
  if (token.trim()) {
    window.localStorage.setItem("sosho_studio_token", token.trim());
  } else {
    window.localStorage.removeItem("sosho_studio_token");
  }
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getStoredToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

export async function apiJson<T>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { ok: res.ok, status: res.status, data };
}
