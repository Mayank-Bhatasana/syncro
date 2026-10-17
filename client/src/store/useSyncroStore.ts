import { create } from "zustand";
import { UserDTO } from "@syncro/shared";

export interface ToastNotification {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "success";
  createdAt: number;
}

interface SyncroStore {
  currentUser: UserDTO | null;
  setCurrentUser: (user: UserDTO | null) => void;

  activeTab: "chat" | "calendar" | "docs";
  setActiveTab: (tab: "chat" | "calendar" | "docs") => void;

  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;

  activeDocumentId: string | null;
  setActiveDocumentId: (id: string | null) => void;

  onlineUserIds: string[];
  setOnlineUserIds: (ids: string[]) => void;

  typingUsersByConv: Record<string, { userId: string; userName: string }[]>;
  setTypingUser: (
    conversationId: string,
    userId: string,
    userName: string,
    isTyping: boolean
  ) => void;

  notifications: ToastNotification[];
  addNotification: (n: Omit<ToastNotification, "id" | "createdAt">) => void;
  dismissNotification: (id: string) => void;
}

export const useSyncroStore = create<SyncroStore>((set) => ({
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),

  activeTab: "calendar",
  setActiveTab: (tab) => set({ activeTab: tab }),

  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),

  activeDocumentId: null,
  setActiveDocumentId: (id) => set({ activeDocumentId: id }),

  onlineUserIds: [],
  setOnlineUserIds: (ids) => set({ onlineUserIds: ids }),

  typingUsersByConv: {},
  setTypingUser: (conversationId, userId, userName, isTyping) =>
    set((state) => {
      const existing = state.typingUsersByConv[conversationId] || [];
      const filtered = existing.filter((u) => u.userId !== userId);
      return {
        typingUsersByConv: {
          ...state.typingUsersByConv,
          [conversationId]: isTyping
            ? [...filtered, { userId, userName }]
            : filtered,
        },
      };
    }),

  notifications: [],
  addNotification: (n) => {
    const id = Math.random().toString(36).slice(2);
    set((state) => ({
      notifications: [
        { ...n, id, createdAt: Date.now() },
        ...state.notifications.slice(0, 4),
      ],
    }));
    setTimeout(() => {
      set((state) => ({
        notifications: state.notifications.filter((item) => item.id !== id),
      }));
    }, 6500);
  },
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((item) => item.id !== id),
    })),
}));
