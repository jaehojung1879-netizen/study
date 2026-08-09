/** Persistence-layer domain types + the storage abstraction. */

export type Confidence = 'certain' | 'unsure' | 'guess';

/** Why the user got it wrong (§10). Optional, one tap. */
export type ErrorCause =
  | 'concept_unknown' // 개념 자체를 몰랐음
  | 'memory_gap' // 암기 부족
  | 'precedent_confusion' // 판례 혼동
  | 'calculation_slip' // 계산 실수
  | 'misread' // 지문을 잘못 읽음
  | 'out_of_time' // 시간 부족
  | 'guessed'; // 찍음

export type StudyMode = 'practice' | 'review' | 'mock' | 'calculation' | 'flashcard';

export interface Attempt {
  id: string;
  examId: string;
  sessionId: string;
  questionId: string;
  subjectId: string;
  majorTopicId: string;
  minorTopicId: string;
  conceptIds: string[];
  mode: StudyMode;
  /** 0-based choice index, or -1 when skipped/unanswered. */
  selected: number;
  correct: boolean;
  confidence: Confidence;
  errorCause?: ErrorCause;
  /** Time spent on the item in milliseconds. */
  elapsedMs: number;
  difficulty: number;
  questionType: string;
  /** Epoch ms. */
  at: number;
}

/** Per-question spaced-repetition + rollup state. */
export interface QuestionState {
  questionId: string;
  examId: string;
  subjectId: string;
  totalAttempts: number;
  totalCorrect: number;
  /** Consecutive correct answers; reset to 0 on a lapse. */
  streak: number;
  /** Number of times a previously-correct item was answered wrong. */
  lapses: number;
  /** Current SRS interval in days (0 = same-day re-drill). */
  intervalDays: number;
  /** SM-2 style ease, clamped to [1.3, 2.8]. */
  ease: number;
  /** Epoch ms when this item is next due. */
  dueAt: number;
  /** Epoch ms of the most recent attempt. */
  lastReviewedAt: number;
  lastCorrect: boolean;
  lastConfidence: Confidence;
  /** confidence === 'certain' && !correct at least once — the dangerous misconception (§8). */
  riskFlagged: boolean;
  bookmarked: boolean;
  /** true once the item graduated (interval >= 30d) */
  retired: boolean;
}

export interface PracticeSession {
  id: string;
  examId: string;
  mode: StudyMode;
  /** YYYY-MM-DD in local time — one practice session per day per exam. */
  dateKey: string;
  questionIds: string[];
  /** Index of the next unanswered question. */
  cursor: number;
  answeredCount: number;
  correctCount: number;
  createdAt: number;
  completedAt?: number;
  /** Human-readable explanation of how the set was composed. */
  planSummary: string;
  /** Bucket each question was drawn from, parallel to `questionIds`. */
  buckets: string[];
}

export interface MockItemResult {
  questionId: string;
  subjectId: string;
  selected: number;
  correct: boolean;
  confidence: Confidence;
  elapsedMs: number;
  flagged: boolean;
}

export interface MockSubjectScore {
  subjectId: string;
  correct: number;
  total: number;
  percent: number;
  /** Below `passRule.perSubjectMinPercent`. */
  failed: boolean;
}

export interface MockResult {
  id: string;
  examId: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  subjects: MockSubjectScore[];
  overallPercent: number;
  passed: boolean;
  /** Subjects that triggered 과락. */
  failedSubjectIds: string[];
  items: MockItemResult[];
}

/** In-progress mock attempt, persisted so a refresh does not lose the sitting. */
export interface MockSession {
  id: string;
  examId: string;
  questionIds: string[];
  answers: Record<string, number>;
  confidences: Record<string, Confidence>;
  flagged: string[];
  perQuestionMs: Record<string, number>;
  cursor: number;
  startedAt: number;
  /** Epoch ms when the timer expires. */
  endsAt: number;
  submittedAt?: number;
}

export interface Flashcard {
  id: string;
  examId: string;
  questionId?: string;
  subjectId: string;
  front: string;
  back: string;
  createdAt: number;
  /** SRS for cards is deliberately simple: due date + streak. */
  dueAt: number;
  streak: number;
  lastReviewedAt?: number;
}

export interface AppSettings {
  activeExamId: string;
  theme: 'system' | 'light' | 'dark';
  /** Override of `examConfig.daily.totalQuestions`; null = follow config. */
  dailyGoalOverride: number | null;
  /** Ask for confidence after each answer. */
  confidencePromptEnabled: boolean;
  /** Ask for an error cause after a wrong answer. */
  errorCausePromptEnabled: boolean;
  /** Deterministic-shuffle salt so a re-install does not reproduce the same sets. */
  selectionSalt: string;
}

export interface BackupFile {
  format: 'study-backup';
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  data: {
    attempts: Attempt[];
    questionStates: QuestionState[];
    sessions: PracticeSession[];
    mockResults: MockResult[];
    mockSessions: MockSession[];
    flashcards: Flashcard[];
    settings: AppSettings | null;
    meta: Record<string, unknown>;
  };
}

export interface ImportReport {
  imported: Record<string, number>;
  skipped: Record<string, number>;
  mode: 'merge' | 'replace';
  migratedFrom?: number;
}

export interface AttemptQuery {
  examId?: string;
  since?: number;
  subjectId?: string;
  questionId?: string;
  mode?: StudyMode;
  limit?: number;
}

/**
 * The single seam between the app and persistence.
 *
 * Two implementations ship today (Dexie/IndexedDB and in-memory); a future
 * cloud-sync backend only has to satisfy this interface.
 */
export interface StudyStorage {
  readonly kind: 'indexeddb' | 'memory';
  open(): Promise<void>;

  getSettings(): Promise<AppSettings | null>;
  saveSettings(settings: AppSettings): Promise<void>;

  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;

  addAttempt(attempt: Attempt): Promise<void>;
  listAttempts(query?: AttemptQuery): Promise<Attempt[]>;

  getQuestionState(questionId: string): Promise<QuestionState | undefined>;
  putQuestionState(state: QuestionState): Promise<void>;
  listQuestionStates(examId?: string): Promise<QuestionState[]>;

  getSession(id: string): Promise<PracticeSession | undefined>;
  findSessionByDate(examId: string, dateKey: string, mode: StudyMode): Promise<PracticeSession | undefined>;
  putSession(session: PracticeSession): Promise<void>;
  listSessions(examId?: string): Promise<PracticeSession[]>;

  putMockResult(result: MockResult): Promise<void>;
  listMockResults(examId?: string): Promise<MockResult[]>;

  getMockSession(id: string): Promise<MockSession | undefined>;
  putMockSession(session: MockSession): Promise<void>;
  listMockSessions(examId?: string): Promise<MockSession[]>;
  deleteMockSession(id: string): Promise<void>;

  putFlashcard(card: Flashcard): Promise<void>;
  listFlashcards(examId?: string): Promise<Flashcard[]>;
  deleteFlashcard(id: string): Promise<void>;

  exportAll(): Promise<BackupFile>;
  importAll(backup: BackupFile, mode: 'merge' | 'replace'): Promise<ImportReport>;
  clearAll(): Promise<void>;
}
