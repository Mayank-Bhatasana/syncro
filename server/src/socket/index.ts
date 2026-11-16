import { Server as HttpServer } from "http";
import { Server as SocketServer, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import cookie from "cookie";
import * as Y from "yjs";
import { env } from "../config/env";
import { prisma } from "../config/db";
import {
  redisPub,
  redisSub,
  markUserOnline,
  markUserOffline,
  getOnlineUsers,
} from "../config/redis";
import {
  COOKIE_NAME,
  verifyToken,
  AuthUser,
} from "../middleware/auth";
import {
  SendMessageSchema,
  TypingEventSchema,
  Role,
  DocAccessLevel,
} from "@syncro/shared";
import { canEditDocument, canReadDocument } from "../modules/permissions";

let ioInstance: SocketServer | null = null;

// In-memory active Yjs documents cache + debounce persistence timers
const activeYDocs = new Map<string, Y.Doc>();
const saveTimers = new Map<string, NodeJS.Timeout>();

async function getOrCreateYDoc(documentId: string): Promise<Y.Doc> {
  const existing = activeYDocs.get(documentId);
  if (existing) return existing;

  const ydoc = new Y.Doc();
  const dbDoc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { yjsState: true },
  });

  if (dbDoc?.yjsState && dbDoc.yjsState.length > 0) {
    Y.applyUpdate(ydoc, new Uint8Array(dbDoc.yjsState));
  }

  activeYDocs.set(documentId, ydoc);
  return ydoc;
}

function scheduleYDocPersist(documentId: string, ydoc: Y.Doc) {
  const existingTimer = saveTimers.get(documentId);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(async () => {
    try {
      const mergedState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
      await prisma.document.update({
        where: { id: documentId },
        data: { yjsState: mergedState },
      });
    } catch (err) {
      console.error(`Failed to persist Yjs doc ${documentId}:`, err);
    } finally {
      saveTimers.delete(documentId);
    }
  }, 1500);

  saveTimers.set(documentId, timer);
}

export function getIO(): SocketServer {
  if (!ioInstance) {
    throw new Error("Socket.IO has not been initialized yet");
  }
  return ioInstance;
}

export function initSocketServer(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    maxHttpBufferSize: 15 * 1024 * 1024, // 15 MB for photo & video attachments
    cors: {
      origin: env.CLIENT_URL,
      credentials: true,
    },
  });

  // Connect Redis Pub/Sub adapter so multiple server instances fan-out seamlessly
  io.adapter(createAdapter(redisPub, redisSub));

  // Authenticate every WebSocket connection using JWT cookie or auth handshake token
  io.use(async (socket, next) => {
    try {
      const rawCookie = socket.handshake.headers.cookie || "";
      const parsedCookies = cookie.parse(rawCookie);
      const token =
        parsedCookies[COOKIE_NAME] ||
        socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = verifyToken(token);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { department: true },
      });

      if (!user) {
        return next(new Error("User not found"));
      }

      const authUser: AuthUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as Role,
        departmentId: user.departmentId,
        departmentName: user.department.name,
      };

      socket.data.user = authUser;
      next();
    } catch {
      next(new Error("Invalid authentication token"));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const user = socket.data.user as AuthUser;

    // 1. Join personal notification room (`user:{id}`)
    socket.join(`user:${user.id}`);

    // 2. Join all conversation rooms this user is a member of
    const memberships = await prisma.conversationMember.findMany({
      where: { userId: user.id },
      select: { conversationId: true },
    });
    for (const m of memberships) {
      socket.join(`conversation:${m.conversationId}`);
    }

    // 3. Mark user online in Redis and broadcast updated presence
    const onlineUserIds = await markUserOnline(user.id);
    io.emit("presence:update", { onlineUserIds });

    // Allow client to explicitly join a newly created conversation room
    socket.on("conversation:join", async ({ conversationId }: { conversationId: string }) => {
      if (!conversationId) return;
      const member = await prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId,
            userId: user.id,
          },
        },
      });
      if (member) {
        socket.join(`conversation:${conversationId}`);
      }
    });

    // --- Flow: Sending a message ---
    socket.on("message:send", async (payload, callback) => {
      try {
        const parsed = SendMessageSchema.parse(payload);

        // Verify sender is a member of the conversation
        const membership = await prisma.conversationMember.findUnique({
          where: {
            conversationId_userId: {
              conversationId: parsed.conversationId,
              userId: user.id,
            },
          },
        });

        if (!membership) {
          callback?.({ error: "Forbidden: Not a member of this conversation" });
          return;
        }

        // Save message to Postgres and update sender's lastReadAt
        const [message] = await prisma.$transaction([
          prisma.message.create({
            data: {
              conversationId: parsed.conversationId,
              senderId: user.id,
              content: parsed.content,
              mediaUrl: parsed.mediaUrl || null,
              mediaType: parsed.mediaType || null,
            },
            include: {
              sender: true,
            },
          }),
          prisma.conversationMember.update({
            where: {
              conversationId_userId: {
                conversationId: parsed.conversationId,
                userId: user.id,
              },
            },
            data: { lastReadAt: new Date() },
          }),
        ]);

        const messageDTO = {
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          senderName: message.sender.name,
          senderRole: message.sender.role as Role,
          content: message.content,
          mediaUrl: message.mediaUrl,
          mediaType: message.mediaType as "image" | "video" | null,
          createdAt: message.createdAt.toISOString(),
        };

        // Emit message:new to everyone in that conversation's room
        io.to(`conversation:${parsed.conversationId}`).emit("message:new", messageDTO);
        callback?.({ ok: true, message: messageDTO });
      } catch (err: any) {
        callback?.({ error: err?.message || "Failed to send message" });
      }
    });

    // --- Typing Indicator ---
    socket.on("typing", async (payload) => {
      try {
        const parsed = TypingEventSchema.parse(payload);
        socket.to(`conversation:${parsed.conversationId}`).emit("typing", {
          conversationId: parsed.conversationId,
          userId: user.id,
          userName: user.name,
          isTyping: parsed.isTyping,
        });
      } catch {
        // Ignore malformed typing events
      }
    });

    // --- Flow: Collaborative Docs (Yjs + Permission Enforcement) ---
    socket.on(
      "doc:join",
      async ({ documentId }: { documentId: string }, callback) => {
        try {
          const doc = await prisma.document.findUnique({
            where: { id: documentId },
            include: {
              permissions: {
                where: { userId: user.id },
              },
            },
          });

          if (!doc) {
            callback?.({ error: "Document not found" });
            return;
          }

          const permLevel = doc.permissions[0]?.accessLevel as DocAccessLevel | undefined;

          if (!canReadDocument(user.id, doc.ownerId, permLevel)) {
            callback?.({ error: "Forbidden: You do not have access to this document" });
            return;
          }

          const accessRole: "OWNER" | DocAccessLevel =
            doc.ownerId === user.id ? "OWNER" : permLevel!;

          socket.join(`doc:${documentId}`);

          const ydoc = await getOrCreateYDoc(documentId);
          const stateBase64 = Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString("base64");

          // Broadcast active editors/viewers in this doc room
          const socketsInDoc = await io.in(`doc:${documentId}`).fetchSockets();
          const collaborators = socketsInDoc.map((s) => ({
            id: (s.data.user as AuthUser).id,
            name: (s.data.user as AuthUser).name,
            role: (s.data.user as AuthUser).role,
          }));
          io.to(`doc:${documentId}`).emit("doc:collaborators", {
            documentId,
            collaborators,
          });

          callback?.({
            ok: true,
            accessRole,
            stateBase64,
          });
        } catch (err: any) {
          callback?.({ error: err?.message || "Failed to join document" });
        }
      }
    );

    socket.on(
      "doc:update",
      async (
        {
          documentId,
          updateBase64,
        }: { documentId: string; updateBase64: string },
        callback
      ) => {
        try {
          const doc = await prisma.document.findUnique({
            where: { id: documentId },
            include: {
              permissions: {
                where: { userId: user.id },
              },
            },
          });

          if (!doc) {
            callback?.({ error: "Document not found" });
            return;
          }

          const permLevel = doc.permissions[0]?.accessLevel as DocAccessLevel | undefined;

          // Server strictly rejects any edit from a VIEWER or unauthorized user
          if (!canEditDocument(user.id, doc.ownerId, permLevel)) {
            socket.emit("doc:error", {
              documentId,
              error: "Forbidden: Viewers cannot edit this document",
            });
            callback?.({ error: "Forbidden: Viewers cannot edit this document" });
            return;
          }

          const ydoc = await getOrCreateYDoc(documentId);
          const updateBytes = new Uint8Array(Buffer.from(updateBase64, "base64"));

          // Merge Yjs CRDT update cleanly in memory
          Y.applyUpdate(ydoc, updateBytes);

          // Broadcast update to everyone else in the doc room
          socket.to(`doc:${documentId}`).emit("doc:update", {
            documentId,
            updateBase64,
            editorId: user.id,
            editorName: user.name,
          });

          // Persist to Postgres periodically (debounced)
          scheduleYDocPersist(documentId, ydoc);

          callback?.({ ok: true });
        } catch (err: any) {
          callback?.({ error: err?.message || "Failed to apply document update" });
        }
      }
    );

    // Live cursors: relay a collaborator's selection to the rest of the document room.
    // Positions are Yjs relative positions, so they stay correct while others type.
    // Only sockets already in the room (i.e. authorized in doc:join) can send them.
    socket.on(
      "doc:cursor",
      (payload: { documentId?: string; anchor?: unknown; head?: unknown }) => {
        const documentId = payload?.documentId;
        if (typeof documentId !== "string" || !socket.rooms.has(`doc:${documentId}`)) return;

        const size = JSON.stringify([payload.anchor, payload.head]).length;
        if (size > 2000) return;

        socket.to(`doc:${documentId}`).emit("doc:cursor", {
          documentId,
          userId: user.id,
          userName: user.name,
          anchor: payload.anchor ?? null,
          head: payload.head ?? null,
        });
      }
    );

    socket.on("doc:leave", async ({ documentId }: { documentId: string }) => {
      socket.leave(`doc:${documentId}`);
      const socketsInDoc = await io.in(`doc:${documentId}`).fetchSockets();
      const collaborators = socketsInDoc.map((s) => ({
        id: (s.data.user as AuthUser).id,
        name: (s.data.user as AuthUser).name,
        role: (s.data.user as AuthUser).role,
      }));
      io.to(`doc:${documentId}`).emit("doc:collaborators", {
        documentId,
        collaborators,
      });
    });

    // Drop this user from the collaborator list of any document they were viewing
    socket.on("disconnecting", async () => {
      for (const room of socket.rooms) {
        if (!room.startsWith("doc:")) continue;
        const documentId = room.slice("doc:".length);
        const remaining = (await io.in(room).fetchSockets()).filter((s) => s.id !== socket.id);
        io.to(room).emit("doc:collaborators", {
          documentId,
          collaborators: remaining.map((s) => ({
            id: (s.data.user as AuthUser).id,
            name: (s.data.user as AuthUser).name,
            role: (s.data.user as AuthUser).role,
          })),
        });
      }
    });

    socket.on("disconnect", async () => {
      // Check if user still has another tab open before removing from online set
      const remainingSockets = await io.in(`user:${user.id}`).fetchSockets();
      if (remainingSockets.length === 0) {
        const updatedOnline = await markUserOffline(user.id);
        io.emit("presence:update", { onlineUserIds: updatedOnline });
      }
    });
  });

  ioInstance = io;
  return io;
}
