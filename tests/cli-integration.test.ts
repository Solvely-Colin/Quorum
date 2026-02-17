import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'index.js');
const PKG = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8'));

async function run(...args: string[]) {
  try {
    const { stdout, stderr } = await exec('node', [CLI, ...args], {
      timeout: 10_000,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout as string) || '',
      stderr: (err.stderr as string) || '',
      exitCode: err.code ?? 1,
    };
  }
}

/** Run CLI with an isolated HOME so it has no config file. */
async function runIsolated(...args: string[]) {
  const tmpHome = await mkdtemp(join(tmpdir(), 'quorum-test-'));
  try {
    const { stdout, stderr } = await exec('node', [CLI, ...args], {
      timeout: 10_000,
      env: {
        ...process.env,
        HOME: tmpHome,
        XDG_CONFIG_HOME: join(tmpHome, '.config'),
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout as string) || '',
      stderr: (err.stderr as string) || '',
      exitCode: err.code ?? 1,
    };
  } finally {
    await rm(tmpHome, { recursive: true, force: true });
  }
}

// ─── Basic CLI ──────────────────────────────────────────────────────────────

describe('Basic CLI', () => {
  it('--version outputs version matching package.json', async () => {
    const { stdout, exitCode } = await run('--version');
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(PKG.version);
  });

  it('--help lists expected top-level commands', async () => {
    const { stdout, exitCode } = await run('--help');
    expect(exitCode).toBe(0);
    for (const cmd of ['ask', 'review', 'providers', 'auth', 'session', 'history']) {
      expect(stdout).toContain(cmd);
    }
  });

  it('unknown command shows error', async () => {
    const { stderr, exitCode } = await run('nonexistent-command-xyz');
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/unknown command|error/i);
  });
});

// ─── Provider Management ────────────────────────────────────────────────────

describe('Provider management', () => {
  it('providers list with no config does not crash', async () => {
    const { exitCode } = await runIsolated('providers', 'list');
    expect(exitCode).toBe(0);
  });
});

// ─── Information Commands (no API keys) ─────────────────────────────────────

describe('Information commands', () => {
  it('attacks lists available attack packs', async () => {
    const { stdout, exitCode } = await run('attacks');
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/attack pack/i);
  });

  it('topologies lists available topologies', async () => {
    const { stdout, exitCode } = await run('topologies');
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/topolog/i);
  });

  it('schema list lists available schemas', async () => {
    const { exitCode } = await run('schema', 'list');
    expect(exitCode).toBe(0);
  });
});

// ─── Error Paths (CLIError) ─────────────────────────────────────────────────

describe('Error paths', () => {
  it('verify with nonexistent session path exits non-zero', async () => {
    const { stderr, exitCode } = await run('verify', '/tmp/nonexistent-session-path-xyz');
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/not found|error/i);
  });

  it('export with nonexistent session exits non-zero', async () => {
    const { stderr, exitCode } = await run('export', '/tmp/nonexistent-session-path-xyz');
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/not found|error/i);
  });

  it('session "last" with no sessions dir exits non-zero', async () => {
    const { stderr, exitCode } = await runIsolated('session', 'last');
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/no sessions|not found|error/i);
  });

  it('history with no sessions dir handles gracefully', async () => {
    const { exitCode } = await runIsolated('history');
    expect(exitCode).toBe(0);
  });
});

// ─── Subcommand Help ────────────────────────────────────────────────────────

describe('Subcommand help', () => {
  it('providers --help shows subcommands', async () => {
    const { stdout, exitCode } = await run('providers', '--help');
    expect(exitCode).toBe(0);
    for (const sub of ['list', 'add', 'models', 'remove', 'test']) {
      expect(stdout).toContain(sub);
    }
  });

  it('auth --help shows subcommands', async () => {
    const { stdout, exitCode } = await run('auth', '--help');
    expect(exitCode).toBe(0);
    for (const sub of ['login', 'list', 'logout']) {
      expect(stdout).toContain(sub);
    }
  });

  it('memory --help shows subcommands', async () => {
    const { stdout, exitCode } = await run('memory', '--help');
    expect(exitCode).toBe(0);
    for (const sub of ['list', 'search', 'clear', 'stats']) {
      expect(stdout).toContain(sub);
    }
  });

  it('policy --help shows subcommands', async () => {
    const { stdout, exitCode } = await run('policy', '--help');
    expect(exitCode).toBe(0);
    for (const sub of ['list', 'check', 'init', 'show', 'validate']) {
      expect(stdout).toContain(sub);
    }
  });

  it('ledger --help shows subcommands', async () => {
    const { stdout, exitCode } = await run('ledger', '--help');
    expect(exitCode).toBe(0);
    for (const sub of ['list', 'verify', 'show', 'export', 'replay']) {
      expect(stdout).toContain(sub);
    }
  });

  it('arena --help shows subcommands', async () => {
    const { stdout, exitCode } = await run('arena', '--help');
    expect(exitCode).toBe(0);
    for (const sub of ['leaderboard', 'show', 'run', 'reset']) {
      expect(stdout).toContain(sub);
    }
  });

  it('attest --help shows subcommands', async () => {
    const { stdout, exitCode } = await run('attest', '--help');
    expect(exitCode).toBe(0);
    for (const sub of ['view', 'diff', 'export']) {
      expect(stdout).toContain(sub);
    }
  });

  it('schema --help shows subcommands', async () => {
    const { stdout, exitCode } = await run('schema', '--help');
    expect(exitCode).toBe(0);
    for (const sub of ['list', 'show', 'create', 'init']) {
      expect(stdout).toContain(sub);
    }
  });
});
