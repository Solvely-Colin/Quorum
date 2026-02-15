/**
 * @experimental
 * Policy-as-Code Guardrails — Feature #30
 *
 * Defines rules governing deliberation behavior via YAML policy files.
 * Policies are loaded from ~/.quorum/policies/ and agents/policies/.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { extractTags } from './memory-graph.js';

// --- Types ---

export type PolicyAction = 'block' | 'warn' | 'log' | 'pause';

export type PolicyRuleType =
  | 'min_providers'
  | 'min_consensus'
  | 'min_confidence'
  | 'require_evidence'
  | 'block_providers'
  | 'human_approval'
  | 'max_duration'
  | 'require_red_team'
  | 'input_match';

export interface PolicyRule {
  type: PolicyRuleType;
  value?: number;
  providers?: string[];
  pattern?: string;
  when?: { tags?: string[]; controversial?: boolean };
  action: PolicyAction;
  message?: string;
}

export interface QuorumPolicy {
  name: string;
  version: number;
  rules: PolicyRule[];
}

export interface PolicyViolation {
  rule: PolicyRuleType;
  action: PolicyAction;
  message: string;
}

// --- Options for evaluation ---

export interface PreDeliberationOptions {
  evidence?: boolean | string;
  tags?: string[];
}

export interface PostDeliberationOptions {
  evidence?: boolean | string;
  redTeam?: boolean;
  duration?: number; // seconds
}

export interface PostDeliberationResult {
  consensusScore: number;
  confidenceScore: number;
  controversial: boolean;
  content: string;
}

// --- Loading ---

async function loadYamlDir(dir: string): Promise<QuorumPolicy[]> {
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const policies: QuorumPolicy[] = [];
  for (const f of files) {
    if (!/\.ya?ml$/i.test(f)) continue;
    try {
      const raw = await readFile(join(dir, f), 'utf-8');
      const parsed = parseYaml(raw) as QuorumPolicy;
      if (parsed && parsed.name && Array.isArray(parsed.rules)) {
        policies.push(parsed);
      }
    } catch {
      // skip invalid files
    }
  }
  return policies;
}

export async function loadPolicies(): Promise<QuorumPolicy[]> {
  const dirs = [join(homedir(), '.quorum', 'policies'), join(process.cwd(), 'agents', 'policies')];
  const all: QuorumPolicy[] = [];
  for (const dir of dirs) {
    all.push(...(await loadYamlDir(dir)));
  }
  // Deduplicate by name (last wins)
  const map = new Map<string, QuorumPolicy>();
  for (const p of all) map.set(p.name, p);
  return Array.from(map.values());
}

// --- Pre-deliberation evaluation ---

export function evaluatePreDeliberation(
  policy: QuorumPolicy,
  input: string,
  providers: string[],
  options: PreDeliberationOptions = {},
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const tags = options.tags ?? extractTags(input);

  for (const rule of policy.rules) {
    switch (rule.type) {
      case 'min_providers': {
        if (rule.value !== undefined && providers.length < rule.value) {
          violations.push({
            rule: rule.type,
            action: rule.action,
            message:
              rule.message ?? `Minimum ${rule.value} providers required, got ${providers.length}`,
          });
        }
        break;
      }
      case 'block_providers': {
        if (rule.providers) {
          const blocked = providers.filter((p) => rule.providers!.includes(p));
          if (blocked.length > 0) {
            violations.push({
              rule: rule.type,
              action: rule.action,
              message: rule.message ?? `Blocked providers detected: ${blocked.join(', ')}`,
            });
          }
        }
        break;
      }
      case 'require_evidence': {
        const whenTags = rule.when?.tags ?? [];
        const matches = whenTags.length === 0 || whenTags.some((t) => tags.includes(t));
        if (matches && (!options.evidence || options.evidence === 'off')) {
          violations.push({
            rule: rule.type,
            action: rule.action,
            message: rule.message ?? 'Evidence mode required for this topic',
          });
        }
        break;
      }
      case 'input_match': {
        if (rule.pattern) {
          const re = new RegExp(rule.pattern, 'i');
          if (re.test(input)) {
            violations.push({
              rule: rule.type,
              action: rule.action,
              message: rule.message ?? `Input matches sensitive pattern: ${rule.pattern}`,
            });
          }
        }
        break;
      }
      // Other rules are post-deliberation
    }
  }

  return violations;
}

// --- Post-deliberation evaluation ---

export function evaluatePostDeliberation(
  policy: QuorumPolicy,
  result: PostDeliberationResult,
  tags: string[],
  options: PostDeliberationOptions = {},
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const rule of policy.rules) {
    switch (rule.type) {
      case 'min_consensus': {
        if (rule.value !== undefined && result.consensusScore < rule.value) {
          violations.push({
            rule: rule.type,
            action: rule.action,
            message:
              rule.message ?? `Consensus ${result.consensusScore} below minimum ${rule.value}`,
          });
        }
        break;
      }
      case 'min_confidence': {
        if (rule.value !== undefined && result.confidenceScore < rule.value) {
          violations.push({
            rule: rule.type,
            action: rule.action,
            message:
              rule.message ?? `Confidence ${result.confidenceScore} below minimum ${rule.value}`,
          });
        }
        break;
      }
      case 'human_approval': {
        const needsApproval = (rule.when?.controversial && result.controversial) || !rule.when; // no condition = always
        if (needsApproval) {
          violations.push({
            rule: rule.type,
            action: rule.action,
            message: rule.message ?? 'Human approval required',
          });
        }
        break;
      }
      case 'max_duration': {
        if (
          rule.value !== undefined &&
          options.duration !== undefined &&
          options.duration > rule.value
        ) {
          violations.push({
            rule: rule.type,
            action: rule.action,
            message:
              rule.message ?? `Deliberation took ${options.duration}s, max is ${rule.value}s`,
          });
        }
        break;
      }
      case 'require_red_team': {
        const whenTags = rule.when?.tags ?? [];
        const matches = whenTags.length === 0 || whenTags.some((t) => tags.includes(t));
        if (matches && !options.redTeam) {
          violations.push({
            rule: rule.type,
            action: rule.action,
            message: rule.message ?? 'Red-team analysis required for this topic',
          });
        }
        break;
      }
      // Pre-deliberation rules handled elsewhere
    }
  }

  return violations;
}

// --- Helpers ---

export function formatViolations(violations: PolicyViolation[]): string {
  if (violations.length === 0) return 'No policy violations.';
  return violations.map((v) => `[${v.action.toUpperCase()}] ${v.rule}: ${v.message}`).join('\n');
}

export function shouldBlock(violations: PolicyViolation[]): boolean {
  return violations.some((v) => v.action === 'block');
}

export function shouldPause(violations: PolicyViolation[]): boolean {
  return violations.some((v) => v.action === 'pause');
}

// --- Validation ---

const VALID_RULE_TYPES: PolicyRuleType[] = [
  'min_providers',
  'min_consensus',
  'min_confidence',
  'require_evidence',
  'block_providers',
  'human_approval',
  'max_duration',
  'require_red_team',
  'input_match',
];
const VALID_ACTIONS: PolicyAction[] = ['block', 'warn', 'log', 'pause'];

export function validatePolicy(policy: unknown): string[] {
  const errors: string[] = [];
  if (!policy || typeof policy !== 'object') {
    return ['Policy must be an object'];
  }
  const p = policy as Record<string, unknown>;
  if (!p.name || typeof p.name !== 'string') errors.push('Missing or invalid "name"');
  if (!p.version || typeof p.version !== 'number') errors.push('Missing or invalid "version"');
  if (!Array.isArray(p.rules)) {
    errors.push('Missing or invalid "rules" array');
    return errors;
  }
  for (let i = 0; i < p.rules.length; i++) {
    const r = p.rules[i] as Record<string, unknown>;
    if (!VALID_RULE_TYPES.includes(r.type as PolicyRuleType)) {
      errors.push(`Rule ${i}: invalid type "${r.type}"`);
    }
    if (!VALID_ACTIONS.includes(r.action as PolicyAction)) {
      errors.push(`Rule ${i}: invalid action "${r.action}"`);
    }
  }
  return errors;
}
