"use client";

import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import type { CreateLeaveRequestInput, LeaveBalanceDTO, LeaveType } from "@syncro/shared";
import { api } from "../../api/client";
import { useSyncroStore } from "../../store/useSyncroStore";
import { LEAVE_TYPE_LABEL } from "./chips";
import { addDays, dayKey, isWeekendDate, startOfDay, workingDaysBetween } from "./dates";

interface LeaveModalProps {
  balance: LeaveBalanceDTO | undefined;
  onClose: () => void;
}

function firstWorkingDayFromTomorrow(): string {
  let day = addDays(startOfDay(new Date()), 1);
  while (isWeekendDate(day)) day = addDays(day, 1);
  return dayKey(day);
}

export function LeaveModal({ balance, onClose }: LeaveModalProps) {
  const queryClient = useQueryClient();
  const addNotification = useSyncroStore((s) => s.addNotification);
  const earliest = firstWorkingDayFromTomorrow();

  const [type, setType] = useState<LeaveType>("ANNUAL");
  const [startDate, setStartDate] = useState(earliest);
  const [endDate, setEndDate] = useState(earliest);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const days = workingDaysBetween(startDate, endDate);
  const remainingAfter =
    balance && type === "ANNUAL" ? balance.annualRemaining - days : balance?.annualRemaining;
  const dateError =
    !startDate || startDate < earliest
      ? "Leave has to be requested at least a day ahead. Pick a date from tomorrow."
      : endDate < startDate
      ? "The end date has to be on or after the start date."
      : days === 0
      ? "Pick at least one working day (Monday to Friday)."
      : remainingAfter !== undefined && remainingAfter < 0
      ? "That's more annual leave than you have left."
      : null;

  const requestMutation = useMutation({
    mutationFn: () => {
      const input: CreateLeaveRequestInput = { type, startDate, endDate, reason: reason.trim() };
      return api.requestLeave(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave"] });
      queryClient.invalidateQueries({ queryKey: ["leave-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["leave-team"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      addNotification({
        title: "Leave requested",
        message: "Your manager has been asked to approve it. The day is held for you until they decide.",
        type: "success",
      });
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Couldn't send the request");
    },
  });

  return (
    <div className="modal-backdrop">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dateError || reason.trim().length < 3) return;
          setError(null);
          requestMutation.mutate();
        }}
        className="modal max-w-lg"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-2xl font-extrabold">Request leave</h3>
          {balance && (
            <span className="chip bg-mint py-1">
              {balance.annualRemaining} annual day{balance.annualRemaining === 1 ? "" : "s"} left
            </span>
          )}
        </div>

        <p className="text-sm font-medium text-ink/70">
          Book leave ahead of time. Once requested, the day is held so nobody can schedule a meeting over it. It becomes final when your manager approves.
        </p>

        {error && (
          <div className="p-3 rounded-xl bg-bubble border-[3px] border-ink text-xs font-bold shadow-pop-sm flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="label">Type</label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(LEAVE_TYPE_LABEL) as LeaveType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`p-2.5 rounded-xl border-[3px] text-xs font-extrabold transition-all ${
                  type === t ? "bg-mint border-ink shadow-pop-sm" : "bg-white border-ink/20 hover:border-ink"
                }`}
              >
                {LEAVE_TYPE_LABEL[t].replace(" leave", "")}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">From</label>
            <input
              type="date"
              value={startDate}
              min={earliest}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
              className="field"
            />
          </div>
          <div>
            <label className="label">To</label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="field"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="chip bg-white">
            {days} working day{days === 1 ? "" : "s"}
          </span>
          {type === "ANNUAL" && remainingAfter !== undefined && (
            <span className="chip bg-white">{Math.max(remainingAfter, 0)} left after this</span>
          )}
        </div>

        {dateError && <p className="text-xs font-bold text-bubble">{dateError}</p>}

        <div>
          <label className="label">Reason (shared with your manager)</label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="A few words is fine."
            className="field resize-none"
          />
        </div>

        <div className="flex justify-end gap-2.5 pt-1">
          <button type="button" onClick={onClose} className="btn bg-white">
            Cancel
          </button>
          <button
            type="submit"
            disabled={Boolean(dateError) || reason.trim().length < 3 || requestMutation.isPending}
            className="btn bg-mint px-5"
          >
            {requestMutation.isPending ? "Sending..." : "Send request"}
          </button>
        </div>
      </form>
    </div>
  );
}
