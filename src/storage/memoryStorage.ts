/**
 * In-memory `StudyStorage`.
 *
 * Used by unit tests and as the fallback when IndexedDB is unavailable
 * (private browsing, locked-down webviews) so the app still works for a
 * session even though nothing survives a reload.
 */
import { SCHEMA_VERSION } from './schema';
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

export class MemoryStudyStorage implements StudyStorage {
  readonly kind = 'memory' as const;

  private attempts: Attempt[] = [];
  private questionStates = new Map<string, QuestionState>();
  private sessions = new Map<string, PracticeSession>();
  private mockResults = new Map<string, MockResult>();
  private mockSessions = new Map<string, MockSession>();
  private flashcards = new Map<string, Flashcard>();
  private kv = new Map<string, unknown>();
  private settings: AppSettings | null = null;

  async open(): Promise<void> {
    /* nothing to open */
  }

  async getSettings(): Promise<AppSettings | null> {
    return this.settings ? { ...this.settings } : null;
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    this.settings = { ...settings };
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.kv.get(key) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    this.kv.set(key, value);
  }

  async addAttempt(attempt: Attempt): Promise<void> {
    this.attempts.push({ ...attempt });
  }

  async listAttempts(query: AttemptQuery = {}): Promise<Attempt[]> {
    let rows = this.attempts.filter((a) => matchesAttempt(a, query));
    rows = rows.sort((a, b) => a.at - b.at);
    if (query.limit && rows.length > query.limit) rows = rows.slice(-query.limit);
    return rows.map((a) => ({ ...a }));
  }

  async getQuestionState(questionId: string): Promise<QuestionState | undefined> {
    const found = this.questionStates.get(questionId);
    return found ? { ...found } : undefined;
  }

  async putQuestionState(state: QuestionState): Promise<void> {
    this.questionStates.set(state.questionId, { ...state });
  }

  async listQuestionStates(examId?: string): Promise<QuestionState[]> {
    return [...this.questionStates.values()]
      .filter((s) => !examId || s.examId === examId)
      .map((s) => ({ ...s }));
  }

  async getSession(id: string): Promise<PracticeSession | undefined> {
    const found = this.sessions.get(id);
    return found ? { ...found } : undefined;
  }

  async findSessionByDate(
    examId: string,
    dateKey: string,
    mode: StudyMode,
  ): Promise<PracticeSession | undefined> {
    const found = [...this.sessions.values()].find(
      (s) => s.examId === examId && s.dateKey === dateKey && s.mode === mode,
    );
    return found ? { ...found } : undefined;
  }

  async putSession(session: PracticeSession): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async listSessions(examId?: string): Promise<PracticeSession[]> {
    return [...this.sessions.values()]
      .filter((s) => !examId || s.examId === examId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({ ...s }));
  }

  async putMockResult(result: MockResult): Promise<void> {
    this.mockResults.set(result.id, { ...result });
  }

  async listMockResults(examId?: string): Promise<MockResult[]> {
    return [...this.mockResults.values()]
      .filter((r) => !examId || r.examId === examId)
      .sort((a, b) => a.finishedAt - b.finishedAt)
      .map((r) => ({ ...r }));
  }

  async getMockSession(id: string): Promise<MockSession | undefined> {
    const found = this.mockSessions.get(id);
    return found ? { ...found } : undefined;
  }

  async putMockSession(session: MockSession): Promise<void> {
    this.mockSessions.set(session.id, { ...session });
  }

  async listMockSessions(examId?: string): Promise<MockSession[]> {
    return [...this.mockSessions.values()]
      .filter((s) => !examId || s.examId === examId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((s) => ({ ...s }));
  }

  async deleteMockSession(id: string): Promise<void> {
    this.mockSessions.delete(id);
  }

  async putFlashcard(card: Flashcard): Promise<void> {
    this.flashcards.set(card.id, { ...card });
  }

  async listFlashcards(examId?: string): Promise<Flashcard[]> {
    return [...this.flashcards.values()]
      .filter((c) => !examId || c.examId === examId)
      .sort((a, b) => a.dueAt - b.dueAt)
      .map((c) => ({ ...c }));
  }

  async deleteFlashcard(id: string): Promise<void> {
    this.flashcards.delete(id);
  }

  async exportAll(): Promise<BackupFile> {
    return {
      format: 'study-backup',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: __APP_VERSION__,
      data: {
        attempts: await this.listAttempts(),
        questionStates: await this.listQuestionStates(),
        sessions: await this.listSessions(),
        mockResults: await this.listMockResults(),
        mockSessions: await this.listMockSessions(),
        flashcards: await this.listFlashcards(),
        settings: await this.getSettings(),
        meta: Object.fromEntries(this.kv.entries()),
      },
    };
  }

  async importAll(backup: BackupFile, mode: 'merge' | 'replace'): Promise<ImportReport> {
    if (mode === 'replace') await this.clearAll();
    const report = emptyReport(mode);

    const seenAttempts = new Set(this.attempts.map((a) => a.id));
    for (const a of backup.data.attempts) {
      if (seenAttempts.has(a.id)) {
        report.skipped.attempts += 1;
        continue;
      }
      seenAttempts.add(a.id);
      this.attempts.push(a);
      report.imported.attempts += 1;
    }
    for (const s of backup.data.questionStates) {
      const existing = this.questionStates.get(s.questionId);
      if (existing && existing.lastReviewedAt >= s.lastReviewedAt) {
        report.skipped.questionStates += 1;
        continue;
      }
      this.questionStates.set(s.questionId, s);
      report.imported.questionStates += 1;
    }
    for (const s of backup.data.sessions) {
      this.sessions.set(s.id, s);
      report.imported.sessions += 1;
    }
    for (const r of backup.data.mockResults) {
      this.mockResults.set(r.id, r);
      report.imported.mockResults += 1;
    }
    for (const s of backup.data.mockSessions) {
      this.mockSessions.set(s.id, s);
      report.imported.mockSessions += 1;
    }
    for (const c of backup.data.flashcards) {
      this.flashcards.set(c.id, c);
      report.imported.flashcards += 1;
    }
    if (backup.data.settings) {
      this.settings = backup.data.settings;
      report.imported.settings += 1;
    }
    for (const [k, v] of Object.entries(backup.data.meta ?? {})) this.kv.set(k, v);
    return report;
  }

  async clearAll(): Promise<void> {
    this.attempts = [];
    this.questionStates.clear();
    this.sessions.clear();
    this.mockResults.clear();
    this.mockSessions.clear();
    this.flashcards.clear();
    this.kv.clear();
    this.settings = null;
  }
}

export function matchesAttempt(a: Attempt, query: AttemptQuery): boolean {
  if (query.examId && a.examId !== query.examId) return false;
  if (query.subjectId && a.subjectId !== query.subjectId) return false;
  if (query.questionId && a.questionId !== query.questionId) return false;
  if (query.mode && a.mode !== query.mode) return false;
  if (query.since !== undefined && a.at < query.since) return false;
  return true;
}

export function emptyReport(mode: 'merge' | 'replace'): ImportReport {
  const zero = () => ({
    attempts: 0,
    questionStates: 0,
    sessions: 0,
    mockResults: 0,
    mockSessions: 0,
    flashcards: 0,
    settings: 0,
  });
  return { imported: zero(), skipped: zero(), mode };
}
