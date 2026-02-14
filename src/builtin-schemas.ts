/**
 * Built-in Domain Schemas — ship default schemas for common use cases.
 */

import type { ReasoningSchema } from './schema.js';

export const LEGAL_SCHEMA: ReasoningSchema = {
  name: 'legal',
  version: 1,
  description:
    'Legal analysis: issue spotting, precedent, statutory interpretation, risk assessment.',
  decompositionSteps: [
    'Identify the legal issues and questions presented',
    'Determine applicable jurisdiction and governing law',
    'Spot relevant precedent and case law',
    'Analyze statutory text and legislative intent',
    'Evaluate competing interpretations and arguments',
    'Assess legal risks and potential outcomes',
    'Consider policy implications and practical effects',
  ],
  evidenceTypes: [
    {
      name: 'statutory-text',
      description: 'Direct language from statutes, regulations, or codes',
      weight: 0.95,
    },
    { name: 'case-law', description: 'Judicial decisions and precedent', weight: 0.9 },
    {
      name: 'legislative-history',
      description: 'Committee reports, floor debates, intent signals',
      weight: 0.6,
    },
    { name: 'legal-scholarship', description: 'Law review articles and treatises', weight: 0.5 },
    {
      name: 'regulatory-guidance',
      description: 'Agency interpretations and advisory opinions',
      weight: 0.7,
    },
  ],
  inferenceRules: [
    {
      name: 'binding-precedent',
      description: 'Higher court decisions in same jurisdiction are controlling',
      condition: 'Binding precedent exists on point',
      conclusion: 'Follow the precedent unless distinguishable on facts',
    },
    {
      name: 'plain-meaning',
      description: 'Statutory text is clear and unambiguous',
      condition: 'Statutory language has a plain, ordinary meaning',
      conclusion: 'Apply the plain meaning; do not resort to extrinsic aids',
    },
    {
      name: 'risk-balancing',
      description: 'Competing legal risks require balancing',
      condition: 'Multiple legal theories apply with different risk profiles',
      conclusion: 'Present risk matrix with likelihood and severity for each theory',
    },
  ],
  confidenceThresholds: { high: 0.85, medium: 0.55, low: 0.3 },
  createdAt: 0,
  updatedAt: 0,
};

export const TECHNICAL_REVIEW_SCHEMA: ReasoningSchema = {
  name: 'technical-review',
  version: 1,
  description: 'Code/architecture review: correctness, performance, security, maintainability.',
  decompositionSteps: [
    'Understand the purpose and context of the code/architecture',
    'Verify correctness: logic errors, edge cases, error handling',
    'Evaluate performance: complexity, resource usage, scalability',
    'Assess security: input validation, authentication, data protection',
    'Review maintainability: readability, modularity, documentation',
    'Check compatibility: API contracts, backward compatibility, dependencies',
    'Identify testing gaps and suggest improvements',
  ],
  evidenceTypes: [
    {
      name: 'code-analysis',
      description: 'Direct examination of source code and logic',
      weight: 0.95,
    },
    {
      name: 'benchmark-data',
      description: 'Performance measurements and profiling results',
      weight: 0.85,
    },
    {
      name: 'security-audit',
      description: 'Known vulnerability patterns and CVE references',
      weight: 0.9,
    },
    { name: 'best-practices', description: 'Industry standards and design patterns', weight: 0.7 },
    { name: 'test-coverage', description: 'Existing test results and coverage data', weight: 0.75 },
  ],
  inferenceRules: [
    {
      name: 'security-critical',
      description: 'Security issues take priority over feature concerns',
      condition: 'A security vulnerability is identified',
      conclusion: 'Flag as high priority; recommend immediate fix before merge',
    },
    {
      name: 'complexity-threshold',
      description: 'High complexity suggests refactoring need',
      condition: 'Cyclomatic complexity > 10 or deeply nested logic',
      conclusion: 'Recommend decomposition into smaller, testable units',
    },
    {
      name: 'breaking-change',
      description: 'API changes affect downstream consumers',
      condition: 'Public API signature or behavior changes detected',
      conclusion: 'Require explicit versioning and migration documentation',
    },
  ],
  confidenceThresholds: { high: 0.8, medium: 0.5, low: 0.25 },
  createdAt: 0,
  updatedAt: 0,
};

export const RISK_ASSESSMENT_SCHEMA: ReasoningSchema = {
  name: 'risk-assessment',
  version: 1,
  description: 'Risk analysis: threat identification, likelihood, impact, mitigation strategies.',
  decompositionSteps: [
    'Define the scope and context of the risk assessment',
    'Identify potential threats and hazards',
    'Assess likelihood of each threat materializing',
    'Evaluate potential impact and severity',
    'Map existing controls and their effectiveness',
    'Calculate residual risk after controls',
    'Propose mitigation strategies and contingency plans',
    'Prioritize risks and recommend action items',
  ],
  evidenceTypes: [
    {
      name: 'historical-data',
      description: 'Past incidents, near-misses, and loss data',
      weight: 0.9,
    },
    {
      name: 'threat-intelligence',
      description: 'Current threat landscape and emerging risks',
      weight: 0.85,
    },
    {
      name: 'control-assessment',
      description: 'Evaluation of existing safeguards and their effectiveness',
      weight: 0.8,
    },
    { name: 'expert-judgment', description: 'Domain expert risk estimations', weight: 0.7 },
    {
      name: 'industry-benchmarks',
      description: 'Comparable organization risk profiles and standards',
      weight: 0.6,
    },
  ],
  inferenceRules: [
    {
      name: 'critical-risk',
      description: 'High likelihood + high impact = critical risk',
      condition: 'Risk likelihood >= 0.7 AND impact severity >= 0.7',
      conclusion: 'Classify as critical; require immediate mitigation plan and executive attention',
    },
    {
      name: 'control-gap',
      description: 'Missing controls for identified threats',
      condition: 'Threat identified with no corresponding control',
      conclusion: 'Flag as control gap; prioritize control implementation',
    },
    {
      name: 'residual-acceptance',
      description: 'Residual risk within tolerance after controls',
      condition: 'Residual risk score < risk appetite threshold',
      conclusion: 'Accept risk with monitoring; document in risk register',
    },
  ],
  confidenceThresholds: { high: 0.75, medium: 0.45, low: 0.2 },
  createdAt: 0,
  updatedAt: 0,
};

export const BUILTIN_SCHEMAS: ReasoningSchema[] = [
  LEGAL_SCHEMA,
  TECHNICAL_REVIEW_SCHEMA,
  RISK_ASSESSMENT_SCHEMA,
];
