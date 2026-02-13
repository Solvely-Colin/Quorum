/**
 * Adaptive Debate Controller — Feature #32
 * Dynamically adjusts deliberation flow based on provider agreement/disagreement.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AdaptivePreset = 'fast' | 'balanced' | 'critical' | 'off';

export interface EntropyResult {
  score: number;
  termDivergence: number;
  positionEntropy: number;
  details: string;
}

export interface AdaptiveDecision {
  action: 'continue' | 'skip-to-vote' | 'skip-to-synthesize' | 'add-round' | 'done';
  reason: string;
  entropy: number;
  skipPhases?: string[];
  extraPhase?: string;
}

export interface AdaptiveConfig {
  preset: AdaptivePreset;
  skipThreshold: number;
  addRoundThreshold: number;
  maxExtraRounds: number;
  neverSkipPhases: string[];
}

export interface AdaptiveStats {
  totalSessions: number;
  phaseSkips: Record<string, { count: number; totalConfidence: number; avgConfidence: number }>;
  extraRounds: Record<string, { count: number; totalConfidence: number; avgConfidence: number }>;
  providerPairEntropy: Record<string, { count: number; totalEntropy: number; avgEntropy: number }>;
  lastUpdated: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATS_PATH = join(homedir(), '.quorum', 'adaptive-stats.json');

const ASSERTION_PATTERN = /\b(must|should|is|will|always|never|best|worst)\b/i;

// ─── Entropy Calculation ─────────────────────────────────────────────────────

function extractSignificantWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/\b[a-z]{5,}\b/g) ?? [];
  return new Set(words);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((t) => b.has(t)));
  const union = new Set([...a, ...b]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

function computeTermDivergence(responses: string[]): number {
  const termSets = responses.map(extractSignificantWords);
  let totalSimilarity = 0;
  let pairs = 0;

  for (let i = 0; i < termSets.length; i++) {
    for (let j = i + 1; j < termSets.length; j++) {
      totalSimilarity += jaccardSimilarity(termSets[i], termSets[j]);
      pairs++;
    }
  }

  const avgSimilarity = pairs > 0 ? totalSimilarity / pairs : 0;
  return 1 - avgSimilarity;
}

function extractKeyClaims(text: string): string[][] {
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const claims: string[][] = [];
  for (const sentence of sentences) {
    if (ASSERTION_PATTERN.test(sentence)) {
      const keywords = [...extractSignificantWords(sentence)].sort();
      if (keywords.length > 0) {
        claims.push(keywords);
      }
    }
  }
  return claims;
}

function claimKey(keywords: string[]): string {
  return keywords.join('|');
}

function computePositionEntropy(responses: string[]): number {
  if (responses.length < 2) return 0;

  // Map each unique claim to the set of provider indices that made it
  const claimProviders = new Map<string, Set<number>>();

  for (let i = 0; i < responses.length; i++) {
    const claims = extractKeyClaims(responses[i]);
    for (const c of claims) {
      const key = claimKey(c);
      if (!claimProviders.has(key)) {
        claimProviders.set(key, new Set());
      }
      claimProviders.get(key)!.add(i);
    }
  }

  if (claimProviders.size === 0) return 0;

  // Shannon entropy of how claims are distributed across providers
  // Count how many unique claims each provider has
  const providerClaimCounts = new Array<number>(responses.length).fill(0);
  for (const providers of claimProviders.values()) {
    for (const p of providers) {
      providerClaimCounts[p]++;
    }
  }

  const total = providerClaimCounts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;

  let entropy = 0;
  for (const count of providerClaimCounts) {
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }

  // Normalize to 0-1 range (max entropy = log2(n))
  const maxEntropy = Math.log2(responses.length);
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

export function calculateEntropy(responses: Record<string, string>): EntropyResult {
  const texts = Object.values(responses).filter((v) => v.length > 0);

  if (texts.length < 2) {
    return {
      score: 0,
      termDivergence: 0,
      positionEntropy: 0,
      details: 'Insufficient responses for entropy calculation',
    };
  }

  const termDivergence = computeTermDivergence(texts);
  const positionEntropy = computePositionEntropy(texts);
  const score = 0.6 * termDivergence + 0.4 * positionEntropy;

  const details = `Entropy ${score.toFixed(3)} (term divergence: ${termDivergence.toFixed(3)}, position entropy: ${positionEntropy.toFixed(3)}) across ${texts.length} providers`;

  return { score, termDivergence, positionEntropy, details };
}

// ─── Preset Configs ──────────────────────────────────────────────────────────

export function getPresetConfig(preset: AdaptivePreset): AdaptiveConfig {
  switch (preset) {
    case 'fast':
      return {
        preset,
        skipThreshold: 0.25,
        addRoundThreshold: 0.85,
        maxExtraRounds: 1,
        neverSkipPhases: ['gather', 'synthesize'],
      };
    case 'balanced':
      return {
        preset,
        skipThreshold: 0.2,
        addRoundThreshold: 0.8,
        maxExtraRounds: 2,
        neverSkipPhases: ['gather', 'vote', 'synthesize'],
      };
    case 'critical':
      return {
        preset,
        skipThreshold: 0.1,
        addRoundThreshold: 0.7,
        maxExtraRounds: 3,
        neverSkipPhases: ['gather', 'debate', 'vote', 'synthesize'],
      };
    case 'off':
      return {
        preset,
        skipThreshold: -1,
        addRoundThreshold: 2,
        maxExtraRounds: 0,
        neverSkipPhases: [],
      };
  }
}

// ─── Adaptive Controller ─────────────────────────────────────────────────────

export class AdaptiveController {
  private config: AdaptiveConfig;
  private extraRoundsUsed = 0;
  private decisions: AdaptiveDecision[] = [];
  private phaseEntropies: Record<string, number> = {};

  constructor(preset: AdaptivePreset, overrides?: Partial<AdaptiveConfig>) {
    this.config = { ...getPresetConfig(preset), ...overrides, preset: overrides?.preset ?? preset };
  }

  evaluate(
    completedPhase: string,
    responses: Record<string, string>,
    remainingPhases: string[],
  ): AdaptiveDecision {
    if (this.config.preset === 'off') {
      const decision: AdaptiveDecision = {
        action: 'continue',
        reason: 'Adaptive control disabled',
        entropy: 0,
      };
      this.decisions.push(decision);
      return decision;
    }

    const { score: entropy } = calculateEntropy(responses);
    this.phaseEntropies[completedPhase] = entropy;

    const { skipThreshold, addRoundThreshold, maxExtraRounds, neverSkipPhases } = this.config;

    const canSkipTo = (target: string): boolean => {
      // Check that no neverSkipPhase would be skipped
      const targetIdx = remainingPhases.indexOf(target);
      if (targetIdx < 0) return false;
      const skipped = remainingPhases.slice(0, targetIdx);
      return !skipped.some((p) => neverSkipPhases.includes(p));
    };

    let decision: AdaptiveDecision;

    if (completedPhase === 'gather' && entropy < skipThreshold) {
      if (canSkipTo('vote')) {
        const skipped = remainingPhases.slice(0, remainingPhases.indexOf('vote'));
        decision = {
          action: 'skip-to-vote',
          reason: `Providers already agree (entropy ${entropy.toFixed(3)})`,
          entropy,
          skipPhases: skipped,
        };
      } else if (canSkipTo('synthesize')) {
        const skipped = remainingPhases.slice(0, remainingPhases.indexOf('synthesize'));
        decision = {
          action: 'skip-to-synthesize',
          reason: `Providers already agree (entropy ${entropy.toFixed(3)})`,
          entropy,
          skipPhases: skipped,
        };
      } else {
        decision = {
          action: 'continue',
          reason: `Low entropy but cannot skip protected phases`,
          entropy,
        };
      }
    } else if (completedPhase === 'debate') {
      if (entropy < skipThreshold + 0.1) {
        if (canSkipTo('vote')) {
          const skipped = remainingPhases.slice(0, remainingPhases.indexOf('vote'));
          decision = {
            action: 'skip-to-vote',
            reason: `Low disagreement after debate (entropy ${entropy.toFixed(3)})`,
            entropy,
            skipPhases: skipped,
          };
        } else {
          decision = {
            action: 'continue',
            reason: `Low entropy but cannot skip protected phases`,
            entropy,
          };
        }
      } else if (entropy > addRoundThreshold && this.extraRoundsUsed < maxExtraRounds) {
        this.extraRoundsUsed++;
        decision = {
          action: 'add-round',
          reason: `High disagreement, adding debate round (entropy ${entropy.toFixed(3)})`,
          entropy,
          extraPhase: 'debate',
        };
      } else {
        decision = {
          action: 'continue',
          reason: `Entropy ${entropy.toFixed(3)} within normal range`,
          entropy,
        };
      }
    } else if (completedPhase === 'adjust') {
      if (entropy > addRoundThreshold - 0.1 && this.extraRoundsUsed < maxExtraRounds) {
        this.extraRoundsUsed++;
        decision = {
          action: 'add-round',
          reason: `Still high disagreement after adjustment (entropy ${entropy.toFixed(3)})`,
          entropy,
          extraPhase: 'rebuttal',
        };
      } else {
        decision = {
          action: 'continue',
          reason: `Entropy ${entropy.toFixed(3)} acceptable after adjustment`,
          entropy,
        };
      }
    } else {
      decision = {
        action: 'continue',
        reason: `Phase ${completedPhase} complete (entropy ${entropy.toFixed(3)})`,
        entropy,
      };
    }

    this.decisions.push(decision);
    return decision;
  }

  getDecisions(): AdaptiveDecision[] {
    return [...this.decisions];
  }

  getEntropyHistory(): Record<string, number> {
    return { ...this.phaseEntropies };
  }
}

// ─── Stats Persistence ───────────────────────────────────────────────────────

function emptyStats(): AdaptiveStats {
  return {
    totalSessions: 0,
    phaseSkips: {},
    extraRounds: {},
    providerPairEntropy: {},
    lastUpdated: Date.now(),
  };
}

export async function loadAdaptiveStats(): Promise<AdaptiveStats> {
  try {
    const raw = await readFile(STATS_PATH, 'utf-8');
    return JSON.parse(raw) as AdaptiveStats;
  } catch {
    return emptyStats();
  }
}

export async function saveAdaptiveStats(stats: AdaptiveStats): Promise<void> {
  const dir = join(homedir(), '.quorum');
  await mkdir(dir, { recursive: true });
  stats.lastUpdated = Date.now();
  await writeFile(STATS_PATH, JSON.stringify(stats, null, 2), 'utf-8');
}

export async function recordOutcome(
  decisions: AdaptiveDecision[],
  confidence: number,
  providers: string[],
): Promise<void> {
  const stats = await loadAdaptiveStats();
  stats.totalSessions++;

  for (const d of decisions) {
    if (d.action === 'skip-to-vote' || d.action === 'skip-to-synthesize') {
      const key = d.action;
      if (!stats.phaseSkips[key]) {
        stats.phaseSkips[key] = { count: 0, totalConfidence: 0, avgConfidence: 0 };
      }
      const s = stats.phaseSkips[key];
      s.count++;
      s.totalConfidence += confidence;
      s.avgConfidence = s.totalConfidence / s.count;
    }

    if (d.action === 'add-round' && d.extraPhase) {
      const key = d.extraPhase;
      if (!stats.extraRounds[key]) {
        stats.extraRounds[key] = { count: 0, totalConfidence: 0, avgConfidence: 0 };
      }
      const s = stats.extraRounds[key];
      s.count++;
      s.totalConfidence += confidence;
      s.avgConfidence = s.totalConfidence / s.count;
    }
  }

  // Record provider pair entropy
  const avgEntropy =
    decisions.length > 0 ? decisions.reduce((sum, d) => sum + d.entropy, 0) / decisions.length : 0;

  const sortedProviders = [...providers].sort();
  for (let i = 0; i < sortedProviders.length; i++) {
    for (let j = i + 1; j < sortedProviders.length; j++) {
      const key = `${sortedProviders[i]}:${sortedProviders[j]}`;
      if (!stats.providerPairEntropy[key]) {
        stats.providerPairEntropy[key] = { count: 0, totalEntropy: 0, avgEntropy: 0 };
      }
      const s = stats.providerPairEntropy[key];
      s.count++;
      s.totalEntropy += avgEntropy;
      s.avgEntropy = s.totalEntropy / s.count;
    }
  }

  await saveAdaptiveStats(stats);
}

export function getLearnedAdjustments(stats: AdaptiveStats): {
  skipAdjust: number;
  addRoundAdjust: number;
} {
  let skipAdjust = 0;
  let addRoundAdjust = 0;

  // Analyze skip decisions
  const skipEntries = Object.values(stats.phaseSkips);
  if (skipEntries.length > 0) {
    const totalCount = skipEntries.reduce((s, e) => s + e.count, 0);
    const weightedAvg = skipEntries.reduce((s, e) => s + e.totalConfidence, 0) / totalCount;
    if (weightedAvg > 0.7) skipAdjust = 0.05;
    else if (weightedAvg < 0.5) skipAdjust = -0.05;
  }

  // Analyze add-round decisions
  const roundEntries = Object.values(stats.extraRounds);
  if (roundEntries.length > 0) {
    const totalCount = roundEntries.reduce((s, e) => s + e.count, 0);
    const weightedAvg = roundEntries.reduce((s, e) => s + e.totalConfidence, 0) / totalCount;
    if (weightedAvg > 0.7) addRoundAdjust = 0.05;
    else if (weightedAvg < 0.5) addRoundAdjust = -0.05;
  }

  return { skipAdjust, addRoundAdjust };
}
