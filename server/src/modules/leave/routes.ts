import { Router, Request, Response } from "express";
import { LeaveStatus, LeaveType } from "@prisma/client";
import { prisma } from "../../config/db";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { CreateLeaveRequestSchema, LeaveDecisionSchema } from "@syncro/shared";
import { canDecideLeave } from "../permissions";
import { validateLeaveDates } from "../calendar-rules";
import { addDays, businessDaysBetween, dbDateToKey, keyToDbDate, todayKey } from "../time";
import { getIO } from "../../socket";
import {
  ACTIVE_LEAVE_STATUSES,
  formatLeaveDTO,
  formatTeamLeaveDTO,
  leaveBalanceFor,
  leaveInclude,
} from "../calendar/data";

export const leaveRouter = Router();

leaveRouter.use(requireAuth);

// GET /leave — my leave requests and my annual leave balance
leaveRouter.get("/leave", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const rows = await prisma.leaveRequest.findMany({
      where: { userId: user.id },
      include: leaveInclude,
      orderBy: { startDate: "desc" },
      take: 60,
    });
    const balance = await leaveBalanceFor(user.id);
    res.json({ requests: rows.map((r) => formatLeaveDTO(r, user)), balance });
  } catch (err) {
    console.error("Failed to load leave:", err);
    res.status(500).json({ error: "Failed to load leave" });
  }
});

// GET /leave/approvals — pending requests I'm allowed to decide
leaveRouter.get("/leave/approvals", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    if (user.role === "EMPLOYEE") {
      res.json({ requests: [] });
      return;
    }

    const rows = await prisma.leaveRequest.findMany({
      where: {
        status: LeaveStatus.PENDING,
        userId: { not: user.id },
        ...(user.role === "MANAGER" ? { user: { departmentId: user.departmentId } } : {}),
      },
      include: leaveInclude,
      orderBy: { startDate: "asc" },
    });

    res.json({ requests: rows.map((r) => formatLeaveDTO(r, user)) });
  } catch (err) {
    console.error("Failed to load approvals:", err);
    res.status(500).json({ error: "Failed to load approvals" });
  }
});

// GET /leave/team?from&to — who is out (dates and status only, never the reason)
leaveRouter.get("/leave/team", async (req: Request, res: Response) => {
  try {
    const from = req.query.from ? String(req.query.from) : todayKey();
    const to = req.query.to ? String(req.query.to) : addDays(todayKey(), 14);

    const rows = await prisma.leaveRequest.findMany({
      where: {
        status: { in: ACTIVE_LEAVE_STATUSES },
        startDate: { lte: keyToDbDate(to) },
        endDate: { gte: keyToDbDate(from) },
      },
      include: leaveInclude,
      orderBy: { startDate: "asc" },
    });

    res.json({ leaves: rows.map(formatTeamLeaveDTO) });
  } catch (err) {
    console.error("Failed to load team leave:", err);
    res.status(500).json({ error: "Failed to load team leave" });
  }
});

// POST /leave — request leave in advance (starts tomorrow at the earliest)
leaveRouter.post(
  "/leave",
  validateBody(CreateLeaveRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const { type, startDate, endDate, reason } = req.body;

      const dateError = validateLeaveDates({
        startKey: startDate,
        endKey: endDate,
        todayKey: todayKey(),
      });
      if (dateError) {
        res.status(400).json({ error: dateError });
        return;
      }

      const overlapping = await prisma.leaveRequest.findFirst({
        where: {
          userId: user.id,
          status: { in: ACTIVE_LEAVE_STATUSES },
          startDate: { lte: keyToDbDate(endDate) },
          endDate: { gte: keyToDbDate(startDate) },
        },
      });
      if (overlapping) {
        res.status(409).json({
          error: "You already have leave requested or approved for part of these dates.",
        });
        return;
      }

      const days = businessDaysBetween(startDate, endDate);
      if (type === "ANNUAL") {
        const balance = await leaveBalanceFor(user.id);
        if (days > balance.annualRemaining) {
          res.status(400).json({
            error: `Not enough annual leave left. You have ${balance.annualRemaining} day(s) remaining and this request is ${days} working day(s).`,
          });
          return;
        }
      }

      const created = await prisma.leaveRequest.create({
        data: {
          userId: user.id,
          type: type as LeaveType,
          status: LeaveStatus.PENDING,
          startDate: keyToDbDate(startDate),
          endDate: keyToDbDate(endDate),
          reason,
        },
        include: leaveInclude,
      });

      // Let the people who can approve this know straight away
      const approvers = await prisma.user.findMany({
        where: {
          id: { not: user.id },
          OR: [{ role: "ADMIN" }, { role: "MANAGER", departmentId: user.departmentId }],
        },
        select: { id: true },
      });
      try {
        const io = getIO();
        for (const approver of approvers) {
          io.to(`user:${approver.id}`).emit("leave:requested", {
            leaveId: created.id,
            userName: user.name,
            type,
            startDate,
            endDate,
          });
        }
      } catch {
        // Socket server not initialized
      }

      res.status(201).json({ leave: formatLeaveDTO(created, user) });
    } catch (err) {
      console.error("Failed to request leave:", err);
      res.status(500).json({ error: "Failed to request leave" });
    }
  }
);

// PATCH /leave/:id/decision — manager of the same department (or an admin) approves or rejects
leaveRouter.patch(
  "/leave/:id/decision",
  validateBody(LeaveDecisionSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const approver = req.user!;
      const id = String(req.params.id);
      const { decision, note } = req.body;

      const leave = await prisma.leaveRequest.findUnique({
        where: { id },
        include: leaveInclude,
      });
      if (!leave) {
        res.status(404).json({ error: "Leave request not found" });
        return;
      }

      if (
        !canDecideLeave(approver, {
          id: leave.userId,
          role: leave.user.role,
          departmentId: leave.user.departmentId,
        })
      ) {
        res.status(403).json({
          error: "Only the department manager or an admin can decide this request.",
        });
        return;
      }

      if (leave.status !== LeaveStatus.PENDING) {
        res.status(409).json({ error: "This request has already been decided." });
        return;
      }

      const updated = await prisma.leaveRequest.update({
        where: { id },
        data: {
          status: decision === "APPROVE" ? LeaveStatus.APPROVED : LeaveStatus.REJECTED,
          decidedById: approver.id,
          decidedAt: new Date(),
          decisionNote: note || null,
        },
        include: leaveInclude,
      });

      try {
        const io = getIO();
        io.to(`user:${leave.userId}`).emit("leave:decided", {
          leaveId: id,
          status: updated.status,
          type: leave.type,
          startDate: dbDateToKey(leave.startDate),
          endDate: dbDateToKey(leave.endDate),
          decidedByName: approver.name,
          decisionNote: note || null,
        });
      } catch {
        // Socket server not initialized
      }

      res.json({ leave: formatLeaveDTO(updated, approver) });
    } catch (err) {
      console.error("Failed to decide leave:", err);
      res.status(500).json({ error: "Failed to decide leave" });
    }
  }
);

// PATCH /leave/:id/cancel — requester withdraws a request before it starts
leaveRouter.patch("/leave/:id/cancel", async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const id = String(req.params.id);

    const leave = await prisma.leaveRequest.findUnique({
      where: { id },
      include: leaveInclude,
    });
    if (!leave || leave.userId !== user.id) {
      res.status(404).json({ error: "Leave request not found" });
      return;
    }

    const stillActive = ACTIVE_LEAVE_STATUSES.includes(leave.status);
    const notStarted = dbDateToKey(leave.startDate) > todayKey();
    if (!stillActive || !notStarted) {
      res.status(409).json({ error: "This leave can no longer be cancelled." });
      return;
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveStatus.CANCELLED },
      include: leaveInclude,
    });

    res.json({ leave: formatLeaveDTO(updated, user) });
  } catch (err) {
    console.error("Failed to cancel leave:", err);
    res.status(500).json({ error: "Failed to cancel leave" });
  }
});
