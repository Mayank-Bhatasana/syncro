/**
 * Chat simulator
 *
 * Signs in as a few seeded teammates and has them chat for real: they start typing,
 * send messages, post random GIFs and photos, and sometimes type and then delete.
 * Everything goes through the same WebSocket path the web app uses, so the messages,
 * typing indicators and unread counts all show up live in the browser.
 *
 * Start the server first, then run:
 *   npm run simulate
 *
 * Optional environment variables:
 *   SIM_USERS=10           how many teammates to simulate
 *   SIM_MIN_GAP_MS=6000    shortest pause between one person's actions
 *   SIM_MAX_GAP_MS=20000   longest pause between one person's actions
 *   API_URL=http://localhost:4000
 */

import { io, type Socket } from "socket.io-client";
import { randomMedia, type UserDTO, type ConversationDTO } from "@syncro/shared";

const API_URL = process.env.API_URL || "http://localhost:4000";
const PASSWORD = process.env.SIM_PASSWORD || "password123";
const USER_COUNT = Number(process.env.SIM_USERS || 10);
const MIN_GAP_MS = Number(process.env.SIM_MIN_GAP_MS || 6000);
const MAX_GAP_MS = Number(process.env.SIM_MAX_GAP_MS || 20000);

// ---------------------------------------------------------------------------
// Things people type
// ---------------------------------------------------------------------------

const GREETINGS = ["morning!", "hey all", "quick one", "ok so", "random thought:", "fyi", "heads up", "lol", "wait", "hmm"];
const OFFICE = [
  "is the deck ready for thursday?",
  "can someone grab the good coffee beans",
  "the printer on floor 2 is haunted again",
  "I'm 10 minutes late to the sync, start without me",
  "does anyone know where the spare laptop charger went",
  "who booked the big room for 3pm??",
  "the dashboard numbers look way too good, double check the join",
  "ok lunch is at 1 today, not 12:30",
  "shipping the fix after standup",
  "I have notes from the call if anyone missed it",
  "is it just me or is the wifi slow today",
  "can we move the retro to friday",
  "send me the invoice and I'll approve it tonight",
  "that customer email was perfect, thanks",
  "I'm blocked on legal, will update later",
  "anyone up for a walk at 4?",
];
const WORDS = [
  "banana", "turbo", "pickle", "moonlight", "spreadsheet", "dragon", "cheese", "sock", "quantum", "pancake",
  "thunder", "avocado", "ninja", "waffle", "tuesday", "orbit", "potato", "karaoke", "glitter", "penguin",
  "laser", "biscuit", "saturn", "meeting", "tornado", "velcro", "mango", "unicorn", "disco", "rocket",
  "marshmallow", "gravy", "jellyfish", "kayak", "lemon", "zeppelin", "maple", "snorkel", "teapot", "vortex",
  "pixel", "cactus", "bagel", "yodel", "parrot", "mustard", "sunrise", "cupcake", "hamster", "thimble",
];
const EMOJI = ["😂", "🙌", "🔥", "👀", "💀", "🤔", "🫠", "✨", "🎉", "☕", "🍕", "🚀", "🐸", "🤡", "😭", "👏"];
const MASH = ["asdkjfh", "hjkl;ghh", "qwerty", "zzzzzz", "ddddd", "kjhsdf", "poiuyt", "aaaaaa", "fjdkslaj", "ghghgh"];
const REACTIONS = ["+1", "lol", "omg", "yes!!", "no way", "same", "agreed", "haha", "brb coffee", "👍", "nice", "ok"];
const CAPTIONS = [
  "look at this",
  "me on monday",
  "the vibe in here today",
  "for the standup",
  "send help 😂",
  "this is the one",
  "reaction to the last message",
  "thoughts?",
  "found this during lunch",
  "",
  "",
];

const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
const chance = (p: number) => Math.random() < p;
const between = (min: number, max: number) => min + Math.random() * (max - min);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function randomWords(count: number): string {
  return Array.from({ length: count }, () => pick(WORDS)).join(" ");
}

function randomMessage(): string {
  const roll = Math.random();
  if (roll < 0.35) return `${pick(GREETINGS)} ${pick(OFFICE)}`;
  if (roll < 0.55) return randomWords(Math.floor(between(3, 9)));
  if (roll < 0.7) return pick(MASH) + (chance(0.5) ? ` ${pick(MASH)}` : "");
  if (roll < 0.82) return pick(EMOJI).repeat(Math.floor(between(1, 5)));
  return pick(REACTIONS);
}

function typingTimeFor(text: string): number {
  return Math.min(7000, Math.max(1500, text.length * 45));
}

// ---------------------------------------------------------------------------
// Simulated teammates
// ---------------------------------------------------------------------------

interface SimPerson {
  user: UserDTO;
  token: string;
  socket: Socket;
  conversations: ConversationDTO[];
}

async function signIn(email: string): Promise<{ token: string; user: UserDTO }> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email} (${res.status})`);
  return (await res.json()) as { token: string; user: UserDTO };
}

async function loadConversations(token: string): Promise<ConversationDTO[]> {
  const res = await fetch(`${API_URL}/api/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Could not load conversations (${res.status})`);
  const data = (await res.json()) as { conversations: ConversationDTO[] };
  return data.conversations;
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(API_URL, {
      auth: { token },
      transports: ["websocket"],
      reconnection: true,
    });
    const timer = setTimeout(() => reject(new Error("Socket connection timed out")), 8000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function conversationTitle(conv: ConversationDTO, me: UserDTO): string {
  if (conv.isGroup && conv.name) return conv.name;
  const other = conv.members.find((m) => m.id !== me.id);
  return other ? other.name : "Direct message";
}

const stamp = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function log(person: SimPerson, conv: ConversationDTO, what: string) {
  console.log(`${stamp()}  ${person.user.name.padEnd(18)} · ${conversationTitle(conv, person.user).padEnd(28).slice(0, 28)} ${what}`);
}

function setTyping(person: SimPerson, conv: ConversationDTO, isTyping: boolean) {
  person.socket.emit("typing", { conversationId: conv.id, isTyping });
}

function sendMessage(
  person: SimPerson,
  conv: ConversationDTO,
  payload: { content: string; mediaUrl: string | null; mediaType: "image" | null }
): Promise<void> {
  return new Promise((resolve) => {
    person.socket.emit(
      "message:send",
      { conversationId: conv.id, ...payload },
      (ack: { error?: string }) => {
        if (ack?.error) log(person, conv, `(failed: ${ack.error})`);
        resolve();
      }
    );
  });
}

async function act(person: SimPerson) {
  const conv = pick(person.conversations);
  const roll = Math.random();

  if (roll < 0.12) {
    // Start typing, think better of it, and delete
    setTyping(person, conv, true);
    await sleep(between(2000, 4500));
    setTyping(person, conv, false);
    log(person, conv, "…typed something and deleted it");
    return;
  }

  if (roll < 0.24) {
    // A random GIF or photo, sometimes with a caption
    const media = randomMedia();
    setTyping(person, conv, true);
    await sleep(between(800, 1500));
    setTyping(person, conv, false);
    const caption = chance(0.5) ? pick(CAPTIONS) : "";
    await sendMessage(person, conv, { content: caption, mediaUrl: media.url, mediaType: "image" });
    log(person, conv, `sent a ${media.kind === "gif" ? "GIF" : "photo"}${caption ? `: ${caption}` : ""}`);
    return;
  }

  const text = randomMessage();
  setTyping(person, conv, true);
  await sleep(typingTimeFor(text));
  setTyping(person, conv, false);
  await sendMessage(person, conv, { content: text, mediaUrl: null, mediaType: null });
  log(person, conv, text);
}

async function runPerson(person: SimPerson, stop: () => boolean) {
  while (!stop()) {
    await sleep(between(MIN_GAP_MS, MAX_GAP_MS));
    if (stop()) break;
    if (person.conversations.length === 0) continue;
    try {
      await act(person);
    } catch (err) {
      console.error(`${stamp()}  ${person.user.name}: ${(err as Error).message}`);
    }
  }
}

async function main() {
  console.log(`Chat simulator → ${API_URL}`);

  const demo = await fetch(`${API_URL}/api/auth/demo-accounts`).then((r) => {
    if (!r.ok) throw new Error(`Is the server running at ${API_URL}?`);
    return r.json() as Promise<{ users: UserDTO[] }>;
  });

  const candidates = [...demo.users].sort(() => Math.random() - 0.5).slice(0, USER_COUNT);
  const people: SimPerson[] = [];

  for (const candidate of candidates) {
    try {
      const { token, user } = await signIn(candidate.email);
      const conversations = await loadConversations(token);
      if (conversations.length === 0) continue;
      const socket = await connect(token);
      people.push({ user, token, socket, conversations });
      console.log(`  ${user.name} is in ${conversations.length} conversations`);
    } catch (err) {
      console.error(`  skipped ${candidate.name}: ${(err as Error).message}`);
    }
  }

  if (people.length === 0) {
    console.error("No one could sign in. Run the seed first: npm run db:seed");
    process.exit(1);
  }

  console.log(`\n${people.length} teammates are chatting. Press Ctrl+C to stop.\n`);

  let stopping = false;
  const stop = () => stopping;
  const loops = people.map((p) => runPerson(p, stop));

  const shutdown = () => {
    stopping = true;
    for (const p of people) p.socket.disconnect();
    console.log("\nSimulator stopped.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await Promise.all(loops);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
