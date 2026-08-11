import type { ReactNode } from 'react';
import type { Question, SourceType } from '../exam/types';
import { masteryBandLabel, masteryBand, type MasteryBand } from '../learning/mastery/masteryScore';

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'ok' | 'bad' | 'warn';
}): JSX.Element {
  const color = tone === 'ok' ? 'var(--ok)' : tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : undefined;
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={color ? { color } : undefined}>
        {value}
      </div>
      {hint ? <div className="stat__hint">{hint}</div> : null}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }): JSX.Element {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label ?? '진행률'}
    >
      <div className="progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SectionTitle({ title, aside }: { title: ReactNode; aside?: ReactNode }): JSX.Element {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {aside ? <div className="small muted">{aside}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <div className="empty">{children}</div>;
}

export const BAND_COLOR: Record<MasteryBand, string> = {
  critical: 'var(--band-critical)',
  weak: 'var(--band-weak)',
  fair: 'var(--band-fair)',
  stable: 'var(--band-stable)',
  mastered: 'var(--band-mastered)',
};

export function bandColor(score: number, hasData = true): string {
  if (!hasData) return 'var(--band-empty)';
  return BAND_COLOR[masteryBand(score)];
}

export function MasteryPill({ score, hasData }: { score: number; hasData: boolean }): JSX.Element {
  if (!hasData) return <span className="badge">미학습</span>;
  return (
    <span className="badge" style={{ color: bandColor(score), borderColor: bandColor(score) }}>
      {Math.round(score)} · {masteryBandLabel(score)}
    </span>
  );
}

const SOURCE_LABEL: Record<SourceType, { text: string; tone: string }> = {
  official_past_exam: { text: '기출', tone: 'badge--accent' },
  adapted_past_exam: { text: '기출 변형', tone: 'badge--accent' },
  generated: { text: 'AI 생성', tone: '' },
  generated_current_affairs: { text: 'AI 생성 · 최신개정', tone: 'badge--warn' },
};

/**
 * Source provenance is never implied — an unverified item can never render as
 * 기출 (§14). Verified official items additionally show the round/number.
 */
export function SourceBadge({ question }: { question: Question }): JSX.Element {
  const meta = SOURCE_LABEL[question.sourceType] ?? SOURCE_LABEL.generated;
  const official = question.sourceType === 'official_past_exam' || question.sourceType === 'adapted_past_exam';
  const badgeText =
    question.sourceExamYear && question.sourceType === 'official_past_exam'
      ? `${question.sourceExamYear}년 기출`
      : question.sourceExamYear && question.sourceType === 'adapted_past_exam'
        ? `${question.sourceExamYear}년 기출 변형`
        : meta.text;
  const detail =
    official && question.sourceExamRound
      ? `제${question.sourceExamRound}회${question.sourceQuestionNumber ? ` Q${question.sourceQuestionNumber}` : ''}`
      : null;
  return (
    <>
      <span className={`badge ${meta.tone}`}>{meta.text}</span>
      {detail ? <span className="badge">{detail}</span> : null}
      {question.verified ? <span className="badge badge--ok">검증됨</span> : null}
      {question.needsReview ? <span className="badge badge--bad">검토 필요</span> : null}
    </>
  );
}

export const DIFFICULTY_LABEL: Record<number, string> = {
  1: '매우 쉬움',
  2: '쉬움',
  3: '보통',
  4: '어려움',
  5: '매우 어려움',
};

export const QUESTION_TYPE_LABEL: Record<string, string> = {
  concept: '개념형',
  case: '사례형',
  calculation: '계산형',
  precedent: '판례형',
  statute: '법조문형',
  count: '개수형',
};

export function Banner({
  tone = 'accent',
  children,
}: {
  tone?: 'accent' | 'warn' | 'bad';
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={`banner banner--${tone}`} role="note">
      {children}
    </div>
  );
}

export function CHOICE_MARK(index: number): string {
  return ['①', '②', '③', '④', '⑤', '⑥'][index] ?? String(index + 1);
}
