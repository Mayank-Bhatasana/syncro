"use client";

import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, MessageSquareWarning, Trash2, Users, X } from "lucide-react";
import type { CalendarEventDTO, LeaveRequestDTO, PersonalEntryDTO, UserDTO } from "@syncro/shared";
import { api, ApiError } from "../../api/client";
import { useSyncroStore } from "../../store/useSyncroStore";
import { Avatar } from "../ui";
import {
  AttendeeStatusChip,
  ENTRY_CATEGORY_LABEL,
  LEAVE_TYPE_LABEL,
  LeaveStatusChip,
} from "./chips";
import { formatClock, formatDayLong, fromDayKey, workingDaysBetween } from "./dates";

export type Selected =
  | { kind: "meeting"; event: CalendarEventDTO }
  | { kind: "entry"; entry: PersonalEntryDTO }
  | { kind: "leave"; leave: LeaveRequestDTO };

interface DetailsPanelProps {
  selected: Selected;
  currentUser: UserDTO;
  onClose: () => void;
}

export function DetailsPanel({ selected, currentUser, onClose }: DetailsPanelProps) {
  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-ink/60">
          {selected.kind === "meeting" ? "Meeting" : selected.kind === "entry" ? "On your calendar" : "Leave request"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-icon bg-white p-1.5"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {selected.kind === "meeting" && (
        <MeetingDetails event={selected.event} currentUser={currentUser} />
      )}
      {selected.kind === "entry" && <EntryDetails entry={selected.entry} onDone={onClose} />}
      {selected.kind === "leave" && (
        <LeaveDetails leave={selected.leave} currentUser={currentUser} onDone={onClose} />
      )}
    </div>
  );
}

function useCalendarInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["calendar"] });
    queryClient.invalidateQueries({ queryKey: ["entries"] });
    queryClient.invalidateQueries({ queryKey: ["availability"] });
  };
}

function MeetingDetails({ event, currentUser }: { event: CalendarEventDTO; currentUser: UserDTO }) {
  const invalidate = useCalendarInvalidation();
  const addNotification = useSyncroStore((s) => s.addNotification);
  const [excuseReason, setExcuseReason] = useState("");
  const [replyMessages, setReplyMessages] = useState<Record<string, string>>({});

  const acceptMutation = useMutation({
    mutationFn: (eventId: string) => api.acceptEvent(eventId),
    onSuccess: invalidate,
  });

  const excuseMutation = useMutation({
    mutationFn: ({ eventId, reason }: { eventId: string; reason: string }) =>
      api.requestExcuse(eventId, { reason }),
    onSuccess: () => {
      invalidate();
      setExcuseReason("");
      addNotification({
        title: "Conflict Excuse Sent to Boss",
        message: "The organizer will review your message and allow or deny.",
        type: "info",
      });
    },
  });

  const decisionMutation = useMutation({
    mutationFn: ({
      eventId,
      attendeeUserId,
      decision,
      replyMessage,
    }: {
      eventId: string;
      attendeeUserId: string;
      decision: "ALLOW" | "DENY";
      replyMessage: string;
    }) => api.decideExcuse(eventId, attendeeUserId, { decision, replyMessage }),
    onSuccess: () => {
      invalidate();
      addNotification({
        title: "Decision Sent",
        message: "Attendee has been notified with your message.",
        type: "success",
      });
    },
  });

  const isOrganizer = event.organizerId === currentUser.id;
  const me = event.attendees.find((a) => a.userId === currentUser.id);
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);

  return (
    <div className="space-y-5">
      <div>
        <span className="chip bg-azure">Organized by {event.organizerName}</span>
        <h2 className="text-2xl font-extrabold leading-tight mt-3">{event.title}</h2>
        <p className="text-sm font-medium text-ink/70 mt-2">
          {event.description || "No agenda shared."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="chip bg-white py-1 px-2.5 text-xs">
          <Clock className="w-3.5 h-3.5" />
          {formatDayLong(start)}, {formatClock(start)} – {formatClock(end)}
        </span>
        <span className="chip bg-white py-1 px-2.5 text-xs">
          <Users className="w-3.5 h-3.5" />
          {event.attendees.length} invited
        </span>
        {me && <AttendeeStatusChip status={me.status} />}
      </div>

      {!isOrganizer && (
        <div className="space-y-4 pt-4 border-t-[3px] border-dashed border-ink/30">
          {event.myHasConflict && (
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-sun border-[3px] border-ink shadow-pop-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-extrabold">Overlaps something else in your day</p>
                <p className="font-medium mt-1">
                  You have another commitment at this time. You can send an excuse request to{" "}
                  <strong>{event.organizerName}</strong> so they can allow or deny it.
                </p>
              </div>
            </div>
          )}

          {me?.organizerReply && (
            <div className="p-4 rounded-2xl bg-grape/40 border-[3px] border-ink shadow-pop-sm space-y-1">
              <p className="text-xs font-extrabold">Response from {event.organizerName}:</p>
              <p className="text-sm font-semibold">&ldquo;{me.organizerReply}&rdquo;</p>
            </div>
          )}

          <button
            onClick={() => acceptMutation.mutate(event.id)}
            disabled={event.myStatus === "ACCEPTED" || acceptMutation.isPending}
            className="btn bg-mint px-5 py-2.5 w-full"
          >
            ✓ Accept meeting
          </button>

          <div className="bg-tangerine/20 border-[3px] border-ink rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-extrabold">
              <MessageSquareWarning className="w-4 h-4" />
              <span>Can&apos;t make it? Tell {event.organizerName} why:</span>
            </div>
            <textarea
              rows={2}
              value={excuseReason}
              onChange={(e) => setExcuseReason(e.target.value)}
              placeholder="I have a conflict at this time because..."
              className="field resize-none"
            />
            <button
              disabled={excuseReason.trim().length < 3 || excuseMutation.isPending}
              onClick={() => excuseMutation.mutate({ eventId: event.id, reason: excuseReason })}
              className="btn bg-tangerine w-full"
            >
              Send excuse request
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3 pt-4 border-t-[3px] border-dashed border-ink/30">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-extrabold">Who&apos;s invited</h3>
          {isOrganizer && <span className="chip bg-grape">You organized this</span>}
        </div>

        <div className="divide-y-2 divide-ink/10">
          {event.attendees.map((att) => {
            const reply = replyMessages[att.userId] ?? "";
            return (
              <div key={att.userId} className="py-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={att.name} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold truncate">{att.name}</p>
                      <p className="text-[11px] font-medium text-ink/60 truncate">
                        {att.departmentName} • {att.role.toLowerCase()}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <AttendeeStatusChip status={att.status} />
                    {att.onLeave && <span className="chip bg-tangerine text-[10px] py-0">On leave</span>}
                    {att.hasConflict && <span className="chip bg-sun text-[10px] py-0">Overlaps</span>}
                  </div>
                </div>

                {att.excuseReason && (
                  <div className="ml-10 p-3 rounded-xl bg-tangerine/20 border-2 border-ink space-y-2">
                    <p className="text-xs font-extrabold">Message from {att.name.split(" ")[0]}</p>
                    <p className="text-sm font-medium italic">&ldquo;{att.excuseReason}&rdquo;</p>
                    {att.organizerReply && (
                      <p className="text-xs font-medium pt-1 border-t-2 border-dashed border-ink/30">
                        <span className="font-extrabold">Your reply: </span>
                        &ldquo;{att.organizerReply}&rdquo;
                      </p>
                    )}
                    {isOrganizer && att.status === "EXCUSE_PENDING" && (
                      <div className="pt-1 space-y-2">
                        <input
                          type="text"
                          value={reply}
                          onChange={(e) =>
                            setReplyMessages((prev) => ({ ...prev, [att.userId]: e.target.value }))
                          }
                          placeholder={`Reply to ${att.name.split(" ")[0]}...`}
                          className="field py-2 text-xs"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={decisionMutation.isPending}
                            onClick={() =>
                              decisionMutation.mutate({
                                eventId: event.id,
                                attendeeUserId: att.userId,
                                decision: "ALLOW",
                                replyMessage: reply.trim() || "Approved, you're excused from this one.",
                              })
                            }
                            className="btn btn-sm bg-mint"
                          >
                            ✓ Allow
                          </button>
                          <button
                            disabled={decisionMutation.isPending}
                            onClick={() =>
                              decisionMutation.mutate({
                                eventId: event.id,
                                attendeeUserId: att.userId,
                                decision: "DENY",
                                replyMessage:
                                  reply.trim() || "Please join. This one needs you in the room.",
                              })
                            }
                            className="btn btn-sm bg-bubble"
                          >
                            ✕ Deny
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EntryDetails({ entry, onDone }: { entry: PersonalEntryDTO; onDone: () => void }) {
  const invalidate = useCalendarInvalidation();
  const addNotification = useSyncroStore((s) => s.addNotification);
  const isBreak = entry.type === "BREAK";

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteEntry(entry.id),
    onSuccess: () => {
      invalidate();
      addNotification({
        title: isBreak ? "Break removed" : "Removed from your day",
        message: `"${entry.title}" is gone from your calendar.`,
        type: "info",
      });
      onDone();
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <span className={`chip ${isBreak ? "bg-sun" : "bg-grape"}`}>
          {isBreak ? "☕ Break" : "Activity"} · {ENTRY_CATEGORY_LABEL[entry.category]}
        </span>
        <h2 className="text-2xl font-extrabold leading-tight mt-3">{entry.title}</h2>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="chip bg-white py-1 px-2.5 text-xs">
          <Clock className="w-3.5 h-3.5" />
          {formatDayLong(new Date(entry.startTime))}, {formatClock(entry.startTime)} – {formatClock(entry.endTime)}
        </span>
      </div>

      {isBreak ? (
        <p className="text-sm font-medium text-ink/70 bg-paper border-2 border-dashed border-ink rounded-xl p-3">
          Nobody can book a meeting over this time. Your teammates will see you as busy.
        </p>
      ) : (
        <p className="text-sm font-medium text-ink/70">
          {entry.notes || "Only you can see the details. Others see that you're busy."}
        </p>
      )}

      <button
        type="button"
        onClick={() => deleteMutation.mutate()}
        disabled={deleteMutation.isPending}
        className="btn bg-white w-full"
      >
        <Trash2 className="w-4 h-4" /> Remove from calendar
      </button>
    </div>
  );
}

function LeaveDetails({
  leave,
  currentUser,
  onDone,
}: {
  leave: LeaveRequestDTO;
  currentUser: UserDTO;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const addNotification = useSyncroStore((s) => s.addNotification);
  const [note, setNote] = useState("");
  const isMine = leave.userId === currentUser.id;
  const days = workingDaysBetween(leave.startDate, leave.endDate);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["leave"] });
    queryClient.invalidateQueries({ queryKey: ["leave-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["leave-team"] });
  };

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelLeave(leave.id),
    onSuccess: () => {
      refresh();
      addNotification({ title: "Leave cancelled", message: "Your request has been withdrawn.", type: "info" });
      onDone();
    },
  });

  const decideMutation = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") =>
      api.decideLeave(leave.id, { decision, note: note.trim() }),
    onSuccess: (_res, decision) => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      addNotification({
        title: decision === "APPROVE" ? "Leave approved" : "Leave rejected",
        message: `${leave.userName} has been told.`,
        type: decision === "APPROVE" ? "success" : "warning",
      });
      onDone();
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
    <div className="space-y-5">
      <div>
        <span className="chip bg-tangerine">{LEAVE_TYPE_LABEL[leave.type]}</span>
        <h2 className="text-2xl font-extrabold leading-tight mt-3">
          {isMine ? "Your leave" : `${leave.userName}'s leave`}
        </h2>
        <p className="text-sm font-semibold text-ink/70 mt-1">
          {fromDayKey(leave.startDate).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
          {leave.endDate !== leave.startDate &&
            ` – ${fromDayKey(leave.endDate).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}`}
          {" · "}
          {days} working day{days === 1 ? "" : "s"}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <LeaveStatusChip status={leave.status} />
        <span className="chip bg-white">{leave.departmentName}</span>
      </div>

      <div className="bg-paper border-[3px] border-ink rounded-2xl p-4 space-y-1">
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-ink/60">Reason</p>
        <p className="text-sm font-medium">{leave.reason || "No reason given."}</p>
      </div>

      {leave.decidedByName && (
        <div className="bg-white border-[3px] border-ink rounded-2xl p-4 space-y-1">
          <p className="text-xs font-extrabold">
            Decided by {leave.decidedByName}
            {leave.decidedAt ? ` on ${new Date(leave.decidedAt).toLocaleDateString([], { day: "numeric", month: "short" })}` : ""}
          </p>
          {leave.decisionNote && <p className="text-sm font-medium italic">&ldquo;{leave.decisionNote}&rdquo;</p>}
        </div>
      )}

      {isMine && leave.canCancel && (
        <button onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} className="btn bg-white w-full">
          Withdraw request
        </button>
      )}

      {leave.canDecide && (
        <div className="bg-mint/30 border-[3px] border-ink rounded-2xl p-4 space-y-3">
          <p className="text-sm font-extrabold">Your decision</p>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note for them"
            className="field py-2 text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => decideMutation.mutate("APPROVE")} disabled={decideMutation.isPending} className="btn bg-mint">
              ✓ Approve
            </button>
            <button onClick={() => decideMutation.mutate("REJECT")} disabled={decideMutation.isPending} className="btn bg-bubble">
              ✕ Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
