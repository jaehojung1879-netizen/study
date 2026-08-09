/** IndexedDB-backed `StudyStorage` (Dexie). The default in the browser. */
import Dexie, { type Table } from 'dexie';
import { DEXIE_STORES, SCHEMA_VERSION } from './schema';
import { emptyReport, matchesAttempt } from './memoryStorage';
import type {
  AppSettings,
  Attempt,
  AttemptQuery,
  BackupFile,
  Flashcard,
  ImportReport,
  MockResult,
  MockSession,
  PracticeSession,
  QuestionState,
  StudyMode,
  StudyStorage,
} from './types';

const SETTINGS_KEY = 'app-settings';

interface KvRow {
  key: string;
  value: unknown;
}

class StudyDexie extends Dexie {
  attempts!: Table<Attempt, string>;
  questionStates!: Table<QuestionState, string>;
  sessions!: Table<PracticeSession, string>;
  mockResults!: Table<MockResult, string>;
  mockSessions!: Table<MockSession, string>;
  flashcards!: Table<Flashcard, string>;
  kv!: Table<KvRow, string>;

  constructor(name: string) {
    super(name);
    for (const [version, stores] of Object.entries(DEXIE_STORES)) {
      this.version(Number(version)).stores(stores);
    }
  }
}

export class DexieStudyStorage implements StudyStorage {
  readonly kind = 'indexeddb' as const;
  private db: StudyDexie;

  constructor(dbName = 'study-db') {
    this.db = new StudyDexie(dbName);
  }

  async open(): Promise<void> {
    await this.db.open();
    const stored = await this.db.kv.get('schemaVersion');
    if (!stored) await this.db.kv.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  }

  async getSettings(): Promise<AppSettings | null> {
    const row = await this.db.kv.get(SETTINGS_KEY);
    return (row?.value as AppSettings) ?? null;
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.db.kv.put({ key: SETTINGS_KEY, value: settings });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const row = await this.db.kv.get(key);
    return row?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.kv.put({ key, value });
  }

  async addAttempt(attempt: Attempt): Promise<void> {
    await this.db.attempts.put(attempt);
  }

  async listAttempts(query: AttemptQuery = {}): Promise<Attempt[]> {
    // `at` is indexed; every other predicate is cheap in memory at this data size.
    const base =
      query.since !== undefined
        ? await this.db.attempts.where('at').aboveOrEqual(query.since).toArray()
        : await this.db.attempts.toArray();
    const rows = base.filter((a) => matchesAttempt(a, query)).sort((a, b) => a.at - b.at);
    return query.limit && rows.length > query.limit ? rows.slice(-query.limit) : rows;
  }

  async getQuestionState(questionId: string): Promise<QuestionState | undefined> {
    return this.db.questionStates.get(questionId);
  }

  async putQuestionState(state: QuestionState): Promise<void> {
    await this.db.questionStates.put(state);
  }

  async listQuestionStates(examId?: string): Promise<QuestionState[]> {
    if (!examId) return this.db.questionStates.toArray();
    return this.db.questionStates.where('examId').equals(examId).toArray();
  }

  async getSession(id: string): Promise<PracticeSession | undefined> {
    return this.db.sessions.get(id);
  }

  async findSessionByDate(
    examId: string,
    dateKey: string,
    mode: StudyMode,
  ): Promise<PracticeSession | undefined> {
    const rows = await this.db.sessions.where('dateKey').equals(dateKey).toArray();
    return rows.find((s) => s.examId === examId && s.mode === mode);
  }

  async putSession(session: PracticeSession): Promise<void> {
    await this.db.sessions.put(session);
  }

  async listSessions(examId?: string): Promise<PracticeSession[]> {
    const rows = examId
      ? await this.db.sessions.where('examId').equals(examId).toArray()
      : await this.db.sessions.toArray();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  async putMockResult(result: MockResult): Promise<void> {
    await this.db.mockResults.put(result);
  }

  async listMockResults(examId?: string): Promise<MockResult[]> {
    const rows = examId
      ? await this.db.mockResults.where('examId').equals(examId).toArray()
      : await this.db.mockResults.toArray();
    return rows.sort((a, b) => a.finishedAt - b.finishedAt);
  }

  async getMockSession(id: string): Promise<MockSession | undefined> {
    return this.db.mockSessions.get(id);
  }

  async putMockSession(session: MockSession): Promise<void> {
    await this.db.mockSessions.put(session);
  }

  async listMockSessions(examId?: string): Promise<MockSession[]> {
    const rows = examId
      ? await this.db.mockSessions.where('examId').equals(examId).toArray()
      : await this.db.mockSessions.toArray();
    return rows.sort((a, b) => b.startedAt - a.startedAt);
  }

  async deleteMockSession(id: string): Promise<void> {
    await this.db.mockSessions.delete(id);
  }

  async putFlashcard(card: Flashcard): Promise<void> {
    await this.db.flashcards.put(card);
  }

  async listFlashcards(examId?: string): Promise<Flashcard[]> {
    const rows = examId
      ? await this.db.flashcards.where('examId').equals(examId).toArray()
      : await this.db.flashcards.toArray();
    return rows.sort((a, b) => a.dueAt - b.dueAt);
  }

  async deleteFlashcard(id: string): Promise<void> {
    await this.db.flashcards.delete(id);
  }

  async exportAll(): Promise<BackupFile> {
    const [attempts, questionStates, sessions, mockResults, mockSessions, flashcards, kv] =
      await Promise.all([
        this.db.attempts.toArray(),
        this.db.questionStates.toArray(),
        this.db.sessions.toArray(),
        this.db.mockResults.toArray(),
        this.db.mockSessions.toArray(),
        this.db.flashcards.toArray(),
        this.db.kv.toArray(),
      ]);
    const meta: Record<string, unknown> = {};
    for (const row of kv) if (row.key !== SETTINGS_KEY) meta[row.key] = row.value;

    return {
      format: 'study-backup',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: __APP_VERSION__,
      data: {
        attempts,
        questionStates,
        sessions,
        mockResults,
        mockSessions,
        flashcards,
        settings: await this.getSettings(),
        meta,
      },
    };
  }

  async importAll(backup: BackupFile, mode: 'merge' | 'replace'): Promise<ImportReport> {
    const report = emptyReport(mode);
    await this.db.transaction(
      'rw',
      [
        this.db.attempts,
        this.db.questionStates,
        this.db.sessions,
        this.db.mockResults,
        this.db.mockSessions,
        this.db.flashcards,
        this.db.kv,
      ],
      async () => {
        if (mode === 'replace') {
          await Promise.all([
            this.db.attempts.clear(),
            this.db.questionStates.clear(),
            this.db.sessions.clear(),
            this.db.mockResults.clear(),
            this.db.mockSessions.clear(),
            this.db.flashcards.clear(),
            this.db.kv.clear(),
          ]);
        }

        const existingAttemptIds = new Set(await this.db.attempts.toCollection().primaryKeys());
        const freshAttempts = backup.data.attempts.filter((a) => {
          if (existingAttemptIds.has(a.id)) {
            report.skipped.attempts += 1;
            return false;
          }
          return true;
        });
        await this.db.attempts.bulkPut(freshAttempts);
        report.imported.attempts = freshAttempts.length;

        // Last write wins per question, decided by review recency rather than import order.
        const incomingStates: QuestionState[] = [];
        for (const s of backup.data.questionStates) {
          const existing = await this.db.questionStates.get(s.questionId);
          if (existing && existing.lastReviewedAt >= s.lastReviewedAt) {
            report.skipped.questionStates += 1;
            continue;
          }
          incomingStates.push(s);
        }
        await this.db.questionStates.bulkPut(incomingStates);
        report.imported.questionStates = incomingStates.length;

        await this.db.sessions.bulkPut(backup.data.sessions);
        report.imported.sessions = backup.data.sessions.length;
        await this.db.mockResults.bulkPut(backup.data.mockResults);
        report.imported.mockResults = backup.data.mockResults.length;
        await this.db.mockSessions.bulkPut(backup.data.mockSessions);
        report.imported.mockSessions = backup.data.mockSessions.length;
        await this.db.flashcards.bulkPut(backup.data.flashcards);
        report.imported.flashcards = backup.data.flashcards.length;

        if (backup.data.settings) {
          await this.db.kv.put({ key: SETTINGS_KEY, value: backup.data.settings });
          report.imported.settings = 1;
        }
        for (const [key, value] of Object.entries(backup.data.meta ?? {})) {
          await this.db.kv.put({ key, value });
        }
        await this.db.kv.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
      },
    );
    return report;
  }

  async clearAll(): Promise<void> {
    await Promise.all([
      this.db.attempts.clear(),
      this.db.questionStates.clear(),
      this.db.sessions.clear(),
      this.db.mockResults.clear(),
      this.db.mockSessions.clear(),
      this.db.flashcards.clear(),
      this.db.kv.clear(),
    ]);
    await this.db.kv.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  }
}
