import { describe, it, expect } from "vitest";
import {
  canDecideLeave,
  hasTimeOverlap,
} from "../src/modules/permissions";
import {
  annualLeaveRemaining,
  repeatDayKeys,
  validateEntryWindow,
  validateLeaveDates,
  isBreakCategory,
} from "../src/modules/calendar-rules";
import {
  addDays,
  businessDaysBetween,
  dateKeyOf,
  dayKeysBetween,
  dayStartOf,
  timeOfDay,
  weekdayOf,
  zonedInstant,
} from "../src/modules/time";

const KOLKATA = "Asia/Kolkata";

describe("Company timezone helpers", () => {
  it("converts a wall-clock time in the company timezone to the right instant", () => {
    // 14:30 IST is 09:00 UTC
    expect(zonedInstant("2026-10-19", "14:30", KOLKATA).toISOString()).toBe(
      "2026-10-19T09:00:00.000Z"
    );
  });

  it("gives the company day a start that is not the UTC day start", () => {
    expect(dayStartOf("2026-10-19", KOLKATA).toISOString()).toBe("2026-10-18T18:30:00.000Z");
  });

  it("reads the company day key for an instant near midnight", () => {
    // 00:30 IST on Oct 19 is still Oct 18 in UTC
    expect(dateKeyOf(new Date("2026-10-18T19:00:00.000Z"), KOLKATA)).toBe("2026-10-19");
    expect(timeOfDay(new Date("2026-10-18T19:00:00.000Z"), KOLKATA)).toBe("00:30");
  });

  it("does day arithmetic on keys and weekdays", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(weekdayOf("2026-10-17")).toBe(6); // Saturday
    expect(dayKeysBetween("2026-10-16", "2026-10-18")).toEqual([
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
    // Fri 16 Oct + Sat/Sun + Mon 19 Oct + Tue 20 Oct = 3 working days
    expect(businessDaysBetween("2026-10-16", "2026-10-20")).toBe(3);
  });
});

describe("Leave rules", () => {
  const today = "2026-10-17";

  it("rejects leave that starts today or earlier (must be requested in advance)", () => {
    expect(validateLeaveDates({ startKey: today, endKey: today, todayKey: today })).not.toBeNull();
    expect(validateLeaveDates({ startKey: "2026-10-10", endKey: "2026-10-12", todayKey: today })).not.toBeNull();
  });

  it("accepts a working day that is at least a day ahead", () => {
    // Sat 17 Oct is today, Mon 19 Oct is the next working day
    expect(validateLeaveDates({ startKey: "2026-10-19", endKey: "2026-10-19", todayKey: today })).toBeNull();
  });

  it("rejects end dates before start dates and weekend-only requests", () => {
    expect(validateLeaveDates({ startKey: "2026-10-22", endKey: "2026-10-20", todayKey: today })).not.toBeNull();
    // Sat 24 & Sun 25 Oct only
    expect(validateLeaveDates({ startKey: "2026-10-24", endKey: "2026-10-25", todayKey: today })).not.toBeNull();
  });

  it("caps a single request length", () => {
    expect(validateLeaveDates({ startKey: "2026-10-20", endKey: "2026-12-31", todayKey: today })).not.toBeNull();
  });

  it("computes the annual leave that is still left", () => {
    expect(annualLeaveRemaining(5, 2)).toBe(13);
    expect(annualLeaveRemaining(25, 0)).toBe(0);
  });

  it("only lets managers of the same department or admins decide leave, never your own", () => {
    const employee = { id: "e1", role: "EMPLOYEE" as const, departmentId: "it" };
    const itManager = { id: "m1", role: "MANAGER" as const, departmentId: "it" };
    const hrManager = { id: "m2", role: "MANAGER" as const, departmentId: "hr" };
    const admin = { id: "a1", role: "ADMIN" as const, departmentId: "ops" };

    expect(canDecideLeave(itManager, employee)).toBe(true);
    expect(canDecideLeave(hrManager, employee)).toBe(false);
    expect(canDecideLeave(admin, employee)).toBe(true);
    expect(canDecideLeave(employee, employee)).toBe(false);
    expect(canDecideLeave(itManager, itManager)).toBe(false);
    expect(canDecideLeave(employee, itManager)).toBe(false);
  });
});

describe("Personal entries (breaks and activities)", () => {
  const now = new Date("2026-10-17T06:00:00.000Z");

  it("classifies lunch, coffee and break as breaks, everything else as activities", () => {
    expect(isBreakCategory("LUNCH")).toBe(true);
    expect(isBreakCategory("COFFEE")).toBe(true);
    expect(isBreakCategory("FOCUS")).toBe(false);
    expect(isBreakCategory("ERRAND")).toBe(false);
  });

  it("rejects entries in the past", () => {
    const start = new Date("2026-10-17T05:00:00.000Z");
    const end = new Date("2026-10-17T05:30:00.000Z");
    expect(validateEntryWindow({ category: "LUNCH", start, end, now })).not.toBeNull();
  });

  it("limits breaks to 3 hours and activities to 12 hours", () => {
    const start = new Date("2026-10-19T07:00:00.000Z");
    const fourHours = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    expect(validateEntryWindow({ category: "BREAK", start, end: fourHours, now })).not.toBeNull();
    expect(validateEntryWindow({ category: "FOCUS", start, end: fourHours, now })).toBeNull();
  });

  it("repeats on weekdays only for the requested number of weeks", () => {
    // Starting Mon 19 Oct, 1 week => Mon..Fri
    expect(repeatDayKeys("2026-10-19", 1)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
    // Weekend starting point is skipped; zero weeks keeps only the start day
    expect(repeatDayKeys("2026-10-24", 0)).toEqual(["2026-10-24"]);
    expect(repeatDayKeys("2026-10-24", 2)).not.toContain("2026-10-24");
    expect(repeatDayKeys("2026-10-19", 2)).toHaveLength(10);
  });
});

describe("Overlap detection used by breaks and bookings", () => {
  it("treats a meeting that ends exactly when a break starts as not overlapping", () => {
    const meeting = {
      startTime: new Date("2026-10-19T06:00:00.000Z"),
      endTime: new Date("2026-10-19T07:00:00.000Z"),
    };
    const lunch = {
      startTime: new Date("2026-10-19T07:00:00.000Z"),
      endTime: new Date("2026-10-19T08:00:00.000Z"),
    };
    expect(hasTimeOverlap(meeting, lunch)).toBe(false);
  });

  it("treats a meeting that starts inside lunch as overlapping", () => {
    const lunch = {
      startTime: new Date("2026-10-19T07:00:00.000Z"),
      endTime: new Date("2026-10-19T08:00:00.000Z"),
    };
    const meeting = {
      startTime: new Date("2026-10-19T07:30:00.000Z"),
      endTime: new Date("2026-10-19T08:30:00.000Z"),
    };
    expect(hasTimeOverlap(lunch, meeting)).toBe(true);
  });
});
