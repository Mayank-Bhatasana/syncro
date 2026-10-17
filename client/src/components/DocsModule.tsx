"use client";

import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Y from "yjs";
import { api } from "../api/client";
import { useSyncroStore } from "../store/useSyncroStore";
import { useSocket } from "../socket/SocketProvider";
import { DocAccessLevel } from "@syncro/shared";
import {
  FileText,
  Plus,
  Share2,
  Lock,
  Edit3,
  Bold,
  Italic,
  Heading,
  List,
  Users,
} from "lucide-react";

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function DocsModule() {
  const socket = useSocket();
  const queryClient = useQueryClient();
  const currentUser = useSyncroStore((s) => s.currentUser)!;
  const activeDocumentId = useSyncroStore((s) => s.activeDocumentId);
  const setActiveDocumentId = useSyncroStore((s) => s.setActiveDocumentId);
  const addNotification = useSyncroStore((s) => s.addNotification);

  const [newDocTitle, setNewDocTitle] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUserId, setShareUserId] = useState("");
  const [shareAccess, setShareAccess] = useState<DocAccessLevel>("EDITOR");

  // Live document state
  const ydocRef = useRef<Y.Doc | null>(null);
  const [content, setContent] = useState("");
  const [accessRole, setAccessRole] = useState<"OWNER" | DocAccessLevel>("VIEWER");
  const [collaborators, setCollaborators] = useState<
    { id: string; name: string; role: string }[]
  >([]);
  const [lastSavedBy, setLastSavedBy] = useState<string | null>(null);

  const { data: docsData } = useQuery({
    queryKey: ["documents"],
    queryFn: api.getDocuments,
  });

  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: api.getUsers,
  });

  const documents = docsData?.documents || [];
  const allUsers = (usersData?.users || []).filter(
    (u) => u.id !== currentUser.id
  );

  useEffect(() => {
    if (!activeDocumentId && documents.length > 0) {
      setActiveDocumentId(documents[0].id);
    }
  }, [documents, activeDocumentId, setActiveDocumentId]);

  const activeDoc = documents.find((d) => d.id === activeDocumentId);

  // Join the live editing session when activeDocumentId changes
  useEffect(() => {
    if (!socket || !activeDocumentId) return;

    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const ytext = ydoc.getText("content");

    const updateTextFromYDoc = () => {
      setContent(ytext.toString());
    };
    ytext.observe(updateTextFromYDoc);

    socket.emit(
      "doc:join",
      { documentId: activeDocumentId },
      (res: {
        ok?: boolean;
        error?: string;
        accessRole?: "OWNER" | DocAccessLevel;
        stateBase64?: string;
      }) => {
        if (res?.error) {
          addNotification({
            title: "Document Access Denied",
            message: res.error,
            type: "warning",
          });
          return;
        }
        if (res.accessRole) {
          setAccessRole(res.accessRole);
        }
        if (res.stateBase64) {
          Y.applyUpdate(ydoc, base64ToUint8(res.stateBase64), "remote");
          setContent(ytext.toString());
        }
      }
    );

    const handleRemoteUpdate = (payload: {
      documentId: string;
      updateBase64: string;
      editorName: string;
    }) => {
      if (payload.documentId !== activeDocumentId) return;
      Y.applyUpdate(ydoc, base64ToUint8(payload.updateBase64), "remote");
      setLastSavedBy(`Synced live edit from ${payload.editorName}`);
    };

    const handleCollaborators = (payload: {
      documentId: string;
      collaborators: { id: string; name: string; role: string }[];
    }) => {
      if (payload.documentId === activeDocumentId) {
        setCollaborators(payload.collaborators);
      }
    };

    socket.on("doc:update", handleRemoteUpdate);
    socket.on("doc:collaborators", handleCollaborators);

    return () => {
      socket.emit("doc:leave", { documentId: activeDocumentId });
      socket.off("doc:update", handleRemoteUpdate);
      socket.off("doc:collaborators", handleCollaborators);
      ytext.unobserve(updateTextFromYDoc);
      ydoc.destroy();
    };
  }, [socket, activeDocumentId]);

  const applyLocalTextChange = (nextValue: string) => {
    const ydoc = ydocRef.current;
    if (!ydoc || !socket || !activeDocumentId) return;

    if (accessRole === "VIEWER") {
      addNotification({
        title: "Read-Only Mode",
        message: "Viewers cannot edit this document.",
        type: "warning",
      });
      return;
    }

    let updateBytes: Uint8Array | null = null;
    const onUpdate = (update: Uint8Array, origin: any) => {
      if (origin === "local") {
        updateBytes = update;
      }
    };

    ydoc.on("update", onUpdate);
    ydoc.transact(() => {
      const ytext = ydoc.getText("content");
      ytext.delete(0, ytext.length);
      ytext.insert(0, nextValue);
    }, "local");
    ydoc.off("update", onUpdate);

    setContent(nextValue);

    if (updateBytes) {
      socket.emit(
        "doc:update",
        {
          documentId: activeDocumentId,
          updateBase64: uint8ToBase64(updateBytes),
        },
        (ack: { ok?: boolean; error?: string }) => {
          if (ack?.error) {
            addNotification({
              title: "Edit not saved",
              message: ack.error,
              type: "warning",
            });
          } else {
            setLastSavedBy("All changes saved");
          }
        }
      );
    }
  };

  const insertFormatting = (prefix: string, suffix = "") => {
    if (accessRole === "VIEWER") return;
    applyLocalTextChange(`${content}\n${prefix}Text${suffix}`);
  };

  const createDocMutation = useMutation({
    mutationFn: api.createDocument,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setActiveDocumentId(res.document.id);
      setShowCreateModal(false);
      setNewDocTitle("");
    },
  });

  const shareDocMutation = useMutation({
    mutationFn: ({
      docId,
      userId,
      accessLevel,
    }: {
      docId: string;
      userId: string;
      accessLevel: DocAccessLevel;
    }) => api.shareDocument(docId, { userId, accessLevel }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setShowShareModal(false);
      addNotification({
        title: "Document Permissions Updated",
        message: "Shared user notified in real time.",
        type: "success",
      });
    },
    onError: (err: any) => {
      addNotification({
        title: "Permission Error",
        message: err.message,
        type: "warning",
      });
    },
  });

  const isEditable = accessRole === "OWNER" || accessRole === "EDITOR";

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left Sidebar: Documents */}
      <div className="w-80 border-r-[3px] border-ink flex flex-col bg-white">
        <div className="sidebar-band bg-mint">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-white border-2 border-ink shadow-pop-sm flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="font-extrabold text-lg leading-tight">Shared Docs</h2>
              <p className="text-[11px] font-semibold text-ink/70">
                Edit together in real time
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn btn-sm bg-white shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New Doc
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {documents.map((doc) => {
            const isSelected = doc.id === activeDocumentId;
            return (
              <button
                key={doc.id}
                onClick={() => setActiveDocumentId(doc.id)}
                className={`select-card flex items-start gap-3 ${
                  isSelected ? "select-card-active bg-mint/30" : ""
                }`}
              >
                <span className="w-9 h-9 rounded-xl bg-white border-2 border-ink flex items-center justify-center shrink-0 shadow-pop-sm">
                  <FileText className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-sm truncate">
                      {doc.title}
                    </span>
                    <span
                      className={`chip shrink-0 ${
                        doc.myAccess === "OWNER"
                          ? "bg-grape"
                          : doc.myAccess === "EDITOR"
                          ? "bg-mint"
                          : "bg-sun"
                      }`}
                    >
                      {doc.myAccess}
                    </span>
                  </div>
                  <p className="text-xs text-ink/60 font-medium mt-1 truncate">
                    Owner: {doc.ownerName}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Collaborative Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeDoc ? (
          <>
            <div className="p-5 border-b-[3px] border-ink bg-white flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-2xl font-extrabold truncate">
                    {activeDoc.title}
                  </h2>
                  {isEditable ? (
                    <span className="chip bg-mint py-1">
                      <Edit3 className="w-3 h-3" /> {accessRole} (Live editing)
                    </span>
                  ) : (
                    <span className="chip bg-sun py-1">
                      <Lock className="w-3 h-3" /> VIEWER (Read-Only)
                    </span>
                  )}
                </div>
                <p className="text-xs font-medium text-ink/60 mt-1.5">
                  Owner: {activeDoc.ownerName}{" "}
                  {lastSavedBy ? `• ${lastSavedBy}` : ""}
                </p>
              </div>

              <div className="flex items-center gap-2.5 flex-wrap">
                {/* Active Collaborators */}
                <div className="flex items-center gap-2 text-xs font-bold bg-paper border-2 border-ink px-3 py-1.5 rounded-xl">
                  <Users className="w-3.5 h-3.5" />
                  <span>
                    In Doc:{" "}
                    {collaborators.map((c) => c.name.split(" ")[0]).join(", ") ||
                      "You"}
                  </span>
                </div>

                {/* Only Owner can change sharing */}
                {activeDoc.ownerId === currentUser.id && (
                  <button
                    onClick={() => {
                      setShareUserId(allUsers[0]?.id || "");
                      setShowShareModal(true);
                    }}
                    className="btn bg-mint px-3.5 py-2"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    Share Document
                  </button>
                )}
              </div>
            </div>

            {/* Formatting Toolbar */}
            <div className="px-4 py-3 border-b-[3px] border-ink bg-paper flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  disabled={!isEditable}
                  onClick={() => insertFormatting("## ")}
                  className="btn btn-icon bg-white"
                  title="Heading"
                >
                  <Heading className="w-4 h-4" />
                </button>
                <button
                  disabled={!isEditable}
                  onClick={() => insertFormatting("**", "**")}
                  className="btn btn-icon bg-white"
                  title="Bold"
                >
                  <Bold className="w-4 h-4" />
                </button>
                <button
                  disabled={!isEditable}
                  onClick={() => insertFormatting("_", "_")}
                  className="btn btn-icon bg-white"
                  title="Italic"
                >
                  <Italic className="w-4 h-4" />
                </button>
                <button
                  disabled={!isEditable}
                  onClick={() => insertFormatting("- ")}
                  className="btn btn-icon bg-white"
                  title="Bullet List"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap text-xs font-bold text-ink/70">
                <span>Shared with:</span>
                {activeDoc.permissions.length === 0 ? (
                  <span className="chip bg-white text-ink/50">Private</span>
                ) : (
                  activeDoc.permissions.map((p) => (
                    <span key={p.userId} className="chip bg-white">
                      {p.userName.split(" ")[0]} ({p.accessLevel})
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* Collaborative Editor Area */}
            <div className="flex-1 p-6 overflow-y-auto">
              <div className="max-w-4xl mx-auto h-full flex flex-col">
                <textarea
                  readOnly={!isEditable}
                  value={content}
                  onChange={(e) => applyLocalTextChange(e.target.value)}
                  className={`w-full flex-1 min-h-[420px] border-[3px] rounded-3xl p-6 font-mono text-sm leading-relaxed outline-none transition-all duration-150 ${
                    isEditable
                      ? "bg-white border-ink shadow-pop focus:shadow-pop-lg focus:-translate-x-0.5 focus:-translate-y-0.5"
                      : "bg-sun/20 border-ink/40 text-ink/70 cursor-not-allowed"
                  }`}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="min-h-[60vh] flex items-center justify-center font-display font-bold text-lg text-ink/50 text-center p-6">
            Select a document or create a new one
          </div>
        )}
      </div>

      {/* Create Document Modal */}
      {showCreateModal && (
        <div className="modal-backdrop">
          <div className="modal max-w-md">
            <h3 className="text-2xl font-extrabold">
              Create Collaborative Document
            </h3>
            <input
              type="text"
              value={newDocTitle}
              onChange={(e) => setNewDocTitle(e.target.value)}
              placeholder="Document Title..."
              className="field"
            />
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setShowCreateModal(false)}
                className="btn bg-white"
              >
                Cancel
              </button>
              <button
                disabled={!newDocTitle.trim() || createDocMutation.isPending}
                onClick={() =>
                  createDocMutation.mutate({ title: newDocTitle.trim() })
                }
                className="btn bg-mint"
              >
                Create Document
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Document Modal (Owner Only) */}
      {showShareModal && activeDoc && (
        <div className="modal-backdrop">
          <div className="modal max-w-md">
            <h3 className="text-2xl font-extrabold">
              Share &ldquo;{activeDoc.title}&rdquo;
            </h3>
            <div>
              <label className="label">Select User</label>
              <select
                value={shareUserId}
                onChange={(e) => setShareUserId(e.target.value)}
                className="field cursor-pointer"
              >
                {allUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.departmentName} • {u.role})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Access Level</label>
              <div className="grid grid-cols-2 gap-2.5">
                {(["EDITOR", "VIEWER"] as DocAccessLevel[]).map((lvl) => {
                  const selected = shareAccess === lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setShareAccess(lvl)}
                      className={`p-3 rounded-2xl border-[3px] text-left transition-all duration-150 ${
                        selected
                          ? "bg-mint border-ink shadow-pop-sm -translate-x-px -translate-y-px"
                          : "bg-white border-ink/20 hover:border-ink"
                      }`}
                    >
                      <div className="font-display font-extrabold text-sm">
                        {lvl}
                      </div>
                      <div className="text-[11px] font-medium text-ink/70 mt-0.5">
                        {lvl === "EDITOR"
                          ? "Edit together in real time"
                          : "View only, no edits"}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setShowShareModal(false)}
                className="btn bg-white"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  shareDocMutation.mutate({
                    docId: activeDoc.id,
                    userId: shareUserId,
                    accessLevel: shareAccess,
                  })
                }
                className="btn bg-mint"
              >
                Save Access
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
