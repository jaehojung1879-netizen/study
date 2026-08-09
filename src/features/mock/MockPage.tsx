/** /mock — start a sitting, review past results and the score trend (§20, §21). */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudy, newId } from '../../app/StudyProvider';
import { ChartLegend, LineChart, type Series } from '../../components/LineChart';
import { Banner, Empty, SectionTitle, Stat } from '../../components/ui';
import { buildMockSet } from '../../learning/scoring/mock';
import { formatDuration } from '../../learning/utils/date';
import type { MockSession } from '../../storage/types';

const SUBJECT_COLOR: Record<string, string> = { teal: 'var(--teal)', violet: 'var(--violet)' };

export function MockPage(): JSX.Element {
  const study = useStudy();
  const navigate = useNavigate();
  const [inProgress, setInProgress] = useState<MockSession | null>(null);
  const [busy, setBusy] = useState(false);
  const config = study.index.config;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const open = await study.storage.listMockSessions(study.index.examId);
      const live = open.find((s) => !s.submittedAt);
      if (!cancelled) setInProgress(live ?? null);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [study.index.examId]);

  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      const questionIds = buildMockSet(config, study.index.questions, `${Date.now()}`);
      const now = Date.now();
      const session: MockSession = {
        id: newId('mock'),
        examId: config.id,
        questionIds,
        answers: {},
        confidences: {},
        flagged: [],
        perQuestionMs: {},
        cursor: 0,
        startedAt: now,
        endsAt: now + config.mock.durationMinutes * 60 * 1000,
      };
      await study.storage.putMockSession(session);
      navigate(`/mock/${session.id}`);
    } finally {
      setBusy(false);
    }
  };

  const trend = study.analytics.mockTrend;
  const series: Series[] = config.subjects.map((subject) => ({
    id: subject.id,
    label: subject.shortName,
    color: SUBJECT_COLOR[subject.accent] ?? 'var(--accent)',
    values: trend.points.map((p) => p.perSubject[subject.id] ?? 0),
  }));

  const shortfall = config.mock.totalQuestions - study.index.questions.length;

  return (
    <div className="stack-lg">
      <section>
        <div className="card">
          <h1>실전 모의시험</h1>
          <div className="grid grid--auto" style={{ marginTop: 12 }}>
            <Stat label="문항수" value={`${config.mock.totalQuestions}문항`} />
            <Stat label="시험시간" value={`${config.mock.durationMinutes}분`} />
            <Stat
              label="합격기준"
              value={`평균 ${config.passRule.overallAverageMinPercent}점`}
              hint={`과목별 ${config.passRule.perSubjectMinPercent}점 미만 과락`}
            />
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            실전모드에서는 정답과 해설이 표시되지 않고 타이머가 동작합니다. 종료 후 한 번에 채점합니다.
          </p>

          {shortfall > 0 ? (
            <div style={{ marginTop: 10 }}>
              <Banner tone="warn">
                현재 문제은행이 {study.index.questions.length}문항이라 {config.mock.totalQuestions}문항
                시험을 채울 수 없습니다. 가능한 만큼만 출제되며, 문제은행을 늘리면 자동으로 정상 구성됩니다.
              </Banner>
            </div>
          ) : null}

          {inProgress ? (
            <button
              type="button"
              className="btn btn--primary btn--block"
              style={{ marginTop: 12 }}
              onClick={() => navigate(`/mock/${inProgress.id}`)}
            >
              진행 중인 시험 이어서 보기
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary btn--block"
              style={{ marginTop: 12 }}
              disabled={busy || study.index.questions.length === 0}
              onClick={() => void start()}
            >
              모의시험 시작
            </button>
          )}
        </div>
      </section>

      <section>
        <SectionTitle title="점수 추이" aside={`${trend.points.length}회 응시`} />
        <div className="card">
          {trend.points.length === 0 ? (
            <Empty>아직 응시 기록이 없습니다.</Empty>
          ) : (
            <>
              <LineChart
                series={[
                  ...series,
                  {
                    id: 'overall',
                    label: '전체 평균',
                    color: 'var(--text)',
                    values: trend.points.map((p) => p.overallPercent),
                  },
                ]}
                threshold={{
                  value: config.passRule.overallAverageMinPercent,
                  label: `합격선 ${config.passRule.overallAverageMinPercent}`,
                }}
                xLabels={trend.points.map((p) => `${p.index}회`)}
              />
              <ChartLegend
                series={[
                  ...series,
                  { id: 'overall', label: '전체 평균', color: 'var(--text)', values: [] },
                ]}
              />
              <div className="divider" />
              <div className="scroll-x">
                <table className="data">
                  <thead>
                    <tr>
                      <th>과목</th>
                      <th>최근 3회</th>
                      <th>최근 5회</th>
                      <th>전체</th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.subjects.map((subject) => {
                      const avg = trend.perSubjectAverages[subject.id];
                      return (
                        <tr key={subject.id}>
                          <td>{subject.shortName}</td>
                          <td className="mono">{avg?.last3 ?? '—'}</td>
                          <td className="mono">{avg?.last5 ?? '—'}</td>
                          <td className="mono">{avg?.all ?? '—'}</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td style={{ fontWeight: 650 }}>전체 평균</td>
                      <td className="mono">{trend.averages.last3 ?? '—'}</td>
                      <td className="mono">{trend.averages.last5 ?? '—'}</td>
                      <td className="mono">{trend.averages.all ?? '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="small muted" style={{ marginTop: 8 }}>
                {trend.stabilityNote}
              </p>
            </>
          )}
        </div>
      </section>

      <section>
        <SectionTitle title="응시 기록" />
        {study.mockResults.length === 0 ? (
          <Empty>기록이 없습니다.</Empty>
        ) : (
          <div className="stack">
            {[...study.mockResults].reverse().map((result) => (
              <button
                key={result.id}
                type="button"
                className="q-item"
                onClick={() => navigate(`/mock/${result.id}?view=result`)}
              >
                <div className="row row--between">
                  <span className="small">{new Date(result.finishedAt).toLocaleString('ko-KR')}</span>
                  <span className={`badge ${result.passed ? 'badge--ok' : 'badge--bad'}`}>
                    {result.passed ? '합격 기준 충족' : '기준 미달'}
                  </span>
                </div>
                <div className="row small muted" style={{ marginTop: 4 }}>
                  <span className="mono">평균 {result.overallPercent}점</span>
                  {result.subjects.map((s) => (
                    <span key={s.subjectId} className="mono">
                      {study.index.subjectShortName(s.subjectId)} {s.percent}
                      {s.failed ? ' (과락)' : ''}
                    </span>
                  ))}
                  <span>{formatDuration(result.durationMs)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
