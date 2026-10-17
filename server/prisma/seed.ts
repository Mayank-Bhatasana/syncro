import {
  PrismaClient,
  Role,
  AttendeeStatus,
  DocAccessLevel,
  EntryCategory,
  LeaveType,
  LeaveStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import * as Y from "yjs";
import { randomMedia } from "@syncro/shared";
import { env } from "../src/config/env";
import {
  addDays,
  dayKeysBetween,
  keyToDbDate,
  todayKey,
  weekdayOf,
  zonedInstant,
} from "../src/modules/time";

/**
 * Syncro demo company.
 *
 * Builds a realistic, deterministic company (44 people in 8 departments) with:
 *  - a two-week calendar window: standups, 1:1s, syncs, project reviews, all-hands
 *  - daily lunch and coffee breaks, personal activities (focus time, errands, training)
 *  - leave requests in every state (pending, approved, rejected, cancelled)
 *  - group channels, department channels, DMs and ~1,500 messages
 *  - shared documents with real content
 *
 * Everything respects the same rules the server enforces: nobody is booked during a
 * break, and people on leave are left off invites. Run with: npm run db:seed
 */

const prisma = new PrismaClient();
const TZ = env.COMPANY_TIMEZONE;
const PASSWORD = "password123";
const NOW = new Date();
const TODAY = todayKey(NOW, TZ);
const WINDOW_START = addDays(TODAY, -7);
const WINDOW_END = addDays(TODAY, 14);
const NEXT_MONDAY = addDays(TODAY, ((1 - weekdayOf(TODAY) + 7) % 7) || 7);

// ---------------------------------------------------------------------------
// Deterministic randomness so the demo looks the same every time it's seeded
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261017);
const chance = (p: number) => rand() < p;
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const shuffled = <T,>(items: readonly T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
const sample = <T,>(items: readonly T[], n: number): T[] => shuffled(items).slice(0, n);
const unique = <T,>(items: T[]): T[] => Array.from(new Set(items));

const at = (day: string, hhmm: string) => zonedInstant(day, hhmm, TZ);
const addMinutes = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);
const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart < bEnd && aEnd > bStart;
const minDate = (a: Date, b: Date) => (a.getTime() < b.getTime() ? a : b);
const isWeekday = (day: string) => {
  const wd = weekdayOf(day);
  return wd >= 1 && wd <= 5;
};
const WINDOW_DAYS = dayKeysBetween(WINDOW_START, WINDOW_END);
const WORKDAYS = WINDOW_DAYS.filter(isWeekday);

// ---------------------------------------------------------------------------
// Company: departments and people
// ---------------------------------------------------------------------------

type DeptKey = "ops" | "it" | "hr" | "eng" | "product" | "finance" | "sales" | "marketing";

const DEPARTMENTS: { key: DeptKey; name: string; channel: string }[] = [
  { key: "eng", name: "Engineering", channel: "Engineering" },
  { key: "product", name: "Product", channel: "Product" },
  { key: "it", name: "IT", channel: "IT Infrastructure" },
  { key: "hr", name: "People & HR", channel: "People & HR" },
  { key: "finance", name: "Finance", channel: "Finance Close" },
  { key: "sales", name: "Sales", channel: "Sales Pipeline" },
  { key: "marketing", name: "Marketing", channel: "Marketing Studio" },
  { key: "ops", name: "Operations", channel: "Ops & Facilities" },
];

interface PersonSpec {
  key: string;
  name: string;
  email: string;
  title: string;
  dept: DeptKey;
  role: Role;
}

const person = (
  key: string,
  name: string,
  email: string,
  title: string,
  dept: DeptKey,
  role: Role = "EMPLOYEE"
): PersonSpec => ({ key, name, email, title, dept, role });

const PEOPLE: PersonSpec[] = [
  // Operations
  person("sarah", "Sarah Chen", "sarah.admin@syncro.io", "Chief Operating Officer", "ops", "ADMIN"),
  person("tom", "Tom Becker", "tom.becker@syncro.io", "Office & Facilities Manager", "ops", "MANAGER"),
  person("lucia", "Lucia Romano", "lucia.romano@syncro.io", "Operations Coordinator", "ops"),
  person("peter", "Peter Wang", "peter.wang@syncro.io", "Facilities Technician", "ops"),
  // IT
  person("marcus", "Marcus Vance", "marcus.manager@syncro.io", "IT Manager", "it", "MANAGER"),
  person("alex", "Alex Rivera", "alex.it@syncro.io", "Systems Engineer", "it"),
  person("priya", "Priya Nair", "priya.it@syncro.io", "Network Engineer", "it"),
  person("kevin", "Kevin Walsh", "kevin.walsh@syncro.io", "Service Desk Lead", "it"),
  person("aisha", "Aisha Rahman", "aisha.rahman@syncro.io", "Security Analyst", "it"),
  // People & HR
  person("elena", "Elena Rostova", "elena.hr@syncro.io", "HR Lead", "hr", "MANAGER"),
  person("jordan", "Jordan Taylor", "jordan.hr@syncro.io", "HR Generalist", "hr"),
  person("grace", "Grace Liu", "grace.liu@syncro.io", "Technical Recruiter", "hr"),
  person("victor", "Victor Hughes", "victor.hughes@syncro.io", "HR Business Partner", "hr"),
  // Engineering
  person("daniel", "Daniel Okafor", "daniel.okafor@syncro.io", "Engineering Manager", "eng", "MANAGER"),
  person("liam", "Liam O'Connor", "liam.eng@syncro.io", "Senior Software Engineer", "eng"),
  person("meilin", "Mei Lin", "mei.lin@syncro.io", "Staff Engineer", "eng"),
  person("ravi", "Ravi Patel", "ravi.patel@syncro.io", "Backend Engineer", "eng"),
  person("hannah", "Hannah Schmidt", "hannah.schmidt@syncro.io", "Frontend Engineer", "eng"),
  person("tomas", "Tomás Herrera", "tomas.herrera@syncro.io", "Site Reliability Engineer", "eng"),
  person("yuki", "Yuki Tanaka", "yuki.tanaka@syncro.io", "QA Engineer", "eng"),
  person("omar", "Omar Haddad", "omar.haddad@syncro.io", "Backend Engineer", "eng"),
  person("chloe", "Chloe Dubois", "chloe.dubois@syncro.io", "Frontend Engineer", "eng"),
  person("ananya", "Ananya Gupta", "ananya.gupta@syncro.io", "Data Engineer", "eng"),
  person("jonas", "Jonas Berg", "jonas.berg@syncro.io", "Backend Engineer", "eng"),
  person("sana", "Sana Qureshi", "sana.qureshi@syncro.io", "Mobile Engineer", "eng"),
  // Product
  person("nadia", "Nadia Kowalski", "nadia.kowalski@syncro.io", "Head of Product", "product", "MANAGER"),
  person("ethan", "Ethan Brooks", "ethan.brooks@syncro.io", "Product Manager", "product"),
  person("sofia", "Sofia Marin", "sofia.marin@syncro.io", "Product Manager", "product"),
  person("kenji", "Kenji Mori", "kenji.mori@syncro.io", "Product Designer", "product"),
  // Finance
  person("richard", "Richard Adler", "richard.adler@syncro.io", "Finance Director", "finance", "MANAGER"),
  person("maya", "Maya Patel", "maya.patel@syncro.io", "Senior Accountant", "finance"),
  person("leo", "Leo Fernandes", "leo.fernandes@syncro.io", "FP&A Analyst", "finance"),
  person("ingrid", "Ingrid Solberg", "ingrid.solberg@syncro.io", "Accounts Payable Specialist", "finance"),
  // Sales
  person("olivia", "Olivia Grant", "olivia.grant@syncro.io", "Sales Director", "sales", "MANAGER"),
  person("ben", "Ben Carter", "ben.carter@syncro.io", "Account Executive", "sales"),
  person("fatima", "Fatima Al-Sayed", "fatima.alsayed@syncro.io", "Account Executive", "sales"),
  person("noah", "Noah Kim", "noah.kim@syncro.io", "Sales Development Rep", "sales"),
  person("zara", "Zara Ahmed", "zara.ahmed@syncro.io", "Account Executive", "sales"),
  person("hugo", "Hugo Laurent", "hugo.laurent@syncro.io", "Sales Development Rep", "sales"),
  person("gabriela", "Gabriela Ortiz", "gabriela.ortiz@syncro.io", "Customer Success Manager", "sales"),
  // Marketing
  person("rachel", "Rachel Greene", "rachel.greene@syncro.io", "Marketing Manager", "marketing", "MANAGER"),
  person("samir", "Samir Joshi", "samir.joshi@syncro.io", "Content Lead", "marketing"),
  person("amelia", "Amelia Brown", "amelia.brown@syncro.io", "Growth Marketer", "marketing"),
  person("lena", "Lena Park", "lena.park@syncro.io", "Brand Designer", "marketing"),
];

// Ids of created rows, filled in during seeding
const U: Record<string, { id: string; name: string; dept: DeptKey; role: Role; spec: PersonSpec }> = {};
const ids = (keys: string[]) => keys.map((k) => U[k].id);
const managerOf: Record<DeptKey, string> = {
  ops: "tom",
  it: "marcus",
  hr: "elena",
  eng: "daniel",
  product: "nadia",
  finance: "richard",
  sales: "olivia",
  marketing: "rachel",
};
const deptMembers = (dept: DeptKey) => PEOPLE.filter((p) => p.dept === dept).map((p) => p.key);
const allKeys = () => PEOPLE.map((p) => p.key);

// ---------------------------------------------------------------------------
// In-memory plan (calendar, breaks, leave) so we can respect the rules before writing
// ---------------------------------------------------------------------------

interface Interval {
  start: Date;
  end: Date;
}

interface PlannedAttendee {
  userId: string;
  status: AttendeeStatus;
  hasConflict: boolean;
  excuseReason?: string | null;
  organizerReply?: string | null;
  respondedAt?: Date | null;
}

interface PlannedEvent {
  organizerId: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  attendees: PlannedAttendee[];
}

interface PlannedEntry {
  userId: string;
  category: EntryCategory;
  title: string;
  notes: string;
  startTime: Date;
  endTime: Date;
}

interface PlannedLeave {
  userId: string;
  type: LeaveType;
  status: LeaveStatus;
  startDate: string;
  endDate: string;
  reason: string;
  decisionNote?: string | null;
  decidedById?: string | null;
  decidedAt?: Date | null;
  createdAt: Date;
}

const plan = {
  events: [] as PlannedEvent[],
  entries: [] as PlannedEntry[],
  leaves: [] as PlannedLeave[],
};
const breakIndex = new Map<string, Interval[]>();
const leaveIndex = new Map<string, Set<string>>();
const entryIndex = new Map<string, Interval[]>();

function indexInterval(map: Map<string, Interval[]>, userId: string, interval: Interval) {
  const list = map.get(userId) ?? [];
  list.push(interval);
  map.set(userId, list);
}

function onLeave(userId: string, day: string): boolean {
  return leaveIndex.get(userId)?.has(day) ?? false;
}

function onBreak(userId: string, start: Date, end: Date): boolean {
  return (breakIndex.get(userId) ?? []).some((b) => overlaps(start, end, b.start, b.end));
}

function hasOwnEntry(userId: string, start: Date, end: Date): boolean {
  return (entryIndex.get(userId) ?? []).some((b) => overlaps(start, end, b.start, b.end));
}

function statusFor(day: string, organizer: boolean): AttendeeStatus {
  if (organizer) return AttendeeStatus.ACCEPTED;
  if (day < TODAY) return chance(0.93) ? AttendeeStatus.ACCEPTED : AttendeeStatus.INVITED;
  return chance(0.7) ? AttendeeStatus.ACCEPTED : AttendeeStatus.INVITED;
}

/**
 * Places a meeting at the first candidate time where nobody is on break.
 * People on leave that day are left off the invite, the same way the server
 * skips people on leave when a department is invited.
 */
function placeMeeting(opts: {
  organizer: string;
  title: string;
  description?: string;
  day: string;
  times: string[];
  minutes: number;
  attendees: string[];
  statusOverrides?: Record<string, Partial<PlannedAttendee>>;
  createdAt?: Date;
}): boolean {
  const organizerId = U[opts.organizer].id;
  if (onLeave(organizerId, opts.day)) return false;
  const invitees = unique([organizerId, ...opts.attendees.map((k) => U[k].id)]).filter(
    (id) => !onLeave(id, opts.day)
  );
  const overrides = Object.fromEntries(
    Object.entries(opts.statusOverrides ?? {}).map(([key, value]) => [U[key].id, value])
  ) as Record<string, Partial<PlannedAttendee>>;

  for (const hhmm of opts.times) {
    const start = at(opts.day, hhmm);
    const end = addMinutes(start, opts.minutes);
    if (invitees.some((id) => onBreak(id, start, end))) continue;

    const attendees: PlannedAttendee[] = invitees.map((userId) => ({
      userId,
      status: statusFor(opts.day, userId === organizerId),
      hasConflict: false,
      ...(overrides[userId] ?? {}),
    }));

    const createdAt = opts.createdAt ?? minDate(
      addMinutes(start, -(60 * 24) * (1 + Math.floor(rand() * 9))),
      addMinutes(NOW, -5)
    );

    plan.events.push({
      organizerId,
      title: opts.title,
      description: opts.description ?? "",
      startTime: start,
      endTime: end,
      createdAt,
      attendees,
    });
    return true;
  }
  return false;
}

function addLeave(entry: {
  user: string;
  type: LeaveType;
  status: LeaveStatus;
  startDate: string;
  endDate: string;
  reason: string;
  decidedBy?: string;
  decisionNote?: string;
}) {
  const userId = U[entry.user].id;
  plan.leaves.push({
    userId,
    type: entry.type,
    status: entry.status,
    startDate: entry.startDate,
    endDate: entry.endDate,
    reason: entry.reason,
    decisionNote: entry.decisionNote ?? null,
    decidedById: entry.decidedBy ? U[entry.decidedBy].id : null,
    decidedAt:
      entry.status === LeaveStatus.PENDING || entry.status === LeaveStatus.CANCELLED
        ? null
        : addMinutes(at(entry.startDate, "09:00"), -60 * 24 * 3),
    createdAt: addMinutes(at(entry.startDate, "09:00"), -60 * 24 * 10),
  });
  for (const day of dayKeysBetween(entry.startDate, entry.endDate)) {
    if (!isWeekday(day)) continue;
    if (entry.status !== LeaveStatus.PENDING && entry.status !== LeaveStatus.APPROVED) continue;
    const days = leaveIndex.get(userId) ?? new Set<string>();
    days.add(day);
    leaveIndex.set(userId, days);
  }
}

// ---------------------------------------------------------------------------
// Chat text
// ---------------------------------------------------------------------------

const OPENERS = ["Morning all! ", "Quick update: ", "Heads up, ", "FYI: ", "", "", "", ""];
const STATUSES = [
  "looking good",
  "on track for Friday",
  "a bit behind, I'll follow up tomorrow",
  "done and reviewed",
  "waiting on sign-off",
  "almost ready for review",
  "in much better shape after today's changes",
  "going to slip a few days",
];
const QUESTIONS = [
  "can someone take a look when you get a sec?",
  "do we still need finance to sign off?",
  "who is covering this on Thursday?",
  "should we push it to next week?",
  "is anyone free to pair on it this afternoon?",
];
const REPLIES = [
  "On it.",
  "Sounds good to me.",
  "Works for me 👍",
  "Can take it, will update by end of day.",
  "Agreed, let's do that.",
  "Give me 10 minutes.",
  "Thanks for flagging!",
  "Looping in the right people.",
  "+1",
  "Done ✅",
  "Let's sync after lunch.",
  "Good catch, thanks!",
  "Ha, yes. Same here.",
  "I'll grab the doc and share it.",
  "Nice work everyone 🙌",
];

const TOPICS: Record<string, string[]> = {
  eng: ["the payments service migration", "the mobile release train", "flaky integration tests", "the Postgres upgrade", "the feature flag rollout", "the on-call handoff notes"],
  product: ["the Q1 roadmap", "Atlas beta feedback", "the onboarding redesign", "the usability test results", "next sprint priorities", "the pricing page copy"],
  it: ["the VPN cutover", "laptop refresh batch 3", "the SSO rollout", "the firewall migration", "the printer queue on floor 2", "the new password policy"],
  hr: ["the Q4 open roles", "benefits enrolment (closes Friday)", "the parental leave policy update", "the backend interview panel", "the holiday calendar", "the new starter onboarding pack"],
  finance: ["month-end close", "the vendor invoices", "the budget reforecast", "the expense policy reminder", "the audit prep binder", "the Q3 revenue recognition"],
  sales: ["the Northwind renewal", "the Q4 pipeline review", "the Brightline demo", "discount approvals", "the SDR call block", "the enterprise quote template"],
  marketing: ["the Atlas launch page", "webinar registrations", "the blog calendar", "the brand refresh assets", "the press kit draft", "the paid social budget"],
  ops: ["the office move on the 30th", "badge access for new starters", "the lunch & learn room booking", "the kitchen restock", "the fire drill on Thursday", "the desk booking rules"],
  atlas: ["the Atlas beta sign-ups", "the Atlas API freeze", "the Atlas launch checklist", "the Atlas pricing sheet", "the Atlas press briefing"],
  leadership: ["the Q4 hiring plan", "the offsite agenda", "the budget envelope", "the OKR check-in", "the customer escalation list"],
  hiring: ["the backend candidate shortlist", "the take-home exercise", "the panel debrief", "the offer for the senior engineer", "the interview scorecards"],
  office: ["the floor plan v3", "the moving company quote", "IT cabling on level 4", "the seating chart", "the move timeline"],
  incident: ["the VPN outage", "the suspicious login alerts", "the postmortem doc", "the customer comms draft", "the credential rotation"],
  random: ["the new coffee machine", "the team lunch on Friday", "that podcast everyone is talking about", "the office plant situation", "the weekend hike plans"],
  announce: ["the company all-hands", "the new benefits portal", "the holiday schedule", "the security training deadline", "the office move"],
};

function sentence(topic: string): string {
  const forms = [
    () => `${pick(OPENERS)}${topic} is ${pick(STATUSES)}.`,
    () => `Anyone able to look at ${topic} today?`,
    () => pick(REPLIES),
    () => `Quick one on ${topic}: ${pick(QUESTIONS)}`,
    () => `${pick(REPLIES)} Let's pick up ${topic} at stand-up.`,
    () => `Shared the notes for ${topic} in the drive, take a look when you can.`,
    () => pick(["👍", "🙌", "🎉", "😂", "☕", "🚀"]),
    () => `Did we decide on ${topic}? I lost track after the last call.`,
    () => `${topic[0].toUpperCase()}${topic.slice(1)} is much better after today's changes.`,
    () => `Can we get ${topic} on the agenda for Thursday?`,
  ];
  return pick(forms)();
}

function skewedRecentTimes(n: number, from: Date, to: Date): Date[] {
  const span = to.getTime() - from.getTime();
  return Array.from({ length: n })
    .map(() => new Date(to.getTime() - span * Math.pow(rand(), 1.7)))
    .sort((a, b) => a.getTime() - b.getTime());
}

// SVG pictures used as chat attachments (small, offline-friendly data URIs)
function pictureDataUri(title: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="${color}"/><rect x="28" y="28" width="584" height="344" rx="24" fill="#FFF6E6" stroke="#1E1B2E" stroke-width="6"/><text x="56" y="120" font-family="sans-serif" font-size="44" font-weight="700" fill="#1E1B2E">${title}</text><rect x="56" y="160" width="300" height="18" rx="9" fill="#1E1B2E" opacity="0.2"/><rect x="56" y="192" width="420" height="18" rx="9" fill="#1E1B2E" opacity="0.2"/><rect x="56" y="224" width="250" height="18" rx="9" fill="#1E1B2E" opacity="0.2"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Seeding steps
// ---------------------------------------------------------------------------

async function clearAll() {
  await prisma.documentPermission.deleteMany();
  await prisma.document.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.personalEntry.deleteMany();
  await prisma.eventAttendee.deleteMany();
  await prisma.event.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversationMember.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
}

async function createPeople(): Promise<Record<DeptKey, string>> {
  const deptIds = {} as Record<DeptKey, string>;
  for (const d of DEPARTMENTS) {
    const created = await prisma.department.create({ data: { name: d.name } });
    deptIds[d.key] = created.id;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const spec of PEOPLE) {
    const created = await prisma.user.create({
      data: {
        email: spec.email,
        name: spec.name,
        jobTitle: spec.title,
        passwordHash,
        role: spec.role,
        departmentId: deptIds[spec.dept],
      },
    });
    U[spec.key] = { id: created.id, name: spec.name, dept: spec.dept, role: spec.role, spec };
  }
  return deptIds;
}

function planBreaks() {
  const lunchWindows = [
    ["12:00", "13:00"],
    ["12:30", "13:30"],
    ["13:00", "14:00"],
  ];
  const lunchFor = Object.fromEntries(
    PEOPLE.map((p) => [p.key, pick(lunchWindows)])
  ) as Record<string, string[]>;
  const coffeeFor = Object.fromEntries(
    PEOPLE.map((p) => [p.key, chance(0.6) ? pick([["10:30", "10:45"], ["15:30", "15:45"]]) : null])
  ) as Record<string, string[] | null>;

  for (const day of WORKDAYS) {
    for (const p of PEOPLE) {
      const userId = U[p.key].id;
      const [ls, le] = lunchFor[p.key];
      const lunchStart = at(day, ls);
      const lunchEnd = at(day, le);
      plan.entries.push({ userId, category: EntryCategory.LUNCH, title: "Lunch", notes: "", startTime: lunchStart, endTime: lunchEnd });
      indexInterval(breakIndex, userId, { start: lunchStart, end: lunchEnd });

      const coffee = coffeeFor[p.key];
      if (coffee) {
        const cs = at(day, coffee[0]);
        const ce = at(day, coffee[1]);
        plan.entries.push({ userId, category: EntryCategory.COFFEE, title: "Coffee break", notes: "", startTime: cs, endTime: ce });
        indexInterval(breakIndex, userId, { start: cs, end: ce });
      }
    }
  }
}

function planLeave() {
  const past = (n: number) => addDays(NEXT_MONDAY, -7 + n);
  const fromNext = (n: number) => addDays(NEXT_MONDAY, n);

  addLeave({ user: "liam", type: LeaveType.ANNUAL, status: LeaveStatus.APPROVED, startDate: fromNext(0), endDate: fromNext(1), reason: "Long weekend away with family", decidedBy: "daniel" });
  addLeave({ user: "priya", type: LeaveType.ANNUAL, status: LeaveStatus.APPROVED, startDate: fromNext(3), endDate: fromNext(4), reason: "Cousin's wedding in Pune", decidedBy: "marcus" });
  addLeave({ user: "alex", type: LeaveType.ANNUAL, status: LeaveStatus.PENDING, startDate: fromNext(7), endDate: fromNext(9), reason: "Family trip. Flights are booked and I'll hand over the on-call rota before I go." });
  addLeave({ user: "jordan", type: LeaveType.PERSONAL, status: LeaveStatus.PENDING, startDate: fromNext(2), endDate: fromNext(2), reason: "Medical appointment in the morning, back by lunch." });
  addLeave({ user: "kenji", type: LeaveType.PERSONAL, status: LeaveStatus.PENDING, startDate: fromNext(9), endDate: fromNext(9), reason: "Moving apartments, need the day for the movers." });
  addLeave({ user: "victor", type: LeaveType.ANNUAL, status: LeaveStatus.REJECTED, startDate: fromNext(1), endDate: fromNext(2), reason: "Holiday to visit my parents.", decidedBy: "elena", decisionNote: "We're running final-round interviews that week. Could you move it to the 26th?" });
  addLeave({ user: "ben", type: LeaveType.ANNUAL, status: LeaveStatus.CANCELLED, startDate: fromNext(10), endDate: fromNext(11), reason: "Visiting family in Lisbon." });
  addLeave({ user: "daniel", type: LeaveType.ANNUAL, status: LeaveStatus.APPROVED, startDate: fromNext(8), endDate: fromNext(10), reason: "Holiday with family", decidedBy: "sarah", decisionNote: "Enjoy it. Please leave Liam on point for the release." });
  addLeave({ user: "gabriela", type: LeaveType.PERSONAL, status: LeaveStatus.APPROVED, startDate: fromNext(4), endDate: fromNext(4), reason: "School sports day", decidedBy: "olivia" });
  addLeave({ user: "samir", type: LeaveType.ANNUAL, status: LeaveStatus.APPROVED, startDate: past(3), endDate: past(4), reason: "Family visit", decidedBy: "rachel" });
  addLeave({ user: "zara", type: LeaveType.SICK, status: LeaveStatus.APPROVED, startDate: past(4), endDate: past(4), reason: "Flu, stayed home", decidedBy: "olivia" });
}

function planStandupsAndSyncs() {
  for (const day of WORKDAYS) {
    for (const dept of DEPARTMENTS) {
      placeMeeting({
        organizer: managerOf[dept.key],
        title: `${dept.name} stand-up`,
        description: "Yesterday, today and blockers. Keep it to 15 minutes.",
        day,
        times: ["09:30"],
        minutes: 15,
        attendees: deptMembers(dept.key),
      });
    }
  }

  for (const day of WORKDAYS.filter((d) => weekdayOf(d) === 1)) {
    for (const dept of DEPARTMENTS) {
      placeMeeting({
        organizer: managerOf[dept.key],
        title: `${dept.name} weekly sync`,
        description: "Priorities for the week, hiring updates and anything that needs a decision.",
        day,
        times: ["11:00", "10:00", "14:00"],
        minutes: 45,
        attendees: deptMembers(dept.key),
      });
    }
  }

  const managers = Object.values(managerOf);
  for (const day of WORKDAYS.filter((d) => weekdayOf(d) === 3)) {
    placeMeeting({
      organizer: "sarah",
      title: "Leadership staff meeting",
      description: "Company metrics, cross-team blockers and the decisions we need this week.",
      day,
      times: ["09:00", "09:30"],
      minutes: 60,
      attendees: [...managers],
    });
  }

  placeMeeting({
    organizer: "sarah",
    title: "Company all-hands",
    description: "Quarterly update from the leadership team, followed by Q&A. Recording goes on the intranet.",
    day: addDays(NEXT_MONDAY, 3),
    times: ["16:00"],
    minutes: 60,
    attendees: allKeys(),
  });
}

function planOneOnOnes() {
  for (const dept of DEPARTMENTS) {
    const manager = managerOf[dept.key];
    for (const report of deptMembers(dept.key).filter((k) => k !== manager)) {
      const slots = sample(WORKDAYS, 2);
      for (const day of slots) {
        placeMeeting({
          organizer: manager,
          title: `1:1 · ${U[manager].name.split(" ")[0]} & ${U[report].name.split(" ")[0]}`,
          description: "Career, workload and feedback.",
          day,
          times: ["14:00", "14:30", "16:00", "16:30", "10:00", "11:30"],
          minutes: 30,
          attendees: [report],
        });
      }
    }
  }
}

function planProjectMeetings() {
  const templates: {
    title: string;
    description: string;
    organizer: string;
    pool: string[];
    count: number;
    minutes: number;
  }[] = [
    { title: "Atlas design review", description: "Walk through the Atlas flows and decide on the onboarding variant.", organizer: "nadia", pool: [...deptMembers("product"), "daniel", "liam", "meilin", "hannah", "rachel"], count: 6, minutes: 60 },
    { title: "Atlas launch readiness", description: "Go / no-go checklist for the Atlas beta. Owners, blockers and dates.", organizer: "nadia", pool: ["ethan", "sofia", "daniel", "rachel", "olivia", "ravi", "samir", "ben"], count: 7, minutes: 45 },
    { title: "Vendor security review", description: "Review the SOC 2 report from the new payments vendor.", organizer: "marcus", pool: ["aisha", "alex", "priya", "tomas", "richard"], count: 3, minutes: 60 },
    { title: "Q4 pipeline review", description: "Deal-by-deal review for enterprise and mid-market.", organizer: "olivia", pool: [...deptMembers("sales"), "richard"], count: 4, minutes: 60 },
    { title: "Northwind renewal call", description: "Prep for the renewal call with Northwind's procurement team.", organizer: "olivia", pool: ["ben", "gabriela", "richard", "zara"], count: 3, minutes: 45 },
    { title: "Budget reforecast", description: "Re-cut the Q4 forecast with the latest hiring plan.", organizer: "richard", pool: ["maya", "leo", "ingrid", "elena", "olivia", "daniel"], count: 3, minutes: 60 },
    { title: "Campaign sync", description: "Launch week plan, paid social and the press calendar.", organizer: "rachel", pool: [...deptMembers("marketing"), "nadia"], count: 4, minutes: 30 },
    { title: "Backend candidate panel", description: "Technical panel for the senior backend candidate.", organizer: "daniel", pool: ["ravi", "omar", "meilin", "jonas", "grace"], count: 4, minutes: 60 },
    { title: "Office move walkthrough", description: "Walk the new floor and sign off seating and cabling.", organizer: "tom", pool: ["lucia", "peter", "richard", "elena", "kevin"], count: 2, minutes: 60 },
    { title: "Security incident postmortem", description: "Timeline, root cause and follow-ups for the VPN outage.", organizer: "marcus", pool: ["aisha", "alex", "priya", "tomas", "daniel", "kevin"], count: 2, minutes: 60 },
    { title: "Sprint planning", description: "Pick the sprint goals and confirm capacity.", organizer: "daniel", pool: deptMembers("eng"), count: 3, minutes: 60 },
    { title: "Design critique", description: "Crit the onboarding screens. Bring prototypes, not slides.", organizer: "nadia", pool: ["kenji", "lena", "hannah", "chloe", "ethan"], count: 3, minutes: 45 },
    { title: "Customer escalation: Brightline", description: "Action plan for the Brightline escalation and the SLA credit.", organizer: "gabriela", pool: ["ben", "tomas", "liam", "olivia", "sofia"], count: 2, minutes: 45 },
    { title: "Payroll and benefits Q&A", description: "Open questions from the team about the new benefits portal.", organizer: "elena", pool: [...deptMembers("hr"), ...deptMembers("finance").slice(0, 2), ...deptMembers("ops").slice(0, 2)], count: 2, minutes: 45 },
    { title: "Security awareness training", description: "Mandatory 45-minute session on phishing and password hygiene.", organizer: "aisha", pool: [...allKeys()], count: 2, minutes: 45 },
    { title: "Quarterly OKR check-in", description: "Quick check on each team's key results.", organizer: "sarah", pool: ["nadia", "daniel", "olivia", "rachel", "richard", "marcus", "elena", "tom"], count: 2, minutes: 60 },
  ];

  const upcomingWorkdays = WORKDAYS.filter((d) => d >= TODAY);
  for (const t of templates) {
    for (let i = 0; i < t.count; i++) {
      const day = chance(0.7) ? pick(upcomingWorkdays) : pick(WORKDAYS);
      const attendees = sample(t.pool, Math.min(t.pool.length, 3 + Math.floor(rand() * 5)));
      placeMeeting({
        organizer: t.organizer,
        title: t.title,
        description: t.description,
        day,
        times: shuffled(["09:00", "09:30", "10:00", "10:30", "11:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"]),
        minutes: t.minutes,
        attendees,
      });
    }
  }
}

function planStoryline() {
  // Storyline meetings must land exactly where they are written, so a failure here is a bug in the seed.
  const mustPlace = (opts: Parameters<typeof placeMeeting>[0]) => {
    if (!placeMeeting(opts)) {
      throw new Error(`Storyline meeting could not be placed: ${opts.title}`);
    }
  };

  // Monday: Alex is double-booked between Benefits (2 PM) and the IT security sync (2:30 PM).
  mustPlace({
    organizer: "jordan",
    title: "Benefits onboarding check-in",
    description: "Walk the new IT hires through health and retirement benefits.",
    day: NEXT_MONDAY,
    times: ["14:00"],
    minutes: 60,
    attendees: ["alex"],
    statusOverrides: { alex: { status: AttendeeStatus.ACCEPTED } },
  });
  mustPlace({
    organizer: "marcus",
    title: "IT department security sync",
    description: "Mandatory sync on the SSO rollout and the new password policy. Alex's notes are needed for the audit.",
    day: NEXT_MONDAY,
    times: ["14:30"],
    minutes: 60,
    attendees: deptMembers("it"),
    statusOverrides: {
      alex: {
        status: AttendeeStatus.EXCUSE_PENDING,
        excuseReason: "Hey Marcus, I'm in the Benefits onboarding from 2 to 3 and can't move it. Could I catch the recording for the first part of this one?",
        respondedAt: addMinutes(at(NEXT_MONDAY, "09:15"), 0),
      },
    },
  });

  // Tuesday: Priya has a dentist appointment on top of the firewall review. Marcus allows it.
  mustPlace({
    organizer: "marcus",
    title: "Firewall cutover review",
    description: "Change plan for the Thursday cutover. Review the rollback steps.",
    day: addDays(NEXT_MONDAY, 1),
    times: ["09:00"],
    minutes: 60,
    attendees: ["priya", "aisha"],
    statusOverrides: {
      priya: {
        status: AttendeeStatus.EXCUSED,
        excuseReason: "I have a dentist appointment booked for this slot, can I skip and read the change notes?",
        organizerReply: "Approved, dentist first. Please send over the rollback runbook before Thursday.",
        respondedAt: addMinutes(at(addDays(NEXT_MONDAY, 1), "09:00"), 0),
      },
    },
  });
  plan.entries.push({
    userId: U.priya.id,
    category: EntryCategory.ERRAND,
    title: "Dentist appointment",
    notes: "Booked a month ago.",
    startTime: at(addDays(NEXT_MONDAY, 1), "09:30"),
    endTime: at(addDays(NEXT_MONDAY, 1), "10:30"),
  });

  // Wednesday: Ravi's focus block overlaps the backend release call. Daniel refuses the excuse.
  mustPlace({
    organizer: "daniel",
    title: "Release go/no-go",
    description: "Final sign-off on the payments release.",
    day: addDays(NEXT_MONDAY, 2),
    times: ["14:00"],
    minutes: 60,
    attendees: ["ravi", "omar", "tomas"],
    statusOverrides: {
      ravi: {
        status: AttendeeStatus.EXCUSE_DENIED,
        excuseReason: "I've got a focus block on the API design from 2 o'clock. Could I skip the first half?",
        organizerReply: "We need you on this call. Please move the focus block, the release depends on your sign-off.",
        respondedAt: addMinutes(at(addDays(NEXT_MONDAY, 2), "10:00"), 0),
      },
    },
  });
  plan.entries.push({
    userId: U.ravi.id,
    category: EntryCategory.FOCUS,
    title: "Focus: API design for payments v2",
    notes: "Please don't book over this one.",
    startTime: at(addDays(NEXT_MONDAY, 2), "14:00"),
    endTime: at(addDays(NEXT_MONDAY, 2), "16:00"),
  });
}

function planActivities() {
  const focusTitles = ["Focus: roadmap draft", "Focus: API design", "Focus: budget model", "Focus: campaign copy", "Focus: candidate scorecards", "Focus: forecast update"];
  const taskTitles = ["Review expense claims", "Approve purchase orders", "Update the onboarding doc", "Send the weekly report", "Inbox zero"];
  const trainingTitles = ["Security awareness course", "Leadership skills (online)", "Excel for finance", "GDPR refresher", "First aid recertification"];
  const errandTitles = ["Dentist appointment", "Bank visit", "Car service", "Parcel pickup", "School pickup"];
  const startSlots = ["09:00", "09:30", "10:00", "11:00", "13:30", "14:00", "14:30", "15:00", "16:00"];

  for (const day of WORKDAYS) {
    for (const p of PEOPLE) {
      if (onLeave(U[p.key].id, day)) continue;
      if (!chance(0.45)) continue;
      const roll = rand();
      const category: EntryCategory =
        roll < 0.45 ? EntryCategory.FOCUS : roll < 0.7 ? EntryCategory.TASK : roll < 0.85 ? EntryCategory.TRAINING : EntryCategory.ERRAND;
      const minutes = category === EntryCategory.FOCUS ? 90 : category === EntryCategory.TASK ? 30 : category === EntryCategory.TRAINING ? 60 : 60;
      const title =
        category === EntryCategory.FOCUS ? pick(focusTitles) :
        category === EntryCategory.TASK ? pick(taskTitles) :
        category === EntryCategory.TRAINING ? pick(trainingTitles) : pick(errandTitles);

      const start = at(day, pick(startSlots));
      const end = addMinutes(start, minutes);
      const userId = U[p.key].id;
      if (onBreak(userId, start, end) || hasOwnEntry(userId, start, end)) continue;

      plan.entries.push({ userId, category, title, notes: category === EntryCategory.ERRAND ? "Personal, not for sharing." : "", startTime: start, endTime: end });
      indexInterval(entryIndex, userId, { start, end });
    }
  }
}

function markConflicts(events: PlannedEvent[]) {
  const activities = plan.entries.filter((e) => e.category !== EntryCategory.LUNCH && e.category !== EntryCategory.COFFEE && e.category !== EntryCategory.BREAK);

  for (const event of events) {
    for (const attendee of event.attendees) {
      const otherMeeting = events.some(
        (other) =>
          other !== event &&
          other.attendees.some((a) => a.userId === attendee.userId && a.status !== AttendeeStatus.EXCUSED) &&
          overlaps(event.startTime, event.endTime, other.startTime, other.endTime)
      );
      const activity = activities.some(
        (a) => a.userId === attendee.userId && overlaps(event.startTime, event.endTime, a.startTime, a.endTime)
      );
      attendee.hasConflict = otherMeeting || activity;
    }
  }
}

async function writeCalendar() {
  markConflicts(plan.events);

  for (const ev of plan.events) {
    await prisma.event.create({
      data: {
        organizerId: ev.organizerId,
        title: ev.title,
        description: ev.description,
        startTime: ev.startTime,
        endTime: ev.endTime,
        createdAt: ev.createdAt,
        attendees: {
          create: ev.attendees.map((a) => ({
            userId: a.userId,
            status: a.status,
            hasConflict: a.hasConflict,
            excuseReason: a.excuseReason ?? null,
            organizerReply: a.organizerReply ?? null,
            respondedAt: a.respondedAt ?? null,
          })),
        },
      },
    });
  }

  await prisma.personalEntry.createMany({ data: plan.entries });
  await prisma.leaveRequest.createMany({
    data: plan.leaves.map((leave) => ({
      ...leave,
      startDate: keyToDbDate(leave.startDate),
      endDate: keyToDbDate(leave.endDate),
    })),
  });
}

async function seedDocuments() {
  const docs: {
    owner: string;
    title: string;
    content: string;
    permissions: { user: string; level: DocAccessLevel }[];
  }[] = [
    {
      owner: "nadia",
      title: "Q4 Product Roadmap",
      content: `# Q4 Product Roadmap\n\nOwner: Nadia Kowalski\nLast reviewed: this week\n\n## Themes\n- Make onboarding under five minutes for new teams\n- Ship Atlas to general availability\n- Fix the billing edge cases customers keep hitting\n\n## Bets\n1. Atlas beta to GA (Ethan, Daniel's team)\n2. Guided setup wizard (Sofia, Hannah)\n3. Usage-based pricing experiment (Sofia, Richard)\n\n## Not doing this quarter\n- Native desktop client\n- Multi-region failover (planned for Q1)\n`,
      permissions: [
        { user: "ethan", level: DocAccessLevel.EDITOR },
        { user: "sofia", level: DocAccessLevel.EDITOR },
        { user: "daniel", level: DocAccessLevel.VIEWER },
        { user: "richard", level: DocAccessLevel.VIEWER },
        { user: "olivia", level: DocAccessLevel.VIEWER },
      ],
    },
    {
      owner: "ethan",
      title: "Atlas Launch Checklist",
      content: `# Atlas Launch Checklist\n\n## Two weeks out\n- [ ] Pricing page copy approved (Rachel)\n- [x] Beta cohort list frozen (Ethan)\n- [ ] Press kit final review (Samir)\n\n## One week out\n- [ ] Support macros written (Gabriela)\n- [ ] Status page tested (Tomás)\n- [ ] Sales enablement deck (Ben, Zara)\n\n## Launch day\n- [ ] Feature flag on for 10% of accounts\n- [ ] Customer email scheduled\n- [ ] War room channel open\n`,
      permissions: [
        { user: "nadia", level: DocAccessLevel.EDITOR },
        { user: "rachel", level: DocAccessLevel.EDITOR },
        { user: "samir", level: DocAccessLevel.EDITOR },
        { user: "liam", level: DocAccessLevel.VIEWER },
        { user: "ben", level: DocAccessLevel.VIEWER },
      ],
    },
    {
      owner: "marcus",
      title: "Q4 IT & HR Incident Playbook",
      content: `# Q4 IT & HR Incident Playbook\n\nThis shared document is edited live by everyone on the response team.\n\n## When a laptop is lost or stolen\n1. Lock the device from the admin console\n2. Open a ticket in the service desk queue\n3. Notify HR within the hour if the device held employee data\n\n## When someone reports a phishing email\n- Do not click links or open attachments\n- Forward the email to security@syncro.io\n- Aisha triages within two hours during business hours\n\n## Post-incident\n- Write the timeline within 48 hours\n- Schedule a blameless review\n`,
      permissions: [
        { user: "alex", level: DocAccessLevel.EDITOR },
        { user: "priya", level: DocAccessLevel.EDITOR },
        { user: "aisha", level: DocAccessLevel.EDITOR },
        { user: "jordan", level: DocAccessLevel.VIEWER },
      ],
    },
    {
      owner: "elena",
      title: "Employee Handbook 2026 (draft)",
      content: `# Employee Handbook 2026 (draft)\n\n## Working hours\nCore hours are 10:00 to 16:00 in the company timezone. Everything else is flexible.\n\n## Leave\n- Annual leave is 20 working days a year\n- Request leave at least one working day in advance\n- Managers approve leave for their own department; admins approve managers\n\n## Breaks\n- Take a lunch break every day\n- Put your lunch and coffee breaks in your calendar so nobody books over them\n\n## Benefits\n- Health cover from day one\n- Learning budget of 1,000 per year\n`,
      permissions: [
        { user: "jordan", level: DocAccessLevel.EDITOR },
        { user: "victor", level: DocAccessLevel.EDITOR },
        { user: "grace", level: DocAccessLevel.VIEWER },
        { user: "lucia", level: DocAccessLevel.VIEWER },
      ],
    },
    {
      owner: "daniel",
      title: "Engineering On-call Runbook",
      content: `# Engineering On-call Runbook\n\n## Rotation\nOne primary and one secondary each week. Handover happens Monday at 11:00 in the weekly sync.\n\n## Paging rules\n- SEV1: page primary and the incident manager immediately\n- SEV2: page primary, respond within 30 minutes\n\n## Checks before you sleep\n- Queue depth under 500\n- Error budget on the payments API above 40%\n- Backups verified for the last 24 hours\n`,
      permissions: [
        { user: "liam", level: DocAccessLevel.EDITOR },
        { user: "tomas", level: DocAccessLevel.EDITOR },
        { user: "ravi", level: DocAccessLevel.EDITOR },
        { user: "omar", level: DocAccessLevel.VIEWER },
        { user: "meilin", level: DocAccessLevel.VIEWER },
      ],
    },
    {
      owner: "olivia",
      title: "Enterprise Sales Playbook",
      content: `# Enterprise Sales Playbook\n\n## Discovery questions\n- Who signs, who uses, who blocks?\n- What does the renewal look like in 12 months?\n- Which integrations are non-negotiable?\n\n## Discounts\n- Up to 10% needs no approval\n- 10 to 20% needs Olivia\n- Above 20% needs Richard and Sarah\n\n## Security review\nSend the SOC 2 report and the data processing agreement in the first call.\n`,
      permissions: [
        { user: "ben", level: DocAccessLevel.EDITOR },
        { user: "fatima", level: DocAccessLevel.EDITOR },
        { user: "zara", level: DocAccessLevel.EDITOR },
        { user: "noah", level: DocAccessLevel.VIEWER },
        { user: "hugo", level: DocAccessLevel.VIEWER },
        { user: "gabriela", level: DocAccessLevel.VIEWER },
      ],
    },
    {
      owner: "tom",
      title: "Office Move Plan: Level 4",
      content: `# Office Move Plan: Level 4\n\n## Timeline\n- Mon 30th: furniture delivered 08:00\n- Tue 31st: IT cabling and desk setup\n- Wed 1st: teams move in, badges reissued\n\n## Seating\nEngineering and Product sit together on the north side. Finance stays near the kitchen.\n\n## Open items\n- Confirm meeting room names with Marketing\n- Book the moving company for the Friday before\n`,
      permissions: [
        { user: "lucia", level: DocAccessLevel.EDITOR },
        { user: "peter", level: DocAccessLevel.EDITOR },
        { user: "richard", level: DocAccessLevel.VIEWER },
        { user: "elena", level: DocAccessLevel.VIEWER },
      ],
    },
    {
      owner: "richard",
      title: "Finance Month-End Checklist",
      content: `# Finance Month-End Checklist\n\n## Working days 1 to 3\n- [ ] Close the AP ledger\n- [ ] Reconcile the corporate cards\n- [ ] Accrue for unbilled vendor invoices\n\n## Working days 4 to 5\n- [ ] Revenue recognition review\n- [ ] Intercompany balances\n- [ ] Flux analysis for variances over 10%\n\n## Sign-off\nRichard reviews the pack on working day 5 before it goes to Sarah.\n`,
      permissions: [
        { user: "maya", level: DocAccessLevel.EDITOR },
        { user: "leo", level: DocAccessLevel.EDITOR },
        { user: "ingrid", level: DocAccessLevel.EDITOR },
      ],
    },
  ];

  for (const doc of docs) {
    const ydoc = new Y.Doc();
    ydoc.getText("content").insert(0, doc.content);
    await prisma.document.create({
      data: {
        ownerId: U[doc.owner].id,
        title: doc.title,
        yjsState: Buffer.from(Y.encodeStateAsUpdate(ydoc)),
        permissions: {
          create: doc.permissions.map((p) => ({ userId: U[p.user].id, accessLevel: p.level })),
        },
      },
    });
  }
  return docs.length;
}

interface ConvSpec {
  name: string | null;
  isGroup: boolean;
  members: string[];
  topic: string;
  count: number;
  scripted?: { sender: string; text: string; ago: number }[];
  media?: { sender: string; caption: string; title: string; color: string; ago: number }[];
}

async function seedChat(): Promise<{ conversations: number; messages: number }> {
  const specs: ConvSpec[] = [
    {
      name: "Company Announcements",
      isGroup: true,
      members: allKeys(),
      topic: "announce",
      count: 60,
      scripted: [
        { sender: "sarah", text: "Welcome to Syncro, everyone! Chat, calendars and shared docs are all in one place now.", ago: 13 },
        { sender: "sarah", text: "Please put your lunch and coffee breaks in your calendar. That way nobody books a meeting over them.", ago: 12 },
        { sender: "elena", text: "Leave requests go in the calendar too. Managers approve them there, and you'll get a heads-up as soon as it's decided.", ago: 11 },
        { sender: "sarah", text: "All-hands is on Thursday at 4 PM. Bring your questions, the Q&A is live.", ago: 2 },
      ],
      media: [{ sender: "tom", caption: "Floor plan for the level 4 move. Shout if your desk is wrong.", title: "Level 4 floor plan", color: "#FFD84D", ago: 4 }],
    },
    {
      name: "Random & Coffee",
      isGroup: true,
      members: sample(allKeys(), 28),
      topic: "random",
      count: 80,
    },
    ...DEPARTMENTS.map<ConvSpec>((d) => ({
      name: d.channel,
      isGroup: true,
      members: [...deptMembers(d.key)],
      topic: d.key,
      count: 90,
      media: d.key === "it" ? [{ sender: "kevin", caption: "The new rack in the server room. Cable tidy-up on Friday.", title: "Server room rack B", color: "#7CC8FF", ago: 6 }] :
        d.key === "marketing" ? [{ sender: "lena", caption: "New banner for the Atlas launch. Feedback please.", title: "Atlas banner v2", color: "#FF7AB2", ago: 3 }] : undefined,
    })),
    {
      name: "Project Atlas Launch",
      isGroup: true,
      members: ["nadia", "ethan", "sofia", "daniel", "liam", "meilin", "ravi", "hannah", "rachel", "samir", "olivia", "ben", "kenji"],
      topic: "atlas",
      count: 140,
    },
    {
      name: "Q4 Leadership",
      isGroup: true,
      members: ["sarah", "nadia", "daniel", "richard", "olivia", "rachel", "marcus", "elena", "tom"],
      topic: "leadership",
      count: 70,
    },
    {
      name: "Backend Hiring Loop",
      isGroup: true,
      members: ["elena", "grace", "daniel", "ravi", "omar", "meilin"],
      topic: "hiring",
      count: 40,
    },
    {
      name: "Office Move Committee",
      isGroup: true,
      members: ["tom", "lucia", "richard", "elena", "peter"],
      topic: "office",
      count: 45,
      media: [{ sender: "peter", caption: "Measured the north wall. Desks fit with room to spare.", title: "North wall measurements", color: "#B99BFF", ago: 5 }],
    },
    {
      name: "Security Incident Room",
      isGroup: true,
      members: ["marcus", "aisha", "alex", "priya", "tomas", "daniel", "kevin"],
      topic: "incident",
      count: 55,
    },
  ];

  const dms: { members: [string, string]; count: number; scripted?: { sender: string; text: string; ago: number }[] }[] = [
    {
      members: ["marcus", "alex"],
      count: 10,
      scripted: [
        { sender: "marcus", text: "Alex, you're down for the IT security sync on Monday at 2:30. Can you make it?", ago: 3 },
        { sender: "alex", text: "I've got Benefits onboarding from 2 to 3 that I can't move. Can I send an excuse request?", ago: 3 },
        { sender: "marcus", text: "Yes, send it through the calendar and I'll take a look. Priya can take notes.", ago: 3 },
        { sender: "alex", text: "Sent. Thanks Marcus, I'll read the notes tonight.", ago: 3 },
      ],
    },
    { members: ["elena", "jordan"], count: 8, scripted: [
      { sender: "elena", text: "Jordan, can you pull the benefits renewal numbers for the Monday onboarding?", ago: 4 },
      { sender: "jordan", text: "On it. I'll share them in the HR folder by tonight.", ago: 4 },
    ] },
    { members: ["liam", "meilin"], count: 12 },
    { members: ["alex", "priya"], count: 10 },
    { members: ["olivia", "ben"], count: 9 },
    { members: ["sarah", "marcus"], count: 6 },
    { members: ["sarah", "olivia"], count: 6 },
    { members: ["jordan", "priya"], count: 5 },
    { members: ["nadia", "ethan"], count: 8 },
    { members: ["sofia", "hannah"], count: 6 },
    { members: ["lena", "samir"], count: 6 },
    { members: ["richard", "maya"], count: 5 },
    { members: ["kevin", "aisha"], count: 6 },
    { members: ["gabriela", "fatima"], count: 5 },
    { members: ["daniel", "ravi"], count: 6 },
    { members: ["tom", "lucia"], count: 5 },
  ];

  let messageCount = 0;
  const convRows: string[] = [];

  const writeConversation = async (
    name: string | null,
    isGroup: boolean,
    members: string[],
    topic: string,
    count: number,
    scripted: { sender: string; text: string; ago: number }[] = [],
    media: { sender: string; caption: string; title: string; color: string; ago: number }[] = []
  ) => {
    const from = addDays(TODAY, -14);
    const fromDate = at(from, "08:30");
    const memberKeys = unique(members);
    const created = await prisma.conversation.create({
      data: {
        name,
        isGroup,
        createdAt: fromDate,
        members: { create: memberKeys.map((m) => ({ userId: U[m].id })) },
      },
    });
    convRows.push(created.id);

    const senderPool = members.length > 0 ? members : ["sarah"];
    const times = skewedRecentTimes(count, fromDate, addMinutes(NOW, -6));
    const rows: {
      conversationId: string;
      senderId: string;
      content: string;
      mediaUrl?: string | null;
      mediaType?: string | null;
      createdAt: Date;
    }[] = [];

    times.forEach((t) => {
      const sender = pick(senderPool);
      if (chance(0.05)) {
        const media = randomMedia(rand);
        rows.push({
          conversationId: created.id,
          senderId: U[sender].id,
          content: chance(0.4) ? sentence(pick(TOPICS[topic] ?? TOPICS.random)) : "",
          mediaUrl: media.url,
          mediaType: "image",
          createdAt: t,
        });
        return;
      }
      rows.push({
        conversationId: created.id,
        senderId: U[sender].id,
        content: sentence(pick(TOPICS[topic] ?? TOPICS.random)),
        createdAt: t,
      });
    });

    for (const line of scripted) {
      rows.push({
        conversationId: created.id,
        senderId: U[line.sender].id,
        content: line.text,
        createdAt: addMinutes(NOW, -line.ago * 24 * 60 + Math.floor(rand() * 240)),
      });
    }

    for (const m of media) {
      rows.push({
        conversationId: created.id,
        senderId: U[m.sender].id,
        content: m.caption,
        mediaUrl: pictureDataUri(m.title, m.color),
        mediaType: "image",
        createdAt: addMinutes(NOW, -m.ago * 24 * 60 + 30),
      });
    }

    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    await prisma.message.createMany({ data: rows });
    messageCount += rows.length;

    // Read state: some memberships are caught up, others have unread messages waiting
    const lastIndex = Math.max(0, rows.length - 1);
    await Promise.all(
      memberKeys.map((m) =>
        prisma.conversationMember.update({
          where: { conversationId_userId: { conversationId: created.id, userId: U[m].id } },
          data: {
            lastReadAt: chance(0.5)
              ? rows[Math.max(0, lastIndex - Math.floor(rand() * 25))].createdAt
              : NOW,
          },
        })
      )
    );
  };

  for (const spec of specs) {
    await writeConversation(spec.name, spec.isGroup, spec.members, spec.topic, spec.count, spec.scripted, spec.media);
  }
  for (const dm of dms) {
    const [a, b] = dm.members;
    await writeConversation(null, false, [a, b], "random", dm.count, dm.scripted);
  }

  return { conversations: convRows.length, messages: messageCount };
}

async function main() {
  console.log(`Seeding Syncro (company timezone: ${TZ}, today: ${TODAY})...`);

  await clearAll();
  await createPeople();

  planBreaks();
  planLeave();
  planStandupsAndSyncs();
  planOneOnOnes();
  planProjectMeetings();
  planStoryline();
  planActivities();
  await writeCalendar();

  const chat = await seedChat();
  const docCount = await seedDocuments();

  const [events, attendees, entries, leaves] = await Promise.all([
    prisma.event.count(),
    prisma.eventAttendee.count(),
    prisma.personalEntry.count(),
    prisma.leaveRequest.count(),
  ]);

  console.log("");
  console.log(`Company: ${PEOPLE.length} people, ${DEPARTMENTS.length} departments`);
  console.log(`Calendar: ${events} meetings (${attendees} invites), ${entries} breaks and activities, ${leaves} leave requests`);
  console.log(`Chat: ${chat.conversations} conversations, ${chat.messages} messages`);
  console.log(`Docs: ${docCount} shared documents`);
  console.log("");
  console.log(`Every account uses the password: ${PASSWORD}`);
  console.log("  Admin:    sarah.admin@syncro.io (Chief Operating Officer)");
  console.log("  Managers: marcus.manager@syncro.io (IT), elena.hr@syncro.io (HR), daniel.okafor@syncro.io (Engineering),");
  console.log("            nadia.kowalski@syncro.io (Product), richard.adler@syncro.io (Finance),");
  console.log("            olivia.grant@syncro.io (Sales), rachel.greene@syncro.io (Marketing), tom.becker@syncro.io (Operations)");
  const employees = PEOPLE.filter((p) => p.role === "EMPLOYEE").length;
  console.log(`  Employees: alex.it@syncro.io, priya.it@syncro.io, jordan.hr@syncro.io, liam.eng@syncro.io, and ${employees - 4} more`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
