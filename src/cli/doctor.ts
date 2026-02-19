import type { Command } from 'commander';
import pc from 'picocolors';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { parse } from 'yaml';
import { loadConfig, CONFIG_PATH } from '../config.js';
import { createProvider } from '../providers/base.js';
import type { ProviderConfig } from '../types.js';

// ── Types ──────────────────────────────────────────────────────────────────

type Status = 'ok' | 'warn' | 'error';

interface CheckResult {
  status: Status;
  label: string;
  detail: string;
}

// ── Symbols ────────────────────────────────────────────────────────────────

function icon(s: Status): string {
  switch (s) {
    case 'ok':
      return pc.green('✅');
    case 'warn':
      return pc.yellow('⚠️');
    case 'error':
      return pc.red('❌');
  }
}

// ── Individual checks ──────────────────────────────────────────────────────

async function checkConfig(): Promise<CheckResult> {
  const label = 'Config';
  const path = CONFIG_PATH;

  if (!existsSync(path)) {
    return { status: 'error', label, detail: `${path} not found — run \`quorum init\`` };
  }

  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = parse(raw);
    if (!parsed || !Array.isArray(parsed.providers)) {
      return { status: 'error', label, detail: `${path} missing 'providers' array` };
    }
    return { status: 'ok', label, detail: `${tildefy(path)} found and valid` };
  } catch (e: any) {
    return { status: 'error', label, detail: `${tildefy(path)} parse error: ${e.message}` };
  }
}

function checkNodeVersion(): CheckResult {
  const label = 'Node.js';
  const major = parseInt(process.versions.node.split('.')[0], 10);
  const version = `v${process.versions.node}`;
  if (major >= 20) {
    return { status: 'ok', label, detail: `${version} (requires ≥20)` };
  }
  return { status: 'error', label, detail: `${version} — requires ≥20, please upgrade` };
}

async function checkQuorumVersion(): Promise<CheckResult> {
  const label = 'Quorum';
  const pkgPath = new URL('../../package.json', import.meta.url);
  const currentVersion = JSON.parse(readFileSync(pkgPath, 'utf-8')).version as string;

  try {
    const res = await fetch('https://registry.npmjs.org/quorum-ai/latest', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { status: 'warn', label, detail: `v${currentVersion} (couldn't check latest)` };
    }
    const data = (await res.json()) as { version: string };
    const latest = data.version;
    if (currentVersion === latest) {
      return { status: 'ok', label, detail: `v${currentVersion} (latest)` };
    }
    return {
      status: 'warn',
      label,
      detail: `v${currentVersion} — update available: v${latest}`,
    };
  } catch {
    return { status: 'warn', label, detail: `v${currentVersion} (couldn't check latest)` };
  }
}

async function checkProvider(config: ProviderConfig): Promise<CheckResult> {
  const label = config.name;
  const start = Date.now();

  try {
    const adapter = await createProvider(config);
    const result = await adapter.generate('Say "ok".', 'Respond with only the word ok.');
    const elapsed = Date.now() - start;
    if (result && result.length > 0) {
      return { status: 'ok', label, detail: `${config.model} — authenticated, ${elapsed}ms` };
    }
    return { status: 'warn', label, detail: `${config.model} — empty response, ${elapsed}ms` };
  } catch (e: any) {
    const detail = diagnoseError(e, config);
    return { status: 'error', label, detail: `${config.model} — ${detail}` };
  }
}

function diagnoseError(e: any, config: ProviderConfig): string {
  const msg = e.message || String(e);
  const status = e.status || e.statusCode;

  if (status === 401 || msg.includes('401')) return '401 Unauthorized — check API key';
  if (status === 402 || msg.includes('402')) return '402 Insufficient Balance';
  if (status === 403 || msg.includes('403')) return '403 Forbidden — check permissions';
  if (status === 429 || msg.includes('429')) return '429 Rate Limited — try again later';
  if (msg.includes('ECONNREFUSED')) return `connection refused (is ${config.provider} running?)`;
  if (msg.includes('ENOTFOUND')) return 'DNS resolution failed — check network';
  if (msg.includes('ETIMEDOUT') || msg.includes('timed out')) return 'request timed out';
  if (msg.includes('fetch failed')) return 'network error — check connectivity';

  // Truncate long messages
  return msg.length > 100 ? msg.slice(0, 100) + '…' : msg;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function tildefy(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? '~' + path.slice(home.length) : path;
}

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function runDoctor(): Promise<number> {
  const results: CheckResult[] = [];

  // System checks
  const [configResult, versionResult] = await Promise.all([checkConfig(), checkQuorumVersion()]);
  const nodeResult = checkNodeVersion();

  results.push(configResult, nodeResult, versionResult);

  // Provider checks (only if config is valid)
  if (configResult.status !== 'error') {
    const config = await loadConfig();
    if (config.providers.length > 0) {
      const providerResults = await Promise.all(config.providers.map(checkProvider));
      results.push(...providerResults);
    }
  }

  // Print results
  const maxLabel = Math.max(...results.map((r) => r.label.length));
  console.log('');
  for (const r of results) {
    console.log(`${icon(r.status)} ${pad(r.label, maxLabel + 2)}${r.detail}`);
  }

  // Summary
  const ok = results.filter((r) => r.status === 'ok').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  const errors = results.filter((r) => r.status === 'error').length;

  console.log('');
  const parts: string[] = [];
  if (ok > 0) parts.push(pc.green(`${ok} healthy`));
  if (errors > 0) parts.push(pc.red(`${errors} error${errors > 1 ? 's' : ''}`));
  if (warns > 0) parts.push(pc.yellow(`${warns} warning${warns > 1 ? 's' : ''}`));
  console.log(parts.join(', '));
  console.log('');

  return errors > 0 ? 1 : 0;
}

// ── CLI registration ───────────────────────────────────────────────────────

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check your Quorum setup — config, providers, connectivity')
    .action(async () => {
      const exitCode = await runDoctor();
      process.exit(exitCode);
    });
}
