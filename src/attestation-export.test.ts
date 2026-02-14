import { describe, it, expect } from 'vitest';
import { exportAttestationHTML, exportAttestationPDF, type ExportData } from './attestation-export.js';

describe('attestation-export', () => {
  const sampleData: ExportData = {
    chain: {
      version: 1,
      sessionId: 'test-session-123',
      createdAt: 1700000000000,
      records: [
        {
          phase: 'GATHER',
          inputsHash: 'ih1',
          outputsHash: 'oh1',
          providerId: 'multi',
          timestamp: 1700000000000,
          previousAttestationHash: null,
          hash: 'hash-gather-abc123def456',
        },
        {
          phase: 'DEBATE',
          inputsHash: 'ih2',
          outputsHash: 'oh2',
          providerId: 'multi',
          timestamp: 1700000001000,
          previousAttestationHash: 'hash-gather-abc123def456',
          hash: 'hash-debate-xyz789',
        },
      ],
    },
    meta: {
      input: 'What is the meaning of life?',
      profile: 'default',
      providers: [{ name: 'claude' }, { name: 'openai' }],
      startedAt: 1700000000000,
    },
    votes: {
      winner: 'claude',
      rankings: [
        { provider: 'claude', score: 10 },
        { provider: 'openai', score: 8 },
      ],
      controversial: false,
    },
    interventions: [
      {
        type: 'halt',
        phase: 'DEBATE',
        timestamp: 1700000001500,
        content: 'Need more context',
        hash: 'intervention-hash-123',
      },
    ],
    uncertainty: {
      disagreementScore: 0.2,
      positionDrift: 0.1,
      evidenceConflictCount: 1,
      noveltyFlag: false,
      overallUncertainty: 'low',
      summary: 'Low uncertainty.',
    },
  };

  describe('exportAttestationHTML', () => {
    it('generates valid HTML with all sections', () => {
      const html = exportAttestationHTML(sampleData);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('test-session-123');
      expect(html).toContain('GATHER');
      expect(html).toContain('DEBATE');
      expect(html).toContain('claude');
      expect(html).toContain('Vote Results');
      expect(html).toContain('Need more context');
      expect(html).toContain('Uncertainty Metrics');
      expect(html).toContain('LOW');
    });

    it('handles missing optional sections', () => {
      const minimal: ExportData = {
        chain: { version: 1, sessionId: 's1', createdAt: 1000, records: [] },
        meta: { input: 'test', profile: 'default', providers: [], startedAt: 1000 },
        interventions: [],
        uncertainty: null,
      };
      const html = exportAttestationHTML(minimal);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).not.toContain('Vote Results');
      expect(html).not.toContain('Interventions');
    });
  });

  describe('exportAttestationPDF', () => {
    it('generates a PDF buffer', async () => {
      const pdf = await exportAttestationPDF(sampleData);
      expect(pdf).toBeInstanceOf(Uint8Array);
      expect(pdf.length).toBeGreaterThan(100);
      // PDF magic bytes
      const header = new TextDecoder().decode(pdf.slice(0, 5));
      expect(header).toBe('%PDF-');
    });

    it('generates PDF for minimal data', async () => {
      const minimal: ExportData = {
        chain: { version: 1, sessionId: 's1', createdAt: 1000, records: [] },
        meta: { input: 'test', profile: 'default', providers: [], startedAt: 1000 },
        interventions: [],
        uncertainty: null,
      };
      const pdf = await exportAttestationPDF(minimal);
      expect(pdf).toBeInstanceOf(Uint8Array);
      expect(pdf.length).toBeGreaterThan(100);
    });
  });
});
