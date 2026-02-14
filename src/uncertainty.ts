/**
 * Calibrated Uncertainty Signaling — compute uncertainty metrics after voting.
 */

import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface UncertaintyMetrics {
  /** Vote spread / disagreement score (0 = unanimous, 1 = max disagreement) */
  disagreementScore: number;
  /** Position drift from FORMULATE → ADJUST (0 = no change, 1 = complete reversal) */
  positionDrift: number;
  /** Number of conflicting evidence claims across providers */
  evidenceConflictCount: number;
  /** Is this question unlike prior sessions? */
  noveltyFlag: boolean;
  /** Overall uncertainty level */
  overallUncertainty: 'low' | 'medium' | 'high';
  /** Human-readable summary */
  summary: string;
}

/**
 * Compute vote disagreement score from rankings.
 * 0 = all voters agree, 1 = maximum disagreement.
 */
export function computeDisagreement(
  rankings: Array<{ provider: string; score: number }>,
): number {
  if (rankings.length < 2) return 0;

  const scores = rankings.map((r) => r.score);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  if (max === 0) return 0;

  // Normalized spread
  const _range = max - min;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

  // Coefficient of variation (normalized)
  const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : 0;

  // Scale to 0-1 range (cv of 1+ means very high disagreement)
  return Math.min(1, cv);
}

/**
 * Compute position drift between two sets of responses (e.g., formulate → adjust).
 * Uses simple Jaccard-like distance on word sets.
 */
export function computePositionDrift(
  before: Record<string, string>,
  after: Record<string, string>,
): number {
  const providers = Object.keys(before).filter((k) => k in after);
  if (providers.length === 0) return 0;

  let totalDrift = 0;

  for (const provider of providers) {
    const wordsBefore = new Set(before[provider].toLowerCase().split(/\s+/).filter(Boolean));
    const wordsAfter = new Set(after[provider].toLowerCase().split(/\s+/).filter(Boolean));

    const intersection = new Set([...wordsBefore].filter((w) => wordsAfter.has(w)));
    const union = new Set([...wordsBefore, ...wordsAfter]);

    const jaccard = union.size > 0 ? intersection.size / union.size : 1;
    totalDrift += 1 - jaccard; // 0 = identical, 1 = completely different
  }

  return totalDrift / providers.length;
}

/**
 * Count evidence conflicts from cross-reference data.
 */
export function countEvidenceConflicts(
  crossRefs?: Array<{ contradicted?: boolean }>,
): number {
  if (!crossRefs) return 0;
  return crossRefs.filter((cr) => cr.contradicted).length;
}

/**
 * Detect novelty by checking if the question has significant overlap with prior sessions.
 */
export function detectNovelty(
  input: string,
  priorInputs: string[],
  threshold: number = 0.3,
): boolean {
  if (priorInputs.length === 0) return true;

  const inputWords = new Set(input.toLowerCase().split(/\s+/).filter(Boolean));

  for (const prior of priorInputs) {
    const priorWords = new Set(prior.toLowerCase().split(/\s+/).filter(Boolean));
    const intersection = new Set([...inputWords].filter((w) => priorWords.has(w)));
    const union = new Set([...inputWords, ...priorWords]);
    const similarity = union.size > 0 ? intersection.size / union.size : 0;
    if (similarity >= threshold) return false; // found a similar prior session
  }

  return true;
}

/**
 * Compute all uncertainty metrics for a session.
 */
export function computeUncertaintyMetrics(params: {
  rankings: Array<{ provider: string; score: number }>;
  formulateResponses?: Record<string, string>;
  adjustResponses?: Record<string, string>;
  crossRefs?: Array<{ contradicted?: boolean }>;
  input: string;
  priorInputs?: string[];
}): UncertaintyMetrics {
  const disagreement = computeDisagreement(params.rankings);

  const drift =
    params.formulateResponses && params.adjustResponses
      ? computePositionDrift(params.formulateResponses, params.adjustResponses)
      : 0;

  const conflicts = countEvidenceConflicts(params.crossRefs);
  const novelty = detectNovelty(params.input, params.priorInputs ?? []);

  // Overall uncertainty scoring
  let score = 0;
  score += disagreement * 0.4;
  score += drift * 0.25;
  score += Math.min(conflicts / 5, 1) * 0.2;
  score += novelty ? 0.15 : 0;

  const overallUncertainty: UncertaintyMetrics['overallUncertainty'] =
    score < 0.3 ? 'low' : score < 0.6 ? 'medium' : 'high';

  const parts: string[] = [];
  if (disagreement > 0.3) parts.push(`high vote disagreement (${(disagreement * 100).toFixed(0)}%)`);
  if (drift > 0.4) parts.push(`significant position drift (${(drift * 100).toFixed(0)}%)`);
  if (conflicts > 0) parts.push(`${conflicts} evidence conflict(s)`);
  if (novelty) parts.push('novel question (no similar prior sessions)');

  const summary =
    parts.length === 0
      ? 'Low uncertainty — strong consensus with stable positions.'
      : `Uncertainty factors: ${parts.join('; ')}.`;

  return {
    disagreementScore: Math.round(disagreement * 1000) / 1000,
    positionDrift: Math.round(drift * 1000) / 1000,
    evidenceConflictCount: conflicts,
    noveltyFlag: novelty,
    overallUncertainty,
    summary,
  };
}

/**
 * Save uncertainty metrics to session directory.
 */
export async function saveUncertaintyMetrics(
  sessionDir: string,
  metrics: UncertaintyMetrics,
): Promise<void> {
  await writeFile(
    join(sessionDir, 'uncertainty.json'),
    JSON.stringify(metrics, null, 2),
    'utf-8',
  );
}

/**
 * Load uncertainty metrics from session directory.
 */
export async function loadUncertaintyMetrics(
  sessionDir: string,
): Promise<UncertaintyMetrics | null> {
  const filepath = join(sessionDir, 'uncertainty.json');
  if (!existsSync(filepath)) return null;
  return JSON.parse(await readFile(filepath, 'utf-8'));
}

/**
 * Format uncertainty metrics for display in synthesis output.
 */
export function formatUncertaintyDisplay(metrics: UncertaintyMetrics): string {
  const icon =
    metrics.overallUncertainty === 'low'
      ? '🟢'
      : metrics.overallUncertainty === 'medium'
        ? '🟡'
        : '🔴';

  const lines = [
    `${icon} Uncertainty: ${metrics.overallUncertainty.toUpperCase()}`,
    `  Disagreement: ${(metrics.disagreementScore * 100).toFixed(0)}%`,
    `  Position drift: ${(metrics.positionDrift * 100).toFixed(0)}%`,
  ];
  if (metrics.evidenceConflictCount > 0) {
    lines.push(`  Evidence conflicts: ${metrics.evidenceConflictCount}`);
  }
  if (metrics.noveltyFlag) {
    lines.push(`  ⚡ Novel question — limited prior context`);
  }
  lines.push(`  ${metrics.summary}`);
  return lines.join('\n');
}
