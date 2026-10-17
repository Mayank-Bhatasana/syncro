"use client";

import React from "react";
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
}

const GRID_START = DAY_START_HOUR * 60;
const GRID_END = DAY_END_HOUR * 60;
const GRID_HEIGHT = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX;

const BREAK_STRIPES = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgba(255,216,77,0.9) 0 8px, #FFF6E6 8px 16px)",
};

function hourLabel(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${suffix}`;
}

export function WeekGrid({ days, items, leaves, selectedId, onSelect }: WeekGridProps) {
  const now = new Date();
  const columns = `52px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white overflow-hidden">
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

          {days.map((day) => (
            <DayColumn
              key={dayKey(day)}
              day={day}
              items={items}
              selectedId={selectedId}
              onSelect={onSelect}
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
  items,
  selectedId,
  onSelect,
  showNow,
  now,
}: {
  day: Date;
  items: GridItem[];
  selectedId: string | null;
  onSelect: (item: GridItem) => void;
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
      className="relative border-l-2 border-ink/10"
      style={{
        height: GRID_HEIGHT,
        backgroundColor: isWeekendDate(day) ? "rgba(255,246,230,0.6)" : undefined,
        backgroundImage: `repeating-linear-gradient(to bottom, rgba(30,27,46,0.10) 0 1px, transparent 1px ${HOUR_PX}px)`,
      }}
    >
      {placed.map(({ item, startMin, endMin }) => {
        const info = lanes[item.id] ?? { lane: 0, lanes: 1 };
        const top = ((startMin - GRID_START) / 60) * HOUR_PX;
        const height = Math.max(((endMin - startMin) / 60) * HOUR_PX - 3, 26);
        const width = 100 / info.lanes;
        const selected = selectedId === item.id;

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
            onClick={() => onSelect(item)}
            className={`absolute overflow-hidden rounded-xl border-2 border-ink px-1.5 py-1 text-left transition-all duration-150 hover:-translate-y-px hover:shadow-pop-sm ${styleClass} ${
              selected ? "shadow-pop -translate-x-px -translate-y-px z-10" : "shadow-pop-sm"
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
