import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig, loadAgentProfile } from '../config.js';
import { createProvider } from '../providers/base.js';
import { listTopologies } from '../topology.js';
import { loadPolicies, validatePolicy } from '../policy.js';
import { listAttackPacks, loadAttackPack } from '../redteam.js';
import { CLIError } from './helpers.js';

export function registerGovernanceCommands(program: Command): void {
  // --- quorum attacks ---
  program
    .command('attacks')
    .description('List available red team attack packs')
    .action(async () => {
      const packs = await listAttackPacks();
      console.log(chalk.bold('\nAvailable attack packs:\n'));
      for (const name of packs) {
        const pack = await loadAttackPack(name);
        console.log(
          `  ${chalk.red('🔴')} ${chalk.bold(name)} — ${pack.description} (${pack.vectors.length} vectors)`,
        );
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
        const { loadMemoryGraph } = await import('../memory-graph.js');
        const graph = await loadMemoryGraph();
        if (graph.nodes.length === 0) {
          console.log(chalk.dim('No memories stored.'));
          return;
        }
        console.log('');
        console.log(chalk.bold('📚 Stored Memories'));
        console.log('');
        console.log(
          `${chalk.dim('Date')}       | ${chalk.dim('Consensus')} | ${chalk.dim('Winner')}   | ${chalk.dim('Question')}`,
        );
        for (const node of graph.nodes) {
          const date = new Date(node.timestamp).toISOString().slice(0, 10);
          const consensus = node.consensusScore?.toFixed(2) ?? '—';
          const winner = node.winner?.slice(0, 8).padEnd(8) ?? '—';
          const question = node.input.slice(0, 50) + (node.input.length > 50 ? '...' : '');
          console.log(`${date} | ${consensus.padEnd(9)} | ${winner} | ${question}`);
        }
        console.log('');
      } catch (err) {
        console.error(
          chalk.red(`Error loading memories: ${err instanceof Error ? err.message : err}`),
        );
      }
    });

  memoryCmd
    .command('search')
    .description('Search memories by keyword')
    .argument('<query>', 'Search query')
    .action(async (query: string) => {
      try {
        const { findRelevantMemories } = await import('../memory-graph.js');
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
          console.log(
            `  ${chalk.dim(date)} ${chalk.bold(m.input.slice(0, 60))}${m.input.length > 60 ? '...' : ''}`,
          );
          console.log(
            `     Consensus: ${m.consensusScore?.toFixed(2) ?? '—'} | Winner: ${m.winner ?? '—'}`,
          );
          console.log('');
        }
      } catch (err) {
        console.error(
          chalk.red(`Error searching memories: ${err instanceof Error ? err.message : err}`),
        );
      }
    });

  memoryCmd
    .command('clear')
    .description('Clear the memory graph')
    .option('--force', 'Skip confirmation')
    .action(async (opts) => {
      if (!opts.force) {
        const { confirm } = await import('@inquirer/prompts');
        const confirmed = await confirm({
          message: 'Are you sure you want to clear all memories?',
          default: false,
        });
        if (!confirmed) {
          console.log(chalk.dim('Cancelled.'));
          return;
        }
      }
      try {
        const { clearMemoryGraph } = await import('../memory-graph.js');
        await clearMemoryGraph();
        console.log(chalk.green('✅ Memory graph cleared.'));
      } catch (err) {
        console.error(
          chalk.red(`Error clearing memories: ${err instanceof Error ? err.message : err}`),
        );
      }
    });

  memoryCmd
    .command('stats')
    .description('Show memory graph statistics')
    .action(async () => {
      try {
        const { loadMemoryGraph } = await import('../memory-graph.js');
        const graph = await loadMemoryGraph();
        if (graph.nodes.length === 0) {
          console.log(chalk.dim('No memories stored.'));
          return;
        }
        const timestamps = graph.nodes.map((n) => n.timestamp).sort((a, b) => a - b);
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

  // --- quorum policy ---
  const policyCmd = program.command('policy').description('Manage policy-as-code guardrails');

  policyCmd
    .command('list')
    .description('List all loaded policies')
    .action(async () => {
      try {
        const policies = await loadPolicies();
        if (policies.length === 0) {
          console.log(chalk.yellow('No policies found.'));
          console.log(chalk.dim('Place YAML files in ~/.quorum/policies/ or agents/policies/'));
          return;
        }
        for (const p of policies) {
          console.log(
            `${chalk.bold(p.name)} ${chalk.dim(`v${p.version}`)} — ${p.rules.length} rule${p.rules.length === 1 ? '' : 's'}`,
          );
          for (const r of p.rules) {
            const actionColor =
              r.action === 'block'
                ? chalk.red
                : r.action === 'warn'
                  ? chalk.yellow
                  : r.action === 'pause'
                    ? chalk.magenta
                    : chalk.dim;
            console.log(
              `  ${actionColor(r.action.padEnd(5))} ${r.type}${r.value !== undefined ? ` (${r.value})` : ''}${r.message ? ` — ${r.message}` : ''}`,
            );
          }
        }
      } catch (err) {
        throw new CLIError(
          chalk.red(`Error loading policies: ${err instanceof Error ? err.message : err}`),
        );
      }
    });

  policyCmd
    .command('check <file>')
    .description('Validate a policy YAML file')
    .action(async (file: string) => {
      try {
        const { parse: parseYaml } = await import('yaml');
        const raw = await readFile(file, 'utf-8');
        const parsed = parseYaml(raw);
        const errors = validatePolicy(parsed);
        if (errors.length === 0) {
          console.log(chalk.green(`✓ ${file} is valid`));
          console.log(
            chalk.dim(
              `  Policy: ${parsed.name} v${parsed.version} — ${parsed.rules?.length ?? 0} rules`,
            ),
          );
        } else {
          throw new CLIError([chalk.red(`✗ ${file} has errors:`), ...errors.map(e => chalk.red(`  - ${e}`))].join('\n'));
        }
      } catch (err) {
        if (err instanceof CLIError) throw err;
        throw new CLIError(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
    });

  policyCmd
    .command('init')
    .description('Create a default policy configuration file')
    .option('--path <path>', 'Custom path for the policy file')
    .action(async (opts) => {
      const { initPolicyFile } = await import('../policy-controls.js');
      try {
        const filePath = await initPolicyFile(opts.path as string | undefined);
        console.log(chalk.green(`✅ Created policy file: ${filePath}`));
        console.log(chalk.dim('Edit the file to customize risk tier thresholds and actions.'));
      } catch (err) {
        throw new CLIError(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
    });

  policyCmd
    .command('show')
    .description('Display the current policy configuration')
    .option('--path <path>', 'Path to policy file')
    .action(async (opts) => {
      const { loadPolicyFile, formatPolicyConfig } = await import('../policy-controls.js');
      try {
        const config = await loadPolicyFile(opts.path as string | undefined);
        console.log('');
        console.log(formatPolicyConfig(config));
      } catch (err) {
        throw new CLIError(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
    });

  policyCmd
    .command('validate')
    .description('Validate a policy configuration file')
    .option('--path <path>', 'Path to policy file')
    .action(async (opts) => {
      const { validatePolicyConfig } = await import('../policy-controls.js');
      try {
        const filePath = (opts.path as string) || undefined;
        const { readFile: rf } = await import('node:fs/promises');
        const { parse: parseYaml } = await import('yaml');
        const { defaultPolicyPath } = await import('../policy-controls.js');
        const path = filePath ?? defaultPolicyPath();
        const raw = await rf(path, 'utf-8');
        const parsed = parseYaml(raw);
        const errors = validatePolicyConfig(parsed);
        if (errors.length === 0) {
          console.log(chalk.green(`✓ ${path} is valid`));
        } else {
          throw new CLIError([chalk.red(`✗ ${path} has errors:`), ...errors.map(e => chalk.red(`  - ${e}`))].join('\n'));
        }
      } catch (err) {
        if (err instanceof CLIError) throw err;
        throw new CLIError(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
    });

  policyCmd
    .command('calibration')
    .description('Show calibration accuracy statistics')
    .action(async () => {
      const { loadCalibrationStore, computeCalibrationStats, formatCalibrationStats } =
        await import('../calibration.js');
      try {
        const store = await loadCalibrationStore();
        if (store.entries.length === 0) {
          console.log(chalk.yellow('No calibration data yet.'));
          console.log(chalk.dim('Run deliberations with --policy to start tracking.'));
          return;
        }
        const stats = computeCalibrationStats(store);
        console.log('');
        console.log(formatCalibrationStats(stats));
        console.log('');
      } catch (err) {
        throw new CLIError(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
    });

  // --- quorum ledger ---
  const ledgerCmd = program
    .command('ledger')
    .description('Manage the deliberation ledger (hash-chain audit trail)');

  ledgerCmd
    .command('list')
    .description('List recent ledger entries')
    .option('--limit <n>', 'Number of entries to show', '20')
    .action(async (opts) => {
      const { loadLedger } = await import('../ledger.js');
      const ledger = await loadLedger();
      const limit = parseInt(opts.limit as string, 10) || 20;
      const entries = ledger.entries.slice(-limit);
      if (entries.length === 0) {
        console.log(chalk.dim('No ledger entries yet.'));
        return;
      }
      console.log(
        chalk.bold(`\n📒 Ledger (${entries.length} of ${ledger.entries.length} entries)\n`),
      );
      for (const e of entries) {
        const date = new Date(e.timestamp).toLocaleString();
        const preview = e.input.length > 60 ? e.input.slice(0, 57) + '...' : e.input;
        console.log(`  ${chalk.dim(date)} ${chalk.bold(e.id.slice(0, 8))} ${preview}`);
        console.log(
          `    Winner: ${chalk.green(e.votes.winner)} | Consensus: ${e.synthesis.consensusScore.toFixed(2)} | ${chalk.dim(e.topology)}`,
        );
      }
      console.log('');
    });

  ledgerCmd
    .command('verify')
    .description('Verify ledger hash-chain integrity')
    .action(async () => {
      const { verifyLedgerIntegrity } = await import('../ledger.js');
      const result = await verifyLedgerIntegrity();
      if (result.valid) {
        console.log(chalk.green(`✓ ${result.message}`));
      } else {
        const parts = [chalk.red(`✗ ${result.message}`)];
        if (result.brokenAt !== undefined) {
          parts.push(chalk.red(`  Broken at entry index: ${result.brokenAt}`));
        }
        throw new CLIError(parts.join('\n'));
      }
    });

  ledgerCmd
    .command('show')
    .description('Show full details of a ledger entry')
    .argument('<session-id>', 'Session ID or "last"')
    .action(async (sessionId: string) => {
      const { getLedgerEntry } = await import('../ledger.js');
      const entry = await getLedgerEntry(sessionId);
      if (!entry) {
        throw new CLIError(chalk.red(`Entry not found: ${sessionId}`));
      }
      console.log(JSON.stringify(entry, null, 2));
    });

  ledgerCmd
    .command('export')
    .description('Export a ledger entry')
    .argument('<session-id>', 'Session ID or "last"')
    .option('--format <fmt>', 'Export format: adr or json', 'adr')
    .action(async (sessionId: string, opts) => {
      const { getLedgerEntry, exportLedgerADR } = await import('../ledger.js');
      const entry = await getLedgerEntry(sessionId);
      if (!entry) {
        throw new CLIError(chalk.red(`Entry not found: ${sessionId}`));
      }
      if (opts.format === 'json') {
        console.log(JSON.stringify(entry, null, 2));
      } else {
        console.log(exportLedgerADR(entry));
      }
    });

  // --- quorum ledger replay (deterministic) ---
  ledgerCmd
    .command('replay')
    .description('Re-run a prior deliberation with original config (deterministic replay)')
    .argument('<session-id>', 'Session ID or "last"')
    .option('--dry-run', 'Show what would be replayed without executing')
    .option('--diff', 'Show diff between original and new synthesis')
    .option('--providers <list>', 'Override providers (comma-separated)')
    .action(async (sessionId: string, opts) => {
      const { getLedgerEntry } = await import('../ledger.js');
      const entry = await getLedgerEntry(sessionId);
      if (!entry) {
        throw new CLIError(chalk.red(`Ledger entry not found: ${sessionId}`));
      }

      console.log(chalk.bold.cyan('\n🔄 Replay'));
      console.log(chalk.dim(`Original session: ${entry.id}`));
      console.log(chalk.dim(`Input: ${entry.input.slice(0, 200)}`));
      console.log(chalk.dim(`Profile: ${entry.profile}`));
      console.log(chalk.dim(`Topology: ${entry.topology}`));
      console.log(
        chalk.dim(`Providers: ${entry.providers.map((p) => `${p.name}(${p.model})`).join(', ')}`),
      );
      console.log('');

      if (opts.dryRun) {
        console.log(chalk.yellow('DRY RUN — would replay with the above config. Exiting.'));
        return;
      }

      // Load config and profile
      const config = await loadConfig();
      const profile = await loadAgentProfile(entry.profile);

      // Determine providers
      let providerNames: string[] | undefined;
      if (opts.providers) {
        providerNames = (opts.providers as string).split(',').map((s: string) => s.trim());
      }

      const candidateProviders = providerNames
        ? config.providers.filter((p) => providerNames!.includes(p.name))
        : config.providers.filter((p) => entry.providers.some((ep) => ep.name === p.name));

      if (candidateProviders.length < 2) {
        throw new CLIError(chalk.red('Need 2+ providers for replay.'));
      }

      if (!profile) {
        throw new CLIError(chalk.red(`Profile not found: ${entry.profile}`));
      }

      const adapters = await Promise.all(candidateProviders.map((p) => createProvider(p)));

      const { CouncilV2 } = await import('../council-v2.js');
      const council = new CouncilV2(adapters, candidateProviders, profile, {
        streaming: true,
        topology: (entry.options.topology as any) || undefined,
        redTeam: entry.options.redTeam || undefined,
        onEvent(event, data) {
          const d = data as Record<string, unknown>;
          if (event === 'phase') process.stdout.write(chalk.bold(`  ▸ ${d.phase} `));
          if (event === 'response')
            process.stdout.write(chalk.green('✓') + chalk.dim(String(d.provider)) + ' ');
          if (event === 'phase:done')
            console.log(chalk.dim(`(${((d.duration as number) / 1000).toFixed(1)}s)`));
          if (event === 'complete')
            console.log(chalk.dim(`\n  ⏱  ${((d.duration as number) / 1000).toFixed(1)}s total`));
        },
      });

      const result = await council.deliberate(entry.input);

      console.log(chalk.bold.green('\n═══ SYNTHESIS ═══\n'));
      console.log(result.synthesis.content);
      console.log(
        `\nWinner: ${chalk.bold(result.votes.winner)} | Consensus: ${result.synthesis.consensusScore.toFixed(2)}`,
      );

      if (opts.diff) {
        console.log(chalk.bold.yellow('\n═══ DIFF ═══\n'));
        console.log(chalk.red('--- Original'));
        console.log(chalk.green('+++ Replay'));
        console.log('');
        const origLines = entry.synthesis.content.split('\n');
        const newLines = result.synthesis.content.split('\n');
        const maxLen = Math.max(origLines.length, newLines.length);
        for (let i = 0; i < maxLen; i++) {
          const orig = origLines[i] ?? '';
          const newL = newLines[i] ?? '';
          if (orig !== newL) {
            if (orig) console.log(chalk.red(`- ${orig}`));
            if (newL) console.log(chalk.green(`+ ${newL}`));
          } else {
            console.log(`  ${orig}`);
          }
        }
      }
    });

  // --- quorum arena ---
  const arenaCmd = program.command('arena').description('Eval arena and provider reputation system');

  arenaCmd
    .command('leaderboard')
    .description('Show provider reputation rankings')
    .action(async () => {
      const { getAllReputations, formatLeaderboard } = await import('../arena.js');
      const reps = await getAllReputations();
      console.log(formatLeaderboard(reps));
    });

  arenaCmd
    .command('show <provider>')
    .description('Show detailed stats for a provider')
    .action(async (provider: string) => {
      const { getReputation, formatProviderCard } = await import('../arena.js');
      const rep = await getReputation(provider);
      if (!rep) {
        console.log(chalk.yellow(`No data for provider: ${provider}`));
        return;
      }
      console.log(formatProviderCard(rep));
    });

  arenaCmd
    .command('run <suite>')
    .description('Run an eval suite (deliberate each case, record results)')
    .option('-p, --providers <names>', 'Comma-separated provider names')
    .option('--profile <name>', 'Agent profile', 'default')
    .action(async (suiteName: string, opts) => {
      const { loadEvalSuite, recordResult: arRecord } = await import('../arena.js');
      const { CouncilV2 } = await import('../council-v2.js');

      let suite;
      try {
        suite = await loadEvalSuite(suiteName);
      } catch (err) {
        throw new CLIError(chalk.red(`${err instanceof Error ? err.message : err}`));
      }

      const config = await loadConfig();
      let providers = config.providers;
      if (opts.providers) {
        const names = (opts.providers as string).split(',').map((s) => s.trim());
        providers = config.providers.filter((p) => names.includes(p.name));
      }
      if (providers.length < 2) {
        throw new CLIError(chalk.red('Need 2+ providers.'));
      }

      const profile = await loadAgentProfile(opts.profile as string);
      if (!profile) {
        throw new CLIError(chalk.red(`Profile not found: ${opts.profile}`));
      }

      const excluded = new Set(profile.excludeFromDeliberation?.map((s) => s.toLowerCase()) ?? []);
      const candidateProviders = providers.filter(
        (p) => !excluded.has(p.name.toLowerCase()) && !excluded.has(p.provider.toLowerCase()),
      );

      console.log(
        chalk.bold.cyan(
          `\n🏟️  Arena: Running "${suite.name}" v${suite.version} (${suite.cases.length} cases)\n`,
        ),
      );

      for (const evalCase of suite.cases) {
        console.log(
          chalk.bold(`  Case ${evalCase.id} [${evalCase.category}/${evalCase.difficulty}]`),
        );
        console.log(chalk.dim(`    ${evalCase.question.slice(0, 80)}...`));

        try {
          const adapters = await Promise.all(candidateProviders.map((p) => createProvider(p)));
          const council = new CouncilV2(adapters, candidateProviders, profile, {
            streaming: false,
            rapid: true,
            noHooks: true,
            noMemory: true,
            onEvent() {},
          });

          const result = await council.deliberate(evalCase.question);

          for (const adapter of adapters) {
            const ranking = result.votes.rankings.find((r) => r.provider === adapter.name);
            await arRecord(
              adapter.name,
              evalCase.id,
              adapter.name === result.votes.winner,
              ranking?.score ?? 0,
              result.synthesis.consensusScore,
              evalCase.category,
            );
          }

          console.log(
            chalk.green(
              `    Winner: ${result.votes.winner} (${(result.duration / 1000).toFixed(1)}s)`,
            ),
          );
        } catch (err) {
          console.log(chalk.red(`    Failed: ${err instanceof Error ? err.message : err}`));
        }
      }

      const { getAllReputations, formatLeaderboard } = await import('../arena.js');
      const reps = await getAllReputations();
      console.log(chalk.bold('\n📊 Updated Leaderboard:'));
      console.log(formatLeaderboard(reps));
    });

  arenaCmd
    .command('reset')
    .description('Clear all arena state')
    .action(async () => {
      const { saveArenaState } = await import('../arena.js');
      await saveArenaState({ version: 1, results: [], reputations: {} });
      console.log(chalk.green('✅ Arena state cleared.'));
    });

  // --- quorum mcp ---
  program
    .command('mcp')
    .description('Start MCP (Model Context Protocol) server for AI agent integration')
    .action(async () => {
      const { startMcpServer } = await import('../mcp.js');
      await startMcpServer();
    });

  // --- quorum attest ---
  const attestCmd = program.command('attest').description('Attestation chain commands');

  attestCmd
    .command('view')
    .description('View the attestation chain for a deliberation session')
    .argument('<session>', 'Session path or "last" for most recent')
    .option('--json', 'Output as JSON')
    .option('--cbor <path>', 'Export as binary attestation file')
    .action(async (sessionArg: string, opts) => {
      const { buildCanonicalRecord } = await import('../canonical.js');
      const {
        buildAttestationChain,
        verifyAttestationChain,
        exportAttestationJSON,
        exportAttestationCBOR,
      } = await import('../attestation.js');

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
            }
          } catch {
            /* fall through */
          }
        }
      }

      const metaPath = pathJoin(sessionPath, 'meta.json');
      if (!existsSync(metaPath)) {
        throw new CLIError(chalk.red(`Session not found: ${sessionPath}`));
      }

      try {
        const record = await buildCanonicalRecord(sessionPath);
        const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
        const phaseData = record.phases.map((p) => ({
          phase: p.name,
          input: meta.input,
          responses: p.responses,
          providers: Object.keys(p.responses),
          timestamp: p.timestamp,
        }));

        const chain = buildAttestationChain(record.sessionId, record.hashChain, phaseData);
        const verification = verifyAttestationChain(chain);

        if (opts.cbor) {
          const buf = exportAttestationCBOR(chain);
          await writeFile(opts.cbor as string, buf);
          console.log(chalk.green(`✅ Attestation exported to ${opts.cbor} (${buf.length} bytes)`));
          return;
        }

        if (opts.json) {
          console.log(exportAttestationJSON(chain));
          return;
        }

        // Pretty print
        console.log(chalk.bold.cyan(`\n🔏 Attestation Chain — ${record.sessionId}`));
        console.log(chalk.dim(`  ${chain.records.length} attestation records\n`));

        for (const rec of chain.records) {
          console.log(`  ${chalk.bold(rec.phase)}`);
          console.log(chalk.dim(`    Hash:     ${rec.hash.slice(0, 32)}...`));
          console.log(chalk.dim(`    Inputs:   ${rec.inputsHash.slice(0, 16)}...`));
          console.log(chalk.dim(`    Outputs:  ${rec.outputsHash.slice(0, 16)}...`));
          console.log(chalk.dim(`    Provider: ${rec.providerId}`));
          console.log(chalk.dim(`    Time:     ${new Date(rec.timestamp).toISOString()}`));
          if (rec.previousAttestationHash) {
            console.log(chalk.dim(`    Prev:     ${rec.previousAttestationHash.slice(0, 16)}...`));
          }
          console.log('');
        }

        if (verification.valid) {
          console.log(chalk.green('  ✅ Attestation chain verified'));
        } else {
          console.log(chalk.red(`  ❌ Attestation chain INVALID: ${verification.details}`));
        }
      } catch (err) {
        if (err instanceof CLIError) throw err;
        throw new CLIError(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
    });

  attestCmd
    .command('diff')
    .description('Compare attestation chains across two sessions')
    .argument('<session1>', 'First session path')
    .argument('<session2>', 'Second session path')
    .option('--json', 'Output as JSON')
    .action(async (session1: string, session2: string, opts) => {
      const { buildCanonicalRecord } = await import('../canonical.js');
      const { buildAttestationChain } = await import('../attestation.js');
      const { diffAttestationChains, formatAttestationDiff } = await import('../attestation-diff.js');

      async function buildChain(sessionPath: string) {
        const metaPath = pathJoin(sessionPath, 'meta.json');
        if (!existsSync(metaPath)) {
          throw new CLIError(chalk.red(`Session not found: ${sessionPath}`));
        }
        const record = await buildCanonicalRecord(sessionPath);
        const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
        const phaseData = record.phases.map((p) => ({
          phase: p.name,
          input: meta.input,
          responses: p.responses,
          providers: Object.keys(p.responses),
          timestamp: p.timestamp,
        }));
        return buildAttestationChain(record.sessionId, record.hashChain, phaseData);
      }

      try {
        const chain1 = await buildChain(session1);
        const chain2 = await buildChain(session2);
        const diff = diffAttestationChains(chain1, chain2);

        if (opts.json) {
          console.log(JSON.stringify(diff, null, 2));
        } else {
          console.log('');
          console.log(chalk.bold.cyan('🔍 Attestation Diff'));
          console.log(formatAttestationDiff(diff));
        }
      } catch (err) {
        if (err instanceof CLIError) throw err;
        throw new CLIError(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
    });

  attestCmd
    .command('export')
    .description('Export attestation as a formatted certificate')
    .argument('<session>', 'Session path or "last" for most recent')
    .option('--format <format>', 'Output format: json, html, pdf', 'json')
    .option('--output <file>', 'Output file path (default: stdout for json/html)')
    .action(async (sessionArg: string, opts) => {
      const { buildCanonicalRecord } = await import('../canonical.js');
      const { buildAttestationChain, exportAttestationJSON } = await import('../attestation.js');
      const { loadExportData, exportAttestationHTML, exportAttestationPDF } =
        await import('../attestation-export.js');

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
            }
          } catch {
            /* fall through */
          }
        }
      }

      const metaPath = pathJoin(sessionPath, 'meta.json');
      if (!existsSync(metaPath)) {
        throw new CLIError(chalk.red(`Session not found: ${sessionPath}`));
      }

      try {
        const record = await buildCanonicalRecord(sessionPath);
        const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
        const phaseData = record.phases.map((p) => ({
          phase: p.name,
          input: meta.input,
          responses: p.responses,
          providers: Object.keys(p.responses),
          timestamp: p.timestamp,
        }));
        const chain = buildAttestationChain(record.sessionId, record.hashChain, phaseData);
        const data = await loadExportData(sessionPath, chain);

        const format = (opts.format as string).toLowerCase();

        if (format === 'json') {
          const json = exportAttestationJSON(chain);
          if (opts.output) {
            await writeFile(opts.output as string, json, 'utf-8');
            console.error(chalk.green(`✅ Exported JSON to ${opts.output}`));
          } else {
            console.log(json);
          }
        } else if (format === 'html') {
          const html = exportAttestationHTML(data);
          if (opts.output) {
            await writeFile(opts.output as string, html, 'utf-8');
            console.error(chalk.green(`✅ Exported HTML to ${opts.output}`));
          } else {
            console.log(html);
          }
        } else if (format === 'pdf') {
          const outputPath = (opts.output as string) ?? 'attestation.pdf';
          const pdfBytes = await exportAttestationPDF(data);
          await writeFile(outputPath, pdfBytes);
          console.log(chalk.green(`✅ Exported PDF to ${outputPath} (${pdfBytes.length} bytes)`));
        } else {
          throw new CLIError(chalk.red(`Invalid format: ${format}. Use json, html, or pdf.`));
        }
      } catch (err) {
        if (err instanceof CLIError) throw err;
        throw new CLIError(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
    });

  // --- quorum schema ---
  const schemaCmd = program.command('schema').description('Manage reasoning schemas');

  schemaCmd
    .command('list')
    .description('List available reasoning schemas')
    .action(async () => {
      const { listSchemas } = await import('../schema.js');
      const schemas = await listSchemas();
      if (schemas.length === 0) {
        console.log(chalk.dim('No schemas found.'));
        return;
      }
      for (const s of schemas) {
        console.log(`  ${chalk.bold(s.name)} — ${s.description}`);
      }
    });

  schemaCmd
    .command('show <name>')
    .description('Show a reasoning schema')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts) => {
      const { loadSchema, formatSchemaDisplay } = await import('../schema.js');
      const schema = await loadSchema(name);
      if (!schema) {
        throw new CLIError(chalk.red(`Schema not found: ${name}`));
      }
      if (opts.json) {
        console.log(JSON.stringify(schema, null, 2));
      } else {
        console.log(formatSchemaDisplay(schema));
      }
    });

  schemaCmd
    .command('create')
    .description('Create a new reasoning schema')
    .requiredOption('--name <name>', 'Schema name')
    .requiredOption('--description <desc>', 'Schema description')
    .option('--steps <steps>', 'Comma-separated decomposition steps')
    .action(async (opts) => {
      const { createSchema, saveSchema } = await import('../schema.js');
      const schema = createSchema({
        name: opts.name as string,
        description: opts.description as string,
        decompositionSteps: opts.steps
          ? (opts.steps as string).split(',').map((s: string) => s.trim())
          : undefined,
      });
      await saveSchema(schema);
      console.log(chalk.green(`✅ Created schema: ${schema.name}`));
    });

  schemaCmd
    .command('init')
    .description('Initialize built-in domain schemas (legal, technical-review, risk-assessment)')
    .action(async () => {
      const { BUILTIN_SCHEMAS } = await import('../builtin-schemas.js');
      const { saveSchema } = await import('../schema.js');
      for (const schema of BUILTIN_SCHEMAS) {
        const now = Date.now();
        await saveSchema({ ...schema, createdAt: now, updatedAt: now });
        console.log(chalk.green(`  ✅ ${schema.name} — ${schema.description}`));
      }
      console.log(chalk.green(`\nInitialized ${BUILTIN_SCHEMAS.length} built-in schemas.`));
    });

  // --- quorum uncertainty trends ---
  const uncertaintyCmd = program.command('uncertainty').description('Uncertainty tracking commands');

  uncertaintyCmd
    .command('trends')
    .description('View uncertainty trends across deliberations')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const { loadLedger, computeTrends, formatTrends } = await import('../uncertainty-trends.js');
      const ledger = await loadLedger();
      const trends = computeTrends(ledger);

      if (opts.json) {
        console.log(JSON.stringify(trends, null, 2));
      } else {
        console.log('');
        console.log(chalk.bold('📊 ' + formatTrends(trends)));
      }
    });
}
