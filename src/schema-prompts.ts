/**
 * Schema-Guided Prompts — inject schema structure into deliberation phase prompts.
 */

import type { ReasoningSchema } from './schema.js';

/**
 * Build schema context to inject into system prompts for GATHER and PLAN phases.
 */
export function buildSchemaContext(schema: ReasoningSchema, phase: 'gather' | 'plan'): string {
  const parts: string[] = [];

  parts.push(`\n\n--- Reasoning Schema: "${schema.name}" ---`);
  parts.push(schema.description);

  if (phase === 'gather') {
    parts.push('\nFollow these decomposition steps in your analysis:');
    for (let i = 0; i < schema.decompositionSteps.length; i++) {
      parts.push(`  ${i + 1}. ${schema.decompositionSteps[i]}`);
    }

    parts.push('\nPrioritize these evidence types (by weight):');
    const sorted = [...schema.evidenceTypes].sort((a, b) => b.weight - a.weight);
    for (const et of sorted) {
      parts.push(`  • ${et.name} (weight: ${et.weight}) — ${et.description}`);
    }
  }

  if (phase === 'plan') {
    parts.push('\nApply these inference rules when forming your argument strategy:');
    for (const rule of schema.inferenceRules) {
      parts.push(`  • ${rule.name}: ${rule.description}`);
      parts.push(`    When: ${rule.condition}`);
      parts.push(`    Then: ${rule.conclusion}`);
    }

    parts.push(
      `\nConfidence thresholds: high=${schema.confidenceThresholds.high}, medium=${schema.confidenceThresholds.medium}, low=${schema.confidenceThresholds.low}`,
    );
    parts.push('Calibrate your confidence claims against these thresholds.');
  }

  parts.push('--- End Schema ---\n');

  return parts.join('\n');
}
