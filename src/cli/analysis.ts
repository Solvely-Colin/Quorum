import type { Command } from 'commander';
import pc from 'picocolors';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig } from '../config.js';
import { createProvider } from '../providers/base.js';
import type { ProviderConfig } from '../types.js';
import { CLIError, resolveLastSession } from './helpers.js';

export function registerAnalysisCommands(program: Command): void {
  // --- quorum explain ---
  program
    .command('explain')
    .description('Meta-analyze a deliberation session')
    .argument('<session>', 'Session path or "last" for most recent')
    .option('--provider <name>', 'Provider to use for analysis (default: first configured)')
    .addHelpText(
      'after',
      `
${pc.dim('Examples:')}
${pc.dim('  $ quorum explain last')}
${pc.dim('  $ quorum explain last --provider claude')}
${pc.dim('  $ quorum explain ~/.quorum/sessions/abc123')}
`,
    )
    .action(async (sessionArg: string, opts) => {
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

      // Read session files
      const metaPath = pathJoin(sessionPath, 'meta.json');
      if (!existsSync(metaPath)) {
        throw new CLIError(pc.red(`Session not found: ${sessionPath}`));
      }

      const meta = JSON.parse(await readFile(metaPath, 'utf-8'));

      // Read all phase files
      const phaseFileNames = [
        '01-gather',
        '02-plan',
        '03-formulate',
        '04-debate',
        '05-adjust',
        '06-rebuttal',
        '07-vote',
      ];
      const phases: Record<string, unknown> = {};
      for (const pf of phaseFileNames) {
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
        throw new CLIError(pc.red('No providers configured. Run: quorum init'));
      }

      let providerConfig: ProviderConfig;
      if (opts.provider) {
        const found = config.providers.find((p) => p.name === (opts.provider as string));
        if (!found) {
          throw new CLIError(
            pc.red(`Provider not found: ${opts.provider}`) +
              '\n' +
              pc.dim(`Available: ${config.providers.map((p) => p.name).join(', ')}`),
          );
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
      console.log(pc.bold(pc.cyan('🔍 Meta-Analysis')));
      console.log(pc.dim(`Session: ${sessionPath}`));
      console.log(pc.dim(`Analyzer: ${providerConfig.name} (${providerConfig.model})`));
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
        throw new CLIError(pc.red(`Error: ${err instanceof Error ? err.message : err}`));
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
    .addHelpText(
      'after',
      `
${pc.dim('Examples:')}
${pc.dim('  $ quorum diff ~/.quorum/sessions/abc123 ~/.quorum/sessions/def456')}
${pc.dim('  $ quorum diff session1 session2 --analyze --provider claude')}
${pc.dim('  $ quorum diff session1 session2 --json')}
`,
    )
    .action(async (session1: string, session2: string, opts) => {
      const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');

      // Resolve session paths
      async function resolveSession(s: string): Promise<string> {
        if (s === 'last') {
          const indexPath = pathJoin(sessionsDir, 'index.json');
          if (existsSync(indexPath)) {
            try {
              const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{
                sessionId: string;
              }>;
              if (entries.length > 0) {
                return pathJoin(sessionsDir, entries[entries.length - 1].sessionId);
              }
            } catch {
              /* fall through */
            }
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
          throw new CLIError(pc.red(`Session not found: ${sp}`));
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
          throw new CLIError(pc.red('No providers configured for --analyze. Run: quorum init'));
        }
        let providerConfig: ProviderConfig;
        if (opts.provider) {
          const found = config.providers.find((p) => p.name === (opts.provider as string));
          if (!found) {
            throw new CLIError(pc.red(`Provider not found: ${opts.provider}`));
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
          console.log(pc.dim(`Analyzing with ${providerConfig.name}...`));
        }
        try {
          analysisNarrative = await adapter.generate(
            prompt,
            'You are an expert analyst comparing two AI deliberation outcomes. Be concise and insightful.',
          );
        } catch (err) {
          if (!opts.json) {
            console.error(
              pc.yellow(`Analysis failed: ${err instanceof Error ? err.message : err}`),
            );
          }
        }
      }

      // JSON output
      if (opts.json) {
        const output: any = {
          session1: {
            path: path1,
            question: q1,
            providers: providers1,
            winner: winner1,
            consensus: consensus1,
            confidence: confidence1,
            rankings: rankings1,
          },
          session2: {
            path: path2,
            question: q2,
            providers: providers2,
            winner: winner2,
            consensus: consensus2,
            confidence: confidence2,
            rankings: rankings2,
          },
          providerDiff: { common, onlyInSession1: onlyIn1, onlyInSession2: onlyIn2 },
          winnerChanged: winner1 !== winner2,
          consensusDelta: consensus1 != null && consensus2 != null ? consensus2 - consensus1 : null,
          confidenceDelta:
            confidence1 != null && confidence2 != null ? confidence2 - confidence1 : null,
        };
        if (analysisNarrative) output.analysis = analysisNarrative;
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Display comparison
      console.log('');
      console.log(pc.bold(pc.cyan('📊 Session Diff')));
      console.log(pc.dim('━'.repeat(60)));

      // Questions
      console.log('');
      console.log(pc.bold('Question:'));
      if (q1 === q2) {
        console.log(`  ${q1}`);
      } else {
        console.log(`  ${pc.dim('S1:')} ${q1}`);
        console.log(`  ${pc.dim('S2:')} ${q2}`);
      }

      // Providers
      console.log('');
      console.log(pc.bold('Providers:'));
      if (onlyIn1.length === 0 && onlyIn2.length === 0) {
        console.log(`  ${pc.green('Same:')} ${providers1.join(', ')}`);
      } else {
        console.log(`  ${pc.dim('Common:')} ${common.join(', ') || '(none)'}`);
        if (onlyIn1.length) console.log(`  ${pc.red('Only S1:')} ${onlyIn1.join(', ')}`);
        if (onlyIn2.length) console.log(`  ${pc.red('Only S2:')} ${onlyIn2.join(', ')}`);
      }

      // Winner
      console.log('');
      console.log(pc.bold('Winner:'));
      if (winner1 === winner2) {
        console.log(`  ${pc.green(winner1)} (unchanged)`);
      } else {
        console.log(
          `  ${pc.dim('S1:')} ${pc.yellow(winner1)}  →  ${pc.dim('S2:')} ${pc.yellow(winner2)}  ${pc.red('(changed)')}`,
        );
      }

      // Scores
      console.log('');
      console.log(pc.bold('Scores:'));
      const fmtScore = (v: number | null) => (v != null ? v.toFixed(2) : '—');
      const fmtDelta = (a: number | null, b: number | null) => {
        if (a == null || b == null) return '';
        const d = b - a;
        const sign = d >= 0 ? '+' : '';
        const color = d > 0 ? pc.green : d < 0 ? pc.red : pc.dim;
        return color(` (${sign}${d.toFixed(2)})`);
      };
      console.log(
        `  Consensus:  ${fmtScore(consensus1)} → ${fmtScore(consensus2)}${fmtDelta(consensus1, consensus2)}`,
      );
      console.log(
        `  Confidence: ${fmtScore(confidence1)} → ${fmtScore(confidence2)}${fmtDelta(confidence1, confidence2)}`,
      );

      // Vote rankings
      console.log('');
      console.log(pc.bold('Vote Rankings:'));
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
        console.log(pc.dim('  No vote data available'));
      }

      // Analysis narrative
      if (analysisNarrative) {
        console.log('');
        console.log(pc.bold(pc.magenta('── Analysis ──')));
        console.log(analysisNarrative);
      }

      console.log('');
      console.log(pc.dim(`S1: ${path1}`));
      console.log(pc.dim(`S2: ${path2}`));
      console.log('');
    });

  // --- quorum stats ---
  program
    .command('stats')
    .description('Show provider statistics across all sessions')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
${pc.dim('Examples:')}
${pc.dim('  $ quorum stats')}
${pc.dim('  $ quorum stats --json')}
`,
    )
    .action(async (opts) => {
      const sessionsDir = pathJoin(homedir(), '.quorum', 'sessions');
      const indexPath = pathJoin(sessionsDir, 'index.json');

      // Load index entries
      let entries: Array<{
        sessionId: string;
        timestamp: number;
        question: string;
        winner: string;
        duration: number;
      }> = [];
      if (existsSync(indexPath)) {
        try {
          entries = JSON.parse(await readFile(indexPath, 'utf-8'));
        } catch {
          /* ignore */
        }
      }

      if (entries.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ sessions: 0, message: 'No sessions found.' }));
        } else {
          console.log('');
          console.log(pc.dim('No deliberation sessions found yet.'));
          console.log(pc.dim('Run: quorum ask "your question" to get started.'));
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
      let mostControversial: { sessionId: string; question: string; consensus: number } | null =
        null;

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
              mostControversial = {
                sessionId: entry.sessionId,
                question: entry.question,
                consensus: synth.consensusScore,
              };
            }
          }
          if (typeof synth.confidenceScore === 'number') {
            totalConfidence += synth.confidenceScore;
            confidenceCount++;
          }

          // Vote rankings → participation & wins
          const rankings = synth.votes?.rankings as
            | Array<{ provider: string; score: number }>
            | undefined;
          const winner = synth.votes?.winner as string | undefined;
          if (rankings) {
            for (const r of rankings) {
              providerParticipation[r.provider] = (providerParticipation[r.provider] ?? 0) + 1;
            }
          }
          if (winner) {
            providerWins[winner] = (providerWins[winner] ?? 0) + 1;
          }
        } catch {
          /* skip bad files */
        }
      }

      // Compute win rates
      const allProviders = new Set([
        ...Object.keys(providerWins),
        ...Object.keys(providerParticipation),
      ]);
      const providerStats = [...allProviders]
        .map((name) => {
          const wins = providerWins[name] ?? 0;
          const participated = providerParticipation[name] ?? 0;
          const winRate = participated > 0 ? wins / participated : 0;
          return { name, wins, participated, winRate };
        })
        .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);

      const avgConsensus = consensusCount > 0 ? totalConsensus / consensusCount : null;
      const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : null;

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              totalSessions: entries.length,
              totalDurationMs: totalDuration,
              avgConsensus,
              avgConfidence,
              providers: providerStats,
              mostControversial,
            },
            null,
            2,
          ),
        );
        return;
      }

      // Display
      console.log('');
      console.log(pc.bold(pc.cyan('📊 Provider Statistics')));
      console.log(pc.dim('━'.repeat(50)));
      console.log('');
      console.log(`  Sessions: ${pc.bold(String(entries.length))}`);
      console.log(`  Total deliberation time: ${pc.bold((totalDuration / 1000).toFixed(1) + 's')}`);
      if (avgConsensus != null) console.log(`  Avg consensus: ${pc.bold(avgConsensus.toFixed(2))}`);
      if (avgConfidence != null)
        console.log(`  Avg confidence: ${pc.bold(avgConfidence.toFixed(2))}`);
      console.log('');

      // Provider table
      console.log(pc.bold('  Provider Win Rates:'));
      console.log('');
      for (const p of providerStats) {
        const pct = (p.winRate * 100).toFixed(0);
        const bar = '█'.repeat(Math.round(p.winRate * 20));
        console.log(
          `    ${p.name.padEnd(12)} ${pc.cyan(bar.padEnd(20))} ${pct}%  (${p.wins}/${p.participated} sessions)`,
        );
      }

      if (mostControversial) {
        console.log('');
        console.log(pc.bold('  Most Controversial:'));
        console.log(
          `    ${pc.yellow(mostControversial.question.slice(0, 80))}${mostControversial.question.length > 80 ? '...' : ''}`,
        );
        console.log(`    Consensus: ${pc.red(mostControversial.consensus.toFixed(2))}`);
        console.log(`    ${pc.dim(pathJoin(sessionsDir, mostControversial.sessionId))}`);
      }

      console.log('');
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

      // Load evidence report
      const reportPath = pathJoin(sessionPath, 'evidence-report.json');
      if (!existsSync(reportPath)) {
        throw new CLIError(
          pc.red(`No evidence report found at ${reportPath}`) +
            '\n' +
            pc.dim('Run a deliberation with --evidence advisory or --evidence strict first.'),
        );
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
        reports = reports.filter((r) => r.provider.toLowerCase() === name.toLowerCase());
        if (reports.length === 0) {
          throw new CLIError(pc.red(`No report found for provider: ${name}`));
        }
      }

      // Filter by tier
      const tierFilter = opts.tier
        ? ((opts.tier as string).toUpperCase() as SourceTier)
        : undefined;
      if (tierFilter && !['A', 'B', 'C', 'D', 'F'].includes(tierFilter)) {
        throw new CLIError(pc.red(`Invalid tier: ${opts.tier}. Must be A, B, C, D, or F.`));
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
      console.log(pc.bold(`📋 Evidence Report — Session ${sessionId}`));
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
        const tierStr = ['A', 'B', 'C', 'D', 'F']
          .map((t) => `${tb[t as SourceTier] ?? 0}${t}`)
          .join(' ');
        const grade = evidenceGrade(r.weightedScore);

        const gradeColor =
          grade === 'A'
            ? pc.green
            : grade === 'B'
              ? pc.cyan
              : grade === 'C'
                ? pc.yellow
                : grade === 'D'
                  ? pc.red
                  : pc.bgRed;

        console.log(
          `│ ${pad(r.provider, colProvider)} │ ${padC(score, colScore)} │ ${padC(weighted, colWeighted)} │ ${padC(claims, colClaims)} │ ${pad(tierStr, colTier)} │ ${padC(gradeColor(grade), colGrade)} │`,
        );
      }

      console.log(divBot);

      // Cross-references
      if (crossRefs.length > 0) {
        console.log('');
        console.log(pc.bold('Cross-References:'));
        for (const cr of crossRefs) {
          if (cr.corroborated) {
            console.log(
              `  ${pc.green('✅')} "${cr.claimText}" — ${cr.providers.join(', ')} (tier ${cr.bestSourceTier})`,
            );
          } else if (cr.contradicted) {
            const details = cr.contradictions?.join('; ') ?? '';
            console.log(
              `  ${pc.yellow('⚠️')}  "${cr.claimText}" — ${details || cr.providers.join(' vs ')}`,
            );
          }
        }
      }

      // Provider detail
      for (const r of reports) {
        let claims = r.claims;
        if (tierFilter) {
          claims = claims.filter((c) => c.sourceTier === tierFilter);
        }
        if (claims.length === 0) continue;

        console.log('');
        console.log(pc.bold(`Provider Detail — ${r.provider}:`));

        for (const c of claims) {
          const icon =
            c.sourceTier === 'A' || c.sourceTier === 'B'
              ? pc.green('✅')
              : c.sourceTier === 'C' || c.sourceTier === 'D'
                ? pc.yellow('⚠️')
                : pc.red('❌');
          const sourceInfo = c.source ? ` [source: ${c.source}]` : '';
          console.log(`  ${icon} [${c.sourceTier}] "${c.claim}"${pc.dim(sourceInfo)}`);
        }
      }

      console.log('');
    });
}
