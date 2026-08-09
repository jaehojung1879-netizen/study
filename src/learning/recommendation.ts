/**
 * Today's recommendation (§23).
 *
 * Pure rules over the numbers the app already has — no network, no model call.
 * It must produce a useful sentence on day 1 with almost no data, and a sharper
 * one after a month of records.
 */
import type { ExamConfig } from '../exam/types';
import type { SubjectStats } from './analytics/stats';
import type { WeaknessItem } from './analytics/weakness';
import type { ThreeCircleScores } from './mastery/threeCircles';
import type { MockTrend } from './scoring/mock';
import type { PhaseInfo } from './scheduler/phase';
import type { ErrorCauseSlice } from './analytics/stats';
import type { SelectionBucket } from './scheduler/dailySet';

export interface RecommendationInput {
  config: ExamConfig;
  phase: PhaseInfo;
  subjects: SubjectStats[];
  weaknesses: WeaknessItem[];
  circles: ThreeCircleScores;
  mockTrend: MockTrend;
  errorCauses: ErrorCauseSlice[];
  todayAnswered: number;
  todayGoal: number;
  /** Composition of today's set, used to say what was actually added. */
  todayBreakdown?: Record<SelectionBucket, number>;
  streakDays: number;
  dueReviewCount: number;
  riskyCount: number;
}

export interface Recommendation {
  /** The one sentence shown on the dashboard. */
  headline: string;
  /** Up to three supporting lines. */
  notes: string[];
  tone: 'neutral' | 'warning' | 'positive';
}

export function buildRecommendation(input: RecommendationInput): Recommendation {
  const notes: string[] = [];
  const totalAttempts = input.subjects.reduce((sum, s) => sum + s.attempts, 0);

  // Cold start — say something honest and actionable instead of inventing analysis.
  if (totalAttempts < 20) {
    return {
      headline: `${input.phase.phase.label} · 아직 진단 데이터가 부족합니다. 오늘 세트를 끝내면 취약영역 분석이 시작됩니다.`,
      notes: [
        `시험까지 D-${Math.max(0, input.phase.daysLeft)}일. ${input.phase.phase.description}`,
        '문제를 푼 뒤 "확실함 / 헷갈림 / 찍음"을 반드시 눌러주세요. 이 값이 취약영역 판정의 핵심입니다.',
      ],
      tone: 'neutral',
    };
  }

  const top = input.weaknesses.slice(0, 2);
  const weakestNames = top.map((w) => w.minorTopicName);
  const addedForWeakness = input.todayBreakdown
    ? input.todayBreakdown.weakness + input.todayBreakdown.recentWrong
    : 0;

  let headline: string;
  let tone: Recommendation['tone'] = 'neutral';

  if (input.riskyCount >= 3) {
    headline = `확신했는데 틀린 문제가 ${input.riskyCount}개 있습니다. 단순 오답보다 위험한 오개념이므로 /review의 "위험 오답"부터 처리하세요.`;
    tone = 'warning';
  } else if (weakestNames.length > 0 && addedForWeakness > 0) {
    headline = `오늘은 ${weakestNames.join('와(과) ')}의 정답률이 낮습니다. 관련 문제 ${addedForWeakness}문제가 오늘 세트에 추가되었습니다.`;
    tone = 'warning';
  } else if (input.circles.hasData && input.circles.weakest === 'performance' && input.circles.performance < 60) {
    const gap = speedGap(input.subjects);
    headline =
      gap !== null
        ? `정답률은 유지되고 있지만 평균 풀이속도가 실전 목표보다 ${gap}% 느립니다. 시간 압박 상태의 연습이 필요합니다.`
        : '개념은 잡혔지만 실전 대응(속도·확신도) 점수가 낮습니다. 모의시험으로 확인하세요.';
    tone = 'warning';
  } else if (input.circles.hasData && input.circles.weakest === 'retention' && input.circles.retention < 60) {
    headline = `당일 정답률은 ${Math.round(input.circles.concept)}점인데 장기 기억은 ${Math.round(input.circles.retention)}점입니다. 새 문제보다 복습 예정 문제를 먼저 끝내세요.`;
    tone = 'warning';
  } else if (input.circles.stable && input.mockTrend.stable) {
    headline = '세 영역 모두 안정 구간입니다. 현재 페이스를 유지하고 기출 회독 위주로 전환하세요.';
    tone = 'positive';
  } else if (weakestNames.length > 0) {
    headline = `${weakestNames[0]} 숙련도가 ${Math.round(top[0].mastery)}점으로 가장 낮습니다. 오늘 이 영역을 집중적으로 다루세요.`;
  } else {
    headline = `${input.phase.phase.label} 구간입니다. ${input.phase.phase.description}`;
  }

  if (input.dueReviewCount > 0) {
    notes.push(`오늘 복습 예정 문제 ${input.dueReviewCount}문항이 대기 중입니다.`);
  }

  const dominantCause = input.errorCauses[0];
  if (dominantCause && dominantCause.percent >= 30 && dominantCause.count >= 3) {
    notes.push(
      `오답 원인 1위는 "${dominantCause.label}"(${dominantCause.percent}%)입니다. 문제 수보다 이 습관을 먼저 고치세요.`,
    );
  }

  const subjectGap = subjectImbalance(input.subjects);
  if (subjectGap) notes.push(subjectGap);

  if (input.mockTrend.points.length === 0 && input.phase.daysLeft <= 90) {
    notes.push('아직 모의시험 기록이 없습니다. 실전 시간 감각은 /mock에서만 측정됩니다.');
  } else if (input.mockTrend.points.length > 0) {
    notes.push(input.mockTrend.stabilityNote);
  }

  if (input.todayAnswered < input.todayGoal) {
    notes.push(`오늘 ${input.todayAnswered}/${input.todayGoal}문항 완료. 남은 ${input.todayGoal - input.todayAnswered}문항이 오늘의 목표입니다.`);
  } else if (input.streakDays >= 3) {
    notes.push(`${input.streakDays}일 연속 학습 중입니다. 오늘 목표는 이미 달성했습니다.`);
  }

  return { headline, notes: notes.slice(0, 3), tone };
}

/** How much slower than the exam pace the user is, in percent. */
function speedGap(subjects: SubjectStats[]): number | null {
  const scored = subjects.filter((s) => s.attempts >= 10);
  if (scored.length === 0) return null;
  const speed = scored.reduce((sum, s) => sum + s.mastery.components.speed, 0) / scored.length;
  if (speed >= 70) return null;
  // speed 100 = at or under target pace; map the shortfall onto a "% slower" figure.
  return Math.round((70 - speed) * 0.6);
}

function subjectImbalance(subjects: SubjectStats[]): string | null {
  const scored = subjects.filter((s) => s.attempts >= 10);
  if (scored.length < 2) return null;
  const sorted = [...scored].sort((a, b) => a.mastery.score - b.mastery.score);
  const weakest = sorted[0];
  const strongest = sorted[sorted.length - 1];
  const gap = strongest.mastery.score - weakest.mastery.score;
  if (gap < 12) return null;
  return `${weakest.name} ${Math.round(weakest.mastery.score)}점 / ${strongest.name} ${Math.round(strongest.mastery.score)}점 — 과락 위험은 항상 낮은 과목에서 나옵니다.`;
}
