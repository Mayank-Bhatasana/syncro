import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { AttendeeStatus, EntryCategory, LeaveStatus, LeaveType } from "@syncro/shared";

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  ANNUAL: "Annual leave",
  SICK: "Sick leave",
  PERSONAL: "Personal leave",
};

export const ENTRY_CATEGORY_LABEL: Record<EntryCategory, string> = {
  LUNCH: "Lunch",
  COFFEE: "Coffee break",
  BREAK: "Break",
  FOCUS: "Focus time",
  TASK: "Task",
  TRAINING: "Training",
  ERRAND: "Personal errand",
  OTHER: "Other",
};

export const BREAK_CATEGORIES: EntryCategory[] = ["LUNCH", "COFFEE", "BREAK"];
export const ACTIVITY_CATEGORIES: EntryCategory[] = ["FOCUS", "TASK", "TRAINING", "ERRAND", "OTHER"];

export function AttendeeStatusChip({ status }: { status: AttendeeStatus }) {
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
          <AlertTriangle className="w-3 h-3" /> Excuse requested
        </span>
      );
    case "EXCUSED":
      return (
        <span className="chip bg-azure">
          <CheckCircle2 className="w-3 h-3" /> Excused by organizer
        </span>
      );
    case "EXCUSE_DENIED":
      return (
        <span className="chip bg-bubble">
          <XCircle className="w-3 h-3" /> Must attend
        </span>
      );
    default:
      return <span className="chip bg-white">Invited</span>;
  }
}

export function LeaveStatusChip({ status }: { status: LeaveStatus }) {
  switch (status) {
    case "PENDING":
      return (
        <span className="chip bg-sun">
          <Clock className="w-3 h-3" /> Waiting for approval
        </span>
      );
    case "APPROVED":
      return (
        <span className="chip bg-mint">
          <CheckCircle2 className="w-3 h-3" /> Approved
        </span>
      );
    case "REJECTED":
      return (
        <span className="chip bg-bubble">
          <XCircle className="w-3 h-3" /> Rejected
        </span>
      );
    default:
      return <span className="chip bg-white text-ink/60">Cancelled</span>;
  }
}
