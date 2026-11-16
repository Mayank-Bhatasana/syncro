"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { API_URL, getAuthToken } from "../api/client";
import { useSyncroStore } from "../store/useSyncroStore";
import { MessageDTO, ConversationDTO } from "@syncro/shared";

const SocketContext = createContext<Socket | null>(null);

export function useSocket(): Socket | null {
  return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const queryClient = useQueryClient();

  const currentUser = useSyncroStore((s) => s.currentUser);
  const setOnlineUserIds = useSyncroStore((s) => s.setOnlineUserIds);
  const setTypingUser = useSyncroStore((s) => s.setTypingUser);
  const addNotification = useSyncroStore((s) => s.addNotification);

  useEffect(() => {
    if (!currentUser) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return;
    }

    const token = getAuthToken();
    const s = io(API_URL, {
      withCredentials: true,
      auth: { token },
    });

    s.on("connect", () => {
      // Connected to real-time gateway
    });

    s.on("presence:update", ({ onlineUserIds }: { onlineUserIds: string[] }) => {
      setOnlineUserIds(onlineUserIds);
    });

    s.on("conversation:created", (conv: ConversationDTO) => {
      s.emit("conversation:join", { conversationId: conv.id });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    });

    s.on("message:new", (msg: MessageDTO) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({
        queryKey: ["messages", msg.conversationId],
      });

      const activeConvId = useSyncroStore.getState().activeConversationId;
      const activeTab = useSyncroStore.getState().activeTab;
      if (
        msg.senderId !== currentUser.id &&
        (activeTab !== "chat" || activeConvId !== msg.conversationId)
      ) {
        addNotification({
          title: `New message from ${msg.senderName}`,
          message: msg.content,
          type: "info",
        });
      }
    });

    s.on(
      "typing",
      (payload: {
        conversationId: string;
        userId: string;
        userName: string;
        isTyping: boolean;
      }) => {
        setTypingUser(
          payload.conversationId,
          payload.userId,
          payload.userName,
          payload.isTyping
        );
      }
    );

    s.on(
      "event:invited",
      (payload: { event: any; hasConflict: boolean }) => {
        queryClient.invalidateQueries({ queryKey: ["calendar"] });
        if (payload.event.organizerId !== currentUser.id) {
          addNotification({
            title: payload.hasConflict
              ? "⚠️ Meeting Invite (Schedule Conflict!)"
              : "📅 New Meeting Invite",
            message: `${payload.event.organizerName} invited you to "${payload.event.title}"`,
            type: payload.hasConflict ? "warning" : "info",
          });
        }
      }
    );

    s.on(
      "event:updated",
      (payload: { eventTitle: string; organizerName: string }) => {
        queryClient.invalidateQueries({ queryKey: ["calendar"] });
        queryClient.invalidateQueries({ queryKey: ["availability"] });
        addNotification({
          title: "🗓️ Meeting moved",
          message: `${payload.organizerName} moved "${payload.eventTitle}"`,
          type: "info",
        });
      }
    );

    s.on(
      "event:excuse_requested",
      (payload: {
        eventId: string;
        eventTitle: string;
        attendeeName: string;
        reason: string;
      }) => {
        queryClient.invalidateQueries({ queryKey: ["calendar"] });
        addNotification({
          title: `🙋 Conflict Excuse Request: ${payload.attendeeName}`,
          message: `For "${payload.eventTitle}": "${payload.reason}"`,
          type: "warning",
        });
      }
    );

    s.on(
      "event:excuse_decided",
      (payload: {
        eventTitle: string;
        organizerName: string;
        decision: "ALLOW" | "DENY";
        replyMessage: string;
      }) => {
        queryClient.invalidateQueries({ queryKey: ["calendar"] });
        addNotification({
          title:
            payload.decision === "ALLOW"
              ? `✅ Excuse Approved by ${payload.organizerName}`
              : `❌ Excuse Denied by ${payload.organizerName}`,
          message: `"${payload.eventTitle}": ${payload.replyMessage}`,
          type: payload.decision === "ALLOW" ? "success" : "warning",
        });
      }
    );

    s.on(
      "leave:requested",
      (payload: { userName: string; startDate: string; endDate: string }) => {
        queryClient.invalidateQueries({ queryKey: ["leave-approvals"] });
        addNotification({
          title: `🌴 Leave request from ${payload.userName}`,
          message: `${payload.startDate} to ${payload.endDate}. Waiting for your decision.`,
          type: "info",
        });
      }
    );

    s.on(
      "leave:decided",
      (payload: {
        status: "APPROVED" | "REJECTED";
        decidedByName: string;
        startDate: string;
        endDate: string;
        decisionNote: string | null;
      }) => {
        queryClient.invalidateQueries({ queryKey: ["leave"] });
        queryClient.invalidateQueries({ queryKey: ["calendar"] });
        addNotification({
          title:
            payload.status === "APPROVED"
              ? `✅ Leave approved by ${payload.decidedByName}`
              : `❌ Leave declined by ${payload.decidedByName}`,
          message: payload.decisionNote || `${payload.startDate} to ${payload.endDate}`,
          type: payload.status === "APPROVED" ? "success" : "warning",
        });
      }
    );

    s.on("doc:shared", (payload: { document: any; accessLevel: string }) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      addNotification({
        title: "📄 Document Shared With You",
        message: `"${payload.document.title}" shared as ${payload.accessLevel}`,
        type: "info",
      });
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [currentUser?.id]);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}
