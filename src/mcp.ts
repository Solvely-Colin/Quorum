/**
 * MCP (Model Context Protocol) server for Quorum.
 *
 * Exposes Quorum's deliberation capabilities as tools that any MCP-compatible
 * client (Claude Desktop, Cursor, OpenClaw, etc.) can invoke.
 *
 * Transport: stdio (stdin/stdout) — standard for local MCP servers.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig, loadAgentProfile, detectProviders } from './config.js';
import { CouncilV2 } from './council-v2.js';
import type { AdaptivePreset } from './adaptive.js';
import { createProvider } from './providers/base.js';
import { getGitDiff, getPrDiff } from './git.js';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { extname } from 'node:path';

/**
 * Start the MCP server on stdio transport.
 */
export async function startMcpServer(): Promise<void> {
  const server = new McpServer(
    {
      name: 'quorum',
      version: '0.5.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // ── quorum_ask ──────────────────────────────────────────────────────────
  server.tool(
    'quorum_ask',
    'Run a full multi-AI deliberation. Multiple AI providers independently answer, debate, critique, and synthesize a response. Returns a synthesis with confidence scores, vote results, and minority report.',
    {
      question: z.string().describe('The question or prompt to deliberate on'),
      rapid: z
        .boolean()
        .optional()
        .describe('Rapid mode — skip plan, formulate, adjust, rebuttal, vote phases'),
      evidence: z
        .enum(['off', 'advisory', 'strict'])
        .optional()
        .describe('Evidence-backed claims mode'),
      adaptive: z
        .enum(['fast', 'balanced', 'critical'])
        .optional()
        .describe('Adaptive debate controller preset'),
      profile: z
        .string()
        .optional()
        .describe('Agent profile name (default, brainstorm, code-review, research)'),
      providers: z
        .array(z.string())
        .optional()
        .describe('Specific provider names to use (defaults to all configured)'),
      devilsAdvocate: z.boolean().optional().describe("Assign one provider as devil's advocate"),
    },
    async ({ question, rapid, evidence, adaptive, profile, providers, devilsAdvocate }) => {
      try {
        const config = await loadConfig();
        if (config.providers.length === 0) {
          return { content: [{ type: 'text', text: 'No providers configured. Run: quorum init' }] };
        }

        const agentProfile = await loadAgentProfile(profile ?? 'default');
        if (!agentProfile) {
          return {
            content: [{ type: 'text', text: `Profile not found: ${profile ?? 'default'}` }],
            isError: true,
          };
        }
        if (evidence) agentProfile.evidence = evidence;
        if (adaptive) agentProfile.adaptive = adaptive;

        let providerConfigs = config.providers;
        if (providers && providers.length > 0) {
          providerConfigs = config.providers.filter((p) => providers.includes(p.name));
          if (providerConfigs.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `No matching providers found. Available: ${config.providers.map((p) => p.name).join(', ')}`,
                },
              ],
            };
          }
        }

        const adapters = await Promise.all(providerConfigs.map((p) => createProvider(p)));

        const council = new CouncilV2(adapters, providerConfigs, agentProfile, {
          rapid: rapid ?? false,
          devilsAdvocate: devilsAdvocate ?? false,
          adaptive: adaptive as AdaptivePreset | undefined,
        });

        const result = await council.deliberate(question);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  synthesis: result.synthesis.content,
                  confidence: result.synthesis.confidenceScore,
                  consensus: result.synthesis.consensusScore,
                  controversial: result.synthesis.controversial,
                  minorityReport: result.synthesis.minorityReport ?? null,
                  contributions: result.synthesis.contributions,
                  winner: result.votes.winner,
                  rankings: result.votes.rankings,
                  sessionId: result.sessionId,
                  duration: result.duration,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    },
  );

  // ── quorum_review ───────────────────────────────────────────────────────
  server.tool(
    'quorum_review',
    'Code review via multi-AI deliberation. Provide file paths, staged changes, a branch diff, or a PR number. Multiple AI providers review the code independently, then debate and synthesize findings.',
    {
      files: z.array(z.string()).optional().describe('File paths to review'),
      staged: z.boolean().optional().describe('Review staged git changes'),
      diff: z.string().optional().describe('Review diff against a git ref/branch name'),
      pr: z.number().optional().describe('Review a GitHub PR by number (requires gh CLI)'),
    },
    async ({ files, staged, diff, pr }) => {
      try {
        let content = '';

        if (staged) {
          const d = await getGitDiff({ staged: true });
          if (!d.trim()) return { content: [{ type: 'text', text: 'No staged changes found.' }] };
          content = `## Git Diff (staged changes)\n\`\`\`diff\n${d}\n\`\`\`\n`;
        } else if (diff) {
          const d = await getGitDiff({ ref: diff });
          if (!d.trim())
            return { content: [{ type: 'text', text: `No diff found against ${diff}.` }] };
          content = `## Git Diff (vs ${diff})\n\`\`\`diff\n${d}\n\`\`\`\n`;
        } else if (pr) {
          const prData = await getPrDiff(String(pr));
          if (!prData.diff.trim())
            return { content: [{ type: 'text', text: `PR #${pr} has no diff.` }] };
          content = `## Pull Request #${pr}: ${prData.title}\n`;
          if (prData.body.trim()) content += `\n### Description\n${prData.body}\n`;
          content += `\n### Diff\n\`\`\`diff\n${prData.diff}\n\`\`\`\n`;
        } else if (files && files.length > 0) {
          for (const filePath of files) {
            if (!existsSync(filePath)) {
              return {
                content: [{ type: 'text', text: `File not found: ${filePath}` }],
                isError: true,
              };
            }
            const fileContent = await readFile(filePath, 'utf-8');
            const ext = extname(filePath).slice(1) || 'text';
            content += `## File: ${filePath}\n\`\`\`${ext}\n${fileContent}\n\`\`\`\n\n`;
          }
        } else {
          return {
            content: [
              {
                type: 'text',
                text: 'No input provided. Specify files, staged, diff, or pr.',
              },
            ],
            isError: true,
          };
        }

        const config = await loadConfig();
        if (config.providers.length === 0) {
          return { content: [{ type: 'text', text: 'No providers configured. Run: quorum init' }] };
        }

        const profile = await loadAgentProfile('code-review');
        if (!profile) {
          return {
            content: [{ type: 'text', text: 'Code-review profile not found.' }],
            isError: true,
          };
        }
        const adapters = await Promise.all(config.providers.map((p) => createProvider(p)));

        const council = new CouncilV2(adapters, config.providers, profile, {
          rapid: false,
        });

        const result = await council.deliberate(content);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  review: result.synthesis.content,
                  confidence: result.synthesis.confidenceScore,
                  consensus: result.synthesis.consensusScore,
                  controversial: result.synthesis.controversial,
                  minorityReport: result.synthesis.minorityReport ?? null,
                  contributions: result.synthesis.contributions,
                  winner: result.votes.winner,
                  sessionId: result.sessionId,
                  duration: result.duration,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    },
  );

  // ── quorum_versus ───────────────────────────────────────────────────────
  server.tool(
    'quorum_versus',
    'Head-to-head comparison between two AI providers. Each answers independently, then they critique each other, defend their positions, and a judge picks the winner.',
    {
      provider1: z.string().describe('First provider name'),
      provider2: z.string().describe('Second provider name'),
      question: z.string().describe('The question to compare answers on'),
      judge: z
        .string()
        .optional()
        .describe('Provider name to act as judge (defaults to a third provider or provider1)'),
    },
    async ({ provider1, provider2, question, judge }) => {
      try {
        const config = await loadConfig();
        if (config.providers.length === 0) {
          return { content: [{ type: 'text', text: 'No providers configured. Run: quorum init' }] };
        }

        const cfg1 = config.providers.find((p) => p.name === provider1);
        const cfg2 = config.providers.find((p) => p.name === provider2);
        if (!cfg1) {
          return {
            content: [
              {
                type: 'text',
                text: `Provider not found: ${provider1}. Available: ${config.providers.map((p) => p.name).join(', ')}`,
              },
            ],
            isError: true,
          };
        }
        if (!cfg2) {
          return {
            content: [
              {
                type: 'text',
                text: `Provider not found: ${provider2}. Available: ${config.providers.map((p) => p.name).join(', ')}`,
              },
            ],
            isError: true,
          };
        }

        const adapter1 = await createProvider(cfg1);
        const adapter2 = await createProvider(cfg2);

        let judgeAdapter;
        if (judge) {
          const cfgJudge = config.providers.find((p) => p.name === judge);
          if (cfgJudge) judgeAdapter = await createProvider(cfgJudge);
        } else {
          const cfgJudge = config.providers.find(
            (p) => p.name !== provider1 && p.name !== provider2,
          );
          if (cfgJudge) judgeAdapter = await createProvider(cfgJudge);
        }

        const result = await CouncilV2.versus(question, adapter1, adapter2, judgeAdapter);

        return {
          content: [{ type: 'text', text: result }],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    },
  );

  // ── quorum_providers ────────────────────────────────────────────────────
  server.tool(
    'quorum_providers',
    'List all configured AI providers with their names, models, and status.',
    {},
    async () => {
      try {
        const config = await loadConfig();
        const detected = await detectProviders();
        const detectedNames = new Set(detected.map((d) => d.name));

        const providers = config.providers.map((p) => ({
          name: p.name,
          provider: p.provider,
          model: p.model,
          available: detectedNames.has(p.name),
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify(providers, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    },
  );

  // ── quorum_history ──────────────────────────────────────────────────────
  server.tool(
    'quorum_history',
    'List recent deliberation sessions with their questions, winners, and durations.',
    {
      limit: z.number().optional().describe('Number of sessions to return (default 10)'),
    },
    async ({ limit }) => {
      try {
        const maxResults = limit ?? 10;
        const sessionsDir = join(homedir(), '.quorum', 'sessions');

        if (!existsSync(sessionsDir)) {
          return { content: [{ type: 'text', text: '[]' }] };
        }

        // Try index first
        const indexPath = join(sessionsDir, 'index.json');
        if (existsSync(indexPath)) {
          try {
            const entries = JSON.parse(await readFile(indexPath, 'utf-8')) as Array<{
              sessionId: string;
              timestamp: number;
              question: string;
              winner: string;
              duration: number;
            }>;
            entries.sort((a, b) => b.timestamp - a.timestamp);
            return {
              content: [
                { type: 'text', text: JSON.stringify(entries.slice(0, maxResults), null, 2) },
              ],
            };
          } catch {
            // Fall through
          }
        }

        // Fallback: scan directories
        const dirEntries = await readdir(sessionsDir, { withFileTypes: true });
        const sessions: Array<Record<string, unknown>> = [];

        for (const entry of dirEntries) {
          if (!entry.isDirectory()) continue;
          const dir = join(sessionsDir, entry.name);
          const metaPath = join(dir, 'meta.json');
          if (!existsSync(metaPath)) continue;
          try {
            const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
            let synth = null;
            const synthPath = join(dir, 'synthesis.json');
            if (existsSync(synthPath)) {
              synth = JSON.parse(await readFile(synthPath, 'utf-8'));
            }
            sessions.push({
              sessionId: entry.name,
              question: meta.input?.substring(0, 200) ?? '',
              startedAt: meta.startedAt,
              duration: meta.duration,
              winner: synth?.synthesizer ?? null,
            });
          } catch {
            continue;
          }
        }

        sessions.sort((a, b) => ((b.startedAt as number) ?? 0) - ((a.startedAt as number) ?? 0));

        return {
          content: [{ type: 'text', text: JSON.stringify(sessions.slice(0, maxResults), null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    },
  );

  // ── Start server ────────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
