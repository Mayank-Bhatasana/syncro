"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useSyncroStore } from "../store/useSyncroStore";
import { CalendarEventDTO, TargetScope } from "@syncro/shared";
import { Avatar } from "./ui";
import {
  Calendar as CalendarIcon,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Plus,
  ShieldAlert,
  Eye,
  MessageSquareWarning,
  Users,
} from "lucide-react";

export function CalendarModule() {
  const queryClient = useQueryClient();
  const currentUser = useSyncroStore((s) => s.currentUser)!;
  const addNotification = useSyncroStore((s) => s.addNotification);

  const [selectedEvent, setSelectedEvent] = useState<CalendarEventDTO | null>(
    null
  );
  const [showBookModal, setShowBookModal] = useState(false);

  // Excuse Request state (Attendee -> Boss)
  const [excuseReason, setExcuseReason] = useState("");
  // Boss Decision state (Boss -> Attendee)
  const [replyMessages, setReplyMessages] = useState<Record<string, string>>(
    {}
  );

  // Free/Busy Inspector state
  const [inspectUserIds, setInspectUserIds] = useState<string[]>([]);

  // Book Meeting Form state
  const canBookForOrgOrDept =
    currentUser.role === "MANAGER" || currentUser.role === "ADMIN";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetScope, setTargetScope] = useState<TargetScope>(
    canBookForOrgOrDept ? "DEPARTMENT" : "USERS"
  );
  const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  // Default to today 14:30 - 15:30 so conflicts are easy to test
  const todayStr = new Date().toISOString().slice(0, 10);
  const [dateStr, setDateStr] = useState(todayStr);
  const [startHour, setStartHour] = useState("14:30");
  const [endHour, setEndHour] = useState("15:30");
  const [bookingError, setBookingError] = useState<string | null>(null);

  const { data: calData } = useQuery({
    queryKey: ["calendar"],
    queryFn: () => api.getCalendar(),
  });

  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: api.getUsers,
  });

  const { data: deptsData } = useQuery({
    queryKey: ["departments"],
    queryFn: api.getDepartments,
  });

  const dayStartISO = new Date(`${dateStr}T00:00:00`).toISOString();
  const dayEndISO = new Date(`${dateStr}T23:59:59`).toISOString();

  const { data: availabilityData } = useQuery({
    queryKey: ["availability", inspectUserIds, dayStartISO, dayEndISO],
    queryFn: () =>
      api.getAvailability(inspectUserIds, dayStartISO, dayEndISO),
    enabled: inspectUserIds.length > 0,
  });

  const events = calData?.events || [];
  const allUsers = usersData?.users || [];
  const departments = deptsData?.departments || [];

  // Keep selectedEvent synced with latest query data
  const activeEvent =
    events.find((e) => e.id === selectedEvent?.id) || events[0] || null;

  const createEventMutation = useMutation({
    mutationFn: api.createEvent,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      setSelectedEvent(res.event);
      setShowBookModal(false);
      setTitle("");
      setDescription("");
      setBookingError(null);
      addNotification({
        title: "Meeting Booked",
        message:
          res.conflictsCount > 0
            ? `Created with ${res.conflictsCount} attendee schedule conflict(s) flagged.`
            : "All attendees are free and invited!",
        type: res.conflictsCount > 0 ? "warning" : "success",
      });
    },
    onError: (err: any) => {
      setBookingError(err.message);
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (eventId: string) => api.acceptEvent(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
  });

  const excuseMutation = useMutation({
    mutationFn: ({ eventId, reason }: { eventId: string; reason: string }) =>
      api.requestExcuse(eventId, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
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
    }) =>
      api.decideExcuse(eventId, attendeeUserId, { decision, replyMessage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      addNotification({
        title: "Decision Sent",
        message: "Attendee has been notified with your message.",
        type: "success",
      });
    },
  });

  const handleCreateMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    setBookingError(null);

    const startTime = new Date(`${dateStr}T${startHour}:00`).toISOString();
    const endTime = new Date(`${dateStr}T${endHour}:00`).toISOString();

    createEventMutation.mutate({
      title,
      description,
      startTime,
      endTime,
      targetScope,
      departmentIds: selectedDeptIds,
      userIds: selectedUserIds,
    });
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "ACCEPTED":
        return (
          <span className="chip bg-mint">
            <CheckCircle2 className="w-3 h-3" /> Accepted
          </span>
        );
      case "EXCUSE_PENDING":
        return (
          <span className="chip bg-sun">
            <AlertTriangle className="w-3 h-3" /> Excuse Requested
          </span>
        );
      case "EXCUSED":
        return (
          <span className="chip bg-azure">
            <CheckCircle2 className="w-3 h-3" /> Excused by Boss
          </span>
        );
      case "EXCUSE_DENIED":
        return (
          <span className="chip bg-bubble">
            <XCircle className="w-3 h-3" /> Excuse Denied (Must Attend)
          </span>
        );
      default:
        return <span className="chip bg-white">Invited</span>;
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left Column: My Calendar Events + Privacy Free/Busy Checker */}
      <div className="w-96 border-r-[3px] border-ink flex flex-col bg-white">
        <div className="sidebar-band bg-azure">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-white border-2 border-ink shadow-pop-sm flex items-center justify-center shrink-0">
              <CalendarIcon className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="font-extrabold text-lg leading-tight">
                My Calendar
              </h2>
              <p className="text-[11px] font-semibold text-ink/70">
                Events where I&apos;m an attendee
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowBookModal(true)}
            className="btn btn-sm bg-white shrink-0"
          >
            <Plus className="w-4 h-4" />
            Book Meeting
          </button>
        </div>

        {/* Event List */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
          {events.map((ev) => {
            const isSelected = activeEvent?.id === ev.id;
            const pendingExcusesCount = ev.attendees.filter(
              (a) => a.status === "EXCUSE_PENDING"
            ).length;

            return (
              <button
                key={ev.id}
                onClick={() => setSelectedEvent(ev)}
                className={`select-card ${
                  isSelected ? "select-card-active bg-azure/30" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-extrabold text-sm">{ev.title}</h3>
                  {ev.myHasConflict && (
                    <span className="chip bg-sun shrink-0">⚠️ Conflict</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-xs font-semibold text-ink/70 mt-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    {new Date(ev.startTime).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    •{" "}
                    {new Date(ev.startTime).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    –{" "}
                    {new Date(ev.endTime).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
                  {ev.myStatus && statusBadge(ev.myStatus)}
                  {ev.organizerId === currentUser.id &&
                    pendingExcusesCount > 0 && (
                      <span className="chip bg-tangerine">
                        {pendingExcusesCount} Excuse Request(s)
                      </span>
                    )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Privacy-Preserving Free/Busy Checker */}
        <div className="p-4 border-t-[3px] border-ink bg-paper space-y-3">
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <Eye className="w-4 h-4" />
            <span>Check If Someone Is Free (Busy Blocks Only)</span>
          </div>
          <p className="text-[11px] font-medium text-ink/60">
            Returns only start & end times — titles and descriptions stay
            private.
          </p>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-0.5">
            {allUsers.map((u) => {
              const selected = inspectUserIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  onClick={() =>
                    setInspectUserIds((prev) =>
                      selected
                        ? prev.filter((id) => id !== u.id)
                        : [...prev, u.id]
                    )
                  }
                  className={`chip rounded-lg py-1 text-[11px] transition hover:-translate-y-px ${
                    selected ? "bg-grape" : "bg-white"
                  }`}
                >
                  {u.name.split(" ")[0]} ({u.departmentName})
                </button>
              );
            })}
          </div>

          {inspectUserIds.length > 0 && (
            <div className="bg-white border-[3px] border-ink rounded-2xl p-2.5 space-y-2 max-h-32 overflow-y-auto shadow-pop-sm">
              {(availabilityData?.busyBlocks || []).length === 0 ? (
                <span className="chip bg-mint">
                  ✓ Completely free on {dateStr}
                </span>
              ) : (
                availabilityData?.busyBlocks.map((b, i) => {
                  const u = allUsers.find((user) => user.id === b.userId);
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 text-xs bg-paper border-2 border-ink px-2.5 py-1.5 rounded-xl"
                    >
                      <span className="font-extrabold">{u?.name || "User"}</span>
                      <span className="chip bg-tangerine font-mono">
                        BUSY{" "}
                        {new Date(b.startTime).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        –{" "}
                        {new Date(b.endTime).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Selected Event Details + Conflict Excuse Workflow */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeEvent ? (
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Event Header Card */}
            <div className="card p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="chip bg-azure uppercase tracking-wide">
                    Organized by {activeEvent.organizerName}
                  </span>
                  <h1 className="text-3xl font-extrabold leading-tight mt-3">
                    {activeEvent.title}
                  </h1>
                  <p className="text-sm font-medium text-ink/70 mt-2">
                    {activeEvent.description || "No description provided."}
                  </p>
                </div>
                {activeEvent.myStatus && statusBadge(activeEvent.myStatus)}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-4 border-t-[3px] border-dashed border-ink/30">
                <span className="chip bg-white py-1 px-2.5 text-xs">
                  <Clock className="w-4 h-4" />
                  {new Date(activeEvent.startTime).toLocaleString([], {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  –{" "}
                  {new Date(activeEvent.endTime).toLocaleTimeString([], {
                    timeStyle: "short",
                  })}
                </span>
                <span className="chip bg-white py-1 px-2.5 text-xs">
                  <Users className="w-4 h-4" />
                  {activeEvent.attendees.length} Attendees
                </span>
              </div>

              {/* Attendee Actions: Accept OR Tell Boss "Hey I can't be there" */}
              {activeEvent.organizerId !== currentUser.id && (
                <div className="pt-4 border-t-[3px] border-dashed border-ink/30 space-y-4">
                  {activeEvent.myHasConflict && (
                    <div className="flex items-start gap-3 p-4 rounded-2xl bg-sun border-[3px] border-ink shadow-pop-sm">
                      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-extrabold">
                          Schedule Conflict Detected on Your Calendar
                        </p>
                        <p className="font-medium mt-1">
                          You have another overlapping meeting during this time
                          slot. You can send an excuse request message to{" "}
                          <strong>{activeEvent.organizerName}</strong> below so
                          they can allow or deny it.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Show Boss Reply if the boss already decided */}
                  {activeEvent.attendees.find(
                    (a) => a.userId === currentUser.id
                  )?.organizerReply && (
                    <div className="p-4 rounded-2xl bg-grape/40 border-[3px] border-ink shadow-pop-sm space-y-1">
                      <p className="text-xs font-extrabold">
                        Response from {activeEvent.organizerName} (Organizer):
                      </p>
                      <p className="text-sm font-semibold">
                        &ldquo;
                        {
                          activeEvent.attendees.find(
                            (a) => a.userId === currentUser.id
                          )?.organizerReply
                        }
                        &rdquo;
                      </p>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      onClick={() => acceptMutation.mutate(activeEvent.id)}
                      disabled={
                        activeEvent.myStatus === "ACCEPTED" ||
                        acceptMutation.isPending
                      }
                      className="btn bg-mint px-5 py-2.5"
                    >
                      ✓ Accept & Attend Meeting
                    </button>
                  </div>

                  {/* "Hey I can't be there" form */}
                  <div className="bg-tangerine/20 border-[3px] border-ink rounded-2xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-extrabold">
                      <MessageSquareWarning className="w-4 h-4" />
                      <span>
                        Have a conflict? Tell {activeEvent.organizerName} why
                        you can&apos;t be there:
                      </span>
                    </div>
                    <textarea
                      rows={2}
                      value={excuseReason}
                      onChange={(e) => setExcuseReason(e.target.value)}
                      placeholder="Hey boss, I have an overlapping meeting / conflict at this time because..."
                      className="field resize-none"
                    />
                    <button
                      disabled={
                        excuseReason.trim().length < 3 ||
                        excuseMutation.isPending
                      }
                      onClick={() =>
                        excuseMutation.mutate({
                          eventId: activeEvent.id,
                          reason: excuseReason,
                        })
                      }
                      className="btn bg-tangerine"
                    >
                      Send Conflict / Excuse Request to Boss
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Attendees & Boss Approval Panel */}
            <div className="card p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-extrabold">
                  Attendees & Conflict Excuse Requests (
                  {activeEvent.attendees.length})
                </h2>
                {activeEvent.organizerId === currentUser.id && (
                  <span className="chip bg-grape py-1">
                    You are the Meeting Organizer — You can Allow or Deny
                    conflicts
                  </span>
                )}
              </div>

              <div className="divide-y-2 divide-ink/10">
                {activeEvent.attendees.map((att) => {
                  const isOrganizer =
                    activeEvent.organizerId === currentUser.id;
                  const replyVal = replyMessages[att.userId] ?? "";

                  return (
                    <div key={att.userId} className="py-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar name={att.name} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-extrabold text-sm">
                                {att.name}
                              </span>
                              <span className="chip bg-paper">
                                {att.departmentName}
                              </span>
                              <span className="text-[11px] font-semibold text-ink/60">
                                {att.role}
                              </span>
                              {att.hasConflict && (
                                <span className="chip bg-sun">
                                  ⚠️ Has Overlapping Event
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-ink/60 mt-0.5">
                              {att.email}
                            </p>
                          </div>
                        </div>
                        {statusBadge(att.status)}
                      </div>

                      {/* Show Attendee's Excuse Message if present */}
                      {att.excuseReason && (
                        <div className="ml-4 p-4 rounded-2xl bg-tangerine/20 border-2 border-ink space-y-2">
                          <p className="text-xs font-extrabold">
                            Message from {att.name}:
                          </p>
                          <p className="text-sm font-medium italic">
                            &ldquo;{att.excuseReason}&rdquo;
                          </p>

                          {att.organizerReply && (
                            <div className="pt-2 border-t-2 border-dashed border-ink/30 text-xs font-medium">
                              <span className="font-extrabold">
                                Boss Reply:{" "}
                              </span>
                              &ldquo;{att.organizerReply}&rdquo;
                            </div>
                          )}

                          {/* Boss Allow / Deny Controls */}
                          {isOrganizer && (
                            <div className="pt-2 space-y-2">
                              <input
                                type="text"
                                value={replyVal}
                                onChange={(e) =>
                                  setReplyMessages((prev) => ({
                                    ...prev,
                                    [att.userId]: e.target.value,
                                  }))
                                }
                                placeholder={`Write a message back to ${
                                  att.name.split(" ")[0]
                                } (e.g., "No problem, catch the recording" or "We need you for the IT part")...`}
                                className="field py-2 text-xs"
                              />
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  disabled={decisionMutation.isPending}
                                  onClick={() =>
                                    decisionMutation.mutate({
                                      eventId: activeEvent.id,
                                      attendeeUserId: att.userId,
                                      decision: "ALLOW",
                                      replyMessage:
                                        replyVal.trim() ||
                                        "Approved — you are excused from this meeting.",
                                    })
                                  }
                                  className="btn btn-sm bg-mint"
                                >
                                  ✓ Allow (Excuse from Meeting)
                                </button>
                                <button
                                  disabled={decisionMutation.isPending}
                                  onClick={() =>
                                    decisionMutation.mutate({
                                      eventId: activeEvent.id,
                                      attendeeUserId: att.userId,
                                      decision: "DENY",
                                      replyMessage:
                                        replyVal.trim() ||
                                        "Denied — this meeting is high priority, please reschedule your other slot.",
                                    })
                                  }
                                  className="btn btn-sm bg-bubble"
                                >
                                  ✕ Deny Excuse
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
        ) : (
          <div className="min-h-[60vh] flex items-center justify-center font-display font-bold text-lg text-ink/50 text-center p-6">
            Select an event from your calendar or book a new meeting
          </div>
        )}
      </div>

      {/* Book Meeting Modal */}
      {showBookModal && (
        <div className="modal-backdrop">
          <form
            onSubmit={handleCreateMeeting}
            className="modal max-w-xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-2xl font-extrabold">Book a Meeting</h3>
              <span className="chip bg-grape py-1">
                Your Role: {currentUser.role}
              </span>
            </div>

            {bookingError && (
              <div className="p-3 rounded-xl bg-bubble border-[3px] border-ink text-xs font-bold flex items-center gap-2 shadow-pop-sm">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{bookingError}</span>
              </div>
            )}

            <div>
              <label className="label">Meeting Title</label>
              <input
                required
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., IT + HR Quarterly Sync"
                className="field"
              />
            </div>

            <div>
              <label className="label">Description / Agenda</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Agenda items..."
                className="field resize-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Date</label>
                <input
                  type="date"
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                  className="field"
                />
              </div>
              <div>
                <label className="label">Start Time</label>
                <input
                  type="time"
                  value={startHour}
                  onChange={(e) => setStartHour(e.target.value)}
                  className="field"
                />
              </div>
              <div>
                <label className="label">End Time</label>
                <input
                  type="time"
                  value={endHour}
                  onChange={(e) => setEndHour(e.target.value)}
                  className="field"
                />
              </div>
            </div>

            {/* Target Scope Selector */}
            <div>
              <label className="label">
                Who should be invited? (Server expands into individual attendee
                rows)
              </label>
              <div className="grid grid-cols-3 gap-2.5">
                {(["DEPARTMENT", "USERS", "ALL"] as TargetScope[]).map(
                  (scope) => {
                    const restricted =
                      !canBookForOrgOrDept &&
                      (scope === "ALL" || scope === "DEPARTMENT");
                    const selected = targetScope === scope;
                    return (
                      <button
                        type="button"
                        key={scope}
                        onClick={() => setTargetScope(scope)}
                        className={`p-3 rounded-2xl border-[3px] text-left transition-all duration-150 ${
                          selected
                            ? "bg-azure border-ink shadow-pop-sm -translate-x-px -translate-y-px"
                            : "bg-white border-ink/20 hover:border-ink"
                        }`}
                      >
                        <div className="font-display font-extrabold text-sm">
                          {scope}
                        </div>
                        <div className="text-[10px] font-semibold text-ink/70">
                          {scope === "ALL"
                            ? "Entire Company"
                            : scope === "DEPARTMENT"
                            ? "Depts + Specific People"
                            : "Specific Individuals"}
                        </div>
                        {restricted && (
                          <span className="chip bg-sun mt-1.5 text-[9px] py-0">
                            Manager Only
                          </span>
                        )}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* Department Checkboxes (e.g., "only IT") */}
            {targetScope === "DEPARTMENT" && (
              <div>
                <label className="label">
                  Select Department(s) (e.g., &ldquo;Only IT&rdquo;)
                </label>
                <div className="flex flex-wrap gap-2">
                  {departments.map((d) => {
                    const checked = selectedDeptIds.includes(d.id);
                    const deptMemberIds = allUsers
                      .filter((u) => u.departmentId === d.id)
                      .map((u) => u.id);

                    return (
                      <button
                        type="button"
                        key={d.id}
                        onClick={() => {
                          setSelectedDeptIds((prev) =>
                            checked
                              ? prev.filter((id) => id !== d.id)
                              : [...prev, d.id]
                          );
                          setSelectedUserIds((prev) =>
                            checked
                              ? prev.filter((uid) => !deptMemberIds.includes(uid))
                              : Array.from(new Set([...prev, ...deptMemberIds]))
                          );
                        }}
                        className={`chip rounded-xl py-1.5 px-3 text-xs transition hover:-translate-y-px ${
                          checked ? "bg-azure" : "bg-white"
                        }`}
                      >
                        {d.name} Department ({d.memberCount} members)
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Specific Individuals (can combine with Department, e.g., "Only IT + 1 HR person") */}
            {(targetScope === "USERS" || targetScope === "DEPARTMENT") && (
              <div>
                <label className="label">
                  {targetScope === "DEPARTMENT"
                    ? `Selected Attendees (${selectedUserIds.length} selected — auto-checked from Department + add/remove individuals)`
                    : `Select Specific Individuals (${selectedUserIds.length} selected)`}
                </label>
                <div className="max-h-40 overflow-y-auto border-[3px] border-ink rounded-2xl p-2 space-y-1.5 bg-paper">
                  {allUsers.map((u) => {
                    const checked =
                      selectedUserIds.includes(u.id) ||
                      selectedDeptIds.includes(u.departmentId);
                    const inSelectedDept = selectedDeptIds.includes(
                      u.departmentId
                    );
                    return (
                      <label
                        key={u.id}
                        className={`flex items-center justify-between gap-2 p-2 rounded-xl border-2 text-xs cursor-pointer transition ${
                          checked
                            ? "bg-azure/30 border-ink"
                            : "bg-white border-transparent hover:border-ink/30"
                        }`}
                      >
                        <span className="flex flex-wrap items-center gap-1.5 min-w-0">
                          <strong className="text-sm font-extrabold">
                            {u.name}
                          </strong>
                          <span className="text-ink/60 font-medium">
                            ({u.departmentName} • {u.role})
                          </span>
                          {inSelectedDept && (
                            <span className="chip bg-grape text-[10px] py-0">
                              via {u.departmentName} Dept
                            </span>
                          )}
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedUserIds((prev) =>
                              prev.includes(u.id)
                                ? prev.filter((id) => id !== u.id)
                                : [...prev, u.id]
                            )
                          }
                          className="w-4 h-4 accent-azure cursor-pointer shrink-0"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowBookModal(false);
                  setBookingError(null);
                }}
                className="btn bg-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createEventMutation.isPending}
                className="btn bg-azure px-5"
              >
                {createEventMutation.isPending
                  ? "Checking Conflicts & Booking..."
                  : "Book Meeting"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
