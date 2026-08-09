/**
 * The three-circle diagram (§4).
 *
 * A. 개념 이해   — do they know it right now?
 * B. 장기 기억   — does it survive a gap?
 * C. 실전 대응   — can they do it at exam speed, and do they know that they know?
 *
 * The overlap ("합격 안정영역") only lights up when *all three* clear the
 * threshold, which is the whole point: 80% accuracy with no retention and no
 * speed is not a pass.
 */
import type { Attempt, MockResult, QuestionState } from '../../storage/types';
import { computeMastery, type MasteryBreakdown } from './masteryScore';

export interface ThreeCircleScores {
  /** 0–100 each. */
  concept: number;
  retention: number;
  performance: number;
  /** Size of the stable overlap, 0–100. Bounded by the weakest circle. */
  overlap: number;
  stable: boolean;
  /** The circle to work on next. */
  weakest: 'concept' | 'retention' | 'performance';
  hasData: boolean;
}

/** All three circles must reach this for 합격 안정영역. */
export const STABLE_THRESHOLD = 70;

export function computeThreeCircles(
  attempts: Attempt[],
  states: QuestionState[],
  mockResults: MockResult[],
  now: number = Date.now(),
): ThreeCircleScores {
  const mastery: MasteryBreakdown = computeMastery(attempts, { states, now });
  if (!mastery.hasData) {
    return {
      concept: 0,
      retention: 0,
      performance: 0,
      overlap: 0,
      stable: false,
      weakest: 'concept',
      hasData: false,
    };
  }

  const c = mastery.components;
  const concept = c.recentAccuracy;
  const retention = 0.45 * c.repeatSuccess + 0.55 * c.retention;

  // Recent mock performance is the most honest evidence of 실전 대응; before the
  // first mock we fall back to speed + calibration only.
  const recentMocks = mockResults.slice(-3);
  const mockPercent =
    recentMocks.length > 0
      ? recentMocks.reduce((sum, m) => sum + m.overallPercent, 0) / recentMocks.length
      : null;
  const performance =
    mockPercent === null
      ? 0.6 * c.speed + 0.4 * c.calibration
      : 0.35 * c.speed + 0.25 * c.calibration + 0.4 * mockPercent;

  // Same evidence damping as the mastery score: one correct answer must not
  // paint a full circle. Without this the diagram reads "개념 이해 100" on day one.
  const damping = 0.6 + 0.4 * mastery.evidence;
  const scores = {
    concept: round1(concept * damping),
    retention: round1(retention * damping),
    performance: round1(performance * damping),
  };

  const weakest = (Object.keys(scores) as Array<keyof typeof scores>).reduce((min, key) =>
    scores[key] < scores[min] ? key : min,
  );

  // The overlap can never exceed the weakest circle, and shrinks further when
  // the circles are far apart (unbalanced preparation).
  const values = [scores.concept, scores.retention, scores.performance];
  const min = Math.min(...values);
  const spread = Math.max(...values) - min;
  const overlap = round1(Math.max(0, min - spread * 0.25));

  return {
    ...scores,
    overlap,
    stable: min >= STABLE_THRESHOLD,
    weakest,
    hasData: true,
  };
}

export const CIRCLE_LABELS: Record<'concept' | 'retention' | 'performance', { title: string; hint: string }> =
  {
    concept: { title: '개념 이해', hint: '정답률 · 개념 숙련도' },
    retention: { title: '장기 기억', hint: '반복 정답 · 기억 유지' },
    performance: { title: '실전 대응', hint: '속도 · 확신도 · 모의고사' },
  };

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
