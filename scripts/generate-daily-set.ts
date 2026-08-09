#!/usr/bin/env tsx
/**
 * Offline preview of the adaptive daily set (§6).
 *
 * Useful for sanity-checking the selection mix after tuning weights, without
 * opening a browser. Optionally reads a JSON backup so you can see what *your*
 * records would produce.
 *
 *   npm run generate:daily-set
 *   npm run generate:daily-set -- --exam real-estate-agent-1 --backup ./study-backup.json
 */
import fs from 'node:fs';
import { buildTopicTree } from '../src/learning/analytics/stats';
import { BUCKET_LABELS, buildDailySet } from '../src/learning/scheduler/dailySet';
import type { BackupFile } from '../src/storage/types';
import { listExamIds, loadExam } from './lib/loadExams';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const examId = arg('exam') ?? listExamIds()[0];
  if (!examId) {
    console.error('시험 데이터가 없습니다.');
    process.exit(1);
  }
  const exam = loadExam(examId);

  const backupPath = arg('backup');
  const backup: BackupFile['data'] | null = backupPath
    ? (JSON.parse(fs.readFileSync(backupPath, 'utf8')) as BackupFile).data
    : null;
  const attempts = (backup?.attempts ?? []).filter((a) => a.examId === examId);

  const subjectStats = buildTopicTree({
    attempts,
    states: backup?.questionStates ?? [],
    taxonomy: exam.taxonomy,
    subjectNames: Object.fromEntries(exam.config.subjects.map((s) => [s.id, s.name])),
  });

  const result = buildDailySet({
    config: exam.config,
    questions: exam.questions,
    states: backup?.questionStates ?? [],
    attempts,
    subjectStats,
    now: Date.now(),
    salt: 'cli-preview',
  });

  console.info(`\n[${examId}] ${result.questionIds.length}문항 · ${result.phase.label}`);
  console.info(`기록 기반: 풀이 ${attempts.length}건 / 복습상태 ${(backup?.questionStates ?? []).length}건`);
  console.info('\n버킷 구성');
  for (const [bucket, count] of Object.entries(result.breakdown)) {
    if (count === 0) continue;
    const label = BUCKET_LABELS[bucket as keyof typeof BUCKET_LABELS];
    console.info(`  ${label.padEnd(12, ' ')} ${String(count).padStart(3, ' ')}문항  ${'█'.repeat(Math.round(count / 2))}`);
  }

  console.info('\n과목 배분');
  for (const subject of exam.config.subjects) {
    console.info(`  ${subject.shortName}: ${result.perSubject[subject.id] ?? 0}문항`);
  }

  console.info('\n단원 분포 (상위 10)');
  const byTopic = new Map<string, number>();
  for (const id of result.questionIds) {
    const q = exam.questions.find((item) => item.id === id);
    if (!q) continue;
    byTopic.set(q.minorTopicId, (byTopic.get(q.minorTopicId) ?? 0) + 1);
  }
  [...byTopic.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([topicId, count]) => console.info(`  ${topicId.padEnd(28, ' ')} ${count}문항`));

  const unique = new Set(result.questionIds).size;
  if (unique < result.questionIds.length) {
    console.info(
      `\n⚠ 문제은행(${exam.questions.length}문항)이 하루 목표보다 적어 ${result.questionIds.length - unique}문항이 중복 출제됩니다.`,
    );
  }
}

main();
