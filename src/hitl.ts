/**
 * Human-in-the-Loop (HITL) Checkpoints for Quorum deliberations.
 *
 * Pauses deliberation at configurable checkpoints to get human input,
 * then incorporates that input into subsequent phases.
 */

import { createInterface } from 'node:readline/promises';

// --- Types ---

export type HITLPhase =
  | 'after-gather'
  | 'after-debate'
  | 'after-vote'
  | 'on-controversy'
  | 'on-policy';

export interface HITLCheckpoint {
  phase: HITLPhase;
  responses: Record<string, string>;
  votes?: { winner: string; rankings: Array<{ provider: string; score: number }> };
  consensusScore?: number;
  message?: string;
}

export interface HITLResponse {
  action: 'continue' | 'abort' | 'inject';
  input?: string;
  overrideWinner?: string;
}

export type HITLHandler = (checkpoint: HITLCheckpoint) => Promise<HITLResponse>;

export interface HITLOptions {
  enabled: boolean;
  checkpoints: HITLPhase[];
  controversyThreshold?: number;
  handler?: HITLHandler;
}

// --- Helpers ---

/**
 * Check if HITL should pause at a given phase.
 */
export function shouldPause(
  phase: HITLPhase,
  options: HITLOptions | undefined,
  consensusScore?: number,
): boolean {
  if (!options?.enabled) return false;

  if (phase === 'on-controversy') {
    const threshold = options.controversyThreshold ?? 0.5;
    return (
      options.checkpoints.includes('on-controversy') &&
      consensusScore !== undefined &&
      consensusScore < threshold
    );
  }

  return options.checkpoints.includes(phase);
}

/**
 * Pretty-print a checkpoint for terminal display.
 */
export function formatCheckpoint(checkpoint: HITLCheckpoint): string {
  const lines: string[] = [];
  lines.push(`⏸️  HITL Checkpoint: ${checkpoint.phase}`);

  if (checkpoint.message) {
    lines.push(`   ${checkpoint.message}`);
  }

  lines.push('   Provider responses:');
  for (const [provider, response] of Object.entries(checkpoint.responses)) {
    const truncated = response.slice(0, 100).replace(/\n/g, ' ');
    const suffix = response.length > 100 ? '...' : '';
    lines.push(`   • ${provider}: ${truncated}${suffix}`);
  }

  if (checkpoint.votes) {
    lines.push('');
    lines.push(`   Vote winner: ${checkpoint.votes.winner}`);
    for (const r of checkpoint.votes.rankings) {
      lines.push(`     ${r.provider}: ${r.score} pts`);
    }
  }

  if (checkpoint.consensusScore !== undefined) {
    lines.push(`   Consensus: ${checkpoint.consensusScore.toFixed(2)}`);
  }

  return lines.join('\n');
}

// --- Handlers ---

/**
 * Create an interactive CLI handler using readline.
 */
export function createInteractiveHandler(): HITLHandler {
  return async (checkpoint: HITLCheckpoint): Promise<HITLResponse> => {
    console.log('');
    console.log(formatCheckpoint(checkpoint));
    console.log('');

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const promptSuffix =
        checkpoint.phase === 'after-vote'
          ? '[c]ontinue | [i]nject guidance | [o]verride winner | [a]bort > '
          : '[c]ontinue | [i]nject guidance | [a]bort > ';

      const choice = await rl.question(`   ${promptSuffix}`);
      const c = choice.trim().toLowerCase();

      if (c === 'a' || c === 'abort') {
        return { action: 'abort' };
      }

      if (c === 'i' || c === 'inject') {
        const input = await rl.question('   Enter guidance: ');
        return { action: 'inject', input: input.trim() };
      }

      if ((c === 'o' || c === 'override') && checkpoint.phase === 'after-vote') {
        const providers = Object.keys(checkpoint.responses);
        console.log(`   Available providers: ${providers.join(', ')}`);
        const winner = await rl.question('   Override winner: ');
        const trimmed = winner.trim();
        if (providers.includes(trimmed)) {
          return { action: 'continue', overrideWinner: trimmed };
        }
        console.log(`   Unknown provider "${trimmed}", continuing without override.`);
      }

      return { action: 'continue' };
    } finally {
      rl.close();
    }
  };
}

/**
 * Create a non-interactive auto handler (for CI or programmatic use).
 */
export function createAutoHandler(options?: {
  defaultAction?: 'continue' | 'abort';
  abortOnControversy?: boolean;
  controversyThreshold?: number;
}): HITLHandler {
  const defaultAction = options?.defaultAction ?? 'continue';
  const abortOnControversy = options?.abortOnControversy ?? false;
  const threshold = options?.controversyThreshold ?? 0.5;

  return async (checkpoint: HITLCheckpoint): Promise<HITLResponse> => {
    if (
      abortOnControversy &&
      checkpoint.phase === 'on-controversy' &&
      checkpoint.consensusScore !== undefined &&
      checkpoint.consensusScore < threshold
    ) {
      return { action: 'abort' };
    }

    return { action: defaultAction };
  };
}
