import { describe, it, expect } from 'vitest';
import {
  createAttestationRecord,
  buildAttestationChain,
  verifyAttestationChain,
  exportAttestationJSON,
  exportAttestationCBOR,
  parseAttestationCBOR,
  type AttestationChain,
} from './attestation.js';
import type { HashChainEntry } from './integrity.js';

describe('attestation', () => {
  const sampleEntry: HashChainEntry = {
    phase: 'GATHER',
    hash: 'abc123',
    previousHash: null,
    timestamp: 1000,
  };

  describe('createAttestationRecord', () => {
    it('creates a record with all fields', () => {
      const record = createAttestationRecord({
        phase: 'GATHER',
        inputs: 'What is AI?',
        outputs: { provider1: 'AI is...' },
        providerId: 'multi',
        timestamp: 1000,
        previousAttestationHash: null,
        chainEntryHash: 'abc123',
      });

      expect(record.phase).toBe('GATHER');
      expect(record.providerId).toBe('multi');
      expect(record.timestamp).toBe(1000);
      expect(record.previousAttestationHash).toBeNull();
      expect(record.hash).toBeTruthy();
      expect(record.inputsHash).toBeTruthy();
      expect(record.outputsHash).toBeTruthy();
      expect(record.chainEntryHash).toBe('abc123');
    });

    it('produces deterministic hashes for same inputs', () => {
      const params = {
        phase: 'GATHER',
        inputs: 'test',
        outputs: { a: 'b' },
        providerId: 'p1',
        timestamp: 1000,
        previousAttestationHash: null,
      };
      const r1 = createAttestationRecord(params);
      const r2 = createAttestationRecord(params);
      expect(r1.hash).toBe(r2.hash);
    });

    it('produces different hashes for different inputs', () => {
      const r1 = createAttestationRecord({
        phase: 'GATHER',
        inputs: 'test1',
        outputs: { a: 'b' },
        providerId: 'p1',
        timestamp: 1000,
        previousAttestationHash: null,
      });
      const r2 = createAttestationRecord({
        phase: 'GATHER',
        inputs: 'test2',
        outputs: { a: 'b' },
        providerId: 'p1',
        timestamp: 1000,
        previousAttestationHash: null,
      });
      expect(r1.hash).not.toBe(r2.hash);
    });
  });

  describe('buildAttestationChain', () => {
    it('builds a chain from entries and phase data', () => {
      const entries: HashChainEntry[] = [
        { phase: 'GATHER', hash: 'h1', previousHash: null, timestamp: 1000 },
        { phase: 'DEBATE', hash: 'h2', previousHash: 'h1', timestamp: 2000 },
      ];
      const phaseData = [
        { phase: 'GATHER', input: 'q', responses: { a: 'r1' }, providers: ['a', 'b'], timestamp: 1000 },
        { phase: 'DEBATE', input: 'q', responses: { a: 'r2' }, providers: ['a', 'b'], timestamp: 2000 },
      ];

      const chain = buildAttestationChain('session-1', entries, phaseData);

      expect(chain.version).toBe(1);
      expect(chain.sessionId).toBe('session-1');
      expect(chain.records).toHaveLength(2);
      expect(chain.records[0].previousAttestationHash).toBeNull();
      expect(chain.records[1].previousAttestationHash).toBe(chain.records[0].hash);
    });

    it('handles single-provider phases', () => {
      const entries: HashChainEntry[] = [
        { phase: 'SYNTH', hash: 'h1', previousHash: null, timestamp: 1000 },
      ];
      const phaseData = [
        { phase: 'SYNTH', input: 'q', responses: { claude: 'ans' }, providers: ['claude'], timestamp: 1000 },
      ];

      const chain = buildAttestationChain('s1', entries, phaseData);
      expect(chain.records[0].providerId).toBe('claude');
    });
  });

  describe('verifyAttestationChain', () => {
    it('verifies a valid chain', () => {
      const entries: HashChainEntry[] = [
        { phase: 'GATHER', hash: 'h1', previousHash: null, timestamp: 1000 },
        { phase: 'DEBATE', hash: 'h2', previousHash: 'h1', timestamp: 2000 },
      ];
      const phaseData = [
        { phase: 'GATHER', input: 'q', responses: { a: 'r1' }, providers: ['a'], timestamp: 1000 },
        { phase: 'DEBATE', input: 'q', responses: { a: 'r2' }, providers: ['a'], timestamp: 2000 },
      ];

      const chain = buildAttestationChain('s1', entries, phaseData);
      const result = verifyAttestationChain(chain);
      expect(result.valid).toBe(true);
    });

    it('detects tampered records', () => {
      const entries: HashChainEntry[] = [
        { phase: 'GATHER', hash: 'h1', previousHash: null, timestamp: 1000 },
      ];
      const phaseData = [
        { phase: 'GATHER', input: 'q', responses: { a: 'r1' }, providers: ['a'], timestamp: 1000 },
      ];

      const chain = buildAttestationChain('s1', entries, phaseData);
      chain.records[0].hash = 'tampered';
      const result = verifyAttestationChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe('GATHER');
    });

    it('detects broken linkage', () => {
      const entries: HashChainEntry[] = [
        { phase: 'GATHER', hash: 'h1', previousHash: null, timestamp: 1000 },
        { phase: 'DEBATE', hash: 'h2', previousHash: 'h1', timestamp: 2000 },
      ];
      const phaseData = [
        { phase: 'GATHER', input: 'q', responses: { a: 'r1' }, providers: ['a'], timestamp: 1000 },
        { phase: 'DEBATE', input: 'q', responses: { a: 'r2' }, providers: ['a'], timestamp: 2000 },
      ];

      const chain = buildAttestationChain('s1', entries, phaseData);
      chain.records[1].previousAttestationHash = 'wrong';
      const result = verifyAttestationChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe('DEBATE');
    });

    it('handles empty chain', () => {
      const chain: AttestationChain = { version: 1, sessionId: 's1', records: [], createdAt: Date.now() };
      expect(verifyAttestationChain(chain).valid).toBe(true);
    });
  });

  describe('CBOR export/import', () => {
    it('roundtrips through CBOR', () => {
      const chain: AttestationChain = {
        version: 1,
        sessionId: 'test',
        records: [
          {
            phase: 'GATHER',
            inputsHash: 'ih',
            outputsHash: 'oh',
            providerId: 'p1',
            timestamp: 1000,
            previousAttestationHash: null,
            hash: 'h1',
          },
        ],
        createdAt: 1000,
      };

      const buf = exportAttestationCBOR(chain);
      const parsed = parseAttestationCBOR(buf);
      expect(parsed.sessionId).toBe('test');
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].hash).toBe('h1');
    });

    it('rejects invalid magic', () => {
      const buf = Buffer.from('BADX\x01\x00\x00\x00\x02{}');
      expect(() => parseAttestationCBOR(buf)).toThrow('bad magic');
    });
  });

  describe('JSON export', () => {
    it('exports valid JSON', () => {
      const chain: AttestationChain = {
        version: 1,
        sessionId: 'test',
        records: [],
        createdAt: 1000,
      };
      const json = exportAttestationJSON(chain);
      expect(JSON.parse(json)).toEqual(chain);
    });
  });
});
