/**
 * Ledger — append-only hash-chain for deliberation auditability.
 * Stores entries in ~/.quorum/ledger.json with SHA-256 chaining.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { V2Result } from './council-v2.js';
import type { ProviderConfig, AgentProfile } from './types.js';

// --- Types ---

export interface LedgerEntry {
  id: string;
  timestamp: number;
  hash: string;
  previousHash: string;
  input: string;
  profile: string;
  topology: string;
  providers: Array<{ name: string; model: string }>;
  phases: Array<{
    name: string;
    duration: number;
    responses: Record<string, string>;
  }>;
  votes: {
    winner: string;
    rankings: Array<{ provider: string; score: number }>;
    algorithm: string;
  };
  synthesis: {
    content: string;
    synthesizer: string;
    consensusScore: number;
    confidenceScore: number;
    controversial: boolean;
  };
  options: {
    evidence: boolean;
    redTeam: boolean;
    adaptive: string;
    topology: string;
  };
  duration: number;
}

export interface Ledger {
  version: 1;
  entries: LedgerEntry[];
}

// --- Paths ---

const QUORUM_DIR = join(homedir(), '.quorum');
const LEDGER_PATH = join(QUORUM_DIR, 'ledger.json');
const MAX_ENTRIES = 10_000;

// --- Canonical JSON ---

function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    sorted
      .map((k) => JSON.stringify(k) + ':' + canonicalStringify((obj as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

// --- Hash ---

export function computeEntryHash(entry: LedgerEntry): string {
  const { hash: _, ...rest } = entry;
  return createHash('sha256').update(canonicalStringify(rest)).digest('hex');
}

// --- Load / Save ---

export async function loadLedger(): Promise<Ledger> {
  if (!existsSync(LEDGER_PATH)) {
    return { version: 1, entries: [] };
  }
  try {
    const raw = await readFile(LEDGER_PATH, 'utf-8');
    return JSON.parse(raw) as Ledger;
  } catch {
    return { version: 1, entries: [] };
  }
}

async function saveLedger(ledger: Ledger): Promise<void> {
  await mkdir(QUORUM_DIR, { recursive: true });
  const tmpPath = LEDGER_PATH + '.tmp';
  await writeFile(tmpPath, JSON.stringify(ledger, null, 2), 'utf-8');
  await rename(tmpPath, LEDGER_PATH);
}

// --- Public API ---

export interface LedgerConfig {
  input: string;
  profile: AgentProfile;
  providerConfigs: ProviderConfig[];
  phases: Array<{ name: string; duration: number; responses: Record<string, string> }>;
  topology: string;
  evidence: boolean;
  redTeam: boolean;
  adaptive: string;
}

export async function appendToLedger(result: V2Result, config: LedgerConfig): Promise<LedgerEntry> {
  const ledger = await loadLedger();

  const previousHash =
    ledger.entries.length > 0 ? ledger.entries[ledger.entries.length - 1].hash : 'genesis';

  const entry: LedgerEntry = {
    id: result.sessionId,
    timestamp: Date.now(),
    hash: '', // computed below
    previousHash,
    input: config.input,
    profile: config.profile.name,
    topology: config.topology,
    providers: config.providerConfigs.map((p) => ({ name: p.name, model: p.model })),
    phases: config.phases,
    votes: {
      winner: result.votes.winner,
      rankings: result.votes.rankings,
      algorithm: result.votes.votingDetails ? 'custom' : 'borda',
    },
    synthesis: {
      content: result.synthesis.content,
      synthesizer: result.synthesis.synthesizer,
      consensusScore: result.synthesis.consensusScore,
      confidenceScore: result.synthesis.confidenceScore,
      controversial: result.synthesis.controversial,
    },
    options: {
      evidence: config.evidence,
      redTeam: config.redTeam,
      adaptive: config.adaptive,
      topology: config.topology,
    },
    duration: result.duration,
  };

  entry.hash = computeEntryHash(entry);

  ledger.entries.push(entry);

  // Trim oldest if over limit
  if (ledger.entries.length > MAX_ENTRIES) {
    ledger.entries = ledger.entries.slice(ledger.entries.length - MAX_ENTRIES);
  }

  await saveLedger(ledger);
  return entry;
}

export async function verifyLedgerIntegrity(): Promise<{
  valid: boolean;
  brokenAt?: number;
  message?: string;
}> {
  const ledger = await loadLedger();
  if (ledger.entries.length === 0) {
    return { valid: true, message: 'Ledger is empty' };
  }

  for (let i = 0; i < ledger.entries.length; i++) {
    const entry = ledger.entries[i];

    // Verify hash
    const computed = computeEntryHash(entry);
    if (computed !== entry.hash) {
      return {
        valid: false,
        brokenAt: i,
        message: `Entry ${i} hash mismatch: expected ${computed}, got ${entry.hash}`,
      };
    }

    // Verify chain
    const expectedPrev = i === 0 ? 'genesis' : ledger.entries[i - 1].hash;
    if (entry.previousHash !== expectedPrev) {
      return {
        valid: false,
        brokenAt: i,
        message: `Entry ${i} chain broken: expected previousHash ${expectedPrev}, got ${entry.previousHash}`,
      };
    }
  }

  return { valid: true, message: `All ${ledger.entries.length} entries verified` };
}

export async function getLedgerEntry(sessionId: string): Promise<LedgerEntry | null> {
  const ledger = await loadLedger();
  if (sessionId === 'last') {
    return ledger.entries.length > 0 ? ledger.entries[ledger.entries.length - 1] : null;
  }
  return ledger.entries.find((e) => e.id === sessionId) ?? null;
}

export function exportLedgerADR(entry: LedgerEntry): string {
  const truncInput = entry.input.length > 80 ? entry.input.slice(0, 77) + '...' : entry.input;
  const date = new Date(entry.timestamp).toISOString();
  const providerList = entry.providers.map((p) => `${p.name} (${p.model})`).join(', ');

  const rankingsTable = entry.votes.rankings
    .map((r) => `| ${r.provider} | ${r.score} |`)
    .join('\n');

  return `# ADR: ${truncInput}
**Date:** ${date}
**Status:** Accepted
**Context:** ${entry.input}
**Providers:** ${providerList}
**Topology:** ${entry.topology}

## Decision
${entry.synthesis.content}

## Vote
Winner: ${entry.votes.winner} | Consensus: ${entry.synthesis.consensusScore} | Confidence: ${entry.synthesis.confidenceScore}

| Provider | Score |
|----------|-------|
${rankingsTable}

## Consequences
${entry.synthesis.controversial ? 'This was a controversial decision with significant dissent among providers.' : 'Consensus was reached without major dissent.'}
`;
}
