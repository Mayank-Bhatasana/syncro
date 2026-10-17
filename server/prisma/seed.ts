import { PrismaClient, Role, AttendeeStatus, DocAccessLevel } from "@prisma/client";
import bcrypt from "bcryptjs";
import * as Y from "yjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding Syncro database...");

  // Clean existing tables in order
  await prisma.documentPermission.deleteMany();
  await prisma.document.deleteMany();
  await prisma.eventAttendee.deleteMany();
  await prisma.event.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversationMember.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();

  // Create Departments
  const [itDept, hrDept, engDept] = await Promise.all([
    prisma.department.create({ data: { name: "IT" } }),
    prisma.department.create({ data: { name: "HR" } }),
    prisma.department.create({ data: { name: "Engineering" } }),
  ]);

  const passwordHash = await bcrypt.hash("password123", 10);

  // Create Users across roles & departments
  const sarahAdmin = await prisma.user.create({
    data: {
      email: "sarah.admin@syncro.io",
      name: "Sarah Chen (VP Ops)",
      passwordHash,
      role: Role.ADMIN,
      departmentId: engDept.id,
    },
  });

  const marcusManager = await prisma.user.create({
    data: {
      email: "marcus.manager@syncro.io",
      name: "Marcus Vance (IT Manager)",
      passwordHash,
      role: Role.MANAGER,
      departmentId: itDept.id,
    },
  });

  const elenaManager = await prisma.user.create({
    data: {
      email: "elena.hr@syncro.io",
      name: "Elena Rostova (HR Lead)",
      passwordHash,
      role: Role.MANAGER,
      departmentId: hrDept.id,
    },
  });

  const alexIt = await prisma.user.create({
    data: {
      email: "alex.it@syncro.io",
      name: "Alex Rivera",
      passwordHash,
      role: Role.EMPLOYEE,
      departmentId: itDept.id,
    },
  });

  const priyaIt = await prisma.user.create({
    data: {
      email: "priya.it@syncro.io",
      name: "Priya Nair",
      passwordHash,
      role: Role.EMPLOYEE,
      departmentId: itDept.id,
    },
  });

  const jordanHr = await prisma.user.create({
    data: {
      email: "jordan.hr@syncro.io",
      name: "Jordan Taylor",
      passwordHash,
      role: Role.EMPLOYEE,
      departmentId: hrDept.id,
    },
  });

  const liamEng = await prisma.user.create({
    data: {
      email: "liam.eng@syncro.io",
      name: "Liam O'Connor",
      passwordHash,
      role: Role.EMPLOYEE,
      departmentId: engDept.id,
    },
  });

  // Create Sample Conversations
  const itChannel = await prisma.conversation.create({
    data: {
      name: "IT Infrastructure Team",
      isGroup: true,
      members: {
        create: [
          { userId: marcusManager.id },
          { userId: alexIt.id },
          { userId: priyaIt.id },
        ],
      },
      messages: {
        create: [
          {
            senderId: marcusManager.id,
            content: "Morning IT team! Let's review the Q4 firewall migration today.",
          },
          {
            senderId: alexIt.id,
            content: "Sounds good Marcus, I have the staging logs ready.",
          },
        ],
      },
    },
  });

  await prisma.conversation.create({
    data: {
      name: "Company Announcements",
      isGroup: true,
      members: {
        create: [
          { userId: sarahAdmin.id },
          { userId: marcusManager.id },
          { userId: elenaManager.id },
          { userId: alexIt.id },
          { userId: priyaIt.id },
          { userId: jordanHr.id },
          { userId: liamEng.id },
        ],
      },
      messages: {
        create: [
          {
            senderId: sarahAdmin.id,
            content: "Welcome to Syncro! Real-time chat, smart department calendars, and Yjs docs are live.",
          },
        ],
      },
    },
  });

  // Create Sample Calendar Events (including a conflict & pending excuse request!)
  const now = new Date();
  const today2pm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0);
  const today3pm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0, 0);
  const today230pm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 30, 0);
  const today330pm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 30, 0);

  // Event 1: Alex's existing 1-on-1 with HR (2:00 PM - 3:00 PM)
  await prisma.event.create({
    data: {
      organizerId: jordanHr.id,
      title: "Benefits Onboarding Check-in",
      description: "Reviewing annual health benefits",
      startTime: today2pm,
      endTime: today3pm,
      attendees: {
        create: [
          { userId: jordanHr.id, status: AttendeeStatus.ACCEPTED },
          { userId: alexIt.id, status: AttendeeStatus.ACCEPTED },
        ],
      },
    },
  });

  // Event 2: Marcus (IT Manager) books an IT Department Sync overlapping at 2:30 PM - 3:30 PM
  // Alex has a conflict and submitted an excuse request to Marcus!
  await prisma.event.create({
    data: {
      organizerId: marcusManager.id,
      title: "IT Department Security Sync",
      description: "Mandatory sync for IT + HR representative on SSO rollout.",
      startTime: today230pm,
      endTime: today330pm,
      attendees: {
        create: [
          { userId: marcusManager.id, status: AttendeeStatus.ACCEPTED, hasConflict: false },
          { userId: priyaIt.id, status: AttendeeStatus.ACCEPTED, hasConflict: false },
          {
            userId: alexIt.id,
            status: AttendeeStatus.EXCUSE_PENDING,
            hasConflict: true,
            excuseReason: "Hey Marcus, I have an overlapping Benefits Onboarding session from 2:00–3:00 PM. Can I catch the recording for the first 30 mins or skip this one?",
            respondedAt: new Date(),
          },
        ],
      },
    },
  });

  // Create Sample Collaborative Document with Yjs initial content
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  ytext.insert(
    0,
    "# Q4 IT & HR Incident Playbook\n\nThis shared document is synced live via Yjs CRDT.\n\n- Editors can type simultaneously with zero merge conflicts.\n- Viewers receive live updates in read-only mode (server rejects viewer edits).\n"
  );
  const initialState = Buffer.from(Y.encodeStateAsUpdate(ydoc));

  await prisma.document.create({
    data: {
      ownerId: marcusManager.id,
      title: "Q4 IT & HR Incident Playbook",
      yjsState: initialState,
      permissions: {
        create: [
          { userId: alexIt.id, accessLevel: DocAccessLevel.EDITOR },
          { userId: priyaIt.id, accessLevel: DocAccessLevel.EDITOR },
          { userId: jordanHr.id, accessLevel: DocAccessLevel.VIEWER },
        ],
      },
    },
  });

  console.log("Seed complete! Demo accounts (all use password: password123):");
  console.log("  - Manager (IT): marcus.manager@syncro.io");
  console.log("  - Employee (IT): alex.it@syncro.io");
  console.log("  - Employee (IT): priya.it@syncro.io");
  console.log("  - Manager (HR): elena.hr@syncro.io");
  console.log("  - Employee (HR): jordan.hr@syncro.io");
  console.log("  - Admin (VP): sarah.admin@syncro.io");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
