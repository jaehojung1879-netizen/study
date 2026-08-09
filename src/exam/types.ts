/**
 * Exam-agnostic domain types.
 *
 * Nothing in `src/learning` or `src/features` may hardcode a specific exam.
 * Everything exam-specific lives in `data/exams/<examId>/` and is surfaced
 * through `ExamConfig` + `Taxonomy` below, so adding 공인중개사 2차 /
 * 주택관리사 / etc. is a data change, not an engine change.
 */

/** Where a question actually came from. Never guess — see `docs/SOURCING.md`. */
export type SourceType =
  /** Verbatim reproduction of an official past exam item with verified metadata. */
  | 'official_past_exam'
  /** Structure or idea borrowed from an official item, wording rewritten. Shown as "기출 변형". */
  | 'adapted_past_exam'
  /** Authored/AI-generated in the style of the exam. Shown as "AI 생성". */
  | 'generated'
  /** Generated around a recent statute/precedent change. Shown as "AI 생성 · 최신개정". */
  | 'generated_current_affairs';

export type QuestionType =
  | 'concept' // 개념형
  | 'case' // 사례형
  | 'calculation' // 계산형
  | 'precedent' // 판례형
  | 'statute' // 법조문형
  | 'count'; // 옳은 것의 개수형

/** 1 = very easy … 5 = very hard. */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface LawReference {
  /** e.g. "민법" / "주택임대차보호법" / "공인중개사법" */
  law: string;
  /** e.g. "제108조" or "제3조의2 제2항" */
  article?: string;
  /** Optional stable identifier at 국가법령정보센터. */
  lawId?: string;
}

export interface PrecedentReference {
  /** e.g. "대법원 2013. 2. 15. 선고 2012다1234 판결" — only when verified. */
  citation: string;
  /** One-line holding used in the explanation. */
  holding?: string;
}

/** A single step of a worked calculation (부동산학개론 계산문제). */
export interface CalculationStep {
  label: string;
  detail: string;
}

export interface Question {
  id: string;
  examId: string;
  subjectId: string;
  majorTopicId: string;
  minorTopicId: string;
  conceptIds: string[];

  question: string;
  /** Optional shared stem shown above the question (지문/보기 박스). */
  passage?: string;
  choices: string[];
  /** 0-based index into `choices`. */
  answer: number;

  explanation: string;
  /**
   * Why each choice is right or wrong — one entry per `choices` entry, same order.
   *
   * The answer alone does not teach anything: most items are built so that two
   * choices look defensible, and the learner needs to know why the one they
   * picked fails. Optional only so older items keep loading; new items must
   * supply it (validation warns when it is missing, §19).
   */
  choiceExplanations?: string[];
  /** One line worth memorising verbatim. */
  memoryTip?: string;
  /** The trap this item is built around. */
  trap?: string;
  /** For `calculation` items: 공식 → 대입 → 계산 → 시험장 요령. */
  calculationSteps?: CalculationStep[];

  difficulty: Difficulty;
  questionType: QuestionType;

  sourceType: SourceType;
  sourceExamYear?: number;
  sourceExamRound?: number;
  sourceQuestionNumber?: number;
  sourceTitle?: string;
  /** URL or citation of the primary source that was checked. */
  sourceReference?: string;

  /** True only when a human verified the item against a primary source. */
  verified: boolean;
  verifiedAt?: string;

  lawReferences?: LawReference[];
  precedents?: PrecedentReference[];
  /** Date the statute text behind this item was confirmed current (YYYY-MM-DD). */
  lawAsOf?: string;
  /** Set by the law-change detector when a referenced statute may have moved. */
  needsReview?: boolean;
  needsReviewReason?: string;

  createdAt: string;
  updatedAt: string;
}

export interface Subject {
  id: string;
  name: string;
  shortName: string;
  /** Number of items this subject contributes to the real exam. */
  examQuestionCount: number;
  /** Number of items the daily practice set draws from this subject. */
  dailyQuestionCount: number;
  /** Accent colour token used by charts/heatmap. */
  accent: string;
}

export interface PassRule {
  /** 과락 기준: each subject must reach at least this percent. */
  perSubjectMinPercent: number;
  /** 합격 기준: average across subjects must reach at least this percent. */
  overallAverageMinPercent: number;
}

export interface MockExamConfig {
  /** Total wall-clock minutes for the whole session. */
  durationMinutes: number;
  /** Total item count across all subjects. */
  totalQuestions: number;
}

/** Ratios used to compose the daily set. Must sum to ~1. */
export interface SelectionMix {
  weakness: number;
  dueReview: number;
  coverage: number;
  recentWrong: number;
  fresh: number;
}

/** Strategy shift as the exam approaches (§22). Ordered by descending `minDaysLeft`. */
export interface StudyPhase {
  id: string;
  label: string;
  /** Phase applies while daysLeft >= minDaysLeft (and < the previous phase's threshold). */
  minDaysLeft: number;
  description: string;
  /** Partial overrides merged over the base mix, then renormalised. */
  mixOverrides?: Partial<SelectionMix>;
  /** Cap on how many brand-new (never-seen) items enter a set. */
  maxFreshQuestions?: number;
  /** Prefer items at or below this difficulty in the final stretch. */
  maxDifficulty?: Difficulty;
}

export interface ExamConfig {
  id: string;
  name: string;
  shortName: string;
  /** 회차, e.g. 37 */
  round: number;
  year: number;
  /** ISO date (YYYY-MM-DD) of the exam. */
  examDate: string;
  /** Human note on where the schedule/structure came from + when it was checked. */
  officialSource: string;
  officialSourceCheckedAt: string;
  /** True once a human confirmed date/structure against the official 시행계획 공고. */
  scheduleVerified: boolean;

  subjects: Subject[];
  mock: MockExamConfig;
  passRule: PassRule;

  daily: {
    /** Target items per day across all subjects. */
    totalQuestions: number;
  };
  selectionMix: SelectionMix;
  phases: StudyPhase[];
}

export interface ConceptNode {
  id: string;
  name: string;
}

/** One block of the long-form note. */
export interface ConceptNoteSection {
  heading: string;
  /** Each entry renders as its own paragraph/bullet. */
  body: string[];
}

/**
 * Side-by-side table for the pairs the exam deliberately swaps
 * (지상물 vs 부속물매수청구권, 해제 전 vs 해제 후 제3자, …).
 */
export interface ConceptComparison {
  title?: string;
  /** First column is the row label. */
  columns: string[];
  rows: string[][];
}

/**
 * The study note behind one concept (§13).
 *
 * Every note carries both lengths on purpose: `summary` is what you re-read on
 * the train the week before the exam, `sections` is what you read the first
 * time you get the concept wrong. The app never generates one from the other —
 * a compressed long note reads like filler, and an inflated short note buries
 * the point.
 */
export interface ConceptNote {
  examId: string;
  conceptId: string;
  /** One sentence: what this concept decides, in exam terms. */
  headline: string;
  /** 짧은 버전 — 3~6 lines, each independently memorable. */
  summary: string[];
  /** 긴 버전 — full note, ordered as it should be read. */
  sections: ConceptNoteSection[];
  comparison?: ConceptComparison;
  /** The mistakes this concept is examined through. */
  traps?: string[];
  /** Sentences worth memorising verbatim. */
  mnemonics?: string[];
  lawReferences?: LawReference[];
  precedents?: PrecedentReference[];
  lawAsOf?: string;
  /** Concepts to read next — rendered as links at the bottom of the note. */
  relatedConceptIds?: string[];
  updatedAt: string;
}

export interface MinorTopicNode {
  id: string;
  name: string;
  concepts: ConceptNode[];
}

export interface MajorTopicNode {
  id: string;
  name: string;
  minorTopics: MinorTopicNode[];
}

export interface SubjectTaxonomy {
  subjectId: string;
  majorTopics: MajorTopicNode[];
}

export interface Taxonomy {
  examId: string;
  subjects: SubjectTaxonomy[];
}

/** Everything the app needs to run one exam. */
export interface ExamBundle {
  config: ExamConfig;
  taxonomy: Taxonomy;
  questions: Question[];
  conceptNotes: ConceptNote[];
  updates: LawUpdateEvent[];
}

export interface LawUpdateEvent {
  id: string;
  examId: string;
  /** YYYY-MM-DD the change was detected/recorded. */
  detectedAt: string;
  title: string;
  summary: string;
  /** 'law' | 'precedent' | 'exam_notice' */
  kind: 'law' | 'precedent' | 'exam_notice';
  source: string;
  sourceUrl?: string;
  effectiveFrom?: string;
  /** Law references touched by this change — used to flag questions for review. */
  affectedLaws?: LawReference[];
  /** Question ids explicitly flagged. */
  affectedQuestionIds?: string[];
  /** 'detected' | 'reviewed' | 'applied' */
  status: 'detected' | 'reviewed' | 'applied';
}
