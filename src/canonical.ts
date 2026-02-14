/**
 * Canonical Deliberation Record — structured JSON schema (v1) that captures
 * the full graph of reasoning including hash chain integrity data.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PhaseOutput } from './session.js';
import { buildHashChain, verifyHashChain, type HashChainEntry } from './integrity.js';

// --- Schema types ---

export interface CanonicalRecord {
  schemaVersion: 1;
  sessionId: string;
  meta: {
    input: string;
    profile: string;
    providers: Array<{ name: string; provider: string; model: string }>;
    startedAt: number;
    completedAt?: number;
  };
  phases: Array<{
    name: string;
    timestamp: number;
    duration: number;
    responses: Record<string, string>;
  }>;
  votes?: {
    responses: Record<string, string>;
    rankings?: Array<{ provider: string; score: number }>;
    winner?: string;
    controversial?: boolean;
    votingDetails?: string;
  };
  synthesis?: {
    content: string;
    synthesizer: string;
    consensusScore: number;
    confidenceScore: number;
    controversial: boolean;
    minorityReport?: string;
    contributions?: Record<string, string[]>;
    whatWouldChange?: string;
  };
  hashChain: HashChainEntry[];
  integrity: {
    valid: boolean;
    brokenAt?: string;
    details?: string;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Ordered phase files to look for
const PHASE_FILES = [
  '01-gather.json',
  '02-plan.json',
  '03-formulate.json',
  '04-debate.json',
  '05-adjust.json',
  '06-rebuttal.json',
];

/**
 * Build a canonical record from a session directory.
 */
export async function buildCanonicalRecord(sessionDir: string): Promise<CanonicalRecord> {
  // Read meta
  const metaPath = join(sessionDir, 'meta.json');
  if (!existsSync(metaPath)) {
    throw new Error(`Session meta not found: ${metaPath}`);
  }
  const meta = JSON.parse(await readFile(metaPath, 'utf-8'));

  // Read phases
  const phases: PhaseOutput[] = [];

  // Check for standard phase files
  for (const file of PHASE_FILES) {
    const p = join(sessionDir, file);
    if (existsSync(p)) {
      phases.push(JSON.parse(await readFile(p, 'utf-8')));
    }
  }

  // Check for extra debate rounds (04-debate-r2.json, etc.)
  try {
    const files = await readdir(sessionDir);
    const extraDebates = files
      .filter((f) => /^04-debate-r\d+\.json$/.test(f))
      .sort();
    for (const f of extraDebates) {
      phases.push(JSON.parse(await readFile(join(sessionDir, f), 'utf-8')));
    }
  } catch { /* */ }

  // Read vote
  const votePath = join(sessionDir, '07-vote.json');
  let votePhase: PhaseOutput | null = null;
  if (existsSync(votePath)) {
    votePhase = JSON.parse(await readFile(votePath, 'utf-8')) as PhaseOutput;
    phases.push(votePhase!);
  }

  // Build hash chain from all phases
  const hashChain = buildHashChain(phases);
  const integrity = verifyHashChain(hashChain, phases);

  // Read synthesis
  const synthPath = join(sessionDir, 'synthesis.json');
  let synthesis: CanonicalRecord['synthesis'] | undefined;
  let votes: CanonicalRecord['votes'] | undefined;
  if (existsSync(synthPath)) {
    const synthData = JSON.parse(await readFile(synthPath, 'utf-8'));
    synthesis = {
      content: synthData.content,
      synthesizer: synthData.synthesizer,
      consensusScore: synthData.consensusScore,
      confidenceScore: synthData.confidenceScore,
      controversial: synthData.controversial,
      minorityReport: synthData.minorityReport,
      contributions: synthData.contributions,
      whatWouldChange: synthData.whatWouldChange,
    };
    if (synthData.votes) {
      votes = {
        responses: votePhase?.responses ?? {},
        rankings: synthData.votes.rankings,
        winner: synthData.votes.winner,
        controversial: synthData.votes.controversial,
        votingDetails: synthData.votes.votingDetails,
      };
    }
  }

  // If no votes from synthesis, but we have vote phase
  if (!votes && votePhase) {
    votes = { responses: votePhase.responses };
  }

  const sessionId = sessionDir.split('/').pop()!;

  return {
    schemaVersion: 1,
    sessionId,
    meta: {
      input: meta.input,
      profile: meta.profile,
      providers: meta.providers,
      startedAt: meta.startedAt,
      completedAt: meta.completedAt,
    },
    phases: phases.map((p) => ({
      name: p.phase,
      timestamp: p.timestamp,
      duration: p.duration,
      responses: p.responses,
    })),
    votes,
    synthesis,
    hashChain,
    integrity,
  };
}

/**
 * Validate a canonical record against the v1 schema.
 */
export function validateCanonicalRecord(record: CanonicalRecord): ValidationResult {
  const errors: string[] = [];

  if (record.schemaVersion !== 1) {
    errors.push(`Unsupported schema version: ${record.schemaVersion}`);
  }
  if (!record.sessionId) {
    errors.push('Missing sessionId');
  }
  if (!record.meta) {
    errors.push('Missing meta');
  } else {
    if (!record.meta.input) errors.push('Missing meta.input');
    if (!record.meta.profile) errors.push('Missing meta.profile');
    if (!Array.isArray(record.meta.providers)) errors.push('Missing meta.providers');
    if (typeof record.meta.startedAt !== 'number') errors.push('Missing meta.startedAt');
  }
  if (!Array.isArray(record.phases)) {
    errors.push('Missing phases array');
  } else {
    for (let i = 0; i < record.phases.length; i++) {
      const p = record.phases[i];
      if (!p.name) errors.push(`Phase ${i}: missing name`);
      if (typeof p.timestamp !== 'number') errors.push(`Phase ${i}: missing timestamp`);
      if (typeof p.duration !== 'number') errors.push(`Phase ${i}: missing duration`);
      if (!p.responses || typeof p.responses !== 'object') errors.push(`Phase ${i}: missing responses`);
    }
  }
  if (!Array.isArray(record.hashChain)) {
    errors.push('Missing hashChain array');
  }
  if (!record.integrity || typeof record.integrity.valid !== 'boolean') {
    errors.push('Missing integrity result');
  }

  return { valid: errors.length === 0, errors };
}
