import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import chalk from 'chalk';
import type { ProviderConfig, AgentProfile } from '../types.js';
import { PROVIDER_LIMITS, availableInput } from '../context.js';

export class CLIError extends Error {
  constructor(message: string, public exitCode: number = 1) {
    super(message);
    this.name = 'CLIError';
  }
}

export async function readStdin(timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, _reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      process.stdin.destroy();
      resolve(Buffer.concat(chunks).toString('utf-8'));
    }, timeoutMs);
    process.stdin.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
  });
}

export async function resolveLastSession(sessionsDir: string): Promise<string> {
  if (!existsSync(sessionsDir)) {
    throw new CLIError(chalk.red('No sessions found.'));
  }
  const dirEntries = await readdir(sessionsDir, { withFileTypes: true });
  let latest = '';
  let latestTime = 0;
  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue;
    const metaPath = pathJoin(sessionsDir, entry.name, 'meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
      if ((meta.startedAt ?? 0) > latestTime) {
        latestTime = meta.startedAt;
        latest = pathJoin(sessionsDir, entry.name);
      }
    } catch {
      continue;
    }
  }
  if (!latest) {
    throw new CLIError(chalk.red('No sessions found.'));
  }
  return latest;
}

export async function promptAddProvider(): Promise<ProviderConfig | null> {
  const { select, input, password } = await import('@inquirer/prompts');

  const provider = await select({
    message: 'Provider type:',
    choices: [
      { name: 'OpenAI', value: 'openai' },
      { name: 'Anthropic (API key)', value: 'anthropic' },
      { name: 'Claude CLI', value: 'claude-cli' },
      { name: 'Google Gemini', value: 'google' },
      { name: 'Ollama (local)', value: 'ollama' },
      { name: 'Kimi Code', value: 'kimi' },
      { name: 'DeepSeek', value: 'deepseek' },
      { name: 'Mistral', value: 'mistral' },
      { name: 'Groq', value: 'groq' },
      { name: 'xAI (Grok)', value: 'xai' },
      { name: 'Custom (OpenAI-compatible)', value: 'custom' },
    ],
  });

  const defaults: Record<string, { model: string; needsKey: boolean }> = {
    openai: { model: 'gpt-4o', needsKey: true },
    anthropic: { model: 'claude-sonnet-4-20250514', needsKey: true },
    'claude-cli': { model: 'claude-sonnet-4-20250514', needsKey: false },
    google: { model: 'gemini-2.0-flash', needsKey: true },
    ollama: { model: 'qwen2.5:14b', needsKey: false },
    kimi: { model: 'kimi-k2-0520', needsKey: true },
    deepseek: { model: 'deepseek-chat', needsKey: true },
    mistral: { model: 'mistral-large-latest', needsKey: true },
    groq: { model: 'llama-3.3-70b-versatile', needsKey: true },
    xai: { model: 'grok-3', needsKey: true },
    custom: { model: '', needsKey: true },
  };

  const def = defaults[provider];
  const name = await input({ message: 'Name:', default: provider });
  const model = await input({ message: 'Model:', default: def.model });

  let auth: ProviderConfig['auth'] = { method: 'none' };

  if (def.needsKey) {
    const method = await select({
      message: 'Auth method:',
      choices: [
        { name: 'Environment variable', value: 'env' as const },
        { name: 'API key (paste)', value: 'api_key' as const },
      ],
    });

    if (method === 'api_key') {
      const key = await password({ message: 'API key:', mask: '*' });
      auth = { method: 'api_key', apiKey: key };
    } else {
      const envDefault = provider === 'kimi' ? 'KIMI_API_KEY' : `${provider.toUpperCase()}_API_KEY`;
      const envVar = await input({ message: 'Env var:', default: envDefault });
      auth = { method: 'env', envVar };
    }
  }

  let baseUrl: string | undefined;
  if (provider === 'custom' || provider === 'ollama') {
    const url = await input({
      message: 'Base URL:',
      default: provider === 'ollama' ? 'http://localhost:11434' : '',
    });
    baseUrl = url || undefined;
  }

  return {
    name,
    provider: provider as ProviderConfig['provider'],
    model,
    auth,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export function displayDryRun(
  profile: AgentProfile,
  providers: ProviderConfig[],
  singleMode: boolean,
  projectConfigPath?: string,
): void {
  console.log('');
  console.log(chalk.bold.cyan('🔍 Dry Run Preview'));
  console.log('');

  if (projectConfigPath) {
    console.log(chalk.dim(`📁 Project config loaded: ${projectConfigPath}`));
    console.log('');
  }

  // Profile info
  console.log(chalk.bold('Profile:'));
  console.log(`  Name: ${chalk.green(profile.name)}`);
  console.log(`  Challenge style: ${profile.challengeStyle}`);
  console.log(`  Focus: ${profile.focus.join(', ') || '(none)'}`);
  console.log(`  Rounds: ${profile.rounds}`);
  if (profile.convergenceThreshold !== undefined) {
    console.log(`  Convergence threshold: ${profile.convergenceThreshold}`);
  }
  if (profile.excludeFromDeliberation?.length) {
    console.log(`  Excluded: ${profile.excludeFromDeliberation.join(', ')}`);
  }
  if (profile.weights && Object.keys(profile.weights).length > 0) {
    console.log(
      `  Weights: ${Object.entries(profile.weights)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`,
    );
  }
  console.log('');

  // Providers
  console.log(chalk.bold('Providers:'));
  for (const p of providers) {
    const limits = PROVIDER_LIMITS[p.provider] ?? { contextLength: 32_000, outputReserve: 4_096 };
    const inputBudget = availableInput(p.provider, 500);
    const inputBudgetK = (inputBudget / 1000).toFixed(0);
    const ctxK = (limits.contextLength / 1000).toFixed(0);
    console.log(
      `  ${chalk.green('✓')} ${chalk.bold(p.name)} ${chalk.dim(`(${p.provider}/${p.model})`)}`,
    );
    console.log(
      `    Context: ${ctxK}k tokens | Output reserve: ${limits.outputReserve} | Input budget: ~${inputBudgetK}k tokens`,
    );
    if (p.timeout) console.log(`    Timeout: ${p.timeout}s`);
  }
  console.log('');

  // Phase pipeline
  if (singleMode) {
    console.log(chalk.bold('Pipeline:'));
    console.log('  Single provider mode — direct query, no deliberation');
  } else {
    const phases = [
      'GATHER',
      'PLAN',
      'FORMULATE',
      'DEBATE',
      'ADJUST',
      'REBUTTAL',
      'VOTE',
      'SYNTHESIZE',
    ];
    console.log(chalk.bold('Phase Pipeline:'));
    for (let i = 0; i < phases.length; i++) {
      const arrow = i < phases.length - 1 ? ' →' : '';
      console.log(`  ${i + 1}. ${phases[i]}${arrow}`);
    }
    console.log(chalk.dim(`  (REBUTTAL may be skipped if convergence threshold met)`));
  }

  console.log('');
  console.log(chalk.dim('No API calls were made.'));
  console.log('');
}
