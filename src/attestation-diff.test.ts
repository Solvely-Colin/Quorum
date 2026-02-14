import { describe, it, expect } from 'vitest';
import { diffAttestationChains, formatAttestationDiff } from './attestation-diff.js';
import type { AttestationChain } from './attestation.js';

describe('attestation-diff', () => {
  const makeChain = (sessionId: string, records: Array<{ phase: string; inputsHash: string; outputsHash: string; providerId: string }>): AttestationChain => ({
    version: 1,
    sessionId,
    createdAt: Date.now(),
    records: records.map((r, i) => ({
      ...r,
      timestamp: 1000 + i * 1000,
      previousAttestationHash: i === 0 ? null : `prev-${i}`,
      hash: `hash-${sessionId}-${i}`,
    })),
  });

  it('detects identical chains', () => {
    const chain = makeChain('s1', [
      { phase: 'GATHER', inputsHash: 'ih1', outputsHash: 'oh1', providerId: 'multi' },
      { phase: 'DEBATE', inputsHash: 'ih2', outputsHash: 'oh2', providerId: 'multi' },
    ]);
    // Same hashes
    const chain2: AttestationChain = {
      ...chain,
      sessionId: 's2',
      records: chain.records.map((r) => ({ ...r })),
    };

    const diff = diffAttestationChains(chain, chain2);
    expect(diff.entries.every((e) => e.status === 'match')).toBe(true);
    expect(diff.divergedAt).toBeUndefined();
    expect(diff.summary).toContain('identical');
  });

  it('detects output divergence', () => {
    const left = makeChain('s1', [
      { phase: 'GATHER', inputsHash: 'ih1', outputsHash: 'oh1', providerId: 'multi' },
    ]);
    const right = makeChain('s2', [
      { phase: 'GATHER', inputsHash: 'ih1', outputsHash: 'oh-different', providerId: 'multi' },
    ]);

    const diff = diffAttestationChains(left, right);
    expect(diff.entries[0].status).toBe('diverged');
    expect(diff.entries[0].details).toContain('outputs differ');
    expect(diff.divergedAt).toBe('GATHER');
  });

  it('handles different chain lengths', () => {
    const left = makeChain('s1', [
      { phase: 'GATHER', inputsHash: 'ih1', outputsHash: 'oh1', providerId: 'multi' },
      { phase: 'DEBATE', inputsHash: 'ih2', outputsHash: 'oh2', providerId: 'multi' },
    ]);
    const right = makeChain('s2', [
      { phase: 'GATHER', inputsHash: 'ih1', outputsHash: 'oh1', providerId: 'multi' },
    ]);

    const diff = diffAttestationChains(left, right);
    expect(diff.entries).toHaveLength(2);
    expect(diff.entries[1].status).toBe('only-left');
  });

  it('detects phase mismatch', () => {
    const left = makeChain('s1', [
      { phase: 'GATHER', inputsHash: 'ih1', outputsHash: 'oh1', providerId: 'multi' },
    ]);
    const right = makeChain('s2', [
      { phase: 'DEBATE', inputsHash: 'ih1', outputsHash: 'oh1', providerId: 'multi' },
    ]);

    const diff = diffAttestationChains(left, right);
    expect(diff.entries[0].status).toBe('diverged');
    expect(diff.entries[0].details).toContain('Phase mismatch');
  });

  it('detects provider divergence', () => {
    const left = makeChain('s1', [
      { phase: 'GATHER', inputsHash: 'ih1', outputsHash: 'oh-a', providerId: 'claude' },
    ]);
    const right = makeChain('s2', [
      { phase: 'GATHER', inputsHash: 'ih1', outputsHash: 'oh-b', providerId: 'openai' },
    ]);

    const diff = diffAttestationChains(left, right);
    expect(diff.entries[0].details).toContain('providers differ');
  });

  describe('formatAttestationDiff', () => {
    it('produces readable output', () => {
      const left = makeChain('s1', [
        { phase: 'GATHER', inputsHash: 'ih1', outputsHash: 'oh1', providerId: 'multi' },
      ]);
      const right = makeChain('s2', [
        { phase: 'GATHER', inputsHash: 'ih1', outputsHash: 'oh-diff', providerId: 'multi' },
      ]);

      const diff = diffAttestationChains(left, right);
      const text = formatAttestationDiff(diff);
      expect(text).toContain('s1');
      expect(text).toContain('s2');
      expect(text).toContain('GATHER');
      expect(text).toContain('diverged');
    });
  });
});
