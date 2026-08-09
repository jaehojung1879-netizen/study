export const DAY_MS = 24 * 60 * 60 * 1000;

/** Local-time YYYY-MM-DD. The study day boundary is the user's midnight. */
export function dateKey(at: number | Date = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function startOfDay(at: number | Date = Date.now()): number {
  const d = at instanceof Date ? new Date(at) : new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(at: number | Date = Date.now()): number {
  return startOfDay(at) + DAY_MS - 1;
}

/** Whole days from `from` to `to`, counted on local-midnight boundaries. */
export function daysBetween(from: number | Date, to: number | Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

/** Days remaining until the exam. 0 = exam day, negative = already past. */
export function daysUntilExam(examDate: string, now: number = Date.now()): number {
  const [y, m, d] = examDate.split('-').map(Number);
  const target = new Date(y, (m ?? 1) - 1, d ?? 1);
  return daysBetween(now, target);
}

export function addDays(at: number, days: number): number {
  return at + days * DAY_MS;
}

/** Sorted list of distinct local dates present in the given timestamps. */
export function distinctDateKeys(timestamps: number[]): string[] {
  return [...new Set(timestamps.map((t) => dateKey(t)))].sort();
}

/**
 * Consecutive-day study streak ending today (or yesterday — a streak is not
 * broken until the user misses a whole day).
 */
export function studyStreak(timestamps: number[], now: number = Date.now()): number {
  if (timestamps.length === 0) return 0;
  const keys = new Set(distinctDateKeys(timestamps));
  const todayKey = dateKey(now);
  let cursor = startOfDay(now);
  if (!keys.has(todayKey)) {
    cursor -= DAY_MS;
    if (!keys.has(dateKey(cursor))) return 0;
  }
  let streak = 0;
  while (keys.has(dateKey(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

/** Number of distinct study days within the last `days` days (inclusive of today). */
export function activeDaysInWindow(timestamps: number[], days: number, now: number = Date.now()): number {
  const floor = startOfDay(now) - (days - 1) * DAY_MS;
  return distinctDateKeys(timestamps.filter((t) => t >= floor)).length;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
