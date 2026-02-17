import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join as pathJoin, extname } from 'node:path';
import { loadConfig, loadProjectConfig, loadAgentProfile } from '../config.js';
import { CouncilV2 } from '../council-v2.js';
import type { AdaptivePreset } from '../adaptive.js';
import { createProvider } from '../providers/base.js';
import { getGitDiff, getPrDiff, getGitContext } from '../git.js';
import { CLIError, readStdin } from './helpers.js';

export function registerReviewCommands(program: Command): void {
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
    .option('--devils-advocate', "Assign one provider as devil's advocate")
    .option('--diff [ref]', 'Review diff against a ref (defaults to HEAD)')
    .option('--staged', 'Review staged changes (git diff --cached)')
    .option('--pr <number>', 'Review a GitHub PR (requires gh CLI)')
    .option('--dry-run', 'Preview what would happen without making API calls')
    .option(
      '--challenge-style <style>',
      'Override profile challengeStyle (adversarial|collaborative|socratic)',
    )
    .option('--focus <topics>', 'Comma-separated list to override profile focus')
    .option('--convergence <threshold>', 'Override convergenceThreshold (0.0-1.0)')
    .option('--rounds <n>', 'Override number of rounds')
    .option('--adaptive <preset>', 'Adaptive debate controller: fast, balanced, critical, off')
    .option('--red-team', 'Enable adversarial red-team analysis')
    .option(
      '--attack-pack <packs>',
      'Comma-separated attack packs (general, code, security, legal, medical)',
    )
    .option(
      '--topology <name>',
      'Debate topology: mesh, star, tournament, map_reduce, adversarial_tree, pipeline, panel',
    )
    .option('--topology-hub <provider>', 'Hub provider for star topology')
    .option('--topology-moderator <provider>', 'Moderator for panel topology')
    .option('--no-memory', 'Skip deliberation memory (no retrieval or storage)')
    .option('--policy <name>', 'Use only the named policy for guardrail checks')
    .option('--card', 'Output a summary card (delegates to ci command)')
    .option(
      '--card-format <format>',
      'Summary card format: markdown, json, html (implies --card)',
      'markdown',
    )
    .option('--card-detailed', 'Output a detailed summary card (no char limit)')
    .option('--annotations', 'Output GitHub Actions annotations')
    .action(async (files: string[], opts) => {
      // If --card is requested, delegate to ci command for structured output
      const wantsCard =
        opts.card || opts.cardFormat !== 'markdown' || opts.cardDetailed || opts.annotations;
      if (wantsCard) {
        const ciArgs = ['ci'];
        if (opts.staged) ciArgs.push('--staged');
        else if (opts.diff !== undefined)
          ciArgs.push('--diff', typeof opts.diff === 'string' ? opts.diff : '');
        else if (opts.pr) ciArgs.push('--pr', opts.pr as string);
        if (opts.card) ciArgs.push('--card');
        if (opts.cardFormat) ciArgs.push('--card-format', opts.cardFormat as string);
        if (opts.cardDetailed) ciArgs.push('--card-detailed');
        if (opts.annotations) ciArgs.push('--annotations');
        if (opts.providers) ciArgs.push('--providers', opts.providers as string);
        if (opts.profile && opts.profile !== 'code-review')
          ciArgs.push('--profile', opts.profile as string);
        if (opts.rapid) ciArgs.push('--rapid');
        if (opts.focus) ciArgs.push('--focus', opts.focus as string);
        if (opts.timeout) ciArgs.push('--timeout', opts.timeout as string);
        if (opts.memory === false) ciArgs.push('--no-memory');
        if (opts.policy) ciArgs.push('--policy', opts.policy as string);
        await program.parseAsync(['node', 'quorum', ...ciArgs]);
        return;
      }

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
            return;
          }
          content = `## Git Diff (staged changes)\n${gitContextStr ? `\n${gitContextStr}\n` : ''}\n\`\`\`diff\n${diff}\n\`\`\`\n`;
        } catch (err) {
          throw new CLIError(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        }
      } else if (opts.diff !== undefined) {
        try {
          const ref = typeof opts.diff === 'string' ? opts.diff : 'HEAD';
          const diff = await getGitDiff({ ref });
          if (!diff.trim()) {
            console.log(chalk.yellow(`No diff found against ${ref}.`));
            return;
          }
          content = `## Git Diff (vs ${ref})\n${gitContextStr ? `\n${gitContextStr}\n` : ''}\n\`\`\`diff\n${diff}\n\`\`\`\n`;
        } catch (err) {
          throw new CLIError(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        }
      } else if (opts.pr) {
        try {
          const pr = await getPrDiff(opts.pr as string);
          if (!pr.diff.trim()) {
            console.log(chalk.yellow(`PR #${opts.pr} has no diff.`));
            return;
          }
          content = `## Pull Request #${opts.pr}: ${pr.title}\n${gitContextStr ? `\n${gitContextStr}\n` : ''}`;
          if (pr.body.trim()) {
            content += `\n### Description\n${pr.body}\n`;
          }
          content += `\n### Diff\n\`\`\`diff\n${pr.diff}\n\`\`\`\n`;
        } catch (err) {
          throw new CLIError(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
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
              throw new CLIError(chalk.red(`File not found: ${filePath}`));
            }
            const fileContent = await readFile(filePath, 'utf-8');
            const ext = extname(filePath).slice(1) || 'text';
            content += `## File: ${filePath}\n\`\`\`${ext}\n${fileContent}\n\`\`\`\n\n`;
          }
        }

        if (!content.trim()) {
          throw new CLIError(
            [
              chalk.red('No input provided. Pass file paths, pipe content, or use --staged/--diff/--pr.'),
              chalk.dim('Usage: quorum review src/api.ts src/utils.ts'),
              chalk.dim('   or: quorum review --staged'),
              chalk.dim('   or: quorum review --diff main'),
              chalk.dim('   or: quorum review --pr 42'),
            ].join('\n'),
          );
        }
      }

      // Delegate to ask command logic by invoking program
      const askArgs = ['ask', content];
      askArgs.push('--profile', opts.profile as string);
      if (opts.providers) {
        askArgs.push('--providers', opts.providers as string);
      }
      if (opts.single !== undefined) {
        askArgs.push('--single', typeof opts.single === 'string' ? opts.single : '');
      }
      if (opts.verbose) {
        askArgs.push('--verbose');
      }
      if (opts.audit) {
        askArgs.push('--audit', opts.audit as string);
      }
      if (opts.json) {
        askArgs.push('--json');
      }
      if (opts.timeout) {
        askArgs.push('--timeout', opts.timeout as string);
      }
      if (opts.dryRun) {
        askArgs.push('--dry-run');
      }
      if (opts.rapid) {
        askArgs.push('--rapid');
      }
      if (opts.devilsAdvocate) {
        askArgs.push('--devils-advocate');
      }
      if (opts.challengeStyle) {
        askArgs.push('--challenge-style', opts.challengeStyle as string);
      }
      if (opts.focus) {
        askArgs.push('--focus', opts.focus as string);
      }
      if (opts.convergence) {
        askArgs.push('--convergence', opts.convergence as string);
      }
      if (opts.rounds) {
        askArgs.push('--rounds', opts.rounds as string);
      }
      if (opts.adaptive) {
        askArgs.push('--adaptive', opts.adaptive as string);
      }
      if (opts.redTeam) {
        askArgs.push('--red-team');
      }
      if (opts.attackPack) {
        askArgs.push('--attack-pack', opts.attackPack as string);
      }
      if (opts.topology) {
        askArgs.push('--topology', opts.topology as string);
      }
      if (opts.topologyHub) {
        askArgs.push('--topology-hub', opts.topologyHub as string);
      }
      if (opts.topologyModerator) {
        askArgs.push('--topology-moderator', opts.topologyModerator as string);
      }
      if (opts.memory === false) {
        askArgs.push('--no-memory');
      }

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
    .option(
      '--attack-pack <packs>',
      'Comma-separated attack packs (general, code, security, legal, medical)',
    )
    .option(
      '--topology <name>',
      'Debate topology: mesh, star, tournament, map_reduce, adversarial_tree, pipeline, panel',
    )
    .option('--topology-hub <provider>', 'Hub provider for star topology')
    .option('--topology-moderator <provider>', 'Moderator for panel topology')
    .option('--no-memory', 'Skip deliberation memory (no retrieval or storage)')
    .option('--policy <name>', 'Use only the named policy for guardrail checks')
    .option('--card', 'Output a summary card to stdout')
    .option(
      '--card-format <format>',
      'Summary card format: markdown, json, html (implies --card)',
      'markdown',
    )
    .option('--card-detailed', 'Output a detailed summary card (no char limit)')
    .option('--annotations', 'Output GitHub Actions annotations')
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
            throw new CLIError('No staged changes found.', 2);
          }
          content = `## Git Diff (staged changes)\n${gitContextStr ? `\n${gitContextStr}\n` : ''}\n\`\`\`diff\n${diff}\n\`\`\`\n`;
        } else if (opts.diff !== undefined) {
          const ref = typeof opts.diff === 'string' ? opts.diff : 'HEAD';
          const diff = await getGitDiff({ ref });
          if (!diff.trim()) {
            throw new CLIError(`No diff found against ${ref}.`, 2);
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
              const { stdout } = await execFileAsync('gh', [
                'pr',
                'view',
                prNumber,
                '--json',
                'files',
                '--jq',
                '.files | length',
              ]);
              const fileCount = parseInt(stdout.trim());
              if (fileCount > maxFiles) {
                const skipResult = {
                  approved: true,
                  confidence: 1,
                  consensus: 1,
                  evidenceGrade: 'N/A',
                  riskMatrix: [],
                  suggestions: [],
                  dissent: '',
                  synthesis: `Skipped: PR has ${fileCount} files (max: ${maxFiles})`,
                  providers: [],
                  duration: 0,
                  sessionId: '',
                };
                console.log(JSON.stringify(skipResult, null, 2));
                return;
              }
            } catch {
              /* proceed anyway */
            }
          }
          const pr = await getPrDiff(prNumber);
          if (!pr.diff.trim()) {
            throw new CLIError(`PR #${prNumber} has no diff.`, 2);
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
            throw new CLIError('No input. Use --pr, --diff, --staged, or pipe content.', 2);
          }
        }
      } catch (err) {
        throw new CLIError(`Error: ${err instanceof Error ? err.message : err}`, 2);
      }

      // --- Load config, profile, providers ---
      const config = await loadConfig();
      const projectConfig = await loadProjectConfig();

      if (config.providers.length === 0) {
        throw new CLIError('No providers configured. Run: quorum init', 2);
      }

      const profile = await loadAgentProfile(opts.profile as string);
      if (!profile) {
        throw new CLIError(`Profile not found: ${opts.profile}`, 2);
      }

      if (opts.focus) {
        profile.focus = (opts.focus as string)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (opts.evidence) {
        const mode = opts.evidence as string;
        if (!['off', 'advisory', 'strict'].includes(mode)) {
          throw new CLIError(`Invalid --evidence: "${mode}". Must be off, advisory, or strict.`, 2);
        }
        profile.evidence = mode as 'off' | 'advisory' | 'strict';
      }

      const timeoutOverride = opts.timeout ? parseInt(opts.timeout as string) : undefined;
      if (timeoutOverride !== undefined && !isNaN(timeoutOverride) && timeoutOverride > 0) {
        for (const p of config.providers) p.timeout = timeoutOverride;
      }

      let providers = config.providers;
      if (opts.providers) {
        const names = (opts.providers as string).split(',').map((s) => s.trim());
        providers = config.providers.filter((p) => names.includes(p.name));
        if (providers.length === 0) {
          throw new CLIError(`No matching providers: ${opts.providers}`, 2);
        }
      } else if (projectConfig?.providers) {
        const names = projectConfig.providers;
        const filtered = config.providers.filter((p) => names.includes(p.name));
        if (filtered.length > 0) providers = filtered;
      }

      const excluded = new Set(profile.excludeFromDeliberation?.map((s) => s.toLowerCase()) ?? []);
      const candidateProviders = providers.filter(
        (p) => !excluded.has(p.name.toLowerCase()) && !excluded.has(p.provider.toLowerCase()),
      );

      if (candidateProviders.length < 2) {
        throw new CLIError(
          `Need 2+ providers for deliberation (${candidateProviders.length} configured).`, 2,
        );
      }

      const adapters = await Promise.all(candidateProviders.map((p) => createProvider(p)));

      // --- Run deliberation silently ---
      const startTime = Date.now();
      const council = new CouncilV2(adapters, candidateProviders, profile, {
        streaming: false,
        rapid: opts.rapid ?? false,
        devilsAdvocate: false,
        noMemory: opts.memory === false,
        policyName: (opts.policy as string) || undefined,
        adaptive: (opts.adaptive as AdaptivePreset) || undefined,
        redTeam: opts.redTeam || undefined,
        attackPacks: opts.attackPack
          ? (opts.attackPack as string).split(',').map((s: string) => s.trim())
          : undefined,
        topology: (opts.topology as any) || undefined,
        topologyConfig: {
          ...(opts.topologyHub ? { hub: opts.topologyHub as string } : {}),
          ...(opts.topologyModerator ? { moderator: opts.topologyModerator as string } : {}),
        },
        onEvent() {
          /* silent */
        },
      });

      let result: Awaited<ReturnType<typeof council.deliberate>>;
      try {
        result = await council.deliberate(content);
      } catch (err) {
        throw new CLIError(`Deliberation error: ${err instanceof Error ? err.message : err}`, 2);
      }
      const duration = Date.now() - startTime;

      // --- Read evidence report if available ---
      let evidenceGrade = 'N/A';
      let evidencePercent = 0;
      try {
        const evPath = pathJoin(result.sessionPath, 'evidence-report.json');
        if (existsSync(evPath)) {
          const evData = JSON.parse(await readFile(evPath, 'utf-8')) as Array<{
            evidenceScore: number;
          }>;
          if (evData.length > 0) {
            evidencePercent = Math.round(
              (evData.reduce((s, r) => s + r.evidenceScore, 0) / evData.length) * 100,
            );
            if (evidencePercent >= 80) evidenceGrade = 'A';
            else if (evidencePercent >= 60) evidenceGrade = 'B';
            else if (evidencePercent >= 40) evidenceGrade = 'C';
            else if (evidencePercent >= 20) evidenceGrade = 'D';
            else evidenceGrade = 'F';
          }
        }
      } catch {
        /* no evidence */
      }

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
        suggestions: Array<{
          file: string;
          line?: number;
          before?: string;
          after?: string;
          rationale: string;
        }>;
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
        providers: candidateProviders.map((p) => p.name),
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

      // --- Summary card output ---
      const wantsCard =
        opts.card || opts.cardFormat !== 'markdown' || opts.cardDetailed || opts.annotations;
      if (wantsCard) {
        const { generateSummaryCard, generateAnnotations: genAnnotations } =
          await import('../summary-card.js');
        const cardInput = {
          synthesis: result.synthesis,
          votes: result.votes,
          duration,
          sessionId: result.sessionId,
          providers: ciResult.providers,
          confidenceThreshold: threshold,
          sessionUrl: prNumber ? `https://github.com/pulls/${prNumber}` : undefined,
        };
        const cardFormat = (opts.cardFormat as 'markdown' | 'json' | 'html') || 'markdown';
        const card = generateSummaryCard(cardInput, cardFormat, opts.cardDetailed ?? false);
        console.log(card);
        if (opts.annotations) {
          console.log(genAnnotations(cardInput));
        }
      }

      // --- Exit code ---
      if (!approved) {
        throw new CLIError('', 1);
      }
    });
}
