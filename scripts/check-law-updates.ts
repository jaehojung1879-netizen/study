#!/usr/bin/env tsx
/**
 * Statute/precedent change detector (§16).
 *
 * Design rule: **never rewrite a question automatically.** The worst outcome is
 * silently teaching an outdated rule. This script only compares recorded
 * versions against a source adapter and, on a difference, (a) writes a change
 * event into `data/exams/<id>/updates/` and (b) marks affected questions
 * `needsReview` so the app excludes them from practice and the mock exam until
 * a human has checked the primary source.
 *
 *   npm run check:law-updates            # report only
 *   npm run check:law-updates -- --write # persist events + needsReview flags
 *
 * The default adapter is `manual`: it reads the versions a human recorded in
 * `law-sources.json` and reports which entries are stale by age. Wiring a real
 * 국가법령정보센터 client only requires implementing `LawSourceAdapter` below —
 * no other file changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { LawUpdateEvent, Question } from '../src/exam/types';
import { loadAllExams, readJson, REPO_ROOT, type LoadedExam } from './lib/loadExams';

/** One tracked statute, as recorded in `law-sources.json`. */
export interface LawSourceRecord {
  law: string;
  /** Stable identifier at 국가법령정보센터, when known. */
  lawId?: string;
  /** Version string a human confirmed, e.g. "법률 제00000호, 2025. 1. 1. 시행". */
  version: string;
  /** YYYY-MM-DD the version above was confirmed. */
  checkedAt: string;
  sourceUrl?: string;
}

export interface LawSourceFile {
  examId: string;
  /** Re-verification cadence in days. */
  recheckAfterDays: number;
  sources: LawSourceRecord[];
}

export interface RemoteLawVersion {
  law: string;
  version: string;
  effectiveFrom?: string;
  sourceUrl?: string;
}

/**
 * The seam a real client plugs into. `fetchVersion` returns `null` when the
 * adapter cannot determine the current version — which is reported as
 * "확인 필요", never as "unchanged".
 */
export interface LawSourceAdapter {
  readonly name: string;
  fetchVersion(record: LawSourceRecord): Promise<RemoteLawVersion | null>;
}

/**
 * Default adapter. Performs no network access — it cannot, because the official
 * portals require a per-user API key. It flags records whose `checkedAt` is older
 * than the configured cadence so a human re-checks them.
 */
export const manualAdapter: LawSourceAdapter = {
  name: 'manual',
  async fetchVersion() {
    return null;
  },
};

export interface DetectionResult {
  examId: string;
  changed: RemoteLawVersion[];
  stale: LawSourceRecord[];
  affectedQuestionIds: string[];
}

export async function detectChanges(
  exam: LoadedExam,
  adapter: LawSourceAdapter,
  now: Date,
): Promise<DetectionResult> {
  const file = path.join(exam.dir, 'law-sources.json');
  const result: DetectionResult = { examId: exam.examId, changed: [], stale: [], affectedQuestionIds: [] };
  if (!fs.existsSync(file)) return result;

  const sourceFile = readJson<LawSourceFile>(file);
  const staleAfterMs = sourceFile.recheckAfterDays * 86400000;

  for (const record of sourceFile.sources) {
    const remote = await adapter.fetchVersion(record);
    if (remote && remote.version !== record.version) {
      result.changed.push(remote);
      continue;
    }
    const checked = Date.parse(record.checkedAt);
    if (!Number.isFinite(checked) || now.getTime() - checked > staleAfterMs) {
      result.stale.push(record);
    }
  }

  const touchedLaws = new Set([
    ...result.changed.map((c) => c.law),
    ...result.stale.map((s) => s.law),
  ]);
  result.affectedQuestionIds = exam.questions
    .filter((q) => (q.lawReferences ?? []).some((ref) => touchedLaws.has(ref.law)))
    .map((q) => q.id);

  return result;
}

function buildEvent(exam: LoadedExam, result: DetectionResult, today: string): LawUpdateEvent | null {
  if (result.changed.length === 0) return null;
  return {
    id: `upd-${today}-${exam.examId}-auto`,
    examId: exam.examId,
    detectedAt: today,
    title: `법령 버전 변경 감지 (${result.changed.length}건)`,
    summary: `${result.changed
      .map((c) => `${c.law} → ${c.version}`)
      .join(', ')}. 관련 문항 ${result.affectedQuestionIds.length}개를 검토 대상으로 표시했습니다. 원문을 확인한 뒤 문항을 갱신하고 lawAsOf를 수정하세요.`,
    kind: 'law',
    source: '국가법령정보센터',
    sourceUrl: 'https://www.law.go.kr',
    affectedLaws: result.changed.map((c) => ({ law: c.law })),
    affectedQuestionIds: result.affectedQuestionIds,
    status: 'detected',
  };
}

function markNeedsReview(exam: LoadedExam, questionIds: Set<string>, reason: string): number {
  const byFile = new Map<string, Question[]>();
  for (const [id, file] of exam.questionFiles) {
    if (!questionIds.has(id)) continue;
    const abs = path.join(REPO_ROOT, file);
    if (!byFile.has(abs)) byFile.set(abs, readJson<Question[]>(abs));
  }
  let touched = 0;
  for (const [abs, questions] of byFile) {
    let dirty = false;
    for (const q of questions) {
      if (!questionIds.has(q.id) || q.needsReview) continue;
      q.needsReview = true;
      q.needsReviewReason = reason;
      q.updatedAt = new Date().toISOString().slice(0, 10);
      dirty = true;
      touched += 1;
    }
    if (dirty) fs.writeFileSync(abs, `${JSON.stringify(questions, null, 2)}\n`, 'utf8');
  }
  return touched;
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  let anyChange = false;

  for (const exam of loadAllExams()) {
    const result = await detectChanges(exam, manualAdapter, now);
    console.info(
      `\n[${exam.examId}] 어댑터=${manualAdapter.name} · 변경 ${result.changed.length} · 재확인 필요 ${result.stale.length}`,
    );

    if (!fs.existsSync(path.join(exam.dir, 'law-sources.json'))) {
      console.info('  · law-sources.json이 없어 추적 대상이 없습니다.');
      continue;
    }

    for (const stale of result.stale) {
      console.info(`  ⚠ ${stale.law}: 마지막 확인 ${stale.checkedAt} — 원문 재확인이 필요합니다.`);
    }
    for (const change of result.changed) {
      console.info(`  ✗ ${change.law}: 새 버전 ${change.version}`);
    }
    if (result.affectedQuestionIds.length > 0) {
      console.info(`  · 영향 문항 ${result.affectedQuestionIds.length}개`);
    }

    if (!write) continue;

    const event = buildEvent(exam, result, today);
    if (event) {
      anyChange = true;
      const updatesDir = path.join(exam.dir, 'updates');
      fs.mkdirSync(updatesDir, { recursive: true });
      const target = path.join(updatesDir, `${today}-auto.json`);
      const existing = fs.existsSync(target) ? readJson<LawUpdateEvent[]>(target) : [];
      fs.writeFileSync(
        target,
        `${JSON.stringify([...existing.filter((e) => e.id !== event.id), event], null, 2)}\n`,
        'utf8',
      );
      const marked = markNeedsReview(
        exam,
        new Set(result.affectedQuestionIds),
        `법령 버전 변경 감지 (${today}) — 원문 대조 필요`,
      );
      console.info(`  → 이벤트 기록 및 ${marked}개 문항을 needsReview로 표시했습니다.`);
    }
  }

  if (write && !anyChange) console.info('\n기록할 변경 이벤트가 없습니다.');
  console.info(
    '\n참고: 이 스크립트는 문항을 자동으로 수정하지 않습니다. 잘못된 법령을 반영하는 것보다 검토 표시가 우선입니다.',
  );
}

// Only run when executed directly, so tests can import the helpers above.
if (process.argv[1]?.includes('check-law-updates')) {
  void main();
}
