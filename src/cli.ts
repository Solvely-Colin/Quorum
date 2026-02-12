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
    .map(f => _join(home, f))
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
import chalk from 'chalk';
import { loadConfig, saveConfig, detectProviders, loadAgentProfile, loadProjectConfig, CONFIG_PATH } from './config.js';
import type { ProjectConfig } from './config.js';
import { CouncilV2 } from './council-v2.js';
import type { AdaptivePreset } from './adaptive.js';
import { createProvider } from './providers/base.js';
import { writeFile, readFile, readdir } from 'node:fs/promises';
const existsSync = _existsSync;
import type { ProviderConfig, AgentProfile } from './types.js';
import { join as pathJoin, extname } from 'node:path';
import { homedir } from 'node:os';
import { listOAuthProfiles, removeOAuthProfile, startDeviceFlow, AUTH_PATH } from './auth.js';
import { PROVIDER_LIMITS, estimateTokens, availableInput } from './context.js';
import { getGitDiff, getPrDiff, getGitContext } from './git.js';
import { formatRedTeamReport, listAttackPacks, loadAttackPack, type RedTeamResult } from './redteam.js';
import { listTopologies } from './topology.js';

const program = new Command();

program
  .name('quorum')
  .description('Multi-AI deliberation framework')
  .version('0.1.0');

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
        const inquirer = await import('inquirer');
        const { action } = await inquirer.default.prompt<{ action: string }>([{
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: 'Use detected providers', value: 'done' },
            { name: 'Add a provider manually', value: 'add' },
          ],
        }]);

        let providers = [...detected];

        if (action === 'add') {
          let adding = true;
          while (adding) {
            const p = await promptAddProvider();
            if (p) providers.push(p);
            const { more } = await inquirer.default.prompt<{ more: boolean }>([
              { type: 'confirm', name: 'more', message: 'Add another?', default: false },
            ]);
            adding = more;
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

// --- quorum ask ---
program
  .command('ask')
  .description('Ask the council a question')
  .argument('[question]', 'Question to ask (or pipe via stdin)')
  .option('-p, --providers <names>', 'Comma-separated provider names')
  .option('--profile <name>', 'Agent profile (default, brainstorm, code-review, research)', 'default')
  .option('-1, --single [name]', 'Single provider mode (skip deliberation)')
  .option('-v, --verbose', 'Show phase-by-phase progress')
  .option('--audit <path>', 'Save full session JSON to file')
  .option('--json', 'Output result as JSON (for piping)')
  .option('--timeout <seconds>', 'Override per-provider timeout in seconds')
  .option('-r, --rapid', 'Rapid mode — skip plan, formulate, adjust, rebuttal, vote phases')
  .option('--devils-advocate', 'Assign one provider as devil\'s advocate')
  .option('--dry-run', 'Preview what would happen without making API calls')
  .option('--challenge-style <style>', 'Override profile challengeStyle (adversarial|collaborative|socratic)')
  .option('--focus <topics>', 'Comma-separated list to override profile focus')
  .option('--convergence <threshold>', 'Override convergenceThreshold (0.0-1.0)')
  .option('--rounds <n>', 'Override number of rounds')
  .option('--weight <weights>', 'Comma-separated provider weight multipliers (e.g. claude=2,openai=1,ollama=0.5)')
  .option('--voting-method <method>', 'Voting method: borda, ranked-choice, approval, condorcet')
  .option('--heatmap', 'Show consensus heatmap (default: on when 3+ providers)')
  .option('--no-heatmap', 'Disable consensus heatmap')
  .option('--no-hooks', 'Skip all pre/post hooks defined in the profile')
  .option('--tools', 'Enable tool use in gather phase (web search, file reading)')
  .option('--allow-shell', 'Enable shell tool (requires --tools)')
  .option('--evidence <mode>', 'Evidence-backed claims mode: off, advisory, strict')
  .option('--adaptive <preset>', 'Adaptive debate controller: fast, balanced, critical, off')
  .option('--red-team', 'Enable adversarial red-team analysis')
  .option('--attack-pack <packs>', 'Comma-separated attack packs (general, code, security, legal, medical)')
  .option('--custom-attacks <attacks>', 'Comma-separated custom attack prompts')
  .option('--topology <name>', 'Debate topology: mesh, star, tournament, map_reduce, adversarial_tree, pipeline, panel')
  .option('--topology-hub <provider>', 'Hub provider for star topology')
  .option('--topology-moderator <provider>', 'Moderator for panel topology')
  .option('--no-memory', 'Skip deliberation memory (no retrieval or storage)')
  .action(async (question: string | undefined, opts) => {
    // Read from stdin if no question arg
    if (!question) {
      if (process.stdin.isTTY) {
        console.error(chalk.red('No question provided. Usage: quorum ask "your question"'));
        console.error(chalk.dim('Or pipe: echo "question" | quorum ask'));
        process.exit(1);
      }
      question = await readStdin();
      if (!question.trim()) {
        console.error(chalk.red('Empty input.'));
        process.exit(1);
      }
    }

    const config = await loadConfig();
    const projectConfig = await loadProjectConfig();

    if (config.providers.length === 0) {
      console.error(chalk.red('No providers configured. Run: quorum init'));
      process.exit(1);
    }

    // Apply project config defaults (CLI flags will override later)
    if (projectConfig) {
      if (projectConfig.profile && !opts.profile) {
        // Only override if user didn't pass --profile (commander default is 'default')
        // We check if it's still the commander default
      }
      if (projectConfig.profile && opts.profile === 'default') {
        opts.profile = projectConfig.profile;
      }
      if (projectConfig.providers && !opts.providers) {
        opts.providers = projectConfig.providers.join(',');
      }
      if (projectConfig.focus && !opts.focus) {
        opts.focus = projectConfig.focus.join(',');
      }
      if (projectConfig.challengeStyle && !opts.challengeStyle) {
        opts.challengeStyle = projectConfig.challengeStyle;
      }
      if (projectConfig.rounds && !opts.rounds) {
        opts.rounds = String(projectConfig.rounds);
      }
    }

    // Apply timeout override
    const timeoutOverride = opts.timeout ? parseInt(opts.timeout as string) : undefined;
    if (timeoutOverride !== undefined) {
      if (isNaN(timeoutOverride) || timeoutOverride <= 0) {
        console.error(chalk.red(`Invalid --timeout value: "${opts.timeout}". Must be a positive number of seconds.`));
        process.exit(1);
      }
      for (const p of config.providers) {
        p.timeout = timeoutOverride;
      }
    }

    // Filter providers
    let providers = config.providers;
    if (opts.providers) {
      const names = (opts.providers as string).split(',').map(s => s.trim());
      providers = config.providers.filter(p => names.includes(p.name));
      if (providers.length === 0) {
        console.error(chalk.red(`No matching providers: ${opts.providers}`));
        console.error(chalk.dim(`Available: ${config.providers.map(p => p.name).join(', ')}`));
        process.exit(1);
      }
    }

    const isJSON = opts.json;

    // Load agent profile
    const profile = await loadAgentProfile(opts.profile as string);
    if (!profile) {
      // Scan actual profile search paths for available profiles
      const { fileURLToPath } = await import('node:url');
      const { dirname } = await import('node:path');
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const builtinDir = pathJoin(__dirname, '..', 'agents');
      const searchDirs = [
        pathJoin(process.cwd(), 'agents'),
        pathJoin(homedir(), '.quorum', 'agents'),
        builtinDir,
      ];
      const available = new Set<string>();
      for (const dir of searchDirs) {
        try {
          const files = await readdir(dir);
          for (const f of files) {
            if (f.endsWith('.yaml')) available.add(f.replace(/\.yaml$/, ''));
          }
        } catch { /* dir doesn't exist */ }
      }
      console.error(chalk.red(`Profile not found: ${opts.profile}`));
      console.error(chalk.dim(`Available: ${available.size > 0 ? [...available].join(', ') : '(none found)'}`));
      process.exit(1);
    }

    // Apply CLI profile overrides
    if (opts.challengeStyle) {
      const style = opts.challengeStyle as string;
      if (!['adversarial', 'collaborative', 'socratic'].includes(style)) {
        console.error(chalk.red(`Invalid --challenge-style: "${style}". Must be adversarial, collaborative, or socratic.`));
        process.exit(1);
      }
      profile.challengeStyle = style as AgentProfile['challengeStyle'];
    }
    if (opts.focus) {
      profile.focus = (opts.focus as string).split(',').map(s => s.trim()).filter(Boolean);
    }
    if (opts.convergence) {
      const val = parseFloat(opts.convergence as string);
      if (isNaN(val) || val < 0 || val > 1) {
        console.error(chalk.red(`Invalid --convergence: "${opts.convergence}". Must be 0.0-1.0.`));
        process.exit(1);
      }
      profile.convergenceThreshold = val;
    }
    if (opts.rounds) {
      const val = parseInt(opts.rounds as string);
      if (isNaN(val) || val <= 0) {
        console.error(chalk.red(`Invalid --rounds: "${opts.rounds}". Must be a positive integer.`));
        process.exit(1);
      }
      profile.rounds = val;
    }

    if (opts.tools) {
      profile.tools = true;
    }
    if (opts.allowShell) {
      profile.tools = true;
      profile.allowShellTool = true;
    }

    // Evidence mode override
    if (opts.evidence) {
      const mode = opts.evidence as string;
      if (!['off', 'advisory', 'strict'].includes(mode)) {
        console.error(chalk.red(`Invalid --evidence: "${mode}". Must be off, advisory, or strict.`));
        process.exit(1);
      }
      profile.evidence = mode as 'off' | 'advisory' | 'strict';
    }

    // Parse --weight flag into weights record
    let weights: Record<string, number> | undefined;
    if (opts.weight) {
      weights = {};
      for (const pair of (opts.weight as string).split(',')) {
        const [name, val] = pair.split('=');
        if (!name || !val || isNaN(parseFloat(val))) {
          console.error(chalk.red(`Invalid --weight entry: "${pair}". Expected format: name=number`));
          process.exit(1);
        }
        weights[name.trim()] = parseFloat(val);
      }
    }
    // CLI weights override profile weights
    if (weights) {
      profile.weights = weights;
    }

    // Voting method override
    if (opts.votingMethod) {
      const vm = opts.votingMethod as string;
      if (!['borda', 'ranked-choice', 'approval', 'condorcet'].includes(vm)) {
        console.error(chalk.red(`Invalid --voting-method: "${vm}". Must be borda, ranked-choice, approval, or condorcet.`));
        process.exit(1);
      }
      profile.votingMethod = vm as AgentProfile['votingMethod'];
    }

    // Dry run for single mode (before candidateProviders is computed)
    if (opts.dryRun && opts.single) {
      displayDryRun(profile, providers, true, projectConfig?.path);
      return;
    }

    // Single-provider mode — quick ask, no deliberation
    if (opts.single) {
      const targetName = typeof opts.single === 'string' ? opts.single : providers[0]?.name;
      const target = config.providers.find(p => p.name === targetName) ?? providers[0];
      if (!target) {
        console.error(chalk.red('No provider available.'));
        process.exit(1);
      }
      const adapter = await createProvider(target);
      if (!isJSON) {
        console.log(chalk.dim(`[${target.name}/${target.model}]`));
        console.log('');
      }
      try {
        const sys = profile?.focus?.length ? `You are an expert in: ${profile.focus.join(', ')}.` : undefined;
        if (!isJSON && adapter.generateStream) {
          // Stream output to terminal
          await adapter.generateStream(question!, sys, (delta) => {
            process.stdout.write(delta);
          });
          console.log(''); // newline after stream
        } else {
          const result = await adapter.generate(question!, sys);
          if (isJSON) {
            console.log(JSON.stringify({ provider: target.name, response: result }));
          } else {
            console.log(result);
          }
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
      return;
    }

    // ── Filter excluded providers and create adapters once ──
    const excluded = new Set(profile.excludeFromDeliberation?.map(s => s.toLowerCase()) ?? []);
    const candidateProviders = providers.filter(
      p => !excluded.has(p.name.toLowerCase()) && !excluded.has(p.provider.toLowerCase()),
    );

    // Dry run mode — show preview and exit
    if (opts.dryRun) {
      displayDryRun(profile, candidateProviders, false, projectConfig?.path);
      return;
    }

    if (!isJSON) {
      console.log('');
      console.log(chalk.bold.cyan(`🏛️  ${profile.name}`));
      console.log(chalk.dim('Configured providers:'));
      for (const p of candidateProviders) {
        console.log(`  ${chalk.green('✓')} ${chalk.bold(p.name)} ${chalk.dim(`(${p.model})`)}`);
      }
    }

    if (candidateProviders.length < 2) {
      console.error(chalk.red(`\nNeed 2+ providers for deliberation (${candidateProviders.length} configured). Run: quorum providers test`));
      process.exit(1);
    }

    // Create adapters once — pass into CouncilV2
    const adapters = await Promise.all(candidateProviders.map(p => createProvider(p)));

    if (!isJSON) {
      console.log('');
      console.log(chalk.dim(`${adapters.length} providers ready | Style: ${profile.challengeStyle}`));
      console.log('');
    }

    // Track phase timing for compact progress
    const phaseStartTimes: Record<string, number> = {};
    const providersDone: Record<string, string[]> = {};
    const council = new CouncilV2(adapters, candidateProviders, profile, {
      streaming: true,
      rapid: opts.rapid ?? false,
      devilsAdvocate: opts.devilsAdvocate ?? profile.devilsAdvocate ?? false,
      weights: profile.weights,
      noHooks: opts.hooks === false,
      noMemory: opts.memory === false,
      adaptive: (opts.adaptive as AdaptivePreset) || undefined,
      redTeam: opts.redTeam || undefined,
      attackPacks: opts.attackPack ? (opts.attackPack as string).split(',').map((s: string) => s.trim()) : undefined,
      customAttacks: opts.customAttacks ? (opts.customAttacks as string).split(',').map((s: string) => s.trim()) : undefined,
      topology: opts.topology as any || undefined,
      topologyConfig: {
        ...(opts.topologyHub ? { hub: opts.topologyHub as string } : {}),
        ...(opts.topologyModerator ? { moderator: opts.topologyModerator as string } : {}),
      },
      onEvent(event, data) {
        if (isJSON) return;
        const d = data as Record<string, unknown>;
        switch (event) {
          case 'phase': {
            const phase = d.phase as string;
            phaseStartTimes[phase] = Date.now();
            providersDone[phase] = [];
            process.stdout.write(chalk.bold(`  ▸ ${phase} `));
            break;
          }
          case 'response': {
            const provider = d.provider as string;
            const fallback = d.fallback ? chalk.yellow('⚠') : chalk.green('✓');
            process.stdout.write(`${fallback}${chalk.dim(provider)} `);
            break;
          }
          case 'phase:done': {
            const secs = ((d.duration as number) / 1000).toFixed(1);
            console.log(chalk.dim(`(${secs}s)`));
            break;
          }
          case 'tool': {
            const toolInput = String(d.input).slice(0, 60);
            console.log(chalk.dim(`  🔧 ${d.provider} → ${d.tool}(${toolInput})`));
            break;
          }
          case 'evidence': {
            const report = d.report as { provider: string; supportedClaims: number; unsupportedClaims: number; totalClaims: number; evidenceScore: number };
            console.log(chalk.dim(`  📋 ${report.provider}: ${report.supportedClaims}/${report.totalClaims} claims supported (${Math.round(report.evidenceScore * 100)}%)`));
            break;
          }
          case 'adaptive': {
            const { phase, decision } = d as { phase: string; decision: { action: string; reason: string; entropy: number } };
            const entropyPct = Math.round(decision.entropy * 100);
            if (decision.action === 'continue') {
              // Don't clutter output for continue decisions
            } else {
              console.log(chalk.yellow(`  ⚡ ADAPTIVE: ${decision.reason} (entropy: ${entropyPct}%)`));
            }
            break;
          }
          case 'redTeam': {
            const { result } = d as { result: RedTeamResult };
            console.log('');
            console.log(formatRedTeamReport(result));
            break;
          }
          case 'topology': {
            const { topology, description, phases } = d as { topology: string; description: string; phases: number };
            console.log(chalk.cyan(`\n🔷 Topology: ${topology} — ${description} (${phases} phases)`));
            break;
          }
          case 'devilsAdvocate':
            console.log(chalk.magenta(`  😈 Devil's advocate: ${d.provider}`));
            break;
          case 'synthesizer':
            console.log(chalk.dim(`  ℹ Synthesizer: ${d.provider} (${d.reason})`));
            break;
          case 'memory':
            console.log(chalk.dim(`  🧠 Found ${(d as any).count} relevant prior deliberation(s)`));
            break;
          case 'contradictions':
            console.log(chalk.yellow('\n  ⚠ Contradictions with prior deliberations:'));
            for (const c of (d as any).contradictions) {
              console.log(chalk.yellow(`    → ${c}`));
            }
            break;
          case 'votes': {
            const v = d as unknown as { rankings: Array<{ provider: string; score: number }>; winner: string; controversial: boolean };
            console.log('');
            console.log(chalk.bold('  🗳️  Results'));
            const maxScore = v.rankings[0]?.score || 1;
            for (const r of v.rankings) {
              const bar = '█'.repeat(Math.round((r.score / maxScore) * 12));
              const crown = r.provider === v.winner ? ' 👑' : '';
              console.log(`     ${chalk.dim(r.provider.padEnd(10))} ${chalk.cyan(bar)} ${r.score}${crown}`);
            }
            if (v.controversial) console.log(chalk.yellow('     ⚠ Close vote — positions nearly tied'));
            if ((v as any).votingDetails) {
              console.log(chalk.dim(`     Method: ${(v as any).votingDetails.split('\n')[0]}`));
            }
            break;
          }
          case 'heatmap':
            if (opts.heatmap !== false) {
              console.log(d.heatmap as string);
            }
            break;
          case 'complete':
            console.log(chalk.dim(`\n  ⏱  ${((d.duration as number) / 1000).toFixed(1)}s total`));
            break;
          case 'hook': {
            const hookOutput = d.output ? `: ${String(d.output).slice(0, 80)}` : '';
            console.log(chalk.dim(`  🪝 ${d.name}${hookOutput}`));
            break;
          }
          case 'warn':
            if (opts.verbose) {
              console.log(chalk.yellow(`\n  ⚠ ${d.message}`));
            }
            break;
        }
      },
    });

    try {
      const result = await council.deliberate(question);

      if (isJSON) {
        console.log(JSON.stringify({
          synthesis: result.synthesis.content,
          synthesizer: result.synthesis.synthesizer,
          consensus: result.synthesis.consensusScore,
          confidence: result.synthesis.confidenceScore,
          controversial: result.votes.controversial,
          winner: result.votes.winner,
          rankings: result.votes.rankings,
          minorityReport: result.synthesis.minorityReport,
          duration: result.duration,
          sessionPath: result.sessionPath,
        }, null, 2));
      } else {
        // ── Final output ──
        console.log('');
        console.log(chalk.bold.green('━'.repeat(60)));
        console.log('');

        // Strip metadata sections from synthesis content for clean display
        let displayContent = result.synthesis.content;
        for (const heading of ['## Minority Report', '## Scores', '## Minority']) {
          const idx = displayContent.indexOf(heading);
          if (idx > 0) displayContent = displayContent.slice(0, idx).trimEnd();
        }
        displayContent = displayContent.replace(/^##\s*Synthesis\s*\n+/i, '');
        console.log(displayContent);

        if (result.synthesis.minorityReport && result.synthesis.minorityReport !== 'None' && result.synthesis.minorityReport.trim()) {
          console.log('');
          console.log(chalk.bold.yellow('── Minority Report ──'));
          console.log(result.synthesis.minorityReport);
        }

        if (result.synthesis.whatWouldChange && result.synthesis.whatWouldChange.trim()) {
          console.log('');
          console.log(chalk.bold.magenta('── What Would Change My Mind ──'));
          console.log(result.synthesis.whatWouldChange);
        }

        console.log('');
        console.log(chalk.bold.green('━'.repeat(60)));
        const meta = [
          `Winner: ${result.votes.winner}`,
          `Synthesized by: ${result.synthesis.synthesizer}`,
          `Consensus: ${result.synthesis.consensusScore}`,
          `Confidence: ${result.synthesis.confidenceScore}`,
        ].join(' | ');
        console.log(chalk.dim(meta));
        // Evidence summary
        if (profile.evidence && profile.evidence !== 'off') {
          try {
            const { readFile: rf } = await import('node:fs/promises');
            const { join: pjoin } = await import('node:path');
            const reportData = JSON.parse(await rf(pjoin(result.sessionPath, 'evidence-report.json'), 'utf-8')) as Array<{ provider: string; evidenceScore: number }>;
            if (reportData.length > 0) {
              const summary = reportData.map((r: { provider: string; evidenceScore: number }) => `${r.provider} ${Math.round(r.evidenceScore * 100)}%`).join(', ');
              console.log(chalk.dim(`Evidence scores: ${summary}`));
            }
          } catch { /* no evidence report */ }
        }
        if (opts.adaptive && opts.adaptive !== 'off') {
          try {
            const { readFile: rf } = await import('node:fs/promises');
            const { join: pjoin } = await import('node:path');
            const adaptiveData = JSON.parse(
              await rf(pjoin(result.sessionPath, 'adaptive-decisions.json'), 'utf-8')
            ) as { decisions: Array<{ action: string; reason: string; entropy: number }>; entropyHistory: Record<string, number> };
            const nonContinue = adaptiveData.decisions.filter(d => d.action !== 'continue');
            if (nonContinue.length > 0) {
              console.log(chalk.yellow(`\nAdaptive decisions: ${nonContinue.length}`));
              for (const d of nonContinue) {
                console.log(chalk.dim(`  ⚡ ${d.action}: ${d.reason}`));
              }
            }
          } catch { /* no adaptive data */ }
        }
        console.log(chalk.dim(`Session: ${result.sessionPath}`));
        console.log('');
      }

      if (opts.audit) {
        await writeFile(opts.audit as string, JSON.stringify(result, null, 2), 'utf-8');
        if (!isJSON) console.log(chalk.dim(`Audit saved to ${opts.audit}`));
      }
    } catch (err) {
      console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  });

// --- quorum review ---
program
  .command('review')
  .description('Review files or code diffs with the council')
  .argument('[files...]', 'File paths to review')
  .option('-p, --providers <names>', 'Comma-separated provider names')
  .option('--profile <name>', 'Agent profile', 'code-review')
  .option('-1, --single [name]', 'Single provider mode (skip deliberation)')
  .option('-v, --verbose', 'Show phase-by-phase progress')
  .option('--audit <path>', 'Save full session JSON to file')
  .option('--json', 'Output result as JSON (for piping)')
  .option('--timeout <seconds>', 'Override per-provider timeout in seconds')
  .option('-r, --rapid', 'Rapid mode — skip plan, formulate, adjust, rebuttal, vote phases')
  .option('--devils-advocate', 'Assign one provider as devil\'s advocate')
  .option('--diff [ref]', 'Review diff against a ref (defaults to HEAD)')
  .option('--staged', 'Review staged changes (git diff --cached)')
  .option('--pr <number>', 'Review a GitHub PR (requires gh CLI)')
  .option('--dry-run', 'Preview what would happen without making API calls')
  .option('--challenge-style <style>', 'Override profile challengeStyle (adversarial|collaborative|socratic)')
  .option('--focus <topics>', 'Comma-separated list to override profile focus')
  .option('--convergence <threshold>', 'Override convergenceThreshold (0.0-1.0)')
  .option('--rounds <n>', 'Override number of rounds')
  .option('--adaptive <preset>', 'Adaptive debate controller: fast, balanced, critical, off')
  .option('--red-team', 'Enable adversarial red-team analysis')
  .option('--attack-pack <packs>', 'Comma-separated attack packs (general, code, security, legal, medical)')
  .option('--topology <name>', 'Debate topology: mesh, star, tournament, map_reduce, adversarial_tree, pipeline, panel')
  .option('--topology-hub <provider>', 'Hub provider for star topology')
  .option('--topology-moderator <provider>', 'Moderator for panel topology')
  .option('--no-memory', 'Skip deliberation memory (no retrieval or storage)')
  .action(async (files: string[], opts) => {
    let content = '';
    let gitContextStr = '';

    // Get git context for system prompt enrichment
    const gitCtx = await getGitContext();
    if (gitCtx) {
      gitContextStr = `Repository: ${gitCtx.repoName} | Branch: ${gitCtx.branch}`;
    }

    // Git integration modes
    if (opts.staged) {
      try {
        const diff = await getGitDiff({ staged: true });
        if (!diff.trim()) {
          console.log(chalk.yellow('No staged changes found.'));
          process.exit(0);
        }
        content = `## Git Diff (staged changes)\n${gitContextStr ? `\n${gitContextStr}\n` : ''}\n\`\`\`diff\n${diff}\n\`\`\`\n`;
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    } else if (opts.diff !== undefined) {
      try {
        const ref = typeof opts.diff === 'string' ? opts.diff : 'HEAD';
        const diff = await getGitDiff({ ref });
        if (!diff.trim()) {
          console.log(chalk.yellow(`No diff found against ${ref}.`));
          process.exit(0);
        }
        content = `## Git Diff (vs ${ref})\n${gitContextStr ? `\n${gitContextStr}\n` : ''}\n\`\`\`diff\n${diff}\n\`\`\`\n`;
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    } else if (opts.pr) {
      try {
        const pr = await getPrDiff(opts.pr as string);
        if (!pr.diff.trim()) {
          console.log(chalk.yellow(`PR #${opts.pr} has no diff.`));
          process.exit(0);
        }
        content = `## Pull Request #${opts.pr}: ${pr.title}\n${gitContextStr ? `\n${gitContextStr}\n` : ''}`;
        if (pr.body.trim()) {
          content += `\n### Description\n${pr.body}\n`;
        }
        content += `\n### Diff\n\`\`\`diff\n${pr.diff}\n\`\`\`\n`;
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    } else {
      // Original behavior: piped input or file arguments
      if (!process.stdin.isTTY) {
        const stdinContent = await readStdin();
        if (stdinContent.trim()) {
          content = stdinContent;
        }
      }

      if (files.length > 0) {
        for (const filePath of files) {
          if (!existsSync(filePath)) {
            console.error(chalk.red(`File not found: ${filePath}`));
            process.exit(1);
          }
          const fileContent = await readFile(filePath, 'utf-8');
          const ext = extname(filePath).slice(1) || 'text';
          content += `## File: ${filePath}\n\`\`\`${ext}\n${fileContent}\n\`\`\`\n\n`;
        }
      }

      if (!content.trim()) {
        console.error(chalk.red('No input provided. Pass file paths, pipe content, or use --staged/--diff/--pr.'));
        console.error(chalk.dim('Usage: quorum review src/api.ts src/utils.ts'));
        console.error(chalk.dim('   or: quorum review --staged'));
        console.error(chalk.dim('   or: quorum review --diff main'));
        console.error(chalk.dim('   or: quorum review --pr 42'));
        process.exit(1);
      }
    }

    // Delegate to ask command logic by invoking program
    const askArgs = ['ask', content];
    askArgs.push('--profile', opts.profile as string);
    if (opts.providers) { askArgs.push('--providers', opts.providers as string); }
    if (opts.single !== undefined) { askArgs.push('--single', typeof opts.single === 'string' ? opts.single : ''); }
    if (opts.verbose) { askArgs.push('--verbose'); }
    if (opts.audit) { askArgs.push('--audit', opts.audit as string); }
    if (opts.json) { askArgs.push('--json'); }
    if (opts.timeout) { askArgs.push('--timeout', opts.timeout as string); }
    if (opts.dryRun) { askArgs.push('--dry-run'); }
    if (opts.rapid) { askArgs.push('--rapid'); }
    if (opts.devilsAdvocate) { askArgs.push('--devils-advocate'); }
    if (opts.challengeStyle) { askArgs.push('--challenge-style', opts.challengeStyle as string); }
    if (opts.focus) { askArgs.push('--focus', opts.focus as string); }
    if (opts.convergence) { askArgs.push('--convergence', opts.convergence as string); }
    if (opts.rounds) { askArgs.push('--rounds', opts.rounds as string); }
    if (opts.adaptive) { askArgs.push('--adaptive', opts.adaptive as string); }
    if (opts.redTeam) { askArgs.push('--red-team'); }
    if (opts.attackPack) { askArgs.push('--attack-pack', opts.attackPack as string); }
    if (opts.topology) { askArgs.push('--topology', opts.topology as string); }
    if (opts.topologyHub) { askArgs.push('--topology-hub', opts.topologyHub as string); }
    if (opts.topologyModerator) { askArgs.push('--topology-moderator', opts.topologyModerator as string); }
    if (opts.memory === false) { askArgs.push('--no-memory'); }

    await program.parseAsync(['node', 'quorum', ...askArgs]);
  });

// --- quorum ci ---
program
  .command('ci')
  .description('CI/CD-optimized code review with structured output and exit codes')
  .option('--pr <number>', 'Review a GitHub PR (requires gh CLI)')
  .option('--diff [ref]', 'Review diff against a ref (defaults to HEAD)')
  .option('--staged', 'Review staged changes (git diff --cached)')
  .option('--confidence-threshold <number>', 'Exit code 1 if confidence below this (0-1)', '0')
  .option('--format <type>', 'Output format: json, markdown, github', 'github')
  .option('--post-comment', 'Post result as PR comment via gh')
  .option('--label', 'Add labels to PR based on result')
  .option('--evidence <mode>', 'Evidence mode: off, advisory, strict')
  .option('--profile <name>', 'Agent profile', 'code-review')
  .option('-p, --providers <names>', 'Comma-separated provider names')
  .option('--max-files <n>', 'Skip review if PR has more than N changed files')
  .option('--focus <areas>', 'Comma-separated focus areas')
  .option('--timeout <seconds>', 'Override per-provider timeout in seconds')
  .option('-r, --rapid', 'Rapid mode — skip plan, formulate, adjust, rebuttal, vote phases')
  .option('--adaptive <preset>', 'Adaptive debate controller: fast, balanced, critical, off')
  .option('--red-team', 'Enable adversarial red-team analysis')
  .option('--attack-pack <packs>', 'Comma-separated attack packs (general, code, security, legal, medical)')
  .option('--topology <name>', 'Debate topology: mesh, star, tournament, map_reduce, adversarial_tree, pipeline, panel')
  .option('--topology-hub <provider>', 'Hub provider for star topology')
  .option('--topology-moderator <provider>', 'Moderator for panel topology')
  .option('--no-memory', 'Skip deliberation memory (no retrieval or storage)')
  .action(async (opts) => {
    // --- Resolve diff content ---
    let content = '';
    let prNumber: string | undefined;
    let gitContextStr = '';

    const gitCtx = await getGitContext();
    if (gitCtx) {
      gitContextStr = `Repository: ${gitCtx.repoName} | Branch: ${gitCtx.branch}`;
    }

    try {
      if (opts.staged) {
        const diff = await getGitDiff({ staged: true });
        if (!diff.trim()) {
          console.error('No staged changes found.');
          process.exit(2);
        }
        content = `## Git Diff (staged changes)\n${gitContextStr ? `\n${gitContextStr}\n` : ''}\n\`\`\`diff\n${diff}\n\`\`\`\n`;
      } else if (opts.diff !== undefined) {
        const ref = typeof opts.diff === 'string' ? opts.diff : 'HEAD';
        const diff = await getGitDiff({ ref });
        if (!diff.trim()) {
          console.error(`No diff found against ${ref}.`);
          process.exit(2);
        }
        content = `## Git Diff (vs ${ref})\n${gitContextStr ? `\n${gitContextStr}\n` : ''}\n\`\`\`diff\n${diff}\n\`\`\`\n`;
      } else if (opts.pr) {
        prNumber = String(opts.pr);
        // Check --max-files
        if (opts.maxFiles) {
          const maxFiles = parseInt(opts.maxFiles as string);
          try {
            const { execFile: execFileCb } = await import('node:child_process');
            const { promisify } = await import('node:util');
            const execFileAsync = promisify(execFileCb);
            const { stdout } = await execFileAsync('gh', ['pr', 'view', prNumber, '--json', 'files', '--jq', '.files | length']);
            const fileCount = parseInt(stdout.trim());
            if (fileCount > maxFiles) {
              const skipResult = { approved: true, confidence: 1, consensus: 1, evidenceGrade: 'N/A',
                riskMatrix: [], suggestions: [], dissent: '', synthesis: `Skipped: PR has ${fileCount} files (max: ${maxFiles})`,
                providers: [], duration: 0, sessionId: '' };
              console.log(JSON.stringify(skipResult, null, 2));
              process.exit(0);
            }
          } catch { /* proceed anyway */ }
        }
        const pr = await getPrDiff(prNumber);
        if (!pr.diff.trim()) {
          console.error(`PR #${prNumber} has no diff.`);
          process.exit(2);
        }
        content = `## Pull Request #${prNumber}: ${pr.title}\n${gitContextStr ? `\n${gitContextStr}\n` : ''}`;
        if (pr.body.trim()) content += `\n### Description\n${pr.body}\n`;
        content += `\n### Diff\n\`\`\`diff\n${pr.diff}\n\`\`\`\n`;
      } else {
        // Try stdin
        if (!process.stdin.isTTY) {
          content = await readStdin();
        }
        if (!content.trim()) {
          console.error('No input. Use --pr, --diff, --staged, or pipe content.');
          process.exit(2);
        }
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(2);
    }

    // --- Load config, profile, providers ---
    const config = await loadConfig();
    const projectConfig = await loadProjectConfig();

    if (config.providers.length === 0) {
      console.error('No providers configured. Run: quorum init');
      process.exit(2);
    }

    const profile = await loadAgentProfile(opts.profile as string);
    if (!profile) {
      console.error(`Profile not found: ${opts.profile}`);
      process.exit(2);
    }

    if (opts.focus) {
      profile.focus = (opts.focus as string).split(',').map(s => s.trim()).filter(Boolean);
    }
    if (opts.evidence) {
      const mode = opts.evidence as string;
      if (!['off', 'advisory', 'strict'].includes(mode)) {
        console.error(`Invalid --evidence: "${mode}". Must be off, advisory, or strict.`);
        process.exit(2);
      }
      profile.evidence = mode as 'off' | 'advisory' | 'strict';
    }

    const timeoutOverride = opts.timeout ? parseInt(opts.timeout as string) : undefined;
    if (timeoutOverride !== undefined && !isNaN(timeoutOverride) && timeoutOverride > 0) {
      for (const p of config.providers) p.timeout = timeoutOverride;
    }

    let providers = config.providers;
    if (opts.providers) {
      const names = (opts.providers as string).split(',').map(s => s.trim());
      providers = config.providers.filter(p => names.includes(p.name));
      if (providers.length === 0) {
        console.error(`No matching providers: ${opts.providers}`);
        process.exit(2);
      }
    } else if (projectConfig?.providers) {
      const names = projectConfig.providers;
      const filtered = config.providers.filter(p => names.includes(p.name));
      if (filtered.length > 0) providers = filtered;
    }

    const excluded = new Set(profile.excludeFromDeliberation?.map(s => s.toLowerCase()) ?? []);
    const candidateProviders = providers.filter(
      p => !excluded.has(p.name.toLowerCase()) && !excluded.has(p.provider.toLowerCase()),
    );

    if (candidateProviders.length < 2) {
      console.error(`Need 2+ providers for deliberation (${candidateProviders.length} configured).`);
      process.exit(2);
    }

    const adapters = await Promise.all(candidateProviders.map(p => createProvider(p)));

    // --- Run deliberation silently ---
    const startTime = Date.now();
    const council = new CouncilV2(adapters, candidateProviders, profile, {
      streaming: false,
      rapid: opts.rapid ?? false,
      devilsAdvocate: false,
      noMemory: opts.memory === false,
      adaptive: (opts.adaptive as AdaptivePreset) || undefined,
      redTeam: opts.redTeam || undefined,
      attackPacks: opts.attackPack ? (opts.attackPack as string).split(',').map((s: string) => s.trim()) : undefined,
      topology: opts.topology as any || undefined,
      topologyConfig: {
        ...(opts.topologyHub ? { hub: opts.topologyHub as string } : {}),
        ...(opts.topologyModerator ? { moderator: opts.topologyModerator as string } : {}),
      },
      onEvent() { /* silent */ },
    });

    let result: Awaited<ReturnType<typeof council.deliberate>>;
    try {
      result = await council.deliberate(content);
    } catch (err) {
      console.error(`Deliberation error: ${err instanceof Error ? err.message : err}`);
      process.exit(2);
    }
    const duration = Date.now() - startTime;

    // --- Read evidence report if available ---
    let evidenceGrade = 'N/A';
    let evidencePercent = 0;
    try {
      const evPath = pathJoin(result.sessionPath, 'evidence-report.json');
      if (existsSync(evPath)) {
        const evData = JSON.parse(await readFile(evPath, 'utf-8')) as Array<{ evidenceScore: number }>;
        if (evData.length > 0) {
          evidencePercent = Math.round(evData.reduce((s, r) => s + r.evidenceScore, 0) / evData.length * 100);
          if (evidencePercent >= 80) evidenceGrade = 'A';
          else if (evidencePercent >= 60) evidenceGrade = 'B';
          else if (evidencePercent >= 40) evidenceGrade = 'C';
          else if (evidencePercent >= 20) evidenceGrade = 'D';
          else evidenceGrade = 'F';
        }
      }
    } catch { /* no evidence */ }

    const confidence = result.synthesis.confidenceScore;
    const consensus = result.synthesis.consensusScore;
    const threshold = parseFloat(opts.confidenceThreshold as string) || 0;
    const approved = threshold === 0 || confidence >= threshold;

    // --- Build CIResult ---
    interface CIResult {
      approved: boolean;
      confidence: number;
      consensus: number;
      evidenceGrade: string;
      riskMatrix: Array<{ area: string; risk: string; details: string }>;
      suggestions: Array<{ file: string; line?: number; before?: string; after?: string; rationale: string }>;
      dissent: string;
      synthesis: string;
      providers: string[];
      duration: number;
      sessionId: string;
    }

    const ciResult: CIResult = {
      approved,
      confidence,
      consensus,
      evidenceGrade: `${evidenceGrade} (${evidencePercent}%)`,
      riskMatrix: [],
      suggestions: [],
      dissent: result.synthesis.minorityReport ?? '',
      synthesis: result.synthesis.content.replace(/^##\s*Synthesis\s*\n+/i, ''),
      providers: candidateProviders.map(p => p.name),
      duration,
      sessionId: result.sessionId,
    };

    // --- Format output ---
    const format = (opts.format as string) || 'github';

    if (format === 'json') {
      console.log(JSON.stringify(ciResult, null, 2));
    } else if (format === 'markdown') {
      let md = `# Quorum Code Review\n\n`;
      md += `**Consensus:** ${consensus} | **Confidence:** ${confidence} | **Evidence:** ${ciResult.evidenceGrade}\n\n`;
      md += `## Summary\n\n${ciResult.synthesis}\n`;
      if (ciResult.dissent) md += `\n## Dissent\n\n${ciResult.dissent}\n`;
      console.log(md);
    } else {
      // github format
      let md = `## 🏛️ Quorum Code Review\n\n`;
      md += `**Consensus:** ${consensus} | **Confidence:** ${confidence} | **Evidence:** ${ciResult.evidenceGrade}\n\n`;
      md += `### Summary\n\n${ciResult.synthesis}\n`;
      if (ciResult.dissent) {
        md += `\n<details><summary>⚖️ Dissent</summary>\n\n${ciResult.dissent}\n\n</details>\n`;
      }
      md += `\n<details><summary>📋 Details</summary>\n\n`;
      md += `- **Providers:** ${ciResult.providers.join(', ')}\n`;
      md += `- **Duration:** ${(duration / 1000).toFixed(1)}s\n`;
      md += `- **Session:** ${result.sessionId}\n`;
      md += `\n</details>\n`;

      if (format === 'github' && !opts.postComment) {
        console.log(md);
      }

      // --- Post comment ---
      if (opts.postComment && prNumber) {
        try {
          const { execFile: execFileCb } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execFileAsync = promisify(execFileCb);
          await execFileAsync('gh', ['pr', 'comment', prNumber, '--body', md]);
        } catch (err) {
          console.error(`Failed to post comment: ${err instanceof Error ? err.message : err}`);
        }
      }

      // --- Label PR ---
      if (opts.label && prNumber) {
        try {
          const { execFile: execFileCb } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execFileAsync = promisify(execFileCb);
          let label: string;
          if (confidence < 0.3) label = 'quorum:concerning';
          else if (threshold > 0 && confidence < threshold) label = 'quorum:needs-discussion';
          else label = 'quorum:approved';
          await execFileAsync('gh', ['pr', 'edit', prNumber, '--add-label', label]);
        } catch (err) {
          console.error(`Failed to add label: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    // --- Exit code ---
    if (!approved) {
      process.exit(1);
    }
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
      const authType = p.auth ? p.auth.method : (p.apiKey ? 'api_key' : 'none');
      console.log(`  ${chalk.bold(p.name)} — ${p.provider}/${p.model} (${authType})`);
    }
  });

providersCmd
  .command('add')
  .description('Add a provider')
  .requiredOption('--name <name>', 'Provider name')
  .requiredOption('--type <type>', 'Provider type (openai, anthropic, claude-cli, ollama, google, kimi, etc.)')
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
    config.providers = config.providers.filter(p => p.name !== provider.name);
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
      : ['openai', 'anthropic', 'google', 'kimi-coding', 'openai-codex', 'mistral', 'deepseek', 'groq', 'xai'];

    for (const p of providers) {
      try {
        const models = getModels(p as any);
        if (models.length === 0) continue;
        console.log(chalk.bold(`\n${p}`) + chalk.dim(` (${models.length} models)`));
        for (const m of models) {
          const ctx = m.contextWindow ? chalk.dim(` ${(m.contextWindow / 1000).toFixed(0)}k ctx`) : '';
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
    config.providers = config.providers.filter(p => p.name !== name);
    if (config.providers.length === before) {
      console.error(chalk.red(`Provider not found: ${name}`));
      process.exit(1);
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
        const response = await adapter.generate('Say "OK" in one word.', 'You are a helpful assistant. Reply concisely.');
        console.log(chalk.green(`✅ "${response.slice(0, 50)}"`));
      } catch (err) {
        console.log(chalk.red(`❌ ${err instanceof Error ? err.message.slice(0, 80) : 'failed'}`));
      }
    }
  });

// --- quorum auth ---
const authCmd = program.command('auth').description('Manage OAuth authentication');

authCmd
  .command('login <provider>')
  .description('OAuth device flow login')
  .option('--client-id <id>', 'Custom OAuth client ID')
  .action(async (provider: string, opts) => {
    try {
      const flow = await startDeviceFlow(provider, opts.clientId as string | undefined);
      console.log('');
      console.log(chalk.bold('🔐 OAuth Login'));
      console.log(`  Open: ${chalk.cyan(flow.verificationUrl)}`);
      console.log(`  Code: ${chalk.bold.yellow(flow.userCode)}`);
      console.log('');
      console.log('Waiting for authorization...');
      const token = await flow.poll();
      if (token) {
        console.log(chalk.green(`✅ Authenticated with ${provider}`));
      } else {
        console.log(chalk.red('❌ Authorization expired or denied'));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
    }
  });

authCmd
  .command('list')
  .description('List stored OAuth tokens')
  .action(async () => {
    const tokens = await listOAuthProfiles();
    const entries = Object.entries(tokens);
    if (entries.length === 0) {
      console.log(chalk.dim('No OAuth tokens. Use: quorum auth login <provider>'));
      return;
    }
    for (const [name, token] of entries) {
      const expired = token.expiresAt && Date.now() > token.expiresAt;
      console.log(`  ${chalk.bold(name)} — ${expired ? chalk.red('expired') : chalk.green('active')}`);
    }
  });

authCmd
  .command('logout <provider>')
  .description('Remove OAuth token')
  .action(async (provider: string) => {
    await removeOAuthProfile(provider);
    console.log(chalk.green(`✅ Removed ${provider}`));
  });

// --- quorum session ---
program
  .command('session <path>')
  .description('View a saved session (all phases). Use "last" for most recent.')
  .option('--phase <name>', 'View a specific phase (gather, plan, formulate, debate, adjust, rebuttal, vote, synthesis)')
  .action(async (sessionPath: string, opts) => {
    // Resolve "last" to most recent session
    if (sessionPath === 'last') {
      const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
      const indexPath = pathJoin(sessionsDir, 'index.json');
      if (existsSync(indexPath)) {
        try {
          const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{ sessionId: string }>;
          if (entries.length > 0) {
            sessionPath = pathJoin(sessionsDir, entries[entries.length - 1].sessionId);
          } else {
            // Fall back to directory scan
            sessionPath = await resolveLastSession(sessionsDir);
          }
        } catch {
          sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
        }
      } else {
        sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
      }
    }

    const phaseName = opts.phase as string | undefined;

    // If specific phase requested
    if (phaseName) {
      if (phaseName === 'synthesis') {
        const synthPath = `${sessionPath}/synthesis.json`;
        if (!existsSync(synthPath)) {
          console.error(chalk.red(`No synthesis found at ${synthPath}`));
          process.exit(1);
        }
        const synth = JSON.parse(await readFile(synthPath, 'utf-8'));
        console.log('');
        console.log(chalk.bold.green('═══ SYNTHESIS ═══'));
        console.log(synth.content);
        console.log('');
        return;
      }

      // Map phase name to file prefix
      const phaseFiles: Record<string, string> = {
        gather: '01-gather', plan: '02-plan', formulate: '03-formulate',
        debate: '04-debate', adjust: '05-adjust', rebuttal: '06-rebuttal', vote: '07-vote',
      };
      const fileKey = phaseFiles[phaseName.toLowerCase()];
      if (!fileKey) {
        console.error(chalk.red(`Unknown phase: ${phaseName}`));
        console.error(chalk.dim(`Available: ${Object.keys(phaseFiles).join(', ')}, synthesis`));
        process.exit(1);
      }
      const phasePath = `${sessionPath}/${fileKey}.json`;
      if (!existsSync(phasePath)) {
        console.error(chalk.red(`Phase file not found: ${phasePath}`));
        process.exit(1);
      }
      const phase = JSON.parse(await readFile(phasePath, 'utf-8'));
      console.log('');
      console.log(chalk.bold.cyan(`═══ ${phase.phase} ═══`) + chalk.dim(` (${(phase.duration / 1000).toFixed(1)}s)`));
      // Support both old "entries" and new "responses" field names
      const entries = phase.responses ?? phase.entries ?? {};
      for (const [provider, content] of Object.entries(entries)) {
        console.log('');
        console.log(chalk.bold.yellow(`── ${provider} ──`));
        console.log(String(content));
      }
      console.log('');
      return;
    }

    // Show all phases
    const metaPath = `${sessionPath}/meta.json`;
    if (existsSync(metaPath)) {
      const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
      console.log('');
      console.log(chalk.bold.cyan('═══ Session ═══'));
      console.log(chalk.dim(`Question: ${String(meta.input).slice(0, 200)}`));
      console.log(chalk.dim(`Profile: ${meta.profile} | Providers: ${meta.providers?.map((p: any) => p.name).join(', ')}`));
    }

    const phases = [
      { file: '01-gather', name: 'GATHER' },
      { file: '02-plan', name: 'PLAN' },
      { file: '03-formulate', name: 'FORMULATE' },
      { file: '04-debate', name: 'DEBATE' },
      { file: '05-adjust', name: 'ADJUST' },
      { file: '06-rebuttal', name: 'REBUTTAL' },
      { file: '07-vote', name: 'VOTE' },
    ];

    for (const { file, name } of phases) {
      const phasePath = `${sessionPath}/${file}.json`;
      if (!existsSync(phasePath)) continue;
      const phase = JSON.parse(await readFile(phasePath, 'utf-8'));
      console.log('');
      console.log(chalk.bold.cyan(`═══ ${name} ═══`) + chalk.dim(` (${(phase.duration / 1000).toFixed(1)}s)`));
      const entries = phase.responses ?? phase.entries ?? {};
      for (const [provider, content] of Object.entries(entries)) {
        const text = String(content);
        console.log(`  ${chalk.bold(provider)}: ${text.slice(0, 150)}${text.length > 150 ? '...' : ''}`);
      }
    }

    // Synthesis
    const synthPath = `${sessionPath}/synthesis.json`;
    if (existsSync(synthPath)) {
      const synth = JSON.parse(await readFile(synthPath, 'utf-8'));
      console.log('');
      console.log(chalk.bold.green('═══ SYNTHESIS ═══'));
      console.log(synth.content);
      if (synth.votes) {
        console.log('');
        console.log(chalk.bold('🗳️  Votes'));
        for (const r of synth.votes.rankings) {
          console.log(`  ${r.provider}: ${r.score} pts${r.provider === synth.votes.winner ? ' 👑' : ''}`);
        }
      }
    }
    console.log('');
  });

// --- quorum history ---
program
  .command('history')
  .description('List past deliberation sessions')
  .option('-n, --limit <count>', 'Number of sessions to show', '20')
  .action(async (opts) => {
    const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
    if (!existsSync(sessionsDir)) {
      console.log(chalk.dim('No sessions found.'));
      return;
    }

    const limit = parseInt(opts.limit as string) || 20;

    // Try index first
    const indexPath = pathJoin(sessionsDir, 'index.json');
    if (existsSync(indexPath)) {
      try {
        const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{
          sessionId: string; timestamp: number; question: string; winner: string; duration: number;
        }>;
        if (entries.length > 0) {
          // Sort newest first
          entries.sort((a, b) => b.timestamp - a.timestamp);
          console.log('');
          console.log(chalk.bold(`📜 Session History (${Math.min(entries.length, limit)} of ${entries.length})`));
          console.log('');
          for (const e of entries.slice(0, limit)) {
            const date = new Date(e.timestamp).toLocaleString();
            const dur = (e.duration / 1000).toFixed(1);
            console.log(`  ${chalk.dim(date)} ${chalk.bold(e.question)}${e.question.length >= 100 ? '...' : ''}`);
            console.log(`    Winner: ${chalk.green(e.winner)} | ${chalk.dim(`${dur}s`)}`);
            console.log(`    ${chalk.dim(pathJoin(sessionsDir, e.sessionId))}`);
            console.log('');
          }
          return;
        }
      } catch {
        // Fall through to directory scan
      }
    }

    // Fallback: scan directories
    const dirEntries = await readdir(sessionsDir, { withFileTypes: true });
    const sessions: Array<{ dir: string; meta: any; synth: any }> = [];

    for (const entry of dirEntries) {
      if (!entry.isDirectory()) continue;
      const dir = pathJoin(sessionsDir, entry.name);
      const metaPath = pathJoin(dir, 'meta.json');
      if (!existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
        let synth = null;
        const synthPath = pathJoin(dir, 'synthesis.json');
        if (existsSync(synthPath)) {
          synth = JSON.parse(await readFile(synthPath, 'utf-8'));
        }
        sessions.push({ dir, meta, synth });
      } catch { continue; }
    }

    sessions.sort((a, b) => (b.meta.startedAt ?? 0) - (a.meta.startedAt ?? 0));

    if (sessions.length === 0) {
      console.log(chalk.dim('No sessions found.'));
      return;
    }

    console.log('');
    console.log(chalk.bold(`📜 Session History (${Math.min(sessions.length, limit)} of ${sessions.length})`));
    console.log('');

    for (const s of sessions.slice(0, limit)) {
      const date = s.meta.startedAt ? new Date(s.meta.startedAt).toLocaleString() : '?';
      const question = String(s.meta.input ?? '').slice(0, 60);
      const winner = s.synth?.votes?.winner ?? chalk.dim('(incomplete)');
      const providers = s.meta.providers?.map((p: any) => p.name).join(', ') ?? '';
      console.log(`  ${chalk.dim(date)} ${chalk.bold(question)}${question.length >= 60 ? '...' : ''}`);
      console.log(`    Winner: ${chalk.green(winner)} | Providers: ${chalk.dim(providers)}`);
      console.log(`    ${chalk.dim(s.dir)}`);
      console.log('');
    }
  });

// --- quorum follow-up ---
program
  .command('follow-up')
  .description('Continue a previous deliberation with a follow-up question')
  .argument('<session>', 'Session path or "last"')
  .argument('[question]', 'Follow-up question (or pipe via stdin)')
  .option('-p, --providers <names>', 'Comma-separated provider names')
  .option('--profile <name>', 'Agent profile', 'default')
  .option('-v, --verbose', 'Show phase-by-phase progress')
  .option('--audit <path>', 'Save full session JSON to file')
  .option('--json', 'Output result as JSON (for piping)')
  .option('--timeout <seconds>', 'Override per-provider timeout in seconds')
  .option('-r, --rapid', 'Rapid mode')
  .option('--devils-advocate', 'Assign one provider as devil\'s advocate')
  .action(async (session: string, question: string | undefined, opts) => {
    // Resolve session path
    let sessionPath = session;
    if (session === 'last') {
      const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
      const indexPath = pathJoin(sessionsDir, 'index.json');
      if (existsSync(indexPath)) {
        try {
          const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{ sessionId: string }>;
          if (entries.length > 0) {
            sessionPath = pathJoin(sessionsDir, entries[entries.length - 1].sessionId);
          } else {
            sessionPath = await resolveLastSession(sessionsDir);
          }
        } catch {
          sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
        }
      } else {
        sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
      }
    }

    // Read synthesis from previous session
    const synthPath = pathJoin(sessionPath, 'synthesis.json');
    if (!existsSync(synthPath)) {
      console.error(chalk.red(`No synthesis found at ${synthPath}`));
      process.exit(1);
    }
    const synth = JSON.parse(await readFile(synthPath, 'utf-8'));
    const priorContext = synth.content as string;

    // Get question
    if (!question) {
      if (process.stdin.isTTY) {
        console.error(chalk.red('No follow-up question provided.'));
        console.error(chalk.dim('Usage: quorum follow-up <session> "your question"'));
        process.exit(1);
      }
      question = await readStdin();
      if (!question.trim()) {
        console.error(chalk.red('Empty input.'));
        process.exit(1);
      }
    }

    // Now run deliberation with priorContext — reuse ask logic
    const config = await loadConfig();
    if (config.providers.length === 0) {
      console.error(chalk.red('No providers configured. Run: quorum init'));
      process.exit(1);
    }

    const timeoutOverride = opts.timeout ? parseInt(opts.timeout as string) : undefined;
    if (timeoutOverride !== undefined) {
      if (isNaN(timeoutOverride) || timeoutOverride <= 0) {
        console.error(chalk.red(`Invalid --timeout value.`));
        process.exit(1);
      }
      for (const p of config.providers) p.timeout = timeoutOverride;
    }

    let providers = config.providers;
    if (opts.providers) {
      const names = (opts.providers as string).split(',').map(s => s.trim());
      providers = config.providers.filter(p => names.includes(p.name));
      if (providers.length === 0) {
        console.error(chalk.red(`No matching providers: ${opts.providers}`));
        process.exit(1);
      }
    }

    const isJSON = opts.json;
    const profile = await loadAgentProfile(opts.profile as string);
    if (!profile) {
      console.error(chalk.red(`Profile not found: ${opts.profile}`));
      process.exit(1);
    }

    const excluded = new Set(profile.excludeFromDeliberation?.map(s => s.toLowerCase()) ?? []);
    const candidateProviders = providers.filter(
      p => !excluded.has(p.name.toLowerCase()) && !excluded.has(p.provider.toLowerCase()),
    );

    if (candidateProviders.length < 2) {
      console.error(chalk.red(`Need 2+ providers for deliberation.`));
      process.exit(1);
    }

    const adapters = await Promise.all(candidateProviders.map(p => createProvider(p)));

    if (!isJSON) {
      console.log('');
      console.log(chalk.bold.cyan(`🔄 Follow-up on previous deliberation`));
      console.log(chalk.dim(`Prior session: ${sessionPath}`));
      console.log('');
    }

    const council = new CouncilV2(adapters, candidateProviders, profile, {
      streaming: true,
      rapid: opts.rapid ?? false,
      devilsAdvocate: opts.devilsAdvocate ?? profile.devilsAdvocate ?? false,
      priorContext,
      onEvent(event, data) {
        if (isJSON) return;
        const d = data as Record<string, unknown>;
        switch (event) {
          case 'phase':
            process.stdout.write(chalk.bold(`  ▸ ${d.phase} `));
            break;
          case 'response': {
            const fallback = d.fallback ? chalk.yellow('⚠') : chalk.green('✓');
            process.stdout.write(`${fallback}${chalk.dim(d.provider as string)} `);
            break;
          }
          case 'phase:done': {
            const secs = ((d.duration as number) / 1000).toFixed(1);
            console.log(chalk.dim(`(${secs}s)`));
            break;
          }
          case 'complete':
            console.log(chalk.dim(`\n  ⏱  ${((d.duration as number) / 1000).toFixed(1)}s total`));
            break;
        }
      },
    });

    try {
      const result = await council.deliberate(question);

      if (isJSON) {
        console.log(JSON.stringify({
          synthesis: result.synthesis.content,
          synthesizer: result.synthesis.synthesizer,
          consensus: result.synthesis.consensusScore,
          confidence: result.synthesis.confidenceScore,
          duration: result.duration,
          sessionPath: result.sessionPath,
          followUpFrom: sessionPath,
        }, null, 2));
      } else {
        console.log('');
        console.log(chalk.bold.green('━'.repeat(60)));
        console.log('');
        let displayContent = result.synthesis.content;
        for (const heading of ['## Minority Report', '## Scores', '## Minority']) {
          const idx = displayContent.indexOf(heading);
          if (idx > 0) displayContent = displayContent.slice(0, idx).trimEnd();
        }
        displayContent = displayContent.replace(/^##\s*Synthesis\s*\n+/i, '');
        console.log(displayContent);
        console.log('');
        console.log(chalk.bold.green('━'.repeat(60)));
        console.log(chalk.dim(`Session: ${result.sessionPath}`));
        console.log('');
      }

      if (opts.audit) {
        await writeFile(opts.audit as string, JSON.stringify(result, null, 2), 'utf-8');
      }
    } catch (err) {
      console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  });

// --- quorum versus ---
program
  .command('versus')
  .description('Head-to-head debate between two providers')
  .argument('<provider1>', 'First provider name')
  .argument('<provider2>', 'Second provider name')
  .argument('[question]', 'Question (or pipe via stdin)')
  .option('--json', 'Output result as JSON')
  .option('--timeout <seconds>', 'Override per-provider timeout in seconds')
  .action(async (provider1: string, provider2: string, question: string | undefined, opts) => {
    if (!question) {
      if (process.stdin.isTTY) {
        console.error(chalk.red('No question provided.'));
        console.error(chalk.dim('Usage: quorum versus <provider1> <provider2> "question"'));
        process.exit(1);
      }
      question = await readStdin();
      if (!question.trim()) {
        console.error(chalk.red('Empty input.'));
        process.exit(1);
      }
    }

    const config = await loadConfig();
    if (config.providers.length === 0) {
      console.error(chalk.red('No providers configured. Run: quorum init'));
      process.exit(1);
    }

    const timeoutOverride = opts.timeout ? parseInt(opts.timeout as string) : undefined;
    if (timeoutOverride !== undefined) {
      for (const p of config.providers) p.timeout = timeoutOverride;
    }

    const cfg1 = config.providers.find(p => p.name === provider1);
    const cfg2 = config.providers.find(p => p.name === provider2);
    if (!cfg1) {
      console.error(chalk.red(`Provider not found: ${provider1}`));
      console.error(chalk.dim(`Available: ${config.providers.map(p => p.name).join(', ')}`));
      process.exit(1);
    }
    if (!cfg2) {
      console.error(chalk.red(`Provider not found: ${provider2}`));
      console.error(chalk.dim(`Available: ${config.providers.map(p => p.name).join(', ')}`));
      process.exit(1);
    }

    const adapter1 = await createProvider(cfg1);
    const adapter2 = await createProvider(cfg2);

    // Find a judge: third provider if available, otherwise adapter1
    const cfgJudge = config.providers.find(p => p.name !== provider1 && p.name !== provider2);
    const judgeAdapter = cfgJudge ? await createProvider(cfgJudge) : undefined;

    const isJSON = opts.json;

    if (!isJSON) {
      console.log('');
      console.log(chalk.bold.cyan(`⚔️  ${provider1} vs ${provider2}`));
      if (judgeAdapter) {
        console.log(chalk.dim(`Judge: ${judgeAdapter.name}`));
      }
      console.log('');
    }

    try {
      const comparison = await CouncilV2.versus(
        question,
        adapter1,
        adapter2,
        judgeAdapter,
        isJSON ? undefined : (event, data) => {
          const d = data as Record<string, unknown>;
          switch (event) {
            case 'phase':
              process.stdout.write(chalk.bold(`  ▸ ${d.phase} `));
              break;
            case 'response':
              process.stdout.write(chalk.green('✓') + chalk.dim(d.provider as string) + ' ');
              break;
            case 'phase:done':
              console.log('');
              break;
          }
        },
      );

      if (isJSON) {
        console.log(JSON.stringify({
          provider1,
          provider2,
          judge: judgeAdapter?.name ?? provider1,
          comparison,
        }, null, 2));
      } else {
        console.log('');
        console.log(chalk.bold.green('━'.repeat(60)));
        console.log('');
        console.log(comparison);
        console.log('');
        console.log(chalk.bold.green('━'.repeat(60)));
        console.log('');
      }
    } catch (err) {
      console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  });

// --- quorum export ---
program
  .command('export')
  .description('Export a deliberation session as a formatted document')
  .argument('<session>', 'Session path or "last" for most recent')
  .option('--format <format>', 'Output format: md or html', 'md')
  .option('--output <file>', 'Output file path (default: stdout)')
  .action(async (sessionArg: string, opts) => {
    const { exportMarkdown, exportHtml } = await import('./export.js');

    // Resolve session path
    let sessionPath = sessionArg;
    if (sessionPath === 'last') {
      const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
      const indexPath = pathJoin(sessionsDir, 'index.json');
      if (existsSync(indexPath)) {
        try {
          const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{ sessionId: string }>;
          if (entries.length > 0) {
            sessionPath = pathJoin(sessionsDir, entries[entries.length - 1].sessionId);
          } else {
            sessionPath = await resolveLastSession(sessionsDir);
          }
        } catch {
          sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
        }
      } else {
        sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
      }
    }

    const metaPath = pathJoin(sessionPath, 'meta.json');
    if (!existsSync(metaPath)) {
      console.error(chalk.red(`Session not found: ${sessionPath}`));
      process.exit(1);
    }

    const format = (opts.format as string).toLowerCase();
    if (format !== 'md' && format !== 'html') {
      console.error(chalk.red(`Invalid format: ${format}. Use "md" or "html".`));
      process.exit(1);
    }

    const result = format === 'html' ? exportHtml(sessionPath) : exportMarkdown(sessionPath);

    if (opts.output) {
      await writeFile(opts.output as string, result, 'utf-8');
      console.error(chalk.green(`✅ Exported to ${opts.output}`));
    } else {
      process.stdout.write(result);
    }
  });

// --- quorum heatmap ---
program
  .command('heatmap')
  .description('Display consensus heatmap from a session\'s vote data')
  .argument('<session>', 'Session path or "last" for most recent')
  .action(async (sessionArg: string) => {
    const { generateHeatmap } = await import('./heatmap.js');

    // Resolve session path
    let sessionPath = sessionArg;
    if (sessionPath === 'last') {
      const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
      const indexPath = pathJoin(sessionsDir, 'index.json');
      if (existsSync(indexPath)) {
        try {
          const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{ sessionId: string }>;
          if (entries.length > 0) {
            sessionPath = pathJoin(sessionsDir, entries[entries.length - 1].sessionId);
          } else {
            sessionPath = await resolveLastSession(sessionsDir);
          }
        } catch {
          sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
        }
      } else {
        sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
      }
    }

    // Read meta for provider names
    const metaPath = pathJoin(sessionPath, 'meta.json');
    if (!existsSync(metaPath)) {
      console.error(chalk.red(`Session not found: ${sessionPath}`));
      process.exit(1);
    }
    const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
    const providerNames: string[] = (meta.providers ?? []).map((p: any) => p.name);

    // Read vote phase
    const votePath = pathJoin(sessionPath, '07-vote.json');
    if (!existsSync(votePath)) {
      console.error(chalk.red(`No vote data found at ${votePath}`));
      console.error(chalk.dim('The session may have skipped the vote phase.'));
      process.exit(1);
    }
    const votePhase = JSON.parse(await readFile(votePath, 'utf-8'));
    const voteResponses: Record<string, string> = votePhase.responses ?? votePhase.entries ?? {};

    if (Object.keys(voteResponses).length < 2) {
      console.error(chalk.red('Need at least 2 voters for a heatmap.'));
      process.exit(1);
    }

    // Re-parse ballots from raw vote text (same logic as council-v2 extractBallots)
    const n = providerNames.length;
    const labels = providerNames.map((_, idx) => String.fromCharCode(65 + idx));
    const letterToProvider: Record<string, string> = {};
    for (let idx = 0; idx < n; idx++) {
      letterToProvider[labels[idx]] = providerNames[idx];
    }

    const ballots: Array<{ voter: string; rankings: Array<{ provider: string; rank: number }> }> = [];

    for (const [voter, voteText] of Object.entries(voteResponses)) {
      const rankings: Array<{ provider: string; rank: number }> = [];
      const assigned = new Set<string>();

      // Try JSON parsing
      const jsonMatch = voteText.match(/```(?:json)?\s*([\s\S]*?)```/) || voteText.match(/(\{[\s\S]*"rankings"[\s\S]*\})/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1].trim());
          const entries: Array<{ position: string; rank: number }> = parsed.rankings ?? parsed;
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              const letter = String(entry.position).toUpperCase();
              const targetName = letterToProvider[letter];
              if (targetName && !assigned.has(targetName)) {
                rankings.push({ provider: targetName, rank: entry.rank });
                assigned.add(targetName);
              }
            }
          }
        } catch { /* fall through */ }
      }

      // Fallback: numbered lines
      if (assigned.size === 0) {
        const lines = voteText.split('\n');
        let rank = 1;
        for (const line of lines) {
          const rankMatch = line.match(/^\s*(?:#?\s*)?(\d+)[\.\)\-:\s]\s*/);
          if (!rankMatch) continue;
          const lineRank = parseInt(rankMatch[1]);
          const effectiveRank = (lineRank >= 1 && lineRank <= n) ? lineRank : rank;
          if (effectiveRank > n) continue;

          const rest = line.slice(rankMatch[0].length);
          let targetName: string | undefined;
          for (let li = 0; li < labels.length; li++) {
            const pat = new RegExp(`(?:Position\\s+)?(?:\\*\\*|"|')?${labels[li]}(?:\\*\\*|"|')?(?:\\s|\\.|—|-|:|,|\\))`, 'i');
            if (pat.test(rest)) { targetName = providerNames[li]; break; }
          }
          if (!targetName) {
            for (const pn of providerNames) {
              if (rest.toLowerCase().includes(pn.toLowerCase())) { targetName = pn; break; }
            }
          }

          if (targetName && !assigned.has(targetName)) {
            rankings.push({ provider: targetName, rank: effectiveRank });
            assigned.add(targetName);
            rank++;
          }
        }
      }

      if (rankings.length > 0) {
        ballots.push({ voter, rankings });
      }
    }

    if (ballots.length < 2) {
      console.error(chalk.red('Could not parse enough ballots for a heatmap.'));
      process.exit(1);
    }

    const heatmap = generateHeatmap(ballots, providerNames);
    if (heatmap) {
      console.log(heatmap);
    } else {
      console.log(chalk.dim('Not enough data to generate heatmap.'));
    }
  });

// --- quorum attacks ---
program
  .command('attacks')
  .description('List available red team attack packs')
  .action(async () => {
    const packs = await listAttackPacks();
    console.log(chalk.bold('\nAvailable attack packs:\n'));
    for (const name of packs) {
      const pack = await loadAttackPack(name);
      console.log(`  ${chalk.red('🔴')} ${chalk.bold(name)} — ${pack.description} (${pack.vectors.length} vectors)`);
    }
    console.log('');
    console.log(chalk.dim('Usage: quorum ask --red-team --attack-pack security,code "question"'));
  });

// --- quorum memory ---
const memoryCmd = program.command('memory').description('Manage deliberation memory graph');

memoryCmd
  .command('list')
  .description('List all stored memories')
  .action(async () => {
    try {
      const { loadMemoryGraph } = await import('./memory-graph.js');
      const graph = await loadMemoryGraph();
      if (graph.nodes.length === 0) {
        console.log(chalk.dim('No memories stored.'));
        return;
      }
      console.log('');
      console.log(chalk.bold('📚 Stored Memories'));
      console.log('');
      console.log(`${chalk.dim('Date')}       | ${chalk.dim('Consensus')} | ${chalk.dim('Winner')}   | ${chalk.dim('Question')}`);
      for (const node of graph.nodes) {
        const date = new Date(node.timestamp).toISOString().slice(0, 10);
        const consensus = node.consensusScore?.toFixed(2) ?? '—';
        const winner = node.winner?.slice(0, 8).padEnd(8) ?? '—';
        const question = node.input.slice(0, 50) + (node.input.length > 50 ? '...' : '');
        console.log(`${date} | ${consensus.padEnd(9)} | ${winner} | ${question}`);
      }
      console.log('');
    } catch (err) {
      console.error(chalk.red(`Error loading memories: ${err instanceof Error ? err.message : err}`));
    }
  });

memoryCmd
  .command('search')
  .description('Search memories by keyword')
  .argument('<query>', 'Search query')
  .action(async (query: string) => {
    try {
      const { findRelevantMemories } = await import('./memory-graph.js');
      const memories = await findRelevantMemories(query, 10);
      if (memories.length === 0) {
        console.log(chalk.dim('No matching memories found.'));
        return;
      }
      console.log('');
      console.log(chalk.bold(`🔍 Search Results (${memories.length})`));
      console.log('');
      for (const m of memories) {
        const date = new Date(m.timestamp).toISOString().slice(0, 10);
        console.log(`  ${chalk.dim(date)} ${chalk.bold(m.input.slice(0, 60))}${m.input.length > 60 ? '...' : ''}`);
        console.log(`     Consensus: ${m.consensusScore?.toFixed(2) ?? '—'} | Winner: ${m.winner ?? '—'}`);
        console.log('');
      }
    } catch (err) {
      console.error(chalk.red(`Error searching memories: ${err instanceof Error ? err.message : err}`));
    }
  });

memoryCmd
  .command('clear')
  .description('Clear the memory graph')
  .option('--force', 'Skip confirmation')
  .action(async (opts) => {
    if (!opts.force) {
      const inquirer = await import('inquirer');
      const { confirm } = await inquirer.default.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to clear all memories?',
        default: false,
      }]);
      if (!confirm) {
        console.log(chalk.dim('Cancelled.'));
        return;
      }
    }
    try {
      const { clearMemoryGraph } = await import('./memory-graph.js');
      await clearMemoryGraph();
      console.log(chalk.green('✅ Memory graph cleared.'));
    } catch (err) {
      console.error(chalk.red(`Error clearing memories: ${err instanceof Error ? err.message : err}`));
    }
  });

memoryCmd
  .command('stats')
  .description('Show memory graph statistics')
  .action(async () => {
    try {
      const { loadMemoryGraph } = await import('./memory-graph.js');
      const graph = await loadMemoryGraph();
      if (graph.nodes.length === 0) {
        console.log(chalk.dim('No memories stored.'));
        return;
      }
      const timestamps = graph.nodes.map(n => n.timestamp).sort((a, b) => a - b);
      const earliest = new Date(timestamps[0]).toISOString().slice(0, 10);
      const latest = new Date(timestamps[timestamps.length - 1]).toISOString().slice(0, 10);
      // Extract tags from all nodes
      const tagCounts: Record<string, number> = {};
      for (const node of graph.nodes) {
        if (node.tags) {
          for (const tag of node.tags) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          }
        }
      }
      const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      console.log('');
      console.log(chalk.bold('📊 Memory Graph Stats'));
      console.log('');
      console.log(`  Total memories: ${chalk.bold(String(graph.nodes.length))}`);
      console.log(`  Date range: ${chalk.dim(earliest)} → ${chalk.dim(latest)}`);
      if (topTags.length > 0) {
        console.log('');
        console.log(chalk.dim('  Top topics:'));
        for (const [tag, count] of topTags) {
          console.log(`    ${tag}: ${count}`);
        }
      }
      console.log('');
    } catch (err) {
      console.error(chalk.red(`Error loading stats: ${err instanceof Error ? err.message : err}`));
    }
  });

// --- Helpers ---

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function resolveLastSession(sessionsDir: string): Promise<string> {
  if (!existsSync(sessionsDir)) {
    console.error(chalk.red('No sessions found.'));
    process.exit(1);
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
    } catch { continue; }
  }
  if (!latest) {
    console.error(chalk.red('No sessions found.'));
    process.exit(1);
  }
  return latest;
}

async function promptAddProvider(): Promise<ProviderConfig | null> {
  const inquirer = await import('inquirer');

  const { provider } = await inquirer.default.prompt<{ provider: string }>([{
    type: 'list',
    name: 'provider',
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
      { name: 'Custom (OpenAI-compatible)', value: 'custom' },
    ],
  }]);

  const defaults: Record<string, { model: string; needsKey: boolean }> = {
    openai: { model: 'gpt-4o', needsKey: true },
    anthropic: { model: 'claude-sonnet-4-20250514', needsKey: true },
    'claude-cli': { model: 'claude-sonnet-4-20250514', needsKey: false },
    google: { model: 'gemini-2.0-flash', needsKey: true },
    ollama: { model: 'qwen2.5:14b', needsKey: false },
    kimi: { model: 'kimi-k2-0520', needsKey: true },
    deepseek: { model: 'deepseek-chat', needsKey: true },
    mistral: { model: 'mistral-large-latest', needsKey: true },
    custom: { model: '', needsKey: true },
  };

  const def = defaults[provider];
  const answers = await inquirer.default.prompt([
    { type: 'input', name: 'name', message: 'Name:', default: provider },
    { type: 'input', name: 'model', message: 'Model:', default: def.model },
  ]);

  let auth: ProviderConfig['auth'] = { method: 'none' };

  if (def.needsKey) {
    const { method } = await inquirer.default.prompt<{ method: string }>([{
      type: 'list',
      name: 'method',
      message: 'Auth method:',
      choices: [
        { name: 'Environment variable', value: 'env' },
        { name: 'API key (paste)', value: 'api_key' },
      ],
    }]);

    if (method === 'api_key') {
      const { key } = await inquirer.default.prompt([{ type: 'password', name: 'key', message: 'API key:', mask: '*' }]);
      auth = { method: 'api_key', apiKey: key as string };
    } else {
      const envDefault = provider === 'kimi' ? 'KIMI_API_KEY' : `${provider.toUpperCase()}_API_KEY`;
      const { envVar } = await inquirer.default.prompt([{ type: 'input', name: 'envVar', message: 'Env var:', default: envDefault }]);
      auth = { method: 'env', envVar: envVar as string };
    }
  }

  let baseUrl: string | undefined;
  if (provider === 'custom' || provider === 'ollama') {
    const { url } = await inquirer.default.prompt([{
      type: 'input', name: 'url', message: 'Base URL:',
      default: provider === 'ollama' ? 'http://localhost:11434' : '',
    }]);
    baseUrl = url as string || undefined;
  }

  return {
    name: answers.name as string,
    provider: provider as ProviderConfig['provider'],
    model: answers.model as string,
    auth,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

function displayDryRun(profile: AgentProfile, providers: ProviderConfig[], singleMode: boolean, projectConfigPath?: string): void {
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
    console.log(`  Weights: ${Object.entries(profile.weights).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  console.log('');

  // Providers
  console.log(chalk.bold('Providers:'));
  for (const p of providers) {
    const limits = PROVIDER_LIMITS[p.provider] ?? { contextLength: 32_000, outputReserve: 4_096 };
    const inputBudget = availableInput(p.provider, 500);
    const inputBudgetK = (inputBudget / 1000).toFixed(0);
    const ctxK = (limits.contextLength / 1000).toFixed(0);
    console.log(`  ${chalk.green('✓')} ${chalk.bold(p.name)} ${chalk.dim(`(${p.provider}/${p.model})`)}`);
    console.log(`    Context: ${ctxK}k tokens | Output reserve: ${limits.outputReserve} | Input budget: ~${inputBudgetK}k tokens`);
    if (p.timeout) console.log(`    Timeout: ${p.timeout}s`);
  }
  console.log('');

  // Phase pipeline
  if (singleMode) {
    console.log(chalk.bold('Pipeline:'));
    console.log('  Single provider mode — direct query, no deliberation');
  } else {
    const phases = ['GATHER', 'PLAN', 'FORMULATE', 'DEBATE', 'ADJUST', 'REBUTTAL', 'VOTE', 'SYNTHESIZE'];
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

// --- quorum explain ---
program
  .command('explain')
  .description('Meta-analyze a deliberation session')
  .argument('<session>', 'Session path or "last" for most recent')
  .option('--provider <name>', 'Provider to use for analysis (default: first configured)')
  .action(async (sessionArg: string, opts) => {
    // Resolve session path
    let sessionPath = sessionArg;
    if (sessionPath === 'last') {
      const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
      const indexPath = pathJoin(sessionsDir, 'index.json');
      if (existsSync(indexPath)) {
        try {
          const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{ sessionId: string }>;
          if (entries.length > 0) {
            sessionPath = pathJoin(sessionsDir, entries[entries.length - 1].sessionId);
          } else {
            sessionPath = await resolveLastSession(sessionsDir);
          }
        } catch {
          sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
        }
      } else {
        sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
      }
    }

    // Read session files
    const metaPath = pathJoin(sessionPath, 'meta.json');
    if (!existsSync(metaPath)) {
      console.error(chalk.red(`Session not found: ${sessionPath}`));
      process.exit(1);
    }

    const meta = JSON.parse(await readFile(metaPath, 'utf-8'));

    // Read all phase files
    const phaseFiles = [
      '01-gather', '02-plan', '03-formulate', '04-debate', '05-adjust', '06-rebuttal', '07-vote',
    ];
    const phases: Record<string, unknown> = {};
    for (const pf of phaseFiles) {
      const fp = pathJoin(sessionPath, `${pf}.json`);
      if (existsSync(fp)) {
        phases[pf] = JSON.parse(await readFile(fp, 'utf-8'));
      }
    }

    // Read synthesis
    const synthPath = pathJoin(sessionPath, 'synthesis.json');
    let synthesis: unknown = null;
    if (existsSync(synthPath)) {
      synthesis = JSON.parse(await readFile(synthPath, 'utf-8'));
    }

    // Pick provider
    const config = await loadConfig();
    if (config.providers.length === 0) {
      console.error(chalk.red('No providers configured. Run: quorum init'));
      process.exit(1);
    }

    let providerConfig: ProviderConfig;
    if (opts.provider) {
      const found = config.providers.find(p => p.name === (opts.provider as string));
      if (!found) {
        console.error(chalk.red(`Provider not found: ${opts.provider}`));
        console.error(chalk.dim(`Available: ${config.providers.map(p => p.name).join(', ')}`));
        process.exit(1);
      }
      providerConfig = found;
    } else {
      providerConfig = config.providers[0];
    }

    const adapter = await createProvider(providerConfig);

    // Build prompt
    const sessionData = JSON.stringify({ meta, phases, synthesis }, null, 2);
    const analysisPrompt = `Here is the full data from an AI deliberation session:\n\n${sessionData}`;
    const systemPrompt = `Analyze this AI deliberation session. Why did the winner win? What was the key turning point in the debate? Where did the council fail to resolve disagreement? What patterns do you see in how the providers argued?`;

    console.log('');
    console.log(chalk.bold.cyan('🔍 Meta-Analysis'));
    console.log(chalk.dim(`Session: ${sessionPath}`));
    console.log(chalk.dim(`Analyzer: ${providerConfig.name} (${providerConfig.model})`));
    console.log('');

    try {
      if (adapter.generateStream) {
        await adapter.generateStream(analysisPrompt, systemPrompt, (delta) => {
          process.stdout.write(delta);
        });
        console.log('');
      } else {
        const result = await adapter.generate(analysisPrompt, systemPrompt);
        console.log(result);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }

    console.log('');
  });

// --- quorum diff ---
program
  .command('diff <session1> <session2>')
  .description('Compare two deliberation sessions side-by-side')
  .option('--json', 'Output as JSON')
  .option('--analyze', 'Use a provider to generate a narrative comparison of syntheses')
  .option('--provider <name>', 'Provider to use for --analyze (default: first configured)')
  .action(async (session1: string, session2: string, opts) => {
    const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');

    // Resolve session paths
    async function resolveSession(s: string): Promise<string> {
      if (s === 'last') {
        const indexPath = pathJoin(sessionsDir, 'index.json');
        if (existsSync(indexPath)) {
          try {
            const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{ sessionId: string }>;
            if (entries.length > 0) {
              return pathJoin(sessionsDir, entries[entries.length - 1].sessionId);
            }
          } catch { /* fall through */ }
        }
        return resolveLastSession(sessionsDir);
      }
      return s;
    }

    const path1 = await resolveSession(session1);
    const path2 = await resolveSession(session2);

    // Read session data
    async function loadSession(sp: string) {
      const metaPath = pathJoin(sp, 'meta.json');
      if (!existsSync(metaPath)) {
        console.error(chalk.red(`Session not found: ${sp}`));
        process.exit(1);
      }
      const meta = JSON.parse(await readFile(metaPath, 'utf-8'));

      let synthesis: any = null;
      const synthPath = pathJoin(sp, 'synthesis.json');
      if (existsSync(synthPath)) {
        synthesis = JSON.parse(await readFile(synthPath, 'utf-8'));
      }

      let vote: any = null;
      const votePath = pathJoin(sp, '07-vote.json');
      if (existsSync(votePath)) {
        vote = JSON.parse(await readFile(votePath, 'utf-8'));
      }

      return { meta, synthesis, vote, path: sp };
    }

    const s1 = await loadSession(path1);
    const s2 = await loadSession(path2);

    // Extract comparison data
    const q1 = String(s1.meta.input ?? '').slice(0, 200);
    const q2 = String(s2.meta.input ?? '').slice(0, 200);
    const providers1 = (s1.meta.providers ?? []).map((p: any) => p.name) as string[];
    const providers2 = (s2.meta.providers ?? []).map((p: any) => p.name) as string[];
    const winner1 = s1.synthesis?.votes?.winner ?? '(unknown)';
    const winner2 = s2.synthesis?.votes?.winner ?? '(unknown)';
    const consensus1 = s1.synthesis?.consensusScore ?? null;
    const consensus2 = s2.synthesis?.consensusScore ?? null;
    const confidence1 = s1.synthesis?.confidenceScore ?? null;
    const confidence2 = s2.synthesis?.confidenceScore ?? null;
    const rankings1 = s1.synthesis?.votes?.rankings ?? [];
    const rankings2 = s2.synthesis?.votes?.rankings ?? [];
    const synthContent1 = s1.synthesis?.content ?? '';
    const synthContent2 = s2.synthesis?.content ?? '';

    // Providers diff
    const onlyIn1 = providers1.filter((p: string) => !providers2.includes(p));
    const onlyIn2 = providers2.filter((p: string) => !providers1.includes(p));
    const common = providers1.filter((p: string) => providers2.includes(p));

    // Analyze flag
    let analysisNarrative: string | undefined;
    if (opts.analyze && synthContent1 && synthContent2) {
      const config = await loadConfig();
      if (config.providers.length === 0) {
        console.error(chalk.red('No providers configured for --analyze. Run: quorum init'));
        process.exit(1);
      }
      let providerConfig: ProviderConfig;
      if (opts.provider) {
        const found = config.providers.find(p => p.name === (opts.provider as string));
        if (!found) {
          console.error(chalk.red(`Provider not found: ${opts.provider}`));
          process.exit(1);
        }
        providerConfig = found;
      } else {
        providerConfig = config.providers[0];
      }

      const adapter = await createProvider(providerConfig);
      const prompt = [
        `Compare these two deliberation syntheses and summarize the key differences:\n`,
        `## Session 1 Question:\n${q1}\n`,
        `## Session 1 Synthesis:\n${synthContent1}\n`,
        `## Session 2 Question:\n${q2}\n`,
        `## Session 2 Synthesis:\n${synthContent2}\n`,
        `Provide a concise narrative comparison: what changed, what's consistent, and which synthesis is stronger (if determinable).`,
      ].join('\n');

      if (!opts.json) {
        console.log(chalk.dim(`Analyzing with ${providerConfig.name}...`));
      }
      try {
        analysisNarrative = await adapter.generate(prompt, 'You are an expert analyst comparing two AI deliberation outcomes. Be concise and insightful.');
      } catch (err) {
        if (!opts.json) {
          console.error(chalk.yellow(`Analysis failed: ${err instanceof Error ? err.message : err}`));
        }
      }
    }

    // JSON output
    if (opts.json) {
      const output: any = {
        session1: { path: path1, question: q1, providers: providers1, winner: winner1, consensus: consensus1, confidence: confidence1, rankings: rankings1 },
        session2: { path: path2, question: q2, providers: providers2, winner: winner2, consensus: consensus2, confidence: confidence2, rankings: rankings2 },
        providerDiff: { common, onlyInSession1: onlyIn1, onlyInSession2: onlyIn2 },
        winnerChanged: winner1 !== winner2,
        consensusDelta: consensus1 != null && consensus2 != null ? consensus2 - consensus1 : null,
        confidenceDelta: confidence1 != null && confidence2 != null ? confidence2 - confidence1 : null,
      };
      if (analysisNarrative) output.analysis = analysisNarrative;
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    // Display comparison
    console.log('');
    console.log(chalk.bold.cyan('📊 Session Diff'));
    console.log(chalk.dim('━'.repeat(60)));

    // Questions
    console.log('');
    console.log(chalk.bold('Question:'));
    if (q1 === q2) {
      console.log(`  ${q1}`);
    } else {
      console.log(`  ${chalk.dim('S1:')} ${q1}`);
      console.log(`  ${chalk.dim('S2:')} ${q2}`);
    }

    // Providers
    console.log('');
    console.log(chalk.bold('Providers:'));
    if (onlyIn1.length === 0 && onlyIn2.length === 0) {
      console.log(`  ${chalk.green('Same:')} ${providers1.join(', ')}`);
    } else {
      console.log(`  ${chalk.dim('Common:')} ${common.join(', ') || '(none)'}`);
      if (onlyIn1.length) console.log(`  ${chalk.red('Only S1:')} ${onlyIn1.join(', ')}`);
      if (onlyIn2.length) console.log(`  ${chalk.red('Only S2:')} ${onlyIn2.join(', ')}`);
    }

    // Winner
    console.log('');
    console.log(chalk.bold('Winner:'));
    if (winner1 === winner2) {
      console.log(`  ${chalk.green(winner1)} (unchanged)`);
    } else {
      console.log(`  ${chalk.dim('S1:')} ${chalk.yellow(winner1)}  →  ${chalk.dim('S2:')} ${chalk.yellow(winner2)}  ${chalk.red('(changed)')}`);
    }

    // Scores
    console.log('');
    console.log(chalk.bold('Scores:'));
    const fmtScore = (v: number | null) => v != null ? v.toFixed(2) : '—';
    const fmtDelta = (a: number | null, b: number | null) => {
      if (a == null || b == null) return '';
      const d = b - a;
      const sign = d >= 0 ? '+' : '';
      const color = d > 0 ? chalk.green : d < 0 ? chalk.red : chalk.dim;
      return color(` (${sign}${d.toFixed(2)})`);
    };
    console.log(`  Consensus:  ${fmtScore(consensus1)} → ${fmtScore(consensus2)}${fmtDelta(consensus1, consensus2)}`);
    console.log(`  Confidence: ${fmtScore(confidence1)} → ${fmtScore(confidence2)}${fmtDelta(confidence1, confidence2)}`);

    // Vote rankings
    console.log('');
    console.log(chalk.bold('Vote Rankings:'));
    const maxRankings = Math.max(rankings1.length, rankings2.length);
    if (maxRankings > 0) {
      console.log(`  ${'#'.padEnd(3)} ${'Session 1'.padEnd(25)} ${'Session 2'.padEnd(25)}`);
      console.log(`  ${'─'.repeat(3)} ${'─'.repeat(25)} ${'─'.repeat(25)}`);
      for (let i = 0; i < maxRankings; i++) {
        const r1 = rankings1[i];
        const r2 = rankings2[i];
        const left = r1 ? `${r1.provider} (${r1.score})` : '—';
        const right = r2 ? `${r2.provider} (${r2.score})` : '—';
        console.log(`  ${String(i + 1).padEnd(3)} ${left.padEnd(25)} ${right.padEnd(25)}`);
      }
    } else {
      console.log(chalk.dim('  No vote data available'));
    }

    // Analysis narrative
    if (analysisNarrative) {
      console.log('');
      console.log(chalk.bold.magenta('── Analysis ──'));
      console.log(analysisNarrative);
    }

    console.log('');
    console.log(chalk.dim(`S1: ${path1}`));
    console.log(chalk.dim(`S2: ${path2}`));
    console.log('');
  });

// --- quorum stats ---
program
  .command('stats')
  .description('Show provider statistics across all sessions')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
    const indexPath = pathJoin(sessionsDir, 'index.json');

    // Load index entries
    let entries: Array<{ sessionId: string; timestamp: number; question: string; winner: string; duration: number }> = [];
    if (existsSync(indexPath)) {
      try {
        entries = JSON.parse(await readFile(indexPath, 'utf-8'));
      } catch { /* ignore */ }
    }

    if (entries.length === 0) {
      if (opts.json) {
        console.log(JSON.stringify({ sessions: 0, message: 'No sessions found.' }));
      } else {
        console.log('');
        console.log(chalk.dim('No deliberation sessions found yet.'));
        console.log(chalk.dim('Run: quorum ask "your question" to get started.'));
        console.log('');
      }
      return;
    }

    // Scan synthesis files for vote data
    const providerWins: Record<string, number> = {};
    const providerParticipation: Record<string, number> = {};
    let totalConsensus = 0;
    let totalConfidence = 0;
    let consensusCount = 0;
    let confidenceCount = 0;
    let totalDuration = 0;
    let mostControversial: { sessionId: string; question: string; consensus: number } | null = null;

    for (const entry of entries) {
      totalDuration += entry.duration ?? 0;

      // Read synthesis for detailed vote data
      const synthPath = pathJoin(sessionsDir, entry.sessionId, 'synthesis.json');
      if (!existsSync(synthPath)) continue;
      try {
        const synth = JSON.parse(await readFile(synthPath, 'utf-8'));

        // Consensus & confidence
        if (typeof synth.consensusScore === 'number') {
          totalConsensus += synth.consensusScore;
          consensusCount++;
          if (!mostControversial || synth.consensusScore < mostControversial.consensus) {
            mostControversial = { sessionId: entry.sessionId, question: entry.question, consensus: synth.consensusScore };
          }
        }
        if (typeof synth.confidenceScore === 'number') {
          totalConfidence += synth.confidenceScore;
          confidenceCount++;
        }

        // Vote rankings → participation & wins
        const rankings = synth.votes?.rankings as Array<{ provider: string; score: number }> | undefined;
        const winner = synth.votes?.winner as string | undefined;
        if (rankings) {
          for (const r of rankings) {
            providerParticipation[r.provider] = (providerParticipation[r.provider] ?? 0) + 1;
          }
        }
        if (winner) {
          providerWins[winner] = (providerWins[winner] ?? 0) + 1;
        }
      } catch { /* skip bad files */ }
    }

    // Compute win rates
    const allProviders = new Set([...Object.keys(providerWins), ...Object.keys(providerParticipation)]);
    const providerStats = [...allProviders].map(name => {
      const wins = providerWins[name] ?? 0;
      const participated = providerParticipation[name] ?? 0;
      const winRate = participated > 0 ? wins / participated : 0;
      return { name, wins, participated, winRate };
    }).sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);

    const avgConsensus = consensusCount > 0 ? totalConsensus / consensusCount : null;
    const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : null;

    if (opts.json) {
      console.log(JSON.stringify({
        totalSessions: entries.length,
        totalDurationMs: totalDuration,
        avgConsensus,
        avgConfidence,
        providers: providerStats,
        mostControversial,
      }, null, 2));
      return;
    }

    // Display
    console.log('');
    console.log(chalk.bold.cyan('📊 Provider Statistics'));
    console.log(chalk.dim('━'.repeat(50)));
    console.log('');
    console.log(`  Sessions: ${chalk.bold(String(entries.length))}`);
    console.log(`  Total deliberation time: ${chalk.bold((totalDuration / 1000).toFixed(1) + 's')}`);
    if (avgConsensus != null) console.log(`  Avg consensus: ${chalk.bold(avgConsensus.toFixed(2))}`);
    if (avgConfidence != null) console.log(`  Avg confidence: ${chalk.bold(avgConfidence.toFixed(2))}`);
    console.log('');

    // Provider table
    console.log(chalk.bold('  Provider Win Rates:'));
    console.log('');
    for (const p of providerStats) {
      const pct = (p.winRate * 100).toFixed(0);
      const bar = '█'.repeat(Math.round(p.winRate * 20));
      console.log(`    ${p.name.padEnd(12)} ${chalk.cyan(bar.padEnd(20))} ${pct}%  (${p.wins}/${p.participated} sessions)`);
    }

    if (mostControversial) {
      console.log('');
      console.log(chalk.bold('  Most Controversial:'));
      console.log(`    ${chalk.yellow(mostControversial.question.slice(0, 80))}${mostControversial.question.length > 80 ? '...' : ''}`);
      console.log(`    Consensus: ${chalk.red(mostControversial.consensus.toFixed(2))}`);
      console.log(`    ${chalk.dim(pathJoin(sessionsDir, mostControversial.sessionId))}`);
    }

    console.log('');
  });

// --- quorum replay ---
program
  .command('replay')
  .description('Play back a deliberation session phase-by-phase with simulated typing')
  .argument('<session>', 'Session path or "last" for most recent')
  .option('--phase <name>', 'Filter to a single phase (e.g., debate, gather)')
  .option('--provider <name>', 'Filter to a single provider\'s responses')
  .option('--speed <speed>', 'Typing speed: fast (5ms), normal (20ms), slow (50ms)', 'normal')
  .action(async (sessionArg: string, opts) => {
    const speedMap: Record<string, number> = { fast: 5, normal: 20, slow: 50 };
    const delay = speedMap[(opts.speed as string)] ?? 20;

    // Resolve session path
    let sessionPath = sessionArg;
    if (sessionPath === 'last') {
      const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
      const indexPath = pathJoin(sessionsDir, 'index.json');
      if (existsSync(indexPath)) {
        try {
          const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{ sessionId: string }>;
          if (entries.length > 0) {
            sessionPath = pathJoin(sessionsDir, entries[entries.length - 1].sessionId);
          } else {
            sessionPath = await resolveLastSession(sessionsDir);
          }
        } catch {
          sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
        }
      } else {
        sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
      }
    }

    const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

    async function streamText(text: string): Promise<void> {
      for (const ch of text) {
        process.stdout.write(ch);
        await sleep(delay);
      }
      console.log('');
    }

    // Read meta.json header
    const metaPath = pathJoin(sessionPath, 'meta.json');
    if (!existsSync(metaPath)) {
      console.error(chalk.red(`Session not found: ${sessionPath}`));
      process.exit(1);
    }
    const meta = JSON.parse(await readFile(metaPath, 'utf-8'));

    console.log('');
    console.log(chalk.bold.cyan('🎬 Replay'));
    console.log(chalk.dim(`Question: ${String(meta.input ?? meta.question ?? '').slice(0, 200)}`));
    const providerNames = (meta.providers ?? []).map((p: any) => p.name).join(', ');
    console.log(chalk.dim(`Providers: ${providerNames}`));
    console.log(chalk.dim(`Profile: ${meta.profile ?? 'default'}`));
    if (meta.startedAt) console.log(chalk.dim(`Time: ${new Date(meta.startedAt).toLocaleString()}`));
    console.log('');

    // Phase files in order
    const phaseFiles = [
      { file: '01-gather', name: 'GATHER' },
      { file: '02-plan', name: 'PLAN' },
      { file: '03-formulate', name: 'FORMULATE' },
      { file: '04-debate', name: 'DEBATE' },
      { file: '05-adjust', name: 'ADJUST' },
      { file: '06-rebuttal', name: 'REBUTTAL' },
      { file: '07-vote', name: 'VOTE' },
    ];

    const phaseFilter = opts.phase ? (opts.phase as string).toLowerCase() : null;
    const providerFilter = opts.provider as string | undefined;

    for (const { file, name } of phaseFiles) {
      if (phaseFilter && !name.toLowerCase().startsWith(phaseFilter) && !file.includes(phaseFilter)) continue;

      const phasePath = pathJoin(sessionPath, `${file}.json`);
      if (!existsSync(phasePath)) continue;

      const phase = JSON.parse(await readFile(phasePath, 'utf-8'));
      const responses = phase.responses ?? phase.entries ?? {};

      console.log(chalk.bold.magenta(`═══ ${phase.phase ?? name} ═══`));
      console.log('');

      for (const [provider, content] of Object.entries(responses)) {
        if (providerFilter && provider.toLowerCase() !== providerFilter.toLowerCase()) continue;
        console.log(chalk.bold.yellow(`── ${provider} ──`));
        await streamText(String(content));
        console.log('');
      }

      const dur = phase.duration != null ? `${(phase.duration / 1000).toFixed(1)}s` : '?';
      console.log(chalk.dim(`  Phase duration: ${dur}`));
      console.log('');
    }

    // Synthesis
    if (!phaseFilter || phaseFilter === 'synthesis') {
      const synthPath = pathJoin(sessionPath, 'synthesis.json');
      if (existsSync(synthPath)) {
        const synth = JSON.parse(await readFile(synthPath, 'utf-8'));

        console.log(chalk.bold.green('═══ SYNTHESIS ═══'));
        console.log('');
        if (synth.content) {
          await streamText(String(synth.content));
          console.log('');
        }

        // Vote rankings
        const rankings = synth.votes?.rankings as Array<{ provider: string; score: number }> | undefined;
        const winner = synth.votes?.winner as string | undefined;
        if (rankings) {
          console.log(chalk.bold('🗳️  Vote Rankings'));
          for (const r of rankings) {
            console.log(`  ${r.provider}: ${r.score} pts${r.provider === winner ? ' 👑' : ''}`);
          }
          console.log('');
        }
      }
    }
  });

// --- quorum rerun ---
program
  .command('rerun')
  .description('Re-run a previous question with different providers')
  .argument('<session>', 'Session path or "last"')
  .option('-p, --providers <names>', 'Comma-separated provider names')
  .option('--profile <name>', 'Agent profile')
  .option('--compare', 'Auto-compare with original session after completion')
  .option('--json', 'Output result as JSON')
  .option('--timeout <seconds>', 'Override per-provider timeout in seconds')
  .option('-r, --rapid', 'Rapid mode')
  .option('--devils-advocate', 'Assign one provider as devil\'s advocate')
  .action(async (sessionArg: string, opts) => {
    // Resolve session path
    let originalSessionPath = sessionArg;
    if (sessionArg === 'last') {
      const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
      const indexPath = pathJoin(sessionsDir, 'index.json');
      if (existsSync(indexPath)) {
        try {
          const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{ sessionId: string }>;
          if (entries.length > 0) {
            originalSessionPath = pathJoin(sessionsDir, entries[entries.length - 1].sessionId);
          } else {
            originalSessionPath = await resolveLastSession(sessionsDir);
          }
        } catch {
          originalSessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
        }
      } else {
        originalSessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
      }
    }

    // Read original session meta to get the question
    const metaPath = pathJoin(originalSessionPath, 'meta.json');
    if (!existsSync(metaPath)) {
      console.error(chalk.red(`Session not found: ${originalSessionPath}`));
      process.exit(1);
    }
    const originalMeta = JSON.parse(await readFile(metaPath, 'utf-8'));
    const question = originalMeta.input as string;
    if (!question || !question.trim()) {
      console.error(chalk.red('Original session has no question (input) in meta.json.'));
      process.exit(1);
    }

    // Load config
    const config = await loadConfig();
    if (config.providers.length === 0) {
      console.error(chalk.red('No providers configured. Run: quorum init'));
      process.exit(1);
    }

    // Apply timeout override
    const timeoutOverride = opts.timeout ? parseInt(opts.timeout as string) : undefined;
    if (timeoutOverride !== undefined) {
      if (isNaN(timeoutOverride) || timeoutOverride <= 0) {
        console.error(chalk.red(`Invalid --timeout value.`));
        process.exit(1);
      }
      for (const p of config.providers) p.timeout = timeoutOverride;
    }

    // Filter providers
    let providers = config.providers;
    if (opts.providers) {
      const names = (opts.providers as string).split(',').map(s => s.trim());
      providers = config.providers.filter(p => names.includes(p.name));
      if (providers.length === 0) {
        console.error(chalk.red(`No matching providers: ${opts.providers}`));
        console.error(chalk.dim(`Available: ${config.providers.map(p => p.name).join(', ')}`));
        process.exit(1);
      }
    }

    const isJSON = opts.json;

    // Load profile (use original session's profile as default if not specified)
    const profileName = (opts.profile as string) ?? originalMeta.profile ?? 'default';
    const profile = await loadAgentProfile(profileName);
    if (!profile) {
      console.error(chalk.red(`Profile not found: ${profileName}`));
      process.exit(1);
    }

    // Filter excluded providers
    const excluded = new Set(profile.excludeFromDeliberation?.map(s => s.toLowerCase()) ?? []);
    const candidateProviders = providers.filter(
      p => !excluded.has(p.name.toLowerCase()) && !excluded.has(p.provider.toLowerCase()),
    );

    if (candidateProviders.length < 2) {
      console.error(chalk.red(`Need 2+ providers for deliberation (${candidateProviders.length} configured).`));
      process.exit(1);
    }

    const adapters = await Promise.all(candidateProviders.map(p => createProvider(p)));

    if (!isJSON) {
      console.log('');
      console.log(chalk.bold.cyan(`🔄 Re-running previous deliberation`));
      console.log(chalk.dim(`Original session: ${originalSessionPath}`));
      console.log(chalk.dim(`Question: ${question.slice(0, 120)}${question.length > 120 ? '...' : ''}`));
      console.log(chalk.dim(`Providers: ${candidateProviders.map(p => p.name).join(', ')}`));
      console.log(chalk.dim(`Profile: ${profile.name}`));
      console.log('');
    }

    const council = new CouncilV2(adapters, candidateProviders, profile, {
      streaming: true,
      rapid: opts.rapid ?? false,
      devilsAdvocate: opts.devilsAdvocate ?? profile.devilsAdvocate ?? false,
      weights: profile.weights,
      onEvent(event, data) {
        if (isJSON) return;
        const d = data as Record<string, unknown>;
        switch (event) {
          case 'phase':
            process.stdout.write(chalk.bold(`  ▸ ${d.phase} `));
            break;
          case 'response': {
            const fallback = d.fallback ? chalk.yellow('⚠') : chalk.green('✓');
            process.stdout.write(`${fallback}${chalk.dim(d.provider as string)} `);
            break;
          }
          case 'phase:done': {
            const secs = ((d.duration as number) / 1000).toFixed(1);
            console.log(chalk.dim(`(${secs}s)`));
            break;
          }
          case 'votes': {
            const v = d as unknown as { rankings: Array<{ provider: string; score: number }>; winner: string; controversial: boolean };
            console.log('');
            console.log(chalk.bold('  🗳️  Results'));
            const maxScore = v.rankings[0]?.score || 1;
            for (const r of v.rankings) {
              const bar = '█'.repeat(Math.round((r.score / maxScore) * 12));
              const crown = r.provider === v.winner ? ' 👑' : '';
              console.log(`     ${chalk.dim(r.provider.padEnd(10))} ${chalk.cyan(bar)} ${r.score}${crown}`);
            }
            if (v.controversial) console.log(chalk.yellow('     ⚠ Close vote — positions nearly tied'));
            break;
          }
          case 'complete':
            console.log(chalk.dim(`\n  ⏱  ${((d.duration as number) / 1000).toFixed(1)}s total`));
            break;
        }
      },
    });

    try {
      const result = await council.deliberate(question);

      if (isJSON) {
        const output: any = {
          synthesis: result.synthesis.content,
          synthesizer: result.synthesis.synthesizer,
          consensus: result.synthesis.consensusScore,
          confidence: result.synthesis.confidenceScore,
          winner: result.votes.winner,
          rankings: result.votes.rankings,
          duration: result.duration,
          sessionPath: result.sessionPath,
          rerunFrom: originalSessionPath,
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        // Display synthesis
        console.log('');
        console.log(chalk.bold.green('━'.repeat(60)));
        console.log('');
        let displayContent = result.synthesis.content;
        for (const heading of ['## Minority Report', '## Scores', '## Minority']) {
          const idx = displayContent.indexOf(heading);
          if (idx > 0) displayContent = displayContent.slice(0, idx).trimEnd();
        }
        displayContent = displayContent.replace(/^##\s*Synthesis\s*\n+/i, '');
        console.log(displayContent);

        if (result.synthesis.minorityReport && result.synthesis.minorityReport !== 'None' && result.synthesis.minorityReport.trim()) {
          console.log('');
          console.log(chalk.bold.yellow('── Minority Report ──'));
          console.log(result.synthesis.minorityReport);
        }

        console.log('');
        console.log(chalk.bold.green('━'.repeat(60)));
        const meta = [
          `Winner: ${result.votes.winner}`,
          `Synthesized by: ${result.synthesis.synthesizer}`,
          `Consensus: ${result.synthesis.consensusScore}`,
          `Confidence: ${result.synthesis.confidenceScore}`,
        ].join(' | ');
        console.log(chalk.dim(meta));
        console.log(chalk.dim(`Session: ${result.sessionPath}`));
      }

      // Summary
      if (!isJSON) {
        console.log('');
        console.log(chalk.bold(`Re-ran '${question.slice(0, 80)}${question.length > 80 ? '...' : ''}' with [${candidateProviders.map(p => p.name).join(', ')}] — new session: ${result.sessionPath}`));
      }

      // Auto-compare if --compare
      if (opts.compare) {
        const newSessionPath = result.sessionPath;
        if (!isJSON) {
          console.log('');
          console.log(chalk.bold.cyan('📊 Auto-Compare: Original vs Re-run'));
          console.log(chalk.dim('━'.repeat(60)));
        }

        // Load both sessions for comparison (reuse diff logic)
        async function loadSessionForDiff(sp: string) {
          const mp = pathJoin(sp, 'meta.json');
          const metaData = existsSync(mp) ? JSON.parse(await readFile(mp, 'utf-8')) : {};
          let synthesis: any = null;
          const synthP = pathJoin(sp, 'synthesis.json');
          if (existsSync(synthP)) synthesis = JSON.parse(await readFile(synthP, 'utf-8'));
          return { meta: metaData, synthesis, path: sp };
        }

        const s1 = await loadSessionForDiff(originalSessionPath);
        const s2 = await loadSessionForDiff(newSessionPath);

        const q1 = String(s1.meta.input ?? '').slice(0, 200);
        const q2 = String(s2.meta.input ?? '').slice(0, 200);
        const providers1 = (s1.meta.providers ?? []).map((p: any) => p.name) as string[];
        const providers2 = (s2.meta.providers ?? []).map((p: any) => p.name) as string[];
        const winner1 = s1.synthesis?.votes?.winner ?? '(unknown)';
        const winner2 = s2.synthesis?.votes?.winner ?? '(unknown)';
        const consensus1 = s1.synthesis?.consensusScore ?? null;
        const consensus2 = s2.synthesis?.consensusScore ?? null;
        const confidence1 = s1.synthesis?.confidenceScore ?? null;
        const confidence2 = s2.synthesis?.confidenceScore ?? null;
        const rankings1 = s1.synthesis?.votes?.rankings ?? [];
        const rankings2 = s2.synthesis?.votes?.rankings ?? [];

        const onlyIn1 = providers1.filter((p: string) => !providers2.includes(p));
        const onlyIn2 = providers2.filter((p: string) => !providers1.includes(p));
        const common = providers1.filter((p: string) => providers2.includes(p));

        if (isJSON) {
          const output: any = {
            session1: { path: originalSessionPath, question: q1, providers: providers1, winner: winner1, consensus: consensus1, confidence: confidence1, rankings: rankings1 },
            session2: { path: newSessionPath, question: q2, providers: providers2, winner: winner2, consensus: consensus2, confidence: confidence2, rankings: rankings2 },
            providerDiff: { common, onlyInSession1: onlyIn1, onlyInSession2: onlyIn2 },
            winnerChanged: winner1 !== winner2,
            consensusDelta: consensus1 != null && consensus2 != null ? consensus2 - consensus1 : null,
            confidenceDelta: confidence1 != null && confidence2 != null ? confidence2 - confidence1 : null,
          };
          console.log(JSON.stringify(output, null, 2));
        } else {
          // Providers
          console.log('');
          console.log(chalk.bold('Providers:'));
          if (onlyIn1.length === 0 && onlyIn2.length === 0) {
            console.log(`  ${chalk.green('Same:')} ${providers1.join(', ')}`);
          } else {
            console.log(`  ${chalk.dim('Common:')} ${common.join(', ') || '(none)'}`);
            if (onlyIn1.length) console.log(`  ${chalk.red('Only Original:')} ${onlyIn1.join(', ')}`);
            if (onlyIn2.length) console.log(`  ${chalk.red('Only Re-run:')} ${onlyIn2.join(', ')}`);
          }

          // Winner
          console.log('');
          console.log(chalk.bold('Winner:'));
          if (winner1 === winner2) {
            console.log(`  ${chalk.green(winner1)} (unchanged)`);
          } else {
            console.log(`  ${chalk.dim('Original:')} ${chalk.yellow(winner1)}  →  ${chalk.dim('Re-run:')} ${chalk.yellow(winner2)}  ${chalk.red('(changed)')}`);
          }

          // Scores
          console.log('');
          console.log(chalk.bold('Scores:'));
          const fmtScore = (v: number | null) => v != null ? v.toFixed(2) : '—';
          const fmtDelta = (a: number | null, b: number | null) => {
            if (a == null || b == null) return '';
            const d = b - a;
            const sign = d >= 0 ? '+' : '';
            const color = d > 0 ? chalk.green : d < 0 ? chalk.red : chalk.dim;
            return color(` (${sign}${d.toFixed(2)})`);
          };
          console.log(`  Consensus:  ${fmtScore(consensus1)} → ${fmtScore(consensus2)}${fmtDelta(consensus1, consensus2)}`);
          console.log(`  Confidence: ${fmtScore(confidence1)} → ${fmtScore(confidence2)}${fmtDelta(confidence1, confidence2)}`);

          // Rankings
          console.log('');
          console.log(chalk.bold('Vote Rankings:'));
          const maxRankings = Math.max(rankings1.length, rankings2.length);
          if (maxRankings > 0) {
            console.log(`  ${'#'.padEnd(3)} ${'Original'.padEnd(25)} ${'Re-run'.padEnd(25)}`);
            console.log(`  ${'─'.repeat(3)} ${'─'.repeat(25)} ${'─'.repeat(25)}`);
            for (let i = 0; i < maxRankings; i++) {
              const r1 = rankings1[i];
              const r2 = rankings2[i];
              const left = r1 ? `${r1.provider} (${r1.score})` : '—';
              const right = r2 ? `${r2.provider} (${r2.score})` : '—';
              console.log(`  ${String(i + 1).padEnd(3)} ${left.padEnd(25)} ${right.padEnd(25)}`);
            }
          }

          console.log('');
          console.log(chalk.dim(`Original: ${originalSessionPath}`));
          console.log(chalk.dim(`Re-run:   ${newSessionPath}`));
          console.log('');
        }
      } else if (!isJSON) {
        console.log('');
      }
    } catch (err) {
      console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  });

// --- quorum watch ---
program
  .command('watch')
  .description('Watch files and re-run deliberation on changes')
  .argument('<files...>', 'File paths or globs to watch')
  .option('-p, --providers <names>', 'Comma-separated provider names')
  .option('--profile <name>', 'Agent profile', 'code-review')
  .option('-r, --rapid', 'Rapid mode (default: true for watch)', true)
  .option('--debounce <ms>', 'Debounce interval in ms', '1000')
  .action(async (fileArgs: string[], opts) => {
    const { watch, statSync, readdirSync } = await import('node:fs');
    const { resolve, dirname, relative } = await import('node:path');
    const { readFile: rf } = await import('node:fs/promises');

    // Resolve globs/files to actual file paths
    const resolvedFiles = new Set<string>();

    function walkDir(dir: string): string[] {
      const results: string[] = [];
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = pathJoin(dir, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              results.push(...walkDir(full));
            }
          } else {
            results.push(full);
          }
        }
      } catch { /* skip unreadable dirs */ }
      return results;
    }

    function matchGlob(pattern: string, filePath: string): boolean {
      // Simple glob matching: * matches anything except /, ** matches anything including /
      const regexStr = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '{{GLOBSTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/\{\{GLOBSTAR\}\}/g, '.*');
      return new RegExp(`^${regexStr}$`).test(filePath);
    }

    for (const arg of fileArgs) {
      const absArg = resolve(arg);
      try {
        const st = statSync(absArg);
        if (st.isFile()) {
          resolvedFiles.add(absArg);
        } else if (st.isDirectory()) {
          for (const f of walkDir(absArg)) resolvedFiles.add(f);
        }
      } catch {
        // Might be a glob pattern
        if (arg.includes('*')) {
          // Try fs.globSync if available (Node 22+), fallback to manual walk
          try {
            const { globSync } = await import('node:fs');
            if (globSync) {
              for (const f of globSync(arg)) resolvedFiles.add(resolve(f));
            }
          } catch {
            // Manual glob: walk cwd and match
            const cwd = process.cwd();
            for (const f of walkDir(cwd)) {
              const rel = relative(cwd, f);
              if (matchGlob(arg, rel)) resolvedFiles.add(f);
            }
          }
        } else {
          console.error(chalk.red(`File not found: ${arg}`));
          process.exit(1);
        }
      }
    }

    if (resolvedFiles.size === 0) {
      console.error(chalk.red('No files matched the given patterns.'));
      process.exit(1);
    }

    const fileList = [...resolvedFiles];
    const debounceMs = parseInt(opts.debounce as string) || 1000;

    console.log('');
    console.log(chalk.bold.cyan(`👁  Watching ${fileList.length} file(s) for changes... (Ctrl+C to stop)`));
    for (const f of fileList.slice(0, 10)) {
      console.log(chalk.dim(`  ${relative(process.cwd(), f)}`));
    }
    if (fileList.length > 10) {
      console.log(chalk.dim(`  ... and ${fileList.length - 10} more`));
    }
    console.log('');

    // Watch parent directories of matched files
    const watchedDirs = new Set<string>();
    const watchers: ReturnType<typeof watch>[] = [];
    for (const f of fileList) {
      const dir = dirname(f);
      if (!watchedDirs.has(dir)) {
        watchedDirs.add(dir);
        try {
          const w = watch(dir, { recursive: false }, (_event, filename) => {
            if (filename) {
              const full = pathJoin(dir, filename);
              if (resolvedFiles.has(full)) {
                onFileChange(full);
              }
            }
          });
          watchers.push(w);
        } catch {
          // Some dirs may not be watchable
        }
      }
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let changedFiles = new Set<string>();
    let running = false;

    function onFileChange(filePath: string) {
      changedFiles.add(filePath);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!running) {
          runDeliberation();
        }
      }, debounceMs);
    }

    async function runDeliberation() {
      const filesToReview = [...changedFiles];
      changedFiles = new Set();
      running = true;

      const timestamp = new Date().toLocaleTimeString();
      console.log('');
      console.log(chalk.bold.cyan(`━━━ Change detected at ${timestamp} ━━━`));
      for (const f of filesToReview) {
        console.log(chalk.dim(`  Changed: ${relative(process.cwd(), f)}`));
      }
      console.log('');

      try {
        // Build content from changed files
        let content = '';
        for (const filePath of filesToReview) {
          try {
            const fileContent = await rf(filePath, 'utf-8');
            const ext = extname(filePath).slice(1) || 'text';
            content += `## File: ${relative(process.cwd(), filePath)}\n\`\`\`${ext}\n${fileContent}\n\`\`\`\n\n`;
          } catch (err) {
            console.error(chalk.yellow(`  Warning: Could not read ${filePath}: ${err instanceof Error ? err.message : err}`));
          }
        }

        if (!content.trim()) {
          console.log(chalk.yellow('No readable content in changed files.'));
          running = false;
          return;
        }

        // Run deliberation via ask command args
        const askArgs = ['ask', content];
        askArgs.push('--profile', opts.profile as string);
        if (opts.providers) askArgs.push('--providers', opts.providers as string);
        if (opts.rapid) askArgs.push('--rapid');

        await program.parseAsync(['node', 'quorum', ...askArgs]);
      } catch (err) {
        console.error(chalk.red(`Error during deliberation: ${err instanceof Error ? err.message : err}`));
      }

      running = false;
      console.log('');
      console.log(chalk.dim(`Watching for more changes...`));
    }

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('');
      console.log(chalk.dim('Closing watchers...'));
      for (const w of watchers) {
        try { w.close(); } catch { /* ignore */ }
      }
      process.exit(0);
    });
  });

// --- quorum evidence ---
program
  .command('evidence')
  .description('View evidence reports and cross-references for a session')
  .argument('<session>', 'Session path or "last" for most recent')
  .option('--provider <name>', 'Filter to one provider')
  .option('--tier <tier>', 'Filter by source tier (A, B, C, D, F)')
  .option('--json', 'Output raw JSON')
  .action(async (sessionArg: string, opts) => {
    // Resolve session path
    let sessionPath = sessionArg;
    if (sessionPath === 'last') {
      const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
      const indexPath = pathJoin(sessionsDir, 'index.json');
      if (existsSync(indexPath)) {
        try {
          const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{ sessionId: string }>;
          if (entries.length > 0) {
            sessionPath = pathJoin(sessionsDir, entries[entries.length - 1].sessionId);
          } else {
            sessionPath = await resolveLastSession(sessionsDir);
          }
        } catch {
          sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
        }
      } else {
        sessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
      }
    }

    // Load evidence report
    const reportPath = pathJoin(sessionPath, 'evidence-report.json');
    if (!existsSync(reportPath)) {
      console.error(chalk.red(`No evidence report found at ${reportPath}`));
      console.error(chalk.dim('Run a deliberation with --evidence advisory or --evidence strict first.'));
      process.exit(1);
    }

    type SourceTier = 'A' | 'B' | 'C' | 'D' | 'F';

    interface EvidenceClaimData {
      claim: string;
      source?: string;
      sourceTier: SourceTier;
      quoteSpan?: string;
      confidence: number;
      claimHash: string;
    }

    interface EvidenceReportData {
      provider: string;
      totalClaims: number;
      supportedClaims: number;
      unsupportedClaims: number;
      evidenceScore: number;
      tierBreakdown: Record<SourceTier, number>;
      weightedScore: number;
      claims: EvidenceClaimData[];
    }

    interface CrossReferenceData {
      claimText: string;
      providers: string[];
      corroborated: boolean;
      contradicted: boolean;
      contradictions?: string[];
      bestSourceTier: SourceTier;
    }

    let reports: EvidenceReportData[] = JSON.parse(await readFile(reportPath, 'utf-8'));

    // Load cross-references if available
    let crossRefs: CrossReferenceData[] = [];
    const crossRefPath = pathJoin(sessionPath, 'cross-references.json');
    if (existsSync(crossRefPath)) {
      crossRefs = JSON.parse(await readFile(crossRefPath, 'utf-8'));
    }

    // Filter by provider
    if (opts.provider) {
      const name = opts.provider as string;
      reports = reports.filter(r => r.provider.toLowerCase() === name.toLowerCase());
      if (reports.length === 0) {
        console.error(chalk.red(`No report found for provider: ${name}`));
        process.exit(1);
      }
    }

    // Filter by tier
    const tierFilter = opts.tier ? (opts.tier as string).toUpperCase() as SourceTier : undefined;
    if (tierFilter && !['A', 'B', 'C', 'D', 'F'].includes(tierFilter)) {
      console.error(chalk.red(`Invalid tier: ${opts.tier}. Must be A, B, C, D, or F.`));
      process.exit(1);
    }

    // Grade calculation
    function evidenceGrade(weightedScore: number): string {
      if (weightedScore >= 0.8) return 'A';
      if (weightedScore >= 0.6) return 'B';
      if (weightedScore >= 0.4) return 'C';
      if (weightedScore >= 0.2) return 'D';
      return 'F';
    }

    // JSON output
    if (opts.json) {
      const output: { reports: EvidenceReportData[]; crossReferences: CrossReferenceData[] } = {
        reports,
        crossReferences: crossRefs,
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    // Extract session ID from path
    const sessionId = sessionPath.split('/').pop() ?? sessionPath;

    console.log('');
    console.log(chalk.bold(`📋 Evidence Report — Session ${sessionId}`));
    console.log('');

    // Summary table
    const colProvider = 13;
    const colScore = 7;
    const colWeighted = 10;
    const colClaims = 9;
    const colTier = 18;
    const colGrade = 10;

    const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
    const padC = (s: string, n: number) => {
      const total = n - s.length;
      const left = Math.floor(total / 2);
      return ' '.repeat(Math.max(0, left)) + s + ' '.repeat(Math.max(0, total - left));
    };

    const hdr = `│ ${pad('Provider', colProvider)} │ ${padC('Score', colScore)} │ ${padC('Weighted', colWeighted)} │ ${padC('Claims', colClaims)} │ ${pad('Tier Breakdown', colTier)} │ ${padC('Grade', colGrade)} │`;
    const divTop = `┌${'─'.repeat(colProvider + 2)}┬${'─'.repeat(colScore + 2)}┬${'─'.repeat(colWeighted + 2)}┬${'─'.repeat(colClaims + 2)}┬${'─'.repeat(colTier + 2)}┬${'─'.repeat(colGrade + 2)}┐`;
    const divMid = `├${'─'.repeat(colProvider + 2)}┼${'─'.repeat(colScore + 2)}┼${'─'.repeat(colWeighted + 2)}┼${'─'.repeat(colClaims + 2)}┼${'─'.repeat(colTier + 2)}┼${'─'.repeat(colGrade + 2)}┤`;
    const divBot = `└${'─'.repeat(colProvider + 2)}┴${'─'.repeat(colScore + 2)}┴${'─'.repeat(colWeighted + 2)}┴${'─'.repeat(colClaims + 2)}┴${'─'.repeat(colTier + 2)}┴${'─'.repeat(colGrade + 2)}┘`;

    console.log(divTop);
    console.log(hdr);
    console.log(divMid);

    for (const r of reports) {
      const score = `${Math.round(r.evidenceScore * 100)}%`;
      const weighted = `${Math.round(r.weightedScore * 100)}%`;
      const claims = `${r.supportedClaims}/${r.totalClaims}`;
      const tb = r.tierBreakdown;
      const tierStr = ['A', 'B', 'C', 'D', 'F'].map(t => `${tb[t as SourceTier] ?? 0}${t}`).join(' ');
      const grade = evidenceGrade(r.weightedScore);

      const gradeColor = grade === 'A' ? chalk.green : grade === 'B' ? chalk.cyan : grade === 'C' ? chalk.yellow : grade === 'D' ? chalk.red : chalk.bgRed;

      console.log(`│ ${pad(r.provider, colProvider)} │ ${padC(score, colScore)} │ ${padC(weighted, colWeighted)} │ ${padC(claims, colClaims)} │ ${pad(tierStr, colTier)} │ ${padC(gradeColor(grade), colGrade)} │`);
    }

    console.log(divBot);

    // Cross-references
    if (crossRefs.length > 0) {
      console.log('');
      console.log(chalk.bold('Cross-References:'));
      for (const cr of crossRefs) {
        if (cr.corroborated) {
          console.log(`  ${chalk.green('✅')} "${cr.claimText}" — ${cr.providers.join(', ')} (tier ${cr.bestSourceTier})`);
        } else if (cr.contradicted) {
          const details = cr.contradictions?.join('; ') ?? '';
          console.log(`  ${chalk.yellow('⚠️')}  "${cr.claimText}" — ${details || cr.providers.join(' vs ')}`);
        }
      }
    }

    // Provider detail
    for (const r of reports) {
      let claims = r.claims;
      if (tierFilter) {
        claims = claims.filter(c => c.sourceTier === tierFilter);
      }
      if (claims.length === 0) continue;

      console.log('');
      console.log(chalk.bold(`Provider Detail — ${r.provider}:`));

      for (const c of claims) {
        const icon = c.sourceTier === 'A' || c.sourceTier === 'B'
          ? chalk.green('✅')
          : c.sourceTier === 'C' || c.sourceTier === 'D'
            ? chalk.yellow('⚠️')
            : chalk.red('❌');
        const sourceInfo = c.source ? ` [source: ${c.source}]` : '';
        console.log(`  ${icon} [${c.sourceTier}] "${c.claim}"${chalk.dim(sourceInfo)}`);
      }
    }

    console.log('');
  });

// --- quorum topologies ---
program
  .command('topologies')
  .alias('topo')
  .description('List available debate topologies')
  .action(async () => {
    const topos = listTopologies();
    console.log(chalk.bold('\nAvailable topologies:\n'));
    for (const t of topos) {
      console.log(`  ${chalk.cyan('🔷')} ${chalk.bold(t.name.padEnd(20))} ${t.description}`);
      console.log(chalk.dim(`     Best for: ${t.bestFor}`));
    }
    console.log('');
    console.log(chalk.dim('Usage: quorum ask --topology tournament "question"'));
  });

program.parse();
