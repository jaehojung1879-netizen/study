/**
 * Question-bank validation (§19, §33).
 *
 * Pure functions with no bundler or filesystem dependency, so the CI script
 * (`scripts/validate-questions.ts`, run under tsx) and the unit tests share
 * exactly the same rules.
 */
import type { ConceptNote, ExamConfig, Question, SourceType, Taxonomy } from './types';

export interface Issue {
  level: 'error' | 'warning';
  questionId: string;
  rule: string;
  message: string;
}

const VALID_SOURCE_TYPES: SourceType[] = [
  'official_past_exam',
  'adapted_past_exam',
  'generated',
  'generated_current_affairs',
];

const MIN_CHOICES = 4;
const MAX_CHOICES = 6;
const MIN_EXPLANATION_LENGTH = 20;
const MIN_CHOICE_EXPLANATION_LENGTH = 8;
const MIN_NOTE_SUMMARY_LINES = 2;

export interface TaxonomyIndex {
  subjects: Set<string>;
  majorTopics: Map<string, string>; // majorTopicId -> subjectId
  minorTopics: Map<string, string>; // minorTopicId -> majorTopicId
  concepts: Map<string, string>; // conceptId -> minorTopicId
}

export function indexTaxonomy(taxonomy: Taxonomy): TaxonomyIndex {
  const index: TaxonomyIndex = {
    subjects: new Set(),
    majorTopics: new Map(),
    minorTopics: new Map(),
    concepts: new Map(),
  };
  for (const subject of taxonomy.subjects) {
    index.subjects.add(subject.subjectId);
    for (const major of subject.majorTopics) {
      index.majorTopics.set(major.id, subject.subjectId);
      for (const minor of major.minorTopics) {
        index.minorTopics.set(minor.id, major.id);
        for (const concept of minor.concepts) index.concepts.set(concept.id, minor.id);
      }
    }
  }
  return index;
}

export function validateQuestionBank(
  questions: Question[],
  taxonomy: Taxonomy,
  config: ExamConfig,
): Issue[] {
  const issues: Issue[] = [];
  const tax = indexTaxonomy(taxonomy);
  const seenIds = new Set<string>();
  const configSubjects = new Set(config.subjects.map((s) => s.id));

  const push = (level: Issue['level'], questionId: string, rule: string, message: string): void => {
    issues.push({ level, questionId, rule, message });
  };

  for (const q of questions) {
    if (!q.id) {
      push('error', '(no id)', 'id-required', 'id가 없습니다.');
      continue;
    }
    if (seenIds.has(q.id)) push('error', q.id, 'id-unique', `id가 중복되었습니다: ${q.id}`);
    seenIds.add(q.id);

    if (q.examId !== config.id) {
      push('error', q.id, 'exam-id', `examId가 ${config.id}와 다릅니다 (${q.examId}).`);
    }

    // --- taxonomy wiring ---
    if (!configSubjects.has(q.subjectId)) {
      push('error', q.id, 'subject-exists', `exam.json에 없는 subjectId: ${q.subjectId}`);
    }
    if (!tax.subjects.has(q.subjectId)) {
      push('error', q.id, 'subject-in-taxonomy', `taxonomy에 없는 subjectId: ${q.subjectId}`);
    }
    const majorSubject = tax.majorTopics.get(q.majorTopicId);
    if (!majorSubject) {
      push('error', q.id, 'major-topic', `taxonomy에 없는 majorTopicId: ${q.majorTopicId}`);
    } else if (majorSubject !== q.subjectId) {
      push('error', q.id, 'major-topic-subject', `majorTopicId ${q.majorTopicId}는 ${majorSubject} 과목 소속입니다.`);
    }
    const minorMajor = tax.minorTopics.get(q.minorTopicId);
    if (!minorMajor) {
      push('error', q.id, 'minor-topic', `taxonomy에 없는 minorTopicId: ${q.minorTopicId}`);
    } else if (minorMajor !== q.majorTopicId) {
      push('error', q.id, 'minor-topic-major', `minorTopicId ${q.minorTopicId}는 ${minorMajor} 대분류 소속입니다.`);
    }
    if (!Array.isArray(q.conceptIds) || q.conceptIds.length === 0) {
      push('warning', q.id, 'concepts-present', 'conceptIds가 비어 있어 취약개념 출제 대상에서 제외됩니다.');
    } else {
      for (const conceptId of q.conceptIds) {
        const owner = tax.concepts.get(conceptId);
        if (!owner) push('error', q.id, 'concept-exists', `taxonomy에 없는 conceptId: ${conceptId}`);
        else if (owner !== q.minorTopicId) {
          push('warning', q.id, 'concept-topic', `conceptId ${conceptId}는 ${owner} 소분류 소속입니다.`);
        }
      }
    }

    // --- item structure ---
    if (!q.question || q.question.trim().length < 5) {
      push('error', q.id, 'question-text', '문제 지문이 비었거나 너무 짧습니다.');
    }
    if (!Array.isArray(q.choices) || q.choices.length < MIN_CHOICES || q.choices.length > MAX_CHOICES) {
      push('error', q.id, 'choice-count', `선택지는 ${MIN_CHOICES}~${MAX_CHOICES}개여야 합니다 (현재 ${q.choices?.length ?? 0}).`);
    } else {
      if (q.choices.some((c) => !c || !c.trim())) {
        push('error', q.id, 'choice-empty', '빈 선택지가 있습니다.');
      }
      const normalized = q.choices.map(normalizeText);
      if (new Set(normalized).size !== normalized.length) {
        push('error', q.id, 'choice-duplicate', '동일한 선택지가 두 번 이상 있습니다.');
      }
    }
    if (
      typeof q.answer !== 'number' ||
      !Number.isInteger(q.answer) ||
      q.answer < 0 ||
      q.answer >= (q.choices?.length ?? 0)
    ) {
      push('error', q.id, 'answer-range', `answer가 선택지 범위를 벗어납니다: ${q.answer}`);
    }
    if (!q.explanation || q.explanation.trim().length < MIN_EXPLANATION_LENGTH) {
      push('error', q.id, 'explanation', `해설이 없거나 너무 짧습니다(${MIN_EXPLANATION_LENGTH}자 이상).`);
    }

    // --- per-choice explanations (§10) ---
    // Knowing the answer is not the same as knowing why the other four fail,
    // so every choice gets its own line.
    if (!q.choiceExplanations?.length) {
      push(
        q.sourceType === 'official_past_exam' ? 'error' : 'warning',
        q.id,
        'choice-explanations',
        '선지별 해설이 없어 오답 리뷰에서 정답 선지만 설명됩니다.',
      );
    } else if (q.choiceExplanations.length !== (q.choices?.length ?? 0)) {
      push(
        'error',
        q.id,
        'choice-explanation-count',
        `선지별 해설 개수(${q.choiceExplanations.length})가 선택지 개수(${q.choices?.length ?? 0})와 다릅니다.`,
      );
    } else if (q.choiceExplanations.some((c) => !c || c.trim().length < MIN_CHOICE_EXPLANATION_LENGTH)) {
      push(
        'error',
        q.id,
        'choice-explanation-text',
        `비었거나 ${MIN_CHOICE_EXPLANATION_LENGTH}자 미만인 선지 해설이 있습니다.`,
      );
    }
    if (!q.difficulty || q.difficulty < 1 || q.difficulty > 5) {
      push('error', q.id, 'difficulty', `difficulty는 1~5여야 합니다 (현재 ${q.difficulty}).`);
    }

    // --- provenance (§14) ---
    if (!VALID_SOURCE_TYPES.includes(q.sourceType)) {
      push('error', q.id, 'source-type', `알 수 없는 sourceType: ${q.sourceType}`);
    }
    if (q.sourceType === 'official_past_exam') {
      if (!q.verified) {
        push(
          'error',
          q.id,
          'official-verified',
          "검증되지 않은 문항을 'official_past_exam'으로 표시할 수 없습니다.",
        );
      }
      if (!q.sourceExamYear || !q.sourceExamRound || !q.sourceQuestionNumber) {
        push(
          'error',
          q.id,
          'official-metadata',
          '공식 기출은 sourceExamYear·sourceExamRound·sourceQuestionNumber가 모두 필요합니다.',
        );
      }
      if (!q.sourceReference) {
        push('error', q.id, 'official-reference', '공식 기출은 확인한 출처(sourceReference)가 필요합니다.');
      }
    }
    if (q.sourceType === 'adapted_past_exam' && !q.sourceExamYear) {
      push('warning', q.id, 'adapted-metadata', '기출 변형은 원 출제 연도(sourceExamYear)를 남기는 것이 좋습니다.');
    }
    if (q.verified && !q.verifiedAt) {
      push('error', q.id, 'verified-at', 'verified가 true면 verifiedAt이 필요합니다.');
    }

    // --- statute questions (§15) ---
    const isLawQuestion = q.questionType === 'statute' || q.questionType === 'precedent';
    if (isLawQuestion && !(q.lawReferences?.length || q.precedents?.length)) {
      push('error', q.id, 'law-reference', '법조문형·판례형 문항에는 lawReferences 또는 precedents가 필요합니다.');
    }
    if (q.lawReferences?.length && !q.lawAsOf) {
      push('error', q.id, 'law-as-of', 'lawReferences가 있으면 lawAsOf(법령 확인일)가 필요합니다.');
    }
    if (q.questionType === 'calculation' && !q.calculationSteps?.length) {
      push('warning', q.id, 'calculation-steps', '계산형 문항에는 단계별 풀이(calculationSteps)를 권장합니다.');
    }

    if (!q.createdAt || !q.updatedAt) {
      push('warning', q.id, 'timestamps', 'createdAt/updatedAt이 비어 있습니다.');
    }
  }

  return issues;
}

/**
 * Concept-note validation (§13).
 *
 * A note is a teaching surface, so the bar is different from a question: the
 * short version has to survive on its own (the user reads only that in the last
 * week), and every link out of it has to resolve.
 */
export function validateConceptNotes(
  notes: ConceptNote[],
  taxonomy: Taxonomy,
  config: ExamConfig,
  questions: Question[] = [],
): Issue[] {
  const issues: Issue[] = [];
  const tax = indexTaxonomy(taxonomy);
  const seen = new Set<string>();

  const push = (level: Issue['level'], id: string, rule: string, message: string): void => {
    issues.push({ level, questionId: id, rule, message });
  };

  for (const note of notes) {
    const id = note.conceptId || '(no conceptId)';
    if (!note.conceptId) {
      push('error', id, 'note-concept-id', 'conceptId가 없습니다.');
      continue;
    }
    if (seen.has(note.conceptId)) {
      push('error', id, 'note-unique', `같은 개념의 노트가 두 번 있습니다: ${note.conceptId}`);
    }
    seen.add(note.conceptId);

    if (note.examId !== config.id) {
      push('error', id, 'note-exam-id', `examId가 ${config.id}와 다릅니다 (${note.examId}).`);
    }
    if (!tax.concepts.has(note.conceptId)) {
      push('error', id, 'note-concept-exists', `taxonomy에 없는 conceptId: ${note.conceptId}`);
    }
    if (!note.headline || note.headline.trim().length < 10) {
      push('error', id, 'note-headline', '한 줄 정의(headline)가 없거나 너무 짧습니다.');
    }
    if (!Array.isArray(note.summary) || note.summary.length < MIN_NOTE_SUMMARY_LINES) {
      push('error', id, 'note-summary', `짧은 버전은 ${MIN_NOTE_SUMMARY_LINES}줄 이상이어야 합니다.`);
    }
    if (!Array.isArray(note.sections) || note.sections.length === 0) {
      push('error', id, 'note-sections', '긴 버전(sections)이 비어 있습니다.');
    } else {
      for (const section of note.sections) {
        if (!section.heading?.trim() || !section.body?.length) {
          push('error', id, 'note-section-body', `내용이 빈 섹션이 있습니다: ${section.heading || '(제목 없음)'}`);
        }
      }
    }
    if (note.comparison) {
      const width = note.comparison.columns.length;
      if (width < 2) push('error', id, 'note-comparison', '비교표는 열이 2개 이상이어야 합니다.');
      const ragged = note.comparison.rows.filter((row) => row.length !== width);
      if (ragged.length) {
        push('error', id, 'note-comparison-shape', `비교표의 열 수가 맞지 않는 행이 ${ragged.length}개 있습니다.`);
      }
    }
    if (note.lawReferences?.length && !note.lawAsOf) {
      push('error', id, 'note-law-as-of', 'lawReferences가 있으면 lawAsOf(법령 확인일)가 필요합니다.');
    }
    for (const related of note.relatedConceptIds ?? []) {
      if (!tax.concepts.has(related)) {
        push('error', id, 'note-related-exists', `taxonomy에 없는 relatedConceptId: ${related}`);
      }
    }
  }

  // A concept that questions already drill but no note explains is the gap the
  // user actually hits: they get it wrong, tap 관련 개념, and find nothing.
  const drilled = new Set(questions.flatMap((q) => q.conceptIds));
  for (const conceptId of drilled) {
    if (!tax.concepts.has(conceptId)) continue;
    if (!seen.has(conceptId)) {
      push('warning', conceptId, 'note-coverage', `문항은 있으나 개념노트가 없습니다: ${conceptId}`);
    }
  }

  return issues;
}

/**
 * Strips whitespace and punctuation so near-identical stems compare equal.
 *
 * Digits are deliberately kept: "10km" and "15km" are different choices, and
 * dropping numbers would flag every numeric answer set as duplicated.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    // \u3000 = 전각 공백. 한국어 원문에 섞여 들어오는 경우가 흔하다.
    .replace(/[\s\u3000]+/g, '')
    .replace(/[.,·・()[\]{}"'`~!?？！:;/\\\-–—①②③④⑤]/g, '');
}

/** Dice coefficient over character bigrams: 0 (unrelated) … 1 (identical). */
export function similarity(a: string, b: string): number {
  const left = bigrams(normalizeText(a));
  const right = bigrams(normalizeText(b));
  if (left.size === 0 || right.size === 0) return a === b ? 1 : 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

function bigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < text.length - 1; i += 1) out.add(text.slice(i, i + 2));
  if (text.length === 1) out.add(text);
  return out;
}

export interface DuplicatePair {
  a: string;
  b: string;
  score: number;
  /** true when the two items merely share a concept — that is desirable, not a defect (§19). */
  sameConceptOnly: boolean;
}

/** Stems at or above this are treated as "the same question written twice". */
export const DUPLICATE_THRESHOLD = 0.85;
/** Below duplicate but worth a human glance. */
export const NEAR_DUPLICATE_THRESHOLD = 0.72;

export function findDuplicates(
  questions: Question[],
  threshold = NEAR_DUPLICATE_THRESHOLD,
): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < questions.length; i += 1) {
    for (let j = i + 1; j < questions.length; j += 1) {
      const a = questions[i];
      const b = questions[j];
      // Only items in the same minor topic can plausibly be duplicates; this also
      // keeps the comparison O(n²) but with a tiny constant.
      if (a.minorTopicId !== b.minorTopicId) continue;
      const score = similarity(stemOf(a), stemOf(b));
      if (score < threshold) continue;
      const sharedConcepts = a.conceptIds.some((c) => b.conceptIds.includes(c));
      pairs.push({
        a: a.id,
        b: b.id,
        score: Math.round(score * 1000) / 1000,
        sameConceptOnly: sharedConcepts && score < DUPLICATE_THRESHOLD,
      });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

function stemOf(q: Question): string {
  return `${q.question} ${q.choices.join(' ')}`;
}
