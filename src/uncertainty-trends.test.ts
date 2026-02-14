import { describe, it, expect } from 'vitest';
import {
  hashQuestion,
  computeTrends,
  formatTrends,
  type UncertaintyLedger,
  type UncertaintyLedgerEntry as _UncertaintyLedgerEntry,
} from './uncertainty-trends.js';
import type { UncertaintyMetrics } from './uncertainty.js';

describe('uncertainty-trends', () => {
  const makeMetrics = (
    level: 'low' | 'medium' | 'high',
    disagreement = 0.1,
  ): UncertaintyMetrics => ({
    disagreementScore: disagreement,
    positionDrift: 0.05,
    evidenceConflictCount: 0,
    noveltyFlag: false,
    overallUncertainty: level,
    summary: 'test',
  });

  describe('hashQuestion', () => {
    it('produces consistent hashes', () => {
      expect(hashQuestion('What is AI?')).toBe(hashQuestion('What is AI?'));
    });

    it('normalizes whitespace', () => {
      expect(hashQuestion('What  is   AI?')).toBe(hashQuestion('What is AI?'));
    });

    it('is case-insensitive', () => {
      expect(hashQuestion('What is AI?')).toBe(hashQuestion('what is ai?'));
    });

    it('produces different hashes for different questions', () => {
      expect(hashQuestion('question A')).not.toBe(hashQuestion('question B'));
    });
  });

  describe('computeTrends', () => {
    it('groups entries by question hash', () => {
      const ledger: UncertaintyLedger = {
        version: 1,
        entries: [
          {
            questionHash: 'aaa',
            questionPreview: 'Q1',
            timestamp: 1000,
            sessionId: 's1',
            metrics: makeMetrics('high'),
          },
          {
            questionHash: 'aaa',
            questionPreview: 'Q1',
            timestamp: 2000,
            sessionId: 's2',
            metrics: makeMetrics('low'),
          },
          {
            questionHash: 'bbb',
            questionPreview: 'Q2',
            timestamp: 3000,
            sessionId: 's3',
            metrics: makeMetrics('medium'),
          },
        ],
      };

      const trends = computeTrends(ledger);
      expect(trends).toHaveLength(2);
    });

    it('detects improving trend', () => {
      const ledger: UncertaintyLedger = {
        version: 1,
        entries: [
          {
            questionHash: 'aaa',
            questionPreview: 'Q1',
            timestamp: 1000,
            sessionId: 's1',
            metrics: makeMetrics('high'),
          },
          {
            questionHash: 'aaa',
            questionPreview: 'Q1',
            timestamp: 2000,
            sessionId: 's2',
            metrics: makeMetrics('low'),
          },
        ],
      };

      const trends = computeTrends(ledger);
      expect(trends[0].trend).toBe('improving');
    });

    it('detects worsening trend', () => {
      const ledger: UncertaintyLedger = {
        version: 1,
        entries: [
          {
            questionHash: 'aaa',
            questionPreview: 'Q1',
            timestamp: 1000,
            sessionId: 's1',
            metrics: makeMetrics('low'),
          },
          {
            questionHash: 'aaa',
            questionPreview: 'Q1',
            timestamp: 2000,
            sessionId: 's2',
            metrics: makeMetrics('high'),
          },
        ],
      };

      const trends = computeTrends(ledger);
      expect(trends[0].trend).toBe('worsening');
    });

    it('detects stable trend', () => {
      const ledger: UncertaintyLedger = {
        version: 1,
        entries: [
          {
            questionHash: 'aaa',
            questionPreview: 'Q1',
            timestamp: 1000,
            sessionId: 's1',
            metrics: makeMetrics('medium'),
          },
          {
            questionHash: 'aaa',
            questionPreview: 'Q1',
            timestamp: 2000,
            sessionId: 's2',
            metrics: makeMetrics('medium'),
          },
        ],
      };

      const trends = computeTrends(ledger);
      expect(trends[0].trend).toBe('stable');
    });

    it('returns insufficient-data for single entry', () => {
      const ledger: UncertaintyLedger = {
        version: 1,
        entries: [
          {
            questionHash: 'aaa',
            questionPreview: 'Q1',
            timestamp: 1000,
            sessionId: 's1',
            metrics: makeMetrics('low'),
          },
        ],
      };

      const trends = computeTrends(ledger);
      expect(trends[0].trend).toBe('insufficient-data');
    });

    it('returns empty for empty ledger', () => {
      expect(computeTrends({ version: 1, entries: [] })).toHaveLength(0);
    });
  });

  describe('formatTrends', () => {
    it('formats empty state', () => {
      expect(formatTrends([])).toContain('No uncertainty data');
    });

    it('formats trends with icons', () => {
      const trends = computeTrends({
        version: 1,
        entries: [
          {
            questionHash: 'aaa',
            questionPreview: 'Test Q',
            timestamp: 1000,
            sessionId: 's1',
            metrics: makeMetrics('high', 0.8),
          },
          {
            questionHash: 'aaa',
            questionPreview: 'Test Q',
            timestamp: 2000,
            sessionId: 's2',
            metrics: makeMetrics('low', 0.1),
          },
        ],
      });

      const text = formatTrends(trends);
      expect(text).toContain('Test Q');
      expect(text).toContain('improving');
    });
  });
});
