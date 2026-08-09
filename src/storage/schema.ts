/**
 * Storage schema version + backup migrations.
 *
 * Bump `SCHEMA_VERSION` whenever the persisted shape changes and add a step to
 * `BACKUP_MIGRATIONS`, so a JSON backup taken by an older build still restores.
 */
import type { Attempt, BackupFile, Confidence, QuestionState } from './types';

export const SCHEMA_VERSION = 2;

/** Dexie store definitions, indexed by Dexie version number. */
export const DEXIE_STORES: Record<number, Record<string, string>> = {
  1: {
    attempts: 'id, examId, questionId, sessionId, subjectId, at, mode',
    questionStates: 'questionId, examId, subjectId, dueAt, riskFlagged, bookmarked',
    sessions: 'id, examId, dateKey, mode, createdAt',
    mockResults: 'id, examId, finishedAt',
    mockSessions: 'id, examId, startedAt',
    flashcards: 'id, examId, questionId, dueAt',
    kv: 'key',
  },
};

export const DEXIE_VERSION = Math.max(...Object.keys(DEXIE_STORES).map(Number));

type RawBackup = Omit<BackupFile, 'schemaVersion' | 'data'> & {
  schemaVersion: number;
  data: Record<string, unknown>;
};

type MigrationStep = (raw: RawBackup) => RawBackup;

/**
 * `BACKUP_MIGRATIONS[n]` upgrades a backup written at schemaVersion `n`
 * to schemaVersion `n + 1`.
 */
export const BACKUP_MIGRATIONS: Record<number, MigrationStep> = {
  // v1 predates the confidence prompt and the resumable mock sitting.
  1: (raw) => {
    const attempts = (raw.data.attempts as Partial<Attempt>[] | undefined) ?? [];
    const questionStates = (raw.data.questionStates as Partial<QuestionState>[] | undefined) ?? [];
    return {
      ...raw,
      schemaVersion: 2,
      data: {
        ...raw.data,
        attempts: attempts.map((a) => ({
          ...a,
          confidence: (a.confidence ?? 'unsure') as Confidence,
          conceptIds: a.conceptIds ?? [],
        })),
        questionStates: questionStates.map((s) => ({
          ...s,
          lastConfidence: (s.lastConfidence ?? 'unsure') as Confidence,
          riskFlagged: s.riskFlagged ?? false,
          bookmarked: s.bookmarked ?? false,
          retired: s.retired ?? false,
        })),
        mockSessions: raw.data.mockSessions ?? [],
      },
    };
  },
};

export class BackupFormatError extends Error {}

/** Validates and upgrades an arbitrary parsed JSON blob into the current backup shape. */
export function migrateBackup(input: unknown): BackupFile {
  if (!input || typeof input !== 'object') {
    throw new BackupFormatError('백업 파일을 읽을 수 없습니다. JSON 형식이 아닙니다.');
  }
  const raw = input as RawBackup;
  if (raw.format !== 'study-backup') {
    throw new BackupFormatError('이 앱에서 만든 백업 파일이 아닙니다. (format 불일치)');
  }
  const version = Number(raw.schemaVersion);
  if (!Number.isFinite(version) || version < 1) {
    throw new BackupFormatError('백업 파일의 schemaVersion이 올바르지 않습니다.');
  }
  if (version > SCHEMA_VERSION) {
    throw new BackupFormatError(
      `이 백업(v${version})은 현재 앱(v${SCHEMA_VERSION})보다 최신입니다. 앱을 먼저 업데이트하세요.`,
    );
  }

  let current: RawBackup = { ...raw, data: { ...(raw.data ?? {}) } };
  for (let v = version; v < SCHEMA_VERSION; v += 1) {
    const step = BACKUP_MIGRATIONS[v];
    if (!step) throw new BackupFormatError(`schemaVersion ${v} → ${v + 1} 마이그레이션이 없습니다.`);
    current = step(current);
  }

  const data = current.data;
  return {
    format: 'study-backup',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: current.exportedAt ?? new Date().toISOString(),
    appVersion: current.appVersion ?? 'unknown',
    data: {
      attempts: asArray(data.attempts),
      questionStates: asArray(data.questionStates),
      sessions: asArray(data.sessions),
      mockResults: asArray(data.mockResults),
      mockSessions: asArray(data.mockSessions),
      flashcards: asArray(data.flashcards),
      settings: (data.settings as BackupFile['data']['settings']) ?? null,
      meta: (data.meta as Record<string, unknown>) ?? {},
    },
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
