/**
 * Consensus heatmap — ASCII visualization of pairwise provider agreement.
 * Uses Spearman rank correlation to measure how similarly voters ranked candidates.
 */

import type { Ballot } from './voting.js';

/**
 * Compute Spearman rank correlation between two rank arrays.
 * Returns value in [-1, 1], normalized to [0, 1] for display.
 */
function spearmanCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  if (n <= 1) return 1;

  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sumD2 += d * d;
  }

  // Spearman: 1 - (6 * sum(d^2)) / (n * (n^2 - 1))
  const rho = 1 - (6 * sumD2) / (n * (n * n - 1));

  // Normalize from [-1, 1] to [0, 1]
  return (rho + 1) / 2;
}

/**
 * Generate an ASCII consensus heatmap from ballots.
 * Each ballot represents one voter's ranking of all candidates.
 */
export function generateHeatmap(
  ballots: Ballot[],
  candidateNames: string[],
): string {
  if (ballots.length < 2) return '';

  // Build per-voter rank vectors aligned to candidateNames order
  const voterVectors: Record<string, number[]> = {};
  for (const ballot of ballots) {
    const rankMap = new Map(ballot.rankings.map(r => [r.provider, r.rank]));
    const vector: number[] = candidateNames.map(c => rankMap.get(c) ?? candidateNames.length);
    voterVectors[ballot.voter] = vector;
  }

  const voters = Object.keys(voterVectors);

  // Compute pairwise agreement matrix
  const matrix: Record<string, Record<string, number>> = {};
  let bestPair = { a: '', b: '', score: -1 };
  let worstPair = { a: '', b: '', score: 2 };

  for (const a of voters) {
    matrix[a] = {};
    for (const b of voters) {
      if (a === b) { matrix[a][b] = 1; continue; }
      const score = spearmanCorrelation(voterVectors[a], voterVectors[b]);
      matrix[a][b] = score;

      if (a < b) {
        if (score > bestPair.score) bestPair = { a, b, score };
        if (score < worstPair.score) worstPair = { a, b, score };
      }
    }
  }

  // Visual indicator
  const indicator = (score: number): string => {
    if (score > 0.8) return '███';
    if (score > 0.5) return '▓▓▓';
    if (score > 0.2) return '░░░';
    return '   ';
  };

  const maxNameLen = Math.max(...voters.map(v => v.length), 6);
  const pad = (s: string, n: number) => s.padEnd(n);
  const lines: string[] = [];

  lines.push('');
  lines.push('┌─────────────────────────────────────────┐');
  lines.push('│         CONSENSUS HEATMAP                │');
  lines.push('└─────────────────────────────────────────┘');
  lines.push('');

  // Header
  const header = pad('', maxNameLen + 2) + voters.map(v => pad(v.slice(0, 5), 5)).join(' ');
  lines.push(header);
  lines.push(pad('', maxNameLen + 2) + voters.map(() => '─────').join(' '));

  // Rows
  for (const row of voters) {
    let line = pad(row, maxNameLen) + '  ';
    for (const col of voters) {
      if (row === col) {
        line += '  ·  ';
      } else {
        line += ` ${indicator(matrix[row][col])} `;
      }
    }
    const peerScores = voters.filter(v => v !== row).map(v => matrix[row][v]);
    const avg = peerScores.length > 0
      ? (peerScores.reduce((a, b) => a + b, 0) / peerScores.length).toFixed(2)
      : '—';
    line += `  avg: ${avg}`;
    lines.push(line);
  }

  // Legend
  lines.push('');
  lines.push('Legend:  ███ high (>0.8)  ▓▓▓ moderate (0.5-0.8)  ░░░ low (0.2-0.5)  [   ] disagreement (<0.2)');

  // Summary
  if (bestPair.a) {
    lines.push('');
    lines.push(`Most aligned:   ${bestPair.a} ↔ ${bestPair.b}  (${bestPair.score.toFixed(2)})`);
  }
  if (worstPair.a) {
    lines.push(`Most divergent: ${worstPair.a} ↔ ${worstPair.b}  (${worstPair.score.toFixed(2)})`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Reconstruct ballots from a 07-vote.json phase file for retroactive heatmap.
 * The vote phase responses contain raw vote text; we re-parse rankings from them.
 * This is a simpler fallback using the details field from VoteResult.
 */
export function generateHeatmapFromDetails(
  details: Record<string, { ranks: number[]; rationale: string }>,
  providerNames: string[],
): string {
  // details[provider].ranks = ranks received by that provider from various voters
  // This is candidate-centric, not voter-centric, so we can't directly build voter vectors.
  // Instead, reconstruct from rationale text by re-parsing, or use a heuristic.
  // For retroactive use, we need the ballots. Return empty if we can't reconstruct.
  // The `quorum heatmap` command will read the raw vote phase and re-parse.
  return '';
}
