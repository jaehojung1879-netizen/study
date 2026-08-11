/**
 * The explanation surface (§10, §13).
 *
 * Shared by the solving card, the 오답노트 and the question-bank browser so an
 * item is explained identically wherever it is opened. Two rules drive the
 * layout:
 *
 * 1. Every choice is explained, not just the answer. An item is built so that
 *    two options look defensible; a learner who picked ③ needs to know why ③
 *    fails, and reading all five is how the trap becomes visible.
 * 2. Every concept is a link. 관련 개념 is the entry point into the 개념노트,
 *    not decoration.
 */
import { Link } from 'react-router-dom';
import type { Question } from '../exam/types';
import type { ExamIndex } from '../exam/registry';
import { CHOICE_MARK } from './ui';

export interface ExplanationBodyProps {
  question: Question;
  index?: ExamIndex;
  /** The learner's choice, so their own wrong line is marked in the list. */
  selected?: number;
}

export function ExplanationBody({ question, index, selected }: ExplanationBodyProps): JSX.Element {
  const perChoice = question.choiceExplanations;
  const hasPerChoice = !!perChoice && perChoice.length === question.choices.length;

  return (
    <div>
      <div className="explain__block">
        <div className="explain__label">핵심 해설</div>
        <p className="explain__body">{question.explanation}</p>
      </div>

      {hasPerChoice ? (
        <div className="explain__block">
          <div className="explain__label">선지별 해설 (모든 선택지)</div>
          <ol className="choice-notes">
            {question.choices.map((choice, i) => {
              const isAnswer = i === question.answer;
              const isPicked = selected === i;
              const tone = isAnswer ? 'choice-note--ok' : isPicked ? 'choice-note--bad' : '';
              return (
                <li className={`choice-note ${tone}`} key={i}>
                  <div className="choice-note__head">
                    <span className="choice-note__num">{CHOICE_MARK(i)}</span>
                    <span className="choice-note__text">{choice}</span>
                    <span className="choice-note__tag">
                      {isAnswer ? '정답' : '오답'}
                      {isPicked ? ' · 내 선택' : ''}
                    </span>
                  </div>
                  <p className="choice-note__why">{perChoice[i]}</p>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

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

      {question.sourceReference ? (
        <div className="explain__block">
          <div className="explain__label">출처</div>
          <p className="explain__body">{question.sourceTitle ?? question.sourceReference}</p>
          <p className="explain__body">
            <a href={question.sourceReference} target="_blank" rel="noreferrer">
              원문 확인
            </a>
          </p>
          {question.sourceType === 'official_past_exam' ? (
            <p className="tiny faint">
              한국산업인력공단 Q-Net 공개문제 · 공공누리 제1유형(출처표시)
            </p>
          ) : null}
        </div>
      ) : null}

      {question.conceptIds.length ? (
        <div className="explain__block">
          <div className="explain__label">관련 개념 — 눌러서 개념노트 열기</div>
          <div className="chip-row">
            {question.conceptIds.map((id) => (
              <ConceptChip key={id} conceptId={id} index={index} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A concept chip is always a link, even when no note has been written yet — the
 * concept page still shows the topic path and every question drilling it, which
 * is more useful than a dead chip.
 */
export function ConceptChip({
  conceptId,
  index,
  size = 'sm',
}: {
  conceptId: string;
  index?: ExamIndex;
  size?: 'sm' | 'md';
}): JSX.Element {
  const label = index ? index.conceptName(conceptId) : conceptId;
  const hasNote = !!index?.conceptNote(conceptId);
  return (
    <Link
      to={`/notes/${conceptId}`}
      className={`chip chip--link ${size === 'sm' ? 'chip--sm' : ''}`}
      title={hasNote ? `${label} 개념노트 보기` : `${label} 관련 문제 보기`}
    >
      {label}
      <span className="chip__arrow" aria-hidden>
        ›
      </span>
    </Link>
  );
}
