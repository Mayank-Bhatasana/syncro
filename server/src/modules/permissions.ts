import { Role, TargetScope, DocAccessLevel } from "@syncro/shared";

/**
 * Pure permission & conflict helper functions so they can be enforced
 * consistently across HTTP routes, WebSocket handlers, and unit tests.
 */

export function canInviteTargetScope(role: Role, scope: TargetScope): boolean {
  if (scope === "USERS") {
    return true; // Any employee, manager, or admin can invite specific individuals
  }
  // Only MANAGER or ADMIN can invite entire departments or everyone in the company
  return role === "MANAGER" || role === "ADMIN";
}

export function canDecideExcuse(userId: string, eventOrganizerId: string): boolean {
  return userId === eventOrganizerId;
}

export function canChangeDocSharing(userId: string, docOwnerId: string): boolean {
  return userId === docOwnerId;
}

export function canEditDocument(
  userId: string,
  docOwnerId: string,
  permissionLevel?: DocAccessLevel | null
): boolean {
  if (userId === docOwnerId) return true;
  return permissionLevel === "EDITOR";
}

export function canReadDocument(
  userId: string,
  docOwnerId: string,
  permissionLevel?: DocAccessLevel | null
): boolean {
  if (userId === docOwnerId) return true;
  return permissionLevel === "EDITOR" || permissionLevel === "VIEWER";
}

export interface TimeInterval {
  startTime: Date;
  endTime: Date;
}

/**
 * Checks if two [startTime, endTime) intervals overlap.
 * Adjacent intervals (e.g. 2:00-3:00 and 3:00-4:00) do NOT overlap.
 */
export function hasTimeOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.startTime < b.endTime && a.endTime > b.startTime;
}
