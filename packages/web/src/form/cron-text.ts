export interface CronText {
  readonly text: string;
  readonly seconds: boolean;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function fieldsOf(value: string): readonly string[] {
  return value.split(/\s+/).filter((part) => part !== "");
}

export function cronFromEngine(value: string): CronText {
  const parts = fieldsOf(value);
  if (parts.length === 6 && parts[0] === "0")
    return { text: parts.slice(1).join(" "), seconds: false };
  return { text: parts.join(" "), seconds: parts.length === 6 };
}

export function cronToEngine(text: string): string {
  const parts = fieldsOf(text);
  return parts.length === 5 ? `0 ${parts.join(" ")}` : parts.join(" ");
}

export function cronFieldCount(engineValue: string): number {
  return fieldsOf(engineValue).length;
}

const isNumber = (part: string): boolean => /^\d+$/.test(part);
const inRange = (part: string, max: number): boolean => isNumber(part) && Number(part) <= max;
const pad = (part: string): string => part.padStart(2, "0");

function weekdayName(part: string): string | null {
  const lower = part.toLowerCase();
  const byName = WEEKDAY_NAMES.indexOf(lower);
  if (byName >= 0) return WEEKDAYS[byName] ?? null;
  if (!isNumber(part)) return null;
  return WEEKDAYS[Number(part) % 7] ?? null;
}

function dayClause(day: string, month: string, weekday: string): string | null {
  if (day === "*" && month === "*" && weekday === "*") return "every day";
  if (day === "*" && month === "*" && weekday === "1-5") return "on weekdays";
  if (day === "*" && month === "*" && weekday === "0,6") return "on weekends";
  const name = day === "*" && month === "*" ? weekdayName(weekday) : null;
  if (name !== null) return `on ${name}`;
  if (isNumber(day) && month === "*" && weekday === "*") return `on day ${day} of every month`;
  return null;
}

function stepOf(part: string): string | null {
  const match = /^\*\/(\d+)$/.exec(part);
  return match?.[1] ?? null;
}

function describeFields(parts: readonly string[]): string | null {
  const [minute = "", hour = "", day = "", month = "", weekday = ""] = parts;
  const rest = [hour, day, month, weekday];
  if (minute === "*" && rest.every((part) => part === "*")) return "Every minute";
  const minuteStep = stepOf(minute);
  if (minuteStep !== null && rest.every((part) => part === "*"))
    return `Every ${minuteStep} minutes`;
  if (isNumber(minute) && rest.every((part) => part === "*"))
    return `Every hour at minute ${minute}`;
  const hourStep = stepOf(hour);
  if (isNumber(minute) && hourStep !== null && [day, month, weekday].every((p) => p === "*")) {
    return `Every ${hourStep} hours at minute ${minute}`;
  }
  if (!inRange(minute, 59) || !inRange(hour, 23)) return null;
  const clause = dayClause(day, month, weekday);
  return clause === null ? null : `At ${pad(hour)}:${pad(minute)} ${clause}`;
}

export function describeCron(text: string): string | null {
  const parts = fieldsOf(text);
  return parts.length === 5 ? describeFields(parts) : null;
}

export function cronPreview(text: string, zone: string): string | null {
  const trimmed = fieldsOf(text).join(" ");
  if (trimmed === "") return null;
  return `${describeCron(trimmed) ?? trimmed} (time zone ${zone})`;
}

const CRON_LIMITS: readonly (readonly [string, number, number])[] = [
  ["Minute", 0, 59],
  ["Hour", 0, 23],
  ["Day", 1, 31],
  ["Month", 1, 12],
  ["Weekday", 0, 7],
];

function badCronField(parts: readonly string[]): string | null {
  for (const [index, [name, min, max]] of CRON_LIMITS.entries()) {
    const part = parts[index] ?? "";
    if (isNumber(part) && (Number(part) < min || Number(part) > max)) {
      return `${name} must be ${min} to ${max}`;
    }
  }
  return null;
}

export function cronIssueMessage(engineValue: string, message: string): string {
  const five = cronFromEngine(engineValue);
  const parts = fieldsOf(five.text);
  const local = !five.seconds && parts.length === 5 ? badCronField(parts) : null;
  if (local !== null) return local;
  const engine = fieldsOf(engineValue).join(" ");
  return five.seconds || engine === "" ? message : message.replace(engine, five.text);
}
