/**
 * Spaced repetition (§12).
 *
 * Wrong answers are not re-drilled every single day — that wastes the limited
 * hours before the exam. Instead each item walks a ladder of intervals, falls
 * back down on a lapse, and is never scheduled past the exam date.
 */
import type { Confidence, QuestionState } from '../../storage/types';
import { DAY_MS } from '../utils/date';

/** Interval ladder after a correct answer, indexed by post-answer streak - 1. */
export const GROWTH_STEPS_DAYS = [1, 3, 7, 14, 30, 60];

/** Same-day re-drill delay after a miss ("당일 후반"). */
export const SAME_DAY_RETRY_MS = 4 * 60 * 60 * 1000;

/** An item is considered retired once it survives this interval. */
export const RETIREMENT_INTERVAL_DAYS = 30;

export const EASE_BOUNDS = { min: 1.3, max: 2.8 } as const;
export const DEFAULT_EASE = 2.2;

export interface ReviewGrade {
  correct: boolean;
  confidence: Confidence;
  elapsedMs: number;
  /** Expected solving time for this item, used to reward genuinely fluent recall. */
  expectedMs: number;
}

export interface ScheduleContext {
  now: number;
  /** Days left until the exam; intervals never reach past it. Use `Infinity` to disable. */
  daysUntilExam: number;
}

export interface QuestionIdentity {
  questionId: string;
  examId: string;
  subjectId: string;
}

export function createQuestionState(identity: QuestionIdentity, now: number): QuestionState {
  return {
    ...identity,
    totalAttempts: 0,
    totalCorrect: 0,
    streak: 0,
    lapses: 0,
    intervalDays: 0,
    ease: DEFAULT_EASE,
    dueAt: now,
    lastReviewedAt: 0,
    lastCorrect: false,
    lastConfidence: 'unsure',
    riskFlagged: false,
    bookmarked: false,
    retired: false,
  };
}

/**
 * Applies one answer to an item's schedule.
 *
 * Pure — returns a new state, never mutates. That keeps it trivially testable
 * and makes the rules auditable in one place.
 */
export function scheduleNext(
  previous: QuestionState | undefined,
  identity: QuestionIdentity,
  grade: ReviewGrade,
  ctx: ScheduleContext,
): QuestionState {
  const state = previous ?? createQuestionState(identity, ctx.now);
  const ease = nextEase(state.ease, grade);
  const wasKnown = state.streak > 0;

  if (!grade.correct) {
    // Lapse: back to the bottom of the ladder, re-drilled later the same day.
    return {
      ...state,
      ...identity,
      totalAttempts: state.totalAttempts + 1,
      streak: 0,
      lapses: state.lapses + (wasKnown ? 1 : 0),
      intervalDays: 0,
      ease,
      dueAt: ctx.now + SAME_DAY_RETRY_MS,
      lastReviewedAt: ctx.now,
      lastCorrect: false,
      lastConfidence: grade.confidence,
      // A confident wrong answer is the misconception we most want to hunt down.
      riskFlagged: state.riskFlagged || grade.confidence === 'certain',
      retired: false,
    };
  }

  const streak = state.streak + 1;
  const stepIndex = Math.min(streak - 1, GROWTH_STEPS_DAYS.length - 1);
  let intervalDays = GROWTH_STEPS_DAYS[stepIndex];

  // Ease modulates the longer intervals only; the first steps stay fixed so the
  // ladder remains predictable.
  if (stepIndex >= 2) {
    intervalDays = Math.round(intervalDays * (ease / DEFAULT_EASE));
  }
  // A guessed correct answer is not proof of anything — hold the interval short.
  if (grade.confidence === 'guess') {
    intervalDays = Math.min(intervalDays, 3);
  }
  // Items with a history of lapses come back sooner.
  if (state.lapses > 0) {
    intervalDays = Math.max(1, Math.round(intervalDays * Math.max(0.5, 1 - 0.15 * state.lapses)));
  }

  intervalDays = capToExam(intervalDays, ctx.daysUntilExam);

  return {
    ...state,
    ...identity,
    totalAttempts: state.totalAttempts + 1,
    totalCorrect: state.totalCorrect + 1,
    streak,
    lapses: state.lapses,
    intervalDays,
    ease,
    dueAt: ctx.now + intervalDays * DAY_MS,
    lastReviewedAt: ctx.now,
    lastCorrect: true,
    lastConfidence: grade.confidence,
    // Clear the risk flag only once the item is answered confidently and correctly again.
    riskFlagged: state.riskFlagged && !(grade.confidence === 'certain' && streak >= 2),
    retired: intervalDays >= RETIREMENT_INTERVAL_DAYS && streak >= 4,
  };
}

/**
 * Never schedule a review the user will not live to see: with 5 days to go,
 * a 30-day interval is the same as deleting the card.
 */
export function capToExam(intervalDays: number, daysUntilExam: number): number {
  if (!Number.isFinite(daysUntilExam)) return intervalDays;
  if (daysUntilExam <= 1) return Math.min(intervalDays, 1);
  // Leave room for at least one more sighting before the exam.
  const cap = Math.max(1, Math.floor(daysUntilExam / 2));
  return Math.min(intervalDays, cap);
}

function nextEase(ease: number, grade: ReviewGrade): number {
  let delta = 0;
  if (grade.correct) {
    delta = grade.confidence === 'certain' ? 0.1 : grade.confidence === 'unsure' ? 0.02 : -0.05;
    // Fluent recall (well under the expected time) earns a little extra.
    if (grade.expectedMs > 0 && grade.elapsedMs > 0 && grade.elapsedMs < grade.expectedMs * 0.6) {
      delta += 0.05;
    }
  } else {
    delta = grade.confidence === 'certain' ? -0.3 : -0.15;
  }
  return clamp(ease + delta, EASE_BOUNDS.min, EASE_BOUNDS.max);
}

/** Items whose review is due at or before `now`. */
export function dueStates(states: QuestionState[], now: number = Date.now()): QuestionState[] {
  return states.filter((s) => s.totalAttempts > 0 && s.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
