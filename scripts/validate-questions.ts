#!/usr/bin/env tsx
/**
 * CI gate for the question bank (§33). Exits non-zero on any error so a broken
 * bank never reaches GitHub Pages.
 *
 *   npm run validate:questions
 */
import { validateConceptNotes, validateQuestionBank, type Issue } from '../src/exam/validation';
import { loadAllExams } from './lib/loadExams';

function main(): void {
  const exams = loadAllExams();
  if (exams.length === 0) {
    console.error('data/exams/ 아래에 시험 데이터가 없습니다.');
    process.exit(1);
  }

  let errorCount = 0;
  let warningCount = 0;

  for (const exam of exams) {
    const issues = validateQuestionBank(exam.questions, exam.taxonomy, exam.config);
    const errors = issues.filter((i) => i.level === 'error');
    const warnings = issues.filter((i) => i.level === 'warning');
    errorCount += errors.length;
    warningCount += warnings.length;

    console.info(
      `\n[${exam.examId}] ${exam.questions.length}문항 · 오류 ${errors.length} · 경고 ${warnings.length}`,
    );
    printByFile(exam.questionFiles, errors, '  ✗');
    printByFile(exam.questionFiles, warnings, '  ⚠');

    const noteIssues = validateConceptNotes(
      exam.conceptNotes,
      exam.taxonomy,
      exam.config,
      exam.questions,
    );
    const noteErrors = noteIssues.filter((i) => i.level === 'error');
    const noteWarnings = noteIssues.filter((i) => i.level === 'warning');
    errorCount += noteErrors.length;
    warningCount += noteWarnings.length;
    console.info(
      `  개념노트 ${exam.conceptNotes.length}개 · 오류 ${noteErrors.length} · 경고 ${noteWarnings.length}`,
    );
    printByFile(exam.conceptNoteFiles, noteErrors, '  ✗');
    printByFile(exam.conceptNoteFiles, noteWarnings, '  ⚠');

    // Coverage report: which minor topics have no questions at all.
    const covered = new Set(exam.questions.map((q) => q.minorTopicId));
    const missing: string[] = [];
    for (const subject of exam.taxonomy.subjects) {
      for (const major of subject.majorTopics) {
        for (const minor of major.minorTopics) {
          if (!covered.has(minor.id)) missing.push(`${major.name} › ${minor.name}`);
        }
      }
    }
    if (missing.length > 0) {
      console.info(`  · 문항이 없는 소분류 ${missing.length}개: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`);
    }

    for (const subject of exam.config.subjects) {
      const count = exam.questions.filter((q) => q.subjectId === subject.id).length;
      const dailyNeed = subject.dailyQuestionCount;
      const note = count < dailyNeed ? ` (하루 목표 ${dailyNeed}문항보다 적어 문항이 반복됩니다)` : '';
      console.info(`  · ${subject.shortName}: ${count}문항${note}`);
    }
  }

  console.info(`\n총 오류 ${errorCount}건, 경고 ${warningCount}건`);
  if (errorCount > 0) {
    console.error('검증 실패 — 오류를 수정해야 배포할 수 있습니다.');
    process.exit(1);
  }
  console.info('검증 통과.');
}

function printByFile(files: Map<string, string>, issues: Issue[], prefix: string): void {
  for (const issue of issues) {
    const file = files.get(issue.questionId) ?? '(unknown file)';
    console.info(`${prefix} ${file} · ${issue.questionId} · [${issue.rule}] ${issue.message}`);
  }
}

main();
