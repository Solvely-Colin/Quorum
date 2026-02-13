/**
 * Hook system for Quorum — run shell commands before/after deliberation phases.
 */

import { execFile } from 'node:child_process';

export interface HookEnv {
  QUORUM_PHASE: string;
  QUORUM_SESSION: string;
  QUORUM_PROVIDERS: string;
  QUORUM_INPUT: string;
  QUORUM_PHASE_OUTPUT?: string;
}

const HOOK_TIMEOUT_MS = 30_000;

/**
 * Run a hook command via /bin/sh -c. Returns stdout.
 * If the hook fails or times out, returns empty string (non-fatal).
 */
export function runHook(hookName: string, command: string, env: HookEnv): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile(
      '/bin/sh',
      ['-c', command],
      {
        timeout: HOOK_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, ...env },
      },
      (error, stdout, _stderr) => {
        if (error) {
          // Non-fatal — resolve with empty string
          resolve('');
          return;
        }
        resolve(stdout);
      },
    );
    // Safety: ensure we always resolve
    child.on('error', () => resolve(''));
  });
}
