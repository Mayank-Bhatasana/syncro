import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../config/db";
import { Role } from "@syncro/shared";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  departmentId: string;
  departmentName: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const COOKIE_NAME = "syncro_token";

export function signToken(payload: {
  userId: string;
  role: Role;
  departmentId: string;
}): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): {
  userId: string;
  role: Role;
  departmentId: string;
} {
  return jwt.verify(token, env.JWT_SECRET) as {
    userId: string;
    role: Role;
    departmentId: string;
  };
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token =
      req.cookies?.[COOKIE_NAME] ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : undefined);

    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const decoded = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { department: true },
    });

    if (!user) {
      res.status(401).json({ error: "Invalid user session" });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      departmentId: user.departmentId,
      departmentName: user.department.name,
    };

    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Forbidden: requires role ${allowedRoles.join(" or ")}`,
      });
      return;
    }
    next();
  };
}
