/**
 * Risk Tier Classification — Feature #31
 *
 * Classifies deliberation results into risk tiers based on
 * consensus score, confidence score, dissent severity, and provider agreement.
 * Each tier maps to an action: auto-approve, warn, checkpoint, or block.
 */

// --- Types ---

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export type TierAction = 'auto-approve' | 'warn' | 'checkpoint' | 'block';

export interface RiskThresholds {
  /** Consensus score below this is risky (0-1) */
  consensusMin: number;
  /** Confidence score below this is risky (0-1) */
  confidenceMin: number;
  /** Dissent severity above this is risky (0-1) */
  dissentMax: number;
  /** Minimum provider agreement ratio (0-1) */
  providerAgreementMin: number;
}

export interface TierConfig {
  thresholds: RiskThresholds;
  action: TierAction;
  description: string;
}

export interface PolicyConfig {
  version: number;
  defaultAction: TierAction;
  tiers: Record<RiskTier, TierConfig>;
}

export interface RiskAssessment {
  tier: RiskTier;
  action: TierAction;
  scores: {
    consensus: number;
    confidence: number;
    dissentSeverity: number;
    providerAgreement: number;
  };
  reasons: string[];
  description: string;
}

export interface DeliberationInput {
  consensusScore: number;
  confidenceScore: number;
  controversial: boolean;
  rankings: Array<{ provider: string; score: number }>;
  minorityReport?: string;
}

// --- Default Policy ---

export const DEFAULT_POLICY: PolicyConfig = {
  version: 1,
  defaultAction: 'warn',
  tiers: {
    low: {
      thresholds: {
        consensusMin: 0.8,
        confidenceMin: 0.8,
        dissentMax: 0.2,
        providerAgreementMin: 0.8,
      },
      action: 'auto-approve',
      description: 'Strong consensus — advisory only',
    },
    medium: {
      thresholds: {
        consensusMin: 0.6,
        confidenceMin: 0.6,
        dissentMax: 0.4,
        providerAgreementMin: 0.6,
      },
      action: 'warn',
      description: 'Moderate agreement — surface dissent',
    },
    high: {
      thresholds: {
        consensusMin: 0.4,
        confidenceMin: 0.4,
        dissentMax: 0.6,
        providerAgreementMin: 0.4,
      },
      action: 'checkpoint',
      description: 'Low agreement — human review recommended',
    },
    critical: {
      thresholds: {
        consensusMin: 0.0,
        confidenceMin: 0.0,
        dissentMax: 1.0,
        providerAgreementMin: 0.0,
      },
      action: 'block',
      description: 'Critical disagreement — escalation required',
    },
  },
};

// --- Scoring ---

/**
 * Compute provider agreement ratio from rankings.
 * Measures how close the top scores are relative to the winner.
 */
export function computeProviderAgreement(
  rankings: Array<{ provider: string; score: number }>,
): number {
  if (rankings.length < 2) return 1.0;
  const sorted = [...rankings].sort((a, b) => b.score - a.score);
  const topScore = sorted[0].score;
  if (topScore === 0) return 0;

  // Ratio of scores that are within 20% of top score
  const agreeing = sorted.filter((r) => r.score >= topScore * 0.8).length;
  return agreeing / sorted.length;
}

/**
 * Compute dissent severity from minority report and controversy flag.
 * Returns 0-1 scale.
 */
export function computeDissentSeverity(controversial: boolean, minorityReport?: string): number {
  let severity = 0;

  if (controversial) severity += 0.4;

  if (minorityReport && minorityReport.trim() && minorityReport.toLowerCase() !== 'none') {
    // Longer minority reports indicate more dissent
    const wordCount = minorityReport.split(/\s+/).length;
    severity += Math.min(0.6, wordCount / 200);
  }

  return Math.min(1.0, severity);
}

/**
 * Classify a deliberation result into a risk tier.
 */
export function classifyRisk(
  input: DeliberationInput,
  policy: PolicyConfig = DEFAULT_POLICY,
): RiskAssessment {
  const providerAgreement = computeProviderAgreement(input.rankings);
  const dissentSeverity = computeDissentSeverity(input.controversial, input.minorityReport);

  const scores = {
    consensus: input.consensusScore,
    confidence: input.confidenceScore,
    dissentSeverity,
    providerAgreement,
  };

  const reasons: string[] = [];

  // Check tiers from best to worst
  const tierOrder: RiskTier[] = ['low', 'medium', 'high', 'critical'];

  for (const tierName of tierOrder) {
    const tier = policy.tiers[tierName];
    const t = tier.thresholds;

    const meetsConsensus = scores.consensus >= t.consensusMin;
    const meetsConfidence = scores.confidence >= t.confidenceMin;
    const meetsDissent = scores.dissentSeverity <= t.dissentMax;
    const meetsAgreement = scores.providerAgreement >= t.providerAgreementMin;

    if (meetsConsensus && meetsConfidence && meetsDissent && meetsAgreement) {
      if (!meetsConsensus) reasons.push(`Consensus ${scores.consensus} below ${t.consensusMin}`);
      if (!meetsConfidence)
        reasons.push(`Confidence ${scores.confidence} below ${t.confidenceMin}`);
      if (!meetsDissent) reasons.push(`Dissent ${scores.dissentSeverity} above ${t.dissentMax}`);
      if (!meetsAgreement)
        reasons.push(
          `Provider agreement ${scores.providerAgreement} below ${t.providerAgreementMin}`,
        );

      return {
        tier: tierName,
        action: tier.action,
        scores,
        reasons,
        description: tier.description,
      };
    }

    // Collect reasons why this tier wasn't met
    if (!meetsConsensus)
      reasons.push(`Consensus ${scores.consensus.toFixed(2)} below ${t.consensusMin}`);
    if (!meetsConfidence)
      reasons.push(`Confidence ${scores.confidence.toFixed(2)} below ${t.confidenceMin}`);
    if (!meetsDissent)
      reasons.push(`Dissent severity ${scores.dissentSeverity.toFixed(2)} above ${t.dissentMax}`);
    if (!meetsAgreement)
      reasons.push(
        `Provider agreement ${scores.providerAgreement.toFixed(2)} below ${t.providerAgreementMin}`,
      );
  }

  // Fallback to critical
  const criticalTier = policy.tiers.critical;
  return {
    tier: 'critical',
    action: criticalTier.action,
    scores,
    reasons,
    description: criticalTier.description,
  };
}

/**
 * Format a risk assessment for display.
 */
export function formatRiskAssessment(assessment: RiskAssessment): string {
  const icons: Record<RiskTier, string> = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    critical: '🔴',
  };

  const lines = [
    `${icons[assessment.tier]} Risk: ${assessment.tier.toUpperCase()} — ${assessment.description}`,
    `  Action: ${assessment.action}`,
    `  Consensus: ${(assessment.scores.consensus * 100).toFixed(0)}% | Confidence: ${(assessment.scores.confidence * 100).toFixed(0)}%`,
    `  Dissent: ${(assessment.scores.dissentSeverity * 100).toFixed(0)}% | Agreement: ${(assessment.scores.providerAgreement * 100).toFixed(0)}%`,
  ];

  if (assessment.reasons.length > 0) {
    lines.push(`  Factors: ${assessment.reasons.join('; ')}`);
  }

  return lines.join('\n');
}
