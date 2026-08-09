/**
 * Mastery score (§11).
 *
 * Deliberately a transparent weighted model, not ML: every number below can be
 * explained to the user and tuned in one place. Accuracy alone is *not* mastery —
 * a concept counts as mastered only when it is answered correctly, repeatedly,
 * quickly, and with confidence that matches the outcome.
 */
import type { Attempt, Confidence, QuestionState } from '../../storage/types';

export interface MasteryWeights {
  recentAccuracy: number;
  repeatSuccess: number;
  speed: number;
  calibration: number;
  retention: number;
}

/** §11 baseline. Change here, nowhere else. */
export const MASTERY_WEIGHTS: MasteryWeights = {
  recentAccuracy: 0.45,
  repeatSuccess: 0.2,
  speed: 0.1,
  calibration: 0.1,
  retention: 0.15,
};

/** How many attempts back the recency weight halves. */
export const RECENCY_HALF_LIFE_ATTEMPTS = 8;

/**
 * Value of a single answer, in [-0.35, 1].
 *
 * `certain + wrong` is the most dangerous signal in the whole system — a
 * confident misconception — so it scores *below* zero and actively drags the
 * concept down. `guess + correct` is capped well under a real correct answer.
 */
export const OUTCOME_VALUE: Record<Confidence, { correct: number; incorrect: number }> = {
  certain: { correct: 1.0, incorrect: -0.35 },
  unsure: { correct: 0.85, incorrect: 0.0 },
  guess: { correct: 0.55, incorrect: 0.05 },
};

/** Probability the user implicitly claims by picking each confidence level. */
export const CONFIDENCE_PRIOR: Record<Confidence, number> = {
  certain: 0.9,
  unsure: 0.55,
  guess: 0.3,
};

/** Expected solving time, used for the speed component and the mock pace warning. */
export function expectedSeconds(questionType: string, difficulty: number): number {
  const base =
    questionType === 'calculation' ? 100 : questionType === 'case' ? 85 : questionType === 'count' ? 80 : 60;
  // ±20% around the base for difficulty 1..5.
  return Math.round(base * (0.8 + (Math.min(5, Math.max(1, difficulty)) - 1) * 0.1));
}

export interface MasteryBreakdown {
  /** 0–100. */
  score: number;
  hasData: boolean;
  attempts: number;
  components: {
    recentAccuracy: number;
    repeatSuccess: number;
    speed: number;
    calibration: number;
    retention: number;
  };
  /** How much evidence backs the score, 0–1. Low values mean "not enough data yet". */
  evidence: number;
  /** Count of `certain + incorrect` answers — surfaced directly in the UI. */
  riskyMistakes: number;
}

export interface MasteryOptions {
  now?: number;
  /** Question states for the same scope, used for the retention component. */
  states?: QuestionState[];
  weights?: MasteryWeights;
}

export const EMPTY_MASTERY: MasteryBreakdown = {
  score: 0,
  hasData: false,
  attempts: 0,
  components: { recentAccuracy: 0, repeatSuccess: 0, speed: 0, calibration: 0, retention: 0 },
  evidence: 0,
  riskyMistakes: 0,
};

/**
 * @param attempts Attempts for one scope (a concept, a topic, a subject, or everything),
 *                 in any order — they are sorted internally.
 */
export function computeMastery(attempts: Attempt[], options: MasteryOptions = {}): MasteryBreakdown {
  if (attempts.length === 0) return { ...EMPTY_MASTERY };

  const now = options.now ?? Date.now();
  const weights = options.weights ?? MASTERY_WEIGHTS;
  const ordered = [...attempts].sort((a, b) => a.at - b.at);
  const recencyWeights = buildRecencyWeights(ordered.length);

  const recentAccuracy = weightedRecentAccuracy(ordered, recencyWeights);
  const repeatSuccess = repeatSuccessRate(ordered, recencyWeights);
  const speed = speedScore(ordered, recencyWeights);
  const calibration = calibrationScore(ordered, recencyWeights);
  const retention = retentionScore(options.states ?? [], now, recentAccuracy);

  const raw =
    weights.recentAccuracy * recentAccuracy +
    weights.repeatSuccess * repeatSuccess +
    weights.speed * speed +
    weights.calibration * calibration +
    weights.retention * retention;

  // Confidence in the estimate itself: a single lucky answer must not read as mastery.
  const evidence = ordered.length / (ordered.length + 3);
  const shrunk = raw * (0.6 + 0.4 * evidence);

  return {
    score: round1(clamp01(shrunk) * 100),
    hasData: true,
    attempts: ordered.length,
    components: {
      recentAccuracy: round1(recentAccuracy * 100),
      repeatSuccess: round1(repeatSuccess * 100),
      speed: round1(speed * 100),
      calibration: round1(calibration * 100),
      retention: round1(retention * 100),
    },
    evidence: round2(evidence),
    riskyMistakes: ordered.filter((a) => a.confidence === 'certain' && !a.correct).length,
  };
}

/** Weight per attempt, newest last. Halves every `RECENCY_HALF_LIFE_ATTEMPTS`. */
function buildRecencyWeights(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const ageRank = count - 1 - i; // 0 = newest
    out.push(Math.pow(0.5, ageRank / RECENCY_HALF_LIFE_ATTEMPTS));
  }
  return out;
}

function weightedRecentAccuracy(attempts: Attempt[], w: number[]): number {
  let sum = 0;
  let total = 0;
  attempts.forEach((a, i) => {
    const table = OUTCOME_VALUE[a.confidence] ?? OUTCOME_VALUE.unsure;
    sum += w[i] * (a.correct ? table.correct : table.incorrect);
    total += w[i];
  });
  return total === 0 ? 0 : clamp01(sum / total);
}

/**
 * Success on *repeat* exposures only — the signal that something actually stuck
 * rather than being fresh in working memory.
 */
function repeatSuccessRate(attempts: Attempt[], w: number[]): number {
  const seen = new Set<string>();
  let sum = 0;
  let total = 0;
  attempts.forEach((a, i) => {
    if (!seen.has(a.questionId)) {
      seen.add(a.questionId);
      return; // first exposure is not a retention test
    }
    sum += w[i] * (a.correct ? 1 : 0);
    total += w[i];
  });
  // Shrink toward 0.5 so two repeats do not look like proven retention.
  const prior = 0.5;
  const priorWeight = 2;
  return (sum + prior * priorWeight) / (total + priorWeight);
}

function speedScore(attempts: Attempt[], w: number[]): number {
  let sum = 0;
  let total = 0;
  attempts.forEach((a, i) => {
    if (!a.correct) return; // fast-and-wrong is not speed
    if (a.elapsedMs <= 0) return;
    const targetMs = expectedSeconds(a.questionType, a.difficulty) * 1000;
    const ratio = a.elapsedMs / targetMs;
    // Full marks at or under 70% of target, zero at 200%.
    const s = clamp01((2.0 - ratio) / 1.3);
    sum += w[i] * s;
    total += w[i];
  });
  return total === 0 ? 0.5 : sum / total;
}

/**
 * Brier-style calibration: does "확실함" actually mean the user is right?
 * Normalised so `certain + wrong` lands at 0.
 */
function calibrationScore(attempts: Attempt[], w: number[]): number {
  let sum = 0;
  let total = 0;
  attempts.forEach((a, i) => {
    const p = CONFIDENCE_PRIOR[a.confidence] ?? 0.55;
    const outcome = a.correct ? 1 : 0;
    sum += w[i] * Math.pow(p - outcome, 2);
    total += w[i];
  });
  if (total === 0) return 0.5;
  return clamp01(1 - sum / total / 0.5);
}

/**
 * Memory strength from the SRS state: how far into the current interval each
 * item has decayed. An item reviewed yesterday with a 14-day interval is strong;
 * one whose 1-day interval expired a week ago is not.
 */
function retentionScore(states: QuestionState[], now: number, fallback: number): number {
  const usable = states.filter((s) => s.totalAttempts > 0);
  if (usable.length === 0) return fallback * 0.8;
  let sum = 0;
  for (const s of usable) {
    const daysSince = Math.max(0, (now - s.lastReviewedAt) / 86400000);
    const halfLife = Math.max(1, s.intervalDays);
    let strength = Math.pow(2, -daysSince / halfLife);
    if (!s.lastCorrect) strength *= 0.35;
    if (s.riskFlagged) strength *= 0.75;
    // A long, repeatedly-survived interval is itself evidence of durable memory.
    strength = clamp01(strength * (0.75 + 0.25 * Math.min(1, s.streak / 4)));
    sum += strength;
  }
  return clamp01(sum / usable.length);
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 5-band label used by the topic heatmap (§5). */
export type MasteryBand = 'critical' | 'weak' | 'fair' | 'stable' | 'mastered';

export const MASTERY_BANDS: Array<{ band: MasteryBand; min: number; label: string }> = [
  { band: 'mastered', min: 85, label: '완전숙달' },
  { band: 'stable', min: 70, label: '안정' },
  { band: 'fair', min: 55, label: '보통' },
  { band: 'weak', min: 35, label: '취약' },
  { band: 'critical', min: 0, label: '매우 취약' },
];

export function masteryBand(score: number): MasteryBand {
  return MASTERY_BANDS.find((b) => score >= b.min)?.band ?? 'critical';
}

export function masteryBandLabel(score: number): string {
  return MASTERY_BANDS.find((b) => score >= b.min)?.label ?? '매우 취약';
}
