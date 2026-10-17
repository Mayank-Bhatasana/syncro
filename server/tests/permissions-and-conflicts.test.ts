import { describe, it, expect } from "vitest";
import {
  canInviteTargetScope,
  canDecideExcuse,
  canChangeDocSharing,
  canEditDocument,
  canReadDocument,
  hasTimeOverlap,
} from "../src/modules/permissions";

describe("Role & Permission Rules", () => {
  it("allows only MANAGER or ADMIN to invite entire departments or everyone", () => {
    expect(canInviteTargetScope("EMPLOYEE", "ALL")).toBe(false);
    expect(canInviteTargetScope("EMPLOYEE", "DEPARTMENT")).toBe(false);
    expect(canInviteTargetScope("EMPLOYEE", "USERS")).toBe(true);

    expect(canInviteTargetScope("MANAGER", "ALL")).toBe(true);
    expect(canInviteTargetScope("MANAGER", "DEPARTMENT")).toBe(true);
    expect(canInviteTargetScope("MANAGER", "USERS")).toBe(true);

    expect(canInviteTargetScope("ADMIN", "ALL")).toBe(true);
    expect(canInviteTargetScope("ADMIN", "DEPARTMENT")).toBe(true);
  });

  it("allows only the event organizer (boss) to allow or deny an attendee excuse", () => {
    const bossId = "user-boss-1";
    const employeeId = "user-emp-2";

    expect(canDecideExcuse(bossId, bossId)).toBe(true);
    expect(canDecideExcuse(employeeId, bossId)).toBe(false);
  });

  it("allows only the document owner to change doc sharing permissions", () => {
    const ownerId = "doc-owner-1";
    const editorId = "doc-editor-2";

    expect(canChangeDocSharing(ownerId, ownerId)).toBe(true);
    expect(canChangeDocSharing(editorId, ownerId)).toBe(false);
  });

  it("enforces document edit and read access levels strictly", () => {
    const ownerId = "doc-owner-1";
    const otherUserId = "user-2";

    // Owner can read & edit
    expect(canReadDocument(ownerId, ownerId, null)).toBe(true);
    expect(canEditDocument(ownerId, ownerId, null)).toBe(true);

    // Editor can read & edit
    expect(canReadDocument(otherUserId, ownerId, "EDITOR")).toBe(true);
    expect(canEditDocument(otherUserId, ownerId, "EDITOR")).toBe(true);

    // Viewer can read, but CANNOT edit
    expect(canReadDocument(otherUserId, ownerId, "VIEWER")).toBe(true);
    expect(canEditDocument(otherUserId, ownerId, "VIEWER")).toBe(false);

    // Unshared user cannot read or edit
    expect(canReadDocument(otherUserId, ownerId, null)).toBe(false);
    expect(canEditDocument(otherUserId, ownerId, null)).toBe(false);
  });
});

describe("Calendar Conflict Detection (Time Interval Overlap)", () => {
  const baseEvent = {
    startTime: new Date("2026-10-17T14:00:00.000Z"), // 2:00 PM
    endTime: new Date("2026-10-17T15:00:00.000Z"),   // 3:00 PM
  };

  it("detects partial overlap (2:30 PM - 3:30 PM overlaps with 2:00 PM - 3:00 PM)", () => {
    const candidate = {
      startTime: new Date("2026-10-17T14:30:00.000Z"),
      endTime: new Date("2026-10-17T15:30:00.000Z"),
    };
    expect(hasTimeOverlap(baseEvent, candidate)).toBe(true);
  });

  it("detects full containment overlap (2:15 PM - 2:45 PM inside 2:00 PM - 3:00 PM)", () => {
    const candidate = {
      startTime: new Date("2026-10-17T14:15:00.000Z"),
      endTime: new Date("2026-10-17T14:45:00.000Z"),
    };
    expect(hasTimeOverlap(baseEvent, candidate)).toBe(true);
  });

  it("does NOT flag back-to-back boundary meetings as conflicts (3:00 PM - 4:00 PM after 2:00 PM - 3:00 PM)", () => {
    const adjacentAfter = {
      startTime: new Date("2026-10-17T15:00:00.000Z"),
      endTime: new Date("2026-10-17T16:00:00.000Z"),
    };
    const adjacentBefore = {
      startTime: new Date("2026-10-17T13:00:00.000Z"),
      endTime: new Date("2026-10-17T14:00:00.000Z"),
    };
    expect(hasTimeOverlap(baseEvent, adjacentAfter)).toBe(false);
    expect(hasTimeOverlap(baseEvent, adjacentBefore)).toBe(false);
  });
});
