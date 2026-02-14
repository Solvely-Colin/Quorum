import { describe, it, expect } from 'vitest';
import {
  computeDisagreement,
  computePositionDrift,
  countEvidenceConflicts,
  detectNovelty,
  computeUncertaintyMetrics,
  formatUncertaintyDisplay,
} from './uncertainty.js';

describe('uncertainty', () => {
  describe('computeDisagreement', () => {
    it('returns 0 for unanimous rankings', () => {
      const rankings = [
        { provider: 'a', score: 10 },
        { provider: 'b', score: 10 },
        { provider: 'c', score: 10 },
      ];
      expect(computeDisagreement(rankings)).toBe(0);
    });

    it('returns > 0 for spread rankings', () => {
      const rankings = [
        { provider: 'a', score: 10 },
        { provider: 'b', score: 5 },
        { provider: 'c', score: 1 },
      ];
      expect(computeDisagreement(rankings)).toBeGreaterThan(0);
    });

    it('returns 0 for single provider', () => {
      expect(computeDisagreement([{ provider: 'a', score: 5 }])).toBe(0);
    });

    it('returns 0 for empty rankings', () => {
      expect(computeDisagreement([])).toBe(0);
    });
  });

  describe('computePositionDrift', () => {
    it('returns 0 for identical responses', () => {
      const responses = { a: 'hello world', b: 'foo bar' };
      expect(computePositionDrift(responses, responses)).toBe(0);
    });

    it('returns > 0 for changed responses', () => {
      const before = { a: 'hello world test' };
      const after = { a: 'completely different text here' };
      expect(computePositionDrift(before, after)).toBeGreaterThan(0);
    });

    it('returns 0 for no overlapping providers', () => {
      const before = { a: 'test' };
      const after = { b: 'test' };
      expect(computePositionDrift(before, after)).toBe(0);
    });
  });

  describe('countEvidenceConflicts', () => {
    it('counts contradicted refs', () => {
      const refs = [{ contradicted: true }, { contradicted: false }, { contradicted: true }];
      expect(countEvidenceConflicts(refs)).toBe(2);
    });

    it('returns 0 for undefined', () => {
      expect(countEvidenceConflicts(undefined)).toBe(0);
    });
  });

  describe('detectNovelty', () => {
    it('returns true for novel question', () => {
      expect(detectNovelty('quantum computing risks', ['cooking recipes', 'gardening tips'])).toBe(
        true,
      );
    });

    it('returns false for similar prior', () => {
      expect(
        detectNovelty('quantum computing risks', ['quantum computing benefits and risks']),
      ).toBe(false);
    });

    it('returns true for no priors', () => {
      expect(detectNovelty('anything', [])).toBe(true);
    });
  });

  describe('computeUncertaintyMetrics', () => {
    it('returns low uncertainty for consensus', () => {
      const metrics = computeUncertaintyMetrics({
        rankings: [
          { provider: 'a', score: 10 },
          { provider: 'b', score: 10 },
        ],
        formulateResponses: { a: 'hello world' },
        adjustResponses: { a: 'hello world' },
        input: 'test question',
        priorInputs: ['test question about something'],
      });
      expect(metrics.overallUncertainty).toBe('low');
      expect(metrics.disagreementScore).toBe(0);
      expect(metrics.positionDrift).toBe(0);
    });

    it('returns high uncertainty for disagreement', () => {
      const metrics = computeUncertaintyMetrics({
        rankings: [
          { provider: 'a', score: 10 },
          { provider: 'b', score: 1 },
        ],
        crossRefs: [{ contradicted: true }, { contradicted: true }, { contradicted: true }],
        input: 'novel unique unprecedented question',
        priorInputs: [],
      });
      expect(metrics.overallUncertainty).not.toBe('low');
      expect(metrics.evidenceConflictCount).toBe(3);
      expect(metrics.noveltyFlag).toBe(true);
    });
  });

  describe('formatUncertaintyDisplay', () => {
    it('formats low uncertainty', () => {
      const display = formatUncertaintyDisplay({
        disagreementScore: 0,
        positionDrift: 0,
        evidenceConflictCount: 0,
        noveltyFlag: false,
        overallUncertainty: 'low',
        summary: 'Low uncertainty — strong consensus with stable positions.',
      });
      expect(display).toContain('🟢');
      expect(display).toContain('LOW');
    });

    it('formats high uncertainty with conflicts', () => {
      const display = formatUncertaintyDisplay({
        disagreementScore: 0.8,
        positionDrift: 0.5,
        evidenceConflictCount: 3,
        noveltyFlag: true,
        overallUncertainty: 'high',
        summary: 'test',
      });
      expect(display).toContain('🔴');
      expect(display).toContain('Evidence conflicts: 3');
      expect(display).toContain('Novel question');
    });
  });
});
