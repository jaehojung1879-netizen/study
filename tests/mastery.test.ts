import { describe, expect, it } from 'vitest';
import {
  computeMastery,
  expectedSeconds,
  masteryBand,
  MASTERY_WEIGHTS,
} from '../src/learning/mastery/masteryScore';
import { computeThreeCircles, STABLE_THRESHOLD } from '../src/learning/mastery/threeCircles';
import { attemptSeries, makeAttempt, makeState } from './helpers';

const NOW = Date.UTC(2026, 0, 20);

describe('computeMastery', () => {
  it('returns an empty, non-crashing result with no attempts', () => {
    const result = computeMastery([], { now: NOW });
    expect(result.hasData).toBe(false);
    expect(result.score).toBe(0);
  });

  it('weights are the documented §11 split and sum to 1', () => {
    const total = Object.values(MASTERY_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(MASTERY_WEIGHTS.recentAccuracy).toBe(0.45);
    expect(MASTERY_WEIGHTS.repeatSuccess).toBe(0.2);
  });

  it('scores confident, fast, repeated correct answers highly', () => {
    const attempts = attemptSeries(12, (i) => ({
      questionId: `q-rot-${i % 4}`,
      correct: true,
      confidence: 'certain',
      elapsedMs: 25_000,
    }));
    const states = [0, 1, 2, 3].map((i) =>
      makeState({
        questionId: `q-rot-${i}`,
        streak: 4,
        intervalDays: 14,
        lastReviewedAt: NOW - 86_400_000,
        lastCorrect: true,
      }),
    );
    const result = computeMastery(attempts, { now: NOW, states });
    expect(result.score).toBeGreaterThan(75);
    expect(result.components.recentAccuracy).toBe(100);
  });

  it('penalises "확실함 + 오답" far more heavily than an unsure miss', () => {
    const base = (confidence: 'certain' | 'unsure') =>
      computeMastery(
        attemptSeries(8, (i) => ({
          questionId: `q${i}`,
          correct: i >= 6, // same 2/8 accuracy either way
          confidence: i >= 6 ? 'unsure' : confidence,
        })),
        { now: NOW },
      );

    const confidentlyWrong = base('certain');
    const unsurelyWrong = base('unsure');
    expect(confidentlyWrong.score).toBeLessThan(unsurelyWrong.score);
    expect(confidentlyWrong.riskyMistakes).toBe(6);
    expect(unsurelyWrong.riskyMistakes).toBe(0);
  });

  it('treats "찍음 + 정답" as weaker evidence than a confident correct answer', () => {
    const guessed = computeMastery(
      attemptSeries(10, () => ({ correct: true, confidence: 'guess' })),
      { now: NOW },
    );
    const known = computeMastery(
      attemptSeries(10, () => ({ correct: true, confidence: 'certain' })),
      { now: NOW },
    );
    expect(guessed.score).toBeLessThan(known.score);
    expect(guessed.components.recentAccuracy).toBeLessThan(100);
  });

  it('weights recent attempts above old ones', () => {
    const improving = computeMastery(
      attemptSeries(16, (i) => ({ correct: i >= 8, confidence: 'unsure' })),
      { now: NOW },
    );
    const declining = computeMastery(
      attemptSeries(16, (i) => ({ correct: i < 8, confidence: 'unsure' })),
      { now: NOW },
    );
    expect(improving.score).toBeGreaterThan(declining.score);
  });

  it('shrinks the score when evidence is thin', () => {
    const one = computeMastery([makeAttempt({ correct: true, confidence: 'certain' })], { now: NOW });
    const many = computeMastery(
      attemptSeries(20, (i) => ({ questionId: `q${i % 5}`, correct: true, confidence: 'certain' })),
      { now: NOW },
    );
    expect(one.evidence).toBeLessThan(many.evidence);
    expect(one.score).toBeLessThan(many.score);
    expect(one.score).toBeLessThan(80);
  });

  it('decays retention when a review is long overdue', () => {
    const attempts = attemptSeries(6, () => ({ correct: true, confidence: 'certain' }));
    const fresh = computeMastery(attempts, {
      now: NOW,
      states: [makeState({ intervalDays: 7, lastReviewedAt: NOW - 86_400_000 })],
    });
    const stale = computeMastery(attempts, {
      now: NOW,
      states: [makeState({ intervalDays: 7, lastReviewedAt: NOW - 60 * 86_400_000 })],
    });
    expect(stale.components.retention).toBeLessThan(fresh.components.retention);
  });

  it('maps scores onto the five heatmap bands', () => {
    expect(masteryBand(95)).toBe('mastered');
    expect(masteryBand(72)).toBe('stable');
    expect(masteryBand(60)).toBe('fair');
    expect(masteryBand(40)).toBe('weak');
    expect(masteryBand(10)).toBe('critical');
  });

  it('expects more time for calculation and harder items', () => {
    expect(expectedSeconds('calculation', 3)).toBeGreaterThan(expectedSeconds('concept', 3));
    expect(expectedSeconds('concept', 5)).toBeGreaterThan(expectedSeconds('concept', 1));
  });
});

describe('computeThreeCircles', () => {
  it('reports no data before any attempt', () => {
    const circles = computeThreeCircles([], [], [], NOW);
    expect(circles.hasData).toBe(false);
    expect(circles.stable).toBe(false);
  });

  it('flags retention as the weakest circle when reviews have lapsed', () => {
    const attempts = attemptSeries(14, (i) => ({
      questionId: `q${i}`, // every item seen once → no repeat evidence
      correct: true,
      confidence: 'certain',
      elapsedMs: 20_000,
    }));
    const states = attempts.map((a) =>
      makeState({
        questionId: a.questionId,
        streak: 1,
        intervalDays: 1,
        lastReviewedAt: NOW - 30 * 86_400_000,
        lastCorrect: true,
      }),
    );
    const circles = computeThreeCircles(attempts, states, [], NOW);
    expect(circles.weakest).toBe('retention');
    expect(circles.retention).toBeLessThan(circles.concept);
  });

  it('does not paint a full circle from a single correct answer', () => {
    const circles = computeThreeCircles(
      [makeAttempt({ correct: true, confidence: 'certain', elapsedMs: 20_000 })],
      [],
      [],
      NOW,
    );
    expect(circles.hasData).toBe(true);
    expect(circles.concept).toBeLessThan(80);
  });

  it('never lets the overlap exceed the weakest circle', () => {
    const attempts = attemptSeries(20, (i) => ({
      questionId: `q${i % 6}`,
      correct: i % 5 !== 0,
      confidence: 'unsure',
    }));
    const circles = computeThreeCircles(attempts, [], [], NOW);
    expect(circles.overlap).toBeLessThanOrEqual(
      Math.min(circles.concept, circles.retention, circles.performance) + 0.001,
    );
  });

  it('only calls the user stable when all three circles clear the threshold', () => {
    const circles = computeThreeCircles(
      attemptSeries(24, (i) => ({
        questionId: `q${i % 6}`,
        correct: true,
        confidence: 'certain',
        elapsedMs: 20_000,
      })),
      Array.from({ length: 6 }, (_, i) =>
        makeState({
          questionId: `q${i}`,
          streak: 5,
          intervalDays: 30,
          lastReviewedAt: NOW - 86_400_000,
        }),
      ),
      [],
      NOW,
    );
    const min = Math.min(circles.concept, circles.retention, circles.performance);
    expect(circles.stable).toBe(min >= STABLE_THRESHOLD);
  });
});
