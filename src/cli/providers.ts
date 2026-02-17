import type { Command } from 'commander';
import chalk from 'chalk';
import {
  loadConfig,
  saveConfig,
  detectProviders,
  CONFIG_PATH,
} from '../config.js';
import { createProvider } from '../providers/base.js';
import type { ProviderConfig } from '../types.js';
import { CLIError, promptAddProvider } from './helpers.js';

export function registerProvidersCommand(program: Command): void {
  // --- quorum init ---
  program
    .command('init')
    .description('Detect and configure AI providers')
    .option('--non-interactive', 'Skip prompts, auto-configure detected providers')
    .action(async (opts) => {
      console.log('');
      console.log(chalk.bold.cyan('👋 Welcome to Quorum.'));
      console.log('');
      console.log('Scanning for AI providers...');

      const detected = await detectProviders();

      if (detected.length === 0) {
        console.log(chalk.yellow('\nNo providers detected.'));
        console.log(chalk.dim('Set API keys in env (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)'));
        console.log(chalk.dim('Or install Ollama: https://ollama.ai'));
        console.log(chalk.dim('Or install Claude CLI: npm i -g @anthropic-ai/claude-code'));
        return;
      }

      console.log(chalk.green(`\nFound ${detected.length} provider(s):`));
      for (const p of detected) {
        console.log(`  ${chalk.green('✅')} ${chalk.bold(p.name)} — ${p.model}`);
      }

      if (opts.nonInteractive) {
        // Auto-save all detected
        const config = await loadConfig();
        config.providers = detected;
        await saveConfig(config);
        console.log(chalk.green(`\n✅ Saved ${detected.length} providers to ${CONFIG_PATH}`));
      } else {
        // Interactive mode — try inquirer, fall back to auto if not TTY
        if (!process.stdin.isTTY) {
          const config = await loadConfig();
          config.providers = detected;
          await saveConfig(config);
          console.log(chalk.green(`\n✅ Auto-saved (non-TTY). Edit ${CONFIG_PATH} to customize.`));
        } else {
          const { select, confirm } = await import('@inquirer/prompts');
          const action = await select({
            message: 'What would you like to do?',
            choices: [
              { name: 'Use detected providers', value: 'done' },
              { name: 'Add a provider manually', value: 'add' },
            ],
          });

          const providers = [...detected];

          if (action === 'add') {
            let adding = true;
            while (adding) {
              const p = await promptAddProvider();
              if (p) providers.push(p);
              adding = await confirm({ message: 'Add another?', default: false });
            }
          }

          const config = await loadConfig();
          config.providers = providers;
          await saveConfig(config);
          console.log(chalk.green(`\n✅ Saved ${providers.length} providers to ${CONFIG_PATH}`));
        }
      }

      console.log(chalk.dim('Run: quorum ask "your question"'));
      console.log('');
    });

  // --- quorum providers ---
  const providersCmd = program.command('providers').description('Manage AI providers');

  providersCmd
    .command('list')
    .description('List configured providers')
    .action(async () => {
      const config = await loadConfig();
      if (config.providers.length === 0) {
        console.log(chalk.dim('No providers. Run: quorum init'));
        return;
      }
      for (const p of config.providers) {
        const authType = p.auth ? p.auth.method : p.apiKey ? 'api_key' : 'none';
        console.log(`  ${chalk.bold(p.name)} — ${p.provider}/${p.model} (${authType})`);
      }
    });

  providersCmd
    .command('add')
    .description('Add a provider')
    .requiredOption('--name <name>', 'Provider name')
    .requiredOption(
      '--type <type>',
      'Provider type (openai, anthropic, claude-cli, ollama, google, kimi, etc.)',
    )
    .requiredOption('--model <model>', 'Model name')
    .option('--api-key <key>', 'API key')
    .option('--env <var>', 'Environment variable for API key')
    .option('--base-url <url>', 'Base URL (custom/ollama)')
    .action(async (opts) => {
      const auth: ProviderConfig['auth'] = opts.apiKey
        ? { method: 'api_key', apiKey: opts.apiKey as string }
        : opts.env
          ? { method: 'env', envVar: opts.env as string }
          : { method: 'none' };

      const provider: ProviderConfig = {
        name: opts.name as string,
        provider: opts.type as ProviderConfig['provider'],
        model: opts.model as string,
        auth,
        ...(opts.baseUrl ? { baseUrl: opts.baseUrl as string } : {}),
      };

      const config = await loadConfig();
      config.providers = config.providers.filter((p) => p.name !== provider.name);
      config.providers.push(provider);
      await saveConfig(config);
      console.log(chalk.green(`✅ Added ${provider.name}`));
    });

  providersCmd
    .command('models [provider]')
    .description('List available models from pi-ai registry')
    .action(async (provider?: string) => {
      const { getModels } = await import('@mariozechner/pi-ai');
      const providers = provider
        ? [provider]
        : [
            'openai',
            'anthropic',
            'google',
            'kimi-coding',
            'openai-codex',
            'mistral',
            'deepseek',
            'groq',
            'xai',
          ];

      for (const p of providers) {
        try {
          const models = getModels(p as any);
          if (models.length === 0) continue;
          console.log(chalk.bold(`\n${p}`) + chalk.dim(` (${models.length} models)`));
          for (const m of models) {
            const ctx = m.contextWindow
              ? chalk.dim(` ${(m.contextWindow / 1000).toFixed(0)}k ctx`)
              : '';
            const cost = m.cost?.input ? chalk.dim(` $${m.cost.input}/M in`) : '';
            console.log(`  ${m.id}${ctx}${cost}`);
          }
        } catch {
          // Provider not in registry
        }
      }
    });

  providersCmd
    .command('remove <name>')
    .description('Remove a provider')
    .action(async (name: string) => {
      const config = await loadConfig();
      const before = config.providers.length;
      config.providers = config.providers.filter((p) => p.name !== name);
      if (config.providers.length === before) {
        throw new CLIError(chalk.red(`Provider not found: ${name}`));
      }
      await saveConfig(config);
      console.log(chalk.green(`✅ Removed ${name}`));
    });

  providersCmd
    .command('test')
    .description('Test all configured providers')
    .action(async () => {
      const config = await loadConfig();
      for (const p of config.providers) {
        process.stdout.write(`  ${p.name}... `);
        try {
          const adapter = await createProvider(p);
          const response = await adapter.generate(
            'Say "OK" in one word.',
            'You are a helpful assistant. Reply concisely.',
          );
          console.log(chalk.green(`✅ "${response.slice(0, 50)}"`));
        } catch (err) {
          console.log(chalk.red(`❌ ${err instanceof Error ? err.message.slice(0, 80) : 'failed'}`));
        }
      }
    });
}
