export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 20;
export const HOUR_PX = 56;

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Local calendar date as "YYYY-MM-DD". */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function mondayOf(date: Date): Date {
  const d = startOfDay(date);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

export function weekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function isWeekendDate(date: Date): boolean {
  const wd = date.getDay();
  return wd === 0 || wd === 6;
}

export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function formatClock(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDayShort(date: Date): string {
  return date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

export function formatDayLong(date: Date): string {
  return date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

export function formatDateRange(startKey: string, endKey: string): string {
  const start = fromDayKey(startKey);
  const end = fromDayKey(endKey);
  if (startKey === endKey) {
    return start.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  }
  return `${start.toLocaleDateString([], { day: "numeric", month: "short" })} – ${end.toLocaleDateString([], { day: "numeric", month: "short" })}`;
}

export function weekLabel(monday: Date): string {
  const sunday = addDays(monday, 6);
  const monthOf = (d: Date) => d.toLocaleDateString([], { month: "short" });
  const left = `${monthOf(monday)} ${monday.getDate()}`;
  const right =
    monday.getMonth() === sunday.getMonth()
      ? `${sunday.getDate()}`
      : `${monthOf(sunday)} ${sunday.getDate()}`;
  return `${left} – ${right}, ${sunday.getFullYear()}`;
}

/** Working days (Mon-Fri) between two local day keys, inclusive. */
export function workingDaysBetween(startKey: string, endKey: string): number {
  if (!startKey || !endKey || endKey < startKey) return 0;
  let count = 0;
  let cursor = fromDayKey(startKey);
  const end = fromDayKey(endKey);
  while (cursor <= end) {
    if (!isWeekendDate(cursor)) count++;
    cursor = addDays(cursor, 1);
  }
  return count;
}

export interface LaneInfo {
  lane: number;
  lanes: number;
}

/**
 * Places overlapping items side by side. Items that overlap form a cluster, and each
 * cluster is split only as wide as it needs to be, so an isolated meeting keeps the full column.
 */
export function layoutLanes(items: { id: string; start: number; end: number }[]): Record<string, LaneInfo> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const result: Record<string, LaneInfo> = {};
  let cluster: string[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const id of cluster) {
      result[id] = { ...result[id], lanes };
    }
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (item.start >= clusterEnd) flush();

    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }

    result[item.id] = { lane, lanes: 1 };
    cluster.push(item.id);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return result;
}
