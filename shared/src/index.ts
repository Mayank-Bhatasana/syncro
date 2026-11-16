import { z } from "zod";

// Enums
export const RoleEnum = z.enum(["EMPLOYEE", "MANAGER", "ADMIN"]);
export type Role = z.infer<typeof RoleEnum>;

export const AttendeeStatusEnum = z.enum([
  "INVITED",
  "ACCEPTED",
  "EXCUSE_PENDING",
  "EXCUSED",
  "EXCUSE_DENIED",
]);
export type AttendeeStatus = z.infer<typeof AttendeeStatusEnum>;

export const DocAccessLevelEnum = z.enum(["VIEWER", "EDITOR"]);
export type DocAccessLevel = z.infer<typeof DocAccessLevelEnum>;

export const TargetScopeEnum = z.enum(["ALL", "DEPARTMENT", "USERS"]);
export type TargetScope = z.infer<typeof TargetScopeEnum>;

export const EntryCategoryEnum = z.enum([
  "LUNCH",
  "COFFEE",
  "BREAK",
  "FOCUS",
  "TASK",
  "TRAINING",
  "ERRAND",
  "OTHER",
]);
export type EntryCategory = z.infer<typeof EntryCategoryEnum>;

export type EntryType = "BREAK" | "ACTIVITY";

export const BREAK_CATEGORIES: readonly EntryCategory[] = ["LUNCH", "COFFEE", "BREAK"];

export function entryTypeOf(category: EntryCategory): EntryType {
  return BREAK_CATEGORIES.includes(category) ? "BREAK" : "ACTIVITY";
}

export const LeaveTypeEnum = z.enum(["ANNUAL", "SICK", "PERSONAL"]);
export type LeaveType = z.infer<typeof LeaveTypeEnum>;

export const LeaveStatusEnum = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);
export type LeaveStatus = z.infer<typeof LeaveStatusEnum>;

export const ANNUAL_LEAVE_ALLOWANCE = 20;
export const MAX_LEAVE_DAYS_PER_REQUEST = 30;

// Auth Schemas
export const LoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(4, "Password is required"),
});
export type LoginInput = z.infer<typeof LoginSchema>;

// Chat Schemas
export const CreateConversationSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  isGroup: z.boolean().default(false),
  memberIds: z.array(z.string().uuid()).min(1, "Select at least one member"),
});
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;

export const SendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().trim().max(4000).default(""),
  mediaUrl: z.string().max(15_000_000).optional().nullable(),
  mediaType: z.enum(["image", "video"]).optional().nullable(),
}).refine((d) => d.content.length > 0 || Boolean(d.mediaUrl), {
  message: "Message must contain text or media",
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const TypingEventSchema = z.object({
  conversationId: z.string().uuid(),
  isTyping: z.boolean(),
});
export type TypingEventInput = z.infer<typeof TypingEventSchema>;

// Calendar Schemas
export const CreateEventSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(160),
    description: z.string().trim().max(2000).optional().default(""),
    startTime: z.string().datetime({ offset: true, message: "Valid ISO start time required" }),
    endTime: z.string().datetime({ offset: true, message: "Valid ISO end time required" }),
    targetScope: TargetScopeEnum,
    departmentIds: z.array(z.string().uuid()).optional().default([]),
    userIds: z.array(z.string().uuid()).optional().default([]),
    excludeUserIds: z.array(z.string().uuid()).optional().default([]),
  })
  .refine((data) => new Date(data.endTime) > new Date(data.startTime), {
    message: "End time must be after start time",
    path: ["endTime"],
  });
export type CreateEventInput = z.infer<typeof CreateEventSchema>;

export const CreatePersonalEntrySchema = z
  .object({
    category: EntryCategoryEnum,
    title: z.string().trim().min(1, "Give it a name").max(120),
    notes: z.string().trim().max(1000).optional().default(""),
    startTime: z.string().datetime({ offset: true, message: "Valid ISO start time required" }),
    endTime: z.string().datetime({ offset: true, message: "Valid ISO end time required" }),
    repeatWeeks: z.number().int().min(0).max(4).optional().default(0),
  })
  .refine((data) => new Date(data.endTime) > new Date(data.startTime), {
    message: "End time must be after start time",
    path: ["endTime"],
  });
export type CreatePersonalEntryInput = z.infer<typeof CreatePersonalEntrySchema>;

export const RescheduleSchema = z
  .object({
    startTime: z.string().datetime({ offset: true, message: "Valid ISO start time required" }),
    endTime: z.string().datetime({ offset: true, message: "Valid ISO end time required" }),
  })
  .refine((data) => new Date(data.endTime) > new Date(data.startTime), {
    message: "End time must be after start time",
    path: ["endTime"],
  });
export type RescheduleInput = z.infer<typeof RescheduleSchema>;

const DateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format");

export const CreateLeaveRequestSchema = z
  .object({
    type: LeaveTypeEnum,
    startDate: DateKeySchema,
    endDate: DateKeySchema,
    reason: z.string().trim().min(3, "Add a short reason").max(500),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  });
export type CreateLeaveRequestInput = z.infer<typeof CreateLeaveRequestSchema>;

export const LeaveDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(500).optional().default(""),
});
export type LeaveDecisionInput = z.infer<typeof LeaveDecisionSchema>;

export const RequestExcuseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Please explain why you cannot attend")
    .max(1000),
});
export type RequestExcuseInput = z.infer<typeof RequestExcuseSchema>;

export const DecideExcuseSchema = z.object({
  decision: z.enum(["ALLOW", "DENY"]),
  replyMessage: z
    .string()
    .trim()
    .min(1, "Please provide a response message to the employee")
    .max(1000),
});
export type DecideExcuseInput = z.infer<typeof DecideExcuseSchema>;

export const AvailabilityQuerySchema = z.object({
  userIds: z.string().min(1, "Provide comma-separated userIds"),
  from: z.string().datetime(),
  to: z.string().datetime(),
});

// Document Schemas
export const CreateDocumentSchema = z.object({
  title: z.string().trim().min(1, "Document title is required").max(200),
});
export type CreateDocumentInput = z.infer<typeof CreateDocumentSchema>;

export const ShareDocumentSchema = z.object({
  userId: z.string().uuid("Valid user ID required"),
  accessLevel: DocAccessLevelEnum,
});
export type ShareDocumentInput = z.infer<typeof ShareDocumentSchema>;

// Shared DTO Types
export interface UserDTO {
  id: string;
  email: string;
  name: string;
  jobTitle?: string | null;
  role: Role;
  departmentId: string;
  departmentName: string;
}

export interface DepartmentDTO {
  id: string;
  name: string;
  memberCount?: number;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderRole: Role;
  content: string;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | null;
  createdAt: string;
}

export interface ConversationDTO {
  id: string;
  name: string | null;
  isGroup: boolean;
  createdAt: string;
  unreadCount: number;
  members: UserDTO[];
  lastMessage: MessageDTO | null;
}

export interface EventAttendeeDTO {
  userId: string;
  name: string;
  email: string;
  departmentName: string;
  role: Role;
  status: AttendeeStatus;
  hasConflict: boolean;
  onLeave: boolean;
  excuseReason: string | null;
  organizerReply: string | null;
  respondedAt: string | null;
}

export interface CalendarEventDTO {
  id: string;
  organizerId: string;
  organizerName: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  createdAt: string;
  myStatus?: AttendeeStatus;
  myHasConflict?: boolean;
  attendees: EventAttendeeDTO[];
}

export interface PersonalEntryDTO {
  id: string;
  userId: string;
  category: EntryCategory;
  type: EntryType;
  title: string;
  notes: string;
  startTime: string;
  endTime: string;
}

export interface LeaveRequestDTO {
  id: string;
  userId: string;
  userName: string;
  departmentName: string;
  type: LeaveType;
  status: LeaveStatus;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  decisionNote: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
  canCancel: boolean;
  canDecide: boolean;
}

export interface LeaveBalanceDTO {
  annualAllowance: number;
  annualUsed: number;
  annualPending: number;
  annualRemaining: number;
}

export interface TeamLeaveDTO {
  id: string;
  userId: string;
  userName: string;
  departmentName: string;
  status: LeaveStatus;
  startDate: string;
  endDate: string;
}

export interface ConflictDetailDTO {
  userId: string;
  name: string;
  reason: "BREAK" | "LEAVE";
  label: string;
  startTime: string;
  endTime: string;
}

export interface BusyBlockDTO {
  userId: string;
  startTime: string;
  endTime: string;
  type: "MEETING" | "ACTIVITY" | "BREAK" | "LEAVE";
  label: string;
}

export interface DocumentPermissionDTO {
  userId: string;
  userName: string;
  userEmail: string;
  accessLevel: DocAccessLevel;
}

export interface DocumentDTO {
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  myAccess: "OWNER" | DocAccessLevel;
  permissions: DocumentPermissionDTO[];
  updatedAt: string;
  createdAt: string;
}

export * from "./media";
