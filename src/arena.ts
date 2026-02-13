/**
 * Eval Arena + Reputation Specialists
 *
 * Benchmarking and reputation system that tracks provider performance
 * across deliberations and uses historical data to weight future influence.
 */

import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// ── Types ──

export interface EvalCase {
  id: string;
  question: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  referenceAnswer?: string;
  evaluationCriteria?: string[];
}

export interface EvalSuite {
  name: string;
  version: number;
  cases: EvalCase[];
}

export interface EvalResult {
  caseId: string;
  provider: string;
  wasWinner: boolean;
  votesReceived: number;
  consensusContribution: number;
  timestamp: number;
}

export interface ProviderReputation {
  provider: string;
  totalRuns: number;
  wins: number;
  winRate: number;
  avgConsensusContribution: number;
  domainScores: Record<string, { runs: number; wins: number; winRate: number }>;
  reputationScore: number;
  lastUpdated: number;
}

export interface ArenaState {
  version: 1;
  results: EvalResult[];
  reputations: Record<string, ProviderReputation>;
}

// ── Paths ──

const ARENA_PATH = join(homedir(), '.quorum', 'arena.json');

function getEvalDirs(): string[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return [
    join(process.cwd(), 'agents', 'evals'),
    join(homedir(), '.quorum', 'agents', 'evals'),
    join(__dirname, '..', 'agents', 'evals'),
  ];
}

// ── State Management ──

function emptyState(): ArenaState {
  return { version: 1, results: [], reputations: {} };
}

export async function loadArenaState(): Promise<ArenaState> {
  try {
    if (existsSync(ARENA_PATH)) {
      const data = JSON.parse(await readFile(ARENA_PATH, 'utf-8'));
      return data as ArenaState;
    }
  } catch { /* corrupt file */ }
  return emptyState();
}

export async function saveArenaState(state: ArenaState): Promise<void> {
  const dir = dirname(ARENA_PATH);
  await mkdir(dir, { recursive: true });
  const tmp = `${ARENA_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await rename(tmp, ARENA_PATH);
}

// ── Reputation Computation ──

const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function computeReputationScore(stats: ProviderReputation): number {
  // 40% win rate
  const winComponent = stats.winRate * 0.4;

  // 30% consensus contribution
  const consensusComponent = stats.avgConsensusContribution * 0.3;

  // 20% recency — exponential decay from lastUpdated
  const ageMs = Date.now() - stats.lastUpdated;
  const recencyComponent = Math.exp(-ageMs / RECENCY_HALF_LIFE_MS) * 0.2;

  // 10% volume — log(totalRuns) / log(100) capped at 1.0
  const volumeRaw = stats.totalRuns > 0 ? Math.log(stats.totalRuns) / Math.log(100) : 0;
  const volumeComponent = Math.min(volumeRaw, 1.0) * 0.1;

  return Math.min(1, Math.max(0, winComponent + consensusComponent + recencyComponent + volumeComponent));
}

function rebuildReputation(provider: string, results: EvalResult[]): ProviderReputation {
  const providerResults = results.filter(r => r.provider === provider);
  const totalRuns = providerResults.length;
  const wins = providerResults.filter(r => r.wasWinner).length;
  const winRate = totalRuns > 0 ? wins / totalRuns : 0;
  const avgConsensusContribution = totalRuns > 0
    ? providerResults.reduce((s, r) => s + r.consensusContribution, 0) / totalRuns
    : 0;

  // Domain scores
  const domainScores: Record<string, { runs: number; wins: number; winRate: number }> = {};
  const byCategory = new Map<string, EvalResult[]>();
  for (const r of providerResults) {
    // category is embedded in caseId as prefix (e.g. "reasoning-1") or passed separately
    // We'll extract from caseId pattern or use a fallback
    const cat = extractCategoryFromCaseId(r.caseId);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(r);
  }
  for (const [cat, catResults] of byCategory) {
    const catWins = catResults.filter(r => r.wasWinner).length;
    domainScores[cat] = {
      runs: catResults.length,
      wins: catWins,
      winRate: catResults.length > 0 ? catWins / catResults.length : 0,
    };
  }

  const lastUpdated = providerResults.length > 0
    ? Math.max(...providerResults.map(r => r.timestamp))
    : Date.now();

  const rep: ProviderReputation = {
    provider,
    totalRuns,
    wins,
    winRate,
    avgConsensusContribution,
    domainScores,
    reputationScore: 0,
    lastUpdated,
  };
  rep.reputationScore = computeReputationScore(rep);
  return rep;
}

function extractCategoryFromCaseId(caseId: string): string {
  // caseId like "reasoning-1" → "reasoning", "code-review-3" → "code-review"
  const match = caseId.match(/^(.+?)(?:-\d+)?$/);
  return match ? match[1] : caseId;
}

// ── Record & Query ──

export async function recordResult(
  provider: string,
  caseOrSessionId: string,
  wasWinner: boolean,
  votesReceived: number,
  consensusContribution: number,
  category?: string,
): Promise<void> {
  const state = await loadArenaState();
  const caseId = category ? `${category}-${caseOrSessionId}` : caseOrSessionId;

  state.results.push({
    caseId,
    provider,
    wasWinner,
    votesReceived,
    consensusContribution,
    timestamp: Date.now(),
  });

  // Rebuild this provider's reputation
  state.reputations[provider] = rebuildReputation(provider, state.results);

  await saveArenaState(state);
}

export async function getReputation(provider: string): Promise<ProviderReputation | null> {
  const state = await loadArenaState();
  return state.reputations[provider] ?? null;
}

export async function getAllReputations(): Promise<ProviderReputation[]> {
  const state = await loadArenaState();
  return Object.values(state.reputations).sort((a, b) => b.reputationScore - a.reputationScore);
}

export async function getReputationWeights(providers: string[]): Promise<Record<string, number>> {
  const state = await loadArenaState();
  const weights: Record<string, number> = {};
  let total = 0;

  for (const p of providers) {
    const rep = state.reputations[p];
    // Default score of 0.5 for unknown providers
    const score = rep ? rep.reputationScore : 0.5;
    weights[p] = score;
    total += score;
  }

  // Normalize so weights sum to providers.length (preserves average of 1.0 per provider)
  if (total > 0) {
    const factor = providers.length / total;
    for (const p of providers) {
      weights[p] *= factor;
    }
  } else {
    for (const p of providers) {
      weights[p] = 1;
    }
  }

  return weights;
}

// ── Eval Suite Loading ──

export async function loadEvalSuite(name: string): Promise<EvalSuite> {
  for (const dir of getEvalDirs()) {
    const filePath = join(dir, `${name}.yaml`);
    if (existsSync(filePath)) {
      const content = await readFile(filePath, 'utf-8');
      return parseYaml(content) as EvalSuite;
    }
  }
  throw new Error(`Eval suite not found: ${name}`);
}

export async function listEvalSuites(): Promise<string[]> {
  const suites = new Set<string>();
  for (const dir of getEvalDirs()) {
    try {
      const files = await readdir(dir);
      for (const f of files) {
        if (f.endsWith('.yaml')) suites.add(f.replace(/\.yaml$/, ''));
      }
    } catch { /* dir doesn't exist */ }
  }
  return [...suites].sort();
}

// ── Formatting ──

export function formatLeaderboard(reputations: ProviderReputation[]): string {
  if (reputations.length === 0) return 'No provider data yet. Run some deliberations or eval suites first.';

  const sorted = [...reputations].sort((a, b) => b.reputationScore - a.reputationScore);
  const lines: string[] = [''];
  lines.push('  Provider          Score   Win Rate   Consensus   Runs');
  lines.push('  ─────────────────────────────────────────────────────');

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const name = r.provider.padEnd(16);
    const score = (r.reputationScore * 100).toFixed(1).padStart(5) + '%';
    const wr = (r.winRate * 100).toFixed(0).padStart(5) + '%';
    const cc = (r.avgConsensusContribution * 100).toFixed(0).padStart(8) + '%';
    const runs = String(r.totalRuns).padStart(6);
    lines.push(`  ${medal} ${name} ${score}   ${wr}   ${cc}   ${runs}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function formatProviderCard(reputation: ProviderReputation): string {
  const r = reputation;
  const lines: string[] = [''];
  lines.push(`  ╔══════════════════════════════════════╗`);
  lines.push(`  ║  ${r.provider.padEnd(34)} ║`);
  lines.push(`  ╠══════════════════════════════════════╣`);
  lines.push(`  ║  Reputation Score: ${(r.reputationScore * 100).toFixed(1).padStart(6)}%          ║`);
  lines.push(`  ║  Win Rate:         ${(r.winRate * 100).toFixed(1).padStart(6)}%          ║`);
  lines.push(`  ║  Consensus Avg:    ${(r.avgConsensusContribution * 100).toFixed(1).padStart(6)}%          ║`);
  lines.push(`  ║  Total Runs:       ${String(r.totalRuns).padStart(6)}           ║`);
  lines.push(`  ║  Wins:             ${String(r.wins).padStart(6)}           ║`);
  lines.push(`  ╠══════════════════════════════════════╣`);
  lines.push(`  ║  Domain Breakdown:                   ║`);

  const domains = Object.entries(r.domainScores);
  if (domains.length === 0) {
    lines.push(`  ║    (no domain data)                  ║`);
  } else {
    for (const [domain, stats] of domains) {
      const wr = (stats.winRate * 100).toFixed(0);
      const entry = `${domain}: ${stats.wins}/${stats.runs} (${wr}%)`;
      lines.push(`  ║    ${entry.padEnd(34)} ║`);
    }
  }

  lines.push(`  ╠══════════════════════════════════════╣`);
  const updated = new Date(r.lastUpdated).toISOString().slice(0, 10);
  lines.push(`  ║  Last Updated: ${updated.padEnd(22)} ║`);
  lines.push(`  ╚══════════════════════════════════════╝`);
  lines.push('');
  return lines.join('\n');
}
