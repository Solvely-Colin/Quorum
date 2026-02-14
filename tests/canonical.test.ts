import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCanonicalRecord, validateCanonicalRecord, type CanonicalRecord } from '../src/canonical.js';

let sessionDir: string;

beforeEach(async () => {
  sessionDir = await mkdtemp(join(tmpdir(), 'quorum-test-'));
  // Write meta
  await writeFile(join(sessionDir, 'meta.json'), JSON.stringify({
    input: 'What is the best language?',
    profile: 'default',
    providers: [
      { name: 'claude', provider: 'anthropic', model: 'claude-3' },
      { name: 'gpt', provider: 'openai', model: 'gpt-4' },
    ],
    startedAt: 1700000000000,
  }));
  // Write phases
  await writeFile(join(sessionDir, '01-gather.json'), JSON.stringify({
    phase: 'GATHER', timestamp: 1700000001000, duration: 5000,
    responses: { claude: 'Rust is great', gpt: 'Python is great' },
  }));
  await writeFile(join(sessionDir, '04-debate.json'), JSON.stringify({
    phase: 'DEBATE', timestamp: 1700000010000, duration: 3000,
    responses: { claude: 'Python lacks types', gpt: 'Rust is hard' },
  }));
  await writeFile(join(sessionDir, '07-vote.json'), JSON.stringify({
    phase: 'VOTE', timestamp: 1700000020000, duration: 2000,
    responses: { claude: '1. gpt 2. claude', gpt: '1. claude 2. gpt' },
  }));
  await writeFile(join(sessionDir, 'synthesis.json'), JSON.stringify({
    content: 'Both have merits',
    synthesizer: 'claude',
    consensusScore: 0.7,
    confidenceScore: 0.8,
    controversial: false,
    votes: { rankings: [{ provider: 'claude', score: 3 }], winner: 'claude', controversial: false },
  }));
});

afterEach(async () => {
  await rm(sessionDir, { recursive: true, force: true });
});

describe('buildCanonicalRecord', () => {
  it('builds a valid canonical record', async () => {
    const record = await buildCanonicalRecord(sessionDir);
    expect(record.schemaVersion).toBe(1);
    expect(record.phases).toHaveLength(3);
    expect(record.hashChain).toHaveLength(3);
    expect(record.integrity.valid).toBe(true);
    expect(record.synthesis?.content).toBe('Both have merits');
    expect(record.votes?.winner).toBe('claude');
  });

  it('detects tampering when phase file is modified after record is built', async () => {
    const record = await buildCanonicalRecord(sessionDir);
    // Tamper with gather
    await writeFile(join(sessionDir, '01-gather.json'), JSON.stringify({
      phase: 'GATHER', timestamp: 1700000001000, duration: 5000,
      responses: { claude: 'TAMPERED', gpt: 'Python is great' },
    }));
    const record2 = await buildCanonicalRecord(sessionDir);
    // The hash chain is rebuilt from files, so it will be internally consistent
    // But the hashes will differ from the original record
    expect(record2.hashChain[0].hash).not.toBe(record.hashChain[0].hash);
  });
});

describe('validateCanonicalRecord', () => {
  it('validates a correct record', async () => {
    const record = await buildCanonicalRecord(sessionDir);
    const result = validateCanonicalRecord(record);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('catches missing fields', () => {
    const bad = { schemaVersion: 1 } as unknown as CanonicalRecord;
    const result = validateCanonicalRecord(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('catches wrong schema version', async () => {
    const record = await buildCanonicalRecord(sessionDir);
    (record as any).schemaVersion = 99;
    const result = validateCanonicalRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unsupported schema version: 99');
  });
});
