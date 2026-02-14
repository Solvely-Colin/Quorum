import { describe, it, expect } from 'vitest';
import { BUILTIN_SCHEMAS, LEGAL_SCHEMA, TECHNICAL_REVIEW_SCHEMA, RISK_ASSESSMENT_SCHEMA } from './builtin-schemas.js';
import { validateSchema } from './schema.js';

describe('builtin-schemas', () => {
  it('has 3 built-in schemas', () => {
    expect(BUILTIN_SCHEMAS).toHaveLength(3);
  });

  for (const schema of [LEGAL_SCHEMA, TECHNICAL_REVIEW_SCHEMA, RISK_ASSESSMENT_SCHEMA]) {
    describe(schema.name, () => {
      it('passes validation', () => {
        const result = validateSchema(schema);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('has decomposition steps', () => {
        expect(schema.decompositionSteps.length).toBeGreaterThan(3);
      });

      it('has evidence types', () => {
        expect(schema.evidenceTypes.length).toBeGreaterThan(2);
      });

      it('has inference rules', () => {
        expect(schema.inferenceRules.length).toBeGreaterThan(1);
      });

      it('has valid confidence thresholds', () => {
        expect(schema.confidenceThresholds.high).toBeGreaterThan(schema.confidenceThresholds.medium);
        expect(schema.confidenceThresholds.medium).toBeGreaterThan(schema.confidenceThresholds.low);
      });
    });
  }
});
