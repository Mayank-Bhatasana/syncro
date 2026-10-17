import {
  UserDTO,
  DepartmentDTO,
  ConversationDTO,
  MessageDTO,
  CalendarEventDTO,
  BusyBlockDTO,
  DocumentDTO,
  CreateConversationInput,
  CreateEventInput,
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
    throw new Error(data.error || "Request failed");
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

  // Calendar
  getCalendar: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return apiFetch<{ events: CalendarEventDTO[] }>(
      `/api/calendar${qs ? `?${qs}` : ""}`
    );
  },
  createEvent: (input: CreateEventInput) =>
    apiFetch<{
      event: CalendarEventDTO;
      conflictsCount: number;
      conflictingUserIds: string[];
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

  // Collaborative Docs
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
