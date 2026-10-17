import express from "express";
import http from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { authRouter } from "./modules/auth/routes";
import { chatRouter } from "./modules/chat/routes";
import { calendarRouter } from "./modules/calendar/routes";
import { docsRouter } from "./modules/docs/routes";
import { initSocketServer } from "./socket";

export const app = express();

app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Rate limiter for production security
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", apiLimiter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "syncro-server" });
});

// Mount all 4 core modules under both /api/* and /* so either path style works
app.use("/api", authRouter);
app.use("/api", chatRouter);
app.use("/api", calendarRouter);
app.use("/api", docsRouter);

app.use("/", authRouter);
app.use("/", chatRouter);
app.use("/", calendarRouter);
app.use("/", docsRouter);

if (process.env.NODE_ENV !== "test") {
  const httpServer = http.createServer(app);
  initSocketServer(httpServer);

  httpServer.listen(env.PORT, () => {
    console.log(`🚀 Syncro server running on http://localhost:${env.PORT}`);
  });
}
