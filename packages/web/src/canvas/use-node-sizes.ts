import { useCallback, useEffect, useRef, useState } from "react";
import { roundSize, type SizeMap, sizesEqual } from "./sizes";

type RefCallback = (element: HTMLElement | null) => void;

export function useNodeSizes() {
  const [state, setState] = useState<{ sizes: SizeMap; version: number }>({
    sizes: new Map(),
    version: 0,
  });
  const observer = useRef<ResizeObserver | null>(null);
  const ids = useRef(new Map<Element, string>());
  const refs = useRef(new Map<string, RefCallback>());

  useEffect(() => {
    const instance = new ResizeObserver((entries) => {
      setState((current) => {
        const next = new Map(current.sizes);
        for (const entry of entries) {
          const id = ids.current.get(entry.target);
          const box = entry.borderBoxSize[0];
          if (id === undefined || !box) continue;
          next.set(id, roundSize(box.inlineSize, box.blockSize));
        }
        if (sizesEqual(current.sizes, next)) return current;
        return { sizes: next, version: current.version + 1 };
      });
    });
    observer.current = instance;
    for (const element of ids.current.keys()) instance.observe(element);
    return () => {
      instance.disconnect();
      observer.current = null;
    };
  }, []);

  const sizeRef = useCallback((id: string): RefCallback => {
    const cached = refs.current.get(id);
    if (cached) return cached;
    let current: HTMLElement | null = null;
    const callback: RefCallback = (element) => {
      if (current) {
        observer.current?.unobserve(current);
        ids.current.delete(current);
      }
      current = element;
      if (element) {
        ids.current.set(element, id);
        observer.current?.observe(element);
      }
    };
    refs.current.set(id, callback);
    return callback;
  }, []);

  return { sizes: state.sizes, version: state.version, sizeRef };
}
