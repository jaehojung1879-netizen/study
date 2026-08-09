import type { ConceptNote, ExamConfig, Question, Taxonomy } from '../src/exam/types';
import type { Attempt, Confidence, QuestionState } from '../src/storage/types';

let counter = 0;

export function makeQuestion(overrides: Partial<Question> = {}): Question {
  counter += 1;
  return {
    id: `q${counter}`,
    examId: 'test-exam',
    subjectId: 'subject-a',
    majorTopicId: 'major-a',
    minorTopicId: 'minor-a',
    conceptIds: ['concept-a'],
    question: `테스트 문제 ${counter}`,
    choices: ['가', '나', '다', '라'],
    answer: 0,
    explanation: '충분히 긴 해설 텍스트입니다. 최소 길이 검증을 통과합니다.',
    difficulty: 3,
    questionType: 'concept',
    sourceType: 'generated',
    verified: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

export function makeConceptNote(overrides: Partial<ConceptNote> = {}): ConceptNote {
  return {
    examId: 'test-exam',
    conceptId: 'concept-a',
    headline: '이 개념이 무엇을 결정하는지 한 문장으로 적은 정의입니다.',
    summary: ['짧은 버전 첫 줄입니다.', '짧은 버전 둘째 줄입니다.'],
    sections: [{ heading: '기본 구조', body: ['긴 버전의 본문 한 단락입니다.'] }],
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

export function makeAttempt(overrides: Partial<Attempt> = {}): Attempt {
  counter += 1;
  return {
    id: `a${counter}`,
    examId: 'test-exam',
    sessionId: 'sess1',
    questionId: `q${counter}`,
    subjectId: 'subject-a',
    majorTopicId: 'major-a',
    minorTopicId: 'minor-a',
    conceptIds: ['concept-a'],
    mode: 'practice',
    selected: 0,
    correct: true,
    confidence: 'certain',
    elapsedMs: 40_000,
    difficulty: 3,
    questionType: 'concept',
    at: Date.UTC(2026, 0, 1),
    ...overrides,
  };
}

/** A run of attempts on the same question, one per day, newest last. */
export function attemptSeries(
  count: number,
  pattern: (i: number) => Partial<Attempt>,
  startAt = Date.UTC(2026, 0, 1),
): Attempt[] {
  return Array.from({ length: count }, (_, i) =>
    makeAttempt({ at: startAt + i * 86_400_000, ...pattern(i) }),
  );
}

export function makeState(overrides: Partial<QuestionState> = {}): QuestionState {
  return {
    questionId: 'q1',
    examId: 'test-exam',
    subjectId: 'subject-a',
    totalAttempts: 1,
    totalCorrect: 1,
    streak: 1,
    lapses: 0,
    intervalDays: 1,
    ease: 2.2,
    dueAt: Date.now() + 86_400_000,
    lastReviewedAt: Date.now(),
    lastCorrect: true,
    lastConfidence: 'certain' as Confidence,
    riskFlagged: false,
    bookmarked: false,
    retired: false,
    ...overrides,
  };
}

export const testConfig: ExamConfig = {
  id: 'test-exam',
  name: '테스트 시험',
  shortName: '테스트',
  round: 1,
  year: 2026,
  examDate: '2026-12-31',
  officialSource: 'test',
  officialSourceCheckedAt: '2026-01-01',
  scheduleVerified: true,
  subjects: [
    {
      id: 'subject-a',
      name: '과목 A',
      shortName: 'A',
      examQuestionCount: 4,
      dailyQuestionCount: 5,
      accent: 'teal',
    },
    {
      id: 'subject-b',
      name: '과목 B',
      shortName: 'B',
      examQuestionCount: 4,
      dailyQuestionCount: 5,
      accent: 'violet',
    },
  ],
  mock: { durationMinutes: 100, totalQuestions: 8 },
  passRule: { perSubjectMinPercent: 40, overallAverageMinPercent: 60 },
  daily: { totalQuestions: 10 },
  selectionMix: { weakness: 0.4, dueReview: 0.25, coverage: 0.15, recentWrong: 0.1, fresh: 0.1 },
  phases: [
    { id: 'far', label: '개념 확장기', minDaysLeft: 60, description: 'x' },
    { id: 'near', label: '마무리', minDaysLeft: 0, description: 'y', maxFreshQuestions: 0 },
  ],
};

export const testTaxonomy: Taxonomy = {
  examId: 'test-exam',
  subjects: [
    {
      subjectId: 'subject-a',
      majorTopics: [
        {
          id: 'major-a',
          name: '대분류 A',
          minorTopics: [
            { id: 'minor-a', name: '소분류 A', concepts: [{ id: 'concept-a', name: '개념 A' }] },
            { id: 'minor-a2', name: '소분류 A2', concepts: [{ id: 'concept-a2', name: '개념 A2' }] },
          ],
        },
      ],
    },
    {
      subjectId: 'subject-b',
      majorTopics: [
        {
          id: 'major-b',
          name: '대분류 B',
          minorTopics: [
            { id: 'minor-b', name: '소분류 B', concepts: [{ id: 'concept-b', name: '개념 B' }] },
          ],
        },
      ],
    },
  ],
};
