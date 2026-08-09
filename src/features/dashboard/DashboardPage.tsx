/** Dashboard (§3, §4, §5, §21, §23) — answers "지금 나는 합격할 수준인가?". */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStudy } from '../../app/StudyProvider';
import { ThreeCircleDiagram } from '../../components/ThreeCircleDiagram';
import { TopicDetail, TopicHeatmap } from '../../components/TopicHeatmap';
import { ChartLegend, LineChart, type Series } from '../../components/LineChart';
import { Banner, MasteryPill, ProgressBar, SectionTitle, Stat } from '../../components/ui';
import type { MinorTopicStats } from '../../learning/analytics/stats';
import { activeDaysInWindow, dateKey } from '../../learning/utils/date';

const SUBJECT_COLOR: Record<string, string> = {
  teal: 'var(--teal)',
  violet: 'var(--violet)',
};

export function DashboardPage(): JSX.Element {
  const study = useStudy();
  const { analytics, index, daysLeft, dailyGoal } = study;
  const [selectedTopic, setSelectedTopic] = useState<MinorTopicStats | null>(null);

  const todayPractice = analytics.todayAttempts.filter((a) => a.mode === 'practice').length;
  const activeDays7 = useMemo(
    () => activeDaysInWindow(study.attempts.map((a) => a.at), 7),
    [study.attempts],
  );

  const mockSeries = useMemo<Series[]>(() => {
    const points = analytics.mockTrend.points;
    return index.config.subjects.map((subject) => ({
      id: subject.id,
      label: subject.shortName,
      color: SUBJECT_COLOR[subject.accent] ?? 'var(--accent)',
      values: points.map((p) => p.perSubject[subject.id] ?? 0),
    }));
  }, [analytics.mockTrend.points, index.config.subjects]);

  const rec = analytics.recommendation;

  return (
    <div className="stack-lg">
      <section>
        <div className="card">
          <div className="row row--between">
            <div>
              <h1>{index.config.name}</h1>
              <p className="small muted">
                {index.config.examDate} 시행 예정
                {index.config.scheduleVerified ? '' : ' · 공식 공고 미확인'}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="stat__value" style={{ fontSize: '1.9rem' }}>
                D-{Math.max(0, daysLeft)}
              </div>
              <div className="tiny muted">{analytics.phase.phase.label}</div>
            </div>
          </div>

          <div className="divider" />

          <div className="row row--between small">
            <span>오늘 학습량</span>
            <span className="mono">
              {todayPractice} / {dailyGoal}
            </span>
          </div>
          <div style={{ marginTop: 6 }}>
            <ProgressBar value={todayPractice} max={dailyGoal} label="오늘 학습 진행률" />
          </div>
          <div style={{ marginTop: 12 }}>
            <Link className="btn btn--primary btn--block" to="/practice">
              {todayPractice > 0 ? '오늘의 문제 이어서 풀기' : `오늘의 ${dailyGoal}문제 시작`}
            </Link>
          </div>
        </div>
      </section>

      <section>
        <Banner tone={rec.tone === 'positive' ? 'accent' : rec.tone === 'warning' ? 'warn' : 'accent'}>
          <strong>오늘의 추천</strong>
          <br />
          {rec.headline}
        </Banner>
        {rec.notes.length > 0 ? (
          <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {rec.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <div className="grid grid--auto">
          <Stat label="연속 학습일" value={`${analytics.streakDays}일`} />
          <Stat label="최근 7일 공부일" value={`${activeDays7}일`} hint="7일 중" />
          <Stat label="총 풀이문제" value={analytics.overall.attempts.toLocaleString('ko-KR')} />
          <Stat
            label="전체 정답률"
            value={`${analytics.overall.accuracy}%`}
            hint={`${analytics.overall.correct} / ${analytics.overall.attempts}`}
          />
        </div>
      </section>

      <section>
        <SectionTitle title="과목별 숙련도" aside="최근 문제에 가중치를 둔 mastery score" />
        <div className="grid grid--2">
          {analytics.subjects.map((subject) => {
            const config = index.config.subjects.find((s) => s.id === subject.id);
            return (
              <div className="card" key={subject.id}>
                <div className="tiny muted">{config?.shortName ?? subject.name}</div>
                <div className="stat__value">
                  {subject.mastery.hasData ? Math.round(subject.mastery.score) : '—'}
                  <span className="small muted"> / 100</span>
                </div>
                <div style={{ marginTop: 4 }}>
                  <MasteryPill score={subject.mastery.score} hasData={subject.mastery.hasData} />
                </div>
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  정답률 {subject.accuracy}% · 최근 {subject.recentAccuracy}% · {subject.attempts}문항
                </div>
                {subject.riskyCount > 0 ? (
                  <div className="tiny" style={{ color: 'var(--bad)', marginTop: 3 }}>
                    확신 오답 {subject.riskyCount}개
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <SectionTitle title="숙련도 3영역" aside={analytics.circles.stable ? '안정권' : '보강 필요'} />
        <div className="card">
          <ThreeCircleDiagram scores={analytics.circles} />
        </div>
      </section>

      <section>
        <SectionTitle
          title="Topic Heatmap"
          aside={<Link to="/weakness">취약영역 전체 보기 →</Link>}
        />
        <div className="card">
          <TopicHeatmap
            subjects={analytics.subjects}
            selectedId={selectedTopic?.id ?? null}
            onSelect={(topic) => setSelectedTopic((prev) => (prev?.id === topic.id ? null : topic))}
          />
        </div>
        {selectedTopic ? (
          <div style={{ marginTop: 12 }}>
            <TopicDetail topic={selectedTopic} />
          </div>
        ) : null}
      </section>

      <section>
        <SectionTitle title="실전 모의시험 추이" aside={<Link to="/mock">모의시험 →</Link>} />
        <div className="card">
          {analytics.mockTrend.points.length === 0 ? (
            <p className="small muted">
              아직 모의시험 기록이 없습니다. 실전 시간 감각과 과락 위험은 모의시험에서만 측정됩니다.
            </p>
          ) : (
            <>
              <LineChart
                series={mockSeries}
                threshold={{
                  value: index.config.passRule.overallAverageMinPercent,
                  label: `합격선 ${index.config.passRule.overallAverageMinPercent}`,
                }}
                xLabels={analytics.mockTrend.points.map((p) => `${p.index}회`)}
              />
              <ChartLegend series={mockSeries} />
              <div className="divider" />
              <div className="grid grid--auto">
                <Stat label="최근 3회 평균" value={fmt(analytics.mockTrend.averages.last3)} />
                <Stat label="최근 5회 평균" value={fmt(analytics.mockTrend.averages.last5)} />
                <Stat label="전체 평균" value={fmt(analytics.mockTrend.averages.all)} />
              </div>
              <p className="small muted" style={{ marginTop: 8 }}>
                {analytics.mockTrend.stabilityNote}
              </p>
            </>
          )}
        </div>
      </section>

      <section>
        <SectionTitle title="오답 원인 분포" aside={<Link to="/review">오답노트 →</Link>} />
        <div className="card">
          {analytics.errorCauses.length === 0 ? (
            <p className="small muted">
              오답 원인이 아직 기록되지 않았습니다. 틀린 뒤 원인을 한 번만 눌러 두면 "정답률"보다 훨씬
              쓸모 있는 분석이 나옵니다.
            </p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>원인</th>
                  <th>횟수</th>
                  <th>비중</th>
                </tr>
              </thead>
              <tbody>
                {analytics.errorCauses.map((slice) => (
                  <tr key={slice.cause}>
                    <td>{slice.label}</td>
                    <td className="mono">{slice.count}</td>
                    <td className="mono">{slice.percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <p className="tiny faint">
        마지막 학습 {analytics.overall.attempts > 0 ? dateKey(study.attempts[study.attempts.length - 1].at) : '—'} ·
        저장소 {study.storageKind === 'indexeddb' ? 'IndexedDB' : '메모리(비영구)'}
      </p>
    </div>
  );
}

function fmt(value: number | null): string {
  return value === null ? '—' : `${value}점`;
}
