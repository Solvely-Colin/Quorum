import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join as pathJoin, extname } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig, loadAgentProfile } from '../config.js';
import { CouncilV2 } from '../council-v2.js';
import { createProvider } from '../providers/base.js';
import { CLIError, readStdin, resolveLastSession } from './helpers.js';

export function registerSessionCommands(program: Command): void {
  // --- quorum session ---
  program
    .command('session <path>')
    .description('View a saved session (all phases). Use "last" for most recent.')
    .option(
      '--phase <name>',
      'View a specific phase (gather, plan, formulate, debate, adjust, rebuttal, vote, synthesis)',
    )
    .action(async (sessionPath: string, opts) => {
      // Resolve "last" to most recent session
      if (sessionPath === 'last') {
        const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
        const indexPath = pathJoin(sessionsDir, 'index.json');
        if (existsSync(indexPath)) {
          try {
            const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{
              sessionId: string;
            }>;
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

      const phaseName = opts.phase as string | undefined;

      // If specific phase requested
      if (phaseName) {
        if (phaseName === 'synthesis') {
          const synthPath = `${sessionPath}/synthesis.json`;
          if (!existsSync(synthPath)) {
            throw new CLIError(chalk.red(`No synthesis found at ${synthPath}`));
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
          gather: '01-gather',
          plan: '02-plan',
          formulate: '03-formulate',
          debate: '04-debate',
          adjust: '05-adjust',
          rebuttal: '06-rebuttal',
          vote: '07-vote',
        };
        const fileKey = phaseFiles[phaseName.toLowerCase()];
        if (!fileKey) {
          throw new CLIError(chalk.red(`Unknown phase: ${phaseName}`) + '\n' + chalk.dim(`Available: ${Object.keys(phaseFiles).join(', ')}, synthesis`));
        }
        const phasePath = `${sessionPath}/${fileKey}.json`;
        if (!existsSync(phasePath)) {
          throw new CLIError(chalk.red(`Phase file not found: ${phasePath}`));
        }
        const phase = JSON.parse(await readFile(phasePath, 'utf-8'));
        console.log('');
        console.log(
          chalk.bold.cyan(`═══ ${phase.phase} ═══`) +
            chalk.dim(` (${(phase.duration / 1000).toFixed(1)}s)`),
        );
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
        console.log(
          chalk.dim(
            `Profile: ${meta.profile} | Providers: ${meta.providers?.map((p: any) => p.name).join(', ')}`,
          ),
        );
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
        console.log(
          chalk.bold.cyan(`═══ ${name} ═══`) + chalk.dim(` (${(phase.duration / 1000).toFixed(1)}s)`),
        );
        const entries = phase.responses ?? phase.entries ?? {};
        for (const [provider, content] of Object.entries(entries)) {
          const text = String(content);
          console.log(
            `  ${chalk.bold(provider)}: ${text.slice(0, 150)}${text.length > 150 ? '...' : ''}`,
          );
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
            console.log(
              `  ${r.provider}: ${r.score} pts${r.provider === synth.votes.winner ? ' 👑' : ''}`,
            );
          }
        }
      }

      // Show uncertainty metrics if available
      try {
        const { loadUncertaintyMetrics, formatUncertaintyDisplay } = await import('../uncertainty.js');
        const uncertainty = await loadUncertaintyMetrics(sessionPath);
        if (uncertainty) {
          console.log('');
          console.log(chalk.bold('📊 Uncertainty'));
          console.log(formatUncertaintyDisplay(uncertainty));
        }
      } catch {
        /* no uncertainty data */
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
            sessionId: string;
            timestamp: number;
            question: string;
            winner: string;
            duration: number;
          }>;
          if (entries.length > 0) {
            // Sort newest first
            entries.sort((a, b) => b.timestamp - a.timestamp);
            console.log('');
            console.log(
              chalk.bold(
                `📜 Session History (${Math.min(entries.length, limit)} of ${entries.length})`,
              ),
            );
            console.log('');
            for (const e of entries.slice(0, limit)) {
              const date = new Date(e.timestamp).toLocaleString();
              const dur = (e.duration / 1000).toFixed(1);
              console.log(
                `  ${chalk.dim(date)} ${chalk.bold(e.question)}${e.question.length >= 100 ? '...' : ''}`,
              );
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
        } catch {
          continue;
        }
      }

      sessions.sort((a, b) => (b.meta.startedAt ?? 0) - (a.meta.startedAt ?? 0));

      if (sessions.length === 0) {
        console.log(chalk.dim('No sessions found.'));
        return;
      }

      console.log('');
      console.log(
        chalk.bold(`📜 Session History (${Math.min(sessions.length, limit)} of ${sessions.length})`),
      );
      console.log('');

      for (const s of sessions.slice(0, limit)) {
        const date = s.meta.startedAt ? new Date(s.meta.startedAt).toLocaleString() : '?';
        const question = String(s.meta.input ?? '').slice(0, 60);
        const winner = s.synth?.votes?.winner ?? chalk.dim('(incomplete)');
        const providers = s.meta.providers?.map((p: any) => p.name).join(', ') ?? '';
        console.log(
          `  ${chalk.dim(date)} ${chalk.bold(question)}${question.length >= 60 ? '...' : ''}`,
        );
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
    .option('--devils-advocate', "Assign one provider as devil's advocate")
    .action(async (session: string, question: string | undefined, opts) => {
      // Resolve session path
      let sessionPath = session;
      if (session === 'last') {
        const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
        const indexPath = pathJoin(sessionsDir, 'index.json');
        if (existsSync(indexPath)) {
          try {
            const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{
              sessionId: string;
            }>;
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
        throw new CLIError(chalk.red(`No synthesis found at ${synthPath}`));
      }
      const synth = JSON.parse(await readFile(synthPath, 'utf-8'));
      const priorContext = synth.content as string;

      // Get question
      if (!question) {
        if (process.stdin.isTTY) {
          throw new CLIError(chalk.red('No follow-up question provided.') + '\n' + chalk.dim('Usage: quorum follow-up <session> "your question"'));
        }
        question = await readStdin();
        if (!question.trim()) {
          throw new CLIError(chalk.red('Empty input.'));
        }
      }

      // Now run deliberation with priorContext — reuse ask logic
      const config = await loadConfig();
      if (config.providers.length === 0) {
        throw new CLIError(chalk.red('No providers configured. Run: quorum init'));
      }

      const timeoutOverride = opts.timeout ? parseInt(opts.timeout as string) : undefined;
      if (timeoutOverride !== undefined) {
        if (isNaN(timeoutOverride) || timeoutOverride <= 0) {
          throw new CLIError(chalk.red(`Invalid --timeout value.`));
        }
        for (const p of config.providers) p.timeout = timeoutOverride;
      }

      let providers = config.providers;
      if (opts.providers) {
        const names = (opts.providers as string).split(',').map((s) => s.trim());
        providers = config.providers.filter((p) => names.includes(p.name));
        if (providers.length === 0) {
          throw new CLIError(chalk.red(`No matching providers: ${opts.providers}`));
        }
      }

      const isJSON = opts.json;
      const profile = await loadAgentProfile(opts.profile as string);
      if (!profile) {
        throw new CLIError(chalk.red(`Profile not found: ${opts.profile}`));
      }

      const excluded = new Set(profile.excludeFromDeliberation?.map((s) => s.toLowerCase()) ?? []);
      const candidateProviders = providers.filter(
        (p) => !excluded.has(p.name.toLowerCase()) && !excluded.has(p.provider.toLowerCase()),
      );

      if (candidateProviders.length < 2) {
        throw new CLIError(chalk.red(`Need 2+ providers for deliberation.`));
      }

      const adapters = await Promise.all(candidateProviders.map((p) => createProvider(p)));

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
          console.log(
            JSON.stringify(
              {
                synthesis: result.synthesis.content,
                synthesizer: result.synthesis.synthesizer,
                consensus: result.synthesis.consensusScore,
                confidence: result.synthesis.confidenceScore,
                duration: result.duration,
                sessionPath: result.sessionPath,
                followUpFrom: sessionPath,
              },
              null,
              2,
            ),
          );
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
        throw new CLIError(chalk.red(`\nError: ${err instanceof Error ? err.message : err}`));
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
          throw new CLIError(chalk.red('No question provided.') + '\n' + chalk.dim('Usage: quorum versus <provider1> <provider2> "question"'));
        }
        question = await readStdin();
        if (!question.trim()) {
          throw new CLIError(chalk.red('Empty input.'));
        }
      }

      const config = await loadConfig();
      if (config.providers.length === 0) {
        throw new CLIError(chalk.red('No providers configured. Run: quorum init'));
      }

      const timeoutOverride = opts.timeout ? parseInt(opts.timeout as string) : undefined;
      if (timeoutOverride !== undefined) {
        for (const p of config.providers) p.timeout = timeoutOverride;
      }

      const cfg1 = config.providers.find((p) => p.name === provider1);
      const cfg2 = config.providers.find((p) => p.name === provider2);
      if (!cfg1) {
        throw new CLIError(chalk.red(`Provider not found: ${provider1}`) + '\n' + chalk.dim(`Available: ${config.providers.map((p) => p.name).join(', ')}`));
      }
      if (!cfg2) {
        throw new CLIError(chalk.red(`Provider not found: ${provider2}`) + '\n' + chalk.dim(`Available: ${config.providers.map((p) => p.name).join(', ')}`));
      }

      const adapter1 = await createProvider(cfg1);
      const adapter2 = await createProvider(cfg2);

      // Find a judge: third provider if available, otherwise adapter1
      const cfgJudge = config.providers.find((p) => p.name !== provider1 && p.name !== provider2);
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
          isJSON
            ? undefined
            : (event, data) => {
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
          console.log(
            JSON.stringify(
              {
                provider1,
                provider2,
                judge: judgeAdapter?.name ?? provider1,
                comparison,
              },
              null,
              2,
            ),
          );
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
        throw new CLIError(chalk.red(`\nError: ${err instanceof Error ? err.message : err}`));
      }
    });

  // --- quorum export ---
  program
    .command('export')
    .description('Export a deliberation session as a formatted document')
    .argument('<session>', 'Session path or "last" for most recent')
    .option('--format <format>', 'Output format: md, html, or canonical', 'md')
    .option('--output <file>', 'Output file path (default: stdout)')
    .action(async (sessionArg: string, opts) => {
      const { exportMarkdown, exportHtml } = await import('../export.js');

      // Resolve session path
      let sessionPath = sessionArg;
      if (sessionPath === 'last') {
        const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
        const indexPath = pathJoin(sessionsDir, 'index.json');
        if (existsSync(indexPath)) {
          try {
            const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{
              sessionId: string;
            }>;
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
        throw new CLIError(chalk.red(`Session not found: ${sessionPath}`));
      }

      const format = (opts.format as string).toLowerCase();
      if (!['md', 'html', 'canonical'].includes(format)) {
        throw new CLIError(chalk.red(`Invalid format: ${format}. Use "md", "html", or "canonical".`));
      }

      let result: string;
      if (format === 'canonical') {
        const { buildCanonicalRecord } = await import('../canonical.js');
        const record = await buildCanonicalRecord(sessionPath);
        result = JSON.stringify(record, null, 2);
      } else {
        result = format === 'html' ? exportHtml(sessionPath) : exportMarkdown(sessionPath);
      }

      if (opts.output) {
        await writeFile(opts.output as string, result, 'utf-8');
        console.error(chalk.green(`✅ Exported to ${opts.output}`));
      } else {
        process.stdout.write(result);
      }
    });

  // --- quorum verify ---
  program
    .command('verify')
    .description('Verify the integrity of a deliberation session hash chain')
    .argument('<session>', 'Session path or "last" for most recent')
    .action(async (sessionArg: string) => {
      const { buildCanonicalRecord } = await import('../canonical.js');

      // Resolve session path
      let sessionPath = sessionArg;
      if (sessionPath === 'last') {
        const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
        const indexPath = pathJoin(sessionsDir, 'index.json');
        if (existsSync(indexPath)) {
          try {
            const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{
              sessionId: string;
            }>;
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
        throw new CLIError(chalk.red(`Session not found: ${sessionPath}`));
      }

      try {
        const record = await buildCanonicalRecord(sessionPath);
        if (record.integrity.valid) {
          console.log(
            chalk.green(
              `✅ Integrity verified — ${record.hashChain.length} phases, hash chain intact`,
            ),
          );
          for (const entry of record.hashChain) {
            console.log(chalk.dim(`  ${entry.phase}: ${entry.hash.slice(0, 16)}...`));
          }
        } else {
          const parts = [chalk.red(`❌ Integrity check FAILED`)];
          if (record.integrity.brokenAt) {
            parts.push(chalk.red(`   Broken at phase: ${record.integrity.brokenAt}`));
          }
          if (record.integrity.details) {
            parts.push(chalk.red(`   ${record.integrity.details}`));
          }
          throw new CLIError(parts.join('\n'));
        }
      } catch (err) {
        if (err instanceof CLIError) throw err;
        throw new CLIError(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
    });

  // --- quorum heatmap ---
  program
    .command('heatmap')
    .description("Display consensus heatmap from a session's vote data")
    .argument('<session>', 'Session path or "last" for most recent')
    .action(async (sessionArg: string) => {
      const { generateHeatmap } = await import('../heatmap.js');

      // Resolve session path
      let sessionPath = sessionArg;
      if (sessionPath === 'last') {
        const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
        const indexPath = pathJoin(sessionsDir, 'index.json');
        if (existsSync(indexPath)) {
          try {
            const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{
              sessionId: string;
            }>;
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
        throw new CLIError(chalk.red(`Session not found: ${sessionPath}`));
      }
      const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
      const providerNames: string[] = (meta.providers ?? []).map((p: any) => p.name);

      // Read vote phase
      const votePath = pathJoin(sessionPath, '07-vote.json');
      if (!existsSync(votePath)) {
        throw new CLIError(chalk.red(`No vote data found at ${votePath}`) + '\n' + chalk.dim('The session may have skipped the vote phase.'));
      }
      const votePhase = JSON.parse(await readFile(votePath, 'utf-8'));
      const voteResponses: Record<string, string> = votePhase.responses ?? votePhase.entries ?? {};

      if (Object.keys(voteResponses).length < 2) {
        throw new CLIError(chalk.red('Need at least 2 voters for a heatmap.'));
      }

      // Re-parse ballots from raw vote text (same logic as council-v2 extractBallots)
      const n = providerNames.length;
      const labels = providerNames.map((_, idx) => String.fromCharCode(65 + idx));
      const letterToProvider: Record<string, string> = {};
      for (let idx = 0; idx < n; idx++) {
        letterToProvider[labels[idx]] = providerNames[idx];
      }

      const ballots: Array<{ voter: string; rankings: Array<{ provider: string; rank: number }> }> =
        [];

      for (const [voter, voteText] of Object.entries(voteResponses)) {
        const rankings: Array<{ provider: string; rank: number }> = [];
        const assigned = new Set<string>();

        // Try JSON parsing
        const jsonMatch =
          voteText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
          voteText.match(/(\{[\s\S]*"rankings"[\s\S]*\})/);
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
          } catch {
            /* fall through */
          }
        }

        // Fallback: numbered lines
        if (assigned.size === 0) {
          const lines = voteText.split('\n');
          let rank = 1;
          for (const line of lines) {
            const rankMatch = line.match(/^\s*(?:#?\s*)?(\d+)[\.\)\-:\s]\s*/);
            if (!rankMatch) continue;
            const lineRank = parseInt(rankMatch[1]);
            const effectiveRank = lineRank >= 1 && lineRank <= n ? lineRank : rank;
            if (effectiveRank > n) continue;

            const rest = line.slice(rankMatch[0].length);
            let targetName: string | undefined;
            for (let li = 0; li < labels.length; li++) {
              const pat = new RegExp(
                `(?:Position\\s+)?(?:\\*\\*|"|')?${labels[li]}(?:\\*\\*|"|')?(?:\\s|\\.|—|-|:|,|\\))`,
                'i',
              );
              if (pat.test(rest)) {
                targetName = providerNames[li];
                break;
              }
            }
            if (!targetName) {
              for (const pn of providerNames) {
                if (rest.toLowerCase().includes(pn.toLowerCase())) {
                  targetName = pn;
                  break;
                }
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
        throw new CLIError(chalk.red('Could not parse enough ballots for a heatmap.'));
      }

      const heatmap = generateHeatmap(ballots, providerNames);
      if (heatmap) {
        console.log(heatmap);
      } else {
        console.log(chalk.dim('Not enough data to generate heatmap.'));
      }
    });

  // --- quorum replay ---
  program
    .command('replay')
    .description('Play back a deliberation session phase-by-phase with simulated typing')
    .argument('<session>', 'Session path or "last" for most recent')
    .option('--phase <name>', 'Filter to a single phase (e.g., debate, gather)')
    .option('--provider <name>', "Filter to a single provider's responses")
    .option('--speed <speed>', 'Typing speed: fast (5ms), normal (20ms), slow (50ms)', 'normal')
    .action(async (sessionArg: string, opts) => {
      const speedMap: Record<string, number> = { fast: 5, normal: 20, slow: 50 };
      const delay = speedMap[opts.speed as string] ?? 20;

      // Resolve session path
      let sessionPath = sessionArg;
      if (sessionPath === 'last') {
        const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
        const indexPath = pathJoin(sessionsDir, 'index.json');
        if (existsSync(indexPath)) {
          try {
            const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{
              sessionId: string;
            }>;
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

      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
        throw new CLIError(chalk.red(`Session not found: ${sessionPath}`));
      }
      const meta = JSON.parse(await readFile(metaPath, 'utf-8'));

      console.log('');
      console.log(chalk.bold.cyan('🎬 Replay'));
      console.log(chalk.dim(`Question: ${String(meta.input ?? meta.question ?? '').slice(0, 200)}`));
      const providerNames = (meta.providers ?? []).map((p: any) => p.name).join(', ');
      console.log(chalk.dim(`Providers: ${providerNames}`));
      console.log(chalk.dim(`Profile: ${meta.profile ?? 'default'}`));
      if (meta.startedAt)
        console.log(chalk.dim(`Time: ${new Date(meta.startedAt).toLocaleString()}`));
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

      // Load interventions for inline display
      const { loadInterventions } = await import('../intervention.js');
      const interventions = await loadInterventions(sessionPath);
      const interventionsByPhase = new Map<string, typeof interventions>();
      for (const iv of interventions) {
        const key = iv.phase.toUpperCase();
        const existing = interventionsByPhase.get(key) ?? [];
        existing.push(iv);
        interventionsByPhase.set(key, existing);
      }

      for (const { file, name } of phaseFiles) {
        if (phaseFilter && !name.toLowerCase().startsWith(phaseFilter) && !file.includes(phaseFilter))
          continue;

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

        // Show interventions after this phase
        const phaseInterventions = interventionsByPhase.get(name);
        if (phaseInterventions && phaseInterventions.length > 0) {
          console.log('');
          for (const iv of phaseInterventions) {
            const typeIcon =
              iv.type === 'halt'
                ? '⏸'
                : iv.type === 'redirect'
                  ? '🔄'
                  : iv.type === 'inject-evidence'
                    ? '📎'
                    : '❓';
            console.log(chalk.bold.red(`  ${typeIcon} INTERVENTION: ${iv.type}`));
            console.log(chalk.red(`    ${iv.content}`));
            if (iv.constraints) {
              console.log(chalk.dim(`    Constraints: ${iv.constraints.join(', ')}`));
            }
          }
        }
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
          const rankings = synth.votes?.rankings as
            | Array<{ provider: string; score: number }>
            | undefined;
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
    .option('--devils-advocate', "Assign one provider as devil's advocate")
    .action(async (sessionArg: string, opts) => {
      // Resolve session path
      let originalSessionPath = sessionArg;
      if (sessionArg === 'last') {
        const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
        const indexPath = pathJoin(sessionsDir, 'index.json');
        if (existsSync(indexPath)) {
          try {
            const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{
              sessionId: string;
            }>;
            if (entries.length > 0) {
              originalSessionPath = pathJoin(sessionsDir, entries[entries.length - 1].sessionId);
            } else {
              originalSessionPath = await resolveLastSession(sessionsDir);
            }
          } catch {
            originalSessionPath = await resolveLastSession(
              pathJoin(homedir(), '.quorum', 'sessions'),
            );
          }
        } else {
          originalSessionPath = await resolveLastSession(pathJoin(homedir(), '.quorum', 'sessions'));
        }
      }

      // Read original session meta to get the question
      const metaPath = pathJoin(originalSessionPath, 'meta.json');
      if (!existsSync(metaPath)) {
        throw new CLIError(chalk.red(`Session not found: ${originalSessionPath}`));
      }
      const originalMeta = JSON.parse(await readFile(metaPath, 'utf-8'));
      const question = originalMeta.input as string;
      if (!question || !question.trim()) {
        throw new CLIError(chalk.red('Original session has no question (input) in meta.json.'));
      }

      // Load config
      const config = await loadConfig();
      if (config.providers.length === 0) {
        throw new CLIError(chalk.red('No providers configured. Run: quorum init'));
      }

      // Apply timeout override
      const timeoutOverride = opts.timeout ? parseInt(opts.timeout as string) : undefined;
      if (timeoutOverride !== undefined) {
        if (isNaN(timeoutOverride) || timeoutOverride <= 0) {
          throw new CLIError(chalk.red(`Invalid --timeout value.`));
        }
        for (const p of config.providers) p.timeout = timeoutOverride;
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

      // Load profile (use original session's profile as default if not specified)
      const profileName = (opts.profile as string) ?? originalMeta.profile ?? 'default';
      const profile = await loadAgentProfile(profileName);
      if (!profile) {
        throw new CLIError(chalk.red(`Profile not found: ${profileName}`));
      }

      // Filter excluded providers
      const excluded = new Set(profile.excludeFromDeliberation?.map((s) => s.toLowerCase()) ?? []);
      const candidateProviders = providers.filter(
        (p) => !excluded.has(p.name.toLowerCase()) && !excluded.has(p.provider.toLowerCase()),
      );

      if (candidateProviders.length < 2) {
        throw new CLIError(
          chalk.red(`Need 2+ providers for deliberation (${candidateProviders.length} configured).`),
        );
      }

      const adapters = await Promise.all(candidateProviders.map((p) => createProvider(p)));

      if (!isJSON) {
        console.log('');
        console.log(chalk.bold.cyan(`🔄 Re-running previous deliberation`));
        console.log(chalk.dim(`Original session: ${originalSessionPath}`));
        console.log(
          chalk.dim(`Question: ${question.slice(0, 120)}${question.length > 120 ? '...' : ''}`),
        );
        console.log(chalk.dim(`Providers: ${candidateProviders.map((p) => p.name).join(', ')}`));
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

          if (
            result.synthesis.minorityReport &&
            result.synthesis.minorityReport !== 'None' &&
            result.synthesis.minorityReport.trim()
          ) {
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
          console.log(
            chalk.bold(
              `Re-ran '${question.slice(0, 80)}${question.length > 80 ? '...' : ''}' with [${candidateProviders.map((p) => p.name).join(', ')}] — new session: ${result.sessionPath}`,
            ),
          );
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
              session1: {
                path: originalSessionPath,
                question: q1,
                providers: providers1,
                winner: winner1,
                consensus: consensus1,
                confidence: confidence1,
                rankings: rankings1,
              },
              session2: {
                path: newSessionPath,
                question: q2,
                providers: providers2,
                winner: winner2,
                consensus: consensus2,
                confidence: confidence2,
                rankings: rankings2,
              },
              providerDiff: { common, onlyInSession1: onlyIn1, onlyInSession2: onlyIn2 },
              winnerChanged: winner1 !== winner2,
              consensusDelta:
                consensus1 != null && consensus2 != null ? consensus2 - consensus1 : null,
              confidenceDelta:
                confidence1 != null && confidence2 != null ? confidence2 - confidence1 : null,
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
              if (onlyIn1.length)
                console.log(`  ${chalk.red('Only Original:')} ${onlyIn1.join(', ')}`);
              if (onlyIn2.length) console.log(`  ${chalk.red('Only Re-run:')} ${onlyIn2.join(', ')}`);
            }

            // Winner
            console.log('');
            console.log(chalk.bold('Winner:'));
            if (winner1 === winner2) {
              console.log(`  ${chalk.green(winner1)} (unchanged)`);
            } else {
              console.log(
                `  ${chalk.dim('Original:')} ${chalk.yellow(winner1)}  →  ${chalk.dim('Re-run:')} ${chalk.yellow(winner2)}  ${chalk.red('(changed)')}`,
              );
            }

            // Scores
            console.log('');
            console.log(chalk.bold('Scores:'));
            const fmtScore = (v: number | null) => (v != null ? v.toFixed(2) : '—');
            const fmtDelta = (a: number | null, b: number | null) => {
              if (a == null || b == null) return '';
              const d = b - a;
              const sign = d >= 0 ? '+' : '';
              const color = d > 0 ? chalk.green : d < 0 ? chalk.red : chalk.dim;
              return color(` (${sign}${d.toFixed(2)})`);
            };
            console.log(
              `  Consensus:  ${fmtScore(consensus1)} → ${fmtScore(consensus2)}${fmtDelta(consensus1, consensus2)}`,
            );
            console.log(
              `  Confidence: ${fmtScore(confidence1)} → ${fmtScore(confidence2)}${fmtDelta(confidence1, confidence2)}`,
            );

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
        throw new CLIError(chalk.red(`\nError: ${err instanceof Error ? err.message : err}`));
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
        } catch {
          /* skip unreadable dirs */
        }
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
            throw new CLIError(chalk.red(`File not found: ${arg}`));
          }
        }
      }

      if (resolvedFiles.size === 0) {
        throw new CLIError(chalk.red('No files matched the given patterns.'));
      }

      const fileList = [...resolvedFiles];
      const debounceMs = parseInt(opts.debounce as string) || 1000;

      console.log('');
      console.log(
        chalk.bold.cyan(`👁  Watching ${fileList.length} file(s) for changes... (Ctrl+C to stop)`),
      );
      for (const f of fileList.slice(0, 10)) {
        console.log(chalk.dim(`  ${(await import('node:path')).relative(process.cwd(), f)}`));
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
          console.log(chalk.dim(`  Changed: ${(await import('node:path')).relative(process.cwd(), f)}`));
        }
        console.log('');

        try {
          // Build content from changed files
          let content = '';
          for (const filePath of filesToReview) {
            try {
              const fileContent = await rf(filePath, 'utf-8');
              const ext = extname(filePath).slice(1) || 'text';
              content += `## File: ${(await import('node:path')).relative(process.cwd(), filePath)}\n\`\`\`${ext}\n${fileContent}\n\`\`\`\n\n`;
            } catch (err) {
              console.error(
                chalk.yellow(
                  `  Warning: Could not read ${filePath}: ${err instanceof Error ? err.message : err}`,
                ),
              );
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
          console.error(
            chalk.red(`Error during deliberation: ${err instanceof Error ? err.message : err}`),
          );
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
          try {
            w.close();
          } catch {
            /* ignore */
          }
        }
        process.exit(0);
      });
    });

  // --- quorum workspace ---
  program
    .command('workspace')
    .description('Launch real-time deliberation workspace UI')
    .argument('[session-id]', 'Session ID to replay (omit for live mode)')
    .option('--live', 'Start in live mode, stream next deliberation')
    .option('--port <port>', 'Server port', '3737')
    .action(async (sessionId: string | undefined, opts) => {
      const { startWorkspaceServer } = await import('../workspace-server.js');
      const port = parseInt(opts.port as string) || 3737;

      const isLive = opts.live || !sessionId;

      const server = await startWorkspaceServer({
        port,
        sessionId: sessionId ?? undefined,
        live: isLive,
      });

      console.log('');
      console.log(chalk.bold.cyan('🏛️  Quorum Workspace'));
      console.log('');
      console.log(`  ${chalk.green('▸')} http://localhost:${server.port}`);
      if (sessionId) {
        console.log(`  ${chalk.dim('Mode: replay')} — session ${sessionId}`);
      } else {
        console.log(`  ${chalk.dim('Mode: live')} — waiting for deliberation...`);
      }
      console.log('');
      console.log(chalk.dim('Press Ctrl+C to stop'));

      // Keep process alive
      await new Promise<void>((resolve) => {
        process.on('SIGINT', async () => {
          console.log(chalk.dim('\nShutting down workspace...'));
          await server.close();
          resolve();
        });
      });
    });
}
