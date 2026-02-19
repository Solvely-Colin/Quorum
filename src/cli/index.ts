#!/usr/bin/env node

/**
 * Load environment variables from shell profile if not already set.
 * Sources ~/.zshrc (or equivalent) to pick up exports like API keys.
 */
import { existsSync as _existsSync, readFileSync } from 'node:fs';
import { homedir as _homedir } from 'node:os';
import { join as _join } from 'node:path';
try {
  // Direct approach: parse export lines from shell rc files
  const home = _homedir();
  const rcFiles = ['.zshrc', '.bashrc', '.bash_profile', '.profile']
    .map((f) => _join(home, f))
    .filter(_existsSync);

  for (const rc of rcFiles) {
    const content = readFileSync(rc, 'utf-8');
    for (const line of content.split('\n')) {
      // Match: export KEY=VALUE (with optional quotes)
      const m = line.match(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=["']?([^"'\n]*)["']?\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2];
      }
    }
  }
} catch {
  // Non-fatal
}

import { Command } from 'commander';
import { CLIError } from './helpers.js';
import { registerAskCommand } from './ask.js';
import { registerReviewCommands } from './review.js';
import { registerProvidersCommand } from './providers.js';
import { registerAuthCommand } from './auth.js';
import { registerSessionCommands } from './session.js';
import { registerAnalysisCommands } from './analysis.js';
import { registerGovernanceCommands } from './governance.js';
import { registerDoctorCommand } from './doctor.js';

const program = new Command();

const _pkgVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
).version as string;
program.name('quorum').description('Multi-AI deliberation framework').version(_pkgVersion);

registerProvidersCommand(program);
registerAskCommand(program);
registerReviewCommands(program);
registerAuthCommand(program);
registerSessionCommands(program);
registerAnalysisCommands(program);
registerGovernanceCommands(program);
registerDoctorCommand(program);

// Ensure clean exit after any command (prevents event-loop hangs from dangling handles)
program.hook('postAction', (_thisCommand, actionCommand) => {
  // Don't force-exit for MCP server — it needs to stay running
  if (actionCommand.name() === 'mcp') return;
  process.exit(0);
});

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof CLIError) {
    if (err.message) console.error(err.message);
    process.exit(err.exitCode);
  }
  throw err;
});
