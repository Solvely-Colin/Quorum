/**
 * Policy Controls — Feature #31
 *
 * High-level policy configuration using `.quorum/policy.yml`.
 * Defines risk tier thresholds and actions, with init/show/validate commands.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { PolicyConfig, RiskTier, TierAction } from './risk-tier.js';
import { DEFAULT_POLICY } from './risk-tier.js';

// --- Types ---

export interface PolicyFileError {
  path: string;
  message: string;
}

// --- Default YAML content ---

const DEFAULT_POLICY_YAML = `# Quorum Policy Configuration
# See: https://github.com/Solvely-Colin/Quorum#policy-controls
version: 1
defaultAction: warn

tiers:
  low:
    thresholds:
      consensusMin: 0.8
      confidenceMin: 0.8
      dissentMax: 0.2
      providerAgreementMin: 0.8
    action: auto-approve
    description: "Strong consensus — advisory only"

  medium:
    thresholds:
      consensusMin: 0.6
      confidenceMin: 0.6
      dissentMax: 0.4
      providerAgreementMin: 0.6
    action: warn
    description: "Moderate agreement — surface dissent"

  high:
    thresholds:
      consensusMin: 0.4
      confidenceMin: 0.4
      dissentMax: 0.6
      providerAgreementMin: 0.4
    action: checkpoint
    description: "Low agreement — human review recommended"

  critical:
    thresholds:
      consensusMin: 0.0
      confidenceMin: 0.0
      dissentMax: 1.0
      providerAgreementMin: 0.0
    action: block
    description: "Critical disagreement — escalation required"
`;

// --- File Operations ---

/**
 * Get the default policy file path (.quorum/policy.yml in cwd).
 */
export function defaultPolicyPath(): string {
  return join(process.cwd(), '.quorum', 'policy.yml');
}

/**
 * Initialize a default policy file.
 */
export async function initPolicyFile(path?: string): Promise<string> {
  const filePath = path ?? defaultPolicyPath();
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(filePath, DEFAULT_POLICY_YAML, 'utf-8');
  return filePath;
}

/**
 * Load a policy config from a YAML file.
 */
export async function loadPolicyFile(path?: string): Promise<PolicyConfig> {
  const filePath = path ?? defaultPolicyPath();
  if (!existsSync(filePath)) {
    return DEFAULT_POLICY;
  }
  const raw = await readFile(filePath, 'utf-8');
  const parsed = parseYaml(raw) as PolicyConfig;
  return parsed;
}

/**
 * Validate a policy config object. Returns errors (empty = valid).
 */
export function validatePolicyConfig(config: unknown): string[] {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return ['Policy must be an object'];
  }

  const c = config as Record<string, unknown>;

  if (typeof c.version !== 'number') {
    errors.push('Missing or invalid "version" (must be a number)');
  }

  const validActions: TierAction[] = ['auto-approve', 'warn', 'checkpoint', 'block'];

  if (c.defaultAction && !validActions.includes(c.defaultAction as TierAction)) {
    errors.push(
      `Invalid "defaultAction": "${c.defaultAction}". Must be one of: ${validActions.join(', ')}`,
    );
  }

  if (!c.tiers || typeof c.tiers !== 'object') {
    errors.push('Missing or invalid "tiers" object');
    return errors;
  }

  const validTiers: RiskTier[] = ['low', 'medium', 'high', 'critical'];
  const tiers = c.tiers as Record<string, unknown>;

  for (const tierName of validTiers) {
    if (!tiers[tierName]) {
      errors.push(`Missing tier: "${tierName}"`);
      continue;
    }

    const tier = tiers[tierName] as Record<string, unknown>;

    if (!tier.thresholds || typeof tier.thresholds !== 'object') {
      errors.push(`Tier "${tierName}": missing or invalid "thresholds"`);
      continue;
    }

    const t = tier.thresholds as Record<string, unknown>;
    for (const key of ['consensusMin', 'confidenceMin', 'dissentMax', 'providerAgreementMin']) {
      if (typeof t[key] !== 'number' || t[key] < 0 || t[key] > 1) {
        errors.push(`Tier "${tierName}": thresholds.${key} must be a number between 0 and 1`);
      }
    }

    if (!validActions.includes(tier.action as TierAction)) {
      errors.push(
        `Tier "${tierName}": invalid action "${tier.action}". Must be one of: ${validActions.join(', ')}`,
      );
    }
  }

  return errors;
}

/**
 * Format a policy config for display.
 */
export function formatPolicyConfig(config: PolicyConfig): string {
  const icons: Record<RiskTier, string> = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    critical: '🔴',
  };

  const lines: string[] = [
    `📋 Policy v${config.version}`,
    `  Default action: ${config.defaultAction}`,
    '',
  ];

  const tierOrder: RiskTier[] = ['low', 'medium', 'high', 'critical'];
  for (const tierName of tierOrder) {
    const tier = config.tiers[tierName];
    if (!tier) continue;
    const t = tier.thresholds;
    lines.push(`  ${icons[tierName]} ${tierName.toUpperCase()}`);
    lines.push(`    Action: ${tier.action}`);
    lines.push(`    ${tier.description}`);
    lines.push(
      `    Consensus ≥ ${t.consensusMin} | Confidence ≥ ${t.confidenceMin} | Dissent ≤ ${t.dissentMax} | Agreement ≥ ${t.providerAgreementMin}`,
    );
    lines.push('');
  }

  return lines.join('\n');
}
