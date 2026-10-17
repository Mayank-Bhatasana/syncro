import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/db";
import {
  COOKIE_NAME,
  requireAuth,
  signToken,
} from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { LoginSchema, Role, UserDTO, DepartmentDTO } from "@syncro/shared";
import { getOnlineUsers } from "../../config/redis";

export const authRouter = Router();

authRouter.post(
  "/auth/login",
  validateBody(LoginSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        include: { department: true },
      });

      if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const validPassword = await bcrypt.compare(password, user.passwordHash);
      if (!validPassword) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const token = signToken({
        userId: user.id,
        role: user.role as Role,
        departmentId: user.departmentId,
      });

      res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      const userDTO: UserDTO = {
        id: user.id,
        email: user.email,
        name: user.name,
        jobTitle: user.jobTitle,
        role: user.role as Role,
        departmentId: user.departmentId,
        departmentName: user.department.name,
      };

      res.json({ user: userDTO, token });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

authRouter.post("/auth/logout", (_req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

authRouter.get("/auth/me", requireAuth, async (req: Request, res: Response) => {
  const onlineUserIds = await getOnlineUsers();
  res.json({ user: req.user, onlineUserIds });
});

// Demo helper endpoint: list demo accounts on login screen for quick testing
authRouter.get("/auth/demo-accounts", async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    include: { department: true },
    orderBy: [{ role: "desc" }, { name: "asc" }],
  });

  const demoUsers: UserDTO[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    jobTitle: u.jobTitle,
    role: u.role as Role,
    departmentId: u.departmentId,
    departmentName: u.department.name,
  }));

  res.json({ users: demoUsers });
});

authRouter.get("/users", requireAuth, async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    include: { department: true },
    orderBy: { name: "asc" },
  });

  const userDTOs: UserDTO[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    jobTitle: u.jobTitle,
    role: u.role as Role,
    departmentId: u.departmentId,
    departmentName: u.department.name,
  }));

  res.json({ users: userDTOs });
});

authRouter.get(
  "/departments",
  requireAuth,
  async (_req: Request, res: Response) => {
    const depts = await prisma.department.findMany({
      include: {
        _count: {
          select: { users: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const departmentDTOs: DepartmentDTO[] = depts.map((d) => ({
      id: d.id,
      name: d.name,
      memberCount: d._count.users,
    }));

    res.json({ departments: departmentDTOs });
  }
);
