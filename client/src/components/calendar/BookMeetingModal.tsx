"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import type { BusyBlockDTO, CreateEventInput, TargetScope, UserDTO } from "@syncro/shared";
import { api, ApiError } from "../../api/client";
import { useSyncroStore } from "../../store/useSyncroStore";
import { Avatar } from "../ui";
import { addDays, formatClock, fromDayKey, startOfDay } from "./dates";

interface BookMeetingModalProps {
  initialDayKey: string;
  onClose: () => void;
  onBooked: (eventId: string) => void;
}

export function BookMeetingModal({ initialDayKey, onClose, onBooked }: BookMeetingModalProps) {
  const queryClient = useQueryClient();
  const currentUser = useSyncroStore((s) => s.currentUser)!;
  const addNotification = useSyncroStore((s) => s.addNotification);
  const canBookWide = currentUser.role === "MANAGER" || currentUser.role === "ADMIN";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dateStr, setDateStr] = useState(initialDayKey);
  const [startHour, setStartHour] = useState("14:00");
  const [endHour, setEndHour] = useState("15:00");
  const [scope, setScope] = useState<TargetScope>(canBookWide ? "DEPARTMENT" : "USERS");
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conflictList, setConflictList] = useState<{ name: string; label: string; startTime: string; endTime: string }[]>([]);

  const usersQuery = useQuery({ queryKey: ["users"], queryFn: api.getUsers });
  const deptsQuery = useQuery({ queryKey: ["departments"], queryFn: api.getDepartments });
  const allUsers = usersQuery.data?.users ?? [];
  const others = allUsers.filter((u) => u.id !== currentUser.id);
  const departments = deptsQuery.data?.departments ?? [];

  const dayDate = fromDayKey(dateStr);
  const windowStart = new Date(`${dateStr}T${startHour}:00`);
  const windowEnd = new Date(`${dateStr}T${endHour}:00`);
  const validWindow = windowEnd.getTime() > windowStart.getTime();

  const availabilityQuery = useQuery({
    queryKey: ["availability", "booking", dateStr, allUsers.length],
    queryFn: () =>
      api.getAvailability(
        allUsers.map((u) => u.id),
        startOfDay(dayDate).toISOString(),
        addDays(dayDate, 1).toISOString()
      ),
    enabled: allUsers.length > 0,
  });
  const busy: BusyBlockDTO[] = availabilityQuery.data?.busyBlocks ?? [];

  const userById = new Map(allUsers.map((u) => [u.id, u]));
  const deptSet = new Set(deptIds);
  const inSelectedDept = (u: UserDTO) => deptSet.has(u.departmentId);

  /** Strongest thing blocking this person in the chosen slot, if any. */
  const blockFor = (userId: string): BusyBlockDTO | null => {
    const hits = busy.filter(
      (b) =>
        b.userId === userId &&
        new Date(b.startTime) < windowEnd &&
        new Date(b.endTime) > windowStart
    );
    return (
      hits.find((b) => b.type === "LEAVE") ??
      hits.find((b) => b.type === "BREAK") ??
      hits.find((b) => b.type === "MEETING" || b.type === "ACTIVITY") ??
      null
    );
  };

  const onLeave = (u: UserDTO) => blockFor(u.id)?.type === "LEAVE";

  const isChecked = (u: UserDTO): boolean => {
    if (onLeave(u)) return false;
    if (scope === "ALL") return true;
    if (scope === "USERS") return pickedIds.includes(u.id);
    return (inSelectedDept(u) && !excludeIds.includes(u.id)) || pickedIds.includes(u.id);
  };

  const toggle = (u: UserDTO) => {
    const checked = isChecked(u);
    setPickedIds((prev) => prev.filter((id) => id !== u.id));
    if (scope === "DEPARTMENT" && inSelectedDept(u)) {
      setExcludeIds((prev) => (checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)));
    } else if (!checked) {
      setPickedIds((prev) => [...prev, u.id]);
    }
  };

  const toggleDept = (deptId: string) => {
    const selecting = !deptIds.includes(deptId);
    setDeptIds((prev) => (selecting ? [...prev, deptId] : prev.filter((id) => id !== deptId)));
    const members = allUsers.filter((u) => u.departmentId === deptId).map((u) => u.id);
    setExcludeIds((prev) => prev.filter((id) => !members.includes(id)));
  };

  // Who would actually be in the invite, given the current choices
  const targets: UserDTO[] = [currentUser as UserDTO, ...others].filter((u) => {
    if (u.id === currentUser.id) return true;
    return isChecked(u);
  });
  const breakList = targets
    .map((u) => ({ user: u, block: blockFor(u.id) }))
    .filter((x) => x.block?.type === "BREAK");
  const skippedOnLeave = others.filter(
    (u) =>
      onLeave(u) &&
      (scope === "ALL" || (scope === "DEPARTMENT" && inSelectedDept(u)) || pickedIds.includes(u.id))
  );
  const softBusy = targets.filter((u) => {
    const b = blockFor(u.id);
    return b?.type === "MEETING" || b?.type === "ACTIVITY";
  });

  const payload = (): Pick<CreateEventInput, "targetScope" | "departmentIds" | "userIds" | "excludeUserIds"> => {
    const leaveIds = new Set(others.filter(onLeave).map((u) => u.id));
    if (scope === "ALL") {
      return { targetScope: "ALL", departmentIds: [], userIds: [], excludeUserIds: [] };
    }
    if (scope === "USERS") {
      return {
        targetScope: "USERS",
        departmentIds: [],
        userIds: pickedIds.filter((id) => !leaveIds.has(id)),
        excludeUserIds: [],
      };
    }
    const deptUserIds = new Set(allUsers.filter(inSelectedDept).map((u) => u.id));
    return {
      targetScope: "DEPARTMENT",
      departmentIds: deptIds,
      userIds: pickedIds.filter((id) => !deptUserIds.has(id) && !leaveIds.has(id)),
      excludeUserIds: excludeIds.filter((id) => deptUserIds.has(id)),
    };
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.createEvent({
        title: title.trim(),
        description: description.trim(),
        startTime: windowStart.toISOString(),
        endTime: windowEnd.toISOString(),
        ...payload(),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      queryClient.invalidateQueries({ queryKey: ["availability"] });
      const skipped = res.excludedOnLeave.map((s) => s.name);
      addNotification({
        title: res.conflictsCount > 0 ? "Meeting booked, with overlaps" : "Meeting booked",
        message:
          (res.conflictsCount > 0
            ? `${res.conflictsCount} ${res.conflictsCount === 1 ? "person has" : "people have"} something else at this time.`
            : "Everyone invited has been notified.") +
          (skipped.length ? ` Skipped (on leave): ${skipped.join(", ")}.` : ""),
        type: res.conflictsCount > 0 ? "warning" : "success",
      });
      onBooked(res.event.id);
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Couldn't book the meeting");
      setConflictList(
        err instanceof ApiError && err.details
          ? err.details.map((d) => ({
              name: d.name ?? "",
              label: d.label ?? "",
              startTime: d.startTime ?? new Date().toISOString(),
              endTime: d.endTime ?? new Date().toISOString(),
            }))
          : []
      );
    },
  });

  const canSubmit =
    title.trim().length > 0 &&
    validWindow &&
    breakList.length === 0 &&
    (scope !== "USERS" || pickedIds.length > 0) &&
    (scope !== "DEPARTMENT" || deptIds.length > 0 || pickedIds.length > 0) &&
    !createMutation.isPending;

  return (
    <div className="modal-backdrop">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          setError(null);
          setConflictList([]);
          createMutation.mutate();
        }}
        className="modal max-w-2xl max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-2xl font-extrabold">Book a meeting</h3>
          <span className="chip bg-grape py-1">You&apos;re a {currentUser.role.toLowerCase()}</span>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-bubble border-[3px] border-ink text-xs font-bold shadow-pop-sm space-y-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            {conflictList.length > 0 && (
              <ul className="space-y-1 font-semibold">
                {conflictList.slice(0, 8).map((c, i) => (
                  <li key={i}>
                    {c.name}: {c.label} ({formatClock(c.startTime)} – {formatClock(c.endTime)})
                  </li>
                ))}
                {conflictList.length > 8 && <li>…and {conflictList.length - 8} more</li>}
              </ul>
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label">Title</label>
            <input
              required
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q4 pipeline review"
              className="field"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Agenda</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What do you want to cover?"
              className="field resize-none"
            />
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} className="field" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Start</label>
              <input type="time" value={startHour} onChange={(e) => setStartHour(e.target.value)} className="field px-2.5" />
            </div>
            <div>
              <label className="label">End</label>
              <input type="time" value={endHour} onChange={(e) => setEndHour(e.target.value)} className="field px-2.5" />
            </div>
          </div>
        </div>

        {!validWindow && (
          <p className="text-xs font-bold text-bubble">The end time has to be after the start time.</p>
        )}

        <div>
          <label className="label">Who should be invited?</label>
          <div className="grid grid-cols-3 gap-2.5">
            {(["DEPARTMENT", "USERS", "ALL"] as TargetScope[]).map((s) => {
              const restricted = !canBookWide && s !== "USERS";
              const selected = scope === s;
              return (
                <button
                  type="button"
                  key={s}
                  disabled={restricted}
                  onClick={() => setScope(s)}
                  className={`p-3 rounded-2xl border-[3px] text-left transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${
                    selected
                      ? "bg-azure border-ink shadow-pop-sm -translate-x-px -translate-y-px"
                      : "bg-white border-ink/20 hover:border-ink"
                  }`}
                >
                  <div className="font-display font-extrabold text-sm">
                    {s === "ALL" ? "Everyone" : s === "DEPARTMENT" ? "Departments" : "Specific people"}
                  </div>
                  <div className="text-[10px] font-semibold text-ink/70">
                    {s === "ALL"
                      ? "Whole company"
                      : s === "DEPARTMENT"
                      ? "Pick teams, then tweak"
                      : "Hand-pick attendees"}
                  </div>
                  {restricted && <span className="chip bg-sun mt-1.5 text-[9px] py-0">Managers only</span>}
                </button>
              );
            })}
          </div>
        </div>

        {scope === "DEPARTMENT" && (
          <div className="flex flex-wrap gap-2">
            {departments.map((d) => {
              const checked = deptIds.includes(d.id);
              return (
                <button
                  type="button"
                  key={d.id}
                  onClick={() => toggleDept(d.id)}
                  className={`chip rounded-xl py-1.5 px-3 text-xs transition hover:-translate-y-px ${checked ? "bg-azure" : "bg-white"}`}
                >
                  {d.name} ({d.memberCount})
                </button>
              );
            })}
          </div>
        )}

        {scope === "ALL" ? (
          <p className="text-sm font-medium text-ink/70 bg-paper border-2 border-ink rounded-xl p-3">
            Everyone at Syncro gets an invite, except anyone on leave that day. If anyone is on break at this time, pick another slot.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink/60">
              {scope === "DEPARTMENT" ? "Team members (tick to add, untick to leave out)" : "People"}
            </p>
            <div className="max-h-64 overflow-y-auto border-[3px] border-ink rounded-2xl p-2 space-y-1.5 bg-paper">
              {others.map((u) => {
                const block = blockFor(u.id);
                const leave = block?.type === "LEAVE";
                const breakBlock = block?.type === "BREAK";
                const checked = isChecked(u);
                const disabled = leave || breakBlock;
                return (
                  <label
                    key={u.id}
                    className={`flex items-center justify-between gap-2 p-2 rounded-xl border-2 transition ${
                      checked ? "bg-azure/30 border-ink" : "bg-white border-transparent"
                    } ${disabled ? "opacity-60" : "cursor-pointer hover:border-ink/30"}`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Avatar name={u.name} size="sm" />
                      <span className="min-w-0">
                        <span className="block text-sm font-extrabold truncate">{u.name}</span>
                        <span className="block text-[11px] font-medium text-ink/60 truncate">
                          {u.departmentName} • {u.role.toLowerCase()}
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {leave && <span className="chip bg-tangerine text-[10px] py-0">On leave</span>}
                      {breakBlock && block && (
                        <span className="chip bg-sun text-[10px] py-0">
                          Break {formatClock(block.startTime)}–{formatClock(block.endTime)}
                        </span>
                      )}
                      {block && (block.type === "MEETING" || block.type === "ACTIVITY") && (
                        <span className="chip bg-white text-[10px] py-0">Busy</span>
                      )}
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(u)}
                        className="w-4 h-4 accent-azure cursor-pointer"
                      />
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {breakList.length > 0 && (
          <div className="p-3 rounded-xl bg-sun border-[3px] border-ink text-xs font-bold shadow-pop-sm">
            Can&apos;t book over a break. {breakList.slice(0, 3).map((x) => x.user.name).join(", ")}
            {breakList.length > 3 ? ` and ${breakList.length - 3} more` : ""} {breakList.length === 1 ? "is" : "are"} on break at this time. Remove them or pick another time.
          </div>
        )}
        {skippedOnLeave.length > 0 && (
          <p className="text-xs font-semibold text-ink/70">
            Skipped because they&apos;re on leave: {skippedOnLeave.slice(0, 4).map((u) => u.name).join(", ")}
            {skippedOnLeave.length > 4 ? ` and ${skippedOnLeave.length - 4} more` : ""}.
          </p>
        )}
        {softBusy.length > 0 && breakList.length === 0 && (
          <p className="text-xs font-semibold text-ink/70">
            {softBusy.length} {softBusy.length === 1 ? "person has" : "people have"} something else at this time. They&apos;ll get an overlap flag and can ask for an excuse.
          </p>
        )}

        <div className="flex justify-end gap-2.5 pt-2">
          <button type="button" onClick={onClose} className="btn bg-white">
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit} className="btn bg-azure px-5">
            {createMutation.isPending ? "Booking..." : "Book meeting"}
          </button>
        </div>
      </form>
    </div>
  );
}
