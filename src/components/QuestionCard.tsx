/**
 * The learning-mode question card (§7–§10, §25).
 *
 * Flow is deliberately two taps and reachable one-handed: choose an answer →
 * choose a confidence → read the explanation → next.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Question } from '../exam/types';
import type { Attempt, Confidence, ErrorCause } from '../storage/types';
import type { ExamIndex } from '../exam/registry';
import { ERROR_CAUSE_LABELS } from '../learning/analytics/stats';
import {
  CHOICE_MARK,
  DIFFICULTY_LABEL,
  QUESTION_TYPE_LABEL,
  ProgressBar,
  SourceBadge,
} from './ui';

const CONFIDENCE_OPTIONS: Array<{ value: Confidence; label: string; hint: string }> = [
  { value: 'certain', label: '확실함', hint: '근거를 설명할 수 있다' },
  { value: 'unsure', label: '헷갈림', hint: '두 개까지 좁혔다' },
  { value: 'guess', label: '찍음', hint: '근거 없이 골랐다' },
];

export interface QuestionCardProps {
  question: Question;
  index: ExamIndex;
  position?: { current: number; total: number };
  confidencePrompt: boolean;
  errorCausePrompt: boolean;
  bookmarked: boolean;
  onSubmit: (payload: { selected: number; confidence: Confidence; elapsedMs: number }) => Promise<Attempt>;
  onErrorCause?: (attemptId: string, cause: ErrorCause) => void;
  onToggleBookmark: () => void;
  onSaveFlashcard?: (front: string, back: string) => void;
  onNext?: () => void;
  nextLabel?: string;
}

type Phase = 'select' | 'confidence' | 'result';

export function QuestionCard(props: QuestionCardProps): JSX.Element {
  const { question, index, position } = props;
  const [phase, setPhase] = useState<Phase>('select');
  const [selected, setSelected] = useState<number | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [cause, setCause] = useState<ErrorCause | null>(null);
  const [cardSaved, setCardSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(Date.now());
  const resultRef = useRef<HTMLDivElement | null>(null);

  // Reset for every new question — the card is reused across the whole session.
  useEffect(() => {
    setPhase('select');
    setSelected(null);
    setAttempt(null);
    setCause(null);
    setCardSaved(false);
    startedAt.current = Date.now();
  }, [question.id]);

  useEffect(() => {
    if (phase === 'result') resultRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [phase]);

  const breadcrumb = useMemo(() => index.breadcrumb(question), [index, question]);

  const grade = async (choice: number, confidence: Confidence): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await props.onSubmit({
        selected: choice,
        confidence,
        elapsedMs: Date.now() - startedAt.current,
      });
      setAttempt(result);
      setPhase('result');
    } finally {
      setBusy(false);
    }
  };

  const handleChoice = (choice: number): void => {
    if (phase === 'result') return;
    setSelected(choice);
    if (props.confidencePrompt) {
      setPhase('confidence');
    } else {
      void grade(choice, 'unsure');
    }
  };

  const correct = attempt?.correct ?? false;

  return (
    <div>
      {position ? (
        <div className="practice-head">
          <div className="practice-head__row">
            <span className="mono small muted">
              {position.current} / {position.total}
            </span>
            <button type="button" className="btn btn--sm" onClick={props.onToggleBookmark}>
              {props.bookmarked ? '★ 북마크됨' : '☆ 북마크'}
            </button>
          </div>
          <ProgressBar value={position.current - 1} max={position.total} label="세트 진행률" />
        </div>
      ) : null}

      <div className="card">
        <div className="question-meta">
          <span className="badge">{breadcrumb}</span>
          <span className="badge">{QUESTION_TYPE_LABEL[question.questionType] ?? question.questionType}</span>
          <span className="badge">난이도 {DIFFICULTY_LABEL[question.difficulty]}</span>
          <SourceBadge question={question} />
        </div>

        <p className="question-stem">{question.question}</p>
        {question.passage ? <div className="question-passage">{question.passage}</div> : null}

        <div className="choices" role="group" aria-label="선택지">
          {question.choices.map((choice, i) => {
            const isSelected = selected === i;
            const isAnswer = i === question.answer;
            let className = 'choice';
            let mark = '';
            if (phase === 'result') {
              if (isAnswer) {
                className += ' choice--correct';
                mark = '✓ 정답';
              } else if (isSelected) {
                className += ' choice--wrong';
                mark = '✕ 내 선택';
              }
            } else if (isSelected) {
              className += ' choice--selected';
              mark = '선택';
            }
            return (
              <button
                type="button"
                key={i}
                className={className}
                onClick={() => handleChoice(i)}
                disabled={phase === 'result' || busy}
                aria-pressed={isSelected}
              >
                <span className="choice__num">{CHOICE_MARK(i)}</span>
                <span>{choice}</span>
                <span className="choice__mark">{mark}</span>
              </button>
            );
          })}
        </div>

        {phase === 'confidence' ? (
          <div style={{ marginTop: 14 }}>
            <div className="explain__label">얼마나 확신하나요? (취약영역 판정의 핵심 값입니다)</div>
            <div className="chip-row">
              {CONFIDENCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="chip"
                  disabled={busy}
                  onClick={() => selected !== null && void grade(selected, option.value)}
                >
                  {option.label}
                  <span className="tiny muted" style={{ marginLeft: 6 }}>
                    {option.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {phase === 'result' && attempt ? (
        <div className="card" ref={resultRef} style={{ marginTop: 12 }}>
          <div className={`verdict ${correct ? 'verdict--ok' : 'verdict--bad'}`} role="status">
            <span aria-hidden>{correct ? '✅' : '❌'}</span>
            <span>{correct ? '정답' : '오답'}</span>
            <span className="small" style={{ fontWeight: 500, marginLeft: 'auto' }}>
              정답 {CHOICE_MARK(question.answer)} · {Math.round(attempt.elapsedMs / 1000)}초 ·{' '}
              {CONFIDENCE_OPTIONS.find((o) => o.value === attempt.confidence)?.label}
            </span>
          </div>

          {attempt.confidence === 'certain' && !correct ? (
            <div className="banner banner--bad" style={{ marginBottom: 12 }}>
              확신했는데 틀렸습니다. 단순 오답보다 위험한 오개념이므로 이 문제는 복습 큐 최상단에
              배치되고 취약영역 점수에 더 큰 감점으로 반영됩니다.
            </div>
          ) : null}
          {attempt.confidence === 'guess' && correct ? (
            <div className="banner banner--warn" style={{ marginBottom: 12 }}>
              찍어서 맞혔습니다. 숙련도로 인정되지 않으며 복습 간격도 짧게 유지됩니다.
            </div>
          ) : null}

          <ExplanationBody question={question} index={index} />

          {!correct && props.errorCausePrompt ? (
            <>
              <div className="divider" />
              <div className="explain__label">왜 틀렸나요? (한 번만 누르면 됩니다)</div>
              <div className="chip-row">
                {(Object.keys(ERROR_CAUSE_LABELS) as ErrorCause[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="chip chip--sm"
                    aria-pressed={cause === key}
                    onClick={() => {
                      setCause(key);
                      props.onErrorCause?.(attempt.id, key);
                    }}
                  >
                    {ERROR_CAUSE_LABELS[key]}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {props.onSaveFlashcard && question.memoryTip ? (
            <>
              <div className="divider" />
              <button
                type="button"
                className="btn btn--sm"
                disabled={cardSaved}
                onClick={() => {
                  props.onSaveFlashcard?.(
                    `${index.breadcrumb(question)} — 핵심은?`,
                    question.memoryTip ?? '',
                  );
                  setCardSaved(true);
                }}
              >
                {cardSaved ? '✓ 암기카드에 저장됨' : '＋ 암기카드로 저장'}
              </button>
            </>
          ) : null}

          {props.onNext ? (
            <div className="sticky-actions">
              <button type="button" className="btn btn--primary btn--block" onClick={props.onNext}>
                {props.nextLabel ?? '다음 문제'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ExplanationBody({
  question,
  index,
}: {
  question: Question;
  index?: ExamIndex;
}): JSX.Element {
  return (
    <div>
      <div className="explain__block">
        <div className="explain__label">핵심 해설</div>
        <p className="explain__body">{question.explanation}</p>
      </div>

      {question.calculationSteps?.length ? (
        <div className="explain__block">
          <div className="explain__label">계산 풀이</div>
          <div className="calc-steps">
            {question.calculationSteps.map((step, i) => (
              <div className="calc-step" key={i}>
                <span className="calc-step__label">{step.label}</span>
                <span>{step.detail}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {question.memoryTip ? (
        <div className="explain__block">
          <div className="explain__label">한 줄 암기</div>
          <p className="explain__body explain__highlight">{question.memoryTip}</p>
        </div>
      ) : null}

      {question.trap ? (
        <div className="explain__block">
          <div className="explain__label">함정 포인트</div>
          <p className="explain__body">{question.trap}</p>
        </div>
      ) : null}

      {question.precedents?.length ? (
        <div className="explain__block">
          <div className="explain__label">판례</div>
          {question.precedents.map((p, i) => (
            <p className="explain__body" key={i}>
              {p.citation}
              {p.holding ? ` — ${p.holding}` : ''}
            </p>
          ))}
        </div>
      ) : null}

      {question.lawReferences?.length ? (
        <div className="explain__block">
          <div className="explain__label">법적 근거</div>
          <p className="explain__body">
            {question.lawReferences.map((l) => `${l.law} ${l.article ?? ''}`.trim()).join(' · ')}
          </p>
          {question.lawAsOf ? <p className="tiny faint">법령 확인일 {question.lawAsOf}</p> : null}
        </div>
      ) : null}

      {question.conceptIds.length ? (
        <div className="explain__block">
          <div className="explain__label">관련 개념</div>
          <div className="chip-row">
            {question.conceptIds.map((id) => (
              <span className="chip chip--sm" key={id}>
                {index ? index.conceptName(id) : id}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
