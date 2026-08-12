import { describe, expect, it } from 'vitest';
import {
  allocatePerSubject,
  buildDailySet,
  distribute,
  questionsNeededForGoal,
  sustainableDailyTotal,
} from '../src/learning/scheduler/dailySet';
import { buildTopicTree } from '../src/learning/analytics/stats';
import { currentPhase, effectiveMix } from '../src/learning/scheduler/phase';
import { rankWeaknesses } from '../src/learning/analytics/weakness';
import type { Attempt, QuestionState } from '../src/storage/types';
import { makeAttempt, makeQuestion, makeState, testConfig, testTaxonomy } from './helpers';

const NOW = Date.UTC(2026, 5, 1); // ~213 days before the test exam date

/**
 * 20 questions per subject, spread across the taxonomy.
 *
 * Comfortably above the daily draw (5 per subject) so these tests exercise
 * selection, not the small-bank cap — that has its own describe block.
 */
function makeBank() {
  const bank = [];
  for (let i = 0; i < 10; i += 1) {
    bank.push(
      makeQuestion({
        id: `a-${i}`,
        subjectId: 'subject-a',
        majorTopicId: 'major-a',
        minorTopicId: 'minor-a',
        conceptIds: ['concept-a'],
      }),
    );
    bank.push(
      makeQuestion({
        id: `a2-${i}`,
        subjectId: 'subject-a',
        majorTopicId: 'major-a',
        minorTopicId: 'minor-a2',
        conceptIds: ['concept-a2'],
      }),
    );
    bank.push(
      makeQuestion({
        id: `b-${i}`,
        subjectId: 'subject-b',
        majorTopicId: 'major-b',
        minorTopicId: 'minor-b',
        conceptIds: ['concept-b'],
      }),
    );
    bank.push(
      makeQuestion({
        id: `b2-${i}`,
        subjectId: 'subject-b',
        majorTopicId: 'major-b',
        minorTopicId: 'minor-b',
        conceptIds: ['concept-b'],
      }),
    );
  }
  return bank;
}

function statsFor(attempts: Attempt[], states: QuestionState[] = []) {
  return buildTopicTree({
    attempts,
    states,
    taxonomy: testTaxonomy,
    subjectNames: { 'subject-a': '과목 A', 'subject-b': '과목 B' },
    now: NOW,
  });
}

function build(attempts: Attempt[] = [], states: QuestionState[] = [], salt = 'salt') {
  return buildDailySet({
    config: testConfig,
    questions: makeBank(),
    states,
    attempts,
    subjectStats: statsFor(attempts, states),
    now: NOW,
    salt,
  });
}

describe('distribute', () => {
  it('allocates exactly the requested total', () => {
    const quotas = distribute(100, [
      ['weakness', 0.4],
      ['dueReview', 0.25],
      ['coverage', 0.15],
      ['recentWrong', 0.1],
      ['fresh', 0.1],
    ]);
    expect(Object.values(quotas).reduce((a, b) => a + b, 0)).toBe(100);
    expect(quotas.weakness).toBe(40);
    expect(quotas.dueReview).toBe(25);
  });

  it('still totals correctly with awkward numbers', () => {
    const quotas = distribute(7, [
      ['weakness', 0.4],
      ['dueReview', 0.25],
      ['coverage', 0.35],
    ]);
    expect(Object.values(quotas).reduce((a, b) => a + b, 0)).toBe(7);
  });
});

describe('allocatePerSubject', () => {
  it('keeps the configured 50:50 balance', () => {
    const allocation = allocatePerSubject(testConfig, 10);
    expect(allocation['subject-a']).toBe(5);
    expect(allocation['subject-b']).toBe(5);
  });

  it('assigns every question even when the total does not divide evenly', () => {
    const allocation = allocatePerSubject(testConfig, 7);
    expect(allocation['subject-a'] + allocation['subject-b']).toBe(7);
  });
});

describe('buildDailySet', () => {
  it('produces exactly the configured number of questions', () => {
    const set = build();
    expect(set.questionIds).toHaveLength(testConfig.daily.totalQuestions);
    expect(set.buckets).toHaveLength(set.questionIds.length);
  });

  it('keeps subject balance even when one subject is far weaker', () => {
    // Subject A is a disaster; subject B is fine. The 50:50 split must hold.
    const attempts = Array.from({ length: 20 }, (_, i) =>
      makeAttempt({
        questionId: `a-${i % 10}`,
        subjectId: 'subject-a',
        minorTopicId: 'minor-a',
        conceptIds: ['concept-a'],
        correct: false,
        confidence: 'certain',
        at: NOW - i * 3600_000,
      }),
    );
    const set = build(attempts);
    expect(set.perSubject['subject-a']).toBe(5);
    expect(set.perSubject['subject-b']).toBe(5);
  });

  it('is deterministic for the same day and salt, and differs across salts', () => {
    expect(build([], [], 'salt-1').questionIds).toEqual(build([], [], 'salt-1').questionIds);
    const other = build([], [], 'salt-2').questionIds;
    expect(build([], [], 'salt-1').questionIds).not.toEqual(other);
  });

  it('never repeats a question inside one set while the bank is large enough', () => {
    const ids = build().questionIds;
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prioritises reviews that are actually due', () => {
    const states = [
      makeState({ questionId: 'a-3', dueAt: NOW - 86_400_000, totalAttempts: 3 }),
      makeState({ questionId: 'b-4', dueAt: NOW - 86_400_000, totalAttempts: 3 }),
    ];
    const attempts = states.map((s) =>
      makeAttempt({
        questionId: s.questionId,
        subjectId: s.questionId.startsWith('a') ? 'subject-a' : 'subject-b',
        minorTopicId: s.questionId.startsWith('a') ? 'minor-a' : 'minor-b',
        at: NOW - 3 * 86_400_000,
      }),
    );
    const set = build(attempts, states);
    expect(set.questionIds).toContain('a-3');
    expect(set.questionIds).toContain('b-4');
    expect(set.breakdown.dueReview).toBeGreaterThan(0);
  });

  it('targets the weak concept rather than re-serving the exact same question', () => {
    // The user keeps missing a-0 (concept-a). Other concept-a items should appear.
    const attempts = Array.from({ length: 6 }, (_, i) =>
      makeAttempt({
        questionId: 'a-0',
        subjectId: 'subject-a',
        minorTopicId: 'minor-a',
        conceptIds: ['concept-a'],
        correct: false,
        confidence: 'certain',
        at: NOW - (i + 1) * 3600_000,
      }),
    );
    const set = build(attempts);
    const conceptASiblings = set.questionIds.filter((id) => id.startsWith('a-') && id !== 'a-0');
    expect(conceptASiblings.length).toBeGreaterThan(0);
    expect(set.breakdown.weakness + set.breakdown.recentWrong).toBeGreaterThan(0);
  });

  it('alternates subjects instead of grouping them', () => {
    const set = build();
    const bySubject = new Map(makeBank().map((q) => [q.id, q.subjectId]));
    const subjects = set.questionIds.map((id) => bySubject.get(id));
    // Round-robin means no run of three from the same subject.
    let longestRun = 1;
    let run = 1;
    for (let i = 1; i < subjects.length; i += 1) {
      run = subjects[i] === subjects[i - 1] ? run + 1 : 1;
      longestRun = Math.max(longestRun, run);
    }
    expect(longestRun).toBeLessThanOrEqual(2);
  });

  it('excludes questions flagged for review', () => {
    const questions = makeBank().map((q) => (q.id === 'a-0' ? { ...q, needsReview: true } : q));
    const set = buildDailySet({
      config: testConfig,
      questions,
      states: [],
      attempts: [],
      subjectStats: statsFor([]),
      now: NOW,
      salt: 'salt',
    });
    expect(set.questionIds).not.toContain('a-0');
  });

  it('honours the phase cap on brand-new questions near the exam', () => {
    const nearExam = Date.parse('2026-12-30T00:00:00Z');
    const set = buildDailySet({
      config: testConfig,
      questions: makeBank(),
      states: [],
      attempts: [],
      subjectStats: statsFor([]),
      now: nearExam,
      salt: 'salt',
    });
    expect(set.phase.id).toBe('near');
    expect(set.breakdown.fresh).toBe(0);
  });

  it('ships a short set rather than handing back the same question twice', () => {
    // The bank cannot fill the goal. Padding it out would mean repeating items
    // inside a single sitting, which is the failure this whole cap exists to
    // prevent — a short, honest set beats a padded one.
    const tinyBank = [
      makeQuestion({ id: 'only-a', subjectId: 'subject-a', minorTopicId: 'minor-a' }),
      makeQuestion({ id: 'only-b', subjectId: 'subject-b', minorTopicId: 'minor-b' }),
    ];
    const set = buildDailySet({
      config: testConfig,
      questions: tinyBank,
      states: [],
      attempts: [],
      subjectStats: statsFor([]),
      now: NOW,
      salt: 'salt',
    });
    expect(set.questionIds.length).toBeLessThan(testConfig.daily.totalQuestions);
    expect(new Set(set.questionIds).size).toBe(set.questionIds.length);
    // And it must not be silent about it.
    expect(set.cap?.questionsNeeded).toBeGreaterThan(0);
  });

  it('respects an explicit daily goal override', () => {
    const set = buildDailySet({
      config: testConfig,
      questions: makeBank(),
      states: [],
      attempts: [],
      subjectStats: statsFor([]),
      now: NOW,
      salt: 'salt',
      totalOverride: 6,
    });
    expect(set.questionIds).toHaveLength(6);
  });
});

describe('daily goal vs bank size', () => {
  /** `count` questions per subject, all in the same minor topic. */
  const bankOfSize = (count: number) =>
    ['subject-a', 'subject-b'].flatMap((subjectId) =>
      Array.from({ length: count }, (_, i) =>
        makeQuestion({
          id: `${subjectId}-${i}`,
          subjectId,
          majorTopicId: subjectId === 'subject-a' ? 'major-a' : 'major-b',
          minorTopicId: subjectId === 'subject-a' ? 'minor-a' : 'minor-b',
          conceptIds: [subjectId === 'subject-a' ? 'concept-a' : 'concept-b'],
        }),
      ),
    );

  it('leaves the goal alone once the bank is comfortably large', () => {
    // Goal is 10 (5 per subject); 40 per subject means each day draws 12.5%.
    expect(sustainableDailyTotal(testConfig, bankOfSize(40))).toBe(testConfig.daily.totalQuestions);
    expect(questionsNeededForGoal(testConfig, bankOfSize(40), 10)).toBe(0);
  });

  it('caps the goal when a day would eat too much of the pool', () => {
    // 5 per subject: a 5-question draw would be the entire pool every day.
    expect(sustainableDailyTotal(testConfig, bankOfSize(5))).toBeLessThan(10);
    expect(questionsNeededForGoal(testConfig, bankOfSize(5), 10)).toBeGreaterThan(0);
  });

  it('builds a shorter set rather than recycling, and says why', () => {
    const bank = bankOfSize(5);
    const set = buildDailySet({
      config: testConfig,
      questions: bank,
      states: [],
      attempts: [],
      subjectStats: buildTopicTree({
        attempts: [],
        states: [],
        taxonomy: testTaxonomy,
        subjectNames: { 'subject-a': 'A', 'subject-b': 'B' },
        now: NOW,
      }),
      now: NOW,
      salt: 'cap',
    });

    expect(set.questionIds.length).toBeLessThan(testConfig.daily.totalQuestions);
    // No question appears twice — the recycling path must not be reached.
    expect(new Set(set.questionIds).size).toBe(set.questionIds.length);
    expect(set.cap).toBeDefined();
    expect(set.cap!.requested).toBe(testConfig.daily.totalQuestions);
    expect(set.cap!.sustainable).toBe(set.questionIds.length);
    expect(set.cap!.questionsNeeded).toBeGreaterThan(0);
  });

  it('reports no cap when the bank can serve the goal', () => {
    const bank = bankOfSize(40);
    const set = buildDailySet({
      config: testConfig,
      questions: bank,
      states: [],
      attempts: [],
      subjectStats: buildTopicTree({
        attempts: [],
        states: [],
        taxonomy: testTaxonomy,
        subjectNames: { 'subject-a': 'A', 'subject-b': 'B' },
        now: NOW,
      }),
      now: NOW,
      salt: 'cap',
    });
    expect(set.cap).toBeUndefined();
    expect(set.questionIds).toHaveLength(testConfig.daily.totalQuestions);
  });
});

describe('phase selection', () => {
  it('picks the phase matching the remaining days and renormalises the mix', () => {
    const far = currentPhase(testConfig, NOW);
    expect(far.id).toBe('far');
    const near = currentPhase(testConfig, Date.parse('2026-12-30T00:00:00Z'));
    expect(near.id).toBe('near');

    const mix = effectiveMix(testConfig, far);
    const total = Object.values(mix).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});

describe('weakness ranking', () => {
  it('puts confidently-missed topics at the top', () => {
    const attempts = [
      ...Array.from({ length: 6 }, (_, i) =>
        makeAttempt({
          questionId: `a-${i}`,
          minorTopicId: 'minor-a',
          conceptIds: ['concept-a'],
          correct: false,
          confidence: 'certain',
          at: NOW - i * 3600_000,
        }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        makeAttempt({
          questionId: `a2-${i}`,
          minorTopicId: 'minor-a2',
          conceptIds: ['concept-a2'],
          correct: true,
          confidence: 'certain',
          at: NOW - i * 3600_000,
        }),
      ),
    ];
    const ranked = rankWeaknesses(statsFor(attempts));
    expect(ranked[0].minorTopicId).toBe('minor-a');
    expect(ranked[0].riskyCount).toBe(6);
    expect(ranked[0].priority).toBeGreaterThan(ranked[1].priority);
  });
});
