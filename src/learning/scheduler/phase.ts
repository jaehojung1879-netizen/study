/**
 * D-Day driven strategy shift (§22).
 *
 * Thresholds live in `exam.json` (`config.phases`) — never in code — so a
 * different exam can use a different ramp.
 */
import type { ExamConfig, SelectionMix, StudyPhase } from '../../exam/types';
import { daysUntilExam } from '../utils/date';

export function currentPhase(config: ExamConfig, now: number = Date.now()): StudyPhase {
  const daysLeft = daysUntilExam(config.examDate, now);
  const ordered = [...config.phases].sort((a, b) => b.minDaysLeft - a.minDaysLeft);
  const match = ordered.find((p) => daysLeft >= p.minDaysLeft);
  return match ?? ordered[ordered.length - 1];
}

/** Base mix with the active phase's overrides applied, renormalised to sum to 1. */
export function effectiveMix(config: ExamConfig, phase: StudyPhase): SelectionMix {
  const merged: SelectionMix = { ...config.selectionMix, ...(phase.mixOverrides ?? {}) };
  const total = Object.values(merged).reduce((sum, v) => sum + Math.max(0, v), 0);
  if (total <= 0) return { ...config.selectionMix };
  return {
    weakness: Math.max(0, merged.weakness) / total,
    dueReview: Math.max(0, merged.dueReview) / total,
    coverage: Math.max(0, merged.coverage) / total,
    recentWrong: Math.max(0, merged.recentWrong) / total,
    fresh: Math.max(0, merged.fresh) / total,
  };
}

export interface PhaseInfo {
  phase: StudyPhase;
  daysLeft: number;
  mix: SelectionMix;
}

export function phaseInfo(config: ExamConfig, now: number = Date.now()): PhaseInfo {
  const phase = currentPhase(config, now);
  return { phase, daysLeft: daysUntilExam(config.examDate, now), mix: effectiveMix(config, phase) };
}
