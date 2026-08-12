/**
 * Adaptive daily-set builder (§6, §13, §17).
 *
 * The set is composed from an existing, validated question bank — nothing is
 * generated at page load. Composition is deterministic for a given
 * (exam, date, salt) so reloading mid-session never reshuffles the day.
 */
import type { ExamConfig, Question, SelectionMix, StudyPhase } from '../../exam/types';
import type { Attempt, QuestionState } from '../../storage/types';
import type { SubjectStats } from '../analytics/stats';
import { conceptWeights } from '../analytics/weakness';
import { createRng, shuffle, weightedSample, type Rng } from '../utils/random';
import { DAY_MS } from '../utils/date';
import { effectiveMix, currentPhase } from './phase';

export type SelectionBucket = 'weakness' | 'dueReview' | 'coverage' | 'recentWrong' | 'fresh' | 'filler';

export const BUCKET_LABELS: Record<SelectionBucket, string> = {
  weakness: '취약영역',
  dueReview: '복습 예정',
  coverage: '전체 범위',
  recentWrong: '최근 오답 변형',
  fresh: '신규 문제',
  filler: '보충',
};

export interface DailySetInput {
  config: ExamConfig;
  questions: Question[];
  states: QuestionState[];
  attempts: Attempt[];
  /** Topic tree from `buildTopicTree`, used for weakness weighting. */
  subjectStats: SubjectStats[];
  now: number;
  /** Stable per-user salt so two users do not get identical sets. */
  salt: string;
  /** Overrides `config.daily.totalQuestions`. */
  totalOverride?: number | null;
}

/** Why today's set is shorter than the configured goal, when it is. */
export interface DailySetCap {
  /** What was asked for (setting, or `config.daily.totalQuestions`). */
  requested: number;
  /** What the bank can sustain without recycling. */
  sustainable: number;
  /** How many more questions the bank needs to serve `requested` in full. */
  questionsNeeded: number;
}

export interface DailySetResult {
  questionIds: string[];
  /** Bucket that produced each id, parallel to `questionIds`. */
  buckets: SelectionBucket[];
  breakdown: Record<SelectionBucket, number>;
  perSubject: Record<string, number>;
  phase: StudyPhase;
  mix: SelectionMix;
  planSummary: string;
  /** Set when the bank was too small to serve the requested total. */
  cap?: DailySetCap;
}

/** Window for "recently got this wrong". */
const RECENT_WRONG_WINDOW_DAYS = 7;

/**
 * Largest share of a subject's pool one day may draw before the set stops
 * feeling new (§6).
 *
 * Repetition is arithmetic, not a scheduling bug: drawing N of a pool of P
 * forces at least 2N − P items to repeat the next day. Simulated against the
 * shipped bank, day-over-day overlap sits near 30% up to ~40% of the pool and
 * then climbs steeply — 68% of the pool produced 63% overlap. The residual 30%
 * is the spaced-repetition system legitimately bringing back missed items,
 * which is the point of the app; everything above it is the same question
 * arriving because there was nothing else to send.
 */
export const MAX_POOL_FRACTION_PER_DAY = 0.4;

/**
 * The largest daily total this bank can sustain without recycling.
 *
 * Returns `config.daily.totalQuestions` once the bank is big enough, so this
 * cap disappears on its own as questions are added — no setting to remember to
 * put back.
 */
export function sustainableDailyTotal(config: ExamConfig, questions: Question[]): number {
  const usable = questions.filter((q) => !q.needsReview);
  const goal = config.daily.totalQuestions;
  const shares = allocatePerSubject(config, goal);

  let limit = Number.POSITIVE_INFINITY;
  for (const subject of config.subjects) {
    const share = shares[subject.id] ?? 0;
    if (share <= 0) continue;
    const pool = usable.filter((q) => q.subjectId === subject.id).length;
    const perSubjectCap = Math.floor(pool * MAX_POOL_FRACTION_PER_DAY);
    // Scale the whole day by this subject's headroom, so the 50:50 split holds.
    limit = Math.min(limit, (perSubjectCap / share) * goal);
  }
  if (!Number.isFinite(limit)) return goal;
  return Math.max(config.subjects.length, Math.min(goal, Math.floor(limit)));
}

export function buildDailySet(input: DailySetInput): DailySetResult {
  const { config, questions, states, attempts, now, salt } = input;
  const phase = currentPhase(config, now);
  const mix = effectiveMix(config, phase);

  const stateByQuestion = new Map(states.map((s) => [s.questionId, s]));
  const weights = conceptWeights(input.subjectStats);

  // A goal larger than the bank can serve does not produce more learning — it
  // produces the same questions again. Cap it, and report the cap so the UI can
  // say why rather than leaving the user to notice the repeats themselves.
  const requested = input.totalOverride ?? config.daily.totalQuestions;
  const sustainable = sustainableDailyTotal(config, questions);
  const totalTarget = Math.min(requested, sustainable);
  const cap: DailySetCap | undefined =
    totalTarget < requested
      ? {
          requested,
          sustainable: totalTarget,
          questionsNeeded: questionsNeededForGoal(config, questions, requested),
        }
      : undefined;

  // Per-subject targets keep the 50:50 balance the spec asks for even when one
  // subject is far weaker; the weakness weighting happens *inside* each subject.
  const perSubjectTargets = allocatePerSubject(config, totalTarget);

  const picked: Array<{ id: string; bucket: SelectionBucket; subjectId: string }> = [];
  const used = new Set<string>();

  for (const subject of config.subjects) {
    const target = perSubjectTargets[subject.id] ?? 0;
    if (target <= 0) continue;
    const pool = questions.filter((q) => q.subjectId === subject.id && !q.needsReview);
    const rng = createRng(`${config.id}|${subject.id}|${dayStamp(now)}|${salt}`);
    const subjectAttempts = attempts.filter((a) => a.subjectId === subject.id);
    const chosen = selectForSubject({
      pool,
      target,
      mix,
      phase,
      rng,
      now,
      stateByQuestion,
      conceptWeight: weights,
      subjectAttempts,
      used,
    });
    for (const item of chosen) {
      used.add(item.id);
      picked.push({ ...item, subjectId: subject.id });
    }
  }

  const interleaved = interleaveBySubject(picked, config.subjects.map((s) => s.id));

  const breakdown = emptyBreakdown();
  for (const item of interleaved) breakdown[item.bucket] += 1;
  const perSubject: Record<string, number> = {};
  for (const item of interleaved) perSubject[item.subjectId] = (perSubject[item.subjectId] ?? 0) + 1;

  return {
    questionIds: interleaved.map((i) => i.id),
    buckets: interleaved.map((i) => i.bucket),
    breakdown,
    perSubject,
    phase,
    mix,
    planSummary: describePlan(breakdown, phase),
    cap,
  };
}

/** How many questions the bank still needs to serve `requested` in full. */
export function questionsNeededForGoal(
  config: ExamConfig,
  questions: Question[],
  requested: number,
): number {
  const usable = questions.filter((q) => !q.needsReview);
  const shares = allocatePerSubject(config, requested);
  let missing = 0;
  for (const subject of config.subjects) {
    const share = shares[subject.id] ?? 0;
    if (share <= 0) continue;
    const pool = usable.filter((q) => q.subjectId === subject.id).length;
    const needed = Math.ceil(share / MAX_POOL_FRACTION_PER_DAY);
    missing += Math.max(0, needed - pool);
  }
  return missing;
}

interface SubjectSelectionInput {
  pool: Question[];
  target: number;
  mix: SelectionMix;
  phase: StudyPhase;
  rng: Rng;
  now: number;
  stateByQuestion: Map<string, QuestionState>;
  conceptWeight: Map<string, number>;
  subjectAttempts: Attempt[];
  used: Set<string>;
}

function selectForSubject(input: SubjectSelectionInput): Array<{ id: string; bucket: SelectionBucket }> {
  const { pool, target, mix, phase, rng, now, stateByQuestion, conceptWeight, subjectAttempts, used } = input;
  const taken = new Set<string>(used);
  const out: Array<{ id: string; bucket: SelectionBucket }> = [];

  const eligible = pool.filter((q) => !phase.maxDifficulty || q.difficulty <= phase.maxDifficulty);
  // If the difficulty cap starves the pool, ignore it rather than ship a short set.
  const workingPool = eligible.length >= target ? eligible : pool;

  const quotas = distribute(target, [
    ['dueReview', mix.dueReview],
    ['weakness', mix.weakness],
    ['recentWrong', mix.recentWrong],
    ['coverage', mix.coverage],
    ['fresh', mix.fresh],
  ]);

  const take = (bucket: SelectionBucket, candidates: Question[], count: number): number => {
    let placed = 0;
    for (const q of candidates) {
      if (out.length >= target || placed >= count) break;
      if (taken.has(q.id)) continue;
      taken.add(q.id);
      out.push({ id: q.id, bucket });
      placed += 1;
    }
    return placed;
  };

  // 1. Reviews that are actually due — the highest-value questions of the day.
  take('dueReview', dueCandidates(workingPool, stateByQuestion, now), quotas.dueReview);

  // 2. Weak concepts, sampled proportionally to how weak they are.
  take(
    'weakness',
    weightedSample(
      workingPool.filter((q) => !taken.has(q.id)),
      (q) => weaknessWeight(q, conceptWeight, stateByQuestion),
      quotas.weakness * 2,
      rng,
    ),
    quotas.weakness,
  );

  // 3. Variants of items recently missed — same concept, different question.
  take(
    'recentWrong',
    recentWrongVariants(workingPool, subjectAttempts, taken, now, rng),
    quotas.recentWrong,
  );

  // 4. Syllabus coverage: topics touched least often come first.
  take('coverage', coverageCandidates(workingPool, subjectAttempts, taken, rng), quotas.coverage);

  // 5. Brand-new material, capped in the final stretch (§22).
  const freshCap = phase.maxFreshQuestions ?? Number.POSITIVE_INFINITY;
  let freshTaken = take(
    'fresh',
    freshCandidates(workingPool, stateByQuestion, taken, rng),
    Math.min(quotas.fresh, freshCap),
  );

  // 6. Redistribute whatever the earlier buckets could not fill.
  //    On day one there is no weakness or review history, so that quota belongs
  //    to new material and coverage — not to an anonymous "filler" pile.
  if (out.length < target && freshTaken < freshCap) {
    freshTaken += take(
      'fresh',
      freshCandidates(workingPool, stateByQuestion, taken, rng),
      Math.min(target - out.length, freshCap - freshTaken),
    );
  }
  if (out.length < target) {
    take('coverage', coverageCandidates(workingPool, subjectAttempts, taken, rng), target - out.length);
  }

  // 7. Last resort: least-recently-seen first, so even the filler is useful.
  if (out.length < target) {
    const remaining = shuffle(
      workingPool.filter((q) => !taken.has(q.id)),
      rng,
    ).sort((a, b) => lastSeen(a, stateByQuestion) - lastSeen(b, stateByQuestion));
    take('filler', remaining, target - out.length);
  }

  // 8. Bank smaller than the daily goal: repeat the oldest items rather than
  //    silently shipping a short set.
  if (out.length < target && workingPool.length > 0) {
    const recycled = [...workingPool].sort(
      (a, b) => lastSeen(a, stateByQuestion) - lastSeen(b, stateByQuestion),
    );
    let i = 0;
    while (out.length < target) {
      out.push({ id: recycled[i % recycled.length].id, bucket: 'filler' });
      i += 1;
    }
  }

  return out;
}

function dueCandidates(
  pool: Question[],
  stateByQuestion: Map<string, QuestionState>,
  now: number,
): Question[] {
  return pool
    .filter((q) => {
      const s = stateByQuestion.get(q.id);
      return !!s && s.totalAttempts > 0 && s.dueAt <= now;
    })
    .sort((a, b) => {
      const sa = stateByQuestion.get(a.id)!;
      const sb = stateByQuestion.get(b.id)!;
      // Most overdue first, but confident-wrong items jump the queue.
      const riskDelta = Number(sb.riskFlagged) - Number(sa.riskFlagged);
      if (riskDelta !== 0) return riskDelta;
      const dueDelta = sa.dueAt - sb.dueAt;
      return dueDelta !== 0 ? dueDelta : sourcePriority(b) - sourcePriority(a);
    });
}

function weaknessWeight(
  q: Question,
  conceptWeight: Map<string, number>,
  stateByQuestion: Map<string, QuestionState>,
): number {
  let weight = 0;
  for (const conceptId of q.conceptIds) weight = Math.max(weight, conceptWeight.get(conceptId) ?? 0);
  if (weight <= 0) return 0;
  const state = stateByQuestion.get(q.id);
  // Prefer questions the user has not just seen, so "weak concept" does not mean
  // "the same five questions forever" (§13).
  if (state && state.totalAttempts > 0) {
    weight *= state.lastCorrect ? 0.5 : 0.9;
  } else {
    weight *= 1.2;
  }
  // When two questions drill the same weakness, real exam evidence is more
  // valuable than a generated approximation. User history still stays primary.
  weight *= q.sourceType === 'official_past_exam' ? 1.4 : q.sourceType === 'adapted_past_exam' ? 1.15 : 1;
  return weight;
}

/**
 * §6/§13: not the identical item again, but *another* question on the concept
 * the user just missed. Falls back to the original item when the bank has no
 * sibling yet.
 */
function recentWrongVariants(
  pool: Question[],
  subjectAttempts: Attempt[],
  taken: Set<string>,
  now: number,
  rng: Rng,
): Question[] {
  const since = now - RECENT_WRONG_WINDOW_DAYS * DAY_MS;
  const recentWrong = subjectAttempts.filter((a) => !a.correct && a.at >= since);
  if (recentWrong.length === 0) return [];

  const conceptScores = new Map<string, number>();
  const missedQuestionIds = new Set<string>();
  for (const a of recentWrong) {
    missedQuestionIds.add(a.questionId);
    const weight = a.confidence === 'certain' ? 2 : 1;
    for (const c of a.conceptIds) conceptScores.set(c, (conceptScores.get(c) ?? 0) + weight);
  }

  const variants = pool.filter(
    (q) => !taken.has(q.id) && !missedQuestionIds.has(q.id) && q.conceptIds.some((c) => conceptScores.has(c)),
  );
  const sampled = weightedSample(
    variants,
    (q) =>
      q.conceptIds.reduce((sum, c) => sum + (conceptScores.get(c) ?? 0), 0) *
      (q.sourceType === 'official_past_exam' ? 1.4 : 1),
    variants.length,
    rng,
  );
  const originals = pool.filter((q) => !taken.has(q.id) && missedQuestionIds.has(q.id));
  return [...sampled, ...originals];
}

function coverageCandidates(
  pool: Question[],
  subjectAttempts: Attempt[],
  taken: Set<string>,
  rng: Rng,
): Question[] {
  const topicCounts = new Map<string, number>();
  for (const a of subjectAttempts) {
    topicCounts.set(a.minorTopicId, (topicCounts.get(a.minorTopicId) ?? 0) + 1);
  }
  return shuffle(
    pool.filter((q) => !taken.has(q.id)),
    rng,
  ).sort((a, b) => {
    const coverageDelta =
      (topicCounts.get(a.minorTopicId) ?? 0) - (topicCounts.get(b.minorTopicId) ?? 0);
    return coverageDelta !== 0 ? coverageDelta : sourcePriority(b) - sourcePriority(a);
  });
}

function freshCandidates(
  pool: Question[],
  stateByQuestion: Map<string, QuestionState>,
  taken: Set<string>,
  rng: Rng,
): Question[] {
  const unseen = pool.filter((q) => !taken.has(q.id) && !stateByQuestion.has(q.id));
  // Official past exams are the default evidence. Current-affairs items only
  // outrank ordinary generated questions when no official item is available.
  return shuffle(unseen, rng).sort((a, b) => sourcePriority(b) - sourcePriority(a));
}

function sourcePriority(question: Question): number {
  switch (question.sourceType) {
    case 'official_past_exam':
      return 3;
    case 'adapted_past_exam':
      return 2;
    case 'generated_current_affairs':
      return 1;
    default:
      return 0;
  }
}

function lastSeen(q: Question, stateByQuestion: Map<string, QuestionState>): number {
  return stateByQuestion.get(q.id)?.lastReviewedAt ?? 0;
}

/** Largest-remainder allocation so the quotas always sum exactly to `total`. */
export function distribute(
  total: number,
  entries: Array<[SelectionBucket, number]>,
): Record<SelectionBucket, number> {
  const out = emptyBreakdown();
  const weightSum = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  if (weightSum <= 0 || total <= 0) return out;

  const exact = entries.map(([bucket, w]) => ({ bucket, value: (Math.max(0, w) / weightSum) * total }));
  let assigned = 0;
  for (const e of exact) {
    out[e.bucket] = Math.floor(e.value);
    assigned += out[e.bucket];
  }
  const remainders = exact
    .map((e) => ({ bucket: e.bucket, frac: e.value - Math.floor(e.value) }))
    .sort((a, b) => b.frac - a.frac);
  let i = 0;
  while (assigned < total && remainders.length > 0) {
    out[remainders[i % remainders.length].bucket] += 1;
    assigned += 1;
    i += 1;
  }
  return out;
}

export function allocatePerSubject(config: ExamConfig, total: number): Record<string, number> {
  const base = config.subjects.reduce((sum, s) => sum + s.dailyQuestionCount, 0);
  const out: Record<string, number> = {};
  if (base <= 0) return out;
  let assigned = 0;
  config.subjects.forEach((s, index) => {
    if (index === config.subjects.length - 1) {
      out[s.id] = Math.max(0, total - assigned);
    } else {
      out[s.id] = Math.round((s.dailyQuestionCount / base) * total);
      assigned += out[s.id];
    }
  });
  return out;
}

/** Round-robin across subjects so the user is not handed 50 민법 questions in a row. */
function interleaveBySubject<T extends { subjectId: string }>(items: T[], order: string[]): T[] {
  const queues = new Map<string, T[]>();
  for (const id of order) queues.set(id, []);
  for (const item of items) {
    if (!queues.has(item.subjectId)) queues.set(item.subjectId, []);
    queues.get(item.subjectId)!.push(item);
  }
  const out: T[] = [];
  let remaining = items.length;
  while (remaining > 0) {
    let progressed = false;
    for (const queue of queues.values()) {
      const next = queue.shift();
      if (next) {
        out.push(next);
        remaining -= 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
}

function emptyBreakdown(): Record<SelectionBucket, number> {
  return { weakness: 0, dueReview: 0, coverage: 0, recentWrong: 0, fresh: 0, filler: 0 };
}

function dayStamp(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function describePlan(breakdown: Record<SelectionBucket, number>, phase: StudyPhase): string {
  const parts = (Object.keys(breakdown) as SelectionBucket[])
    .filter((b) => breakdown[b] > 0)
    .map((b) => `${BUCKET_LABELS[b]} ${breakdown[b]}문항`);
  return `${phase.label} · ${parts.join(' · ')}`;
}
