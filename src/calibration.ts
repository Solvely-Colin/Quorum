/**
 * @experimental
 * Calibration Tracking — Feature #31
 *
 * Logs predictions (risk tier + confidence) vs. actual outcomes over time.
 * Stored in ~/.quorum/calibration.json for accuracy analysis.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { RiskTier } from './risk-tier.js';

// --- Types ---

export interface CalibrationEntry {
  id: string;
  timestamp: string;
  sessionId: string;
  prediction: {
    tier: RiskTier;
    consensus: number;
    confidence: number;
    dissentSeverity: number;
    providerAgreement: number;
  };
  outcome?: {
    /** Whether the human accepted the result as-is */
    accepted: boolean;
    /** Optional feedback: was the risk tier accurate? */
    tierAccurate: boolean;
    /** Timestamp when outcome was recorded */
    recordedAt: string;
    /** Free-form note */
    note?: string;
  };
}

export interface CalibrationStore {
  version: number;
  entries: CalibrationEntry[];
}

export interface CalibrationStats {
  totalPredictions: number;
  withOutcomes: number;
  tierAccuracy: number;
  acceptanceRate: number;
  byTier: Record<
    RiskTier,
    {
      count: number;
      withOutcomes: number;
      accurate: number;
      accepted: number;
    }
  >;
  confidenceCalibration: Array<{
    bucket: string;
    predictions: number;
    accepted: number;
    rate: number;
  }>;
}

// --- Storage ---

function calibrationPath(): string {
  return join(homedir(), '.quorum', 'calibration.json');
}

export async function loadCalibrationStore(): Promise<CalibrationStore> {
  const path = calibrationPath();
  if (!existsSync(path)) {
    return { version: 1, entries: [] };
  }
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as CalibrationStore;
  } catch {
    return { version: 1, entries: [] };
  }
}

export async function saveCalibrationStore(store: CalibrationStore): Promise<void> {
  const path = calibrationPath();
  const dir = join(homedir(), '.quorum');
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(path, JSON.stringify(store, null, 2), 'utf-8');
}

// --- Operations ---

/**
 * Record a new prediction from a deliberation.
 */
export async function recordPrediction(params: {
  sessionId: string;
  tier: RiskTier;
  consensus: number;
  confidence: number;
  dissentSeverity: number;
  providerAgreement: number;
}): Promise<CalibrationEntry> {
  const store = await loadCalibrationStore();

  const entry: CalibrationEntry = {
    id: `cal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    sessionId: params.sessionId,
    prediction: {
      tier: params.tier,
      consensus: params.consensus,
      confidence: params.confidence,
      dissentSeverity: params.dissentSeverity,
      providerAgreement: params.providerAgreement,
    },
  };

  store.entries.push(entry);
  await saveCalibrationStore(store);
  return entry;
}

/**
 * Record an outcome for a previous prediction.
 */
export async function recordOutcome(params: {
  sessionId: string;
  accepted: boolean;
  tierAccurate: boolean;
  note?: string;
}): Promise<boolean> {
  const store = await loadCalibrationStore();

  const entry = store.entries.find((e) => e.sessionId === params.sessionId);
  if (!entry) return false;

  entry.outcome = {
    accepted: params.accepted,
    tierAccurate: params.tierAccurate,
    recordedAt: new Date().toISOString(),
    note: params.note,
  };

  await saveCalibrationStore(store);
  return true;
}

/**
 * Compute calibration statistics.
 */
export function computeCalibrationStats(store: CalibrationStore): CalibrationStats {
  const tiers: RiskTier[] = ['low', 'medium', 'high', 'critical'];

  const byTier = Object.fromEntries(
    tiers.map((t) => [t, { count: 0, withOutcomes: 0, accurate: 0, accepted: 0 }]),
  ) as CalibrationStats['byTier'];

  let withOutcomes = 0;
  let tierAccurate = 0;
  let accepted = 0;

  for (const entry of store.entries) {
    const tier = entry.prediction.tier;
    byTier[tier].count++;

    if (entry.outcome) {
      withOutcomes++;
      byTier[tier].withOutcomes++;

      if (entry.outcome.tierAccurate) {
        tierAccurate++;
        byTier[tier].accurate++;
      }
      if (entry.outcome.accepted) {
        accepted++;
        byTier[tier].accepted++;
      }
    }
  }

  // Confidence calibration buckets (0-20%, 20-40%, 40-60%, 60-80%, 80-100%)
  const buckets = [
    { label: '0-20%', min: 0, max: 0.2 },
    { label: '20-40%', min: 0.2, max: 0.4 },
    { label: '40-60%', min: 0.4, max: 0.6 },
    { label: '60-80%', min: 0.6, max: 0.8 },
    { label: '80-100%', min: 0.8, max: 1.01 },
  ];

  const confidenceCalibration = buckets.map((bucket) => {
    const inBucket = store.entries.filter(
      (e) => e.prediction.confidence >= bucket.min && e.prediction.confidence < bucket.max,
    );
    const acceptedInBucket = inBucket.filter((e) => e.outcome?.accepted).length;
    return {
      bucket: bucket.label,
      predictions: inBucket.length,
      accepted: acceptedInBucket,
      rate: inBucket.length > 0 ? acceptedInBucket / inBucket.length : 0,
    };
  });

  return {
    totalPredictions: store.entries.length,
    withOutcomes,
    tierAccuracy: withOutcomes > 0 ? tierAccurate / withOutcomes : 0,
    acceptanceRate: withOutcomes > 0 ? accepted / withOutcomes : 0,
    byTier,
    confidenceCalibration,
  };
}

/**
 * Format calibration stats for display.
 */
export function formatCalibrationStats(stats: CalibrationStats): string {
  const lines: string[] = [
    '📊 Calibration Stats',
    '',
    `  Total predictions: ${stats.totalPredictions}`,
    `  With outcomes:     ${stats.withOutcomes}`,
    `  Tier accuracy:     ${(stats.tierAccuracy * 100).toFixed(1)}%`,
    `  Acceptance rate:   ${(stats.acceptanceRate * 100).toFixed(1)}%`,
    '',
    '  By Tier:',
  ];

  const tiers: RiskTier[] = ['low', 'medium', 'high', 'critical'];
  const icons: Record<RiskTier, string> = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    critical: '🔴',
  };

  for (const tier of tiers) {
    const t = stats.byTier[tier];
    if (t.count === 0) continue;
    const accuracy = t.withOutcomes > 0 ? ((t.accurate / t.withOutcomes) * 100).toFixed(0) : 'N/A';
    lines.push(
      `    ${icons[tier]} ${tier.padEnd(8)} ${t.count} predictions, ${accuracy}% accurate`,
    );
  }

  if (stats.confidenceCalibration.some((b) => b.predictions > 0)) {
    lines.push('', '  Confidence Calibration:');
    for (const bucket of stats.confidenceCalibration) {
      if (bucket.predictions === 0) continue;
      const bar = '█'.repeat(Math.round(bucket.rate * 10));
      lines.push(
        `    ${bucket.bucket.padEnd(8)} ${bar} ${(bucket.rate * 100).toFixed(0)}% (${bucket.predictions} predictions)`,
      );
    }
  }

  return lines.join('\n');
}
