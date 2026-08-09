/**
 * Weakness ranking (§5, §13).
 *
 * Feeds two things: the /weakness screen, and the weighting the daily-set
 * builder uses to decide which concepts get extra questions tomorrow.
 */
import type { Attempt } from '../../storage/types';
import type { MinorTopicStats, SubjectStats } from './stats';

export interface WeaknessItem {
  /** Minor topic id — the granularity users can actually act on. */
  minorTopicId: string;
  minorTopicName: string;
  majorTopicId: string;
  majorTopicName: string;
  subjectId: string;
  subjectName: string;
  mastery: number;
  accuracy: number;
  recentAccuracy: number;
  attempts: number;
  wrongCount: number;
  riskyCount: number;
  /** 0–100. Higher = spend time here first. */
  priority: number;
  /** Concept ids inside this topic, weakest first — used to target question selection. */
  weakConceptIds: string[];
  reason: string;
}

/** Below this many attempts a topic is "unknown" rather than "weak". */
export const MIN_ATTEMPTS_FOR_WEAKNESS = 3;

export function rankWeaknesses(subjects: SubjectStats[]): WeaknessItem[] {
  const items: WeaknessItem[] = [];
  for (const subject of subjects) {
    for (const major of subject.majorTopics) {
      for (const minor of major.minorTopics) {
        if (minor.attempts === 0) continue;
        items.push(toWeaknessItem(minor, major.name, subject.id, subject.name));
      }
    }
  }
  return items.sort((a, b) => b.priority - a.priority);
}

function toWeaknessItem(
  minor: MinorTopicStats,
  majorTopicName: string,
  subjectId: string,
  subjectName: string,
): WeaknessItem {
  const gap = 100 - minor.mastery.score;
  // Confidence in the estimate — three attempts is a hint, twenty is a verdict.
  const evidence = minor.attempts / (minor.attempts + 4);
  // A confident wrong answer counts double: it is the misconception that will
  // survive into the exam hall unless it is hunted down.
  const riskBoost = Math.min(25, minor.riskyCount * 8);
  const recentDrop = Math.max(0, minor.accuracy - minor.recentAccuracy) * 0.2;
  const priority = clamp(gap * (0.55 + 0.45 * evidence) + riskBoost + recentDrop, 0, 100);

  const weakConceptIds = [...minor.concepts]
    .filter((c) => c.attempts > 0)
    .sort((a, b) => a.mastery.score - b.mastery.score)
    .map((c) => c.id);

  return {
    minorTopicId: minor.id,
    minorTopicName: minor.name,
    majorTopicId: minor.majorTopicId,
    majorTopicName,
    subjectId,
    subjectName,
    mastery: minor.mastery.score,
    accuracy: minor.accuracy,
    recentAccuracy: minor.recentAccuracy,
    attempts: minor.attempts,
    wrongCount: minor.wrongCount,
    riskyCount: minor.riskyCount,
    priority: round1(priority),
    weakConceptIds,
    reason: explain(minor),
  };
}

function explain(minor: MinorTopicStats): string {
  if (minor.attempts < MIN_ATTEMPTS_FOR_WEAKNESS) return '표본이 적어 추가 확인이 필요합니다.';
  if (minor.riskyCount >= 2) return `확신했는데 틀린 문제가 ${minor.riskyCount}개 — 오개념 가능성이 높습니다.`;
  if (minor.recentAccuracy + 15 < minor.accuracy) return '최근 정답률이 이전보다 떨어졌습니다.';
  if (minor.mastery.components.retention < 45) return '정답은 맞히지만 기억 유지가 약합니다.';
  if (minor.mastery.components.speed < 40) return '정답률은 나쁘지 않지만 풀이 속도가 느립니다.';
  if (minor.accuracy < 50) return '정답률 자체가 낮습니다. 개념부터 다시 보세요.';
  return '숙련도가 목표치에 미치지 못합니다.';
}

/** Concept-level weakness weights consumed by the daily-set builder (§13). */
export function conceptWeights(subjects: SubjectStats[]): Map<string, number> {
  const weights = new Map<string, number>();
  for (const subject of subjects) {
    for (const major of subject.majorTopics) {
      for (const minor of major.minorTopics) {
        for (const concept of minor.concepts) {
          if (concept.attempts === 0) continue;
          const gap = (100 - concept.mastery.score) / 100;
          const evidence = concept.attempts / (concept.attempts + 3);
          const risk = Math.min(1, concept.riskyCount * 0.3);
          weights.set(concept.id, clamp(gap * (0.5 + 0.5 * evidence) + risk, 0, 2));
        }
      }
    }
  }
  return weights;
}

export interface RiskyMistake {
  questionId: string;
  subjectId: string;
  minorTopicId: string;
  at: number;
  count: number;
}

/** `confidence = HIGH && incorrect` — the review list that matters most (§24). */
export function riskyMistakes(attempts: Attempt[]): RiskyMistake[] {
  const byQuestion = new Map<string, RiskyMistake>();
  for (const a of attempts) {
    if (a.correct || a.confidence !== 'certain') continue;
    const existing = byQuestion.get(a.questionId);
    if (existing) {
      existing.count += 1;
      existing.at = Math.max(existing.at, a.at);
    } else {
      byQuestion.set(a.questionId, {
        questionId: a.questionId,
        subjectId: a.subjectId,
        minorTopicId: a.minorTopicId,
        at: a.at,
        count: 1,
      });
    }
  }
  return [...byQuestion.values()].sort((a, b) => b.count - a.count || b.at - a.at);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
