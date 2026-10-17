import { Router, Request, Response } from "express";
import { AttendeeStatus } from "@prisma/client";
import { prisma } from "../../config/db";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  CreateEventSchema,
  RequestExcuseSchema,
  DecideExcuseSchema,
  BusyBlockDTO,
  ConflictDetailDTO,
} from "@syncro/shared";
import { canInviteTargetScope, canDecideExcuse } from "../permissions";
import {
  dateKeyOf,
  dayEndOf,
  dayKeysTouchedBy,
  dayStartOf,
  dbDateToKey,
} from "../time";
import { getIO } from "../../socket";
import {
  BREAK_CATEGORIES,
  EventWithDetails,
  eventInclude,
  findBreakConflicts,
  findMeetingOverlaps,
  findSoftConflictUserIds,
  formatEventDTO,
  leaveRowsForEvents,
  leaveCoversInterval,
  leaveTypeLabel,
  loadActiveLeave,
  LeaveWithUser,
} from "./data";

export const calendarRouter = Router();

calendarRouter.use(requireAuth);

const PAST_GRACE_MS = 5 * 60 * 1000;

function parseRange(from: unknown, to: unknown, fallbackDays: [number, number]) {
  const now = Date.now();
  const start = from ? new Date(String(from)) : new Date(now - fallbackDays[0] * 86400000);
  const end = to ? new Date(String(to)) : new Date(now + fallbackDays[1] * 86400000);
  return { start, end };
}

// GET /calendar?from&to — "events where I'm an attendee" (or organizer)
calendarRouter.get("/calendar", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { start: from, end: to } = parseRange(req.query.from, req.query.to, [0, 0]);
    const hasFrom = Boolean(req.query.from);
    const hasTo = Boolean(req.query.to);

    const events: EventWithDetails[] = await prisma.event.findMany({
      where: {
        AND: [
          {
            OR: [
              { attendees: { some: { userId } } },
              { organizerId: userId },
            ],
          },
          ...(hasFrom ? [{ endTime: { gt: from } }] : []),
          ...(hasTo ? [{ startTime: { lt: to } }] : []),
        ],
      },
      include: eventInclude,
      orderBy: { startTime: "asc" },
    });

    const leaveRows = await leaveRowsForEvents(events);
    res.json({ events: events.map((ev) => formatEventDTO(ev, userId, leaveRows)) });
  } catch (err) {
    console.error("Failed to fetch calendar:", err);
    res.status(500).json({ error: "Failed to fetch calendar" });
  }
});

// GET /availability?userIds&from&to — busy blocks only (times and kind), never titles or descriptions
calendarRouter.get(
  "/availability",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const rawUserIds = String(req.query.userIds || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      if (rawUserIds.length === 0) {
        res.json({ busyBlocks: [] });
        return;
      }

      const { start: from, end: to } = parseRange(req.query.from, req.query.to, [1, 14]);

      const [meetings, entries, leaveRows] = await Promise.all([
        findMeetingOverlaps(rawUserIds, from, to),
        prisma.personalEntry.findMany({
          where: {
            userId: { in: rawUserIds },
            startTime: { lt: to },
            endTime: { gt: from },
          },
          select: { userId: true, category: true, startTime: true, endTime: true },
        }),
        loadActiveLeave(rawUserIds, dateKeyOf(from), dateKeyOf(to)),
      ]);

      const busyBlocks: BusyBlockDTO[] = [
        ...meetings.map((m) => ({
          userId: m.userId,
          startTime: m.event.startTime.toISOString(),
          endTime: m.event.endTime.toISOString(),
          type: "MEETING" as const,
          label: "Busy",
        })),
        ...entries.map((e) => {
          const isBreak = (BREAK_CATEGORIES as string[]).includes(e.category);
          return {
            userId: e.userId,
            startTime: e.startTime.toISOString(),
            endTime: e.endTime.toISOString(),
            type: isBreak ? ("BREAK" as const) : ("ACTIVITY" as const),
            label: isBreak ? "Break" : "Busy",
          };
        }),
        ...leaveRows.map((row) => ({
          userId: row.userId,
          startTime: dayStartOf(dbDateToKey(row.startDate)).toISOString(),
          endTime: dayEndOf(dbDateToKey(row.endDate)).toISOString(),
          type: "LEAVE" as const,
          label: "On leave",
        })),
      ].sort((a, b) => a.startTime.localeCompare(b.startTime));

      res.json({ busyBlocks });
    } catch (err) {
      console.error("Failed to check availability:", err);
      res.status(500).json({ error: "Failed to check availability" });
    }
  }
);

// POST /events — book a meeting for specific people, a department, or everyone
calendarRouter.post(
  "/events",
  validateBody(CreateEventSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizer = req.user!;
      const {
        title,
        description,
        startTime,
        endTime,
        targetScope,
        departmentIds,
        userIds,
        excludeUserIds,
      } = req.body;

      // Rule: Only managers (or admins) can invite departments or everyone
      if (!canInviteTargetScope(organizer.role, targetScope)) {
        res.status(403).json({
          error:
            "Forbidden: Only managers or admins can book meetings for entire departments or everyone",
        });
        return;
      }

      const start = new Date(startTime);
      const end = new Date(endTime);

      if (start.getTime() < Date.now() - PAST_GRACE_MS) {
        res.status(400).json({ error: "Meetings can't be booked in the past." });
        return;
      }

      // 1. Separate people the host picked by hand from people pulled in by a department or "everyone"
      const pickedIds = new Set<string>(targetScope === "ALL" ? [] : userIds);
      const expandedIds = new Set<string>();

      if (targetScope === "ALL") {
        const allUsers = await prisma.user.findMany({ select: { id: true } });
        allUsers.forEach((u) => expandedIds.add(u.id));
      } else if (departmentIds.length > 0) {
        // Even if scope is USERS, if departmentIds are passed by a non-manager, guard it
        if (!canInviteTargetScope(organizer.role, "DEPARTMENT")) {
          res.status(403).json({
            error: "Forbidden: Only managers can invite entire departments",
          });
          return;
        }
        const deptUsers = await prisma.user.findMany({
          where: { departmentId: { in: departmentIds } },
          select: { id: true },
        });
        deptUsers.forEach((u) => expandedIds.add(u.id));
      }

      for (const id of excludeUserIds) {
        expandedIds.delete(id);
      }

      const candidateIds = Array.from(new Set([organizer.id, ...pickedIds, ...expandedIds]));

      // 2. Leave: anyone the host picked by hand who is on leave blocks the booking
      const { first, last } = dayKeysTouchedBy(start, end);
      const leaveRows = (await loadActiveLeave(candidateIds, first, last)).filter((row) =>
        leaveCoversInterval(row, start, end)
      );
      const leaveByUser = new Map<string, LeaveWithUser>();
      for (const row of leaveRows) {
        if (!leaveByUser.has(row.userId)) leaveByUser.set(row.userId, row);
      }

      const pickedOnLeave = Array.from(new Set([organizer.id, ...pickedIds])).filter((id) =>
        leaveByUser.has(id)
      );
      if (pickedOnLeave.length > 0) {
        const details = pickedOnLeave.map((id) => {
          const row = leaveByUser.get(id)!;
          return {
            userId: id,
            name: row.user.name,
            reason: "LEAVE" as const,
            label: `${leaveTypeLabel(row.type)}${row.status === "PENDING" ? " (requested)" : ""}`,
            startTime: dayStartOf(dbDateToKey(row.startDate)).toISOString(),
            endTime: dayEndOf(dbDateToKey(row.endDate)).toISOString(),
          };
        });
        const names = details.map((d) => d.name).join(", ");
        res.status(409).json({
          error: `${names} ${details.length === 1 ? "is" : "are"} on leave that day. Remove ${
            details.length === 1 ? "them" : "those people"
          } from the invite or pick another date.`,
          details,
        });
        return;
      }

      // Department or company-wide invites skip people on leave and report them back
      const excludedOnLeave = Array.from(expandedIds)
        .filter((id) => leaveByUser.has(id) && !pickedIds.has(id) && id !== organizer.id)
        .map((id) => ({ userId: id, name: leaveByUser.get(id)!.user.name }));
      excludedOnLeave.forEach((e) => expandedIds.delete(e.userId));

      const targetIds = Array.from(new Set([organizer.id, ...pickedIds, ...expandedIds]));

      // 3. Breaks are hard blocks: no meeting may overlap anyone's break
      const breakConflicts: ConflictDetailDTO[] = await findBreakConflicts(targetIds, start, end);
      if (breakConflicts.length > 0) {
        const names = Array.from(new Set(breakConflicts.map((c) => c.name)));
        const preview = names.slice(0, 3).join(", ");
        const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
        res.status(409).json({
          error: `Can't book this slot: ${preview}${more} ${
            names.length === 1 ? "is" : "are"
          } on break at that time. Pick another time.`,
          details: breakConflicts,
        });
        return;
      }

      // 4. Soft conflicts: meetings and personal activities that overlap. The invite still goes out.
      const conflictingUserIds = await findSoftConflictUserIds(targetIds, start, end);

      const createdEvent = await prisma.event.create({
        data: {
          organizerId: organizer.id,
          title,
          description: description || "",
          startTime: start,
          endTime: end,
          attendees: {
            create: targetIds.map((uid) => ({
              userId: uid,
              status: uid === organizer.id ? AttendeeStatus.ACCEPTED : AttendeeStatus.INVITED,
              hasConflict: conflictingUserIds.has(uid),
            })),
          },
        },
        include: eventInclude,
      });

      const eventDTO = formatEventDTO(createdEvent, organizer.id, leaveRows);

      try {
        const io = getIO();
        for (const uid of targetIds) {
          io.to(`user:${uid}`).emit("event:invited", {
            event: formatEventDTO(createdEvent, uid, leaveRows),
            hasConflict: conflictingUserIds.has(uid),
          });
        }
      } catch {
        // Ignore if socket server not initialized in unit tests
      }

      res.status(201).json({
        event: eventDTO,
        conflictsCount: conflictingUserIds.size,
        conflictingUserIds: Array.from(conflictingUserIds),
        excludedOnLeave,
      });
    } catch (err) {
      console.error("Failed to create event:", err);
      res.status(500).json({ error: "Failed to create event" });
    }
  }
);

// PATCH /events/:id/accept — Attendee accepts the meeting invite
calendarRouter.patch(
  "/events/:id/accept",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const eventId = String(req.params.id);

      const attendee = await prisma.eventAttendee.findUnique({
        where: {
          eventId_userId: { eventId, userId },
        },
      });

      if (!attendee) {
        res.status(404).json({ error: "You are not an attendee of this event" });
        return;
      }

      await prisma.eventAttendee.update({
        where: { eventId_userId: { eventId, userId } },
        data: {
          status: AttendeeStatus.ACCEPTED,
          respondedAt: new Date(),
        },
      });

      const updatedEvent = await prisma.event.findUnique({
        where: { id: eventId },
        include: eventInclude,
      });
      const leaveRows = await leaveRowsForEvents([updatedEvent!]);

      res.json({ event: formatEventDTO(updatedEvent!, userId, leaveRows) });
    } catch (err) {
      console.error("Failed to accept event:", err);
      res.status(500).json({ error: "Failed to accept event" });
    }
  }
);

// PATCH /events/:id/excuse — Attendee has a conflict/reason and tells the boss "Hey I can't be there" with a message
calendarRouter.patch(
  "/events/:id/excuse",
  validateBody(RequestExcuseSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const eventId = String(req.params.id);
      const { reason } = req.body;

      const attendee = await prisma.eventAttendee.findUnique({
        where: {
          eventId_userId: { eventId, userId: user.id },
        },
      });

      if (!attendee) {
        res.status(404).json({ error: "You are not an attendee of this event" });
        return;
      }

      await prisma.eventAttendee.update({
        where: {
          eventId_userId: { eventId, userId: user.id },
        },
        data: {
          status: AttendeeStatus.EXCUSE_PENDING,
          excuseReason: reason,
          respondedAt: new Date(),
        },
      });

      const updatedEvent = await prisma.event.findUnique({
        where: { id: eventId },
        include: eventInclude,
      });
      const leaveRows = await leaveRowsForEvents([updatedEvent!]);

      // Notify the boss (organizer) in real time
      try {
        const io = getIO();
        io.to(`user:${updatedEvent!.organizerId}`).emit("event:excuse_requested", {
          eventId,
          eventTitle: updatedEvent!.title,
          attendeeId: user.id,
          attendeeName: user.name,
          reason,
          event: formatEventDTO(updatedEvent!, updatedEvent!.organizerId, leaveRows),
        });
      } catch {
        // Ignore if socket server not initialized
      }

      res.json({ event: formatEventDTO(updatedEvent!, user.id, leaveRows) });
    } catch (err) {
      console.error("Failed to submit excuse request:", err);
      res.status(500).json({ error: "Failed to submit excuse request" });
    }
  }
);

// PATCH /events/:id/attendees/:userId/decision — Boss (organizer) allows or denies the excuse request with a message
calendarRouter.patch(
  "/events/:id/attendees/:userId/decision",
  validateBody(DecideExcuseSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const boss = req.user!;
      const eventId = String(req.params.id);
      const attendeeUserId = String(req.params.userId);
      const { decision, replyMessage } = req.body;

      const event = await prisma.event.findUnique({
        where: { id: eventId },
      });

      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }

      // Rule: Only the organizer who made the meeting can allow or deny the excuse
      if (!canDecideExcuse(boss.id, event.organizerId)) {
        res.status(403).json({
          error: "Forbidden: Only the meeting organizer can approve or deny excuse requests",
        });
        return;
      }

      const newStatus =
        decision === "ALLOW"
          ? AttendeeStatus.EXCUSED
          : AttendeeStatus.EXCUSE_DENIED;

      await prisma.eventAttendee.update({
        where: {
          eventId_userId: {
            eventId,
            userId: attendeeUserId,
          },
        },
        data: {
          status: newStatus,
          organizerReply: replyMessage,
        },
      });

      const updatedEvent = await prisma.event.findUnique({
        where: { id: eventId },
        include: eventInclude,
      });
      const leaveRows = await leaveRowsForEvents([updatedEvent!]);

      // Notify the attendee in real time with the boss's decision & message
      try {
        const io = getIO();
        io.to(`user:${attendeeUserId}`).emit("event:excuse_decided", {
          eventId,
          eventTitle: updatedEvent!.title,
          organizerName: boss.name,
          decision,
          status: newStatus,
          replyMessage,
          event: formatEventDTO(updatedEvent!, attendeeUserId, leaveRows),
        });
      } catch {
        // Ignore if socket server not initialized
      }

      res.json({ event: formatEventDTO(updatedEvent!, boss.id, leaveRows) });
    } catch (err) {
      console.error("Failed to decide excuse:", err);
      res.status(500).json({ error: "Failed to decide excuse" });
    }
  }
);
