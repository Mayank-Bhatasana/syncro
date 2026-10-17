import { Router, Request, Response } from "express";
import * as Y from "yjs";
import { prisma } from "../../config/db";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  CreateDocumentSchema,
  ShareDocumentSchema,
  DocumentDTO,
  DocAccessLevel,
} from "@syncro/shared";
import { canChangeDocSharing, canReadDocument } from "../permissions";
import { getIO } from "../../socket";

export const docsRouter = Router();

docsRouter.use(requireAuth);

function formatDocumentDTO(doc: any, currentUserId: string): DocumentDTO {
  const isOwner = doc.ownerId === currentUserId;
  const myPerm = doc.permissions.find((p: any) => p.userId === currentUserId);
  const myAccess: "OWNER" | DocAccessLevel = isOwner
    ? "OWNER"
    : (myPerm?.accessLevel as DocAccessLevel);

  return {
    id: doc.id,
    ownerId: doc.ownerId,
    ownerName: doc.owner.name,
    title: doc.title,
    myAccess,
    permissions: doc.permissions.map((p: any) => ({
      userId: p.userId,
      userName: p.user.name,
      userEmail: p.user.email,
      accessLevel: p.accessLevel as DocAccessLevel,
    })),
    updatedAt: doc.updatedAt.toISOString(),
    createdAt: doc.createdAt.toISOString(),
  };
}

// GET /documents — list all documents owned by or shared with the user
docsRouter.get("/documents", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const docs = await prisma.document.findMany({
      where: {
        OR: [
          { ownerId: userId },
          { permissions: { some: { userId } } },
        ],
      },
      include: {
        owner: true,
        permissions: {
          include: { user: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json({
      documents: docs.map((d) => formatDocumentDTO(d, userId)),
    });
  } catch (err) {
    console.error("Failed to fetch documents:", err);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

// POST /documents — create a new blank collaborative document
docsRouter.post(
  "/documents",
  validateBody(CreateDocumentSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { title } = req.body;

      const ydoc = new Y.Doc();
      const ytext = ydoc.getText("content");
      ytext.insert(0, `# ${title}\n\nStart typing collaboratively here...`);
      const initialState = Buffer.from(Y.encodeStateAsUpdate(ydoc));

      const doc = await prisma.document.create({
        data: {
          ownerId: userId,
          title,
          yjsState: initialState,
        },
        include: {
          owner: true,
          permissions: {
            include: { user: true },
          },
        },
      });

      res.status(201).json({
        document: formatDocumentDTO(doc, userId),
      });
    } catch (err) {
      console.error("Failed to create document:", err);
      res.status(500).json({ error: "Failed to create document" });
    }
  }
);

// GET /documents/:id — get metadata & permissions of a single document
docsRouter.get(
  "/documents/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const docId = String(req.params.id);

      const doc = await prisma.document.findUnique({
        where: { id: docId },
        include: {
          owner: true,
          permissions: {
            include: { user: true },
          },
        },
      });

      if (!doc) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      const myPerm = doc.permissions.find((p) => p.userId === userId)
        ?.accessLevel as DocAccessLevel | undefined;

      if (!canReadDocument(userId, doc.ownerId, myPerm)) {
        res
          .status(403)
          .json({ error: "Forbidden: You do not have access to this document" });
        return;
      }

      res.json({
        document: formatDocumentDTO(doc, userId),
      });
    } catch (err) {
      console.error("Failed to load document:", err);
      res.status(500).json({ error: "Failed to load document" });
    }
  }
);

// PUT /documents/:id/share — Only the owner can change doc sharing
docsRouter.put(
  "/documents/:id/share",
  validateBody(ShareDocumentSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUserId = req.user!.id;
      const docId = String(req.params.id);
      const { userId, accessLevel } = req.body;

      const doc = await prisma.document.findUnique({
        where: { id: docId },
      });

      if (!doc) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      // Rule: Only the owner can change doc sharing
      if (!canChangeDocSharing(currentUserId, doc.ownerId)) {
        res.status(403).json({
          error: "Forbidden: Only the document owner can change sharing permissions",
        });
        return;
      }

      if (userId === doc.ownerId) {
        res.status(400).json({ error: "Owner already has full access" });
        return;
      }

      await prisma.documentPermission.upsert({
        where: {
          documentId_userId: {
            documentId: docId,
            userId,
          },
        },
        update: {
          accessLevel,
        },
        create: {
          documentId: docId,
          userId,
          accessLevel,
        },
      });

      const updatedDoc = await prisma.document.findUnique({
        where: { id: docId },
        include: {
          owner: true,
          permissions: {
            include: { user: true },
          },
        },
      });

      // Notify the target user in real time
      try {
        const io = getIO();
        io.to(`user:${userId}`).emit("doc:shared", {
          document: formatDocumentDTO(updatedDoc, userId),
          accessLevel,
        });
      } catch {
        // Ignore if socket server not initialized
      }

      res.json({
        document: formatDocumentDTO(updatedDoc, currentUserId),
      });
    } catch (err) {
      console.error("Failed to share document:", err);
      res.status(500).json({ error: "Failed to share document" });
    }
  }
);
