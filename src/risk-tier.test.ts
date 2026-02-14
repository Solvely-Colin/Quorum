import { describe, it, expect } from 'vitest';
import {
  classifyRisk,
  computeProviderAgreement,
  computeDissentSeverity,
  formatRiskAssessment,
  type DeliberationInput,
} from './risk-tier.js';

describe('computeProviderAgreement', () => {
  it('returns 1.0 for single provider', () => {
    expect(computeProviderAgreement([{ provider: 'a', score: 10 }])).toBe(1.0);
  });

  it('returns 1.0 when all scores are equal', () => {
    const rankings = [
      { provider: 'a', score: 10 },
      { provider: 'b', score: 10 },
      { provider: 'c', score: 10 },
    ];
    expect(computeProviderAgreement(rankings)).toBe(1.0);
  });

  it('returns lower value when scores diverge', () => {
    const rankings = [
      { provider: 'a', score: 10 },
      { provider: 'b', score: 5 },
      { provider: 'c', score: 2 },
    ];
    const agreement = computeProviderAgreement(rankings);
    expect(agreement).toBeLessThan(1.0);
    expect(agreement).toBeGreaterThan(0);
  });

  it('returns 0 when top score is 0', () => {
    const rankings = [
      { provider: 'a', score: 0 },
      { provider: 'b', score: 0 },
    ];
    expect(computeProviderAgreement(rankings)).toBe(0);
  });
});

describe('computeDissentSeverity', () => {
  it('returns 0 for non-controversial with no minority report', () => {
    expect(computeDissentSeverity(false)).toBe(0);
  });

  it('returns 0.4 for controversial with no minority report', () => {
    expect(computeDissentSeverity(true)).toBe(0.4);
  });

  it('returns 0 for "None" minority report', () => {
    expect(computeDissentSeverity(false, 'None')).toBe(0);
  });

  it('increases with longer minority reports', () => {
    const short = computeDissentSeverity(false, 'Some minor disagreement.');
    const long = computeDissentSeverity(
      false,
      'There was significant disagreement among the providers about the fundamental approach to this problem. Multiple providers raised concerns about accuracy, methodology, and the overall framing of the question. The dissent centered around three key areas that require careful consideration.',
    );
    expect(long).toBeGreaterThan(short);
  });

  it('caps at 1.0', () => {
    const longText = 'word '.repeat(500);
    expect(computeDissentSeverity(true, longText)).toBeLessThanOrEqual(1.0);
  });
});

describe('classifyRisk', () => {
  it('classifies high consensus as low risk', () => {
    const input: DeliberationInput = {
      consensusScore: 0.9,
      confidenceScore: 0.85,
      controversial: false,
      rankings: [
        { provider: 'a', score: 10 },
        { provider: 'b', score: 9 },
        { provider: 'c', score: 9 },
      ],
    };
    const result = classifyRisk(input);
    expect(result.tier).toBe('low');
    expect(result.action).toBe('auto-approve');
  });

  it('classifies moderate scores as medium risk', () => {
    const input: DeliberationInput = {
      consensusScore: 0.65,
      confidenceScore: 0.7,
      controversial: false,
      rankings: [
        { provider: 'a', score: 10 },
        { provider: 'b', score: 8 },
        { provider: 'c', score: 7 },
      ],
    };
    const result = classifyRisk(input);
    expect(result.tier).toBe('medium');
    expect(result.action).toBe('warn');
  });

  it('classifies low consensus as high risk', () => {
    const input: DeliberationInput = {
      consensusScore: 0.45,
      confidenceScore: 0.45,
      controversial: false,
      rankings: [
        { provider: 'a', score: 10 },
        { provider: 'b', score: 8 },
        { provider: 'c', score: 7 },
      ],
    };
    const result = classifyRisk(input);
    expect(result.tier).toBe('high');
    expect(result.action).toBe('checkpoint');
  });

  it('classifies very low scores as critical', () => {
    const input: DeliberationInput = {
      consensusScore: 0.2,
      confidenceScore: 0.15,
      controversial: true,
      rankings: [
        { provider: 'a', score: 10 },
        { provider: 'b', score: 2 },
        { provider: 'c', score: 1 },
      ],
      minorityReport:
        'Major disagreement across all providers. Fundamental concerns raised about accuracy and methodology.',
    };
    const result = classifyRisk(input);
    expect(result.tier).toBe('critical');
    expect(result.action).toBe('block');
  });

  it('uses default policy when none provided', () => {
    const input: DeliberationInput = {
      consensusScore: 0.9,
      confidenceScore: 0.9,
      controversial: false,
      rankings: [
        { provider: 'a', score: 10 },
        { provider: 'b', score: 10 },
      ],
    };
    const result = classifyRisk(input);
    expect(result.tier).toBe('low');
  });
});

describe('formatRiskAssessment', () => {
  it('formats low risk with green icon', () => {
    const assessment = classifyRisk({
      consensusScore: 0.9,
      confidenceScore: 0.9,
      controversial: false,
      rankings: [
        { provider: 'a', score: 10 },
        { provider: 'b', score: 10 },
      ],
    });
    const formatted = formatRiskAssessment(assessment);
    expect(formatted).toContain('🟢');
    expect(formatted).toContain('LOW');
    expect(formatted).toContain('auto-approve');
  });

  it('formats critical risk with red icon', () => {
    const assessment = classifyRisk({
      consensusScore: 0.1,
      confidenceScore: 0.1,
      controversial: true,
      rankings: [
        { provider: 'a', score: 10 },
        { provider: 'b', score: 1 },
      ],
      minorityReport: 'Major disagreement on all points.',
    });
    const formatted = formatRiskAssessment(assessment);
    expect(formatted).toContain('🔴');
    expect(formatted).toContain('CRITICAL');
  });
});
