import { describe, expect, it } from 'vitest';
import {
  analyseMock,
  buildMockSet,
  buildMockTrend,
  evaluatePass,
  gradeMock,
  scoreSubjects,
} from '../src/learning/scoring/mock';
import type { MockResult, MockSession, MockSubjectScore } from '../src/storage/types';
import { makeQuestion, testConfig } from './helpers';

function subjectScore(subjectId: string, correct: number, total: number): MockSubjectScore {
  const percent = Math.round((correct / total) * 1000) / 10;
  return { subjectId, correct, total, percent, failed: false };
}

function mockResult(overrides: Partial<MockResult>): MockResult {
  return {
    id: 'm1',
    examId: 'test-exam',
    startedAt: 0,
    finishedAt: 1,
    durationMs: 1,
    subjects: [],
    overallPercent: 0,
    passed: false,
    failedSubjectIds: [],
    items: [],
    ...overrides,
  };
}

describe('evaluatePass', () => {
  it('passes when every subject clears 과락 and the average clears the bar', () => {
    const result = evaluatePass(testConfig, [subjectScore('subject-a', 30, 40), subjectScore('subject-b', 26, 40)]);
    expect(result.overallPercent).toBe(70);
    expect(result.passed).toBe(true);
  });

  it('fails on 과락 even when the average is high', () => {
    const result = evaluatePass(testConfig, [
      subjectScore('subject-a', 38, 40), // 95
      subjectScore('subject-b', 14, 40), // 35 → 과락
    ]);
    expect(result.overallPercent).toBe(65);
    expect(result.passed).toBe(false);
    expect(result.failedSubjectIds).toEqual(['subject-b']);
    expect(result.verdict).toContain('과락');
  });

  it('fails on the average even with no 과락', () => {
    const result = evaluatePass(testConfig, [subjectScore('subject-a', 22, 40), subjectScore('subject-b', 20, 40)]);
    expect(result.failedSubjectIds).toHaveLength(0);
    expect(result.passed).toBe(false);
    expect(result.verdict).toContain('평균 미달');
  });

  it('treats exactly-at-threshold as a pass', () => {
    const result = evaluatePass(testConfig, [subjectScore('subject-a', 16, 40), subjectScore('subject-b', 32, 40)]);
    expect(result.overallPercent).toBe(60);
    expect(result.passed).toBe(true);
  });
});

describe('gradeMock', () => {
  const questions = new Map([
    ['qa1', makeQuestion({ id: 'qa1', subjectId: 'subject-a', answer: 0 })],
    ['qa2', makeQuestion({ id: 'qa2', subjectId: 'subject-a', answer: 1 })],
    ['qb1', makeQuestion({ id: 'qb1', subjectId: 'subject-b', answer: 2 })],
    ['qb2', makeQuestion({ id: 'qb2', subjectId: 'subject-b', answer: 3 })],
  ]);

  const session: MockSession = {
    id: 'm1',
    examId: 'test-exam',
    questionIds: ['qa1', 'qa2', 'qb1', 'qb2'],
    answers: { qa1: 0, qa2: 0, qb1: 2 }, // qb2 left blank
    confidences: { qa1: 'certain', qa2: 'certain', qb1: 'guess' },
    flagged: ['qb2'],
    perQuestionMs: { qa1: 30_000, qa2: 200_000, qb1: 20_000 },
    cursor: 3,
    startedAt: 1_000,
    endsAt: 6_001_000,
  };

  it('grades unanswered items as wrong and scores each subject', () => {
    const result = gradeMock({ config: testConfig, session, questions, now: 601_000 });
    expect(result.subjects.find((s) => s.subjectId === 'subject-a')?.percent).toBe(50);
    expect(result.subjects.find((s) => s.subjectId === 'subject-b')?.percent).toBe(50);
    expect(result.overallPercent).toBe(50);
    expect(result.passed).toBe(false);
    expect(result.items.find((i) => i.questionId === 'qb2')?.selected).toBe(-1);
    expect(result.durationMs).toBe(600_000);
  });

  it('separates lucky guesses, confident mistakes, slow items and blanks', () => {
    const result = gradeMock({ config: testConfig, session, questions, now: 601_000 });
    const analysis = analyseMock(result, questions);
    expect(analysis.luckyCorrect.map((i) => i.questionId)).toEqual(['qb1']);
    expect(analysis.riskyWrong.map((i) => i.questionId)).toEqual(['qa2']);
    expect(analysis.slowItems.map((i) => i.questionId)).toEqual(['qa2']);
    expect(analysis.unanswered.map((i) => i.questionId)).toEqual(['qb2']);
  });

  it('defaults a missing confidence to guess so it is never counted as mastery', () => {
    const bare: MockSession = { ...session, confidences: {} };
    const result = gradeMock({ config: testConfig, session: bare, questions, now: 601_000 });
    expect(result.items.every((i) => i.confidence === 'guess')).toBe(true);
  });
});

describe('scoreSubjects', () => {
  it('marks a subject failed below the configured floor', () => {
    const items = [
      { questionId: 'q1', subjectId: 'subject-a', selected: 0, correct: true, confidence: 'certain' as const, elapsedMs: 0, flagged: false },
      ...Array.from({ length: 4 }, (_, i) => ({
        questionId: `q${i + 2}`,
        subjectId: 'subject-a',
        selected: 1,
        correct: false,
        confidence: 'unsure' as const,
        elapsedMs: 0,
        flagged: false,
      })),
    ];
    const [a] = scoreSubjects(testConfig, items);
    expect(a.percent).toBe(20);
    expect(a.failed).toBe(true);
  });
});

describe('buildMockSet', () => {
  it('draws each subject up to its real exam item count', () => {
    const bank = [
      ...Array.from({ length: 10 }, (_, i) => makeQuestion({ id: `a${i}`, subjectId: 'subject-a' })),
      ...Array.from({ length: 10 }, (_, i) => makeQuestion({ id: `b${i}`, subjectId: 'subject-b' })),
    ];
    const ids = buildMockSet(testConfig, bank, 'seed');
    expect(ids).toHaveLength(testConfig.mock.totalQuestions);
    expect(ids.filter((id) => id.startsWith('a'))).toHaveLength(4);
    expect(ids.filter((id) => id.startsWith('b'))).toHaveLength(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('skips questions flagged for review', () => {
    const bank = Array.from({ length: 10 }, (_, i) =>
      makeQuestion({ id: `a${i}`, subjectId: 'subject-a', needsReview: i === 0 }),
    );
    expect(buildMockSet(testConfig, bank, 'seed')).not.toContain('a0');
  });
});

describe('buildMockTrend', () => {
  const results = (percents: number[]): MockResult[] =>
    percents.map((p, i) =>
      mockResult({
        id: `m${i}`,
        finishedAt: i,
        overallPercent: p,
        passed: p >= 60,
        subjects: [subjectScore('subject-a', Math.round(p * 0.4), 40), subjectScore('subject-b', Math.round(p * 0.4), 40)],
      }),
    );

  it('reports last-3 / last-5 / all averages', () => {
    const trend = buildMockTrend(testConfig, results([40, 50, 60, 70, 80]));
    expect(trend.averages.last3).toBe(70);
    expect(trend.averages.last5).toBe(60);
    expect(trend.averages.all).toBe(60);
  });

  it('does not call a single high score "안정권"', () => {
    const trend = buildMockTrend(testConfig, results([40, 45, 90]));
    expect(trend.stable).toBe(false);
  });

  it('requires three sustained passes above the bar plus margin', () => {
    expect(buildMockTrend(testConfig, results([72, 74, 76])).stable).toBe(true);
    expect(buildMockTrend(testConfig, results([61, 62, 63])).stable).toBe(false);
    expect(buildMockTrend(testConfig, results([80, 80])).stable).toBe(false);
  });

  it('handles an empty history', () => {
    const trend = buildMockTrend(testConfig, []);
    expect(trend.points).toHaveLength(0);
    expect(trend.averages.all).toBeNull();
    expect(trend.stable).toBe(false);
  });
});
