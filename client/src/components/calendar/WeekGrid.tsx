"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  HOUR_PX,
  dayKey,
  formatClock,
  isSameDay,
  isWeekendDate,
  layoutLanes,
  minutesOfDay,
} from "./dates";

export interface GridItem {
  id: string;
  kind: "MEETING" | "BREAK" | "ACTIVITY";
  title: string;
  start: Date;
  end: Date;
  hasConflict?: boolean;
  movable?: boolean;
}

export interface LeaveBand {
  startKey: string;
  endKey: string;
  label: string;
  pending: boolean;
}

interface WeekGridProps {
  days: Date[];
  items: GridItem[];
  leaves: LeaveBand[];
  selectedId: string | null;
  onSelect: (item: GridItem) => void;
  onMove?: (item: GridItem, start: Date, end: Date) => void;
  onCreate?: (start: Date, end: Date) => void;
}

const GRID_START = DAY_START_HOUR * 60;
const GRID_END = DAY_END_HOUR * 60;
const GRID_HEIGHT = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX;
const SNAP_MINUTES = 15;
const DRAG_THRESHOLD_PX = 4;
const CLICK_AFTER_DRAG_MS = 300;

const BREAK_STRIPES = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgba(255,216,77,0.9) 0 8px, #FFF6E6 8px 16px)",
};

type Drag =
  | {
      kind: "move";
      item: GridItem;
      column: HTMLElement;
      originX: number;
      originY: number;
      moved: boolean;
      dayIndex: number;
      startMin: number;
      durationMin: number;
      offsetMin: number;
    }
  | {
      kind: "create";
      column: HTMLElement;
      originX: number;
      originY: number;
      moved: boolean;
      dayIndex: number;
      anchorMin: number;
      currentMin: number;
    };

function hourLabel(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${suffix}`;
}

function snapMinute(min: number): number {
  return Math.round(min / SNAP_MINUTES) * SNAP_MINUTES;
}

function clampMinute(min: number, low: number, high: number): number {
  return Math.min(Math.max(min, low), high);
}

/** Minute of the day under a pointer position, measured against a day column. */
function minuteAt(column: HTMLElement, clientY: number): number {
  const rect = column.getBoundingClientRect();
  return GRID_START + ((clientY - rect.top) / HOUR_PX) * 60;
}

/** A local Date on the given day at the given minute of the day. */
function atMinutes(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return d;
}

function columnAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return el?.closest<HTMLElement>("[data-day-index]") ?? null;
}

export function WeekGrid({
  days,
  items,
  leaves,
  selectedId,
  onSelect,
  onMove,
  onCreate,
}: WeekGridProps) {
  const now = new Date();
  const columns = `52px repeat(${days.length}, minmax(0, 1fr))`;

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const dragEndedAt = useRef(0);
  const latest = useRef({ days, onMove, onCreate });
  latest.current = { days, onMove, onCreate };

  const updateDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.originX, e.clientY - d.originY) < DRAG_THRESHOLD_PX) {
        return;
      }

      if (d.kind === "move") {
        const column = columnAt(e.clientX, e.clientY) ?? d.column;
        const startMin = clampMinute(
          snapMinute(minuteAt(column, e.clientY) - d.offsetMin),
          GRID_START,
          GRID_END - d.durationMin
        );
        updateDrag({
          ...d,
          column,
          dayIndex: Number(column.dataset.dayIndex ?? d.dayIndex),
          startMin,
          moved: true,
        });
      } else {
        const currentMin = clampMinute(snapMinute(minuteAt(d.column, e.clientY)), GRID_START, GRID_END);
        updateDrag({ ...d, currentMin, moved: true });
      }
    };

    const handleUp = () => {
      const d = dragRef.current;
      updateDrag(null);
      if (!d || !d.moved) return;
      dragEndedAt.current = Date.now();

      const { days: currentDays, onMove: move, onCreate: create } = latest.current;
      if (d.kind === "move") {
        const start = atMinutes(currentDays[d.dayIndex], d.startMin);
        if (start.getTime() !== d.item.start.getTime()) {
          const end = new Date(start.getTime() + d.durationMin * 60000);
          move?.(d.item, start, end);
        }
      } else {
        const low = Math.min(d.anchorMin, d.currentMin);
        const high = Math.max(d.anchorMin, d.currentMin);
        if (high - low >= SNAP_MINUTES) {
          create?.(
            atMinutes(currentDays[d.dayIndex], low),
            atMinutes(currentDays[d.dayIndex], high)
          );
        }
      }
    };

    const handleCancel = () => updateDrag(null);

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
    };
  }, [dragging]);

  const startMoveDrag = (e: React.PointerEvent<HTMLElement>, item: GridItem) => {
    if (e.button !== 0 || !item.movable || item.start.getTime() <= Date.now()) return;
    const column = e.currentTarget.closest<HTMLElement>("[data-day-index]");
    if (!column) return;
    const startMin = minutesOfDay(item.start);
    updateDrag({
      kind: "move",
      item,
      column,
      originX: e.clientX,
      originY: e.clientY,
      moved: false,
      dayIndex: Number(column.dataset.dayIndex),
      startMin,
      durationMin: (item.end.getTime() - item.start.getTime()) / 60000,
      offsetMin: minuteAt(column, e.clientY) - startMin,
    });
  };

  const startCreateDrag = (e: React.PointerEvent<HTMLDivElement>, dayIndex: number) => {
    if (!onCreate || e.target !== e.currentTarget || e.button !== 0) return;
    const column = e.currentTarget;
    const anchorMin = clampMinute(snapMinute(minuteAt(column, e.clientY)), GRID_START, GRID_END);
    if (atMinutes(days[dayIndex], anchorMin).getTime() <= Date.now()) return;
    updateDrag({
      kind: "create",
      column,
      originX: e.clientX,
      originY: e.clientY,
      moved: false,
      dayIndex,
      anchorMin,
      currentMin: anchorMin,
    });
  };

  const selectUnlessDragged = (item: GridItem) => {
    if (Date.now() - dragEndedAt.current < CLICK_AFTER_DRAG_MS) return;
    onSelect(item);
  };

  // While a block is being moved, show it where it would land
  const shownItems: GridItem[] =
    drag?.kind === "move" && drag.moved
      ? items.map((item) => {
          if (item.id !== drag.item.id) return item;
          const start = atMinutes(days[drag.dayIndex], drag.startMin);
          return { ...item, start, end: new Date(start.getTime() + drag.durationMin * 60000) };
        })
      : items;

  const createPreview =
    drag?.kind === "create" && drag.moved
      ? (() => {
          const low = Math.min(drag.anchorMin, drag.currentMin);
          const high = Math.max(drag.anchorMin, drag.currentMin);
          return {
            dayIndex: drag.dayIndex,
            startMin: low,
            endMin: high,
            start: atMinutes(days[drag.dayIndex], low),
            end: atMinutes(days[drag.dayIndex], high),
          };
        })()
      : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white overflow-hidden select-none">
      <div className="grid border-b-[3px] border-ink bg-paper" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((day) => {
          const today = isSameDay(day, now);
          return (
            <div
              key={dayKey(day)}
              className={`px-2 py-2 text-center border-l-2 border-ink/10 ${
                today ? "bg-sun" : isWeekendDate(day) ? "bg-paper" : "bg-white"
              }`}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink/70">
                {day.toLocaleDateString([], { weekday: "short" })}
              </p>
              <p className="font-display font-extrabold text-lg leading-tight">
                {day.getDate()}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid border-b-2 border-ink/15" style={{ gridTemplateColumns: columns }}>
        <div className="text-[9px] font-bold uppercase text-ink/50 px-1 py-1">Leave</div>
        {days.map((day) => {
          const key = dayKey(day);
          const bands = leaves.filter((l) => key >= l.startKey && key <= l.endKey);
          return (
            <div key={key} className="border-l-2 border-ink/10 p-1 space-y-1 min-h-[28px]">
              {bands.map((band) => (
                <div
                  key={`${band.startKey}-${band.label}`}
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border-2 border-ink truncate ${
                    band.pending ? "bg-white" : "bg-tangerine"
                  }`}
                  style={
                    band.pending
                      ? { backgroundImage: "repeating-linear-gradient(135deg, #FFF6E6 0 6px, #FF9B54 6px 12px)" }
                      : undefined
                  }
                  title={`${band.label}${band.pending ? " (waiting for approval)" : ""}`}
                >
                  {band.label}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid relative" style={{ gridTemplateColumns: columns, height: GRID_HEIGHT }}>
          <div className="relative text-[10px] font-semibold text-ink/50">
            {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => (
              <span
                key={i}
                className="absolute right-2 -translate-y-1/2"
                style={{ top: i * HOUR_PX }}
              >
                {hourLabel(DAY_START_HOUR + i)}
              </span>
            ))}
          </div>

          {days.map((day, index) => (
            <DayColumn
              key={dayKey(day)}
              day={day}
              dayIndex={index}
              items={shownItems}
              selectedId={selectedId}
              movingId={drag?.kind === "move" && drag.moved ? drag.item.id : null}
              onSelect={selectUnlessDragged}
              onItemPointerDown={startMoveDrag}
              onBackgroundPointerDown={startCreateDrag}
              createPreview={createPreview?.dayIndex === index ? createPreview : null}
              canCreate={Boolean(onCreate)}
              showNow={isSameDay(day, now)}
              now={now}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  dayIndex,
  items,
  selectedId,
  movingId,
  onSelect,
  onItemPointerDown,
  onBackgroundPointerDown,
  createPreview,
  canCreate,
  showNow,
  now,
}: {
  day: Date;
  dayIndex: number;
  items: GridItem[];
  selectedId: string | null;
  movingId: string | null;
  onSelect: (item: GridItem) => void;
  onItemPointerDown: (e: React.PointerEvent<HTMLElement>, item: GridItem) => void;
  onBackgroundPointerDown: (e: React.PointerEvent<HTMLDivElement>, dayIndex: number) => void;
  createPreview: { startMin: number; endMin: number; start: Date; end: Date } | null;
  canCreate: boolean;
  showNow: boolean;
  now: Date;
}) {
  const placed = items
    .filter((item) => isSameDay(item.start, day))
    .map((item) => {
      const startMin = Math.max(minutesOfDay(item.start), GRID_START);
      const endMin = isSameDay(item.end, day)
        ? Math.min(minutesOfDay(item.end), GRID_END)
        : GRID_END;
      return { item, startMin, endMin };
    })
    .filter((p) => p.endMin > p.startMin);

  const lanes = layoutLanes(
    placed.map((p) => ({ id: p.item.id, start: p.startMin, end: p.endMin }))
  );

  return (
    <div
      data-day-index={dayIndex}
      className={`relative border-l-2 border-ink/10 ${canCreate ? "cursor-crosshair" : ""}`}
      style={{
        height: GRID_HEIGHT,
        backgroundColor: isWeekendDate(day) ? "rgba(255,246,230,0.6)" : undefined,
        backgroundImage: `repeating-linear-gradient(to bottom, rgba(30,27,46,0.10) 0 1px, transparent 1px ${HOUR_PX}px)`,
      }}
      onPointerDown={(e) => onBackgroundPointerDown(e, dayIndex)}
    >
      {placed.map(({ item, startMin, endMin }) => {
        const info = lanes[item.id] ?? { lane: 0, lanes: 1 };
        const top = ((startMin - GRID_START) / 60) * HOUR_PX;
        const height = Math.max(((endMin - startMin) / 60) * HOUR_PX - 3, 26);
        const width = 100 / info.lanes;
        const selected = selectedId === item.id;
        const moving = movingId === item.id;
        const movable = Boolean(item.movable) && item.start.getTime() > now.getTime();

        const styleClass =
          item.kind === "BREAK"
            ? "border-dashed"
            : item.kind === "ACTIVITY"
            ? "bg-grape"
            : item.hasConflict
            ? "bg-sun"
            : "bg-azure";

        return (
          <button
            key={item.id}
            type="button"
            onPointerDown={(e) => onItemPointerDown(e, item)}
            onClick={() => onSelect(item)}
            className={`absolute overflow-hidden rounded-xl border-2 border-ink px-1.5 py-1 text-left touch-none transition-all duration-150 hover:-translate-y-px hover:shadow-pop-sm ${styleClass} ${
              movable ? "cursor-grab active:cursor-grabbing" : ""
            } ${
              selected || moving ? "shadow-pop -translate-x-px -translate-y-px z-10" : "shadow-pop-sm"
            }`}
            style={{
              top,
              height,
              left: `calc(${(info.lane * 100) / info.lanes}% + 2px)`,
              width: `calc(${width}% - 4px)`,
              ...(item.kind === "BREAK" ? BREAK_STRIPES : {}),
            }}
          >
            <span className="block text-[11px] font-extrabold leading-tight truncate bg-white/80 rounded px-0.5 w-fit max-w-full">
              {item.kind === "BREAK" ? `☕ ${item.title}` : item.title}
            </span>
            {height > 36 && (
              <span className="block text-[10px] font-semibold mt-0.5 truncate">
                {formatClock(item.start)} – {formatClock(item.end)}
              </span>
            )}
          </button>
        );
      })}

      {createPreview && (
        <div
          className="absolute left-1 right-1 z-10 rounded-xl border-2 border-dashed border-ink bg-mint/50 pointer-events-none"
          style={{
            top: ((createPreview.startMin - GRID_START) / 60) * HOUR_PX,
            height: Math.max(((createPreview.endMin - createPreview.startMin) / 60) * HOUR_PX, 14),
          }}
        >
          <span className="block px-1.5 py-0.5 text-[10px] font-extrabold bg-white/80 rounded w-fit">
            {formatClock(createPreview.start)} – {formatClock(createPreview.end)}
          </span>
        </div>
      )}

      {showNow && minutesOfDay(now) >= GRID_START && minutesOfDay(now) <= GRID_END && (
        <div
          className="absolute left-0 right-0 z-20 pointer-events-none"
          style={{ top: ((minutesOfDay(now) - GRID_START) / 60) * HOUR_PX }}
        >
          <div className="h-0.5 bg-bubble border-y border-ink/40" />
        </div>
      )}
    </div>
  );
}
