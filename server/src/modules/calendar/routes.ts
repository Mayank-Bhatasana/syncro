import { Router, Request, Response } from "express";
import { AttendeeStatus } from "@prisma/client";
import { prisma } from "../../config/db";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  CreateEventSchema,
  RequestExcuseSchema,
  DecideExcuseSchema,
  CalendarEventDTO,
  BusyBlockDTO,
  Role,
  AttendeeStatus as SharedAttendeeStatus,
} from "@syncro/shared";
import {
  canInviteTargetScope,
  canDecideExcuse,
} from "../permissions";
import { getIO } from "../../socket";

export const calendarRouter = Router();

calendarRouter.use(requireAuth);

function formatEventDTO(event: any, currentUserId: string): CalendarEventDTO {
  const myAttendee = event.attendees.find((a: any) => a.userId === currentUserId);
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
    attendees: event.attendees.map((a: any) => ({
      userId: a.userId,
      name: a.user.name,
      email: a.user.email,
      departmentName: a.user.department.name,
      role: a.user.role as Role,
      status: a.status as SharedAttendeeStatus,
      hasConflict: a.hasConflict,
      excuseReason: a.excuseReason,
      organizerReply: a.organizerReply,
      respondedAt: a.respondedAt ? a.respondedAt.toISOString() : null,
    })),
  };
}

// GET /calendar?from&to — "events where I'm an attendee" (or organizer)
calendarRouter.get("/calendar", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;

    const events = await prisma.event.findMany({
      where: {
        AND: [
          {
            OR: [
              { attendees: { some: { userId } } },
              { organizerId: userId },
            ],
          },
          ...(from ? [{ endTime: { gt: from } }] : []),
          ...(to ? [{ startTime: { lt: to } }] : []),
        ],
      },
      include: {
        organizer: true,
        attendees: {
          include: {
            user: {
              include: { department: true },
            },
          },
          orderBy: { user: { name: "asc" } },
        },
      },
      orderBy: { startTime: "asc" },
    });

    const formatted = events.map((ev) => formatEventDTO(ev, userId));
    res.json({ events: formatted });
  } catch (err) {
    console.error("Failed to fetch calendar:", err);
    res.status(500).json({ error: "Failed to fetch calendar" });
  }
});

// GET /availability?userIds&from&to — Returns ONLY busy time blocks (start & end), never titles or descriptions
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

      const from = req.query.from
        ? new Date(String(req.query.from))
        : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const to = req.query.to
        ? new Date(String(req.query.to))
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Single query for overlapping events on those users where they aren't EXCUSED
      const busyAttendances = await prisma.eventAttendee.findMany({
        where: {
          userId: { in: rawUserIds },
          status: { not: AttendeeStatus.EXCUSED },
          event: {
            startTime: { lt: to },
            endTime: { gt: from },
          },
        },
        select: {
          userId: true,
          event: {
            select: {
              startTime: true,
              endTime: true,
            },
          },
        },
      });

      const busyBlocks: BusyBlockDTO[] = busyAttendances.map((row) => ({
        userId: row.userId,
        startTime: row.event.startTime.toISOString(),
        endTime: row.event.endTime.toISOString(),
      }));

      res.json({ busyBlocks });
    } catch (err) {
      console.error("Failed to check availability:", err);
      res.status(500).json({ error: "Failed to check availability" });
    }
  }
);

// POST /events — Manager books a meeting for "everyone", "departments" (e.g. IT), or "specific users"
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
      } = req.body;

      // Rule: Only managers (or admins) can invite departments or everyone
      if (!canInviteTargetScope(organizer.role, targetScope)) {
        res.status(403).json({
          error:
            "Forbidden: Only managers or admins can book meetings for entire departments or everyone",
        });
        return;
      }

      // 1. Expand targets into a deduplicated list of individual user IDs
      const resolvedUserIds = new Set<string>([organizer.id]);

      if (targetScope === "ALL") {
        const allUsers = await prisma.user.findMany({ select: { id: true } });
        allUsers.forEach((u) => resolvedUserIds.add(u.id));
      } else {
        if (departmentIds && departmentIds.length > 0) {
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
          deptUsers.forEach((u) => resolvedUserIds.add(u.id));
        }

        if (userIds && userIds.length > 0) {
          userIds.forEach((id: string) => resolvedUserIds.add(id));
        }
      }

      const targetUserIdList = Array.from(resolvedUserIds);
      const start = new Date(startTime);
      const end = new Date(endTime);

      // 2. Check for conflicts using ONE query for overlapping events on those users
      const overlappingAttendances = await prisma.eventAttendee.findMany({
        where: {
          userId: { in: targetUserIdList },
          status: { not: AttendeeStatus.EXCUSED },
          event: {
            startTime: { lt: end },
            endTime: { gt: start },
          },
        },
        select: {
          userId: true,
        },
      });

      const conflictingUserIds = new Set(
        overlappingAttendances.map((row) => row.userId)
      );

      // 3. Create one Event and one EventAttendee row per person
      const createdEvent = await prisma.event.create({
        data: {
          organizerId: organizer.id,
          title,
          description: description || "",
          startTime: start,
          endTime: end,
          attendees: {
            create: targetUserIdList.map((uid) => ({
              userId: uid,
              status:
                uid === organizer.id
                  ? AttendeeStatus.ACCEPTED
                  : AttendeeStatus.INVITED,
              hasConflict: conflictingUserIds.has(uid),
            })),
          },
        },
        include: {
          organizer: true,
          attendees: {
            include: {
              user: { include: { department: true } },
            },
            orderBy: { user: { name: "asc" } },
          },
        },
      });

      const eventDTO = formatEventDTO(createdEvent, organizer.id);

      // 4. Push a notification over WebSocket to each attendee
      try {
        const io = getIO();
        for (const uid of targetUserIdList) {
          io.to(`user:${uid}`).emit("event:invited", {
            event: formatEventDTO(createdEvent, uid),
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
        include: {
          organizer: true,
          attendees: {
            include: { user: { include: { department: true } } },
            orderBy: { user: { name: "asc" } },
          },
        },
      });

      res.json({ event: formatEventDTO(updatedEvent, userId) });
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
        include: {
          organizer: true,
          attendees: {
            include: { user: { include: { department: true } } },
            orderBy: { user: { name: "asc" } },
          },
        },
      });

      // Notify the boss (organizer) in real time over WebSocket
      try {
        const io = getIO();
        io.to(`user:${updatedEvent!.organizerId}`).emit("event:excuse_requested", {
          eventId,
          eventTitle: updatedEvent!.title,
          attendeeId: user.id,
          attendeeName: user.name,
          reason,
          event: formatEventDTO(updatedEvent, updatedEvent!.organizerId),
        });
      } catch {
        // Ignore if socket server not initialized
      }

      res.json({ event: formatEventDTO(updatedEvent, user.id) });
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
        include: {
          organizer: true,
          attendees: {
            include: { user: { include: { department: true } } },
            orderBy: { user: { name: "asc" } },
          },
        },
      });

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
          event: formatEventDTO(updatedEvent, attendeeUserId),
        });
      } catch {
        // Ignore if socket server not initialized
      }

      res.json({ event: formatEventDTO(updatedEvent, boss.id) });
    } catch (err) {
      console.error("Failed to decide excuse:", err);
      res.status(500).json({ error: "Failed to decide excuse" });
    }
  }
);
