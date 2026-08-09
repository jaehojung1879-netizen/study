/** Creation + persistence of practice sessions (daily set, drills, calculation training). */
import type { Question } from '../../exam/types';
import type { PracticeSession, StudyMode } from '../../storage/types';
import type { StudyContextValue } from '../../app/StudyProvider';
import { newId } from '../../app/StudyProvider';
import { buildDailySet } from '../../learning/scheduler/dailySet';
import { dateKey } from '../../learning/utils/date';

/**
 * Returns today's set, building it once per day. Rebuilding is deliberately
 * avoided mid-day: the composition is part of the plan the user is working
 * through, and reshuffling on reload would break the 100-question contract.
 */
export async function ensureTodaySession(study: StudyContextValue): Promise<PracticeSession> {
  const today = dateKey();
  const existing =
    study.sessions.find((s) => s.dateKey === today && s.mode === 'practice') ??
    (await study.storage.findSessionByDate(study.index.examId, today, 'practice'));
  if (existing) return existing;

  const result = buildDailySet({
    config: study.index.config,
    questions: study.index.questions,
    states: study.states,
    attempts: study.attempts,
    subjectStats: study.analytics.subjects,
    now: Date.now(),
    salt: study.settings.selectionSalt,
    totalOverride: study.settings.dailyGoalOverride,
  });

  const session: PracticeSession = {
    id: newId('sess'),
    examId: study.index.examId,
    mode: 'practice',
    dateKey: today,
    questionIds: result.questionIds,
    buckets: result.buckets,
    cursor: 0,
    answeredCount: 0,
    correctCount: 0,
    createdAt: Date.now(),
    planSummary: result.planSummary,
  };
  await study.saveSession(session);
  return session;
}

/** Ad-hoc session over a caller-chosen question list (weakness drill, calculation drill, 오답 재도전). */
export async function createCustomSession(
  study: StudyContextValue,
  questions: Question[],
  mode: StudyMode,
  planSummary: string,
): Promise<PracticeSession> {
  const session: PracticeSession = {
    id: newId('sess'),
    examId: study.index.examId,
    mode,
    dateKey: dateKey(),
    questionIds: questions.map((q) => q.id),
    buckets: questions.map(() => 'weakness'),
    cursor: 0,
    answeredCount: 0,
    correctCount: 0,
    createdAt: Date.now(),
    planSummary,
  };
  await study.saveSession(session);
  return session;
}
