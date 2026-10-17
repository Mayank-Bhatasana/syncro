import { AttendeeStatus, EntryCategory, LeaveStatus, LeaveType, Prisma } from "@prisma/client";
import {
  CalendarEventDTO,
  ConflictDetailDTO,
  EventAttendeeDTO,
  LeaveBalanceDTO,
  LeaveRequestDTO,
  PersonalEntryDTO,
  Role,
  TeamLeaveDTO,
  entryTypeOf,
  ANNUAL_LEAVE_ALLOWANCE,
  AttendeeStatus as SharedAttendeeStatus,
  EntryCategory as SharedEntryCategory,
  LeaveStatus as SharedLeaveStatus,
  LeaveType as SharedLeaveType,
} from "@syncro/shared";
import { prisma } from "../../config/db";
import { canDecideLeave } from "../permissions";
import { annualLeaveRemaining } from "../calendar-rules";
import {
  businessDaysBetween,
  dateKeyOf,
  dayKeysTouchedBy,
  dbDateToKey,
  keyToDbDate,
  todayKey,
} from "../time";

export const ACTIVE_LEAVE_STATUSES: LeaveStatus[] = [LeaveStatus.PENDING, LeaveStatus.APPROVED];
export const BREAK_CATEGORIES: EntryCategory[] = [
  EntryCategory.LUNCH,
  EntryCategory.COFFEE,
  EntryCategory.BREAK,
];

export type LeaveWithUser = Prisma.LeaveRequestGetPayload<{
  include: { user: { include: { department: true } }; decidedBy: true };
}>;

export type EventWithDetails = Prisma.EventGetPayload<{
  include: {
    organizer: true;
    attendees: { include: { user: { include: { department: true } } } };
  };
}>;

export const eventInclude = {
  organizer: true,
  attendees: {
    include: { user: { include: { department: true } } },
    orderBy: { user: { name: "asc" as const } },
  },
};

export const leaveInclude = {
  user: { include: { department: true } },
  decidedBy: true,
};

export async function loadActiveLeave(
  userIds: string[],
  fromKey: string,
  toKey: string
): Promise<LeaveWithUser[]> {
  if (userIds.length === 0) return [];
  return prisma.leaveRequest.findMany({
    where: {
      userId: { in: userIds },
      status: { in: ACTIVE_LEAVE_STATUSES },
      startDate: { lte: keyToDbDate(toKey) },
      endDate: { gte: keyToDbDate(fromKey) },
    },
    include: leaveInclude,
  });
}

/** Leave covers a whole company day, so an interval is on leave if it touches any leave day. */
export function leaveCoversInterval(
  row: { startDate: Date; endDate: Date },
  start: Date,
  end: Date
): boolean {
  const { first, last } = dayKeysTouchedBy(start, end);
  return dbDateToKey(row.startDate) <= last && dbDateToKey(row.endDate) >= first;
}

export function leaveTypeLabel(type: LeaveType | SharedLeaveType): string {
  switch (type) {
    case "ANNUAL":
      return "Annual leave";
    case "SICK":
      return "Sick leave";
    default:
      return "Personal leave";
  }
}

export function leaveDayCount(startDate: Date, endDate: Date): number {
  return businessDaysBetween(dbDateToKey(startDate), dbDateToKey(endDate));
}

export function formatLeaveDTO(
  row: LeaveWithUser,
  viewer: { id: string; role: Role; departmentId: string }
): LeaveRequestDTO {
  const startKey = dbDateToKey(row.startDate);
  const endKey = dbDateToKey(row.endDate);
  const isRequester = row.userId === viewer.id;
  const active = row.status === LeaveStatus.PENDING || row.status === LeaveStatus.APPROVED;

  return {
    id: row.id,
    userId: row.userId,
    userName: row.user.name,
    departmentName: row.user.department.name,
    type: row.type as SharedLeaveType,
    status: row.status as SharedLeaveStatus,
    startDate: startKey,
    endDate: endKey,
    days: businessDaysBetween(startKey, endKey),
    reason: row.reason,
    decisionNote: row.decisionNote,
    decidedByName: row.decidedBy?.name ?? null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    canCancel: isRequester && active && startKey > todayKey(),
    canDecide:
      row.status === LeaveStatus.PENDING &&
      canDecideLeave(viewer, {
        id: row.userId,
        role: row.user.role as Role,
        departmentId: row.user.departmentId,
      }),
  };
}

export function formatTeamLeaveDTO(row: LeaveWithUser): TeamLeaveDTO {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.user.name,
    departmentName: row.user.department.name,
    status: row.status as SharedLeaveStatus,
    startDate: dbDateToKey(row.startDate),
    endDate: dbDateToKey(row.endDate),
  };
}

export function formatEntryDTO(entry: {
  id: string;
  userId: string;
  category: EntryCategory;
  title: string;
  notes: string;
  startTime: Date;
  endTime: Date;
}): PersonalEntryDTO {
  const category = entry.category as SharedEntryCategory;
  return {
    id: entry.id,
    userId: entry.userId,
    category,
    type: entryTypeOf(category),
    title: entry.title,
    notes: entry.notes,
    startTime: entry.startTime.toISOString(),
    endTime: entry.endTime.toISOString(),
  };
}

export async function leaveBalanceFor(userId: string, now: Date = new Date()): Promise<LeaveBalanceDTO> {
  const year = dateKeyOf(now).slice(0, 4);
  const rows = await prisma.leaveRequest.findMany({
    where: {
      userId,
      type: LeaveType.ANNUAL,
      status: { in: ACTIVE_LEAVE_STATUSES },
      startDate: {
        gte: keyToDbDate(`${year}-01-01`),
        lte: keyToDbDate(`${year}-12-31`),
      },
    },
  });

  let used = 0;
  let pending = 0;
  for (const row of rows) {
    const days = leaveDayCount(row.startDate, row.endDate);
    if (row.status === LeaveStatus.APPROVED) used += days;
    else pending += days;
  }

  return {
    annualAllowance: ANNUAL_LEAVE_ALLOWANCE,
    annualUsed: used,
    annualPending: pending,
    annualRemaining: annualLeaveRemaining(used, pending),
  };
}

/** Breaks are hard blocks: anyone on break during the interval makes the booking impossible. */
export async function findBreakConflicts(
  userIds: string[],
  start: Date,
  end: Date
): Promise<ConflictDetailDTO[]> {
  if (userIds.length === 0) return [];
  const rows = await prisma.personalEntry.findMany({
    where: {
      userId: { in: userIds },
      category: { in: BREAK_CATEGORIES },
      startTime: { lt: end },
      endTime: { gt: start },
    },
    include: { user: true },
    orderBy: { startTime: "asc" },
  });
  return rows.map((r) => ({
    userId: r.userId,
    name: r.user.name,
    reason: "BREAK" as const,
    label: r.title,
    startTime: r.startTime.toISOString(),
    endTime: r.endTime.toISOString(),
  }));
}

/** Meetings this person is invited to (not excused) that overlap the interval. */
export async function findMeetingOverlaps(userIds: string[], start: Date, end: Date) {
  if (userIds.length === 0) return [];
  return prisma.eventAttendee.findMany({
    where: {
      userId: { in: userIds },
      status: { not: AttendeeStatus.EXCUSED },
      event: { startTime: { lt: end }, endTime: { gt: start } },
    },
    select: {
      userId: true,
      user: { select: { name: true } },
      event: { select: { title: true, startTime: true, endTime: true } },
    },
  });
}

/** Soft conflicts: meetings and personal activities that overlap. Booking still goes through. */
export async function findSoftConflictUserIds(
  userIds: string[],
  start: Date,
  end: Date
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const [meetings, activities] = await Promise.all([
    findMeetingOverlaps(userIds, start, end),
    prisma.personalEntry.findMany({
      where: {
        userId: { in: userIds },
        category: { notIn: BREAK_CATEGORIES },
        startTime: { lt: end },
        endTime: { gt: start },
      },
      select: { userId: true },
    }),
  ]);
  return new Set([...meetings.map((m) => m.userId), ...activities.map((a) => a.userId)]);
}

export function formatEventDTO(
  event: EventWithDetails,
  currentUserId: string,
  leaveRows: LeaveWithUser[] = []
): CalendarEventDTO {
  const myAttendee = event.attendees.find((a) => a.userId === currentUserId);

  return {
    id: event.id,
    organizerId: event.organizerId,
    organizerName: event.organizer.name,
    title: event.title,
    description: event.description,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    createdAt: event.createdAt.toISOString(),
    myStatus: myAttendee?.status as SharedAttendeeStatus | undefined,
    myHasConflict: myAttendee?.hasConflict,
    attendees: event.attendees.map((a): EventAttendeeDTO => ({
      userId: a.userId,
      name: a.user.name,
      email: a.user.email,
      departmentName: a.user.department.name,
      role: a.user.role as Role,
      status: a.status as SharedAttendeeStatus,
      hasConflict: a.hasConflict,
      onLeave: leaveRows.some(
        (row) => row.userId === a.userId && leaveCoversInterval(row, event.startTime, event.endTime)
      ),
      excuseReason: a.excuseReason,
      organizerReply: a.organizerReply,
      respondedAt: a.respondedAt ? a.respondedAt.toISOString() : null,
    })),
  };
}

/** Leave rows relevant to the attendees of a set of events, for the "on leave" flags. */
export async function leaveRowsForEvents(events: EventWithDetails[]): Promise<LeaveWithUser[]> {
  if (events.length === 0) return [];
  const userIds = Array.from(new Set(events.flatMap((e) => e.attendees.map((a) => a.userId))));
  const starts = events.map((e) => e.startTime.getTime());
  const ends = events.map((e) => e.endTime.getTime());
  return loadActiveLeave(
    userIds,
    dateKeyOf(new Date(Math.min(...starts))),
    dateKeyOf(new Date(Math.max(...ends)))
  );
}
