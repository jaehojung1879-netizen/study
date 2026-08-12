/**
 * Single source of truth for the running app: opens storage, loads the active
 * exam bundle, keeps records in memory and derives every analytic the screens
 * read. Screens never touch storage directly.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Question } from '../exam/types';
import { DEFAULT_EXAM_ID, ExamIndex, getExamIndex, listExams } from '../exam/registry';
import {
  defaultSettings,
  getStorage,
  type AppSettings,
  type Attempt,
  type Confidence,
  type ErrorCause,
  type Flashcard,
  type MockResult,
  type PracticeSession,
  type QuestionState,
  type StudyMode,
  type StudyStorage,
} from '../storage';
import { buildTopicTree, errorCauseBreakdown, overallStats, type SubjectStats } from '../learning/analytics/stats';
import { rankWeaknesses, type WeaknessItem } from '../learning/analytics/weakness';
import { computeThreeCircles, type ThreeCircleScores } from '../learning/mastery/threeCircles';
import { expectedSeconds } from '../learning/mastery/masteryScore';
import { buildMockTrend, type MockTrend } from '../learning/scoring/mock';
import { phaseInfo, type PhaseInfo } from '../learning/scheduler/phase';
import { scheduleNext } from '../learning/spacedRepetition/schedule';
import { buildRecommendation, type Recommendation } from '../learning/recommendation';
import { sustainableDailyTotal, type SelectionBucket } from '../learning/scheduler/dailySet';
import { dateKey, daysUntilExam, studyStreak } from '../learning/utils/date';

export interface RecordAttemptInput {
  question: Question;
  sessionId: string;
  mode: StudyMode;
  selected: number;
  confidence: Confidence;
  elapsedMs: number;
  errorCause?: ErrorCause;
}

export interface Analytics {
  subjects: SubjectStats[];
  weaknesses: WeaknessItem[];
  circles: ThreeCircleScores;
  overall: ReturnType<typeof overallStats>;
  errorCauses: ReturnType<typeof errorCauseBreakdown>;
  mockTrend: MockTrend;
  phase: PhaseInfo;
  streakDays: number;
  dueReviewCount: number;
  todayAttempts: Attempt[];
  recommendation: Recommendation;
}

export interface StudyContextValue {
  ready: boolean;
  storageKind: StudyStorage['kind'];
  storageWarning: string | null;
  index: ExamIndex;
  exams: ReturnType<typeof listExams>;
  settings: AppSettings;
  attempts: Attempt[];
  states: QuestionState[];
  stateOf: (questionId: string) => QuestionState | undefined;
  sessions: PracticeSession[];
  mockResults: MockResult[];
  flashcards: Flashcard[];
  analytics: Analytics;
  daysLeft: number;
  /** The goal actually used — clamped to what the question bank can serve. */
  dailyGoal: number;
  /** What the user asked for, before clamping. Equal to `dailyGoal` when the bank is big enough. */
  requestedDailyGoal: number;

  storage: StudyStorage;
  reload: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  recordAttempt: (input: RecordAttemptInput) => Promise<Attempt>;
  setErrorCause: (attemptId: string, cause: ErrorCause) => Promise<void>;
  toggleBookmark: (question: Question) => Promise<void>;
  saveSession: (session: PracticeSession) => Promise<void>;
  addFlashcard: (card: Omit<Flashcard, 'id' | 'createdAt' | 'dueAt' | 'streak'>) => Promise<void>;
  removeFlashcard: (id: string) => Promise<void>;
  reviewFlashcard: (card: Flashcard, remembered: boolean) => Promise<void>;
}

const StudyContext = createContext<StudyContextValue | null>(null);

export function useStudy(): StudyContextValue {
  const ctx = useContext(StudyContext);
  if (!ctx) throw new Error('useStudy must be used inside <StudyProvider>');
  return ctx;
}

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function StudyProvider({ children }: { children: ReactNode }): JSX.Element {
  const [storage, setStorage] = useState<StudyStorage | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => defaultSettings(DEFAULT_EXAM_ID));
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [states, setStates] = useState<QuestionState[]>([]);
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [mockResults, setMockResults] = useState<MockResult[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [ready, setReady] = useState(false);
  const mounted = useRef(true);

  const index = useMemo(() => {
    return getExamIndex(settings.activeExamId) ?? getExamIndex(DEFAULT_EXAM_ID)!;
  }, [settings.activeExamId]);

  const loadAll = useCallback(async (store: StudyStorage, examId: string) => {
    const [nextAttempts, nextStates, nextSessions, nextMocks, nextCards] = await Promise.all([
      store.listAttempts({ examId }),
      store.listQuestionStates(examId),
      store.listSessions(examId),
      store.listMockResults(examId),
      store.listFlashcards(examId),
    ]);
    if (!mounted.current) return;
    setAttempts(nextAttempts);
    setStates(nextStates);
    setSessions(nextSessions);
    setMockResults(nextMocks);
    setFlashcards(nextCards);
  }, []);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const store = await getStorage();
      if (!mounted.current) return;
      if (store.kind === 'memory') {
        setStorageWarning(
          '이 브라우저에서 IndexedDB를 사용할 수 없어 학습기록이 저장되지 않습니다. 시크릿 모드를 해제하거나 다른 브라우저를 사용하세요.',
        );
      }
      let stored = await store.getSettings();
      if (!stored || !getExamIndex(stored.activeExamId)) {
        stored = defaultSettings(DEFAULT_EXAM_ID);
        await store.saveSettings(stored);
      }
      if (!mounted.current) return;
      setSettings(stored);
      setStorage(store);
      await loadAll(store, stored.activeExamId);
      if (mounted.current) setReady(true);
    })();
    return () => {
      mounted.current = false;
    };
  }, [loadAll]);

  const reload = useCallback(async () => {
    if (!storage) return;
    await loadAll(storage, settings.activeExamId);
  }, [storage, settings.activeExamId, loadAll]);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      if (storage) {
        await storage.saveSettings(next);
        if (patch.activeExamId && patch.activeExamId !== settings.activeExamId) {
          await loadAll(storage, patch.activeExamId);
        }
      }
    },
    [settings, storage, loadAll],
  );

  const stateOf = useCallback(
    (questionId: string) => states.find((s) => s.questionId === questionId),
    [states],
  );

  const recordAttempt = useCallback(
    async (input: RecordAttemptInput): Promise<Attempt> => {
      const { question } = input;
      const now = Date.now();
      const correct = input.selected === question.answer;
      const attempt: Attempt = {
        id: newId('att'),
        examId: question.examId,
        sessionId: input.sessionId,
        questionId: question.id,
        subjectId: question.subjectId,
        majorTopicId: question.majorTopicId,
        minorTopicId: question.minorTopicId,
        conceptIds: question.conceptIds,
        mode: input.mode,
        selected: input.selected,
        correct,
        confidence: input.confidence,
        errorCause: input.errorCause,
        elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
        difficulty: question.difficulty,
        questionType: question.questionType,
        at: now,
      };

      const previous = states.find((s) => s.questionId === question.id);
      const nextState = scheduleNext(
        previous,
        { questionId: question.id, examId: question.examId, subjectId: question.subjectId },
        {
          correct,
          confidence: input.confidence,
          elapsedMs: attempt.elapsedMs,
          expectedMs: expectedSeconds(question.questionType, question.difficulty) * 1000,
        },
        { now, daysUntilExam: daysUntilExam(index.config.examDate, now) },
      );

      setAttempts((prev) => [...prev, attempt]);
      setStates((prev) => {
        const without = prev.filter((s) => s.questionId !== question.id);
        return [...without, nextState];
      });

      if (storage) {
        await storage.addAttempt(attempt);
        await storage.putQuestionState(nextState);
      }
      return attempt;
    },
    [states, storage, index.config.examDate],
  );

  const setErrorCause = useCallback(
    async (attemptId: string, cause: ErrorCause) => {
      let updated: Attempt | undefined;
      setAttempts((prev) =>
        prev.map((a) => {
          if (a.id !== attemptId) return a;
          updated = { ...a, errorCause: cause };
          return updated;
        }),
      );
      if (storage && updated) await storage.addAttempt(updated);
    },
    [storage],
  );

  const toggleBookmark = useCallback(
    async (question: Question) => {
      const now = Date.now();
      const existing = states.find((s) => s.questionId === question.id);
      const next: QuestionState = existing
        ? { ...existing, bookmarked: !existing.bookmarked }
        : {
            questionId: question.id,
            examId: question.examId,
            subjectId: question.subjectId,
            totalAttempts: 0,
            totalCorrect: 0,
            streak: 0,
            lapses: 0,
            intervalDays: 0,
            ease: 2.2,
            dueAt: now,
            lastReviewedAt: 0,
            lastCorrect: false,
            lastConfidence: 'unsure',
            riskFlagged: false,
            bookmarked: true,
            retired: false,
          };
      setStates((prev) => [...prev.filter((s) => s.questionId !== question.id), next]);
      if (storage) await storage.putQuestionState(next);
    },
    [states, storage],
  );

  const saveSession = useCallback(
    async (session: PracticeSession) => {
      setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)]);
      if (storage) await storage.putSession(session);
    },
    [storage],
  );

  const addFlashcard = useCallback(
    async (card: Omit<Flashcard, 'id' | 'createdAt' | 'dueAt' | 'streak'>) => {
      const now = Date.now();
      const full: Flashcard = { ...card, id: newId('card'), createdAt: now, dueAt: now, streak: 0 };
      setFlashcards((prev) => [...prev, full]);
      if (storage) await storage.putFlashcard(full);
    },
    [storage],
  );

  const removeFlashcard = useCallback(
    async (id: string) => {
      setFlashcards((prev) => prev.filter((c) => c.id !== id));
      if (storage) await storage.deleteFlashcard(id);
    },
    [storage],
  );

  const reviewFlashcard = useCallback(
    async (card: Flashcard, remembered: boolean) => {
      const now = Date.now();
      const streak = remembered ? card.streak + 1 : 0;
      // Cards use a simpler ladder than questions: 1 → 3 → 7 → 14 → 30 days.
      const ladder = [1, 3, 7, 14, 30];
      const days = remembered ? ladder[Math.min(streak - 1, ladder.length - 1)] : 0;
      const next: Flashcard = {
        ...card,
        streak,
        lastReviewedAt: now,
        dueAt: now + days * 86400000,
      };
      setFlashcards((prev) => prev.map((c) => (c.id === card.id ? next : c)));
      if (storage) await storage.putFlashcard(next);
    },
    [storage],
  );

  // The goal the user asked for, and the largest one this bank can serve without
  // handing back the same questions tomorrow. Every screen shows the second
  // number so the plan on screen matches the set actually built.
  const requestedDailyGoal = settings.dailyGoalOverride ?? index.config.daily.totalQuestions;
  const sustainableGoal = useMemo(
    () => sustainableDailyTotal(index.config, index.questions),
    [index],
  );
  const dailyGoal = Math.min(requestedDailyGoal, sustainableGoal);

  const analytics = useMemo<Analytics>(() => {
    const now = Date.now();
    const subjects = buildTopicTree({
      attempts,
      states,
      taxonomy: index.taxonomy,
      subjectNames: index.subjectNameMap(),
      now,
    });
    const weaknesses = rankWeaknesses(subjects);
    const circles = computeThreeCircles(attempts, states, mockResults, now);
    const phase = phaseInfo(index.config, now);
    const mockTrend = buildMockTrend(index.config, mockResults);
    const errorCauses = errorCauseBreakdown(attempts);
    const todayKey = dateKey(now);
    const todayAttempts = attempts.filter((a) => dateKey(a.at) === todayKey);
    const dueReviewCount = states.filter((s) => s.totalAttempts > 0 && s.dueAt <= now).length;
    const streakDays = studyStreak(attempts.map((a) => a.at), now);
    const todaySession = sessions.find((s) => s.dateKey === todayKey && s.mode === 'practice');

    const recommendation = buildRecommendation({
      config: index.config,
      phase,
      subjects,
      weaknesses,
      circles,
      mockTrend,
      errorCauses,
      todayAnswered: todayAttempts.filter((a) => a.mode === 'practice').length,
      todayGoal: dailyGoal,
      todayBreakdown: todaySession ? bucketBreakdown(todaySession) : undefined,
      streakDays,
      dueReviewCount,
      riskyCount: states.filter((s) => s.riskFlagged).length,
    });

    return {
      subjects,
      weaknesses,
      circles,
      overall: overallStats(attempts),
      errorCauses,
      mockTrend,
      phase,
      streakDays,
      dueReviewCount,
      todayAttempts,
      recommendation,
    };
  }, [attempts, states, mockResults, sessions, index, dailyGoal]);

  const value = useMemo<StudyContextValue | null>(() => {
    if (!storage) return null;
    return {
      ready,
      storageKind: storage.kind,
      storageWarning,
      index,
      exams: listExams(),
      settings,
      attempts,
      states,
      stateOf,
      sessions,
      mockResults,
      flashcards,
      analytics,
      daysLeft: analytics.phase.daysLeft,
      dailyGoal,
      requestedDailyGoal,
      storage,
      reload,
      updateSettings,
      recordAttempt,
      setErrorCause,
      toggleBookmark,
      saveSession,
      addFlashcard,
      removeFlashcard,
      reviewFlashcard,
    };
  }, [
    ready,
    storage,
    storageWarning,
    index,
    settings,
    attempts,
    states,
    stateOf,
    sessions,
    mockResults,
    flashcards,
    analytics,
    dailyGoal,
    requestedDailyGoal,
    reload,
    updateSettings,
    recordAttempt,
    setErrorCause,
    toggleBookmark,
    saveSession,
    addFlashcard,
    removeFlashcard,
    reviewFlashcard,
  ]);

  if (!value) {
    return (
      <div className="empty" role="status">
        학습 데이터를 불러오는 중…
      </div>
    );
  }

  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}

function bucketBreakdown(session: PracticeSession): Record<SelectionBucket, number> {
  const out: Record<SelectionBucket, number> = {
    weakness: 0,
    dueReview: 0,
    coverage: 0,
    recentWrong: 0,
    fresh: 0,
    filler: 0,
  };
  for (const bucket of session.buckets) {
    const key = bucket as SelectionBucket;
    if (key in out) out[key] += 1;
  }
  return out;
}
