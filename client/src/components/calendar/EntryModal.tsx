"use client";

import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Coffee, ShieldAlert, Sparkles } from "lucide-react";
import type { EntryCategory } from "@syncro/shared";
import { api, ApiError } from "../../api/client";
import { useSyncroStore } from "../../store/useSyncroStore";
import { ACTIVITY_CATEGORIES, BREAK_CATEGORIES, ENTRY_CATEGORY_LABEL } from "./chips";
import { formatClock, fromDayKey } from "./dates";

type EntryKind = "BREAK" | "ACTIVITY";

interface EntryModalProps {
  initialType: EntryKind;
  initialDayKey: string;
  initialTimes?: [string, string];
  onClose: () => void;
}

const DEFAULT_TIMES: Record<EntryKind, [string, string]> = {
  BREAK: ["12:30", "13:30"],
  ACTIVITY: ["09:00", "10:30"],
};

const REPEAT_OPTIONS = [
  { value: 0, label: "Just this day" },
  { value: 1, label: "Every weekday for 1 week" },
  { value: 2, label: "Every weekday for 2 weeks" },
  { value: 4, label: "Every weekday for 4 weeks" },
];

export function EntryModal({ initialType, initialDayKey, initialTimes, onClose }: EntryModalProps) {
  const queryClient = useQueryClient();
  const addNotification = useSyncroStore((s) => s.addNotification);

  const [kind, setKind] = useState<EntryKind>(initialType);
  const [category, setCategory] = useState<EntryCategory>(initialType === "BREAK" ? "LUNCH" : "FOCUS");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dateStr, setDateStr] = useState(initialDayKey);
  const [[startHour, endHour], setTimes] = useState<[string, string]>(initialTimes ?? DEFAULT_TIMES[initialType]);
  const [repeatWeeks, setRepeatWeeks] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<{ label: string; startTime: string; endTime: string }[]>([]);

  const categories = kind === "BREAK" ? BREAK_CATEGORIES : ACTIVITY_CATEGORIES;
  const start = new Date(`${dateStr}T${startHour}:00`);
  const end = new Date(`${dateStr}T${endHour}:00`);
  const minutes = (end.getTime() - start.getTime()) / 60000;
  const durationError =
    minutes <= 0
      ? "The end time has to be after the start time."
      : kind === "BREAK" && (minutes < 5 || minutes > 180)
      ? "Breaks should be between 5 minutes and 3 hours."
      : kind === "ACTIVITY" && minutes > 720
      ? "Activities can be up to 12 hours."
      : null;

  const switchKind = (next: EntryKind) => {
    setKind(next);
    setCategory(next === "BREAK" ? "LUNCH" : "FOCUS");
    setError(null);
    setClashes([]);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.createEntry({
        category,
        title: title.trim() || ENTRY_CATEGORY_LABEL[category],
        notes: notes.trim(),
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        repeatWeeks,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["entries"] });
      queryClient.invalidateQueries({ queryKey: ["availability"] });
      addNotification({
        title: kind === "BREAK" ? "Break added" : "Added to your day",
        message:
          kind === "BREAK"
            ? `${res.entries.length} break${res.entries.length === 1 ? "" : "s"} booked. Nobody can invite you over ${res.entries.length === 1 ? "it" : "them"}.`
            : `${res.entries.length} ${res.entries.length === 1 ? "entry" : "entries"} added to your calendar.`,
        type: "success",
      });
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Couldn't save that");
      setClashes(
        err instanceof ApiError && err.details
          ? err.details.map((d) => ({
              label: d.label ?? "",
              startTime: d.startTime ?? new Date().toISOString(),
              endTime: d.endTime ?? new Date().toISOString(),
            }))
          : []
      );
    },
  });

  const isBreak = kind === "BREAK";

  return (
    <div className="modal-backdrop">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (durationError) {
            setError(durationError);
            return;
          }
          setError(null);
          setClashes([]);
          createMutation.mutate();
        }}
        className="modal max-w-lg max-h-[92vh] overflow-y-auto"
      >
        <h3 className="text-2xl font-extrabold">{isBreak ? "Add a break" : "Add to your day"}</h3>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => switchKind("BREAK")}
            className={`p-3 rounded-2xl border-[3px] text-left transition-all ${
              isBreak ? "bg-sun border-ink shadow-pop-sm -translate-x-px -translate-y-px" : "bg-white border-ink/20 hover:border-ink"
            }`}
          >
            <Coffee className="w-5 h-5" />
            <p className="font-display font-extrabold text-sm mt-1">Break</p>
            <p className="text-[11px] font-medium text-ink/70">Nobody can book a meeting over it</p>
          </button>
          <button
            type="button"
            onClick={() => switchKind("ACTIVITY")}
            className={`p-3 rounded-2xl border-[3px] text-left transition-all ${
              !isBreak ? "bg-grape border-ink shadow-pop-sm -translate-x-px -translate-y-px" : "bg-white border-ink/20 hover:border-ink"
            }`}
          >
            <Sparkles className="w-5 h-5" />
            <p className="font-display font-extrabold text-sm mt-1">Activity</p>
            <p className="text-[11px] font-medium text-ink/70">Focus time, tasks, errands. Shows as busy</p>
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-bubble border-[3px] border-ink text-xs font-bold shadow-pop-sm space-y-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            {clashes.length > 0 && (
              <ul className="space-y-1 font-semibold">
                {clashes.map((c, i) => (
                  <li key={i}>
                    {c.label} ({formatClock(c.startTime)} – {formatClock(c.endTime)})
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="grid grid-cols-[1fr_1.4fr] gap-3">
          <div>
            <label className="label">Type</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EntryCategory)}
              className="field cursor-pointer"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {ENTRY_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Label (optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={ENTRY_CATEGORY_LABEL[category]}
              className="field"
            />
          </div>
          <div>
            <label className="label">Day</label>
            <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} className="field px-2.5" />
            <p className="text-[11px] font-semibold text-ink/60 mt-1">{fromDayKey(dateStr).toLocaleDateString([], { weekday: "long" })}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Start</label>
              <input
                type="time"
                value={startHour}
                onChange={(e) => setTimes([e.target.value, endHour])}
                className="field px-2 text-xs"
              />
            </div>
            <div>
              <label className="label">End</label>
              <input
                type="time"
                value={endHour}
                onChange={(e) => setTimes([startHour, e.target.value])}
                className="field px-2 text-xs"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="label">Repeat</label>
          <select
            value={repeatWeeks}
            onChange={(e) => setRepeatWeeks(Number(e.target.value))}
            className="field cursor-pointer"
          >
            {REPEAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {!isBreak && (
          <div>
            <label className="label">Notes (only you can see these)</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything to remember"
              className="field resize-none"
            />
          </div>
        )}

        <p className="text-xs font-semibold text-ink/70 bg-paper border-2 border-ink rounded-xl p-3">
          {isBreak
            ? "Breaks can't overlap a meeting you're invited to. If one does, move the meeting or ask the organizer."
            : "Activities don't block bookings. If someone invites you over one, you'll get a flag and can ask for an excuse."}
        </p>

        <div className="flex justify-end gap-2.5 pt-1">
          <button type="button" onClick={onClose} className="btn bg-white">
            Cancel
          </button>
          <button type="submit" disabled={createMutation.isPending} className={`btn px-5 ${isBreak ? "bg-sun" : "bg-grape"}`}>
            {createMutation.isPending ? "Saving..." : isBreak ? "Add break" : "Add activity"}
          </button>
        </div>
      </form>
    </div>
  );
}
