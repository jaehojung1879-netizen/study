import { describe, expect, it } from 'vitest';
import {
  capToExam,
  createQuestionState,
  dueStates,
  GROWTH_STEPS_DAYS,
  RETIREMENT_INTERVAL_DAYS,
  SAME_DAY_RETRY_MS,
  scheduleNext,
  type ReviewGrade,
} from '../src/learning/spacedRepetition/schedule';
import { DAY_MS } from '../src/learning/utils/date';
import { makeState } from './helpers';

const NOW = Date.UTC(2026, 0, 10);
const IDENTITY = { questionId: 'q1', examId: 'test-exam', subjectId: 'subject-a' };
const FAR = { now: NOW, daysUntilExam: 300 };

function grade(overrides: Partial<ReviewGrade> = {}): ReviewGrade {
  return { correct: true, confidence: 'unsure', elapsedMs: 40_000, expectedMs: 60_000, ...overrides };
}

describe('scheduleNext', () => {
  it('sends a miss back to a same-day re-drill', () => {
    const state = scheduleNext(undefined, IDENTITY, grade({ correct: false }), FAR);
    expect(state.intervalDays).toBe(0);
    expect(state.dueAt).toBe(NOW + SAME_DAY_RETRY_MS);
    expect(state.streak).toBe(0);
  });

  it('walks the 1 → 3 → 7 → 14 → 30 ladder on consecutive correct answers', () => {
    let state = createQuestionState(IDENTITY, NOW);
    const seen: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      state = scheduleNext(state, IDENTITY, grade({ confidence: 'certain' }), FAR);
      seen.push(state.intervalDays);
    }
    expect(seen.slice(0, 2)).toEqual([GROWTH_STEPS_DAYS[0], GROWTH_STEPS_DAYS[1]]);
    // Later steps are ease-modulated, so assert monotonic growth rather than exact values.
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(RETIREMENT_INTERVAL_DAYS);
  });

  it('shortens the interval again after a lapse', () => {
    let state = createQuestionState(IDENTITY, NOW);
    for (let i = 0; i < 4; i += 1) state = scheduleNext(state, IDENTITY, grade({ confidence: 'certain' }), FAR);
    const before = state.intervalDays;

    state = scheduleNext(state, IDENTITY, grade({ correct: false }), FAR);
    expect(state.intervalDays).toBe(0);
    expect(state.lapses).toBe(1);

    state = scheduleNext(state, IDENTITY, grade({ confidence: 'certain' }), FAR);
    expect(state.intervalDays).toBeLessThan(before);
  });

  it('flags a confident wrong answer as risky and keeps the flag until confidently relearned', () => {
    let state = scheduleNext(undefined, IDENTITY, grade({ correct: false, confidence: 'certain' }), FAR);
    expect(state.riskFlagged).toBe(true);

    state = scheduleNext(state, IDENTITY, grade({ confidence: 'certain' }), FAR);
    expect(state.riskFlagged).toBe(true); // one correct answer is not enough

    state = scheduleNext(state, IDENTITY, grade({ confidence: 'certain' }), FAR);
    expect(state.riskFlagged).toBe(false);
  });

  it('holds the interval short when a correct answer was guessed', () => {
    let state = createQuestionState(IDENTITY, NOW);
    for (let i = 0; i < 4; i += 1) state = scheduleNext(state, IDENTITY, grade({ confidence: 'guess' }), FAR);
    expect(state.intervalDays).toBeLessThanOrEqual(3);
  });

  it('never schedules a review past the exam', () => {
    let state = createQuestionState(IDENTITY, NOW);
    const ctx = { now: NOW, daysUntilExam: 6 };
    for (let i = 0; i < 6; i += 1) state = scheduleNext(state, IDENTITY, grade({ confidence: 'certain' }), ctx);
    expect(state.intervalDays).toBeLessThanOrEqual(3);
    expect(state.dueAt).toBeLessThanOrEqual(NOW + 6 * DAY_MS);
  });

  it('caps intervals to a fraction of the remaining days', () => {
    expect(capToExam(30, 6)).toBe(3);
    expect(capToExam(30, 1)).toBe(1);
    expect(capToExam(30, 0)).toBe(1);
    expect(capToExam(3, 300)).toBe(3);
    expect(capToExam(30, Number.POSITIVE_INFINITY)).toBe(30);
  });

  it('retires an item only after a long interval and a real streak', () => {
    let state = createQuestionState(IDENTITY, NOW);
    for (let i = 0; i < 3; i += 1) state = scheduleNext(state, IDENTITY, grade({ confidence: 'certain' }), FAR);
    expect(state.retired).toBe(false);
    for (let i = 0; i < 3; i += 1) state = scheduleNext(state, IDENTITY, grade({ confidence: 'certain' }), FAR);
    expect(state.retired).toBe(true);
  });

  it('does not mutate the state it is given', () => {
    const original = makeState({ intervalDays: 7, streak: 3 });
    const snapshot = { ...original };
    scheduleNext(original, IDENTITY, grade({ correct: false }), FAR);
    expect(original).toEqual(snapshot);
  });
});

describe('dueStates', () => {
  it('returns only started items whose due date has passed, soonest first', () => {
    const states = [
      makeState({ questionId: 'due-late', dueAt: NOW - 1000 }),
      makeState({ questionId: 'due-early', dueAt: NOW - 50_000 }),
      makeState({ questionId: 'not-yet', dueAt: NOW + 50_000 }),
      makeState({ questionId: 'never-seen', totalAttempts: 0, dueAt: NOW - 90_000 }),
    ];
    expect(dueStates(states, NOW).map((s) => s.questionId)).toEqual(['due-early', 'due-late']);
  });
});
