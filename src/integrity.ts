/**
 * Integrity — SHA-256 hash chain for tamper-evident deliberation records.
 * Each phase hash includes the previous phase hash, forming a chain.
 */

import { createHash } from 'node:crypto';
import type { PhaseOutput } from './session.js';

export interface HashChainEntry {
  phase: string;
  hash: string;
  previousHash: string | null;
  timestamp: number;
}

export interface VerificationResult {
  valid: boolean;
  brokenAt?: string;
  details?: string;
}

/**
 * Deterministic JSON serialization — recursively sorts object keys.
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    sorted
      .map((k) => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

/**
 * Compute SHA-256 hash for a phase output, chained to the previous hash.
 */
export function computePhaseHash(phase: PhaseOutput, previousHash: string | null): string {
  const h = createHash('sha256');
  h.update(stableStringify(phase));
  if (previousHash) {
    h.update(previousHash);
  }
  return h.digest('hex');
}

/**
 * Build a hash chain from an ordered list of phase outputs.
 */
export function buildHashChain(phases: PhaseOutput[]): HashChainEntry[] {
  const chain: HashChainEntry[] = [];
  let previousHash: string | null = null;

  for (const phase of phases) {
    const hash = computePhaseHash(phase, previousHash);
    chain.push({
      phase: phase.phase,
      hash,
      previousHash,
      timestamp: phase.timestamp,
    });
    previousHash = hash;
  }

  return chain;
}

/**
 * Verify a hash chain's integrity. Recomputes each hash and checks linkage.
 */
export function verifyHashChain(
  entries: HashChainEntry[],
  phases: PhaseOutput[],
): VerificationResult {
  if (entries.length !== phases.length) {
    return {
      valid: false,
      details: `Chain length mismatch: ${entries.length} entries but ${phases.length} phases`,
    };
  }

  if (entries.length === 0) {
    return { valid: true };
  }

  // First entry must have no previous hash
  if (entries[0].previousHash !== null) {
    return {
      valid: false,
      brokenAt: entries[0].phase,
      details: 'First entry has a non-null previousHash',
    };
  }

  let previousHash: string | null = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const phase = phases[i];

    // Check chain linkage
    if (entry.previousHash !== previousHash) {
      return {
        valid: false,
        brokenAt: entry.phase,
        details: `Chain broken: expected previousHash "${previousHash}" but got "${entry.previousHash}"`,
      };
    }

    // Recompute hash and compare
    const expected = computePhaseHash(phase, previousHash);
    if (entry.hash !== expected) {
      return {
        valid: false,
        brokenAt: entry.phase,
        details: `Hash mismatch at phase "${entry.phase}": expected "${expected}" but got "${entry.hash}"`,
      };
    }

    previousHash = entry.hash;
  }

  return { valid: true };
}
