import { beforeEach, describe, expect, it } from 'vitest';
import { DexieStudyStorage } from '../src/storage/dexieStorage';
import { MemoryStudyStorage } from '../src/storage/memoryStorage';
import { BackupFormatError, migrateBackup, SCHEMA_VERSION } from '../src/storage/schema';
import type { BackupFile, StudyStorage } from '../src/storage/types';
import { makeAttempt, makeState } from './helpers';

const backends: Array<[string, () => StudyStorage]> = [
  ['memory', () => new MemoryStudyStorage()],
  ['dexie', () => new DexieStudyStorage(`test-db-${Math.random().toString(36).slice(2)}`)],
];

describe.each(backends)('%s storage', (_name, create) => {
  let storage: StudyStorage;

  beforeEach(async () => {
    storage = create();
    await storage.open();
  });

  it('persists and queries attempts', async () => {
    await storage.addAttempt(makeAttempt({ id: 'a1', at: 100, subjectId: 'subject-a' }));
    await storage.addAttempt(makeAttempt({ id: 'a2', at: 300, subjectId: 'subject-b' }));
    await storage.addAttempt(makeAttempt({ id: 'a3', at: 200, subjectId: 'subject-a' }));

    const all = await storage.listAttempts({ examId: 'test-exam' });
    expect(all.map((a) => a.id)).toEqual(['a1', 'a3', 'a2']); // chronological

    expect((await storage.listAttempts({ subjectId: 'subject-a' })).map((a) => a.id)).toEqual(['a1', 'a3']);
    expect((await storage.listAttempts({ since: 200 })).map((a) => a.id)).toEqual(['a3', 'a2']);
    expect((await storage.listAttempts({ limit: 1 })).map((a) => a.id)).toEqual(['a2']); // most recent
    expect(await storage.listAttempts({ examId: 'other' })).toHaveLength(0);
  });

  it('upserts question state by question id', async () => {
    await storage.putQuestionState(makeState({ questionId: 'q1', streak: 1 }));
    await storage.putQuestionState(makeState({ questionId: 'q1', streak: 4 }));
    expect(await storage.listQuestionStates('test-exam')).toHaveLength(1);
    expect((await storage.getQuestionState('q1'))?.streak).toBe(4);
  });

  it('finds today\'s practice session by date key', async () => {
    const session = {
      id: 's1',
      examId: 'test-exam',
      mode: 'practice' as const,
      dateKey: '2026-03-01',
      questionIds: ['q1'],
      buckets: ['fresh'],
      cursor: 0,
      answeredCount: 0,
      correctCount: 0,
      createdAt: 1,
      planSummary: 'x',
    };
    await storage.putSession(session);
    expect(await storage.findSessionByDate('test-exam', '2026-03-01', 'practice')).toMatchObject({ id: 's1' });
    expect(await storage.findSessionByDate('test-exam', '2026-03-02', 'practice')).toBeUndefined();
    expect(await storage.findSessionByDate('test-exam', '2026-03-01', 'mock')).toBeUndefined();
  });

  it('round-trips a full backup', async () => {
    await storage.saveSettings({
      activeExamId: 'test-exam',
      theme: 'dark',
      dailyGoalOverride: 50,
      confidencePromptEnabled: true,
      errorCausePromptEnabled: false,
      selectionSalt: 'abc',
    });
    await storage.addAttempt(makeAttempt({ id: 'a1' }));
    await storage.putQuestionState(makeState({ questionId: 'q1' }));
    await storage.setMeta('lastSeenTip', 3);

    const backup = await storage.exportAll();
    expect(backup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(backup.data.attempts).toHaveLength(1);
    expect(backup.data.settings?.theme).toBe('dark');

    const restored = create();
    await restored.open();
    const report = await restored.importAll(backup, 'replace');
    expect(report.imported.attempts).toBe(1);
    expect((await restored.getSettings())?.selectionSalt).toBe('abc');
    expect(await restored.getMeta('lastSeenTip')).toBe(3);
    expect(await restored.listQuestionStates()).toHaveLength(1);
  });

  it('merge import skips attempts it already has', async () => {
    await storage.addAttempt(makeAttempt({ id: 'a1' }));
    const backup = await storage.exportAll();
    backup.data.attempts.push(makeAttempt({ id: 'a2' }));

    const report = await storage.importAll(backup, 'merge');
    expect(report.imported.attempts).toBe(1);
    expect(report.skipped.attempts).toBe(1);
    expect(await storage.listAttempts()).toHaveLength(2);
  });

  it('merge keeps the more recently reviewed question state', async () => {
    await storage.putQuestionState(makeState({ questionId: 'q1', streak: 9, lastReviewedAt: 5_000 }));
    const backup: BackupFile = {
      format: 'study-backup',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: 'test',
      data: {
        attempts: [],
        questionStates: [makeState({ questionId: 'q1', streak: 1, lastReviewedAt: 1_000 })],
        sessions: [],
        mockResults: [],
        mockSessions: [],
        flashcards: [],
        settings: null,
        meta: {},
      },
    };
    await storage.importAll(backup, 'merge');
    expect((await storage.getQuestionState('q1'))?.streak).toBe(9);
  });

  it('clearAll empties everything', async () => {
    await storage.addAttempt(makeAttempt({ id: 'a1' }));
    await storage.putQuestionState(makeState({ questionId: 'q1' }));
    await storage.clearAll();
    expect(await storage.listAttempts()).toHaveLength(0);
    expect(await storage.listQuestionStates()).toHaveLength(0);
    expect(await storage.getSettings()).toBeNull();
  });
});

describe('backup migration', () => {
  it('upgrades a v1 backup, filling in fields added later', () => {
    const legacy = {
      format: 'study-backup',
      schemaVersion: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.0.1',
      data: {
        attempts: [{ id: 'a1', questionId: 'q1', correct: false }],
        questionStates: [{ questionId: 'q1', intervalDays: 3 }],
        sessions: [],
        mockResults: [],
        flashcards: [],
      },
    };
    const migrated = migrateBackup(legacy);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.data.attempts[0].confidence).toBe('unsure');
    expect(migrated.data.attempts[0].conceptIds).toEqual([]);
    expect(migrated.data.questionStates[0].riskFlagged).toBe(false);
    expect(migrated.data.mockSessions).toEqual([]);
  });

  it('passes a current backup through unchanged', () => {
    const current: BackupFile = {
      format: 'study-backup',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.1.0',
      data: {
        attempts: [makeAttempt({ id: 'a1' })],
        questionStates: [],
        sessions: [],
        mockResults: [],
        mockSessions: [],
        flashcards: [],
        settings: null,
        meta: {},
      },
    };
    expect(migrateBackup(current).data.attempts[0].id).toBe('a1');
  });

  it('rejects files that are not our backups', () => {
    expect(() => migrateBackup(null)).toThrow(BackupFormatError);
    expect(() => migrateBackup({ format: 'something-else' })).toThrow(BackupFormatError);
    expect(() => migrateBackup({ format: 'study-backup', schemaVersion: 0 })).toThrow(BackupFormatError);
  });

  it('refuses a backup from a newer app version rather than silently dropping data', () => {
    expect(() =>
      migrateBackup({ format: 'study-backup', schemaVersion: SCHEMA_VERSION + 5, data: {} }),
    ).toThrow(/최신/);
  });
});
