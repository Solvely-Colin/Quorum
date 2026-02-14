import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCHEMA,
  createSchema,
  validateSchema,
  formatSchemaDisplay,
} from './schema.js';

describe('schema', () => {
  describe('DEFAULT_SCHEMA', () => {
    it('has required fields', () => {
      expect(DEFAULT_SCHEMA.name).toBe('default');
      expect(DEFAULT_SCHEMA.version).toBe(1);
      expect(DEFAULT_SCHEMA.decompositionSteps.length).toBeGreaterThan(0);
      expect(DEFAULT_SCHEMA.evidenceTypes.length).toBeGreaterThan(0);
      expect(DEFAULT_SCHEMA.inferenceRules.length).toBeGreaterThan(0);
      expect(DEFAULT_SCHEMA.confidenceThresholds.high).toBeGreaterThan(DEFAULT_SCHEMA.confidenceThresholds.low);
    });
  });

  describe('createSchema', () => {
    it('creates with defaults', () => {
      const s = createSchema({ name: 'test', description: 'A test schema' });
      expect(s.name).toBe('test');
      expect(s.description).toBe('A test schema');
      expect(s.decompositionSteps).toEqual(DEFAULT_SCHEMA.decompositionSteps);
      expect(s.createdAt).toBeGreaterThan(0);
    });

    it('creates with custom fields', () => {
      const s = createSchema({
        name: 'custom',
        description: 'Custom',
        decompositionSteps: ['step1'],
        confidenceThresholds: { high: 0.9, medium: 0.6, low: 0.2 },
      });
      expect(s.decompositionSteps).toEqual(['step1']);
      expect(s.confidenceThresholds.high).toBe(0.9);
    });
  });

  describe('validateSchema', () => {
    it('validates DEFAULT_SCHEMA', () => {
      const result = validateSchema(DEFAULT_SCHEMA);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects missing name', () => {
      const result = validateSchema({ description: 'x', decompositionSteps: [], evidenceTypes: [], inferenceRules: [], confidenceThresholds: { high: 0.8, medium: 0.5, low: 0.3 } });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('name'))).toBe(true);
    });

    it('rejects invalid thresholds', () => {
      const result = validateSchema({
        name: 'test',
        description: 'test',
        decompositionSteps: [],
        evidenceTypes: [],
        inferenceRules: [],
        confidenceThresholds: { high: 2, medium: 0.5, low: 0.3 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('high'))).toBe(true);
    });

    it('rejects non-object', () => {
      const result = validateSchema('not an object');
      expect(result.valid).toBe(false);
    });
  });

  describe('formatSchemaDisplay', () => {
    it('formats schema for display', () => {
      const display = formatSchemaDisplay(DEFAULT_SCHEMA);
      expect(display).toContain('default');
      expect(display).toContain('Decomposition Steps');
      expect(display).toContain('Evidence Types');
      expect(display).toContain('Inference Rules');
    });
  });
});
