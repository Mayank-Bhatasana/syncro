import { Router, Request, Response } from "express";
import { EntryCategory } from "@prisma/client";
import { prisma } from "../../config/db";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { CreatePersonalEntrySchema } from "@syncro/shared";
import { isBreakCategory, repeatDayKeys, validateEntryWindow } from "../calendar-rules";
import { dateKeyOf, timeOfDay, zonedInstant } from "../time";
import { BREAK_CATEGORIES, findMeetingOverlaps, formatEntryDTO } from "./data";

export const entriesRouter = Router();

entriesRouter.use(requireAuth);

const DAY_MS = 24 * 60 * 60 * 1000;

// GET /entries?from&to — my own breaks and activities
entriesRouter.get("/entries", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - DAY_MS);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 14 * DAY_MS);

    const rows = await prisma.personalEntry.findMany({
      where: { userId, startTime: { lt: to }, endTime: { gt: from } },
      orderBy: { startTime: "asc" },
    });

    res.json({ entries: rows.map(formatEntryDTO) });
  } catch (err) {
    console.error("Failed to load entries:", err);
    res.status(500).json({ error: "Failed to load entries" });
  }
});

// POST /entries — add a break or an activity (optionally repeated on weekdays for N weeks)
entriesRouter.post(
  "/entries",
  validateBody(CreatePersonalEntrySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const { category, title, notes, startTime, endTime, repeatWeeks } = req.body;
      const start = new Date(startTime);
      const end = new Date(endTime);
      const now = new Date();

      const windowError = validateEntryWindow({
        category: category as EntryCategory,
        start,
        end,
        now,
      });
      if (windowError) {
        res.status(400).json({ error: windowError });
        return;
      }

      const durationMs = end.getTime() - start.getTime();
      const occurrences =
        repeatWeeks > 0
          ? repeatDayKeys(dateKeyOf(start), repeatWeeks).map((key) => {
              const s = zonedInstant(key, timeOfDay(start));
              return { start: s, end: new Date(s.getTime() + durationMs) };
            })
          : [{ start, end }];

      const isBreak = isBreakCategory(category as EntryCategory);
      const conflicts: { label: string; startTime: string; endTime: string }[] = [];

      for (const occ of occurrences) {
        const occError = validateEntryWindow({
          category: category as EntryCategory,
          start: occ.start,
          end: occ.end,
          now,
        });
        if (occError) {
          res.status(400).json({ error: occError });
          return;
        }

        if (isBreak) {
          // A break can't overlap a meeting I'm invited to
          const meetings = await findMeetingOverlaps([user.id], occ.start, occ.end);
          for (const m of meetings) {
            conflicts.push({
              label: `Meeting: ${m.event.title}`,
              startTime: occ.start.toISOString(),
              endTime: occ.end.toISOString(),
            });
          }

          // Breaks don't overlap each other
          const otherBreak = await prisma.personalEntry.findFirst({
            where: {
              userId: user.id,
              category: { in: BREAK_CATEGORIES },
              startTime: { lt: occ.end },
              endTime: { gt: occ.start },
            },
          });
          if (otherBreak) {
            conflicts.push({
              label: `Already on break: ${otherBreak.title}`,
              startTime: occ.start.toISOString(),
              endTime: occ.end.toISOString(),
            });
          }
        }
      }

      if (conflicts.length > 0) {
        res.status(409).json({
          error: isBreakCategory(category as EntryCategory)
            ? "Breaks can't overlap a meeting you're invited to. Move the break or ask to be excused."
            : "This overlaps an existing break.",
          details: conflicts,
        });
        return;
      }

      const created = await prisma.$transaction(
        occurrences.map((occ) =>
          prisma.personalEntry.create({
            data: {
              userId: user.id,
              category: category as EntryCategory,
              title,
              notes: notes || "",
              startTime: occ.start,
              endTime: occ.end,
            },
          })
        )
      );

      res.status(201).json({ entries: created.map(formatEntryDTO) });
    } catch (err) {
      console.error("Failed to create entry:", err);
      res.status(500).json({ error: "Failed to create entry" });
    }
  }
);

// DELETE /entries/:id — remove one of my own breaks or activities
entriesRouter.delete("/entries/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);

    const entry = await prisma.personalEntry.findFirst({ where: { id, userId } });
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    await prisma.personalEntry.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete entry:", err);
    res.status(500).json({ error: "Failed to delete entry" });
  }
});
