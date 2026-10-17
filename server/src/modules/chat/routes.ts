import { Router, Request, Response } from "express";
import { prisma } from "../../config/db";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  CreateConversationSchema,
  ConversationDTO,
  MessageDTO,
  Role,
} from "@syncro/shared";
import { getIO } from "../../socket";

export const chatRouter = Router();

chatRouter.use(requireAuth);

// GET /conversations — returns all conversations the current user is in + unread counts
chatRouter.get("/conversations", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const memberships = await prisma.conversationMember.findMany({
      where: { userId },
      include: {
        conversation: {
          include: {
            members: {
              include: {
                user: {
                  include: { department: true },
                },
              },
            },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: { sender: true },
            },
          },
        },
      },
    });

    const conversations: ConversationDTO[] = await Promise.all(
      memberships.map(async (m) => {
        const conv = m.conversation;
        const unreadCount = await prisma.message.count({
          where: {
            conversationId: conv.id,
            createdAt: { gt: m.lastReadAt },
            senderId: { not: userId },
          },
        });

        const lastMsg = conv.messages[0];

        return {
          id: conv.id,
          name: conv.name,
          isGroup: conv.isGroup,
          createdAt: conv.createdAt.toISOString(),
          unreadCount,
          members: conv.members.map((cm) => ({
            id: cm.user.id,
            email: cm.user.email,
            name: cm.user.name,
            role: cm.user.role as Role,
            departmentId: cm.user.departmentId,
            departmentName: cm.user.department.name,
          })),
          lastMessage: lastMsg
            ? {
                id: lastMsg.id,
                conversationId: lastMsg.conversationId,
                senderId: lastMsg.senderId,
                senderName: lastMsg.sender.name,
                senderRole: lastMsg.sender.role as Role,
                content: lastMsg.content,
                mediaUrl: lastMsg.mediaUrl,
                mediaType: lastMsg.mediaType as "image" | "video" | null,
                createdAt: lastMsg.createdAt.toISOString(),
              }
            : null,
        };
      })
    );

    // Sort by latest message or creation date
    conversations.sort((a, b) => {
      const aTime = a.lastMessage?.createdAt || a.createdAt;
      const bTime = b.lastMessage?.createdAt || b.createdAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    res.json({ conversations });
  } catch (err) {
    console.error("Failed to fetch conversations:", err);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// POST /conversations — create a 1:1 DM or group conversation
chatRouter.post(
  "/conversations",
  validateBody(CreateConversationSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { name, isGroup, memberIds } = req.body;

      const allMemberIds = Array.from(new Set([userId, ...memberIds]));

      // If 1:1 DM, check if an existing 2-person non-group conversation already exists
      if (!isGroup && allMemberIds.length === 2) {
        const existing = await prisma.conversation.findFirst({
          where: {
            isGroup: false,
            AND: allMemberIds.map((id) => ({
              members: { some: { userId: id } },
            })),
          },
          include: {
            members: {
              include: {
                user: { include: { department: true } },
              },
            },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: { sender: true },
            },
          },
        });

        if (existing && existing.members.length === 2) {
          res.json({
            conversation: {
              id: existing.id,
              name: existing.name,
              isGroup: existing.isGroup,
              createdAt: existing.createdAt.toISOString(),
              unreadCount: 0,
              members: existing.members.map((cm) => ({
                id: cm.user.id,
                email: cm.user.email,
                name: cm.user.name,
                role: cm.user.role as Role,
                departmentId: cm.user.departmentId,
                departmentName: cm.user.department.name,
              })),
              lastMessage: existing.messages[0]
                ? {
                    id: existing.messages[0].id,
                    conversationId: existing.messages[0].conversationId,
                    senderId: existing.messages[0].senderId,
                    senderName: existing.messages[0].sender.name,
                    senderRole: existing.messages[0].sender.role as Role,
                    content: existing.messages[0].content,
                    createdAt: existing.messages[0].createdAt.toISOString(),
                  }
                : null,
            },
          });
          return;
        }
      }

      const created = await prisma.conversation.create({
        data: {
          name: isGroup ? name || "Group Chat" : null,
          isGroup: Boolean(isGroup || allMemberIds.length > 2),
          members: {
            create: allMemberIds.map((id) => ({ userId: id })),
          },
        },
        include: {
          members: {
            include: {
              user: { include: { department: true } },
            },
          },
        },
      });

      const conversationDTO: ConversationDTO = {
        id: created.id,
        name: created.name,
        isGroup: created.isGroup,
        createdAt: created.createdAt.toISOString(),
        unreadCount: 0,
        members: created.members.map((cm) => ({
          id: cm.user.id,
          email: cm.user.email,
          name: cm.user.name,
          role: cm.user.role as Role,
          departmentId: cm.user.departmentId,
          departmentName: cm.user.department.name,
        })),
        lastMessage: null,
      };

      // Notify all members so their sidebar updates in real time
      try {
        const io = getIO();
        for (const memberId of allMemberIds) {
          io.to(`user:${memberId}`).emit("conversation:created", conversationDTO);
        }
      } catch {
        // Ignore if socket server not initialized in unit tests
      }

      res.status(201).json({ conversation: conversationDTO });
    } catch (err) {
      console.error("Failed to create conversation:", err);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  }
);

// GET /conversations/:id/messages — paginated message history (members only)
chatRouter.get(
  "/conversations/:id/messages",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const conversationId = String(req.params.id);
      const limit = Math.min(Number(req.query.limit) || 40, 100);
      const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

      // Rule: Only conversation members can read messages
      const membership = await prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId,
            userId,
          },
        },
      });

      if (!membership) {
        res
          .status(403)
          .json({ error: "Forbidden: Only conversation members can read messages" });
        return;
      }

      // Mark conversation as read up to now
      await prisma.conversationMember.update({
        where: {
          conversationId_userId: {
            conversationId,
            userId,
          },
        },
        data: { lastReadAt: new Date() },
      });

      const messages = await prisma.message.findMany({
        where: { conversationId },
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : 0,
        orderBy: { createdAt: "desc" },
        include: {
          sender: true,
        },
      });

      let nextCursor: string | null = null;
      if (messages.length > limit) {
        const nextItem = messages.pop();
        nextCursor = nextItem!.id;
      }

      // Return chronological order for UI display
      const chronological: MessageDTO[] = messages.reverse().map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        senderName: m.sender.name,
        senderRole: m.sender.role as Role,
        content: m.content,
        mediaUrl: m.mediaUrl,
        mediaType: m.mediaType as "image" | "video" | null,
        createdAt: m.createdAt.toISOString(),
      }));

      res.json({
        messages: chronological,
        nextCursor,
      });
    } catch (err) {
      console.error("Failed to fetch messages:", err);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  }
);
