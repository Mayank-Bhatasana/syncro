"use client";

import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useSyncroStore } from "../store/useSyncroStore";
import { useSocket } from "../socket/SocketProvider";
import { Avatar } from "./ui";
import {
  MessageSquare,
  Plus,
  Send,
  Users,
  ImagePlus,
  Film,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export function ChatModule() {
  const socket = useSocket();
  const queryClient = useQueryClient();
  const currentUser = useSyncroStore((s) => s.currentUser)!;
  const activeConversationId = useSyncroStore((s) => s.activeConversationId);
  const setActiveConversationId = useSyncroStore(
    (s) => s.setActiveConversationId
  );
  const onlineUserIds = useSyncroStore((s) => s.onlineUserIds);
  const typingUsersByConv = useSyncroStore((s) => s.typingUsersByConv);
  const addNotification = useSyncroStore((s) => s.addNotification);

  const [messageText, setMessageText] = useState("");
  const [mediaAttachment, setMediaAttachment] = useState<{
    url: string;
    type: "image" | "video";
    name: string;
  } | null>(null);
  const [showAllMembers, setShowAllMembers] = useState(false);

  const [showNewModal, setShowNewModal] = useState(false);
  const [newChatName, setNewChatName] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: convData } = useQuery({
    queryKey: ["conversations"],
    queryFn: api.getConversations,
  });

  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: api.getUsers,
  });

  const conversations = convData?.conversations || [];
  const allUsers = (usersData?.users || []).filter(
    (u) => u.id !== currentUser.id
  );

  // Auto-select first conversation if none selected
  useEffect(() => {
    if (!activeConversationId && conversations.length > 0) {
      setActiveConversationId(conversations[0].id);
    }
  }, [conversations, activeConversationId, setActiveConversationId]);

  // Reset "Show more" when switching conversations
  useEffect(() => {
    setShowAllMembers(false);
  }, [activeConversationId]);

  const { data: msgData } = useQuery({
    queryKey: ["messages", activeConversationId],
    queryFn: () => api.getMessages(activeConversationId!),
    enabled: Boolean(activeConversationId),
  });

  // Refresh unread count when opening a conversation
  useEffect(() => {
    if (activeConversationId) {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  }, [activeConversationId, msgData, queryClient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgData?.messages]);

  const createConvMutation = useMutation({
    mutationFn: api.createConversation,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setActiveConversationId(res.conversation.id);
      socket?.emit("conversation:join", {
        conversationId: res.conversation.id,
      });
      setShowNewModal(false);
      setNewChatName("");
      setSelectedUserIds([]);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");

    if (!isImage && !isVideo) {
      addNotification({
        title: "Unsupported File",
        message: "Please select an image or video file.",
        type: "warning",
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      addNotification({
        title: "File Too Large",
        message: "Please select a photo or video under 10 MB.",
        type: "warning",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setMediaAttachment({
        url: String(reader.result),
        type: isVideo ? "video" : "image",
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      (!messageText.trim() && !mediaAttachment) ||
      !activeConversationId ||
      !socket
    ) {
      return;
    }

    const content = messageText.trim();
    const attachment = mediaAttachment;

    setMessageText("");
    setMediaAttachment(null);

    socket.emit("typing", {
      conversationId: activeConversationId,
      isTyping: false,
    });

    socket.emit(
      "message:send",
      {
        conversationId: activeConversationId,
        content,
        mediaUrl: attachment?.url || null,
        mediaType: attachment?.type || null,
      },
      (ack: { error?: string }) => {
        if (ack?.error) {
          addNotification({
            title: "Failed to Send",
            message: ack.error,
            type: "warning",
          });
        }
        queryClient.invalidateQueries({
          queryKey: ["messages", activeConversationId],
        });
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
      }
    );
  };

  const handleTyping = (val: string) => {
    setMessageText(val);
    if (!socket || !activeConversationId) return;
    socket.emit("typing", {
      conversationId: activeConversationId,
      isTyping: val.trim().length > 0,
    });
  };

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const messages = msgData?.messages || [];
  const typingUsers =
    (activeConversationId ? typingUsersByConv[activeConversationId] : []) || [];

  // Only show online status for members of the currently selected conversation/group
  // Sort so ONLINE employees appear FIRST in the list, followed by offline members alphabetically
  const activeGroupMembers = [...(activeConv?.members || [])].sort((a, b) => {
    const aOnline = onlineUserIds.includes(a.id) ? 1 : 0;
    const bOnline = onlineUserIds.includes(b.id) ? 1 : 0;
    if (bOnline !== aOnline) return bOnline - aOnline;
    return a.name.localeCompare(b.name);
  });
  const activeGroupOnlineMembers = activeGroupMembers.filter((m) =>
    onlineUserIds.includes(m.id)
  );

  // One-line limit (first 3 members shown inline, then "+X more / Show more")
  const INLINE_MEMBER_LIMIT = 3;
  const hasMoreMembers = activeGroupMembers.length > INLINE_MEMBER_LIMIT;
  const visibleMembers = showAllMembers
    ? activeGroupMembers
    : activeGroupMembers.slice(0, INLINE_MEMBER_LIMIT);

  const getConversationTitle = (conv: (typeof conversations)[0]) => {
    if (conv.isGroup && conv.name) return conv.name;
    const other = conv.members.find((m) => m.id !== currentUser.id);
    return other ? `${other.name} (${other.departmentName})` : "Direct Message";
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left Sidebar: Conversations */}
      <div className="w-80 border-r-[3px] border-ink flex flex-col bg-white">
        <div className="sidebar-band bg-bubble">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-white border-2 border-ink shadow-pop-sm flex items-center justify-center">
              <MessageSquare className="w-4 h-4" />
            </span>
            <h2 className="font-extrabold text-lg">Conversations</h2>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            className="btn btn-sm bg-white"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {conversations.map((conv) => {
            const isSelected = conv.id === activeConversationId;
            const otherMember = !conv.isGroup
              ? conv.members.find((m) => m.id !== currentUser.id)
              : null;
            const isOnline =
              otherMember && onlineUserIds.includes(otherMember.id);

            const lastMsgPreview = conv.lastMessage
              ? `${conv.lastMessage.senderName.split(" ")[0]}: ${
                  conv.lastMessage.content ||
                  (conv.lastMessage.mediaType === "video"
                    ? "🎬 Sent a video"
                    : "📷 Sent a photo")
                }`
              : "No messages yet";

            return (
              <button
                key={conv.id}
                onClick={() => setActiveConversationId(conv.id)}
                className={`select-card flex items-center gap-3 ${
                  isSelected ? "select-card-active bg-bubble/30" : ""
                }`}
              >
                {conv.isGroup ? (
                  <span className="w-10 h-10 shrink-0 rounded-xl bg-grape border-2 border-ink shadow-pop-sm flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </span>
                ) : (
                  <Avatar name={otherMember?.name ?? getConversationTitle(conv)} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm truncate">
                      {getConversationTitle(conv)}
                    </span>
                    {!conv.isGroup && (
                      <span
                        className={`w-2.5 h-2.5 rounded-full border border-ink shrink-0 ${
                          isOnline ? "bg-mint" : "bg-white"
                        }`}
                      />
                    )}
                  </div>
                  <p className="text-xs text-ink/60 font-medium truncate mt-0.5">
                    {lastMsgPreview}
                  </p>
                </div>
                {conv.unreadCount > 0 && (
                  <span className="shrink-0 bg-tangerine border-2 border-ink text-[11px] font-extrabold px-2 py-0.5 rounded-full shadow-pop-sm">
                    {conv.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Scoped Online Footer: ONLY shows online users from the currently selected group */}
        <div className="p-3.5 border-t-[3px] border-ink bg-paper">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-xs font-extrabold truncate">
              Online in This Chat ({activeGroupOnlineMembers.length}/
              {activeGroupMembers.length})
            </p>
          </div>
          {activeConv ? (
            <div className="flex flex-wrap gap-1.5">
              {activeGroupMembers.map((u) => {
                const online = onlineUserIds.includes(u.id);
                return (
                  <span
                    key={u.id}
                    className={`chip ${
                      online ? "bg-mint" : "bg-white text-ink/50"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full bg-ink ${
                        online ? "animate-pulse" : "opacity-30"
                      }`}
                    />
                    {u.name.split(" ")[0]} ({u.departmentName})
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-xs font-medium text-ink/60">
              Select a conversation to view online members
            </p>
          )}
        </div>
      </div>

      {/* Main Message Feed */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeConv ? (
          <>
            {/* Conversation Header with 1-Line Limit + "Show More / Show Less" */}
            <div className="p-4 border-b-[3px] border-ink bg-white">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display font-extrabold text-xl truncate">
                  {getConversationTitle(activeConv)}
                </h3>
                <span className="chip bg-mint shrink-0">
                  {activeGroupOnlineMembers.length} of{" "}
                  {activeGroupMembers.length} online now
                </span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-[11px] font-bold uppercase tracking-wide text-ink/50 mr-1">
                  Members ({activeGroupMembers.length}):
                </span>
                {visibleMembers.map((m) => {
                  const isOnline = onlineUserIds.includes(m.id);
                  return (
                    <span key={m.id} className="chip bg-paper">
                      <span
                        className={`w-2 h-2 rounded-full border border-ink ${
                          isOnline ? "bg-mint" : "bg-white"
                        }`}
                      />
                      {m.name} ({m.departmentName})
                    </span>
                  );
                })}

                {hasMoreMembers && (
                  <button
                    type="button"
                    onClick={() => setShowAllMembers((prev) => !prev)}
                    className="chip bg-sun hover:-translate-y-px hover:shadow-pop-sm transition"
                  >
                    {showAllMembers ? (
                      <>
                        Show less <ChevronUp className="w-3 h-3" />
                      </>
                    ) : (
                      <>
                        +{activeGroupMembers.length - INLINE_MEMBER_LIMIT}{" "}
                        more (Show more) <ChevronDown className="w-3 h-3" />
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {messages.map((msg) => {
                const isMine = msg.senderId === currentUser.id;
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-2.5 ${isMine ? "flex-row-reverse" : ""}`}
                  >
                    <Avatar name={msg.senderName} size="sm" />
                    <div
                      className={`flex flex-col min-w-0 max-w-[75%] ${
                        isMine ? "items-end" : "items-start"
                      }`}
                    >
                      <div
                        className={`flex items-center gap-2 mb-1 px-1 ${
                          isMine ? "flex-row-reverse" : ""
                        }`}
                      >
                        <span className="text-xs font-extrabold">
                          {msg.senderName}
                        </span>
                        <span className="chip bg-white text-[10px] py-0">
                          {msg.senderRole}
                        </span>
                        <span className="text-[10px] font-semibold text-ink/50">
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div
                        className={`max-w-lg px-4 py-2.5 rounded-3xl text-sm font-medium space-y-2 border-[3px] border-ink shadow-pop-sm ${
                          isMine
                            ? "bg-bubble rounded-br-md"
                            : "bg-white rounded-bl-md"
                        }`}
                      >
                        {msg.mediaUrl && msg.mediaType === "image" && (
                          <img
                            src={msg.mediaUrl}
                            alt="Chat attachment"
                            className="rounded-2xl max-h-72 w-auto object-cover border-2 border-ink"
                          />
                        )}
                        {msg.mediaUrl && msg.mediaType === "video" && (
                          <video
                            src={msg.mediaUrl}
                            controls
                            className="rounded-2xl max-h-72 w-full border-2 border-ink"
                          />
                        )}
                        {msg.content && <p>{msg.content}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Animated Typing Bubble in Feed */}
              {typingUsers.length > 0 && (
                <div className="flex items-center gap-2.5 animate-fade-in">
                  <div className="bg-white border-[3px] border-ink shadow-pop-sm px-4 py-2.5 rounded-3xl rounded-bl-md flex items-center gap-2.5">
                    <div className="flex items-center gap-1">
                      <span
                        className="w-2 h-2 rounded-full bg-ink animate-bounce"
                        style={{ animationDelay: "0ms" }}
                      />
                      <span
                        className="w-2 h-2 rounded-full bg-bubble border border-ink animate-bounce"
                        style={{ animationDelay: "150ms" }}
                      />
                      <span
                        className="w-2 h-2 rounded-full bg-ink animate-bounce"
                        style={{ animationDelay: "300ms" }}
                      />
                    </div>
                    <span className="text-xs font-bold">
                      {typingUsers.map((u) => u.userName).join(", ")}{" "}
                      {typingUsers.length === 1 ? "is" : "are"} typing...
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Selected Photo / Video Attachment Preview Bar */}
            {mediaAttachment && (
              <div className="px-4 py-3 border-t-[3px] border-ink bg-sun flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {mediaAttachment.type === "image" ? (
                    <img
                      src={mediaAttachment.url}
                      alt="Preview"
                      className="w-12 h-12 rounded-xl object-cover border-2 border-ink shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-azure border-2 border-ink flex items-center justify-center shrink-0">
                      <Film className="w-5 h-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold truncate">
                      Attached {mediaAttachment.type}: {mediaAttachment.name}
                    </p>
                    <p className="text-[11px] font-medium text-ink/70">
                      Ready to send
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMediaAttachment(null)}
                  className="btn btn-icon bg-white p-1.5 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Message Input + Photo/Video Upload Trigger */}
            <form
              onSubmit={handleSend}
              className="p-4 border-t-[3px] border-ink bg-white flex items-center gap-2.5"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn bg-sun px-3.5 py-2.5 shrink-0"
                title="Attach Photo or Video"
              >
                <ImagePlus className="w-4 h-4" />
                <span className="hidden sm:inline">Photo / Video</span>
              </button>

              <input
                type="text"
                value={messageText}
                onChange={(e) => handleTyping(e.target.value)}
                placeholder="Write a message or attach a photo/video..."
                className="field flex-1 min-w-0"
              />
              <button type="submit" className="btn bg-bubble px-5 py-2.5">
                <Send className="w-4 h-4" />
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center font-display font-bold text-lg text-ink/50 p-6 text-center">
            Select a conversation or start a new one
          </div>
        )}
      </div>

      {/* New Conversation Modal */}
      {showNewModal && (
        <div className="modal-backdrop">
          <div className="modal max-w-md">
            <h3 className="text-2xl font-extrabold">Start a Conversation</h3>

            {selectedUserIds.length > 1 && (
              <div>
                <label className="label">Group Name</label>
                <input
                  type="text"
                  value={newChatName}
                  onChange={(e) => setNewChatName(e.target.value)}
                  placeholder="e.g., Security Incident Room"
                  className="field"
                />
              </div>
            )}

            <div>
              <label className="label">
                Select Colleagues ({selectedUserIds.length} selected)
              </label>
              <div className="max-h-60 overflow-y-auto space-y-2 border-[3px] border-ink rounded-2xl p-2 bg-paper">
                {allUsers.map((u) => {
                  const checked = selectedUserIds.includes(u.id);
                  return (
                    <label
                      key={u.id}
                      className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border-2 cursor-pointer transition ${
                        checked
                          ? "bg-bubble/30 border-ink"
                          : "bg-white border-transparent hover:border-ink/30"
                      }`}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <Avatar name={u.name} size="sm" />
                        <span className="min-w-0">
                          <span className="block text-sm font-extrabold truncate">
                            {u.name}
                          </span>
                          <span className="block text-xs font-medium text-ink/60">
                            {u.departmentName} • {u.role}
                          </span>
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedUserIds((prev) =>
                            checked
                              ? prev.filter((id) => id !== u.id)
                              : [...prev, u.id]
                          )
                        }
                        className="w-4 h-4 accent-bubble cursor-pointer"
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setShowNewModal(false)}
                className="btn bg-white"
              >
                Cancel
              </button>
              <button
                disabled={
                  selectedUserIds.length === 0 || createConvMutation.isPending
                }
                onClick={() =>
                  createConvMutation.mutate({
                    name:
                      selectedUserIds.length > 1
                        ? newChatName || "Team Group"
                        : undefined,
                    isGroup: selectedUserIds.length > 1,
                    memberIds: selectedUserIds,
                  })
                }
                className="btn bg-bubble"
              >
                Create Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
