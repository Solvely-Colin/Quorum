import { describe, it, expect } from 'vitest';
import {
  computeCalibrationStats,
  formatCalibrationStats,
  type CalibrationStore,
  type CalibrationEntry,
} from './calibration.js';

function makeEntry(
  overrides: Partial<CalibrationEntry> & {
    prediction?: Partial<CalibrationEntry['prediction']>;
  } = {},
): CalibrationEntry {
  return {
    id: `cal-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    sessionId: `session-${Math.random().toString(36).slice(2)}`,
    prediction: {
      tier: 'medium',
      consensus: 0.7,
      confidence: 0.6,
      dissentSeverity: 0.3,
      providerAgreement: 0.7,
      ...overrides.prediction,
    },
    outcome: overrides.outcome,
  };
}

describe('computeCalibrationStats', () => {
  it('handles empty store', () => {
    const store: CalibrationStore = { version: 1, entries: [] };
    const stats = computeCalibrationStats(store);
    expect(stats.totalPredictions).toBe(0);
    expect(stats.withOutcomes).toBe(0);
    expect(stats.tierAccuracy).toBe(0);
    expect(stats.acceptanceRate).toBe(0);
  });

  it('counts predictions without outcomes', () => {
    const store: CalibrationStore = {
      version: 1,
      entries: [makeEntry(), makeEntry(), makeEntry()],
    };
    const stats = computeCalibrationStats(store);
    expect(stats.totalPredictions).toBe(3);
    expect(stats.withOutcomes).toBe(0);
  });

  it('computes tier accuracy correctly', () => {
    const store: CalibrationStore = {
      version: 1,
      entries: [
        makeEntry({
          outcome: { accepted: true, tierAccurate: true, recordedAt: new Date().toISOString() },
        }),
        makeEntry({
          outcome: { accepted: true, tierAccurate: false, recordedAt: new Date().toISOString() },
        }),
        makeEntry({
          outcome: { accepted: false, tierAccurate: true, recordedAt: new Date().toISOString() },
        }),
      ],
    };
    const stats = computeCalibrationStats(store);
    expect(stats.withOutcomes).toBe(3);
    expect(stats.tierAccuracy).toBeCloseTo(2 / 3);
    expect(stats.acceptanceRate).toBeCloseTo(2 / 3);
  });

  it('tracks by-tier stats', () => {
    const store: CalibrationStore = {
      version: 1,
      entries: [
        makeEntry({
          prediction: {
            tier: 'low',
            consensus: 0.9,
            confidence: 0.9,
            dissentSeverity: 0.1,
            providerAgreement: 0.9,
          },
          outcome: { accepted: true, tierAccurate: true, recordedAt: new Date().toISOString() },
        }),
        makeEntry({
          prediction: {
            tier: 'critical',
            consensus: 0.1,
            confidence: 0.1,
            dissentSeverity: 0.9,
            providerAgreement: 0.1,
          },
          outcome: { accepted: false, tierAccurate: true, recordedAt: new Date().toISOString() },
        }),
      ],
    };
    const stats = computeCalibrationStats(store);
    expect(stats.byTier.low.count).toBe(1);
    expect(stats.byTier.low.accepted).toBe(1);
    expect(stats.byTier.critical.count).toBe(1);
    expect(stats.byTier.critical.accepted).toBe(0);
  });

  it('computes confidence calibration buckets', () => {
    const store: CalibrationStore = {
      version: 1,
      entries: [
        makeEntry({
          prediction: {
            tier: 'low',
            consensus: 0.9,
            confidence: 0.9,
            dissentSeverity: 0.1,
            providerAgreement: 0.9,
          },
        }),
        makeEntry({
          prediction: {
            tier: 'medium',
            consensus: 0.5,
            confidence: 0.5,
            dissentSeverity: 0.3,
            providerAgreement: 0.7,
          },
        }),
      ],
    };
    const stats = computeCalibrationStats(store);
    const highBucket = stats.confidenceCalibration.find((b) => b.bucket === '80-100%');
    expect(highBucket?.predictions).toBe(1);
    const midBucket = stats.confidenceCalibration.find((b) => b.bucket === '40-60%');
    expect(midBucket?.predictions).toBe(1);
  });
});

describe('formatCalibrationStats', () => {
  it('formats stats as readable string', () => {
    const store: CalibrationStore = {
      version: 1,
      entries: [
        makeEntry({
          prediction: {
            tier: 'low',
            consensus: 0.9,
            confidence: 0.9,
            dissentSeverity: 0.1,
            providerAgreement: 0.9,
          },
          outcome: { accepted: true, tierAccurate: true, recordedAt: new Date().toISOString() },
        }),
      ],
    };
    const stats = computeCalibrationStats(store);
    const formatted = formatCalibrationStats(stats);
    expect(formatted).toContain('📊 Calibration Stats');
    expect(formatted).toContain('Total predictions: 1');
    expect(formatted).toContain('🟢');
  });
});
