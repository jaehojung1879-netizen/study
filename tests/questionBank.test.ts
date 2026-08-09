/**
 * Guards the shipped question bank. These run in CI on every push, so a bad
 * merge to `data/` fails before it reaches GitHub Pages.
 */
import { describe, expect, it } from 'vitest';
import { getExamIndex, listExams } from '../src/exam/registry';
import {
  DUPLICATE_THRESHOLD,
  findDuplicates,
  indexTaxonomy,
  similarity,
  validateConceptNotes,
  validateQuestionBank,
} from '../src/exam/validation';
import { makeConceptNote, makeQuestion, testConfig, testTaxonomy } from './helpers';

describe('shipped exam data', () => {
  const exams = listExams();

  it('registers at least one exam', () => {
    expect(exams.length).toBeGreaterThan(0);
  });

  it.each(exams.map((e) => e.id))('%s passes every validation rule', (examId) => {
    const index = getExamIndex(examId)!;
    const issues = validateQuestionBank(index.questions, index.taxonomy, index.config);
    const errors = issues.filter((i) => i.level === 'error');
    expect(errors, JSON.stringify(errors, null, 2)).toHaveLength(0);
  });

  it.each(exams.map((e) => e.id))('%s has no duplicated stems', (examId) => {
    const index = getExamIndex(examId)!;
    const duplicates = findDuplicates(index.questions, DUPLICATE_THRESHOLD);
    expect(duplicates, JSON.stringify(duplicates)).toHaveLength(0);
  });

  it.each(exams.map((e) => e.id))('%s covers every minor topic in its taxonomy', (examId) => {
    const index = getExamIndex(examId)!;
    const covered = new Set(index.questions.map((q) => q.minorTopicId));
    const missing = [...indexTaxonomy(index.taxonomy).minorTopics.keys()].filter((id) => !covered.has(id));
    expect(missing, `문항이 없는 소분류: ${missing.join(', ')}`).toHaveLength(0);
  });

  it.each(exams.map((e) => e.id))('%s never labels an unverified item as 기출', (examId) => {
    const index = getExamIndex(examId)!;
    const lying = index.questions.filter((q) => q.sourceType === 'official_past_exam' && !q.verified);
    expect(lying.map((q) => q.id)).toHaveLength(0);
  });

  it.each(exams.map((e) => e.id))('%s explains every choice, not just the answer', (examId) => {
    const index = getExamIndex(examId)!;
    const unexplained = index.questions.filter(
      (q) => (q.choiceExplanations?.length ?? 0) !== q.choices.length,
    );
    expect(unexplained.map((q) => q.id)).toHaveLength(0);
  });

  it.each(exams.map((e) => e.id))('%s has a concept note for every drilled concept', (examId) => {
    const index = getExamIndex(examId)!;
    const drilled = new Set(index.questions.flatMap((q) => q.conceptIds));
    const missing = [...drilled].filter((c) => !index.conceptNote(c));
    expect(missing, `노트가 없는 개념: ${missing.join(', ')}`).toHaveLength(0);
  });

  it.each(exams.map((e) => e.id))('%s passes every concept-note rule', (examId) => {
    const index = getExamIndex(examId)!;
    const issues = validateConceptNotes(
      index.conceptNotes,
      index.taxonomy,
      index.config,
      index.questions,
    );
    const errors = issues.filter((i) => i.level === 'error');
    expect(errors, JSON.stringify(errors, null, 2)).toHaveLength(0);
  });

  it.each(exams.map((e) => e.id))('%s records lawAsOf on every statute-backed item', (examId) => {
    const index = getExamIndex(examId)!;
    const missing = index.questions.filter((q) => q.lawReferences?.length && !q.lawAsOf);
    expect(missing.map((q) => q.id)).toHaveLength(0);
  });

  it('has enough questions per subject for the configured daily set', () => {
    for (const exam of exams) {
      const index = getExamIndex(exam.id)!;
      for (const subject of exam.subjects) {
        const count = index.questions.filter((q) => q.subjectId === subject.id).length;
        // A bank smaller than the daily quota still works (items recycle), but it
        // should never be so small that a day is mostly repeats.
        expect(count, `${subject.shortName}`).toBeGreaterThanOrEqual(subject.dailyQuestionCount / 2);
      }
    }
  });
});

describe('validateQuestionBank', () => {
  const valid = () =>
    makeQuestion({
      subjectId: 'subject-a',
      majorTopicId: 'major-a',
      minorTopicId: 'minor-a',
      conceptIds: ['concept-a'],
      examId: 'test-exam',
    });

  const errorsFor = (question: ReturnType<typeof makeQuestion>) =>
    validateQuestionBank([question], testTaxonomy, testConfig)
      .filter((i) => i.level === 'error')
      .map((i) => i.rule);

  it('accepts a well-formed question', () => {
    expect(errorsFor(valid())).toHaveLength(0);
  });

  it('rejects an out-of-range answer index', () => {
    expect(errorsFor({ ...valid(), answer: 9 })).toContain('answer-range');
    expect(errorsFor({ ...valid(), answer: -1 })).toContain('answer-range');
  });

  it('rejects a bad choice count and duplicated choices', () => {
    expect(errorsFor({ ...valid(), choices: ['가', '나'], answer: 0 })).toContain('choice-count');
    expect(errorsFor({ ...valid(), choices: ['가', '가', '다', '라'] })).toContain('choice-duplicate');
  });

  it('rejects a missing or stub explanation', () => {
    expect(errorsFor({ ...valid(), explanation: '짧음' })).toContain('explanation');
  });

  it('rejects taxonomy ids that do not exist or are wired to the wrong parent', () => {
    expect(errorsFor({ ...valid(), minorTopicId: 'nope' })).toContain('minor-topic');
    expect(errorsFor({ ...valid(), conceptIds: ['nope'] })).toContain('concept-exists');
    expect(errorsFor({ ...valid(), minorTopicId: 'minor-b' })).toContain('minor-topic-major');
  });

  it('rejects an unverified item claiming to be an official past exam', () => {
    const rules = errorsFor({ ...valid(), sourceType: 'official_past_exam' });
    expect(rules).toContain('official-verified');
    expect(rules).toContain('official-metadata');
  });

  it('requires law metadata on statute questions', () => {
    expect(errorsFor({ ...valid(), questionType: 'statute' })).toContain('law-reference');
    expect(
      errorsFor({ ...valid(), lawReferences: [{ law: '민법', article: '제1조' }], lawAsOf: undefined }),
    ).toContain('law-as-of');
  });

  it('warns when no choice is explained and rejects a mismatched count', () => {
    const warnings = validateQuestionBank([valid()], testTaxonomy, testConfig)
      .filter((i) => i.level === 'warning')
      .map((i) => i.rule);
    expect(warnings).toContain('choice-explanations');

    expect(errorsFor({ ...valid(), choiceExplanations: ['하나만 있습니다'] })).toContain(
      'choice-explanation-count',
    );
  });

  it('rejects a stub choice explanation', () => {
    const question = valid();
    const stubbed = question.choices.map((_, i) => (i === 0 ? '오답' : '충분히 긴 선지 해설입니다'));
    expect(errorsFor({ ...question, choiceExplanations: stubbed })).toContain(
      'choice-explanation-text',
    );
  });

  it('accepts an item whose choices are all explained', () => {
    const question = valid();
    const explained = question.choices.map((c) => `${c} 선지에 대한 충분히 긴 해설입니다.`);
    const issues = validateQuestionBank(
      [{ ...question, choiceExplanations: explained }],
      testTaxonomy,
      testConfig,
    );
    expect(issues.map((i) => i.rule)).not.toContain('choice-explanations');
  });

  it('rejects duplicate ids across the bank', () => {
    const issues = validateQuestionBank([valid(), { ...valid(), id: 'dupe' }, { ...valid(), id: 'dupe' }], testTaxonomy, testConfig);
    expect(issues.map((i) => i.rule)).toContain('id-unique');
  });
});

describe('validateConceptNotes', () => {
  const errorsFor = (note: ReturnType<typeof makeConceptNote>) =>
    validateConceptNotes([note], testTaxonomy, testConfig)
      .filter((i) => i.level === 'error')
      .map((i) => i.rule);

  it('accepts a well-formed note', () => {
    expect(errorsFor(makeConceptNote())).toHaveLength(0);
  });

  it('rejects a concept id that is not in the taxonomy', () => {
    expect(errorsFor(makeConceptNote({ conceptId: 'nope' }))).toContain('note-concept-exists');
  });

  it('requires both lengths — a short version and a long one', () => {
    expect(errorsFor(makeConceptNote({ summary: ['한 줄뿐'] }))).toContain('note-summary');
    expect(errorsFor(makeConceptNote({ sections: [] }))).toContain('note-sections');
  });

  it('rejects a ragged comparison table', () => {
    const note = makeConceptNote({
      comparison: { columns: ['구분', '왼쪽', '오른쪽'], rows: [['행', '값']] },
    });
    expect(errorsFor(note)).toContain('note-comparison-shape');
  });

  it('requires lawAsOf whenever a statute is cited', () => {
    const note = makeConceptNote({ lawReferences: [{ law: '민법', article: '제1조' }] });
    expect(errorsFor(note)).toContain('note-law-as-of');
  });

  it('rejects a related-concept link that goes nowhere', () => {
    expect(errorsFor(makeConceptNote({ relatedConceptIds: ['nope'] }))).toContain(
      'note-related-exists',
    );
  });

  it('warns about a concept that questions drill but no note explains', () => {
    const issues = validateConceptNotes(
      [makeConceptNote()],
      testTaxonomy,
      testConfig,
      [makeQuestion({ minorTopicId: 'minor-a2', conceptIds: ['concept-a2'] })],
    );
    expect(issues.filter((i) => i.rule === 'note-coverage').map((i) => i.questionId)).toEqual([
      'concept-a2',
    ]);
  });
});

describe('similarity and duplicate detection', () => {
  it('scores identical text as 1 and unrelated text near 0', () => {
    expect(similarity('통정허위표시의 무효', '통정허위표시의 무효')).toBe(1);
    expect(similarity('수요의 가격탄력성', '표현대리의 성립요건')).toBeLessThan(0.3);
  });

  it('ignores punctuation and spacing differences', () => {
    expect(similarity('옳은 것은?', '옳은것은')).toBeGreaterThan(0.9);
  });

  it('keeps numbers significant so numeric choices are not seen as duplicates', () => {
    expect(similarity('10km', '15km')).toBeLessThan(0.9);
  });

  it('flags a re-typed stem but allows the same concept asked differently', () => {
    const shared = { minorTopicId: 'minor-a', conceptIds: ['concept-a'] };
    const pairs = findDuplicates([
      makeQuestion({ id: 'x1', question: '표현대리의 성립요건으로 옳은 것은?', ...shared }),
      makeQuestion({ id: 'x2', question: '표현대리의 성립요건으로 옳은 것은?', ...shared }),
      makeQuestion({
        id: 'x3',
        question: '甲이 乙에게 임대 대리권만 주었는데 乙이 매도한 경우의 법률관계는?',
        ...shared,
      }),
    ]);
    const hard = pairs.filter((p) => p.score >= DUPLICATE_THRESHOLD);
    expect(hard.map((p) => [p.a, p.b])).toEqual([['x1', 'x2']]);
    expect(pairs.some((p) => p.a === 'x3' || p.b === 'x3')).toBe(false);
  });

  it('does not compare questions from different minor topics', () => {
    const pairs = findDuplicates([
      makeQuestion({ id: 'y1', question: '같은 문장', minorTopicId: 'minor-a' }),
      makeQuestion({ id: 'y2', question: '같은 문장', minorTopicId: 'minor-b' }),
    ]);
    expect(pairs).toHaveLength(0);
  });
});
