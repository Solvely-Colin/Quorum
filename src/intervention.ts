/**
 * Constitutional Intervention Points — structured human intervention at phase boundaries.
 * Each intervention is attested and recorded in the hash chain.
 */

import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
// existsSync removed — unused
import { join } from 'node:path';

export type InterventionType = 'halt' | 'redirect' | 'inject-evidence' | 'request-clarification';

export interface Intervention {
  /** Type of intervention */
  type: InterventionType;
  /** Phase at which intervention occurred */
  phase: string;
  /** Unix timestamp (ms) */
  timestamp: number;
  /** Human-provided reason / content */
  content: string;
  /** For redirect: modified constraints */
  constraints?: string[];
  /** For inject-evidence: structured evidence data */
  evidence?: Record<string, unknown>;
  /** SHA-256 hash of this intervention (for attestation) */
  hash: string;
}

export interface InterventionPrompt {
  phase: string;
  currentResponses: Record<string, string>;
  voteResults?: {
    winner: string;
    controversial: boolean;
    rankings: Array<{ provider: string; score: number }>;
  };
}

/**
 * Compute hash for an intervention record.
 */
function computeInterventionHash(
  type: InterventionType,
  phase: string,
  timestamp: number,
  content: string,
): string {
  const h = createHash('sha256');
  h.update(`${type}|${phase}|${timestamp}|${content}`);
  return h.digest('hex');
}

/**
 * Create a halt intervention — pause deliberation for external input.
 */
export function createHalt(phase: string, reason: string): Intervention {
  const timestamp = Date.now();
  return {
    type: 'halt',
    phase,
    timestamp,
    content: reason,
    hash: computeInterventionHash('halt', phase, timestamp, reason),
  };
}

/**
 * Create a redirect intervention — reframe with modified constraints.
 */
export function createRedirect(phase: string, reason: string, constraints: string[]): Intervention {
  const timestamp = Date.now();
  const content = `${reason}\nConstraints: ${constraints.join(', ')}`;
  return {
    type: 'redirect',
    phase,
    timestamp,
    content: reason,
    constraints,
    hash: computeInterventionHash('redirect', phase, timestamp, content),
  };
}

/**
 * Create an inject-evidence intervention — add structured data as new context.
 */
export function createInjectEvidence(
  phase: string,
  description: string,
  evidence: Record<string, unknown>,
): Intervention {
  const timestamp = Date.now();
  const content = `${description}\n${JSON.stringify(evidence)}`;
  return {
    type: 'inject-evidence',
    phase,
    timestamp,
    content: description,
    evidence,
    hash: computeInterventionHash('inject-evidence', phase, timestamp, content),
  };
}

/**
 * Create a request-clarification intervention — force explicit uncertainty signaling.
 */
export function createRequestClarification(phase: string, question: string): Intervention {
  const timestamp = Date.now();
  return {
    type: 'request-clarification',
    phase,
    timestamp,
    content: question,
    hash: computeInterventionHash('request-clarification', phase, timestamp, question),
  };
}

/**
 * Save an intervention to the session directory.
 */
export async function saveIntervention(
  sessionDir: string,
  intervention: Intervention,
): Promise<void> {
  const filename = `intervention-${intervention.phase}.json`;
  const filepath = join(sessionDir, filename);
  await writeFile(filepath, JSON.stringify(intervention, null, 2), 'utf-8');
}

/**
 * Load all interventions from a session directory.
 */
export async function loadInterventions(sessionDir: string): Promise<Intervention[]> {
  const { readdir } = await import('node:fs/promises');
  const interventions: Intervention[] = [];
  try {
    const files = await readdir(sessionDir);
    for (const f of files.sort()) {
      if (f.startsWith('intervention-') && f.endsWith('.json')) {
        const data = JSON.parse(await readFile(join(sessionDir, f), 'utf-8'));
        interventions.push(data as Intervention);
      }
    }
  } catch {
    /* directory may not exist */
  }
  return interventions;
}

/**
 * Interactive intervention prompt — asks the user what they want to do at a phase boundary.
 * Returns null if the user chooses to continue without intervention.
 */
export async function promptIntervention(prompt: InterventionPrompt): Promise<Intervention | null> {
  // This requires TTY — check first
  if (!process.stdin.isTTY) return null;

  const { select, input } = await import('@inquirer/prompts');

  console.log('');
  console.log(`\n🛑 Intervention point after ${prompt.phase}`);
  console.log('Current responses:');
  for (const [provider, response] of Object.entries(prompt.currentResponses)) {
    console.log(`  [${provider}]: ${response.slice(0, 120)}...`);
  }

  const action = await select({
    message: 'Choose an action:',
    choices: [
      { name: '▶ Continue (no intervention)', value: 'continue' },
      { name: '⏸ Halt — pause for external input', value: 'halt' },
      { name: '🔄 Redirect — reframe with new constraints', value: 'redirect' },
      { name: '📎 Inject Evidence — add new data/context', value: 'inject-evidence' },
      {
        name: '❓ Request Clarification — force uncertainty signaling',
        value: 'request-clarification',
      },
    ],
  });

  if (action === 'continue') return null;

  if (action === 'halt') {
    const reason = await input({ message: 'Reason for halt:' });
    return createHalt(prompt.phase, reason);
  }

  if (action === 'redirect') {
    const reason = await input({ message: 'Redirect reason:' });
    const constraints = await input({ message: 'New constraints (comma-separated):' });
    return createRedirect(
      prompt.phase,
      reason,
      constraints
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean),
    );
  }

  if (action === 'inject-evidence') {
    const description = await input({ message: 'Evidence description:' });
    const data = await input({ message: 'Evidence data (JSON):' });
    let evidence: Record<string, unknown> = {};
    try {
      evidence = JSON.parse(data);
    } catch {
      evidence = { raw: data };
    }
    return createInjectEvidence(prompt.phase, description, evidence);
  }

  if (action === 'request-clarification') {
    const question = await input({ message: 'Clarification question:' });
    return createRequestClarification(prompt.phase, question);
  }

  return null;
}
