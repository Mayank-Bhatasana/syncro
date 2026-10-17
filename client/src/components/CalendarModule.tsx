"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, ChevronLeft, ChevronRight, Coffee, Palmtree, Sparkles } from "lucide-react";
import { api } from "../api/client";
import { useSyncroStore } from "../store/useSyncroStore";
import { WeekGrid, type GridItem, type LeaveBand } from "./calendar/WeekGrid";
import { DetailsPanel, type Selected } from "./calendar/DetailsPanel";
import { BookMeetingModal } from "./calendar/BookMeetingModal";
import { EntryModal } from "./calendar/EntryModal";
import { LeaveModal } from "./calendar/LeaveModal";
import { LeavePanel } from "./calendar/LeavePanel";
import { LEAVE_TYPE_LABEL } from "./calendar/chips";
import {
  addDays,
  dayKey,
  formatClock,
  isSameDay,
  isWeekendDate,
  mondayOf,
  startOfDay,
  weekDays,
  weekLabel,
} from "./calendar/dates";

type Modal = { kind: "meeting" } | { kind: "entry"; entryKind: "BREAK" | "ACTIVITY" } | { kind: "leave" } | null;
type Selection = { kind: "meeting" | "entry" | "leave"; id: string } | null;

const QUICK =
  "flex flex-col items-start gap-1.5 p-3 rounded-2xl border-[3px] border-ink shadow-pop-sm text-left transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-pop";

function uniqueById<T extends { id: string }>(lists: T[][]): T[] {
  const map = new Map<string, T>();
  lists.flat().forEach((item) => map.set(item.id, item));
  return Array.from(map.values());
}

export function CalendarModule() {
  const currentUser = useSyncroStore((s) => s.currentUser)!;
  const canApprove = currentUser.role !== "EMPLOYEE";

  const today = startOfDay(new Date());
  const [monday, setMonday] = useState(() => mondayOf(isWeekendDate(today) ? addDays(today, 2) : today));
  const [view, setView] = useState<"week" | "leave">("week");
  const [showWeekend, setShowWeekend] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [modal, setModal] = useState<Modal>(null);

  const weekDaysAll = weekDays(monday);
  const days = showWeekend ? weekDaysAll : weekDaysAll.slice(0, 5);
  const weekFrom = monday.toISOString();
  const weekTo = addDays(monday, 7).toISOString();
  const agendaFrom = today.toISOString();
  const agendaTo = addDays(today, 8).toISOString();

  const weekEvents = useQuery({
    queryKey: ["calendar", weekFrom, weekTo],
    queryFn: () => api.getCalendar(weekFrom, weekTo),
  });
  const agendaEvents = useQuery({
    queryKey: ["calendar", agendaFrom, agendaTo],
    queryFn: () => api.getCalendar(agendaFrom, agendaTo),
  });
  const weekEntries = useQuery({
    queryKey: ["entries", weekFrom, weekTo],
    queryFn: () => api.getEntries(weekFrom, weekTo),
  });
  const agendaEntries = useQuery({
    queryKey: ["entries", agendaFrom, agendaTo],
    queryFn: () => api.getEntries(agendaFrom, agendaTo),
  });
  const leaveQuery = useQuery({ queryKey: ["leave"], queryFn: api.getLeave });
  const approvalsQuery = useQuery({
    queryKey: ["leave-approvals"],
    queryFn: api.getLeaveApprovals,
    enabled: canApprove,
  });

  const events = uniqueById([weekEvents.data?.events ?? [], agendaEvents.data?.events ?? []]);
  const entries = uniqueById([weekEntries.data?.entries ?? [], agendaEntries.data?.entries ?? []]);
  const myLeave = leaveQuery.data?.requests ?? [];
  const balance = leaveQuery.data?.balance;
  const activeLeave = myLeave.filter((r) => r.status === "PENDING" || r.status === "APPROVED");
  const approvalCount = approvalsQuery.data?.requests.length ?? 0;

  const gridItems: GridItem[] = [
    ...(weekEvents.data?.events ?? []).map((e) => ({
      id: e.id,
      kind: "MEETING" as const,
      title: e.title,
      start: new Date(e.startTime),
      end: new Date(e.endTime),
      hasConflict: e.myHasConflict,
    })),
    ...(weekEntries.data?.entries ?? []).map((en) => ({
      id: en.id,
      kind: en.type,
      title: en.title,
      start: new Date(en.startTime),
      end: new Date(en.endTime),
    })),
  ];

  const leaveBands: LeaveBand[] = activeLeave.map((r) => ({
    startKey: r.startDate,
    endKey: r.endDate,
    label: LEAVE_TYPE_LABEL[r.type],
    pending: r.status === "PENDING",
  }));

  const selected: Selected | null = (() => {
    if (!selection) return null;
    if (selection.kind === "meeting") {
      const event = events.find((e) => e.id === selection.id);
      return event ? { kind: "meeting", event } : null;
    }
    if (selection.kind === "entry") {
      const entry = entries.find((e) => e.id === selection.id);
      return entry ? { kind: "entry", entry } : null;
    }
    const leave = myLeave.find((l) => l.id === selection.id);
    return leave ? { kind: "leave", leave } : null;
  })();

  // Next 8 days, day by day: meetings, breaks, activities and leave days
  type AgendaRow = {
    id: string;
    kind: "meeting" | "entry" | "leave";
    title: string;
    start: Date;
    end?: Date;
    sub?: string;
    entryType?: "BREAK" | "ACTIVITY";
  };
  const agenda = Array.from({ length: 8 }, (_, i) => addDays(today, i)).map((day) => {
    const rows: AgendaRow[] = [
      ...events
        .filter((e) => isSameDay(new Date(e.startTime), day))
        .map((e) => ({ id: e.id, kind: "meeting" as const, title: e.title, start: new Date(e.startTime), end: new Date(e.endTime), sub: `with ${e.organizerName}` })),
      ...entries
        .filter((en) => isSameDay(new Date(en.startTime), day))
        .map((en) => ({ id: en.id, kind: "entry" as const, title: en.title, start: new Date(en.startTime), end: new Date(en.endTime), entryType: en.type })),
      ...activeLeave
        .filter((r) => dayKey(day) >= r.startDate && dayKey(day) <= r.endDate)
        .map((r) => ({ id: r.id, kind: "leave" as const, title: `${LEAVE_TYPE_LABEL[r.type]}${r.status === "PENDING" ? " (waiting)" : ""}`, start: day })),
    ].sort((a, b) => a.start.getTime() - b.start.getTime());
    return { day, rows };
  });

  const defaultDayKey = dayKey(today >= monday && today < addDays(monday, 7) ? today : monday);
  const onThisWeek = isSameDay(monday, mondayOf(today));

  const selectGridItem = (item: GridItem) =>
    setSelection({ kind: item.kind === "MEETING" ? "meeting" : "entry", id: item.id });

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0">
      {/* Left: quick actions and the next 8 days */}
      <aside className="w-72 shrink-0 border-r-[3px] border-ink bg-white flex flex-col min-h-0">
        <div className="sidebar-band bg-azure">
          <div className="min-w-0">
            <h2 className="font-extrabold text-lg leading-tight">Your calendar</h2>
            <p className="text-[11px] font-semibold text-ink/70">Meetings, breaks and the rest of your day</p>
          </div>
        </div>

        <div className="p-3 grid grid-cols-2 gap-2.5">
          <button type="button" onClick={() => setModal({ kind: "meeting" })} className={`${QUICK} bg-azure`}>
            <CalendarPlus className="w-4 h-4" />
            <span className="font-display font-extrabold text-sm">Book meeting</span>
          </button>
          <button type="button" onClick={() => setModal({ kind: "entry", entryKind: "ACTIVITY" })} className={`${QUICK} bg-grape`}>
            <Sparkles className="w-4 h-4" />
            <span className="font-display font-extrabold text-sm">Add activity</span>
          </button>
          <button type="button" onClick={() => setModal({ kind: "entry", entryKind: "BREAK" })} className={`${QUICK} bg-sun`}>
            <Coffee className="w-4 h-4" />
            <span className="font-display font-extrabold text-sm">Add break</span>
          </button>
          <button type="button" onClick={() => setModal({ kind: "leave" })} className={`${QUICK} bg-mint`}>
            <Palmtree className="w-4 h-4" />
            <span className="font-display font-extrabold text-sm">Request leave</span>
          </button>
        </div>

        {balance && (
          <div className="px-4 pb-3 flex flex-wrap gap-2 text-[11px] font-bold">
            <span className="chip bg-mint">{balance.annualRemaining} annual days left</span>
            {approvalCount > 0 && <span className="chip bg-sun">{approvalCount} leave to decide</span>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-4 border-t-2 border-ink/10 pt-3">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-ink/60 px-1">Next 8 days</p>
          {agenda.map(({ day, rows }) => (
            <div key={dayKey(day)} className="space-y-1.5">
              <p className={`text-xs font-extrabold px-1 ${isSameDay(day, today) ? "text-ink" : "text-ink/60"}`}>
                {isSameDay(day, today) ? "Today" : day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}
              </p>
              {rows.length === 0 && <p className="text-[11px] font-medium text-ink/40 px-1">Nothing booked</p>}
              {rows.map((row) => {
                const stripe =
                  row.kind === "leave" ? "bg-tangerine" : row.kind === "meeting" ? "bg-azure" : row.entryType === "BREAK" ? "bg-sun" : "bg-grape";
                const active = selection?.id === row.id;
                return (
                  <button
                    key={`${row.kind}-${row.id}-${row.start.getTime()}`}
                    type="button"
                    onClick={() => setSelection({ kind: row.kind, id: row.id })}
                    className={`w-full flex items-stretch gap-2 text-left rounded-xl border-2 overflow-hidden transition ${
                      active ? "border-ink shadow-pop-sm bg-paper" : "border-ink/15 hover:border-ink bg-white"
                    }`}
                  >
                    <span className={`w-1.5 ${stripe}`} />
                    <span className="py-1.5 pr-2 min-w-0">
                      <span className="block text-[11px] font-extrabold text-ink/60">
                        {row.kind === "leave" ? "All day" : `${formatClock(row.start)}${row.end ? ` – ${formatClock(row.end)}` : ""}`}
                      </span>
                      <span className="block text-xs font-bold truncate">{row.title}</span>
                      {row.sub && <span className="block text-[10px] font-medium text-ink/60 truncate">{row.sub}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* Centre: week or leave */}
      <section className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b-[3px] border-ink bg-white flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMonday((m) => addDays(m, -7))} className="btn btn-icon bg-white" title="Previous week">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setMonday(mondayOf(today))} disabled={onThisWeek} className="btn btn-sm bg-white">
              Today
            </button>
            <button type="button" onClick={() => setMonday((m) => addDays(m, 7))} className="btn btn-icon bg-white" title="Next week">
              <ChevronRight className="w-4 h-4" />
            </button>
            <h2 className="font-display font-extrabold text-xl ml-2">{weekLabel(monday)}</h2>
          </div>

          <div className="flex items-center gap-2">
            {view === "week" && (
              <button type="button" onClick={() => setShowWeekend((v) => !v)} className="btn btn-sm bg-white">
                {showWeekend ? "Hide weekend" : "Show weekend"}
              </button>
            )}
          <div className="flex items-center gap-1 bg-paper border-2 border-ink rounded-xl p-1">
            <button
              type="button"
              onClick={() => setView("week")}
              className={`tab ${view === "week" ? "tab-active bg-white" : ""}`}
            >
              Week
            </button>
            <button
              type="button"
              onClick={() => setView("leave")}
              className={`tab ${view === "leave" ? "tab-active bg-white" : ""}`}
            >
              Leave &amp; team
              {canApprove && approvalCount > 0 && <span className="chip bg-sun py-0 text-[10px]">{approvalCount}</span>}
            </button>
          </div>
          </div>
        </div>

        {view === "week" ? (
          <WeekGrid
            days={days}
            items={gridItems}
            leaves={leaveBands}
            selectedId={selection?.id ?? null}
            onSelect={selectGridItem}
          />
        ) : (
          <LeavePanel
            currentUser={currentUser}
            onRequestLeave={() => setModal({ kind: "leave" })}
            onSelectLeave={(id) => setSelection({ kind: "leave", id })}
          />
        )}
      </section>

      {/* Right: details for the selected item */}
      <aside className="w-96 shrink-0 border-l-[3px] border-ink bg-white overflow-y-auto">
        {selected ? (
          <DetailsPanel
            key={`${selected.kind}-${selection?.id}`}
            selected={selected}
            currentUser={currentUser}
            onClose={() => setSelection(null)}
          />
        ) : (
          <div className="p-6 space-y-5">
            <h3 className="font-display font-extrabold text-xl">Pick something</h3>
            <p className="text-sm font-medium text-ink/70">
              Select a block on the week or an item in the list to see the details and what you can do with it.
            </p>
            <div className="space-y-2.5 text-xs font-bold">
              <LegendRow swatch="bg-azure" label="Meeting" note="You're invited or you organized it" />
              <LegendRow swatch="bg-sun" label="Meeting with an overlap" note="Something else is booked at the same time" />
              <LegendRow swatch="striped" label="Break" note="Nobody can book a meeting over it" />
              <LegendRow swatch="bg-grape" label="Activity" note="Focus time, tasks, errands. Shows as busy" />
              <LegendRow swatch="bg-tangerine" label="On leave" note="Approved leave. Striped means waiting for approval" />
            </div>
          </div>
        )}
      </aside>

      {modal?.kind === "meeting" && (
        <BookMeetingModal
          initialDayKey={defaultDayKey}
          onClose={() => setModal(null)}
          onBooked={(id) => setSelection({ kind: "meeting", id })}
        />
      )}
      {modal?.kind === "entry" && (
        <EntryModal
          key={modal.entryKind}
          initialType={modal.entryKind}
          initialDayKey={defaultDayKey}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "leave" && (
        <LeaveModal balance={balance} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function LegendRow({ swatch, label, note }: { swatch: string; label: string; note: string }) {
  const style = swatch === "striped"
    ? { backgroundImage: "repeating-linear-gradient(135deg, rgba(255,216,77,0.9) 0 6px, #FFF6E6 6px 12px)" }
    : undefined;
  return (
    <div className="flex items-start gap-3">
      <span className={`w-5 h-5 rounded-md border-2 border-ink shrink-0 mt-0.5 ${swatch === "striped" ? "" : swatch}`} style={style} />
      <div>
        <p className="font-extrabold">{label}</p>
        <p className="font-medium text-ink/60">{note}</p>
      </div>
    </div>
  );
}
