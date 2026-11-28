import { useMemo, useSyncExternalStore } from "react";

export type Route =
  | { readonly kind: "home"; readonly runId: string | null }
  | {
      readonly kind: "workflow";
      readonly id: string;
      readonly version: number | null;
      readonly runId: string | null;
    }
  | { readonly kind: "design-ref" }
  | { readonly kind: "not-found" };

const CHANGE_EVENT = "sosho:navigate";

export function parseRoute(pathname: string, search: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(search);
  const runId = params.get("run") || null;
  const asked = Number(params.get("v"));
  const version = Number.isInteger(asked) && asked > 0 ? asked : null;
  if (path === "/") return { kind: "home", runId };
  if (path === "/design-ref") return { kind: "design-ref" };
  const match = /^\/w\/([^/]+)$/.exec(path);
  if (match?.[1]) {
    try {
      return { kind: "workflow", id: decodeURIComponent(match[1]), version, runId };
    } catch {
      return { kind: "not-found" };
    }
  }
  return { kind: "not-found" };
}

export function formatRoute(route: Route): string {
  const query = (runId: string | null, version: number | null = null) => {
    const parts = [
      ...(version === null ? [] : [`v=${version}`]),
      ...(runId ? [`run=${encodeURIComponent(runId)}`] : []),
    ];
    return parts.length > 0 ? `?${parts.join("&")}` : "";
  };
  switch (route.kind) {
    case "home":
      return `/${query(route.runId)}`;
    case "workflow":
      return `/w/${encodeURIComponent(route.id)}${query(route.runId, route.version)}`;
    case "design-ref":
      return "/design-ref";
    case "not-found":
      return "/";
  }
}

export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const url = formatRoute(route);
  if (options.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const snapshot = () => window.location.pathname + window.location.search;

export function useRoute(): Route {
  const location = useSyncExternalStore(subscribe, snapshot, () => "/");
  return useMemo(() => {
    const at = location.indexOf("?");
    return at < 0
      ? parseRoute(location, "")
      : parseRoute(location.slice(0, at), location.slice(at));
  }, [location]);
}
