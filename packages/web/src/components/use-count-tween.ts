import { useEffect, useRef, useState } from "react";
import { easeOut, readTweenMs } from "./motion";

interface NumericValue {
  readonly amount: number;
  readonly suffix: string;
}

const NUMERIC = /^(\d[\d,]*)(.*)$/s;
const grouping = new Intl.NumberFormat("en-US");

function parseNumeric(value: string): NumericValue | null {
  const match = NUMERIC.exec(value);
  if (!match) return null;
  const [, digits = "", suffix = ""] = match;
  return { amount: Number(digits.replaceAll(",", "")), suffix };
}

function formatNumeric(amount: number, suffix: string, grouped: boolean): string {
  const rounded = Math.round(amount);
  return `${grouped ? grouping.format(rounded) : String(rounded)}${suffix}`;
}

export function useCountTween(value: string): string {
  const [shown, setShown] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const from = parseNumeric(previous.current);
    const to = parseNumeric(value);
    previous.current = value;
    const ms = readTweenMs(document.documentElement);
    if (!from || !to || to.suffix !== from.suffix || to.amount === from.amount || ms <= 0) {
      setShown(value);
      return;
    }
    const grouped = value.includes(",");
    const { amount: start, suffix } = from;
    const delta = to.amount - start;
    const begin = performance.now();
    let frame = 0;
    function step(now: number) {
      const t = Math.min(1, (now - begin) / ms);
      const amount = start + delta * easeOut(t);
      setShown(t < 1 ? formatNumeric(amount, suffix, grouped) : value);
      if (t < 1) frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return shown;
}
