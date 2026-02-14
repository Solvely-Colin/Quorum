/**
 * Reasoning Schema Foundation — structured schemas for deliberation reasoning.
 * Schemas define problem decomposition, evidence types, inference rules, and thresholds.
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface EvidenceType {
  name: string;
  description: string;
  weight: number; // 0-1
}

export interface InferenceRule {
  name: string;
  description: string;
  /** When to apply this rule */
  condition: string;
  /** What conclusion to draw */
  conclusion: string;
}

export interface ReasoningSchema {
  /** Schema name (unique identifier) */
  name: string;
  /** Schema version */
  version: number;
  /** Human-readable description */
  description: string;
  /** Problem decomposition steps */
  decompositionSteps: string[];
  /** Recognized evidence types with weights */
  evidenceTypes: EvidenceType[];
  /** Inference rules */
  inferenceRules: InferenceRule[];
  /** Confidence thresholds */
  confidenceThresholds: {
    high: number;
    medium: number;
    low: number;
  };
  /** Metadata */
  createdAt: number;
  updatedAt: number;
}

/**
 * The default reasoning schema — generic, applicable to any deliberation.
 */
export const DEFAULT_SCHEMA: ReasoningSchema = {
  name: 'default',
  version: 1,
  description: 'Generic reasoning schema for structured deliberation.',
  decompositionSteps: [
    'Identify the core question and its scope',
    'Enumerate key assumptions and constraints',
    'Break into sub-problems or dimensions',
    'Gather evidence for each sub-problem',
    'Synthesize findings into a coherent position',
    'Identify uncertainties and confidence levels',
  ],
  evidenceTypes: [
    {
      name: 'empirical',
      description: 'Data from experiments, studies, or observations',
      weight: 0.9,
    },
    { name: 'expert-opinion', description: 'Views from recognized domain experts', weight: 0.7 },
    {
      name: 'logical-deduction',
      description: 'Conclusions derived from logical reasoning',
      weight: 0.8,
    },
    { name: 'analogy', description: 'Reasoning from similar cases or domains', weight: 0.5 },
    { name: 'anecdotal', description: 'Individual experiences or case studies', weight: 0.3 },
  ],
  inferenceRules: [
    {
      name: 'majority-agreement',
      description: 'When most providers converge on a position',
      condition: 'consensus score >= 0.7',
      conclusion: 'Position is likely correct; adopt with high confidence',
    },
    {
      name: 'evidence-backed-minority',
      description: 'When a minority position has stronger evidence',
      condition: 'minority evidence score > majority evidence score by 20%+',
      conclusion: 'Flag minority position as potentially correct; investigate further',
    },
    {
      name: 'high-uncertainty',
      description: 'When positions diverge significantly',
      condition: 'disagreement score > 0.6',
      conclusion: 'Present multiple perspectives; avoid definitive conclusions',
    },
  ],
  confidenceThresholds: {
    high: 0.8,
    medium: 0.5,
    low: 0.3,
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/**
 * Get the schemas directory path.
 */
export function getSchemasDir(): string {
  return join(homedir(), '.quorum', 'schemas');
}

/**
 * Ensure the schemas directory exists and has the default schema.
 */
export async function ensureSchemasDir(): Promise<void> {
  const dir = getSchemasDir();
  await mkdir(dir, { recursive: true });

  const defaultPath = join(dir, 'default.json');
  if (!existsSync(defaultPath)) {
    await writeFile(defaultPath, JSON.stringify(DEFAULT_SCHEMA, null, 2), 'utf-8');
  }
}

/**
 * List all available schemas.
 */
export async function listSchemas(): Promise<Array<{ name: string; description: string }>> {
  await ensureSchemasDir();
  const dir = getSchemasDir();
  const files = await readdir(dir);
  const schemas: Array<{ name: string; description: string }> = [];

  for (const f of files.sort()) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(await readFile(join(dir, f), 'utf-8')) as ReasoningSchema;
      schemas.push({ name: data.name, description: data.description });
    } catch {
      /* skip invalid */
    }
  }

  return schemas;
}

/**
 * Load a schema by name.
 */
export async function loadSchema(name: string): Promise<ReasoningSchema | null> {
  await ensureSchemasDir();
  const filepath = join(getSchemasDir(), `${name}.json`);
  if (!existsSync(filepath)) return null;
  return JSON.parse(await readFile(filepath, 'utf-8'));
}

/**
 * Save a schema.
 */
export async function saveSchema(schema: ReasoningSchema): Promise<void> {
  await ensureSchemasDir();
  schema.updatedAt = Date.now();
  const filepath = join(getSchemasDir(), `${schema.name}.json`);
  await writeFile(filepath, JSON.stringify(schema, null, 2), 'utf-8');
}

/**
 * Create a new schema interactively (returns the schema object; caller handles prompts).
 */
export function createSchema(params: {
  name: string;
  description: string;
  decompositionSteps?: string[];
  evidenceTypes?: EvidenceType[];
  inferenceRules?: InferenceRule[];
  confidenceThresholds?: { high: number; medium: number; low: number };
}): ReasoningSchema {
  const now = Date.now();
  return {
    name: params.name,
    version: 1,
    description: params.description,
    decompositionSteps: params.decompositionSteps ?? DEFAULT_SCHEMA.decompositionSteps,
    evidenceTypes: params.evidenceTypes ?? DEFAULT_SCHEMA.evidenceTypes,
    inferenceRules: params.inferenceRules ?? DEFAULT_SCHEMA.inferenceRules,
    confidenceThresholds: params.confidenceThresholds ?? DEFAULT_SCHEMA.confidenceThresholds,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Validate a schema object.
 */
export function validateSchema(schema: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const s = schema as Record<string, unknown>;

  if (!s || typeof s !== 'object') {
    return { valid: false, errors: ['Schema must be an object'] };
  }

  if (!s.name || typeof s.name !== 'string') errors.push('Missing or invalid name');
  if (!s.description || typeof s.description !== 'string')
    errors.push('Missing or invalid description');
  if (!Array.isArray(s.decompositionSteps)) errors.push('Missing decompositionSteps array');
  if (!Array.isArray(s.evidenceTypes)) errors.push('Missing evidenceTypes array');
  if (!Array.isArray(s.inferenceRules)) errors.push('Missing inferenceRules array');

  const thresholds = s.confidenceThresholds as Record<string, number> | undefined;
  if (!thresholds || typeof thresholds !== 'object') {
    errors.push('Missing confidenceThresholds');
  } else {
    for (const key of ['high', 'medium', 'low']) {
      if (typeof thresholds[key] !== 'number' || thresholds[key] < 0 || thresholds[key] > 1) {
        errors.push(`confidenceThresholds.${key} must be a number between 0 and 1`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Format a schema for display.
 */
export function formatSchemaDisplay(schema: ReasoningSchema): string {
  const lines: string[] = [
    `Schema: ${schema.name} (v${schema.version})`,
    `${schema.description}`,
    '',
    'Decomposition Steps:',
    ...schema.decompositionSteps.map((s, i) => `  ${i + 1}. ${s}`),
    '',
    'Evidence Types:',
    ...schema.evidenceTypes.map((e) => `  • ${e.name} (weight: ${e.weight}) — ${e.description}`),
    '',
    'Inference Rules:',
    ...schema.inferenceRules.map((r) => `  • ${r.name}: ${r.description}`),
    '',
    `Confidence Thresholds: high=${schema.confidenceThresholds.high}, medium=${schema.confidenceThresholds.medium}, low=${schema.confidenceThresholds.low}`,
  ];
  return lines.join('\n');
}
