#!/usr/bin/env tsx
/**
 * Duplicate detection (§19).
 *
 * Repeating a *concept* is desirable — that is how weak areas get drilled from
 * several angles. Repeating a *stem* is not. This script only fails the build on
 * the latter.
 *
 *   npm run check:duplicates
 */
import { DUPLICATE_THRESHOLD, findDuplicates, NEAR_DUPLICATE_THRESHOLD } from '../src/exam/validation';
import { loadAllExams } from './lib/loadExams';

function main(): void {
  let hardDuplicates = 0;

  for (const exam of loadAllExams()) {
    const pairs = findDuplicates(exam.questions, NEAR_DUPLICATE_THRESHOLD);
    const duplicates = pairs.filter((p) => p.score >= DUPLICATE_THRESHOLD);
    const near = pairs.filter((p) => p.score < DUPLICATE_THRESHOLD);
    hardDuplicates += duplicates.length;

    console.info(
      `\n[${exam.examId}] ${exam.questions.length}문항 · 중복 ${duplicates.length} · 유사 ${near.length}`,
    );

    for (const pair of duplicates) {
      console.info(
        `  ✗ 중복(${pair.score}) ${pair.a} ↔ ${pair.b}\n     ${exam.questionFiles.get(pair.a)} / ${exam.questionFiles.get(pair.b)}`,
      );
    }
    for (const pair of near) {
      const kind = pair.sameConceptOnly ? '같은 개념 · 다른 형태(허용)' : '지문 유사 — 확인 권장';
      console.info(`  ⚠ 유사(${pair.score}) ${pair.a} ↔ ${pair.b} — ${kind}`);
    }
  }

  if (hardDuplicates > 0) {
    console.error(`\n동일 지문 중복 ${hardDuplicates}쌍이 발견되었습니다. 하나를 제거하거나 다시 쓰세요.`);
    process.exit(1);
  }
  console.info('\n동일 지문 중복 없음.');
}

main();
