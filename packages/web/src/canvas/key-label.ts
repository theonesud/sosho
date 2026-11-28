const MAC_NAMES: Readonly<Record<string, string>> = { mod: "Cmd", alt: "Option" };
const OTHER_NAMES: Readonly<Record<string, string>> = { mod: "Ctrl", alt: "Alt" };
const PLAIN_NAMES: Readonly<Record<string, string>> = {
  delete: "Del",
  escape: "Esc",
  shift: "Shift",
  space: "Space",
};

export function isMacPlatform(
  platform: string = typeof navigator === "undefined" ? "" : navigator.platform,
): boolean {
  return /^(Mac|iPhone|iPad|iPod)/i.test(platform);
}

export function keyParts(keys: string, mac: boolean): readonly string[] {
  const names = mac ? MAC_NAMES : OTHER_NAMES;
  return keys.split("+").map((part) => {
    const lower = part.toLowerCase();
    return names[lower] ?? PLAIN_NAMES[lower] ?? (part.length === 1 ? part.toUpperCase() : part);
  });
}
