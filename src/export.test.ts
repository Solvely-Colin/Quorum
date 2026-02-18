import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportMarkdown, exportHtml, exportJson } from './export.js';

function createTestSession(dir: string) {
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      input: 'What is the best programming language?',
      profile: 'default',
      providers: [
        { name: 'claude', provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        { name: 'gpt', provider: 'openai', model: 'gpt-4o' },
      ],
      startedAt: 1700000000000,
    }),
  );

  writeFileSync(
    join(dir, '01-gather.json'),
    JSON.stringify({
      phase: 'gather',
      timestamp: 1700000001000,
      duration: 3200,
      responses: {
        claude: 'Rust is excellent for systems programming.',
        gpt: 'Python is great for productivity.',
      },
    }),
  );

  writeFileSync(
    join(dir, '04-debate.json'),
    JSON.stringify({
      phase: 'debate',
      timestamp: 1700000010000,
      duration: 5100,
      responses: {
        claude: 'While Python is productive, Rust prevents entire classes of bugs.',
        gpt: 'Python ecosystem is unmatched for ML and data science.',
      },
    }),
  );

  writeFileSync(
    join(dir, '07-vote.json'),
    JSON.stringify({
      phase: 'vote',
      timestamp: 1700000020000,
      duration: 2000,
      responses: {
        claude: '1. Rust 2. Python',
        gpt: '1. Python 2. Rust',
      },
    }),
  );

  writeFileSync(
    join(dir, 'synthesis.json'),
    JSON.stringify({
      content: 'Both languages excel in different domains.',
      synthesizer: 'claude',
      consensusScore: 0.7,
      confidenceScore: 0.85,
      controversial: false,
      minorityReport: 'None',
      contributions: {},
    }),
  );
}

describe('export', () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'quorum-export-test-'));
    createTestSession(sessionDir);
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  describe('exportMarkdown', () => {
    it('includes header with question and providers', () => {
      const md = exportMarkdown(sessionDir);
      expect(md).toContain('# Deliberation Report');
      expect(md).toContain('What is the best programming language?');
      expect(md).toContain('claude');
      expect(md).toContain('gpt');
    });

    it('includes phase responses', () => {
      const md = exportMarkdown(sessionDir);
      expect(md).toContain('## Gather');
      expect(md).toContain('Rust is excellent for systems programming.');
      expect(md).toContain('Python is great for productivity.');
    });

    it('includes vote section', () => {
      const md = exportMarkdown(sessionDir);
      expect(md).toContain('## Vote');
    });

    it('includes synthesis', () => {
      const md = exportMarkdown(sessionDir);
      expect(md).toContain('## Synthesis');
      expect(md).toContain('Both languages excel in different domains.');
      expect(md).toContain('Consensus Score');
    });
  });

  describe('exportJson', () => {
    it('returns valid JSON with meta, phases, and synthesis', () => {
      const raw = exportJson(sessionDir);
      const data = JSON.parse(raw);
      expect(data.meta).toBeDefined();
      expect(data.meta.input).toBe('What is the best programming language?');
      expect(data.phases.gather).toBeDefined();
      expect(data.phases.debate).toBeDefined();
      expect(data.phases.vote).toBeDefined();
      expect(data.synthesis).toBeDefined();
      expect(data.synthesis.consensusScore).toBe(0.7);
    });

    it('includes provider responses in phases', () => {
      const data = JSON.parse(exportJson(sessionDir));
      expect(data.phases.gather.responses.claude).toContain('Rust');
      expect(data.phases.gather.responses.gpt).toContain('Python');
    });
  });

  describe('exportHtml', () => {
    it('returns valid self-contained HTML', () => {
      const html = exportHtml(sessionDir);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<style>');
      expect(html).toContain('</html>');
    });

    it('includes question and providers', () => {
      const html = exportHtml(sessionDir);
      expect(html).toContain('What is the best programming language?');
      expect(html).toContain('claude');
      expect(html).toContain('gpt');
    });

    it('includes synthesis section', () => {
      const html = exportHtml(sessionDir);
      expect(html).toContain('Synthesis');
      expect(html).toContain('Both languages excel in different domains.');
    });

    it('uses dark theme CSS', () => {
      const html = exportHtml(sessionDir);
      expect(html).toContain('prefers-color-scheme: dark');
    });
  });

  describe('missing data', () => {
    it('handles session with only meta', () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'quorum-export-empty-'));
      writeFileSync(
        join(emptyDir, 'meta.json'),
        JSON.stringify({
          input: 'Test',
          profile: 'default',
          providers: [],
          startedAt: 1700000000000,
        }),
      );
      const md = exportMarkdown(emptyDir);
      expect(md).toContain('# Deliberation Report');
      expect(md).toContain('Test');

      const json = JSON.parse(exportJson(emptyDir));
      expect(json.meta.input).toBe('Test');
      expect(json.synthesis).toBeNull();

      rmSync(emptyDir, { recursive: true, force: true });
    });
  });
});
