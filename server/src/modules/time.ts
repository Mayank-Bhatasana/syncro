import { env } from "../config/env";

/**
 * Company-calendar helpers. A "day" in Syncro is a day in the company timezone
 * (COMPANY_TIMEZONE), so leave, breaks and bookings agree no matter which
 * timezone a browser or the server host is running in.
 *
 * Day keys are "YYYY-MM-DD" strings.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let fmt = formatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, fmt);
  }
  return fmt;
}

function zonedParts(instant: Date, tz: string) {
  const parts = formatterFor(tz).formatToParts(instant);
  const read = (type: string) =>
    Number(parts.find((p) => p.type === type)!.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function offsetMs(instant: number, tz: string): number {
  const p = zonedParts(new Date(instant), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export function dateKeyOf(instant: Date, tz: string = env.COMPANY_TIMEZONE): string {
  const p = zonedParts(instant, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function todayKey(now: Date = new Date(), tz: string = env.COMPANY_TIMEZONE): string {
  return dateKeyOf(now, tz);
}

/** Instant for a wall-clock time ("HH:mm") on a company day. */
export function zonedInstant(
  dayKey: string,
  hhmm: string,
  tz: string = env.COMPANY_TIMEZONE
): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const firstOffset = offsetMs(guess, tz);
  let utc = guess - firstOffset;
  const secondOffset = offsetMs(utc, tz);
  if (secondOffset !== firstOffset) {
    utc = guess - secondOffset;
  }
  return new Date(utc);
}

export function timeOfDay(instant: Date, tz: string = env.COMPANY_TIMEZONE): string {
  const p = zonedParts(instant, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Start of the company day (00:00) as an instant. */
export function dayStartOf(dayKey: string, tz: string = env.COMPANY_TIMEZONE): Date {
  return zonedInstant(dayKey, "00:00", tz);
}

/** Start of the day after dayKey, i.e. the exclusive end of dayKey. */
export function dayEndOf(dayKey: string, tz: string = env.COMPANY_TIMEZONE): Date {
  return dayStartOf(addDays(dayKey, 1), tz);
}

/** Pure calendar arithmetic on day keys (no timezone involved). */
export function addDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(dayKey: string): boolean {
  const wd = weekdayOf(dayKey);
  return wd === 0 || wd === 6;
}

/** Inclusive list of day keys from start to end. */
export function dayKeysBetween(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  let cursor = startKey;
  while (cursor <= endKey) {
    keys.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return keys;
}

export function businessDaysBetween(startKey: string, endKey: string): number {
  return dayKeysBetween(startKey, endKey).filter((k) => !isWeekend(k)).length;
}

/** The day keys (company timezone) an interval touches. */
export function dayKeysTouchedBy(
  start: Date,
  end: Date,
  tz: string = env.COMPANY_TIMEZONE
): { first: string; last: string } {
  const first = dateKeyOf(start, tz);
  const lastInstant = new Date(Math.max(start.getTime(), end.getTime() - 1));
  return { first, last: dateKeyOf(lastInstant, tz) };
}

export function keyToDbDate(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

export function dbDateToKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}
