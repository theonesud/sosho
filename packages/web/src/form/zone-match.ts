export const TYPEAHEAD_MS = 500;

const normalize = (text: string): string => text.toLowerCase().replaceAll(" ", "_");

function segmentStarts(zone: string): readonly string[] {
  const parts = zone.split("/");
  return parts.map((_, index) => normalize(parts.slice(index).join("/")));
}

export function matchZone(zones: readonly string[], typed: string): number {
  const query = normalize(typed);
  if (query === "") return -1;
  const whole = zones.findIndex((zone) => normalize(zone).startsWith(query));
  if (whole >= 0) return whole;
  return zones.findIndex((zone) => segmentStarts(zone).some((tail) => tail.startsWith(query)));
}

export interface TypeaheadBuffer {
  readonly push: (key: string) => string;
  readonly text: () => string;
  readonly clear: () => void;
}

export function createTypeaheadBuffer(wait: number = TYPEAHEAD_MS): TypeaheadBuffer {
  let text = "";
  let handle: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    text = "";
    if (handle !== null) clearTimeout(handle);
    handle = null;
  };
  return {
    push(key) {
      if (handle !== null) clearTimeout(handle);
      text += key;
      handle = setTimeout(clear, wait);
      return text;
    },
    text: () => text,
    clear,
  };
}
