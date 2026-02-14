import { describe, it, expect } from 'vitest';
import { buildSchemaContext } from './schema-prompts.js';
import { DEFAULT_SCHEMA } from './schema.js';
import { LEGAL_SCHEMA, TECHNICAL_REVIEW_SCHEMA } from './builtin-schemas.js';

describe('schema-prompts', () => {
  describe('buildSchemaContext', () => {
    it('includes decomposition steps for gather phase', () => {
      const ctx = buildSchemaContext(DEFAULT_SCHEMA, 'gather');
      expect(ctx).toContain('Reasoning Schema');
      expect(ctx).toContain('decomposition steps');
      for (const step of DEFAULT_SCHEMA.decompositionSteps) {
        expect(ctx).toContain(step);
      }
    });

    it('includes evidence types for gather phase', () => {
      const ctx = buildSchemaContext(DEFAULT_SCHEMA, 'gather');
      expect(ctx).toContain('evidence types');
      for (const et of DEFAULT_SCHEMA.evidenceTypes) {
        expect(ctx).toContain(et.name);
      }
    });

    it('includes inference rules for plan phase', () => {
      const ctx = buildSchemaContext(DEFAULT_SCHEMA, 'plan');
      expect(ctx).toContain('inference rules');
      for (const rule of DEFAULT_SCHEMA.inferenceRules) {
        expect(ctx).toContain(rule.name);
        expect(ctx).toContain(rule.condition);
        expect(ctx).toContain(rule.conclusion);
      }
    });

    it('includes confidence thresholds for plan phase', () => {
      const ctx = buildSchemaContext(DEFAULT_SCHEMA, 'plan');
      expect(ctx).toContain('Confidence thresholds');
      expect(ctx).toContain(String(DEFAULT_SCHEMA.confidenceThresholds.high));
    });

    it('works with legal schema', () => {
      const ctx = buildSchemaContext(LEGAL_SCHEMA, 'gather');
      expect(ctx).toContain('legal');
      expect(ctx).toContain('statutory-text');
      expect(ctx).toContain('case-law');
    });

    it('works with technical-review schema for plan', () => {
      const ctx = buildSchemaContext(TECHNICAL_REVIEW_SCHEMA, 'plan');
      expect(ctx).toContain('security-critical');
      expect(ctx).toContain('complexity-threshold');
    });
  });
});
