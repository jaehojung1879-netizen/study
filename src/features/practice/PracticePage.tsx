/** /practice — today's adaptive set plus focused drills (§6, §13, §25). */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudy } from '../../app/StudyProvider';
import { Banner, ProgressBar, SectionTitle, Stat } from '../../components/ui';
import {
  BUCKET_LABELS,
  questionsNeededForGoal,
  type SelectionBucket,
} from '../../learning/scheduler/dailySet';
import type { PracticeSession } from '../../storage/types';
import { createCustomSession, ensureTodaySession } from './sessions';

export function PracticePage(): JSX.Element {
  const study = useStudy();
  const navigate = useNavigate();
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await ensureTodaySession(study);
        if (!cancelled) setSession(next);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '오늘의 세트를 만들지 못했습니다.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally runs once per mount: the set must not rebuild as records change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDrill = async (kind: 'weakness' | 'calculation' | 'risky'): Promise<void> => {
    setBusy(true);
    try {
      let questions = [];
      let summary = '';
      if (kind === 'calculation') {
        questions = study.index.questions.filter((q) => q.questionType === 'calculation');
        summary = '계산문제 집중 연습';
      } else if (kind === 'risky') {
        const riskyIds = new Set(study.states.filter((s) => s.riskFlagged).map((s) => s.questionId));
        questions = study.index.questions.filter((q) => riskyIds.has(q.id));
        summary = '확신했는데 틀린 문제 재도전';
      } else {
        const topConcepts = new Set(study.analytics.weaknesses.slice(0, 5).flatMap((w) => w.weakConceptIds));
        questions = study.index.questions.filter((q) => q.conceptIds.some((c) => topConcepts.has(c)));
        summary = '취약개념 집중 문제';
      }
      if (questions.length === 0) {
        setError('해당 조건에 맞는 문제가 아직 없습니다.');
        return;
      }
      const drill = await createCustomSession(study, questions.slice(0, 30), 'review', summary);
      navigate(`/practice/${drill.id}`);
    } finally {
      setBusy(false);
    }
  };

  if (error && !session) {
    return <Banner tone="bad">{error}</Banner>;
  }
  if (!session) {
    return <div className="empty">오늘의 세트를 구성하는 중…</div>;
  }

  const breakdown = countBuckets(session);
  const remaining = session.questionIds.length - session.answeredCount;
  const done = session.answeredCount >= session.questionIds.length;

  return (
    <div className="stack-lg">
      {study.dailyGoal < study.requestedDailyGoal ? (
        <Banner tone="warn">
          목표는 하루 {study.requestedDailyGoal}문제지만 문제은행이 {study.index.questions.length}
          문항뿐이라 오늘 세트를 {study.dailyGoal}문항으로 줄였습니다. 더 늘리면 어제 푼 문제가 그대로
          다시 나옵니다. 목표대로 {study.requestedDailyGoal}문제를 반복 없이 풀려면 문항이{' '}
          {questionsNeededForGoal(study.index.config, study.index.questions, study.requestedDailyGoal)}개 더
          필요합니다.
        </Banner>
      ) : null}

      <section>
        <div className="card">
          <div className="row row--between">
            <h1>오늘의 {session.questionIds.length}문제</h1>
            <span className="badge">{study.analytics.phase.phase.label}</span>
          </div>
          <p className="small muted" style={{ marginTop: 4 }}>
            {study.analytics.phase.phase.description}
          </p>

          <div style={{ marginTop: 12 }}>
            <div className="row row--between small">
              <span>진행</span>
              <span className="mono">
                {session.answeredCount} / {session.questionIds.length}
              </span>
            </div>
            <div style={{ marginTop: 6 }}>
              <ProgressBar value={session.answeredCount} max={session.questionIds.length} />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={done}
              onClick={() => navigate(`/practice/${session.id}`)}
            >
              {done
                ? '오늘 세트 완료 ✓'
                : session.answeredCount > 0
                  ? `이어서 풀기 (${remaining}문항 남음)`
                  : '시작하기'}
            </button>
          </div>
          {done ? (
            <p className="small muted" style={{ marginTop: 8 }}>
              오늘 목표를 마쳤습니다. 아래 집중 연습으로 취약영역을 더 파거나, 모의시험으로 실전 감각을
              점검하세요.
            </p>
          ) : null}
        </div>
      </section>

      <section>
        <SectionTitle title="세트 구성" aside="학습기록에 따라 매일 다르게 구성됩니다" />
        <div className="card">
          <div className="grid grid--auto">
            {(Object.keys(breakdown) as SelectionBucket[])
              .filter((b) => breakdown[b] > 0)
              .map((bucket) => (
                <Stat key={bucket} label={BUCKET_LABELS[bucket]} value={`${breakdown[bucket]}문항`} />
              ))}
          </div>
          <div className="divider" />
          <div className="row small muted">
            {study.index.config.subjects.map((subject) => {
              const count = session.questionIds.filter(
                (id) => study.index.question(id)?.subjectId === subject.id,
              ).length;
              return (
                <span key={subject.id} className="badge">
                  {subject.shortName} {count}문항
                </span>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <SectionTitle title="집중 연습" aside="오늘 세트와 별도로 진행됩니다" />
        <div className="stack">
          <button
            type="button"
            className="btn btn--block"
            disabled={busy}
            onClick={() => void startDrill('weakness')}
          >
            취약개념 문제 모아 풀기
          </button>
          <button
            type="button"
            className="btn btn--block"
            disabled={busy}
            onClick={() => void startDrill('calculation')}
          >
            계산문제만 연습 (부동산학개론)
          </button>
          <button
            type="button"
            className="btn btn--block"
            disabled={busy || study.states.every((s) => !s.riskFlagged)}
            onClick={() => void startDrill('risky')}
          >
            확신했는데 틀린 문제 재도전
          </button>
        </div>
        {error ? (
          <p className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function countBuckets(session: PracticeSession): Record<SelectionBucket, number> {
  const out: Record<SelectionBucket, number> = {
    weakness: 0,
    dueReview: 0,
    coverage: 0,
    recentWrong: 0,
    fresh: 0,
    filler: 0,
  };
  for (const bucket of session.buckets) {
    const key = bucket as SelectionBucket;
    if (key in out) out[key] += 1;
  }
  return out;
}
