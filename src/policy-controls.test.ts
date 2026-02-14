import { describe, it, expect } from 'vitest';
import { validatePolicyConfig, formatPolicyConfig, defaultPolicyPath } from './policy-controls.js';
import { DEFAULT_POLICY } from './risk-tier.js';

describe('validatePolicyConfig', () => {
  it('accepts valid default policy', () => {
    const errors = validatePolicyConfig(DEFAULT_POLICY);
    expect(errors).toEqual([]);
  });

  it('rejects non-object', () => {
    expect(validatePolicyConfig(null)).toEqual(['Policy must be an object']);
    expect(validatePolicyConfig('string')).toEqual(['Policy must be an object']);
  });

  it('rejects missing version', () => {
    const errors = validatePolicyConfig({ tiers: {} });
    expect(errors.some((e) => e.includes('version'))).toBe(true);
  });

  it('rejects invalid default action', () => {
    const errors = validatePolicyConfig({
      version: 1,
      defaultAction: 'invalid',
      tiers: DEFAULT_POLICY.tiers,
    });
    expect(errors.some((e) => e.includes('defaultAction'))).toBe(true);
  });

  it('rejects missing tiers', () => {
    const errors = validatePolicyConfig({ version: 1 });
    expect(errors.some((e) => e.includes('tiers'))).toBe(true);
  });

  it('rejects missing tier entries', () => {
    const errors = validatePolicyConfig({
      version: 1,
      tiers: { low: DEFAULT_POLICY.tiers.low },
    });
    expect(errors.some((e) => e.includes('medium'))).toBe(true);
  });

  it('rejects invalid threshold values', () => {
    const badPolicy = {
      version: 1,
      tiers: {
        low: {
          thresholds: {
            consensusMin: 2, // invalid: > 1
            confidenceMin: 0.8,
            dissentMax: 0.2,
            providerAgreementMin: 0.8,
          },
          action: 'auto-approve',
        },
        medium: DEFAULT_POLICY.tiers.medium,
        high: DEFAULT_POLICY.tiers.high,
        critical: DEFAULT_POLICY.tiers.critical,
      },
    };
    const errors = validatePolicyConfig(badPolicy);
    expect(errors.some((e) => e.includes('consensusMin'))).toBe(true);
  });

  it('rejects invalid tier action', () => {
    const badPolicy = {
      version: 1,
      tiers: {
        low: {
          thresholds: DEFAULT_POLICY.tiers.low.thresholds,
          action: 'invalid-action',
        },
        medium: DEFAULT_POLICY.tiers.medium,
        high: DEFAULT_POLICY.tiers.high,
        critical: DEFAULT_POLICY.tiers.critical,
      },
    };
    const errors = validatePolicyConfig(badPolicy);
    expect(errors.some((e) => e.includes('invalid-action'))).toBe(true);
  });
});

describe('formatPolicyConfig', () => {
  it('formats default policy readably', () => {
    const formatted = formatPolicyConfig(DEFAULT_POLICY);
    expect(formatted).toContain('📋 Policy v1');
    expect(formatted).toContain('🟢');
    expect(formatted).toContain('LOW');
    expect(formatted).toContain('🔴');
    expect(formatted).toContain('CRITICAL');
    expect(formatted).toContain('auto-approve');
    expect(formatted).toContain('block');
  });
});

describe('defaultPolicyPath', () => {
  it('returns a path ending with .quorum/policy.yml', () => {
    const path = defaultPolicyPath();
    expect(path).toContain('.quorum');
    expect(path).toContain('policy.yml');
  });
});
