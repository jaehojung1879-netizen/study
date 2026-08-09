/**
 * Aggregation of raw attempts into the numbers every screen reads:
 * per-subject / per-topic / per-concept statistics and the heatmap tree (§5).
 */
import type { MajorTopicNode, MinorTopicNode, Taxonomy } from '../../exam/types';
import type { Attempt, ErrorCause, QuestionState } from '../../storage/types';
import { computeMastery, masteryBand, type MasteryBand, type MasteryBreakdown } from '../mastery/masteryScore';

export interface ScopeStats {
  id: string;
  name: string;
  attempts: number;
  correct: number;
  /** All-time accuracy, 0–100. */
  accuracy: number;
  /** Accuracy over the last 10 attempts, 0–100. */
  recentAccuracy: number;
  avgElapsedMs: number;
  wrongCount: number;
  /** confidence === 'certain' && !correct */
  riskyCount: number;
  lastAttemptAt: number | null;
  nextReviewAt: number | null;
  distinctQuestions: number;
  mastery: MasteryBreakdown;
  band: MasteryBand;
}

export interface MinorTopicStats extends ScopeStats {
  majorTopicId: string;
  subjectId: string;
  concepts: ScopeStats[];
}

export interface MajorTopicStats extends ScopeStats {
  subjectId: string;
  minorTopics: MinorTopicStats[];
}

export interface SubjectStats extends ScopeStats {
  majorTopics: MajorTopicStats[];
}

export interface StatsInput {
  attempts: Attempt[];
  states: QuestionState[];
  taxonomy: Taxonomy;
  subjectNames: Record<string, string>;
  now?: number;
}

const RECENT_WINDOW = 10;

export function summarize(
  id: string,
  name: string,
  attempts: Attempt[],
  states: QuestionState[],
  now: number,
): ScopeStats {
  const ordered = [...attempts].sort((a, b) => a.at - b.at);
  const correct = ordered.filter((a) => a.correct).length;
  const recent = ordered.slice(-RECENT_WINDOW);
  const recentCorrect = recent.filter((a) => a.correct).length;
  const totalElapsed = ordered.reduce((sum, a) => sum + Math.max(0, a.elapsedMs), 0);
  const dueTimes = states.filter((s) => s.totalAttempts > 0).map((s) => s.dueAt);
  const mastery = computeMastery(ordered, { states, now });

  return {
    id,
    name,
    attempts: ordered.length,
    correct,
    accuracy: ordered.length ? round1((correct / ordered.length) * 100) : 0,
    recentAccuracy: recent.length ? round1((recentCorrect / recent.length) * 100) : 0,
    avgElapsedMs: ordered.length ? Math.round(totalElapsed / ordered.length) : 0,
    wrongCount: ordered.length - correct,
    riskyCount: ordered.filter((a) => a.confidence === 'certain' && !a.correct).length,
    lastAttemptAt: ordered.length ? ordered[ordered.length - 1].at : null,
    nextReviewAt: dueTimes.length ? Math.min(...dueTimes) : null,
    distinctQuestions: new Set(ordered.map((a) => a.questionId)).size,
    mastery,
    band: masteryBand(mastery.score),
  };
}

/** Full subject → major → minor → concept tree, including untouched nodes (mastery 0). */
export function buildTopicTree(input: StatsInput): SubjectStats[] {
  const now = input.now ?? Date.now();
  const byQuestionState = new Map(input.states.map((s) => [s.questionId, s]));

  const statesFor = (attempts: Attempt[]): QuestionState[] => {
    const ids = new Set(attempts.map((a) => a.questionId));
    const out: QuestionState[] = [];
    for (const id of ids) {
      const s = byQuestionState.get(id);
      if (s) out.push(s);
    }
    return out;
  };

  return input.taxonomy.subjects.map((subjectTaxonomy) => {
    const subjectAttempts = input.attempts.filter((a) => a.subjectId === subjectTaxonomy.subjectId);
    const majorTopics = subjectTaxonomy.majorTopics.map((major) =>
      buildMajor(major, subjectTaxonomy.subjectId, subjectAttempts, statesFor, now),
    );
    const base = summarize(
      subjectTaxonomy.subjectId,
      input.subjectNames[subjectTaxonomy.subjectId] ?? subjectTaxonomy.subjectId,
      subjectAttempts,
      statesFor(subjectAttempts),
      now,
    );
    return { ...base, majorTopics };
  });
}

function buildMajor(
  major: MajorTopicNode,
  subjectId: string,
  subjectAttempts: Attempt[],
  statesFor: (attempts: Attempt[]) => QuestionState[],
  now: number,
): MajorTopicStats {
  const majorAttempts = subjectAttempts.filter((a) => a.majorTopicId === major.id);
  const minorTopics = major.minorTopics.map((minor) =>
    buildMinor(minor, major.id, subjectId, majorAttempts, statesFor, now),
  );
  const base = summarize(major.id, major.name, majorAttempts, statesFor(majorAttempts), now);
  return { ...base, subjectId, minorTopics };
}

function buildMinor(
  minor: MinorTopicNode,
  majorTopicId: string,
  subjectId: string,
  majorAttempts: Attempt[],
  statesFor: (attempts: Attempt[]) => QuestionState[],
  now: number,
): MinorTopicStats {
  const minorAttempts = majorAttempts.filter((a) => a.minorTopicId === minor.id);
  const concepts = minor.concepts.map((concept) => {
    const conceptAttempts = minorAttempts.filter((a) => a.conceptIds.includes(concept.id));
    return summarize(concept.id, concept.name, conceptAttempts, statesFor(conceptAttempts), now);
  });
  const base = summarize(minor.id, minor.name, minorAttempts, statesFor(minorAttempts), now);
  return { ...base, majorTopicId, subjectId, concepts };
}

export interface OverallStats {
  attempts: number;
  correct: number;
  accuracy: number;
  distinctQuestions: number;
  totalTimeMs: number;
  riskyCount: number;
}

export function overallStats(attempts: Attempt[]): OverallStats {
  const correct = attempts.filter((a) => a.correct).length;
  return {
    attempts: attempts.length,
    correct,
    accuracy: attempts.length ? round1((correct / attempts.length) * 100) : 0,
    distinctQuestions: new Set(attempts.map((a) => a.questionId)).size,
    totalTimeMs: attempts.reduce((sum, a) => sum + Math.max(0, a.elapsedMs), 0),
    riskyCount: attempts.filter((a) => a.confidence === 'certain' && !a.correct).length,
  };
}

export const ERROR_CAUSE_LABELS: Record<ErrorCause, string> = {
  concept_unknown: '개념 자체를 몰랐음',
  memory_gap: '암기 부족',
  precedent_confusion: '판례 혼동',
  calculation_slip: '계산 실수',
  misread: '지문을 잘못 읽음',
  out_of_time: '시간 부족',
  guessed: '찍음',
};

export interface ErrorCauseSlice {
  cause: ErrorCause;
  label: string;
  count: number;
  percent: number;
}

/**
 * Why the user is losing marks — the difference between "민법 정답률 56%" and
 * "민법은 개념 부족보다 판례 혼동 비중이 높다" (§10).
 */
export function errorCauseBreakdown(attempts: Attempt[]): ErrorCauseSlice[] {
  const wrong = attempts.filter((a) => !a.correct && a.errorCause);
  const counts = new Map<ErrorCause, number>();
  for (const a of wrong) {
    counts.set(a.errorCause as ErrorCause, (counts.get(a.errorCause as ErrorCause) ?? 0) + 1);
  }
  const total = wrong.length;
  return [...counts.entries()]
    .map(([cause, count]) => ({
      cause,
      label: ERROR_CAUSE_LABELS[cause],
      count,
      percent: total ? round1((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export interface DailyActivity {
  dateKey: string;
  attempts: number;
  correct: number;
  accuracy: number;
}

export function dailyActivity(attempts: Attempt[], dateKeyOf: (at: number) => string): DailyActivity[] {
  const map = new Map<string, { attempts: number; correct: number }>();
  for (const a of attempts) {
    const key = dateKeyOf(a.at);
    const entry = map.get(key) ?? { attempts: 0, correct: 0 };
    entry.attempts += 1;
    if (a.correct) entry.correct += 1;
    map.set(key, entry);
  }
  return [...map.entries()]
    .map(([dateKey, v]) => ({
      dateKey,
      attempts: v.attempts,
      correct: v.correct,
      accuracy: v.attempts ? round1((v.correct / v.attempts) * 100) : 0,
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
