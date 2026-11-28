import type { Size } from "./camera";

export type SizeMap = ReadonlyMap<string, Size>;

export const DEFAULT_SIZE: Size = { width: 176, height: 52 };

export function sizesEqual(a: SizeMap, b: SizeMap): boolean {
  if (a.size !== b.size) return false;
  for (const [id, size] of a) {
    const other = b.get(id);
    if (!other || other.width !== size.width || other.height !== size.height) return false;
  }
  return true;
}

export function roundSize(width: number, height: number): Size {
  return { width: Math.round(width), height: Math.round(height) };
}
