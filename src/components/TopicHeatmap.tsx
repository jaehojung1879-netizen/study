/**
 * Topic heatmap (§5): subject → major → minor, with a 5-band scale.
 * Colour never carries the meaning alone — every cell also prints its score.
 */
import { useState } from 'react';
import { MASTERY_BANDS, masteryBandLabel } from '../learning/mastery/masteryScore';
import type { MinorTopicStats, SubjectStats } from '../learning/analytics/stats';
import { bandColor } from './ui';

export interface TopicHeatmapProps {
  subjects: SubjectStats[];
  onSelect?: (topic: MinorTopicStats) => void;
  selectedId?: string | null;
}

export function TopicHeatmap({ subjects, onSelect, selectedId }: TopicHeatmapProps): JSX.Element {
  const [openSubject, setOpenSubject] = useState<string | null>(subjects[0]?.id ?? null);

  return (
    <div className="stack">
      <div className="heat-legend" aria-hidden>
        {[...MASTERY_BANDS].reverse().map((band) => (
          <span className="heat-legend__item" key={band.band}>
            <span
              className="heat-cell__dot"
              style={{ background: bandColor(band.min === 0 ? 10 : band.min + 1) }}
            />
            {band.label}
          </span>
        ))}
        <span className="heat-legend__item">
          <span className="heat-cell__dot" style={{ background: 'var(--band-empty)' }} />
          미학습
        </span>
      </div>

      {subjects.map((subject) => {
        const open = openSubject === subject.id;
        return (
          <section key={subject.id}>
            <button
              type="button"
              className="row row--between"
              onClick={() => setOpenSubject(open ? null : subject.id)}
              aria-expanded={open}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                padding: '4px 0',
                textAlign: 'left',
              }}
            >
              <span style={{ fontWeight: 650 }}>
                {open ? '▾' : '▸'} {subject.name}
              </span>
              <span className="small muted">
                숙련도 {subject.mastery.hasData ? Math.round(subject.mastery.score) : '—'} · {subject.attempts}문항 풀이
              </span>
            </button>

            {open
              ? subject.majorTopics.map((major) => (
                  <div className="heatmap__major" key={major.id}>
                    <div className="heatmap__major-head">
                      <span>{major.name}</span>
                      <span className="tiny muted">
                        {major.attempts > 0
                          ? `${Math.round(major.mastery.score)} · ${masteryBandLabel(major.mastery.score)}`
                          : '미학습'}
                      </span>
                    </div>
                    <div className="heatmap__cells">
                      {major.minorTopics.map((minor) => {
                        const hasData = minor.attempts > 0;
                        return (
                          <button
                            type="button"
                            key={minor.id}
                            className="heat-cell"
                            aria-pressed={selectedId === minor.id}
                            onClick={() => onSelect?.(minor)}
                          >
                            <span className="heat-cell__name">{minor.name}</span>
                            <span className="heat-cell__meta">
                              <span
                                className="heat-cell__dot"
                                style={{ background: bandColor(minor.mastery.score, hasData) }}
                                aria-hidden
                              />
                              {hasData
                                ? `${Math.round(minor.mastery.score)} · ${masteryBandLabel(minor.mastery.score)}`
                                : '미학습'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              : null}
          </section>
        );
      })}
    </div>
  );
}

export function TopicDetail({ topic }: { topic: MinorTopicStats }): JSX.Element {
  return (
    <div className="card">
      <div className="row row--between">
        <h3>{topic.name}</h3>
        <span className="small muted">
          숙련도 {topic.attempts > 0 ? Math.round(topic.mastery.score) : '—'}
        </span>
      </div>
      <div className="divider" />
      <div className="grid grid--2">
        <Metric label="정답률" value={`${topic.accuracy}%`} />
        <Metric label="최근 정답률" value={`${topic.recentAccuracy}%`} />
        <Metric label="평균 풀이시간" value={`${Math.round(topic.avgElapsedMs / 1000)}초`} />
        <Metric label="틀린 횟수" value={`${topic.wrongCount}회`} />
        <Metric
          label="최근 복습일"
          value={topic.lastAttemptAt ? new Date(topic.lastAttemptAt).toLocaleDateString('ko-KR') : '—'}
        />
        <Metric
          label="다음 복습 예정"
          value={topic.nextReviewAt ? new Date(topic.nextReviewAt).toLocaleDateString('ko-KR') : '—'}
        />
      </div>
      {topic.riskyCount > 0 ? (
        <p className="small" style={{ marginTop: 10, color: 'var(--bad)' }}>
          ⚠ 확신했는데 틀린 문제 {topic.riskyCount}개 — 오개념 가능성이 높은 영역입니다.
        </p>
      ) : null}
      {topic.concepts.some((c) => c.attempts > 0) ? (
        <>
          <div className="divider" />
          <div className="explain__label">개념별 숙련도</div>
          <div className="chip-row">
            {topic.concepts
              .filter((c) => c.attempts > 0)
              .sort((a, b) => a.mastery.score - b.mastery.score)
              .map((c) => (
                <span
                  className="chip chip--sm"
                  key={c.id}
                  style={{ borderColor: bandColor(c.mastery.score) }}
                >
                  {c.name} {Math.round(c.mastery.score)}
                </span>
              ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="tiny muted">{label}</div>
      <div className="mono" style={{ fontWeight: 650 }}>
        {value}
      </div>
    </div>
  );
}
