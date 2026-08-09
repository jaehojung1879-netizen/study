#!/usr/bin/env tsx
/**
 * Optional two-pass question generation pipeline (§18).
 *
 * Nothing here runs in the browser and no key ever reaches the frontend: the
 * script reads `ANTHROPIC_API_KEY` from the environment (locally) or from a
 * GitHub Actions secret.
 *
 *   Pass 1 (Generator) writes candidate items.
 *   Pass 2 (Reviewer)  re-checks them with a *different* prompt and no sight of
 *                      the generator's reasoning.
 *
 * Items only reach `staging/questions/` when both passes agree. Nothing is ever
 * written straight into `data/exams/**` — a human moves items across after
 * checking the primary sources (§17, §35).
 *
 *   ANTHROPIC_API_KEY=... GENERATOR_MODEL=... REVIEWER_MODEL=... \
 *     npm run generate:questions -- --exam real-estate-agent-1 --topic civ-gen-agency --count 5
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Question } from '../src/exam/types';
import { validateQuestionBank, findDuplicates, DUPLICATE_THRESHOLD } from '../src/exam/validation';
import { loadExam, REPO_ROOT } from './lib/loadExams';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

interface ReviewVerdict {
  approved: boolean;
  /** Reviewer's own answer index — must match the generator's. */
  answer: number;
  issues: string[];
}

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} 환경변수가 필요합니다. ${hint}`);
    process.exit(1);
  }
  return value;
}

async function callClaude(model: string, apiKey: string, system: string, prompt: string): Promise<string> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`API 오류 ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as { content: Array<{ type: string; text?: string }> };
  return payload.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.search(/[[{]/);
  if (start < 0) throw new Error(`응답에서 JSON을 찾지 못했습니다:\n${text.slice(0, 400)}`);
  return JSON.parse(raw.slice(start)) as T;
}

const GENERATOR_SYSTEM = `당신은 대한민국 공인중개사 시험 문제를 출제하는 전문가입니다.
반드시 지킬 것:
- 상업용 문제집·학원 교재·유료 문제은행의 문장을 복제하지 않는다. 모든 문장은 새로 작성한다.
- 공식 기출문제를 그대로 옮기지 않는다. sourceType은 항상 "generated"로 표기한다.
- 정답은 반드시 하나여야 하며 복수정답 가능성이 없어야 한다.
- 법령 조문 번호와 판례 법리는 확실한 것만 쓴다. 확실하지 않으면 해당 필드를 비운다.
- 해설에는 왜 다른 선지가 틀렸는지도 포함한다.
- 출력은 JSON 배열만. 다른 텍스트를 덧붙이지 않는다.`;

const REVIEWER_SYSTEM = `당신은 공인중개사 시험 문제를 검수하는 독립 검토자입니다.
출제자의 의도를 신뢰하지 말고 문항 자체만 보고 판단하십시오.
다음을 확인합니다:
1. 정답 오류 — 스스로 문제를 풀어 정답 인덱스를 결정한다.
2. 복수정답 가능성
3. 법령 outdated 또는 조문 번호 오류
4. 계산 오류
5. 애매하거나 중의적인 지문
6. 기출 출처 허위표기
7. 지나치게 쉬움(변별력 없음)
출력은 JSON 배열만. 각 원소는 {"id": string, "approved": boolean, "answer": number, "issues": string[]}.`;

function generatorPrompt(exam: ReturnType<typeof loadExam>, topicId: string, count: number): string {
  const path0 = exam.taxonomy.subjects
    .flatMap((s) => s.majorTopics.map((m) => ({ subjectId: s.subjectId, major: m })))
    .flatMap(({ subjectId, major }) =>
      major.minorTopics.map((minor) => ({ subjectId, majorId: major.id, majorName: major.name, minor })),
    )
    .find((entry) => entry.minor.id === topicId);
  if (!path0) throw new Error(`taxonomy에 없는 minorTopicId: ${topicId}`);

  const existing = exam.questions
    .filter((q) => q.minorTopicId === topicId)
    .map((q) => `- ${q.question}`)
    .join('\n');

  return `시험: ${exam.config.name}
과목: ${exam.config.subjects.find((s) => s.id === path0.subjectId)?.name}
대분류: ${path0.majorName}
소분류: ${path0.minor.name}
사용 가능한 conceptId: ${path0.minor.concepts.map((c) => `${c.id}(${c.name})`).join(', ')}

이미 있는 문항의 지문(같은 지문을 반복하지 말 것. 같은 개념을 다른 각도로 묻는 것은 권장):
${existing || '(없음)'}

위 소분류에 대해 5지선다 문항 ${count}개를 JSON 배열로 작성하세요.
각 원소의 스키마:
{
  "id": "${topicId}-gen-<번호>",
  "examId": "${exam.config.id}",
  "subjectId": "${path0.subjectId}",
  "majorTopicId": "${path0.majorId}",
  "minorTopicId": "${topicId}",
  "conceptIds": [위 목록에서 1~2개],
  "question": "문제 지문",
  "choices": ["...", "...", "...", "...", "..."],
  "answer": 0-based 정답 인덱스,
  "explanation": "3~8줄. 정답 근거와 오답 선지가 왜 틀렸는지",
  "memoryTip": "한 줄 암기",
  "trap": "이 문항의 함정 포인트",
  "difficulty": 1~5,
  "questionType": "concept | case | calculation | precedent | statute | count",
  "sourceType": "generated",
  "verified": false,
  "lawReferences": [{"law": "민법", "article": "제000조"}]  // 확실할 때만
  "lawAsOf": "YYYY-MM-DD",  // lawReferences가 있을 때 필수
  "calculationSteps": [{"label":"공식","detail":"..."}, ...],  // questionType이 calculation일 때 필수
  "createdAt": "${new Date().toISOString().slice(0, 10)}",
  "updatedAt": "${new Date().toISOString().slice(0, 10)}"
}`;
}

async function main(): Promise<void> {
  const apiKey = requireEnv('ANTHROPIC_API_KEY', '로컬 환경변수 또는 GitHub Actions Secret으로 주입하세요.');
  const generatorModel = requireEnv(
    'GENERATOR_MODEL',
    '사용할 모델 ID를 지정하세요 (https://docs.claude.com/en/docs/about-claude/models 참고).',
  );
  const reviewerModel = process.env.REVIEWER_MODEL ?? generatorModel;

  const examId = arg('exam', 'real-estate-agent-1')!;
  const topicId = arg('topic');
  const count = Number(arg('count', '5'));
  if (!topicId) {
    console.error('--topic <minorTopicId>가 필요합니다.');
    process.exit(1);
  }

  const exam = loadExam(examId);
  console.info(`[생성] ${examId} · ${topicId} · ${count}문항 · 모델 ${generatorModel}`);

  const generated = extractJson<Question[]>(
    await callClaude(generatorModel, apiKey, GENERATOR_SYSTEM, generatorPrompt(exam, topicId, count)),
  );
  console.info(`[생성] ${generated.length}문항 수신`);

  // Pass 2 sees only the items, never the generator's justification.
  const reviewPrompt = JSON.stringify(
    generated.map((q) => ({ id: q.id, question: q.question, choices: q.choices, answer: q.answer })),
    null,
    2,
  );
  const verdicts = extractJson<Array<ReviewVerdict & { id: string }>>(
    await callClaude(reviewerModel, apiKey, REVIEWER_SYSTEM, reviewPrompt),
  );
  const byId = new Map(verdicts.map((v) => [v.id, v]));

  const accepted: Question[] = [];
  const rejected: Array<{ question: Question; reason: string[] }> = [];

  for (const question of generated) {
    const verdict = byId.get(question.id);
    const reasons: string[] = [];
    if (!verdict) reasons.push('검토자 응답 없음');
    else {
      if (!verdict.approved) reasons.push(...(verdict.issues ?? ['검토자 반려']));
      // The hard gate: the two passes must independently agree on the answer.
      if (verdict.answer !== question.answer) {
        reasons.push(`정답 불일치 — 출제 ${question.answer} vs 검토 ${verdict.answer}`);
      }
    }

    const structural = validateQuestionBank([question], exam.taxonomy, exam.config).filter(
      (i) => i.level === 'error',
    );
    reasons.push(...structural.map((i) => `[${i.rule}] ${i.message}`));

    const dupes = findDuplicates([...exam.questions, question], DUPLICATE_THRESHOLD).filter(
      (p) => p.a === question.id || p.b === question.id,
    );
    if (dupes.length > 0) reasons.push(`기존 문항과 중복: ${dupes.map((d) => `${d.a}↔${d.b}`).join(', ')}`);

    if (reasons.length === 0) accepted.push(question);
    else rejected.push({ question, reason: reasons });
  }

  const stagingDir = path.join(REPO_ROOT, 'staging', 'questions');
  fs.mkdirSync(stagingDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (accepted.length > 0) {
    const file = path.join(stagingDir, `${examId}-${topicId}-${stamp}.json`);
    fs.writeFileSync(file, `${JSON.stringify(accepted, null, 2)}\n`, 'utf8');
    console.info(`\n✓ 두 패스가 일치한 ${accepted.length}문항 → ${path.relative(REPO_ROOT, file)}`);
  }
  if (rejected.length > 0) {
    const file = path.join(stagingDir, `${examId}-${topicId}-${stamp}.rejected.json`);
    fs.writeFileSync(file, `${JSON.stringify(rejected, null, 2)}\n`, 'utf8');
    console.info(`✗ 반려 ${rejected.length}문항 → ${path.relative(REPO_ROOT, file)}`);
    for (const item of rejected) console.info(`   ${item.question.id}: ${item.reason.join(' / ')}`);
  }

  console.info(
    '\n다음 단계: staging의 문항을 사람이 검토하고 법령 원문을 대조한 뒤 data/exams/<examId>/questions/로 옮기세요.',
  );
}

void main();
