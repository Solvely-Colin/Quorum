import type { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, loadProjectConfig, loadAgentProfile } from '../config.js';
import { CouncilV2 } from '../council-v2.js';
import type { AdaptivePreset } from '../adaptive.js';
import { createProvider } from '../providers/base.js';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import { homedir } from 'node:os';
import type { AgentProfile } from '../types.js';
import { formatRedTeamReport, type RedTeamResult } from '../redteam.js';
import { CLIError, readStdin, displayDryRun } from './helpers.js';

export function registerAskCommand(program: Command): void {
  program
    .command('ask')
    .description('Ask the council a question')
    .argument('[question]', 'Question to ask (or pipe via stdin)')
    .option('-p, --providers <names>', 'Comma-separated provider names')
    .option(
      '--profile <name>',
      'Agent profile (default, brainstorm, code-review, research)',
      'default',
    )
    .option('-1, --single [name]', 'Single provider mode (skip deliberation)')
    .option('-v, --verbose', 'Show phase-by-phase progress')
    .option('--audit <path>', 'Save full session JSON to file')
    .option('--json', 'Output result as JSON (for piping)')
    .option('--timeout <seconds>', 'Override per-provider timeout in seconds')
    .option('-r, --rapid', 'Rapid mode — skip plan, formulate, adjust, rebuttal, vote phases')
    .option('--devils-advocate', "Assign one provider as devil's advocate")
    .option('--dry-run', 'Preview what would happen without making API calls')
    .option(
      '--challenge-style <style>',
      'Override profile challengeStyle (adversarial|collaborative|socratic)',
    )
    .option('--focus <topics>', 'Comma-separated list to override profile focus')
    .option('--convergence <threshold>', 'Override convergenceThreshold (0.0-1.0)')
    .option('--rounds <n>', 'Override number of rounds')
    .option(
      '--weight <weights>',
      'Comma-separated provider weight multipliers (e.g. claude=2,openai=1,ollama=0.5)',
    )
    .option('--voting-method <method>', 'Voting method: borda, ranked-choice, approval, condorcet')
    .option('--heatmap', 'Show consensus heatmap (default: on when 3+ providers)')
    .option('--no-heatmap', 'Disable consensus heatmap')
    .option('--no-hooks', 'Skip all pre/post hooks defined in the profile')
    .option('--tools', 'Enable tool use in gather phase (web search, file reading)')
    .option('--allow-shell', 'Enable shell tool (requires --tools)')
    .option('--evidence <mode>', 'Evidence-backed claims mode: off, advisory, strict')
    .option('--adaptive <preset>', 'Adaptive debate controller: fast, balanced, critical, off')
    .option('--red-team', 'Enable adversarial red-team analysis')
    .option(
      '--attack-pack <packs>',
      'Comma-separated attack packs (general, code, security, legal, medical)',
    )
    .option('--custom-attacks <attacks>', 'Comma-separated custom attack prompts')
    .option(
      '--topology <name>',
      'Debate topology: mesh, star, tournament, map_reduce, adversarial_tree, pipeline, panel',
    )
    .option('--topology-hub <provider>', 'Hub provider for star topology')
    .option('--topology-moderator <provider>', 'Moderator for panel topology')
    .option('--no-memory', 'Skip deliberation memory (no retrieval or storage)')
    .option('--reputation', 'Enable reputation-weighted voting from arena data')
    .option('--hitl', 'Enable HITL checkpoints (default: after-vote, on-controversy)')
    .option('--hitl-checkpoints <list>', 'Comma-separated HITL checkpoint list')
    .option('--hitl-threshold <n>', 'HITL controversy threshold (default 0.5)')
    .option('--policy <name>', 'Use only the named policy for guardrail checks')
    .option('--interactive', 'Enable constitutional intervention points between phases')
    .option('--schema <name>', 'Use a reasoning schema to guide deliberation')
    .option('--live', 'Show streaming text from each provider as it arrives')
    .action(async (question: string | undefined, opts) => {
      // Read from stdin if no question arg
      if (!question) {
        if (process.stdin.isTTY) {
          throw new CLIError(chalk.red('No question provided. Usage: quorum ask "your question"') + '\n' + chalk.dim('Or pipe: echo "question" | quorum ask'));
        }
        question = await readStdin();
        if (!question.trim()) {
          throw new CLIError(chalk.red('Empty input.'));
        }
      }

      const config = await loadConfig();
      const projectConfig = await loadProjectConfig();

      if (config.providers.length === 0) {
        throw new CLIError(chalk.red('No providers configured. Run: quorum init'));
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
          throw new CLIError(
            chalk.red(
              `Invalid --timeout value: "${opts.timeout}". Must be a positive number of seconds.`,
            ),
          );
        }
        for (const p of config.providers) {
          p.timeout = timeoutOverride;
        }
      }

      // Filter providers
      let providers = config.providers;
      if (opts.providers) {
        const names = (opts.providers as string).split(',').map((s) => s.trim());
        providers = config.providers.filter((p) => names.includes(p.name));
        if (providers.length === 0) {
          throw new CLIError(chalk.red(`No matching providers: ${opts.providers}`) + '\n' + chalk.dim(`Available: ${config.providers.map((p) => p.name).join(', ')}`));
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
        const builtinDir = pathJoin(__dirname, '..', '..', 'agents');
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
          } catch {
            /* dir doesn't exist */
          }
        }
        throw new CLIError(chalk.red(`Profile not found: ${opts.profile}`) + '\n' +
          chalk.dim(`Available: ${available.size > 0 ? [...available].join(', ') : '(none found)'}`),
        );
      }

      // Apply CLI profile overrides
      if (opts.challengeStyle) {
        const style = opts.challengeStyle as string;
        if (!['adversarial', 'collaborative', 'socratic'].includes(style)) {
          throw new CLIError(
            chalk.red(
              `Invalid --challenge-style: "${style}". Must be adversarial, collaborative, or socratic.`,
            ),
          );
        }
        profile.challengeStyle = style as AgentProfile['challengeStyle'];
      }
      if (opts.focus) {
        profile.focus = (opts.focus as string)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (opts.convergence) {
        const val = parseFloat(opts.convergence as string);
        if (isNaN(val) || val < 0 || val > 1) {
          throw new CLIError(chalk.red(`Invalid --convergence: "${opts.convergence}". Must be 0.0-1.0.`));
        }
        profile.convergenceThreshold = val;
      }
      if (opts.rounds) {
        const val = parseInt(opts.rounds as string);
        if (isNaN(val) || val <= 0) {
          throw new CLIError(chalk.red(`Invalid --rounds: "${opts.rounds}". Must be a positive integer.`));
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
          throw new CLIError(
            chalk.red(`Invalid --evidence: "${mode}". Must be off, advisory, or strict.`),
          );
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
            throw new CLIError(
              chalk.red(`Invalid --weight entry: "${pair}". Expected format: name=number`),
            );
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
          throw new CLIError(
            chalk.red(
              `Invalid --voting-method: "${vm}". Must be borda, ranked-choice, approval, or condorcet.`,
            ),
          );
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
        const target = config.providers.find((p) => p.name === targetName) ?? providers[0];
        if (!target) {
          throw new CLIError(chalk.red('No provider available.'));
        }
        const adapter = await createProvider(target);
        if (!isJSON) {
          console.log(chalk.dim(`[${target.name}/${target.model}]`));
          console.log('');
        }
        try {
          const sys = profile?.focus?.length
            ? `You are an expert in: ${profile.focus.join(', ')}.`
            : undefined;
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
          throw new CLIError(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        }
        return;
      }

      // ── Filter excluded providers and create adapters once ──
      const excluded = new Set(profile.excludeFromDeliberation?.map((s) => s.toLowerCase()) ?? []);
      let candidateProviders = providers.filter(
        (p) => !excluded.has(p.name.toLowerCase()) && !excluded.has(p.provider.toLowerCase()),
      );
      // If exclusion leaves fewer than 2 providers, fall back to all providers
      if (candidateProviders.length < 2 && providers.length >= 2) {
        candidateProviders = providers;
      }

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

        // Warn about slow local providers
        const ollamaProviders = candidateProviders.filter(
          (p) => p.provider.toLowerCase() === 'ollama',
        );
        if (ollamaProviders.length > 0) {
          const names = ollamaProviders.map((p) => p.name).join(', ');
          console.log(
            chalk.yellow(`\n⚠ ${names}: local models can be slow in multi-round deliberations`),
          );
        }
      }

      if (candidateProviders.length < 2) {
        if (candidateProviders.length === 1) {
          // Auto-enable single provider mode instead of blocking
          if (!isJSON) {
            console.log(chalk.yellow(`\n⚡ Single provider detected — running in direct mode.\n`));
          }
          opts.single = candidateProviders[0].name;
        } else {
          const excludedNames = providers
            .filter(
              (p) => excluded.has(p.name.toLowerCase()) || excluded.has(p.provider.toLowerCase()),
            )
            .map((p) => p.name);
          if (excludedNames.length > 0) {
            throw new CLIError(
              chalk.red(
                `\nNeed at least 1 provider (${excludedNames.join(', ')} excluded by profile).`,
              ) + '\n' + chalk.dim(`To include: quorum ask --providers ${excludedNames.join(',')}`),
            );
          } else {
            throw new CLIError(chalk.red(`\nNo providers configured. Run: quorum providers add`));
          }
        }
      }

      // Create adapters once — pass into CouncilV2
      const adapters = await Promise.all(candidateProviders.map((p) => createProvider(p)));

      if (!isJSON) {
        console.log('');
        console.log(
          chalk.dim(`${adapters.length} providers ready | Style: ${profile.challengeStyle}`),
        );
        console.log('');
      }

      // Load schema if specified
      let activeSchema: import('../schema.js').ReasoningSchema | undefined;
      if (opts.schema) {
        const { loadSchema, listSchemas } = await import('../schema.js');
        activeSchema = (await loadSchema(opts.schema as string)) ?? undefined;
        if (!activeSchema) {
          const available = await listSchemas();
          throw new CLIError(chalk.red(`Schema not found: ${opts.schema}`) + '\n' +
            chalk.dim(`Available: ${available.map((s) => s.name).join(', ') || '(none)'}`),
          );
        }
        if (!isJSON) {
          console.log(chalk.dim(`Schema: ${activeSchema.name}`));
        }
      }

      // Track phase timing for compact progress
      const phaseStartTimes: Record<string, number> = {};
      const providersDone: Record<string, string[]> = {};
      const isLive = opts.live ?? false;

      // Live streaming state
      const liveProviderStarted = new Set<string>(); // providers whose header has been printed
      const liveProviderStarts: Record<string, number> = {}; // start times per provider

      const council = new CouncilV2(adapters, candidateProviders, profile, {
        streaming: true,
        rapid: opts.rapid ?? false,
        devilsAdvocate: opts.devilsAdvocate ?? profile.devilsAdvocate ?? false,
        weights: profile.weights,
        noHooks: opts.hooks === false,
        noMemory: opts.memory === false,
        reputation: opts.reputation ?? false,
        policyName: (opts.policy as string) || undefined,
        schema: activeSchema,
        hitl: opts.hitl
          ? {
              enabled: true,
              checkpoints: opts.hitlCheckpoints
                ? ((opts.hitlCheckpoints as string).split(',').map((s: string) => s.trim()) as any[])
                : ['after-vote', 'on-controversy'],
              controversyThreshold: opts.hitlThreshold
                ? parseFloat(opts.hitlThreshold as string)
                : 0.5,
            }
          : undefined,
        adaptive: (opts.adaptive as AdaptivePreset) || undefined,
        redTeam: opts.redTeam || undefined,
        attackPacks: opts.attackPack
          ? (opts.attackPack as string).split(',').map((s: string) => s.trim())
          : undefined,
        customAttacks: opts.customAttacks
          ? (opts.customAttacks as string).split(',').map((s: string) => s.trim())
          : undefined,
        topology: (opts.topology as any) || undefined,
        topologyConfig: {
          ...(opts.topologyHub ? { hub: opts.topologyHub as string } : {}),
          ...(opts.topologyModerator ? { moderator: opts.topologyModerator as string } : {}),
        },
        onStreamDelta: isLive
          ? (provider: string, _phase: string, delta: string) => {
              if (isJSON) return;
              if (!liveProviderStarted.has(provider)) {
                liveProviderStarted.add(provider);
                liveProviderStarts[provider] = Date.now();
                const model = adapters.find((a) => a.name === provider)?.config?.model ?? '';
                console.log(chalk.dim(`    ┌ ${provider}${model ? ` (${model})` : ''}`));
                process.stdout.write(chalk.dim('    │ '));
              }
              process.stdout.write(delta);
            }
          : undefined,
        onEvent(event, data) {
          if (isJSON) return;
          const d = data as Record<string, unknown>;
          switch (event) {
            case 'phase': {
              const phase = d.phase as string;
              phaseStartTimes[phase] = Date.now();
              providersDone[phase] = [];
              if (isLive) {
                console.log(chalk.bold(`  ▸ ${phase}`));
                liveProviderStarted.clear();
              } else {
                process.stdout.write(chalk.bold(`  ▸ ${phase} `));
              }
              break;
            }
            case 'response': {
              const provider = d.provider as string;
              if (isLive) {
                if (liveProviderStarted.has(provider)) {
                  // End the streaming line
                  const elapsed = liveProviderStarts[provider]
                    ? ((Date.now() - liveProviderStarts[provider]) / 1000).toFixed(1)
                    : '?';
                  const fallback = d.fallback ? chalk.yellow('⚠') : chalk.green('✓');
                  console.log('');
                  console.log(chalk.dim(`    └ ${fallback} (${elapsed}s)`));
                  console.log('');
                }
              } else {
                const fallback = d.fallback ? chalk.yellow('⚠') : chalk.green('✓');
                process.stdout.write(`${fallback}${chalk.dim(provider)} `);
              }
              break;
            }
            case 'phase:done': {
              const secs = ((d.duration as number) / 1000).toFixed(1);
              if (!isLive) {
                console.log(chalk.dim(`(${secs}s)`));
              }
              break;
            }
            case 'tool': {
              const toolInput = String(d.input).slice(0, 60);
              console.log(chalk.dim(`  🔧 ${d.provider} → ${d.tool}(${toolInput})`));
              break;
            }
            case 'evidence': {
              const report = d.report as {
                provider: string;
                supportedClaims: number;
                unsupportedClaims: number;
                totalClaims: number;
                evidenceScore: number;
              };
              console.log(
                chalk.dim(
                  `  📋 ${report.provider}: ${report.supportedClaims}/${report.totalClaims} claims supported (${Math.round(report.evidenceScore * 100)}%)`,
                ),
              );
              break;
            }
            case 'adaptive': {
              const { decision } = d as {
                phase: string;
                decision: { action: string; reason: string; entropy: number };
              };
              const entropyPct = Math.round(decision.entropy * 100);
              if (decision.action === 'continue') {
                // Don't clutter output for continue decisions
              } else {
                console.log(
                  chalk.yellow(`  ⚡ ADAPTIVE: ${decision.reason} (entropy: ${entropyPct}%)`),
                );
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
              const { topology, description, phases } = d as {
                topology: string;
                description: string;
                phases: number;
              };
              console.log(
                chalk.cyan(`\n🔷 Topology: ${topology} — ${description} (${phases} phases)`),
              );
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
              const v = d as unknown as {
                rankings: Array<{ provider: string; score: number }>;
                winner: string;
                controversial: boolean;
              };
              console.log('');
              console.log(chalk.bold('  🗳️  Results'));
              const maxScore = v.rankings[0]?.score || 1;
              for (const r of v.rankings) {
                const bar = '█'.repeat(Math.round((r.score / maxScore) * 12));
                const crown = r.provider === v.winner ? ' 👑' : '';
                console.log(
                  `     ${chalk.dim(r.provider.padEnd(10))} ${chalk.cyan(bar)} ${r.score}${crown}`,
                );
              }
              if (v.controversial)
                console.log(chalk.yellow('     ⚠ Close vote — positions nearly tied'));
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
            case 'hitl:pause':
              // Interactive handler will display the checkpoint
              break;
            case 'hitl:resume':
              console.log(chalk.cyan(`  ▶ HITL resumed (${d.action})`));
              break;
            case 'hitl:override':
              console.log(chalk.yellow(`  🔄 HITL: Winner overridden to ${d.winner}`));
              break;
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
          console.log(
            JSON.stringify(
              {
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
              },
              null,
              2,
            ),
          );
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

          if (
            result.synthesis.minorityReport &&
            result.synthesis.minorityReport !== 'None' &&
            result.synthesis.minorityReport.trim()
          ) {
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
              const reportData = JSON.parse(
                await rf(pathJoin(result.sessionPath, 'evidence-report.json'), 'utf-8'),
              ) as Array<{ provider: string; evidenceScore: number }>;
              if (reportData.length > 0) {
                const summary = reportData
                  .map(
                    (r: { provider: string; evidenceScore: number }) =>
                      `${r.provider} ${Math.round(r.evidenceScore * 100)}%`,
                  )
                  .join(', ');
                console.log(chalk.dim(`Evidence scores: ${summary}`));
              }
            } catch {
              /* no evidence report */
            }
          }
          if (opts.adaptive && opts.adaptive !== 'off') {
            try {
              const { readFile: rf } = await import('node:fs/promises');
              const { join: pjoin } = await import('node:path');
              const adaptiveData = JSON.parse(
                await rf(pathJoin(result.sessionPath, 'adaptive-decisions.json'), 'utf-8'),
              ) as {
                decisions: Array<{ action: string; reason: string; entropy: number }>;
                entropyHistory: Record<string, number>;
              };
              const nonContinue = adaptiveData.decisions.filter((d) => d.action !== 'continue');
              if (nonContinue.length > 0) {
                console.log(chalk.yellow(`\nAdaptive decisions: ${nonContinue.length}`));
                for (const d of nonContinue) {
                  console.log(chalk.dim(`  ⚡ ${d.action}: ${d.reason}`));
                }
              }
            } catch {
              /* no adaptive data */
            }
          }
          console.log(chalk.dim(`Session: ${result.sessionPath}`));
          console.log('');
        }

        if (opts.audit) {
          await writeFile(opts.audit as string, JSON.stringify(result, null, 2), 'utf-8');
          if (!isJSON) console.log(chalk.dim(`Audit saved to ${opts.audit}`));
        }
      } catch (err) {
        throw new CLIError(chalk.red(`\nError: ${err instanceof Error ? err.message : err}`));
      }
    });
}
