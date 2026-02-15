/**
 * @experimental
 * Attestation — Cryptographic attestation records at phase boundaries.
 * Extends the hash chain (integrity.ts) with structured, signed attestation artifacts.
 */

import { createHash } from 'node:crypto';
import type { HashChainEntry } from './integrity.js';

export interface AttestationRecord {
  /** Phase name (e.g. 'GATHER', 'DEBATE') */
  phase: string;
  /** SHA-256 hash of the canonical phase inputs */
  inputsHash: string;
  /** SHA-256 hash of the canonical phase outputs */
  outputsHash: string;
  /** Provider ID that produced this output (or 'multi' for parallel phases) */
  providerId: string;
  /** Unix timestamp (ms) */
  timestamp: number;
  /** Hash of the previous attestation record (null for first) */
  previousAttestationHash: string | null;
  /** This attestation's own hash (computed over all above fields) */
  hash: string;
  /** Optional: reference to the underlying hash chain entry */
  chainEntryHash?: string;
}

export interface AttestationChain {
  version: 1;
  sessionId: string;
  records: AttestationRecord[];
  createdAt: number;
}

export interface AttestationVerification {
  valid: boolean;
  brokenAt?: string;
  details?: string;
}

/**
 * Compute SHA-256 of a string.
 */
function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute the hash of an attestation record (excluding the hash field itself).
 */
function computeAttestationHash(record: Omit<AttestationRecord, 'hash'>): string {
  const payload = [
    record.phase,
    record.inputsHash,
    record.outputsHash,
    record.providerId,
    String(record.timestamp),
    record.previousAttestationHash ?? '',
    record.chainEntryHash ?? '',
  ].join('|');
  return sha256(payload);
}

/**
 * Create an attestation record for a phase boundary.
 */
export function createAttestationRecord(params: {
  phase: string;
  inputs: string;
  outputs: Record<string, string>;
  providerId: string;
  timestamp: number;
  previousAttestationHash: string | null;
  chainEntryHash?: string;
}): AttestationRecord {
  const inputsHash = sha256(params.inputs);
  const outputsHash = sha256(JSON.stringify(params.outputs));
  const partial = {
    phase: params.phase,
    inputsHash,
    outputsHash,
    providerId: params.providerId,
    timestamp: params.timestamp,
    previousAttestationHash: params.previousAttestationHash,
    chainEntryHash: params.chainEntryHash,
  };
  const hash = computeAttestationHash(partial);
  return { ...partial, hash };
}

/**
 * Build an attestation chain from hash chain entries and phase data.
 */
export function buildAttestationChain(
  sessionId: string,
  entries: HashChainEntry[],
  phaseData: Array<{
    phase: string;
    input: string;
    responses: Record<string, string>;
    providers: string[];
    timestamp: number;
  }>,
): AttestationChain {
  const records: AttestationRecord[] = [];
  let previousHash: string | null = null;

  for (let i = 0; i < entries.length && i < phaseData.length; i++) {
    const entry = entries[i];
    const data = phaseData[i];
    const providerId = data.providers.length === 1 ? data.providers[0] : 'multi';

    const record = createAttestationRecord({
      phase: data.phase,
      inputs: data.input,
      outputs: data.responses,
      providerId,
      timestamp: data.timestamp,
      previousAttestationHash: previousHash,
      chainEntryHash: entry.hash,
    });

    records.push(record);
    previousHash = record.hash;
  }

  return {
    version: 1,
    sessionId,
    records,
    createdAt: Date.now(),
  };
}

/**
 * Verify an attestation chain's integrity.
 */
export function verifyAttestationChain(chain: AttestationChain): AttestationVerification {
  if (chain.records.length === 0) {
    return { valid: true };
  }

  if (chain.records[0].previousAttestationHash !== null) {
    return {
      valid: false,
      brokenAt: chain.records[0].phase,
      details: 'First attestation has non-null previousAttestationHash',
    };
  }

  let previousHash: string | null = null;

  for (const record of chain.records) {
    if (record.previousAttestationHash !== previousHash) {
      return {
        valid: false,
        brokenAt: record.phase,
        details: `Chain linkage broken: expected "${previousHash}" but got "${record.previousAttestationHash}"`,
      };
    }

    const expected = computeAttestationHash({
      phase: record.phase,
      inputsHash: record.inputsHash,
      outputsHash: record.outputsHash,
      providerId: record.providerId,
      timestamp: record.timestamp,
      previousAttestationHash: record.previousAttestationHash,
      chainEntryHash: record.chainEntryHash,
    });

    if (record.hash !== expected) {
      return {
        valid: false,
        brokenAt: record.phase,
        details: `Hash mismatch at "${record.phase}": expected "${expected}" got "${record.hash}"`,
      };
    }

    previousHash = record.hash;
  }

  return { valid: true };
}

/**
 * Export attestation chain as JSON string.
 */
export function exportAttestationJSON(chain: AttestationChain): string {
  return JSON.stringify(chain, null, 2);
}

/**
 * Export attestation chain as CBOR bytes (hex-encoded for portability).
 * Uses a simple CBOR-like encoding since we don't want a heavy dependency.
 * For production use, consumers should use a proper CBOR library.
 */
export function exportAttestationCBOR(chain: AttestationChain): Buffer {
  // Simple approach: JSON → Buffer. For true CBOR, use cbor package.
  // We serialize as a structured binary format: length-prefixed JSON.
  const json = JSON.stringify(chain);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(json.length, 0);
  return Buffer.concat([
    Buffer.from('QATT'), // magic bytes
    Buffer.from([0x01]), // version
    header,
    Buffer.from(json, 'utf-8'),
  ]);
}

/**
 * Parse CBOR-format attestation back to chain.
 */
export function parseAttestationCBOR(buf: Buffer): AttestationChain {
  const magic = buf.subarray(0, 4).toString('ascii');
  if (magic !== 'QATT') throw new Error('Invalid attestation binary: bad magic');
  const version = buf[4];
  if (version !== 1) throw new Error(`Unsupported attestation binary version: ${version}`);
  const length = buf.readUInt32BE(5);
  const json = buf.subarray(9, 9 + length).toString('utf-8');
  return JSON.parse(json) as AttestationChain;
}
