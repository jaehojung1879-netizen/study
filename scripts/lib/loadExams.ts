/**
 * Filesystem loader for the exam data.
 *
 * The app uses `import.meta.glob` (bundler), but scripts run under tsx with no
 * bundler, so they read the same folders directly. Both paths must agree on the
 * layout: `data/exams/<examId>/{exam.json,taxonomy.json,questions/*.json,
 * concept-notes/*.json,updates/*.json}`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ConceptNote,
  ExamConfig,
  LawUpdateEvent,
  Question,
  Taxonomy,
} from '../../src/exam/types';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');
export const EXAMS_DIR = path.join(REPO_ROOT, 'data', 'exams');

export interface LoadedExam {
  examId: string;
  dir: string;
  config: ExamConfig;
  taxonomy: Taxonomy;
  questions: Question[];
  /** Which file each question came from, for actionable error messages. */
  questionFiles: Map<string, string>;
  conceptNotes: ConceptNote[];
  /** Which file each concept note came from, keyed by conceptId. */
  conceptNoteFiles: Map<string, string>;
  updates: LawUpdateEvent[];
}

export function listExamIds(): string[] {
  if (!fs.existsSync(EXAMS_DIR)) return [];
  return fs
    .readdirSync(EXAMS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function readJson<T>(file: string): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (error) {
    throw new Error(`JSON 파싱 실패: ${path.relative(REPO_ROOT, file)} — ${(error as Error).message}`);
  }
}

export function loadExam(examId: string): LoadedExam {
  const dir = path.join(EXAMS_DIR, examId);
  const config = readJson<ExamConfig>(path.join(dir, 'exam.json'));
  const taxonomy = readJson<Taxonomy>(path.join(dir, 'taxonomy.json'));

  const questions: Question[] = [];
  const questionFiles = new Map<string, string>();
  const questionsDir = path.join(dir, 'questions');
  if (fs.existsSync(questionsDir)) {
    for (const file of fs.readdirSync(questionsDir).filter((f) => f.endsWith('.json')).sort()) {
      const full = path.join(questionsDir, file);
      const parsed = readJson<Question[]>(full);
      if (!Array.isArray(parsed)) {
        throw new Error(`${path.relative(REPO_ROOT, full)}: 최상위가 배열이어야 합니다.`);
      }
      for (const q of parsed) {
        questions.push(q);
        questionFiles.set(q.id, path.relative(REPO_ROOT, full));
      }
    }
  }

  const conceptNotes: ConceptNote[] = [];
  const conceptNoteFiles = new Map<string, string>();
  const notesDir = path.join(dir, 'concept-notes');
  if (fs.existsSync(notesDir)) {
    for (const file of fs.readdirSync(notesDir).filter((f) => f.endsWith('.json')).sort()) {
      const full = path.join(notesDir, file);
      const parsed = readJson<ConceptNote[]>(full);
      if (!Array.isArray(parsed)) {
        throw new Error(`${path.relative(REPO_ROOT, full)}: 최상위가 배열이어야 합니다.`);
      }
      for (const note of parsed) {
        conceptNotes.push(note);
        conceptNoteFiles.set(note.conceptId, path.relative(REPO_ROOT, full));
      }
    }
  }

  const updates: LawUpdateEvent[] = [];
  const updatesDir = path.join(dir, 'updates');
  if (fs.existsSync(updatesDir)) {
    for (const file of fs.readdirSync(updatesDir).filter((f) => f.endsWith('.json')).sort()) {
      const parsed = readJson<LawUpdateEvent[]>(path.join(updatesDir, file));
      if (Array.isArray(parsed)) updates.push(...parsed);
    }
  }

  return {
    examId,
    dir,
    config,
    taxonomy,
    questions,
    questionFiles,
    conceptNotes,
    conceptNoteFiles,
    updates,
  };
}

export function loadAllExams(): LoadedExam[] {
  return listExamIds().map(loadExam);
}
