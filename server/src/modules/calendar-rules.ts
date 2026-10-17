import {
  ANNUAL_LEAVE_ALLOWANCE,
  BREAK_CATEGORIES,
  EntryCategory,
  MAX_LEAVE_DAYS_PER_REQUEST,
} from "@syncro/shared";
import {
  addDays,
  businessDaysBetween,
  dayKeysBetween,
  weekdayOf,
} from "./time";

/**
 * Pure calendar rules. No database access here so every rule can be unit tested.
 */

export const MAX_BREAK_MINUTES = 180;
export const MIN_BREAK_MINUTES = 5;
export const MAX_ACTIVITY_MINUTES = 12 * 60;
const PAST_GRACE_MS = 5 * 60 * 1000;

export function isBreakCategory(category: EntryCategory): boolean {
  return (BREAK_CATEGORIES as readonly string[]).includes(category);
}

export function validateLeaveDates(input: {
  startKey: string;
  endKey: string;
  todayKey: string;
}): string | null {
  const { startKey, endKey, todayKey } = input;
  if (startKey <= todayKey) {
    return "Leave has to be requested in advance. Pick a start date from tomorrow onwards.";
  }
  if (endKey < startKey) {
    return "The end date has to be on or after the start date.";
  }
  if (dayKeysBetween(startKey, endKey).length > MAX_LEAVE_DAYS_PER_REQUEST) {
    return `A single leave request can cover at most ${MAX_LEAVE_DAYS_PER_REQUEST} days.`;
  }
  if (businessDaysBetween(startKey, endKey) === 0) {
    return "Pick at least one working day (Monday to Friday).";
  }
  return null;
}

export function validateEntryWindow(input: {
  category: EntryCategory;
  start: Date;
  end: Date;
  now: Date;
}): string | null {
  const { category, start, end, now } = input;
  const minutes = (end.getTime() - start.getTime()) / 60000;

  if (start.getTime() < now.getTime() - PAST_GRACE_MS) {
    return "That time has already passed. Add entries for today or later.";
  }
  if (isBreakCategory(category)) {
    if (minutes < MIN_BREAK_MINUTES) return `Breaks need to be at least ${MIN_BREAK_MINUTES} minutes.`;
    if (minutes > MAX_BREAK_MINUTES) return "Breaks can be at most 3 hours.";
    return null;
  }
  if (minutes > MAX_ACTIVITY_MINUTES) return "Activities can be at most 12 hours.";
  return null;
}

/**
 * Day keys a repeating entry lands on: every weekday for `weeks` weeks,
 * starting from `startKey`. Weekends are skipped. weeks = 0 means just the one day.
 */
export function repeatDayKeys(startKey: string, weeks: number): string[] {
  if (weeks <= 0) return [startKey];
  return dayKeysBetween(startKey, addDays(startKey, weeks * 7 - 1)).filter((key) => {
    const wd = weekdayOf(key);
    return wd >= 1 && wd <= 5;
  });
}

export function annualLeaveRemaining(used: number, pending: number): number {
  return Math.max(0, ANNUAL_LEAVE_ALLOWANCE - used - pending);
}

export function leaveRangesOverlap(
  a: { startKey: string; endKey: string },
  b: { startKey: string; endKey: string }
): boolean {
  return a.startKey <= b.endKey && a.endKey >= b.startKey;
}
