/**
 * Mock exam composition, grading and pass judgement (§20, §21).
 *
 * Every structural number — subject counts, duration, 과락/합격 thresholds —
 * comes from `ExamConfig`. Nothing here knows it is 공인중개사.
 */
import type { ExamConfig, Question } from '../../exam/types';
import type { MockItemResult, MockResult, MockSession, MockSubjectScore } from '../../storage/types';
import { expectedSeconds } from '../mastery/masteryScore';
import { createRng, shuffle } from '../utils/random';

export interface PassJudgement {
  overallPercent: number;
  passed: boolean;
  failedSubjectIds: string[];
  /** Human-readable verdict for the result screen. */
  verdict: string;
}

/**
 * §20: 과락 (any subject under the floor) beats the average — a 90/30 split fails
 * even though the average clears 60.
 */
export function evaluatePass(config: ExamConfig, subjects: MockSubjectScore[]): PassJudgement {
  const graded = subjects.filter((s) => s.total > 0);
  const overallPercent = graded.length
    ? round1(graded.reduce((sum, s) => sum + s.percent, 0) / graded.length)
    : 0;
  const failedSubjectIds = graded
    .filter((s) => s.percent < config.passRule.perSubjectMinPercent)
    .map((s) => s.subjectId);
  const meetsAverage = overallPercent >= config.passRule.overallAverageMinPercent;
  const passed = failedSubjectIds.length === 0 && meetsAverage;

  let verdict: string;
  if (passed) {
    verdict = '합격 기준 충족';
  } else if (failedSubjectIds.length > 0) {
    const names = failedSubjectIds
      .map((id) => config.subjects.find((s) => s.id === id)?.shortName ?? id)
      .join(', ');
    verdict = `과락 — ${names} (${config.passRule.perSubjectMinPercent}점 미만)`;
  } else {
    verdict = `평균 미달 — ${overallPercent}점 / ${config.passRule.overallAverageMinPercent}점`;
  }
  return { overallPercent, passed, failedSubjectIds, verdict };
}

export function scoreSubjects(
  config: ExamConfig,
  items: MockItemResult[],
  minPercent = config.passRule.perSubjectMinPercent,
): MockSubjectScore[] {
  return config.subjects.map((subject) => {
    const subjectItems = items.filter((i) => i.subjectId === subject.id);
    const correct = subjectItems.filter((i) => i.correct).length;
    const total = subjectItems.length;
    const percent = total ? round1((correct / total) * 100) : 0;
    return { subjectId: subject.id, correct, total, percent, failed: total > 0 && percent < minPercent };
  });
}

export interface GradeMockInput {
  config: ExamConfig;
  session: MockSession;
  questions: Map<string, Question>;
  now: number;
}

export function gradeMock(input: GradeMockInput): MockResult {
  const { config, session, questions, now } = input;
  const items: MockItemResult[] = session.questionIds.map((questionId) => {
    const question = questions.get(questionId);
    const selected = session.answers[questionId] ?? -1;
    return {
      questionId,
      subjectId: question?.subjectId ?? 'unknown',
      selected,
      correct: !!question && selected === question.answer,
      confidence: session.confidences[questionId] ?? 'guess',
      elapsedMs: session.perQuestionMs[questionId] ?? 0,
      flagged: session.flagged.includes(questionId),
    };
  });

  const subjects = scoreSubjects(config, items);
  const judgement = evaluatePass(config, subjects);

  return {
    id: session.id,
    examId: session.examId,
    startedAt: session.startedAt,
    finishedAt: now,
    durationMs: Math.max(0, now - session.startedAt),
    subjects: subjects.map((s) => ({ ...s, failed: judgement.failedSubjectIds.includes(s.subjectId) })),
    overallPercent: judgement.overallPercent,
    passed: judgement.passed,
    failedSubjectIds: judgement.failedSubjectIds,
    items,
  };
}

/** Builds a full mock paper honouring each subject's real item count. */
export function buildMockSet(config: ExamConfig, questions: Question[], seed: string): string[] {
  const out: string[] = [];
  for (const subject of config.subjects) {
    const rng = createRng(`${seed}|${subject.id}`);
    const pool = questions.filter((q) => q.subjectId === subject.id && !q.needsReview);
    const picked = shuffle(pool, rng).slice(0, subject.examQuestionCount);
    out.push(...picked.map((q) => q.id));
  }
  return out;
}

export interface MockAnalysis {
  /** Correct but confidence === 'guess' — luck, not mastery (§20). */
  luckyCorrect: MockItemResult[];
  /** Wrong while confident — the misconception list. */
  riskyWrong: MockItemResult[];
  /** Took more than 1.6× the expected time. */
  slowItems: MockItemResult[];
  unanswered: MockItemResult[];
  averageSecondsPerItem: number;
}

export function analyseMock(result: MockResult, questions: Map<string, Question>): MockAnalysis {
  const slowItems = result.items.filter((item) => {
    const q = questions.get(item.questionId);
    if (!q || item.elapsedMs <= 0) return false;
    return item.elapsedMs > expectedSeconds(q.questionType, q.difficulty) * 1000 * 1.6;
  });
  const answered = result.items.filter((i) => i.selected >= 0);
  return {
    luckyCorrect: result.items.filter((i) => i.correct && i.confidence === 'guess'),
    riskyWrong: result.items.filter((i) => !i.correct && i.confidence === 'certain'),
    slowItems,
    unanswered: result.items.filter((i) => i.selected < 0),
    averageSecondsPerItem: answered.length
      ? Math.round(answered.reduce((sum, i) => sum + i.elapsedMs, 0) / answered.length / 1000)
      : 0,
  };
}

export interface TrendPoint {
  index: number;
  finishedAt: number;
  overallPercent: number;
  perSubject: Record<string, number>;
  passed: boolean;
}

export interface MockTrend {
  points: TrendPoint[];
  /** Averages over the last 3, last 5, and all sittings (§21). */
  averages: {
    last3: number | null;
    last5: number | null;
    all: number | null;
  };
  perSubjectAverages: Record<string, { last3: number | null; last5: number | null; all: number | null }>;
  /** "안정권" needs a *sustained* result, not one good day. */
  stable: boolean;
  stabilityNote: string;
}

export function buildMockTrend(config: ExamConfig, results: MockResult[]): MockTrend {
  const ordered = [...results].sort((a, b) => a.finishedAt - b.finishedAt);
  const points: TrendPoint[] = ordered.map((r, index) => ({
    index: index + 1,
    finishedAt: r.finishedAt,
    overallPercent: r.overallPercent,
    perSubject: Object.fromEntries(r.subjects.map((s) => [s.subjectId, s.percent])),
    passed: r.passed,
  }));

  const overall = points.map((p) => p.overallPercent);
  const perSubjectAverages: MockTrend['perSubjectAverages'] = {};
  for (const subject of config.subjects) {
    const series = points.map((p) => p.perSubject[subject.id] ?? 0);
    perSubjectAverages[subject.id] = {
      last3: average(series.slice(-3)),
      last5: average(series.slice(-5)),
      all: average(series),
    };
  }

  const last3 = ordered.slice(-3);
  // Stable = at least 3 sittings, all of the last 3 passed, and the 3-sitting
  // average clears the bar with a small margin.
  const avgLast3 = average(overall.slice(-3));
  const stable =
    last3.length >= 3 &&
    last3.every((r) => r.passed) &&
    avgLast3 !== null &&
    avgLast3 >= config.passRule.overallAverageMinPercent + 5;

  return {
    points,
    averages: { last3: avgLast3, last5: average(overall.slice(-5)), all: average(overall) },
    perSubjectAverages,
    stable,
    stabilityNote: stabilityNote(config, ordered, stable),
  };
}

function stabilityNote(config: ExamConfig, ordered: MockResult[], stable: boolean): string {
  if (ordered.length === 0) return '모의시험 기록이 없습니다. 실전 감각은 모의시험으로만 측정됩니다.';
  if (ordered.length < 3) return `안정권 판정에는 최소 3회가 필요합니다. (현재 ${ordered.length}회)`;
  if (stable) return '최근 3회 연속 합격 기준을 넘겼습니다. 현재 페이스를 유지하세요.';
  const failed = ordered.slice(-3).filter((r) => !r.passed).length;
  if (failed > 0) return `최근 3회 중 ${failed}회가 합격 기준 미달입니다.`;
  return `최근 3회 평균이 목표선(${config.passRule.overallAverageMinPercent + 5}점)에 아직 못 미칩니다.`;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
