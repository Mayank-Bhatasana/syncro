"use client";

import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setAuthToken } from "../api/client";
import { useSyncroStore } from "../store/useSyncroStore";
import { ChatModule } from "../components/ChatModule";
import { CalendarModule } from "../components/CalendarModule";
import { DocsModule } from "../components/DocsModule";
import { Avatar } from "../components/ui";
import {
  Calendar,
  MessageSquare,
  FileText,
  LogOut,
  Zap,
  UserCheck,
  X,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";

const TABS = [
  {
    id: "calendar",
    label: "Calendar",
    icon: Calendar,
    accent: "bg-azure",
  },
  {
    id: "chat",
    label: "Live Chat",
    icon: MessageSquare,
    accent: "bg-bubble",
  },
  {
    id: "docs",
    label: "Shared Docs",
    icon: FileText,
    accent: "bg-mint",
  },
] as const;

const TOAST_STYLES = {
  warning: { bg: "bg-sun", icon: AlertTriangle },
  success: { bg: "bg-mint", icon: CheckCircle2 },
  info: { bg: "bg-azure", icon: Info },
};

export default function HomePage() {
  const queryClient = useQueryClient();
  const currentUser = useSyncroStore((s) => s.currentUser);
  const setCurrentUser = useSyncroStore((s) => s.setCurrentUser);
  const activeTab = useSyncroStore((s) => s.activeTab);
  const setActiveTab = useSyncroStore((s) => s.setActiveTab);
  const setOnlineUserIds = useSyncroStore((s) => s.setOnlineUserIds);
  const notifications = useSyncroStore((s) => s.notifications);
  const dismissNotification = useSyncroStore((s) => s.dismissNotification);

  const [email, setEmail] = useState("marcus.manager@syncro.io");
  const [password, setPassword] = useState("password123");
  const [authError, setAuthError] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const { data: demoData } = useQuery({
    queryKey: ["demo-accounts"],
    queryFn: api.getDemoAccounts,
  });

  useEffect(() => {
    api
      .getMe()
      .then((res) => {
        setCurrentUser(res.user);
        setOnlineUserIds(res.onlineUserIds);
      })
      .catch(() => {
        setCurrentUser(null);
      })
      .finally(() => {
        setLoadingSession(false);
      });
  }, [setCurrentUser, setOnlineUserIds]);

  const handleLogin = async (loginEmail: string, loginPass = "password123") => {
    try {
      setAuthError(null);
      const res = await api.login(loginEmail, loginPass);
      setAuthToken(res.token);
      setCurrentUser(res.user);
      queryClient.clear();
    } catch (err: any) {
      setAuthError(err.message || "Login failed");
    }
  };

  const handleLogout = async () => {
    await api.logout().catch(() => {});
    setAuthToken(null);
    setCurrentUser(null);
    queryClient.clear();
  };

  if (loadingSession) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5">
        <div className="flex gap-2">
          <span
            className="w-4 h-4 rounded-full bg-sun border-2 border-ink animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="w-4 h-4 rounded-full bg-bubble border-2 border-ink animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="w-4 h-4 rounded-full bg-azure border-2 border-ink animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </div>
        <p className="font-display font-bold text-lg">
          Warming up your workspace...
        </p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card max-w-4xl w-full grid md:grid-cols-2 gap-8 p-8 rounded-[2rem] shadow-pop-lg">
          {/* Left: Login Form */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-sun border-[3px] border-ink shadow-pop-sm flex items-center justify-center -rotate-6">
                <Zap className="w-6 h-6 text-ink fill-ink" />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight leading-none">
                  Syncro
                </h1>
                <p className="text-xs font-semibold text-ink/60 mt-1.5">
                  Chat • Calendar • Shared Docs
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-extrabold leading-tight">
                Welcome back! 👋
              </h2>
              <p className="text-sm text-ink/60 mt-1">
                Sign in to get everyone in sync.
              </p>
            </div>

            {authError && (
              <div className="p-3 rounded-xl bg-bubble border-[3px] border-ink text-xs font-bold shadow-pop-sm">
                {authError}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleLogin(email, password);
              }}
              className="space-y-4"
            >
              <div>
                <label className="label">Work Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="field"
                />
              </div>

              <div>
                <label className="label">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field"
                />
              </div>

              <button
                type="submit"
                className="btn bg-sun w-full py-3 text-sm"
              >
                Sign In to Syncro
              </button>
            </form>

            <div className="flex flex-wrap gap-2 pt-1">
              <span className="chip bg-bubble">💬 Chat</span>
              <span className="chip bg-azure">📅 Calendar</span>
              <span className="chip bg-mint">📝 Docs</span>
            </div>
          </div>

          {/* Right: sign in as a teammate */}
          <div className="border-t-[3px] md:border-t-0 md:border-l-[3px] border-dashed border-ink pt-6 md:pt-0 md:pl-8 space-y-3">
            <h2 className="text-lg font-extrabold flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-grape border-2 border-ink shadow-pop-sm flex items-center justify-center">
                <UserCheck className="w-4 h-4" />
              </span>
              Sign in as a teammate
            </h2>
            <p className="text-xs text-ink/60">
              Pick anyone to see Syncro from their side: their chats, calendar and
              documents.
            </p>

            <div className="space-y-2.5 max-h-80 overflow-y-auto p-1 -m-1">
              {demoData?.users.map((u) => (
                <button
                  key={u.id}
                  onClick={() => handleLogin(u.email, "password123")}
                  className="w-full text-left p-3 rounded-2xl bg-white border-[3px] border-ink shadow-pop-sm flex items-center gap-3 transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-pop"
                >
                  <Avatar name={u.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold truncate">{u.name}</p>
                    <p className="text-xs text-ink/60 truncate">{u.jobTitle ?? u.email}</p>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <span
                      className={`chip ${
                        u.role === "MANAGER" || u.role === "ADMIN"
                          ? "bg-grape"
                          : "bg-white"
                      }`}
                    >
                      {u.role}
                    </span>
                    <p className="text-[11px] font-semibold text-ink/60">
                      {u.departmentName} Dept
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Navigation Bar */}
      <header className="h-16 border-b-[3px] border-ink bg-white px-5 flex items-center justify-between gap-4 relative z-40">
        <div className="flex items-center gap-5 min-w-0">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-sun border-[3px] border-ink shadow-pop-sm flex items-center justify-center -rotate-6">
              <Zap className="w-4 h-4 text-ink fill-ink" />
            </div>
            <span className="font-display font-extrabold text-xl tracking-tight">
              Syncro
            </span>
          </div>

          <nav className="flex items-center gap-1.5 overflow-x-auto py-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`tab ${isActive ? `tab-active ${tab.accent}` : ""}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: Instant Role Switcher + Current User Badge */}
        <div className="flex items-center gap-3 shrink-0">
          <select
            value={currentUser.email}
            onChange={(e) => handleLogin(e.target.value, "password123")}
            className="field w-auto max-w-[240px] py-1.5 text-xs font-bold cursor-pointer"
            title="Switch to another teammate"
          >
            {demoData?.users.map((u) => (
              <option key={u.id} value={u.email}>
                Switch Account: {u.name} ({u.role} • {u.departmentName})
              </option>
            ))}
          </select>

          <div className="hidden sm:flex items-center gap-2.5 pl-1.5 pr-3 py-1 rounded-xl bg-paper border-2 border-ink">
            <Avatar name={currentUser.name} size="sm" />
            <div className="leading-tight">
              <p className="text-xs font-extrabold">{currentUser.name}</p>
              <p className="text-[10px] font-semibold text-ink/60">
                {currentUser.departmentName}
              </p>
            </div>
            <span className="chip bg-grape">{currentUser.role}</span>
          </div>

          <button
            onClick={handleLogout}
            className="btn btn-icon bg-white hover:bg-bubble"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Live notifications */}
      {notifications.length > 0 && (
        <div className="fixed bottom-5 right-5 z-50 space-y-3 max-w-sm w-full">
          {notifications.map((n) => {
            const style = TOAST_STYLES[n.type];
            const Icon = style.icon;
            return (
              <div
                key={n.id}
                className={`p-4 rounded-2xl border-[3px] border-ink shadow-pop-lg flex items-start gap-3 animate-pop-in ${style.bg}`}
              >
                <Icon className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-extrabold">{n.title}</p>
                  <p className="text-xs font-medium mt-0.5">{n.message}</p>
                </div>
                <button
                  onClick={() => dismissNotification(n.id)}
                  className="shrink-0 p-1 rounded-lg bg-white border-2 border-ink hover:bg-ink hover:text-white transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Active Module View */}
      <main className="flex-1">
        {activeTab === "calendar" && <CalendarModule />}
        {activeTab === "chat" && <ChatModule />}
        {activeTab === "docs" && <DocsModule />}
      </main>
    </div>
  );
}
