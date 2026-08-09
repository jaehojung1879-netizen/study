/** /practice/:sessionId — the focused solving screen (§7–§10, §28). */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStudy } from '../../app/StudyProvider';
import { QuestionCard } from '../../components/QuestionCard';
import { Banner, Stat } from '../../components/ui';
import type { PracticeSession } from '../../storage/types';

export function PracticeSessionPage(): JSX.Element {
  const { sessionId = '' } = useParams();
  const study = useStudy();
  const navigate = useNavigate();
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = study.sessions.find((s) => s.id === sessionId);
      const found = local ?? (await study.storage.getSession(sessionId));
      if (cancelled) return;
      if (!found) setNotFound(true);
      else setSession(found);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const question = useMemo(() => {
    if (!session) return undefined;
    const id = session.questionIds[session.cursor];
    return id ? study.index.question(id) : undefined;
  }, [session, study.index]);

  if (notFound) {
    return (
      <Banner tone="bad">
        세션을 찾을 수 없습니다. <Link to="/practice">오늘의 문제로 돌아가기</Link>
      </Banner>
    );
  }
  if (!session) return <div className="empty">불러오는 중…</div>;

  const finished = session.cursor >= session.questionIds.length;

  if (finished) {
    const accuracy = session.answeredCount
      ? Math.round((session.correctCount / session.answeredCount) * 100)
      : 0;
    return (
      <div className="stack-lg">
        <div className="card">
          <h1>세트 완료</h1>
          <p className="small muted" style={{ marginTop: 4 }}>
            {session.planSummary}
          </p>
          <div className="divider" />
          <div className="grid grid--auto">
            <Stat label="푼 문항" value={`${session.answeredCount}문항`} />
            <Stat label="정답" value={`${session.correctCount}문항`} />
            <Stat label="정답률" value={`${accuracy}%`} tone={accuracy >= 60 ? 'ok' : 'bad'} />
          </div>
        </div>
        <div className="stack">
          <Link className="btn btn--primary btn--block" to="/">
            대시보드에서 변화 확인하기
          </Link>
          <Link className="btn btn--block" to="/review">
            오답노트 보기
          </Link>
        </div>
      </div>
    );
  }

  if (!question) {
    // A question id in the session is no longer in the bank (bank edited between days).
    const advance = async (): Promise<void> => {
      const next = { ...session, cursor: session.cursor + 1 };
      setSession(next);
      await study.saveSession(next);
    };
    return (
      <div className="stack">
        <Banner tone="warn">이 문항은 문제은행에서 제거되었습니다. 다음 문제로 넘어갑니다.</Banner>
        <button type="button" className="btn btn--primary btn--block" onClick={() => void advance()}>
          다음 문제
        </button>
      </div>
    );
  }

  const bucket = session.buckets[session.cursor];
  const state = study.stateOf(question.id);

  const handleSubmit = async (payload: {
    selected: number;
    confidence: Parameters<typeof study.recordAttempt>[0]['confidence'];
    elapsedMs: number;
  }) => {
    const attempt = await study.recordAttempt({
      question,
      sessionId: session.id,
      mode: session.mode,
      selected: payload.selected,
      confidence: payload.confidence,
      elapsedMs: payload.elapsedMs,
    });
    const next: PracticeSession = {
      ...session,
      answeredCount: session.answeredCount + 1,
      correctCount: session.correctCount + (attempt.correct ? 1 : 0),
    };
    setSession(next);
    await study.saveSession(next);
    return attempt;
  };

  const goNext = async (): Promise<void> => {
    const cursor = session.cursor + 1;
    const next: PracticeSession = {
      ...session,
      cursor,
      completedAt: cursor >= session.questionIds.length ? Date.now() : session.completedAt,
    };
    setSession(next);
    await study.saveSession(next);
    window.scrollTo({ top: 0 });
  };

  const isLast = session.cursor === session.questionIds.length - 1;

  return (
    <div>
      <div className="row row--between" style={{ marginBottom: 8 }}>
        <button type="button" className="btn btn--sm" onClick={() => navigate('/practice')}>
          ← 나가기
        </button>
        <span className="tiny muted">
          {bucket ? `출제 이유: ${bucketLabel(bucket)}` : null}
          {state && state.totalAttempts > 0 ? ` · ${state.totalAttempts}번째 풀이` : ''}
        </span>
      </div>

      <QuestionCard
        question={question}
        index={study.index}
        position={{ current: session.cursor + 1, total: session.questionIds.length }}
        confidencePrompt={study.settings.confidencePromptEnabled}
        errorCausePrompt={study.settings.errorCausePromptEnabled}
        bookmarked={!!state?.bookmarked}
        onSubmit={handleSubmit}
        onErrorCause={(attemptId, cause) => void study.setErrorCause(attemptId, cause)}
        onToggleBookmark={() => void study.toggleBookmark(question)}
        onSaveFlashcard={(front, back) =>
          void study.addFlashcard({
            examId: question.examId,
            subjectId: question.subjectId,
            questionId: question.id,
            front,
            back,
          })
        }
        onNext={() => void goNext()}
        nextLabel={isLast ? '세트 마치기' : '다음 문제'}
      />
    </div>
  );
}

const BUCKET_REASON: Record<string, string> = {
  weakness: '취약영역 보강',
  dueReview: '복습 예정일 도래',
  coverage: '전체 범위 커버리지',
  recentWrong: '최근 오답 개념의 다른 문제',
  fresh: '신규 문제',
  filler: '보충',
};

function bucketLabel(bucket: string): string {
  return BUCKET_REASON[bucket] ?? bucket;
}
