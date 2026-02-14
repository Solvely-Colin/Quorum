/**
 * Summary Card generation for GitHub PR checks, Slack, and other surfaces.
 * Produces compact (≤500 char) and detailed cards from deliberation results.
 */

import type { Synthesis } from './types.js';
import type { VoteResult } from './council-v2.js';

// --- Types ---

export type CardVerdict = 'pass' | 'warn' | 'fail';
export type CardFormat = 'markdown' | 'json' | 'html';

export interface SummaryCardInput {
  synthesis: Synthesis;
  votes: VoteResult;
  duration: number;
  sessionId: string;
  providers: string[];
  /** Confidence threshold below which verdict is 'fail' */
  confidenceThreshold?: number;
  /** Drill-down link to full session (placeholder OK) */
  sessionUrl?: string;
}

export interface SummaryCardData {
  verdict: CardVerdict;
  verdictEmoji: string;
  confidence: number;
  consensus: number;
  topFinding: string;
  dissent: string | null;
  providerBreakdown: ProviderBreakdownEntry[];
  duration: number;
  sessionId: string;
  sessionUrl: string;
}

export interface ProviderBreakdownEntry {
  provider: string;
  score: number;
  isWinner: boolean;
}

// --- Verdict logic ---

const VERDICT_EMOJI: Record<CardVerdict, string> = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
};

export function computeVerdict(
  confidence: number,
  consensus: number,
  threshold: number,
): CardVerdict {
  if (confidence < threshold) return 'fail';
  if (consensus < 0.5 || confidence < 0.6) return 'warn';
  return 'pass';
}

// --- Extract top finding ---

function extractTopFinding(content: string): string {
  // Strip markdown headings, take first meaningful sentence
  const cleaned = content
    .replace(/^#{1,3}\s.*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 10);
  const first = sentences[0] ?? cleaned.slice(0, 150);
  return first.length > 150 ? first.slice(0, 147) + '...' : first;
}

// --- Build card data ---

export function buildCardData(input: SummaryCardInput): SummaryCardData {
  const threshold = input.confidenceThreshold ?? 0;
  const verdict = computeVerdict(
    input.synthesis.confidenceScore,
    input.synthesis.consensusScore,
    threshold,
  );

  const providerBreakdown: ProviderBreakdownEntry[] = input.votes.rankings.map((r) => ({
    provider: r.provider,
    score: r.score,
    isWinner: r.provider === input.votes.winner,
  }));

  const dissent =
    input.synthesis.minorityReport &&
    input.synthesis.minorityReport !== 'None' &&
    input.synthesis.minorityReport.trim()
      ? input.synthesis.minorityReport.trim()
      : null;

  return {
    verdict,
    verdictEmoji: VERDICT_EMOJI[verdict],
    confidence: input.synthesis.confidenceScore,
    consensus: input.synthesis.consensusScore,
    topFinding: extractTopFinding(input.synthesis.content),
    dissent,
    providerBreakdown,
    duration: input.duration,
    sessionId: input.sessionId,
    sessionUrl: input.sessionUrl ?? `#session-${input.sessionId}`,
  };
}

// --- Compact card (≤500 chars) ---

export function renderCompactMarkdown(data: SummaryCardData): string {
  const lines: string[] = [];
  lines.push(`${data.verdictEmoji} **Quorum: ${data.verdict.toUpperCase()}**`);
  lines.push(
    `Confidence: ${(data.confidence * 100).toFixed(0)}% | Consensus: ${(data.consensus * 100).toFixed(0)}%`,
  );
  lines.push('');
  lines.push(`> ${data.topFinding}`);
  if (data.dissent) {
    const shortDissent =
      data.dissent.length > 80 ? data.dissent.slice(0, 77) + '...' : data.dissent;
    lines.push(`\n⚖️ Dissent: ${shortDissent}`);
  }
  const providers = data.providerBreakdown
    .map((p) => `${p.provider}${p.isWinner ? '👑' : ''}`)
    .join(', ');
  lines.push(`\nProviders: ${providers}`);
  lines.push(`[Full details](${data.sessionUrl})`);

  let result = lines.join('\n');
  // Enforce 500 char budget
  if (result.length > 500) {
    result = result.slice(0, 497) + '...';
  }
  return result;
}

// --- Detailed card (no limit) ---

export function renderDetailedMarkdown(data: SummaryCardData): string {
  const lines: string[] = [];
  lines.push(`## ${data.verdictEmoji} Quorum Verdict: ${data.verdict.toUpperCase()}\n`);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Confidence | ${(data.confidence * 100).toFixed(1)}% |`);
  lines.push(`| Consensus | ${(data.consensus * 100).toFixed(1)}% |`);
  lines.push(`| Duration | ${(data.duration / 1000).toFixed(1)}s |`);
  lines.push(`| Session | \`${data.sessionId}\` |`);
  lines.push('');
  lines.push(`### Top Finding\n`);
  lines.push(`> ${data.topFinding}\n`);

  if (data.dissent) {
    lines.push(`### ⚖️ Dissent\n`);
    lines.push(`${data.dissent}\n`);
  }

  lines.push(`### Provider Breakdown\n`);
  lines.push(`| Provider | Score | Role |`);
  lines.push(`|----------|-------|------|`);
  for (const p of data.providerBreakdown) {
    lines.push(`| ${p.provider} | ${p.score} | ${p.isWinner ? '👑 Winner' : ''} |`);
  }
  lines.push('');
  lines.push(`[🔍 Full session details](${data.sessionUrl})`);

  return lines.join('\n');
}

// --- JSON format ---

export function renderJson(data: SummaryCardData): string {
  return JSON.stringify(data, null, 2);
}

// --- HTML format ---

export function renderHtml(data: SummaryCardData): string {
  const providerRows = data.providerBreakdown
    .map(
      (p) =>
        `<tr><td>${p.provider}</td><td>${p.score}</td><td>${p.isWinner ? '👑 Winner' : ''}</td></tr>`,
    )
    .join('\n      ');

  return `<div class="quorum-card">
  <h3>${data.verdictEmoji} Quorum: ${data.verdict.toUpperCase()}</h3>
  <p>Confidence: ${(data.confidence * 100).toFixed(0)}% | Consensus: ${(data.consensus * 100).toFixed(0)}%</p>
  <blockquote>${data.topFinding}</blockquote>
  ${data.dissent ? `<p><strong>⚖️ Dissent:</strong> ${data.dissent}</p>` : ''}
  <table>
    <tr><th>Provider</th><th>Score</th><th>Role</th></tr>
    ${providerRows}
  </table>
  <a href="${data.sessionUrl}">Full details</a>
</div>`;
}

// --- GitHub Actions annotations ---

export function renderGitHubAnnotations(data: SummaryCardData): string {
  const lines: string[] = [];
  const summary = `Quorum ${data.verdict.toUpperCase()}: Confidence ${(data.confidence * 100).toFixed(0)}%, Consensus ${(data.consensus * 100).toFixed(0)}%`;

  if (data.verdict === 'fail') {
    lines.push(`::error title=Quorum Review Failed::${summary}. ${data.topFinding}`);
  } else if (data.verdict === 'warn') {
    lines.push(`::warning title=Quorum Review Warning::${summary}. ${data.topFinding}`);
  } else {
    lines.push(`::notice title=Quorum Review Passed::${summary}. ${data.topFinding}`);
  }

  if (data.dissent) {
    const shortDissent =
      data.dissent.length > 200 ? data.dissent.slice(0, 197) + '...' : data.dissent;
    lines.push(`::warning title=Quorum Dissent::${shortDissent}`);
  }

  return lines.join('\n');
}

// --- Main render function ---

export function renderCard(
  data: SummaryCardData,
  format: CardFormat,
  detailed: boolean = false,
): string {
  switch (format) {
    case 'json':
      return renderJson(data);
    case 'html':
      return renderHtml(data);
    case 'markdown':
    default:
      return detailed ? renderDetailedMarkdown(data) : renderCompactMarkdown(data);
  }
}

// --- Convenience: from deliberation result directly ---

export function generateSummaryCard(
  input: SummaryCardInput,
  format: CardFormat = 'markdown',
  detailed: boolean = false,
): string {
  const data = buildCardData(input);
  return renderCard(data, format, detailed);
}

export function generateAnnotations(input: SummaryCardInput): string {
  const data = buildCardData(input);
  return renderGitHubAnnotations(data);
}
