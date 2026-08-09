/** Minimal dependency-free SVG line chart for score trends (§21). */

export interface Series {
  id: string;
  label: string;
  color: string;
  values: number[];
}

export interface LineChartProps {
  series: Series[];
  /** Optional horizontal reference line, e.g. the pass mark. */
  threshold?: { value: number; label: string };
  max?: number;
  height?: number;
  xLabels?: string[];
}

export function LineChart({
  series,
  threshold,
  max = 100,
  height = 160,
  xLabels,
}: LineChartProps): JSX.Element {
  const width = 320;
  const pad = { top: 10, right: 8, bottom: 20, left: 26 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const count = Math.max(...series.map((s) => s.values.length), 0);

  const x = (i: number): number => (count <= 1 ? pad.left + plotW / 2 : pad.left + (i / (count - 1)) * plotW);
  const y = (v: number): number => pad.top + plotH - (Math.max(0, Math.min(max, v)) / max) * plotH;

  const gridLines = [0, 25, 50, 75, 100].filter((v) => v <= max);

  const summary = series
    .map((s) => `${s.label}: ${s.values.map((v) => Math.round(v)).join(', ')}`)
    .join(' / ');

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`점수 추이 — ${summary || '데이터 없음'}`}
    >
      {gridLines.map((v) => (
        <g key={v}>
          <line className="chart__grid" x1={pad.left} y1={y(v)} x2={width - pad.right} y2={y(v)} />
          <text className="chart__axis-label" x={pad.left - 4} y={y(v) + 3} textAnchor="end">
            {v}
          </text>
        </g>
      ))}

      {threshold ? (
        <g>
          <line
            className="chart__threshold"
            x1={pad.left}
            y1={y(threshold.value)}
            x2={width - pad.right}
            y2={y(threshold.value)}
          />
          <text
            className="chart__axis-label"
            x={width - pad.right}
            y={y(threshold.value) - 3}
            textAnchor="end"
          >
            {threshold.label}
          </text>
        </g>
      ) : null}

      {series.map((s) => {
        if (s.values.length === 0) return null;
        const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
        return (
          <g key={s.id}>
            <path className="chart__line" d={d} stroke={s.color} />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={2.8} fill={s.color} />
            ))}
          </g>
        );
      })}

      {(xLabels ?? []).map((label, i) => (
        <text key={i} className="chart__axis-label" x={x(i)} y={height - 6} textAnchor="middle">
          {label}
        </text>
      ))}
    </svg>
  );
}

export function ChartLegend({ series }: { series: Series[] }): JSX.Element {
  return (
    <div className="row small" style={{ gap: 12 }}>
      {series.map((s) => (
        <span key={s.id} className="row" style={{ gap: 5 }}>
          <span
            style={{ width: 10, height: 3, borderRadius: 2, background: s.color, display: 'inline-block' }}
            aria-hidden
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}
