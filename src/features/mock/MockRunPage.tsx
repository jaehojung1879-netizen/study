/** /mock/:sessionId — timed sitting with no feedback, then the graded report (§20). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useStudy } from '../../app/StudyProvider';
import { Banner, CHOICE_MARK, SectionTitle, Stat } from '../../components/ui';
import { analyseMock, gradeMock } from '../../learning/scoring/mock';
import { expectedSeconds } from '../../learning/mastery/masteryScore';
import { formatClock, formatDuration } from '../../learning/utils/date';
import type { Confidence, MockResult, MockSession } from '../../storage/types';

const CONFIDENCE_CHIPS: Array<{ value: Confidence; label: string }> = [
  { value: 'certain', label: '확실' },
  { value: 'unsure', label: '헷갈림' },
  { value: 'guess', label: '찍음' },
];

export function MockRunPage(): JSX.Element {
  const { sessionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const study = useStudy();

  const [session, setSession] = useState<MockSession | null>(null);
  const [result, setResult] = useState<MockResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [showSheet, setShowSheet] = useState(false);
  const enteredAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existingResult = study.mockResults.find((r) => r.id === sessionId);
      if (existingResult) {
        if (!cancelled) {
          setResult(existingResult);
          setLoading(false);
        }
        return;
      }
      const found = await study.storage.getMockSession(sessionId);
      if (cancelled) return;
      setSession(found ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, searchParams.get('view')]);

  useEffect(() => {
    if (!session || result) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session, result]);

  const persist = useCallback(
    async (next: MockSession) => {
      setSession(next);
      await study.storage.putMockSession(next);
    },
    [study.storage],
  );

  const submit = useCallback(
    async (target: MockSession) => {
      const graded = gradeMock({
        config: study.index.config,
        session: target,
        questions: study.index.questionMap(),
        now: Date.now(),
      });
      await study.storage.putMockResult(graded);
      await study.storage.putMockSession({ ...target, submittedAt: Date.now() });
      await study.reload();
      setResult(graded);
      setSession(null);
    },
    [study],
  );

  const remaining = session ? session.endsAt - now : 0;

  // Auto-submit the moment the clock runs out, exactly like the real sitting.
  useEffect(() => {
    if (session && !result && remaining <= 0) void submit(session);
  }, [session, result, remaining, submit]);

  if (loading) return <div className="empty">불러오는 중…</div>;

  if (result) return <MockReport result={result} />;

  if (!session) {
    return (
      <Banner tone="bad">
        시험 세션을 찾을 수 없습니다. <Link to="/mock">모의시험으로 돌아가기</Link>
      </Banner>
    );
  }

  const questionId = session.questionIds[session.cursor];
  const question = study.index.question(questionId);
  const answeredCount = Object.keys(session.answers).length;

  const commitTime = (target: MockSession): MockSession => {
    const spent = Date.now() - enteredAt.current;
    enteredAt.current = Date.now();
    return {
      ...target,
      perQuestionMs: {
        ...target.perQuestionMs,
        [questionId]: (target.perQuestionMs[questionId] ?? 0) + spent,
      },
    };
  };

  const move = async (delta: number): Promise<void> => {
    const cursor = Math.max(0, Math.min(session.questionIds.length - 1, session.cursor + delta));
    await persist({ ...commitTime(session), cursor });
    window.scrollTo({ top: 0 });
  };

  const jump = async (cursor: number): Promise<void> => {
    await persist({ ...commitTime(session), cursor });
    setShowSheet(false);
    window.scrollTo({ top: 0 });
  };

  const answer = async (choice: number): Promise<void> => {
    await persist({ ...session, answers: { ...session.answers, [questionId]: choice } });
  };

  const setConfidence = async (value: Confidence): Promise<void> => {
    await persist({ ...session, confidences: { ...session.confidences, [questionId]: value } });
  };

  const toggleFlag = async (): Promise<void> => {
    const flagged = session.flagged.includes(questionId)
      ? session.flagged.filter((id) => id !== questionId)
      : [...session.flagged, questionId];
    await persist({ ...session, flagged });
  };

  const urgent = remaining < 5 * 60 * 1000;

  return (
    <div>
      <div className="practice-head">
        <div className="practice-head__row">
          <span className={`mock-timer ${urgent ? 'mock-timer--urgent' : ''}`} role="timer">
            ⏱ {formatClock(remaining)}
          </span>
          <span className="small muted mono">
            {answeredCount} / {session.questionIds.length} 응답
          </span>
        </div>
        <div className="row row--between">
          <button type="button" className="btn btn--sm" onClick={() => setShowSheet((v) => !v)}>
            {showSheet ? '문제로 돌아가기' : '답안지 보기'}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={() => void submit(commitTime(session))}
          >
            시험 종료 · 채점
          </button>
        </div>
      </div>

      {showSheet ? (
        <div className="card">
          <SectionTitle title="답안지" aside="번호를 누르면 해당 문제로 이동합니다" />
          <div className="mock-grid">
            {session.questionIds.map((id, i) => {
              const classes = ['mock-grid__cell'];
              if (session.answers[id] !== undefined) classes.push('mock-grid__cell--answered');
              if (session.flagged.includes(id)) classes.push('mock-grid__cell--flagged');
              if (i === session.cursor) classes.push('mock-grid__cell--current');
              return (
                <button key={id} type="button" className={classes.join(' ')} onClick={() => void jump(i)}>
                  {i + 1}
                </button>
              );
            })}
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            파란색 = 응답 완료 · 우측 상단 점 = 마킹
          </p>
        </div>
      ) : question ? (
        <div className="card">
          <div className="question-meta">
            <span className="badge">{study.index.subjectShortName(question.subjectId)}</span>
            <span className="badge">
              {session.cursor + 1} / {session.questionIds.length}
            </span>
            <button
              type="button"
              className={`badge ${session.flagged.includes(questionId) ? 'badge--warn' : ''}`}
              onClick={() => void toggleFlag()}
              style={{ cursor: 'pointer' }}
            >
              {session.flagged.includes(questionId) ? '⚑ 마킹됨' : '⚐ 마킹'}
            </button>
          </div>

          <p className="question-stem">{question.question}</p>
          {question.passage ? <div className="question-passage">{question.passage}</div> : null}

          <div className="choices">
            {question.choices.map((choice, i) => (
              <button
                key={i}
                type="button"
                className={`choice ${session.answers[questionId] === i ? 'choice--selected' : ''}`}
                onClick={() => void answer(i)}
                aria-pressed={session.answers[questionId] === i}
              >
                <span className="choice__num">{CHOICE_MARK(i)}</span>
                <span>{choice}</span>
                <span className="choice__mark">{session.answers[questionId] === i ? '선택' : ''}</span>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="explain__label">확신도 (선택 · 채점 후 분석에 사용됩니다)</div>
            <div className="chip-row">
              {CONFIDENCE_CHIPS.map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  className="chip chip--sm"
                  aria-pressed={session.confidences[questionId] === chip.value}
                  onClick={() => void setConfidence(chip.value)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <Banner tone="warn">이 문항을 문제은행에서 찾을 수 없습니다.</Banner>
      )}

      <div className="sticky-actions">
        <div className="grid grid--2">
          <button
            type="button"
            className="btn"
            disabled={session.cursor === 0}
            onClick={() => void move(-1)}
          >
            ← 이전
          </button>
          <button
            type="button"
            className="btn"
            disabled={session.cursor >= session.questionIds.length - 1}
            onClick={() => void move(1)}
          >
            다음 →
          </button>
        </div>
      </div>
    </div>
  );
}

function MockReport({ result }: { result: MockResult }): JSX.Element {
  const study = useStudy();
  const config = study.index.config;
  const analysis = useMemo(
    () => analyseMock(result, study.index.questionMap()),
    [result, study.index],
  );

  const renderList = (title: string, items: typeof analysis.luckyCorrect, note: string): JSX.Element => (
    <section>
      <SectionTitle title={`${title} (${items.length})`} aside={note} />
      {items.length === 0 ? (
        <p className="small muted">해당 없음</p>
      ) : (
        <div>
          {items.map((item) => {
            const q = study.index.question(item.questionId);
            if (!q) return null;
            return (
              <div className="q-item" key={item.questionId}>
                <div className="row" style={{ gap: 5 }}>
                  <span className="badge">{study.index.breadcrumb(q)}</span>
                  <span className="badge">
                    내 답 {item.selected >= 0 ? CHOICE_MARK(item.selected) : '무응답'} · 정답{' '}
                    {CHOICE_MARK(q.answer)}
                  </span>
                  {item.elapsedMs > 0 ? (
                    <span className="badge">
                      {Math.round(item.elapsedMs / 1000)}초 / 목표{' '}
                      {expectedSeconds(q.questionType, q.difficulty)}초
                    </span>
                  ) : null}
                </div>
                <div className="q-item__stem">{q.question}</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  return (
    <div className="stack-lg">
      <section>
        <div className="card">
          <div className="row row--between">
            <h1>채점 결과</h1>
            <span className={`badge ${result.passed ? 'badge--ok' : 'badge--bad'}`}>
              {result.passed ? '✓ 합격 기준 충족' : '✕ 기준 미달'}
            </span>
          </div>
          <p className="small muted" style={{ marginTop: 4 }}>
            {new Date(result.finishedAt).toLocaleString('ko-KR')} · 소요 {formatDuration(result.durationMs)}
          </p>

          <div className="divider" />
          <div className="grid grid--auto">
            {result.subjects.map((s) => (
              <Stat
                key={s.subjectId}
                label={study.index.subjectShortName(s.subjectId)}
                value={`${s.percent}점`}
                hint={`${s.correct} / ${s.total}${s.failed ? ' · 과락' : ''}`}
                tone={s.failed ? 'bad' : undefined}
              />
            ))}
            <Stat
              label="전체 평균"
              value={`${result.overallPercent}점`}
              hint={`합격선 ${config.passRule.overallAverageMinPercent}점`}
              tone={result.overallPercent >= config.passRule.overallAverageMinPercent ? 'ok' : 'bad'}
            />
            <Stat label="문항당 평균" value={`${analysis.averageSecondsPerItem}초`} />
          </div>

          {result.failedSubjectIds.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <Banner tone="bad">
                {result.failedSubjectIds.map((id) => study.index.subjectShortName(id)).join(', ')} 과락 —
                평균이 높아도 한 과목이 {config.passRule.perSubjectMinPercent}점 미만이면 불합격입니다.
              </Banner>
            </div>
          ) : null}
        </div>
      </section>

      {renderList('확신했는데 틀린 문제', analysis.riskyWrong, '가장 위험한 오개념')}
      {renderList('찍어서 맞힌 문제', analysis.luckyCorrect, '실력으로 계산되지 않습니다')}
      {renderList('시간이 오래 걸린 문제', analysis.slowItems, '목표 시간의 1.6배 초과')}
      {renderList('무응답 문항', analysis.unanswered, '시간 배분 점검 필요')}

      <section>
        <SectionTitle title="영역별 정답률" />
        <div className="card scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>단원</th>
                <th>정답</th>
                <th>문항</th>
                <th>정답률</th>
              </tr>
            </thead>
            <tbody>
              {topicRows(result, study).map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td className="mono">{row.correct}</td>
                  <td className="mono">{row.total}</td>
                  <td className="mono">{row.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Link className="btn btn--primary btn--block" to="/mock">
        모의시험 목록으로
      </Link>
    </div>
  );
}

function topicRows(
  result: MockResult,
  study: ReturnType<typeof useStudy>,
): Array<{ id: string; name: string; correct: number; total: number; percent: number }> {
  const map = new Map<string, { correct: number; total: number }>();
  for (const item of result.items) {
    const q = study.index.question(item.questionId);
    if (!q) continue;
    const entry = map.get(q.majorTopicId) ?? { correct: 0, total: 0 };
    entry.total += 1;
    if (item.correct) entry.correct += 1;
    map.set(q.majorTopicId, entry);
  }
  const majorNames = new Map(
    study.index.config.subjects
      .flatMap((s) => study.index.majorTopics(s.id))
      .map((m) => [m.id, m.name] as const),
  );
  return [...map.entries()]
    .map(([id, v]) => {
      const name = majorNames.get(id) ?? id;
      return {
        id,
        name,
        correct: v.correct,
        total: v.total,
        percent: v.total ? Math.round((v.correct / v.total) * 100) : 0,
      };
    })
    .sort((a, b) => a.percent - b.percent);
}
