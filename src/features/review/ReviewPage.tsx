/** /review — 오답노트 (§24) and quick review cards (§26). */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudy } from '../../app/StudyProvider';
import { ExplanationBody } from '../../components/Explanation';
import { Banner, CHOICE_MARK, Empty, SectionTitle, SourceBadge } from '../../components/ui';
import type { Question } from '../../exam/types';
import type { Attempt, QuestionState } from '../../storage/types';
import { DAY_MS } from '../../learning/utils/date';
import { createCustomSession } from '../practice/sessions';

type FilterKey = 'all' | 'risky' | 'repeated' | 'recent' | 'bookmarked' | 'lawFlagged';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '전체 오답' },
  { key: 'risky', label: '확신했는데 틀림' },
  { key: 'repeated', label: '반복해서 틀림' },
  { key: 'recent', label: '최근 7일 오답' },
  { key: 'bookmarked', label: '북마크' },
  { key: 'lawFlagged', label: '법령 검토 대상' },
];

interface ReviewItem {
  question: Question;
  state?: QuestionState;
  wrongCount: number;
  lastWrongAt: number;
  lastSelected: number;
  risky: boolean;
  lawFlagged: boolean;
}

export function ReviewPage(): JSX.Element {
  const study = useStudy();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [subjectId, setSubjectId] = useState<string>('all');
  const [majorTopicId, setMajorTopicId] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<'wrong' | 'cards'>('wrong');

  const flaggedLaws = useMemo(() => {
    const set = new Set<string>();
    for (const update of study.index.updates) {
      for (const law of update.affectedLaws ?? []) set.add(law.law);
    }
    return set;
  }, [study.index.updates]);

  const items = useMemo<ReviewItem[]>(() => {
    const byQuestion = new Map<string, { wrong: Attempt[]; last: Attempt }>();
    for (const attempt of study.attempts) {
      const entry = byQuestion.get(attempt.questionId) ?? { wrong: [], last: attempt };
      if (!attempt.correct) entry.wrong.push(attempt);
      if (attempt.at >= entry.last.at) entry.last = attempt;
      byQuestion.set(attempt.questionId, entry);
    }

    const out: ReviewItem[] = [];
    for (const [questionId, entry] of byQuestion) {
      const question = study.index.question(questionId);
      if (!question) continue;
      const state = study.stateOf(questionId);
      const lastWrong = entry.wrong[entry.wrong.length - 1];
      const bookmarked = !!state?.bookmarked;
      if (entry.wrong.length === 0 && !bookmarked) continue;
      out.push({
        question,
        state,
        wrongCount: entry.wrong.length,
        lastWrongAt: lastWrong?.at ?? 0,
        lastSelected: lastWrong?.selected ?? -1,
        risky: !!state?.riskFlagged,
        lawFlagged:
          !!question.needsReview ||
          (question.lawReferences ?? []).some((l) => flaggedLaws.has(l.law)),
      });
    }
    return out.sort((a, b) => b.lastWrongAt - a.lastWrongAt);
    // `study` itself is a new object on every render; the three fields we read
    // are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [study.attempts, study.index, study.stateOf, flaggedLaws]);

  const filtered = useMemo(() => {
    const cutoff = Date.now() - 7 * DAY_MS;
    return items.filter((item) => {
      if (subjectId !== 'all' && item.question.subjectId !== subjectId) return false;
      if (majorTopicId !== 'all' && item.question.majorTopicId !== majorTopicId) return false;
      switch (filter) {
        case 'risky':
          return item.risky;
        case 'repeated':
          return item.wrongCount >= 2;
        case 'recent':
          return item.lastWrongAt >= cutoff;
        case 'bookmarked':
          return !!item.state?.bookmarked;
        case 'lawFlagged':
          return item.lawFlagged;
        default:
          return item.wrongCount > 0 || !!item.state?.bookmarked;
      }
    });
  }, [items, filter, subjectId, majorTopicId]);

  const majorTopics = useMemo(() => {
    if (subjectId === 'all') return [];
    return study.index.majorTopics(subjectId);
  }, [study.index, subjectId]);

  const retry = async (): Promise<void> => {
    const questions = filtered.map((i) => i.question).slice(0, 30);
    if (questions.length === 0) return;
    const session = await createCustomSession(
      study,
      questions,
      'review',
      `오답 재도전 (${FILTERS.find((f) => f.key === filter)?.label})`,
    );
    navigate(`/practice/${session.id}`);
  };

  const dueCards = study.flashcards.filter((c) => c.dueAt <= Date.now());

  return (
    <div className="stack-lg">
      <section>
        <h1>오답노트 · 암기카드</h1>
        <p className="small muted" style={{ marginTop: 4 }}>
          단순 목록이 아닙니다. 확신했는데 틀린 문제와 반복해서 틀린 문제를 먼저 처리하세요.
        </p>
      </section>

      <div className="row">
        <button
          type="button"
          className="chip"
          aria-pressed={tab === 'wrong'}
          onClick={() => setTab('wrong')}
        >
          오답노트 {items.filter((i) => i.wrongCount > 0).length}
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={tab === 'cards'}
          onClick={() => setTab('cards')}
        >
          암기카드 {study.flashcards.length}
          {dueCards.length > 0 ? ` · ${dueCards.length} 예정` : ''}
        </button>
      </div>

      {tab === 'cards' ? <FlashcardDeck /> : null}

      {tab === 'wrong' ? (
        <>
          {study.analytics.dueReviewCount > 0 ? (
            <Banner tone="accent">
              오늘 복습 예정 문제 {study.analytics.dueReviewCount}문항이 있습니다. 오늘의 세트에 이미
              포함되어 있습니다.
            </Banner>
          ) : null}

          <section>
            <div className="row" style={{ marginBottom: 8 }}>
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="chip chip--sm"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="grid grid--2">
              <label className="field">
                과목
                <select
                  value={subjectId}
                  onChange={(e) => {
                    setSubjectId(e.target.value);
                    setMajorTopicId('all');
                  }}
                >
                  <option value="all">전체</option>
                  {study.index.config.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.shortName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                대분류
                <select
                  value={majorTopicId}
                  onChange={(e) => setMajorTopicId(e.target.value)}
                  disabled={subjectId === 'all'}
                >
                  <option value="all">전체</option>
                  {majorTopics.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section>
            <SectionTitle title={`${filtered.length}문항`} />
            {filtered.length === 0 ? (
              <Empty>조건에 맞는 오답이 없습니다.</Empty>
            ) : (
              <>
                <button type="button" className="btn btn--primary btn--block" onClick={() => void retry()}>
                  이 목록으로 다시 풀기 (최대 30문항)
                </button>
                <div style={{ marginTop: 12 }}>
                  {filtered.map((item) => (
                    <div key={item.question.id}>
                      <button
                        type="button"
                        className="q-item"
                        onClick={() =>
                          setExpanded((prev) => (prev === item.question.id ? null : item.question.id))
                        }
                      >
                        <div className="row" style={{ gap: 5 }}>
                          <span className="badge">{study.index.breadcrumb(item.question)}</span>
                          {item.risky ? <span className="badge badge--bad">확신 오답</span> : null}
                          {item.wrongCount >= 2 ? (
                            <span className="badge badge--warn">{item.wrongCount}회 오답</span>
                          ) : null}
                          {item.lawFlagged ? <span className="badge badge--warn">법령 확인</span> : null}
                          {item.state?.bookmarked ? <span className="badge">★</span> : null}
                        </div>
                        <div className="q-item__stem">{item.question.question}</div>
                        <div className="tiny muted" style={{ marginTop: 4 }}>
                          내 답 {item.lastSelected >= 0 ? CHOICE_MARK(item.lastSelected) : '—'} · 정답{' '}
                          {CHOICE_MARK(item.question.answer)} ·{' '}
                          {item.state?.dueAt
                            ? `다음 복습 ${new Date(item.state.dueAt).toLocaleDateString('ko-KR')}`
                            : '복습 미정'}
                        </div>
                      </button>
                      {expanded === item.question.id ? (
                        <div className="card" style={{ marginTop: 6 }}>
                          <div className="question-meta">
                            <SourceBadge question={item.question} />
                          </div>
                          <p className="explain__body" style={{ fontWeight: 600, marginBottom: 10 }}>
                            정답 {CHOICE_MARK(item.question.answer)}{' '}
                            {item.question.choices[item.question.answer]}
                          </p>
                          <ExplanationBody
                            question={item.question}
                            index={study.index}
                            selected={item.lastSelected >= 0 ? item.lastSelected : undefined}
                          />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function FlashcardDeck(): JSX.Element {
  const study = useStudy();
  const [cursor, setCursor] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const due = useMemo(
    () => study.flashcards.filter((c) => c.dueAt <= Date.now()).sort((a, b) => a.dueAt - b.dueAt),
    [study.flashcards],
  );
  const deck = due.length > 0 ? due : study.flashcards;
  const card = deck[Math.min(cursor, Math.max(0, deck.length - 1))];

  if (!card) {
    return (
      <Empty>
        아직 암기카드가 없습니다. 문제를 풀고 해설 하단의 &ldquo;＋ 암기카드로 저장&rdquo;을 누르면 시험
        직전에 이 카드만 따로 볼 수 있습니다.
      </Empty>
    );
  }

  const advance = async (remembered: boolean): Promise<void> => {
    await study.reviewFlashcard(card, remembered);
    setRevealed(false);
    setCursor((prev) => (prev + 1 >= deck.length ? 0 : prev + 1));
  };

  return (
    <section className="stack">
      <div className="row row--between small muted">
        <span>
          {due.length > 0 ? `복습 예정 ${due.length}장` : `전체 ${study.flashcards.length}장`}
        </span>
        <span className="mono">
          {Math.min(cursor + 1, deck.length)} / {deck.length}
        </span>
      </div>

      <div className="flashcard">
        <div className="tiny muted">{revealed ? '뒤' : '앞'}</div>
        <div className="flashcard__face">{revealed ? card.back : card.front}</div>
      </div>

      {revealed ? (
        <div className="grid grid--2">
          <button type="button" className="btn" onClick={() => void advance(false)}>
            아직 헷갈림
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void advance(true)}>
            외웠음
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn--primary btn--block" onClick={() => setRevealed(true)}>
          뒤집기
        </button>
      )}

      <button
        type="button"
        className="btn btn--sm btn--danger"
        onClick={() => void study.removeFlashcard(card.id)}
      >
        이 카드 삭제
      </button>
    </section>
  );
}
