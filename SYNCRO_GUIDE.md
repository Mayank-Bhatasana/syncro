# Syncro — Complete System Guide, Architecture & Interview Reference

This document contains everything about **Syncro**: how to run it, where data is stored, how PostgreSQL and Redis work together, all implemented features, and clear interview answers.

---

## 1. Quick Start & Running the App

### Ports & Services
- **Frontend (Next.js 14):** `http://localhost:3000`
- **Backend API & Socket.IO (Express):** `http://localhost:4000`
- **PostgreSQL 16 (`syncro-postgres` container):** `localhost:5433`
- **Redis 7 (`syncro-redis` container):** `localhost:6380`

### Useful Commands (from `/home/mayank/syncro`)
```bash
# Start Backend Server (port 4000)
npm run dev:server

# Start Frontend Client (port 3000)
npm run dev:client

# Run Unit Tests (RBAC permissions & Calendar overlap logic)
npm test

# Re-seed Database with Demo Accounts
npm run db:seed

# Open Visual Database Browser (Prisma Studio on http://localhost:5555)
npx --workspace=@syncro/server prisma studio

# Open SQL Shell inside Postgres Container
docker exec -it syncro-postgres psql -U syncro -d syncro_db

# Inspect Redis Online Users Set in Terminal
docker exec -it syncro-redis redis-cli SMEMBERS syncro:presence:online_users
```

### Demo Accounts (Password for all: `password123`)
| Name | Email | Role | Department | What to Test |
| :--- | :--- | :--- | :--- | :--- |
| **Marcus Vance** | `marcus.manager@syncro.io` | `MANAGER` | IT | Book dept-wide meetings; Allow/Deny Alex's conflict excuse; Own/Share Yjs doc |
| **Alex Rivera** | `alex.it@syncro.io` | `EMPLOYEE` | IT | Has an overlapping meeting conflict; Send excuse message to boss; Edit Yjs doc |
| **Priya Nair** | `priya.it@syncro.io` | `EMPLOYEE` | IT | IT team chat, accept meetings, co-edit Yjs doc |
| **Elena Rostova** | `elena.hr@syncro.io` | `MANAGER` | HR | Book HR or cross-department meetings |
| **Jordan Taylor** | `jordan.hr@syncro.io` | `EMPLOYEE` | HR | Shared as `VIEWER` (read-only) on the Yjs document |
| **Liam O'Connor** | `liam.eng@syncro.io` | `EMPLOYEE` | Engineering | Test employee permission boundaries |
| **Sarah Chen** | `sarah.admin@syncro.io` | `ADMIN` | Engineering | Full company-wide (`ALL`) booking permissions |

---

## 2. Project Structure

```text
syncro/
├── docker-compose.yml               # Postgres 16 (port 5433) + Redis 7 (port 6380)
├── package.json                     # Workspace root
├── shared/                          # Shared Zod schemas & TypeScript DTOs
│   └── src/index.ts
├── server/                          # Express + Socket.IO + Prisma + Redis + Yjs
│   ├── .env                         # DB, Redis, and JWT config
│   ├── prisma/
│   │   ├── schema.prisma            # 8 relational tables + composite indexes
│   │   └── seed.ts                  # Demo org, conflict scenario, and Yjs doc seed
│   ├── src/
│   │   ├── config/                  # env.ts, db.ts (Prisma), redis.ts (Presence + Pub/Sub)
│   │   ├── middleware/              # auth.ts (JWT + RBAC), validate.ts (Zod)
│   │   ├── socket/index.ts          # WebSocket gateway, chat, presence, Yjs CRDT sync
│   │   └── modules/
│   │       ├── permissions.ts       # Pure RBAC & time-overlap functions
│   │       ├── auth/routes.ts       # /auth/login, /auth/me, /users, /departments
│   │       ├── chat/routes.ts       # /conversations, cursor-paginated /messages
│   │       ├── calendar/routes.ts   # /calendar, /events, excuse & decision flow, /availability
│   │       └── docs/routes.ts       # /documents, /documents/:id/share
│   └── tests/
│       └── permissions-and-conflicts.test.ts
└── client/                          # Next.js (App Router) + React Query + Zustand + Tailwind
    └── src/
        ├── api/client.ts            # REST client
        ├── store/useSyncroStore.ts  # Zustand store (online presence, typing, toasts)
        ├── socket/SocketProvider.tsx# Single persistent WebSocket connection
        ├── components/
        │   ├── CalendarModule.tsx   # Calendar, Dept auto-select, Excuse & Boss Decision UI
        │   ├── ChatModule.tsx       # Scoped online list, Show More, typing animation, photo/video
        │   └── DocsModule.tsx       # Live Yjs CRDT editor + Owner share modal
        └── app/page.tsx             # Main workspace + 1-click Demo Account Switcher
```

---

## 3. Where Data is Stored: PostgreSQL vs. Redis

### A. PostgreSQL (Permanent Source of Truth)
- **Connection:** `postgresql://syncro:syncro_password@localhost:5433/syncro_db?schema=public`
- **Where it lives:** Inside the `syncro-postgres` Docker container (`/var/lib/postgresql/data`).
- **8 Tables (`server/prisma/schema.prisma`):**
  1. `departments`: `id`, `name` (`IT`, `HR`, `Engineering`)
  2. `users`: `id`, `email`, `password_hash`, `name`, `role` (`EMPLOYEE` | `MANAGER` | `ADMIN`), `department_id`
  3. `conversations`: `id`, `name`, `is_group`, `created_at`
  4. `conversation_members`: `(conversation_id, user_id)`, `last_read_at`
  5. `messages`: `id`, `conversation_id`, `sender_id`, `content`, `media_url`, `media_type`, `created_at`
     - **Index:** `idx_messages_conv_created ON messages (conversation_id, created_at DESC)`
  6. `events`: `id`, `organizer_id`, `title`, `description`, `start_time`, `end_time`
     - **Index:** `idx_events_time ON events (start_time, end_time)`
  7. `event_attendees`: `id`, `event_id`, `user_id`, `status` (`INVITED` | `ACCEPTED` | `EXCUSE_PENDING` | `EXCUSED` | `EXCUSE_DENIED`), `has_conflict`, `excuse_reason`, `organizer_reply`
     - **Index:** `idx_event_attendees_user ON event_attendees (user_id, event_id)`
  8. `documents` & `document_permissions`: `id`, `owner_id`, `title`, `yjs_state` (`BYTEA` binary CRDT state), and per-user `access_level` (`EDITOR` | `VIEWER`).

### B. Redis (Temporary In-Memory State)
- **Connection:** `redis://localhost:6380`
- **Where it lives:** Inside the `syncro-redis` Docker container in RAM.
- **How Redis stores data in Syncro (`server/src/config/redis.ts`):**
  1. **Online Presence (`SET`):**
     - Key: `"syncro:presence:online_users"`
     - When a user connects: `SADD syncro:presence:online_users <userId>`
     - When querying online users: `SMEMBERS syncro:presence:online_users`
     - When a user closes their last tab: `SREM syncro:presence:online_users <userId>` (removes the user immediately; if nobody is online, Redis deletes the empty key automatically).
  2. **Multi-Server WebSocket Broadcasts (`Pub/Sub`):**
     - Uses `@socket.io/redis-adapter`.
     - Events like `message:new` or `event:invited` are broadcast in memory across server instances and discarded immediately after delivery (zero disk storage).

---

## 4. What Was Implemented in Each Module

### 1. Live Chat (`ChatModule.tsx` & `chat/routes.ts`)
- **Server-side membership check** on both `GET /conversations/:id/messages` and WebSocket `message:send`.
- **Online-first sorting & scoped presence:** Shows online users for the **currently active group/conversation only**, with online employees sorted first in the list.
- **One-line member header with `+X more (Show more)` / `Show less` toggle.**
- **Animated bouncing 3-dot typing indicator** over WebSocket (`typing` event).
- **Photo & Video attachments:** Upload and preview images (`<img>`) and videos (`<video controls>`) directly in chat messages.
- **Unread message badge counts** computed from `messages.created_at > conversation_members.last_read_at`.

### 2. Smart Department Calendar & Conflict Excuse Flow (`CalendarModule.tsx` & `calendar/routes.ts`)
- **Manager Target Expansion:** Managers/Admins can invite `ALL`, `DEPARTMENT` (e.g., clicking *"IT Department"* automatically checks all IT employees in the UI and expands them on the server), plus specific individuals (e.g., *"+ 1 HR person"*).
- **Single-Query Conflict Detection:** Checks all target users for overlapping non-excused events (`existing.startTime < newEndTime AND existing.endTime > newStartTime`) in one database query and flags `hasConflict: true`.
- **Employee Conflict Excuse Request (`PATCH /events/:id/excuse`):** If an employee has a conflict, they send a *"Hey I can't be there"* message (`excuseReason`) to the boss. Status becomes `EXCUSE_PENDING` and the boss gets a live WebSocket notification.
- **Boss Allow / Deny Decision (`PATCH /events/:id/attendees/:userId/decision`):** Only the meeting organizer (boss) can click **Allow (Excuse)** (`EXCUSED`) or **Deny** (`EXCUSE_DENIED`) with a reply message (`organizerReply`). The employee receives the boss's decision and reply in real time.
- **Privacy-Preserving Free/Busy (`GET /availability`):** Returns only `{ userId, startTime, endTime }` busy blocks — never leaking titles or descriptions.

### 3. Collaborative Documents (`DocsModule.tsx` & `docs/routes.ts`)
- **Yjs CRDT Real-Time Sync:** Multiple editors can type simultaneously; binary updates (`doc:update`) merge cleanly in memory with zero conflicts.
- **Strict Permission Enforcement:** Only the owner can change sharing (`PUT /documents/:id/share`). Viewers get the document in read-only mode, and the server explicitly rejects any `doc:update` packet sent by a `VIEWER`.
- **Debounced Persistence:** Merged Yjs state is encoded as a binary `BYTEA` buffer and saved to PostgreSQL every 1.5 seconds.

---

## 5. Interview Q&A Cheat Sheet

### Q1: “How do you stop an employee from reading someone else’s messages?”
**Answer:**
We enforce **server-side membership checks** on both the REST API and the WebSocket layer — never trusting the UI.
- In `GET /conversations/:id/messages`, the server queries `conversation_members` for `(conversationId, req.user.id)`. If the user isn't a member, it returns `403 Forbidden`.
- In Socket.IO (`message:send`), the server checks `conversation_members` again before saving the message or broadcasting to `conversation:{id}`.

### Q2: “How does calendar scheduling avoid double-booking?”
**Answer:**
1. After expanding targets (`ALL`, `DEPARTMENT`, `USERS`) into a list of user IDs, the server runs **one interval-overlap query**:
   `existing.startTime < newEndTime AND existing.endTime > newStartTime` (excluding `EXCUSED` events).
2. We create the `Event` and individual `EventAttendee` rows inside a transaction, marking anyone in the overlap result with `hasConflict: true`.
3. Employees with a conflict can send an excuse message (`EXCUSE_PENDING`) to the organizer, who can `ALLOW` (`EXCUSED`, freeing their calendar) or `DENY` (`EXCUSE_DENIED`) with a reply message.

### Q3: “How do you handle multiple users typing in the same document at the same time?”
**Answer:**
Instead of sending the whole text file back and forth (where the last person to save overwrites the other person's edits), we use **Yjs**, which is a **CRDT (Conflict-free Replicated Data Type)**.
- Yjs gives every character its own relative position ID between its neighboring characters.
- When two people type at the exact same millisecond, their browsers send tiny binary character deltas (`doc:update`) over WebSocket.
- The server merges both updates into an in-memory `Y.Doc` with mathematically guaranteed zero conflicts, broadcasts the diff to the room, and debounce-saves the binary `BYTEA` snapshot to PostgreSQL every 1.5 seconds.

### Q4: “How would this scale to 10,000 users?”
**Answer:**
1. **Redis Pub/Sub Adapter (`@socket.io/redis-adapter`):** Allows us to run multiple stateless Node.js servers behind a load balancer while still delivering WebSocket messages across servers in sub-millisecond time.
2. **Compound Database Indexes:** `(conversation_id, created_at DESC)` for chat and `(user_id, event_id)` + `(start_time, end_time)` for calendar queries.
3. **Cursor-Based Pagination:** Chat messages paginate by cursor (`cursor: { id }, take: 40`) rather than slow `OFFSET` scans.

### Q5: “Why create one `EventAttendee` row per person instead of storing `department_id` on the Event?”
**Answer:**
1. **Fast Calendar Reads:** Loading a user's calendar (`GET /calendar`) happens 100x more often than booking. Per-user rows make loading a calendar a simple indexed lookup: *"events where I'm an attendee."*
2. **Per-Person Status & Excuses:** Even in a department-wide meeting, one person (`Alex`) might have a conflict and get `EXCUSED` by the boss while everyone else is `ACCEPTED`.
