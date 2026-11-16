import {
  UserDTO,
  DepartmentDTO,
  ConversationDTO,
  MessageDTO,
  CalendarEventDTO,
  BusyBlockDTO,
  ConflictDetailDTO,
  DocumentDTO,
  PersonalEntryDTO,
  LeaveRequestDTO,
  LeaveBalanceDTO,
  TeamLeaveDTO,
  CreateConversationInput,
  CreateEventInput,
  CreatePersonalEntryInput,
  RescheduleInput,
  CreateLeaveRequestInput,
  LeaveDecisionInput,
  RequestExcuseInput,
  DecideExcuseInput,
  CreateDocumentInput,
  ShareDocumentInput,
} from "@syncro/shared";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
  if (typeof window !== "undefined") {
    if (token) {
      localStorage.setItem("syncro_token", token);
    } else {
      localStorage.removeItem("syncro_token");
    }
  }
}

export function getAuthToken(): string | null {
  if (authToken) return authToken;
  if (typeof window !== "undefined") {
    authToken = localStorage.getItem("syncro_token");
  }
  return authToken;
}

export class ApiError extends Error {
  status: number;
  details?: Array<Partial<ConflictDetailDTO> & { label?: string }>;

  constructor(message: string, status: number, details?: ApiError["details"]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || "Request failed", res.status, data.details);
  }
  return data as T;
}

export const api = {
  // Auth & Org
  getDemoAccounts: () =>
    apiFetch<{ users: UserDTO[] }>("/api/auth/demo-accounts"),
  login: (email: string, password: string) =>
    apiFetch<{ user: UserDTO; token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () =>
    apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  getMe: () =>
    apiFetch<{ user: UserDTO; onlineUserIds: string[] }>("/api/auth/me"),
  getUsers: () => apiFetch<{ users: UserDTO[] }>("/api/users"),
  getDepartments: () =>
    apiFetch<{ departments: DepartmentDTO[] }>("/api/departments"),

  // Chat
  getConversations: () =>
    apiFetch<{ conversations: ConversationDTO[] }>("/api/conversations"),
  createConversation: (input: CreateConversationInput) =>
    apiFetch<{ conversation: ConversationDTO }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getMessages: (conversationId: string, cursor?: string) =>
    apiFetch<{ messages: MessageDTO[]; nextCursor: string | null }>(
      `/api/conversations/${conversationId}/messages${
        cursor ? `?cursor=${cursor}` : ""
      }`
    ),

  // Calendar: meetings
  getCalendar: (from: string, to: string) =>
    apiFetch<{ events: CalendarEventDTO[] }>(
      `/api/calendar?${new URLSearchParams({ from, to }).toString()}`
    ),
  createEvent: (input: CreateEventInput) =>
    apiFetch<{
      event: CalendarEventDTO;
      conflictsCount: number;
      conflictingUserIds: string[];
      excludedOnLeave: { userId: string; name: string }[];
    }>("/api/events", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  acceptEvent: (eventId: string) =>
    apiFetch<{ event: CalendarEventDTO }>(`/api/events/${eventId}/accept`, {
      method: "PATCH",
    }),
  requestExcuse: (eventId: string, input: RequestExcuseInput) =>
    apiFetch<{ event: CalendarEventDTO }>(`/api/events/${eventId}/excuse`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  decideExcuse: (
    eventId: string,
    attendeeUserId: string,
    input: DecideExcuseInput
  ) =>
    apiFetch<{ event: CalendarEventDTO }>(
      `/api/events/${eventId}/attendees/${attendeeUserId}/decision`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      }
    ),
  getAvailability: (userIds: string[], from: string, to: string) => {
    const params = new URLSearchParams({
      userIds: userIds.join(","),
      from,
      to,
    });
    return apiFetch<{ busyBlocks: BusyBlockDTO[] }>(
      `/api/availability?${params.toString()}`
    );
  },

  // Calendar: personal breaks and activities
  getEntries: (from: string, to: string) =>
    apiFetch<{ entries: PersonalEntryDTO[] }>(
      `/api/entries?${new URLSearchParams({ from, to }).toString()}`
    ),
  createEntry: (input: CreatePersonalEntryInput) =>
    apiFetch<{ entries: PersonalEntryDTO[] }>("/api/entries", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  moveEntry: (id: string, input: RescheduleInput) =>
    apiFetch<{ entry: PersonalEntryDTO }>(`/api/entries/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  moveEvent: (eventId: string, input: RescheduleInput) =>
    apiFetch<{ event: CalendarEventDTO }>(`/api/events/${eventId}/time`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteEntry: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/entries/${id}`, { method: "DELETE" }),

  // Calendar: leave
  getLeave: () =>
    apiFetch<{ requests: LeaveRequestDTO[]; balance: LeaveBalanceDTO }>("/api/leave"),
  getLeaveApprovals: () =>
    apiFetch<{ requests: LeaveRequestDTO[] }>("/api/leave/approvals"),
  getTeamLeave: (from: string, to: string) =>
    apiFetch<{ leaves: TeamLeaveDTO[] }>(
      `/api/leave/team?${new URLSearchParams({ from, to }).toString()}`
    ),
  requestLeave: (input: CreateLeaveRequestInput) =>
    apiFetch<{ leave: LeaveRequestDTO }>("/api/leave", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  decideLeave: (id: string, input: LeaveDecisionInput) =>
    apiFetch<{ leave: LeaveRequestDTO }>(`/api/leave/${id}/decision`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  cancelLeave: (id: string) =>
    apiFetch<{ leave: LeaveRequestDTO }>(`/api/leave/${id}/cancel`, {
      method: "PATCH",
    }),

  // Shared Docs
  getDocuments: () => apiFetch<{ documents: DocumentDTO[] }>("/api/documents"),
  createDocument: (input: CreateDocumentInput) =>
    apiFetch<{ document: DocumentDTO }>("/api/documents", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getDocument: (id: string) =>
    apiFetch<{ document: DocumentDTO }>(`/api/documents/${id}`),
  shareDocument: (id: string, input: ShareDocumentInput) =>
    apiFetch<{ document: DocumentDTO }>(`/api/documents/${id}/share`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
};
