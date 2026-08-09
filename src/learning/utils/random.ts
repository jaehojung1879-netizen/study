/**
 * Deterministic pseudo-randomness.
 *
 * The daily set must be stable: reloading the page mid-session may not reshuffle
 * the 100 questions. Every random choice in selection is therefore seeded from
 * (examId, dateKey, user salt).
 */

export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Rng = () => number;

/** mulberry32 — small, fast, good enough for shuffling a question bank. */
export function createRng(seed: string | number): Rng {
  let a = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 1;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates on a copy. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Weighted sampling without replacement (Efraimidis–Spirakis keys).
 * Items with weight <= 0 are never picked.
 */
export function weightedSample<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  count: number,
  rng: Rng,
): T[] {
  const keyed: Array<{ item: T; key: number }> = [];
  for (const item of items) {
    const w = weightOf(item);
    if (w <= 0) continue;
    keyed.push({ item, key: Math.pow(rng(), 1 / w) });
  }
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, count).map((k) => k.item);
}
