/**
 * 3-circle mastery diagram (§4).
 *
 * Each circle's *radius* encodes its score, so a weak dimension is visible as a
 * small circle before you read a single number. The centre marks 합격 안정영역 —
 * lit only when all three clear the threshold.
 */
import { CIRCLE_LABELS, STABLE_THRESHOLD, type ThreeCircleScores } from '../learning/mastery/threeCircles';

const CIRCLE_COLOR = {
  concept: 'var(--accent)',
  retention: 'var(--violet)',
  performance: 'var(--teal)',
} as const;

const MIN_R = 24;
const MAX_R = 54;

function radius(score: number): number {
  return MIN_R + (Math.max(0, Math.min(100, score)) / 100) * (MAX_R - MIN_R);
}

export function ThreeCircleDiagram({ scores }: { scores: ThreeCircleScores }): JSX.Element {
  const centers = {
    concept: { x: 100, y: 72 },
    retention: { x: 70, y: 122 },
    performance: { x: 130, y: 122 },
  };
  const order = ['concept', 'retention', 'performance'] as const;

  const label = scores.hasData
    ? `개념 이해 ${Math.round(scores.concept)}점, 장기 기억 ${Math.round(
        scores.retention,
      )}점, 실전 대응 ${Math.round(scores.performance)}점. ${
        scores.stable ? '세 영역 모두 합격 안정영역입니다.' : `가장 약한 영역은 ${CIRCLE_LABELS[scores.weakest].title}입니다.`
      }`
    : '아직 학습 데이터가 없습니다.';

  return (
    <div className="circles">
      <svg className="circles__svg" viewBox="0 0 200 200" role="img" aria-label={label}>
        {scores.stable ? (
          <circle cx="100" cy="105" r="20" fill="var(--ok)" opacity="0.22" />
        ) : null}
        {order.map((key) => (
          <circle
            key={key}
            cx={centers[key].x}
            cy={centers[key].y}
            r={radius(scores[key])}
            fill={CIRCLE_COLOR[key]}
            fillOpacity={0.16}
            stroke={CIRCLE_COLOR[key]}
            strokeWidth={1.6}
          />
        ))}
        <text
          x="100"
          y="103"
          textAnchor="middle"
          fontSize="16"
          fontWeight="700"
          fill="var(--text)"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {scores.hasData ? Math.round(scores.overlap) : '—'}
        </text>
        <text x="100" y="116" textAnchor="middle" fontSize="7.5" fill="var(--text-muted)">
          {scores.stable ? '합격 안정영역' : '안정영역 미달'}
        </text>
        <text x="100" y="20" textAnchor="middle" fontSize="8" fill="var(--text-faint)">
          개념 이해
        </text>
        <text x="24" y="186" textAnchor="middle" fontSize="8" fill="var(--text-faint)">
          장기 기억
        </text>
        <text x="176" y="186" textAnchor="middle" fontSize="8" fill="var(--text-faint)">
          실전 대응
        </text>
      </svg>

      <div className="circles__legend">
        {order.map((key) => (
          <div className="circle-legend" key={key}>
            <span className="circle-legend__swatch" style={{ background: CIRCLE_COLOR[key] }} aria-hidden />
            <span>
              <span style={{ fontWeight: 600 }}>{CIRCLE_LABELS[key].title}</span>
              <br />
              <span className="tiny muted">{CIRCLE_LABELS[key].hint}</span>
            </span>
            <span className="circle-legend__score">
              {scores.hasData ? Math.round(scores[key]) : '—'}
              {scores.hasData && scores[key] < STABLE_THRESHOLD ? (
                <span className="tiny" style={{ color: 'var(--bad)', marginLeft: 4 }}>
                  미달
                </span>
              ) : null}
            </span>
          </div>
        ))}
        <p className="tiny muted">
          세 영역이 모두 {STABLE_THRESHOLD}점 이상일 때만 합격 안정영역으로 판정합니다. 이 그림은 방향만
          알려줍니다 — 구체적인 취약 단원은 아래 Topic Heatmap에서 확인하세요.
        </p>
      </div>
    </div>
  );
}
