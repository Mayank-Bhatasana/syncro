"use client";

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, CheckCircle2, Eye, Plus } from "lucide-react";
import type { LeaveRequestDTO, UserDTO } from "@syncro/shared";
import { api, ApiError } from "../../api/client";
import { useSyncroStore } from "../../store/useSyncroStore";
import { Avatar } from "../ui";
import { LEAVE_TYPE_LABEL, LeaveStatusChip } from "./chips";
import {
  addDays,
  dayKey,
  fromDayKey,
  formatClock,
  formatDateRange,
  startOfDay,
} from "./dates";

interface LeavePanelProps {
  currentUser: UserDTO;
  onRequestLeave: () => void;
  onSelectLeave: (id: string) => void;
}

export function LeavePanel({ currentUser, onRequestLeave, onSelectLeave }: LeavePanelProps) {
  const canApprove = currentUser.role !== "EMPLOYEE";
  const today = startOfDay(new Date());
  const teamFrom = dayKey(today);
  const teamTo = dayKey(addDays(today, 21));

  const leaveQuery = useQuery({ queryKey: ["leave"], queryFn: api.getLeave });
  const approvalsQuery = useQuery({
    queryKey: ["leave-approvals"],
    queryFn: api.getLeaveApprovals,
    enabled: canApprove,
  });
  const teamQuery = useQuery({
    queryKey: ["leave-team", teamFrom, teamTo],
    queryFn: () => api.getTeamLeave(teamFrom, teamTo),
  });

  const balance = leaveQuery.data?.balance;
  const mine = leaveQuery.data?.requests ?? [];
  const approvals = approvalsQuery.data?.requests ?? [];
  const team = teamQuery.data?.leaves ?? [];

  const used = balance?.annualUsed ?? 0;
  const pending = balance?.annualPending ?? 0;
  const allowance = balance?.annualAllowance ?? 20;

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="grid xl:grid-cols-2 gap-5 items-start">
        <div className="space-y-5">
          <section className="card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-ink/60">Annual leave</p>
                <p className="font-display font-extrabold text-3xl leading-none mt-1">
                  {balance?.annualRemaining ?? "—"}
                  <span className="text-base font-bold text-ink/60"> days left</span>
                </p>
              </div>
              <button type="button" onClick={onRequestLeave} className="btn bg-mint">
                <Plus className="w-4 h-4" /> Request leave
              </button>
            </div>

            <div className="h-4 rounded-full border-2 border-ink overflow-hidden flex bg-paper">
              <div className="bg-ink" style={{ width: `${(used / allowance) * 100}%` }} title={`${used} used`} />
              <div
                className="bg-sun"
                style={{
                  width: `${(pending / allowance) * 100}%`,
                  backgroundImage: "repeating-linear-gradient(135deg, #FFD84D 0 6px, #FFF6E6 6px 12px)",
                }}
                title={`${pending} waiting for approval`}
              />
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-bold">
              <span className="chip bg-ink text-white">{used} booked or taken</span>
              <span className="chip bg-sun">{pending} waiting</span>
              <span className="chip bg-white">{allowance} a year</span>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="font-display font-extrabold text-lg">Your requests</h3>
            {mine.length === 0 && (
              <p className="text-sm font-semibold text-ink/60">No leave requested yet.</p>
            )}
            {mine.map((leave) => (
              <LeaveRow key={leave.id} leave={leave} onOpen={() => onSelectLeave(leave.id)} />
            ))}
          </section>
        </div>

        <div className="space-y-5">
          {canApprove && (
            <section className="card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display font-extrabold text-lg">Waiting for your decision</h3>
                <span className="chip bg-sun">{approvals.length}</span>
              </div>
              {approvals.length === 0 && (
                <p className="text-sm font-semibold text-ink/60 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> All caught up.
                </p>
              )}
              {approvals.map((leave) => (
                <ApprovalRow key={leave.id} leave={leave} onOpen={() => onSelectLeave(leave.id)} />
              ))}
            </section>
          )}

          <section className="card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CalendarOff className="w-4 h-4" />
              <h3 className="font-display font-extrabold text-lg">Who&apos;s out</h3>
              <span className="text-[11px] font-semibold text-ink/60">next 3 weeks</span>
            </div>
            {team.length === 0 && <p className="text-sm font-semibold text-ink/60">Everyone&apos;s in.</p>}
            <div className="divide-y-2 divide-ink/10">
              {team.map((row) => (
                <div key={row.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={row.userName} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold truncate">{row.userName}</p>
                      <p className="text-[11px] font-medium text-ink/60 truncate">
                        {row.departmentName} · {formatDateRange(row.startDate, row.endDate)}
                      </p>
                    </div>
                  </div>
                  <span className={`chip shrink-0 ${row.status === "APPROVED" ? "bg-tangerine" : "bg-sun"}`}>
                    {row.status === "APPROVED" ? "Out" : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <AvailabilityChecker currentUser={currentUser} />
        </div>
      </div>
    </div>
  );
}

function LeaveRow({ leave, onOpen }: { leave: LeaveRequestDTO; onOpen: () => void }) {
  const queryClient = useQueryClient();
  const addNotification = useSyncroStore((s) => s.addNotification);
  const cancel = useMutation({
    mutationFn: () => api.cancelLeave(leave.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave"] });
      queryClient.invalidateQueries({ queryKey: ["leave-team"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      addNotification({ title: "Leave withdrawn", message: "Your request has been cancelled.", type: "info" });
    },
  });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className="w-full text-left p-4 rounded-2xl bg-white border-[3px] border-ink/25 hover:border-ink hover:shadow-pop-sm transition cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-extrabold text-sm">{LEAVE_TYPE_LABEL[leave.type]}</p>
          <p className="text-xs font-semibold text-ink/70 mt-0.5">
            {formatDateRange(leave.startDate, leave.endDate)} · {leave.days} working day{leave.days === 1 ? "" : "s"}
          </p>
          {leave.decisionNote && <p className="text-xs italic text-ink/70 mt-1">&ldquo;{leave.decisionNote}&rdquo;</p>}
        </div>
        <LeaveStatusChip status={leave.status} />
      </div>
      {leave.canCancel && (
        <button
          type="button"
          disabled={cancel.isPending}
          onClick={(e) => {
            e.stopPropagation();
            cancel.mutate();
          }}
          className="btn btn-sm bg-white mt-3"
        >
          Withdraw
        </button>
      )}
    </div>
  );
}

function ApprovalRow({ leave, onOpen }: { leave: LeaveRequestDTO; onOpen: () => void }) {
  const queryClient = useQueryClient();
  const addNotification = useSyncroStore((s) => s.addNotification);
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") => api.decideLeave(leave.id, { decision, note: note.trim() }),
    onSuccess: (_res, decision) => {
      queryClient.invalidateQueries({ queryKey: ["leave-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["leave-team"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      addNotification({
        title: decision === "APPROVE" ? "Leave approved" : "Leave rejected",
        message: `${leave.userName} has been told.`,
        type: decision === "APPROVE" ? "success" : "warning",
      });
    },
    onError: (err: unknown) => {
      addNotification({
        title: "Couldn't update leave",
        message: err instanceof ApiError ? err.message : "Please try again.",
        type: "warning",
      });
    },
  });

  return (
    <div className="p-4 rounded-2xl bg-paper border-[3px] border-ink space-y-3">
      <button type="button" onClick={onOpen} className="w-full text-left">
        <div className="flex items-center gap-2.5">
          <Avatar name={leave.userName} size="sm" />
          <div className="min-w-0">
            <p className="font-extrabold text-sm truncate">{leave.userName}</p>
            <p className="text-[11px] font-semibold text-ink/60 truncate">
              {leave.departmentName} · {LEAVE_TYPE_LABEL[leave.type]} · {formatDateRange(leave.startDate, leave.endDate)}
            </p>
          </div>
        </div>
        {leave.reason && <p className="text-sm font-medium mt-2">&ldquo;{leave.reason}&rdquo;</p>}
      </button>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note for them"
        className="field py-2 text-xs"
      />
      <div className="flex gap-2">
        <button onClick={() => decide.mutate("APPROVE")} disabled={decide.isPending} className="btn btn-sm bg-mint">
          ✓ Approve
        </button>
        <button onClick={() => decide.mutate("REJECT")} disabled={decide.isPending} className="btn btn-sm bg-bubble">
          ✕ Reject
        </button>
      </div>
    </div>
  );
}

function AvailabilityChecker({ currentUser }: { currentUser: UserDTO }) {
  const [dayStr, setDayStr] = useState(dayKey(new Date()));
  const [pickedIds, setPickedIds] = useState<string[]>([]);

  const usersQuery = useQuery({ queryKey: ["users"], queryFn: api.getUsers });
  const others = (usersQuery.data?.users ?? []).filter((u) => u.id !== currentUser.id);

  const day = fromDayKey(dayStr);
  const availability = useQuery({
    queryKey: ["availability", "checker", dayStr, pickedIds.join(",")],
    queryFn: () =>
      api.getAvailability(pickedIds, startOfDay(day).toISOString(), addDays(day, 1).toISOString()),
    enabled: pickedIds.length > 0,
  });

  const nameOf = useMemo(() => new Map(others.map((u) => [u.id, u.name])), [others]);

  return (
    <section className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Eye className="w-4 h-4" />
        <h3 className="font-display font-extrabold text-lg">Check availability</h3>
      </div>
      <p className="text-[11px] font-medium text-ink/60">
        You&apos;ll see when people are busy, on break, or on leave. Meeting titles and details stay private.
      </p>

      <div className="flex items-center gap-2">
        <input type="date" value={dayStr} onChange={(e) => setDayStr(e.target.value)} className="field py-2 text-xs w-auto" />
        <span className="text-xs font-bold text-ink/60">{day.toLocaleDateString([], { weekday: "long" })}</span>
      </div>

      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-0.5">
        {others.map((u) => {
          const selected = pickedIds.includes(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() =>
                setPickedIds((prev) => (selected ? prev.filter((id) => id !== u.id) : [...prev, u.id]))
              }
              className={`chip rounded-lg py-1 text-[11px] transition hover:-translate-y-px ${selected ? "bg-grape" : "bg-white"}`}
            >
              {u.name.split(" ")[0]} ({u.departmentName})
            </button>
          );
        })}
      </div>

      {pickedIds.length > 0 && (
        <div className="bg-white border-[3px] border-ink rounded-2xl p-3 space-y-2">
          {pickedIds.map((id) => {
            const blocks = (availability.data?.busyBlocks ?? []).filter((b) => b.userId === id);
            return (
              <div key={id} className="text-xs">
                <p className="font-extrabold">{nameOf.get(id) ?? "Colleague"}</p>
                {blocks.length === 0 ? (
                  <span className="chip bg-mint mt-1">
                    <CheckCircle2 className="w-3 h-3" /> Free all day
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {blocks.map((b, i) => (
                      <span key={i} className={`chip py-0 text-[10px] ${b.type === "LEAVE" ? "bg-tangerine" : b.type === "BREAK" ? "bg-sun" : "bg-white"}`}>
                        {b.label} {formatClock(b.startTime)}–{formatClock(b.endTime)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

