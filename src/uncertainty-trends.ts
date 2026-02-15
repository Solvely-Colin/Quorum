/**
 * @experimental
 * Uncertainty Trend Tracking — track uncertainty scores over time by question hash.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { UncertaintyMetrics } from './uncertainty.js';

export interface UncertaintyLedgerEntry {
  questionHash: string;
  questionPreview: string;
  timestamp: number;
  sessionId: string;
  metrics: UncertaintyMetrics;
}

export interface UncertaintyLedger {
  version: 1;
  entries: UncertaintyLedgerEntry[];
}

export interface UncertaintyTrend {
  questionHash: string;
  questionPreview: string;
  entries: Array<{
    timestamp: number;
    sessionId: string;
    overallUncertainty: string;
    disagreementScore: number;
    positionDrift: number;
  }>;
  trend: 'improving' | 'worsening' | 'stable' | 'insufficient-data';
}

/**
 * Compute a hash for a question to group similar deliberations.
 */
export function hashQuestion(question: string): string {
  const normalized = question.toLowerCase().trim().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Get the ledger file path.
 */
export function getLedgerPath(): string {
  return join(homedir(), '.quorum', 'uncertainty-ledger.json');
}

/**
 * Load the uncertainty ledger.
 */
export async function loadLedger(): Promise<UncertaintyLedger> {
  const path = getLedgerPath();
  if (!existsSync(path)) {
    return { version: 1, entries: [] };
  }
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    return { version: 1, entries: [] };
  }
}

/**
 * Save the uncertainty ledger.
 */
export async function saveLedger(ledger: UncertaintyLedger): Promise<void> {
  const dir = join(homedir(), '.quorum');
  await mkdir(dir, { recursive: true });
  await writeFile(getLedgerPath(), JSON.stringify(ledger, null, 2), 'utf-8');
}

/**
 * Append an uncertainty entry to the ledger.
 */
export async function appendToLedger(
  question: string,
  sessionId: string,
  metrics: UncertaintyMetrics,
): Promise<void> {
  const ledger = await loadLedger();
  ledger.entries.push({
    questionHash: hashQuestion(question),
    questionPreview: question.slice(0, 100),
    timestamp: Date.now(),
    sessionId,
    metrics,
  });
  await saveLedger(ledger);
}

/**
 * Compute trends from the ledger, grouped by question hash.
 */
export function computeTrends(ledger: UncertaintyLedger): UncertaintyTrend[] {
  const grouped = new Map<string, UncertaintyLedgerEntry[]>();

  for (const entry of ledger.entries) {
    const existing = grouped.get(entry.questionHash) ?? [];
    existing.push(entry);
    grouped.set(entry.questionHash, existing);
  }

  const trends: UncertaintyTrend[] = [];

  for (const [hash, entries] of grouped) {
    const sorted = entries.sort((a, b) => a.timestamp - b.timestamp);
    const preview = sorted[0].questionPreview;

    const trendEntries = sorted.map((e) => ({
      timestamp: e.timestamp,
      sessionId: e.sessionId,
      overallUncertainty: e.metrics.overallUncertainty,
      disagreementScore: e.metrics.disagreementScore,
      positionDrift: e.metrics.positionDrift,
    }));

    let trend: UncertaintyTrend['trend'] = 'insufficient-data';
    if (sorted.length >= 2) {
      const uncertaintyValues = sorted.map((e) => {
        const val = e.metrics.overallUncertainty;
        return val === 'low' ? 0 : val === 'medium' ? 1 : 2;
      });
      const first = uncertaintyValues[0];
      const last = uncertaintyValues[uncertaintyValues.length - 1];
      if (last < first) trend = 'improving';
      else if (last > first) trend = 'worsening';
      else trend = 'stable';
    }

    trends.push({ questionHash: hash, questionPreview: preview, entries: trendEntries, trend });
  }

  return trends.sort((a, b) => {
    const aLast = a.entries[a.entries.length - 1]?.timestamp ?? 0;
    const bLast = b.entries[b.entries.length - 1]?.timestamp ?? 0;
    return bLast - aLast;
  });
}

/**
 * Format trends for terminal display.
 */
export function formatTrends(trends: UncertaintyTrend[]): string {
  if (trends.length === 0) {
    return 'No uncertainty data recorded yet.';
  }

  const lines: string[] = ['Uncertainty Trends', ''];

  for (const t of trends) {
    const trendIcon =
      t.trend === 'improving'
        ? '📉'
        : t.trend === 'worsening'
          ? '📈'
          : t.trend === 'stable'
            ? '➡️'
            : '❓';

    lines.push(`${trendIcon} ${t.questionPreview}`);
    lines.push(`   Hash: ${t.questionHash} | Trend: ${t.trend} | ${t.entries.length} session(s)`);

    for (const e of t.entries) {
      const date = new Date(e.timestamp).toLocaleDateString();
      const icon =
        e.overallUncertainty === 'low' ? '🟢' : e.overallUncertainty === 'medium' ? '🟡' : '🔴';
      lines.push(
        `     ${date} ${icon} ${e.overallUncertainty} (disagreement: ${(e.disagreementScore * 100).toFixed(0)}%, drift: ${(e.positionDrift * 100).toFixed(0)}%)`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
