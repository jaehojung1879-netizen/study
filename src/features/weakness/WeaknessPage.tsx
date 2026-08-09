/** /weakness — ranked weak areas with a one-tap drill (§5, §13). */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudy } from '../../app/StudyProvider';
import { TopicDetail, TopicHeatmap } from '../../components/TopicHeatmap';
import { Banner, Empty, SectionTitle, bandColor } from '../../components/ui';
import type { MinorTopicStats } from '../../learning/analytics/stats';
import { createCustomSession } from '../practice/sessions';

export function WeaknessPage(): JSX.Element {
  const study = useStudy();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<MinorTopicStats | null>(null);
  const { weaknesses, subjects, errorCauses } = study.analytics;

  const drillTopic = async (minorTopicId: string, name: string): Promise<void> => {
    const questions = study.index.questions.filter((q) => q.minorTopicId === minorTopicId);
    if (questions.length === 0) return;
    const session = await createCustomSession(study, questions, 'review', `${name} 집중 연습`);
    navigate(`/practice/${session.id}`);
  };

  return (
    <div className="stack-lg">
      <section>
        <h1>취약영역 분석</h1>
        <p className="small muted" style={{ marginTop: 4 }}>
          우선순위는 숙련도 격차, 표본 크기, 확신 오답 수, 최근 하락폭을 함께 반영해 계산합니다.
        </p>
      </section>

      {weaknesses.length === 0 ? (
        <Empty>아직 분석할 기록이 없습니다. 오늘의 문제를 먼저 풀어주세요.</Empty>
      ) : (
        <section>
          <SectionTitle title="우선순위 상위 영역" aside={`${weaknesses.length}개 단원`} />
          <div className="stack">
            {weaknesses.slice(0, 12).map((item, rank) => (
              <div className="card" key={item.minorTopicId}>
                <div className="row row--between">
                  <div>
                    <span className="tiny muted">
                      {rank + 1}위 · {item.subjectName} · {item.majorTopicName}
                    </span>
                    <h3>{item.minorTopicName}</h3>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      className="stat__value"
                      style={{ fontSize: '1.2rem', color: bandColor(item.mastery) }}
                    >
                      {Math.round(item.mastery)}
                    </div>
                    <div className="tiny muted">숙련도</div>
                  </div>
                </div>

                <p className="small" style={{ marginTop: 6 }}>
                  {item.reason}
                </p>

                <div className="row tiny muted" style={{ marginTop: 6 }}>
                  <span>정답률 {item.accuracy}%</span>
                  <span>최근 {item.recentAccuracy}%</span>
                  <span>{item.attempts}문항</span>
                  <span>오답 {item.wrongCount}회</span>
                  {item.riskyCount > 0 ? (
                    <span style={{ color: 'var(--bad)' }}>확신 오답 {item.riskyCount}</span>
                  ) : null}
                </div>

                {item.weakConceptIds.length > 0 ? (
                  <div className="chip-row" style={{ marginTop: 8 }}>
                    {item.weakConceptIds.slice(0, 4).map((conceptId) => (
                      <span className="chip chip--sm" key={conceptId}>
                        {study.index.conceptName(conceptId)}
                      </span>
                    ))}
                  </div>
                ) : null}

                <button
                  type="button"
                  className="btn btn--sm"
                  style={{ marginTop: 10 }}
                  onClick={() => void drillTopic(item.minorTopicId, item.minorTopicName)}
                >
                  이 단원 문제 모아 풀기
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {errorCauses.length > 0 ? (
        <section>
          <SectionTitle title="오답 원인" />
          <Banner tone="warn">
            정답률만 보면 &ldquo;민법 56%&rdquo;에서 끝납니다. 원인 분포를 보면 무엇을 고쳐야 하는지가
            보입니다 — 현재 1위는 &ldquo;{errorCauses[0].label}&rdquo;({errorCauses[0].percent}%)입니다.
          </Banner>
        </section>
      ) : null}

      <section>
        <SectionTitle title="전체 Topic Heatmap" />
        <div className="card">
          <TopicHeatmap
            subjects={subjects}
            selectedId={selected?.id ?? null}
            onSelect={(topic) => setSelected((prev) => (prev?.id === topic.id ? null : topic))}
          />
        </div>
        {selected ? (
          <div style={{ marginTop: 12 }}>
            <TopicDetail topic={selected} />
            <button
              type="button"
              className="btn btn--block"
              style={{ marginTop: 8 }}
              onClick={() => void drillTopic(selected.id, selected.name)}
            >
              {selected.name} 문제 풀기
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
