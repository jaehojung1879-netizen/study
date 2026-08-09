/**
 * Exam registry.
 *
 * Every exam is a folder under `data/exams/<id>/`; adding one requires no code
 * change. Question files are split per topic purely for reviewability — they are
 * concatenated here.
 */
import type {
  ConceptNote,
  ExamBundle,
  ExamConfig,
  LawUpdateEvent,
  MajorTopicNode,
  MinorTopicNode,
  Question,
  Taxonomy,
} from './types';

const configModules = import.meta.glob('/data/exams/*/exam.json', {
  eager: true,
  import: 'default',
}) as Record<string, ExamConfig>;

const taxonomyModules = import.meta.glob('/data/exams/*/taxonomy.json', {
  eager: true,
  import: 'default',
}) as Record<string, Taxonomy>;

const questionModules = import.meta.glob('/data/exams/*/questions/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, Question[]>;

const updateModules = import.meta.glob('/data/exams/*/updates/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, LawUpdateEvent[]>;

const conceptNoteModules = import.meta.glob('/data/exams/*/concept-notes/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, ConceptNote[]>;

function examIdFromPath(path: string): string {
  return path.split('/')[3] ?? '';
}

const bundles = new Map<string, ExamBundle>();

for (const [path, config] of Object.entries(configModules)) {
  const id = examIdFromPath(path);
  const taxonomy = Object.entries(taxonomyModules).find(([p]) => examIdFromPath(p) === id)?.[1];
  if (!taxonomy) {
    console.error(`[exam] ${id}: taxonomy.json이 없어 이 시험을 건너뜁니다.`);
    continue;
  }
  const questions = Object.entries(questionModules)
    .filter(([p]) => examIdFromPath(p) === id)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, list]) => list);
  const updates = Object.entries(updateModules)
    .filter(([p]) => examIdFromPath(p) === id)
    .flatMap(([, list]) => list);
  const conceptNotes = Object.entries(conceptNoteModules)
    .filter(([p]) => examIdFromPath(p) === id)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, list]) => list);

  bundles.set(id, { config, taxonomy, questions, conceptNotes, updates });
}

export function listExams(): ExamConfig[] {
  return [...bundles.values()].map((b) => b.config).sort((a, b) => a.name.localeCompare(b.name));
}

export function getExamBundle(examId: string): ExamBundle | undefined {
  return bundles.get(examId);
}

export const DEFAULT_EXAM_ID = bundles.has('real-estate-agent-1')
  ? 'real-estate-agent-1'
  : ([...bundles.keys()][0] ?? '');

export interface TopicPath {
  subjectId: string;
  subjectName: string;
  majorTopicId: string;
  majorTopicName: string;
  minorTopicId: string;
  minorTopicName: string;
}

/** A concept plus everything needed to render it without walking the tree again. */
export interface ConceptEntry {
  conceptId: string;
  name: string;
  path: TopicPath;
}

/** Denormalised lookups over one exam bundle; built once and shared by every screen. */
export class ExamIndex {
  readonly config: ExamConfig;
  readonly taxonomy: Taxonomy;
  readonly questions: Question[];
  readonly conceptNotes: ConceptNote[];
  readonly updates: LawUpdateEvent[];

  private byId: Map<string, Question>;
  private topicPaths: Map<string, TopicPath>;
  private conceptNames: Map<string, string>;
  private conceptToMinor: Map<string, string>;
  private conceptEntries: ConceptEntry[];
  private notesByConcept: Map<string, ConceptNote>;

  constructor(bundle: ExamBundle) {
    this.config = bundle.config;
    this.taxonomy = bundle.taxonomy;
    this.questions = bundle.questions;
    this.conceptNotes = bundle.conceptNotes;
    this.updates = bundle.updates;
    this.byId = new Map(bundle.questions.map((q) => [q.id, q]));
    this.topicPaths = new Map();
    this.conceptNames = new Map();
    this.conceptToMinor = new Map();
    this.conceptEntries = [];
    this.notesByConcept = new Map(bundle.conceptNotes.map((n) => [n.conceptId, n]));

    for (const subject of bundle.taxonomy.subjects) {
      const subjectName =
        bundle.config.subjects.find((s) => s.id === subject.subjectId)?.name ?? subject.subjectId;
      for (const major of subject.majorTopics) {
        for (const minor of major.minorTopics) {
          const path: TopicPath = {
            subjectId: subject.subjectId,
            subjectName,
            majorTopicId: major.id,
            majorTopicName: major.name,
            minorTopicId: minor.id,
            minorTopicName: minor.name,
          };
          this.topicPaths.set(minor.id, path);
          for (const concept of minor.concepts) {
            this.conceptNames.set(concept.id, concept.name);
            this.conceptToMinor.set(concept.id, minor.id);
            this.conceptEntries.push({ conceptId: concept.id, name: concept.name, path });
          }
        }
      }
    }
  }

  get examId(): string {
    return this.config.id;
  }

  question(id: string): Question | undefined {
    return this.byId.get(id);
  }

  questionMap(): Map<string, Question> {
    return this.byId;
  }

  /** Resolves a minor topic id to its full breadcrumb, e.g. 민법 · 대리 · 표현대리. */
  path(minorTopicId: string): TopicPath | undefined {
    return this.topicPaths.get(minorTopicId);
  }

  breadcrumb(question: Question): string {
    const path = this.topicPaths.get(question.minorTopicId);
    if (!path) return this.subjectName(question.subjectId);
    return `${this.subjectShortName(question.subjectId)} · ${path.majorTopicName} · ${path.minorTopicName}`;
  }

  conceptName(conceptId: string): string {
    return this.conceptNames.get(conceptId) ?? conceptId;
  }

  minorTopicIdForConcept(conceptId: string): string | undefined {
    return this.conceptToMinor.get(conceptId);
  }

  /** Every concept in taxonomy order — the spine of the 개념노트 screen. */
  concepts(): ConceptEntry[] {
    return this.conceptEntries;
  }

  concept(conceptId: string): ConceptEntry | undefined {
    return this.conceptEntries.find((c) => c.conceptId === conceptId);
  }

  conceptNote(conceptId: string): ConceptNote | undefined {
    return this.notesByConcept.get(conceptId);
  }

  subjectName(subjectId: string): string {
    return this.config.subjects.find((s) => s.id === subjectId)?.name ?? subjectId;
  }

  subjectShortName(subjectId: string): string {
    return this.config.subjects.find((s) => s.id === subjectId)?.shortName ?? subjectId;
  }

  subjectNameMap(): Record<string, string> {
    return Object.fromEntries(this.config.subjects.map((s) => [s.id, s.name]));
  }

  majorTopics(subjectId: string): MajorTopicNode[] {
    return this.taxonomy.subjects.find((s) => s.subjectId === subjectId)?.majorTopics ?? [];
  }

  minorTopics(subjectId: string): MinorTopicNode[] {
    return this.majorTopics(subjectId).flatMap((m) => m.minorTopics);
  }

  /** Questions that touch any of the given concepts — powers "같은 개념의 다른 문제" (§13). */
  questionsByConcepts(conceptIds: string[], excludeQuestionId?: string): Question[] {
    const wanted = new Set(conceptIds);
    return this.questions.filter(
      (q) => q.id !== excludeQuestionId && q.conceptIds.some((c) => wanted.has(c)),
    );
  }
}

const indexCache = new Map<string, ExamIndex>();

export function getExamIndex(examId: string): ExamIndex | undefined {
  const cached = indexCache.get(examId);
  if (cached) return cached;
  const bundle = bundles.get(examId);
  if (!bundle) return undefined;
  const index = new ExamIndex(bundle);
  indexCache.set(examId, index);
  return index;
}
