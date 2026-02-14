import { describe, it, expect } from 'vitest';
import { computePhaseHash, buildHashChain, verifyHashChain } from '../src/integrity.js';
import type { PhaseOutput } from '../src/session.js';

function makePhase(phase: string, responses: Record<string, string> = { a: 'resp' }): PhaseOutput {
  return { phase, timestamp: Date.now(), duration: 100, responses };
}

describe('computePhaseHash', () => {
  it('produces a hex SHA-256 hash', () => {
    const hash = computePhaseHash(makePhase('gather'), null);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different inputs produce different hashes', () => {
    const h1 = computePhaseHash(makePhase('gather', { a: 'one' }), null);
    const h2 = computePhaseHash(makePhase('gather', { a: 'two' }), null);
    expect(h1).not.toBe(h2);
  });

  it('includes previousHash in computation', () => {
    const phase = makePhase('debate');
    const h1 = computePhaseHash(phase, null);
    const h2 = computePhaseHash(phase, 'abc123');
    expect(h1).not.toBe(h2);
  });
});

describe('buildHashChain', () => {
  it('builds a chain with correct linkage', () => {
    const phases = [makePhase('gather'), makePhase('debate'), makePhase('vote')];
    const chain = buildHashChain(phases);
    expect(chain).toHaveLength(3);
    expect(chain[0].previousHash).toBeNull();
    expect(chain[1].previousHash).toBe(chain[0].hash);
    expect(chain[2].previousHash).toBe(chain[1].hash);
  });

  it('handles empty input', () => {
    expect(buildHashChain([])).toEqual([]);
  });
});

describe('verifyHashChain', () => {
  it('verifies a valid chain', () => {
    const phases = [makePhase('gather'), makePhase('debate')];
    const chain = buildHashChain(phases);
    const result = verifyHashChain(chain, phases);
    expect(result.valid).toBe(true);
  });

  it('detects tampered phase data', () => {
    const phases = [makePhase('gather'), makePhase('debate')];
    const chain = buildHashChain(phases);
    // Tamper with phase data
    const tampered = [{ ...phases[0], responses: { a: 'TAMPERED' } }, phases[1]];
    const result = verifyHashChain(chain, tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe('gather');
  });

  it('detects broken chain linkage', () => {
    const phases = [makePhase('gather'), makePhase('debate')];
    const chain = buildHashChain(phases);
    // Break the chain
    chain[1] = { ...chain[1], previousHash: 'wrong' };
    const result = verifyHashChain(chain, phases);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe('debate');
  });

  it('detects length mismatch', () => {
    const phases = [makePhase('gather')];
    const chain = buildHashChain(phases);
    const result = verifyHashChain(chain, []);
    expect(result.valid).toBe(false);
  });

  it('verifies empty chain', () => {
    expect(verifyHashChain([], []).valid).toBe(true);
  });
});
