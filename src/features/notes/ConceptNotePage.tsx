/**
 * /notes/:conceptId — one concept, everything about it (§13).
 *
 * This is where a 관련 개념 chip lands. Getting an item wrong and tapping the
 * concept should answer the next three questions immediately: what is this
 * concept, how am I doing on it, and which other questions drill it.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStudy } from '../../app/StudyProvider';
import { ExplanationBody } from '../../components/Explanation';
import { Banner, CHOICE_MARK, Empty, SectionTitle, SourceBadge } from '../../components/ui';
import { createCustomSession } from '../practice/sessions';
import { NoteLongBody } from './NotesPage';

export function ConceptNotePage(): JSX.Element {
  const { conceptId = '' } = useParams();
  const study = useStudy();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [depth, setDepth] = useState<'short' | 'long'>('long');

  const entry = study.index.concept(conceptId);
  const note = study.index.conceptNote(conceptId);

  const questions = useMemo(
    () => study.index.questionsByConcepts([conceptId]),
    [study.index, conceptId],
  );

  // Accuracy on this concept alone — the number that tells the user whether the
  // note is worth re-reading or already internalised.
  const record = useMemo(() => {
    const ids = new Set(questions.map((q) => q.id));
    const attempts = study.attempts.filter((a) => ids.has(a.questionId));
    const correct = attempts.filter((a) => a.correct).length;
    const risky = attempts.filter((a) => !a.correct && a.confidence === 'certain').length;
    return {
      total: attempts.length,
      correct,
      risky,
      accuracy: attempts.length > 0 ? Math.round((correct / attempts.length) * 100) : null,
      seen: new Set(attempts.map((a) => a.questionId)).size,
    };
  }, [study.attempts, questions]);

  const siblings = useMemo(() => {
    if (!entry) return [];
    return study.index
      .concepts()
      .filter((c) => c.path.minorTopicId === entry.path.minorTopicId && c.conceptId !== conceptId);
  }, [study.index, entry, conceptId]);

  if (!entry) {
    return (
      <div className="stack-lg">
        <Empty>존재하지 않는 개념입니다.</Empty>
        <Link to="/notes" className="btn">
          개념노트로 돌아가기
        </Link>
      </div>
    );
  }

  const drill = async (): Promise<void> => {
    if (questions.length === 0) return;
    const session = await createCustomSession(
      study,
      questions.slice(0, 20),
      'review',
      `개념 집중 — ${entry.name}`,
    );
    navigate(`/practice/${session.id}`);
  };

  return (
    <div className="stack-lg">
      <section>
        <Link to="/notes" className="tiny muted">
          ← 개념노트
        </Link>
        <div className="question-meta" style={{ marginTop: 8 }}>
          <span className="badge">{study.index.subjectShortName(entry.path.subjectId)}</span>
          <span className="badge">{entry.path.majorTopicName}</span>
          <span className="badge">{entry.path.minorTopicName}</span>
        </div>
        <h1 style={{ marginTop: 8 }}>{entry.name}</h1>
        {note ? <p className="note-card__headline">{note.headline}</p> : null}
      </section>

      <section className="grid grid--auto">
        <div className="stat">
          <div className="stat__label">이 개념 문항</div>
          <div className="stat__value">{questions.length}</div>
          <div className="stat__hint">푼 적 있는 문항 {record.seen}</div>
        </div>
        <div className="stat">
          <div className="stat__label">정답률</div>
          <div className="stat__value">{record.accuracy === null ? '—' : `${record.accuracy}%`}</div>
          <div className="stat__hint">
            {record.total > 0 ? `${record.correct}/${record.total}` : '아직 기록 없음'}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">확신 오답</div>
          <div className="stat__value" style={record.risky > 0 ? { color: 'var(--bad)' } : undefined}>
            {record.risky}
          </div>
          <div className="stat__hint">오개념 신호</div>
        </div>
      </section>

      {record.risky > 0 ? (
        <Banner tone="bad">
          이 개념에서 &ldquo;확실함&rdquo;을 고르고 틀린 기록이 {record.risky}회 있습니다. 문제부터
          더 풀지 말고 아래 노트를 먼저 처음부터 읽으세요.
        </Banner>
      ) : null}

      {questions.length > 0 ? (
        <button type="button" className="btn btn--primary btn--block" onClick={() => void drill()}>
          이 개념만 집중해서 풀기 ({Math.min(questions.length, 20)}문항)
        </button>
      ) : null}

      {note ? (
        <section className="stack">
          <div className="row row--between">
            <SectionTitle title="개념노트" />
            <div className="row">
              <button
                type="button"
                className="chip chip--sm"
                aria-pressed={depth === 'short'}
                onClick={() => setDepth('short')}
              >
                짧게
              </button>
              <button
                type="button"
                className="chip chip--sm"
                aria-pressed={depth === 'long'}
                onClick={() => setDepth('long')}
              >
                자세히
              </button>
            </div>
          </div>

          <div className="card">
            <div className="explain__block">
              <div className="explain__label">한눈에</div>
              <ul className="note-list">
                {note.summary.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
            {depth === 'long' ? <NoteLongBody note={note} /> : null}
          </div>

          {note.relatedConceptIds?.length ? (
            <div className="card">
              <div className="explain__label">함께 보면 좋은 개념</div>
              <div className="chip-row">
                {note.relatedConceptIds.map((id) => (
                  <Link key={id} to={`/notes/${id}`} className="chip chip--sm chip--link">
                    {study.index.conceptName(id)}
                    <span className="chip__arrow" aria-hidden>
                      ›
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <Empty>
          이 개념은 아직 노트가 없습니다. 아래 문항의 해설이 현재로서는 가장 정확한 설명입니다.
        </Empty>
      )}

      <section>
        <SectionTitle title={`이 개념을 묻는 문항 ${questions.length}개`} />
        {questions.length === 0 ? (
          <Empty>아직 이 개념을 묻는 문항이 없습니다.</Empty>
        ) : (
          questions.map((q) => (
            <div key={q.id}>
              <button
                type="button"
                className="q-item"
                onClick={() => setExpanded((prev) => (prev === q.id ? null : q.id))}
              >
                <div className="row" style={{ gap: 5 }}>
                  <span className="badge">난이도 {q.difficulty}</span>
                  <SourceBadge question={q} />
                </div>
                <div className="q-item__stem">{q.question}</div>
              </button>
              {expanded === q.id ? (
                <div className="card" style={{ marginTop: 6 }}>
                  <p className="explain__body" style={{ fontWeight: 600, marginBottom: 10 }}>
                    정답 {CHOICE_MARK(q.answer)} {q.choices[q.answer]}
                  </p>
                  <ExplanationBody question={q} index={study.index} />
                </div>
              ) : null}
            </div>
          ))
        )}
      </section>

      {siblings.length > 0 ? (
        <section>
          <SectionTitle title={`같은 소분류의 다른 개념 (${entry.path.minorTopicName})`} />
          <div className="chip-row">
            {siblings.map((c) => (
              <Link key={c.conceptId} to={`/notes/${c.conceptId}`} className="chip chip--sm chip--link">
                {c.name}
                <span className="chip__arrow" aria-hidden>
                  ›
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
