import { describe, it, expect } from 'vitest';
import {
  computeVerdict,
  buildCardData,
  renderCompactMarkdown,
  renderDetailedMarkdown,
  renderJson,
  renderHtml,
  renderGitHubAnnotations,
  renderCard,
  generateSummaryCard,
  generateAnnotations,
  type SummaryCardInput,
} from './summary-card.js';

function makeInput(overrides: Partial<SummaryCardInput> = {}): SummaryCardInput {
  return {
    synthesis: {
      content:
        'The code looks solid overall. Security practices are well-implemented. Minor style issues found.',
      synthesizer: 'claude',
      consensusScore: 0.85,
      confidenceScore: 0.9,
      controversial: false,
      minorityReport: 'Ollama disagreed on the naming conventions.',
      contributions: {
        claude: ['security analysis'],
        openai: ['style review'],
      },
    },
    votes: {
      rankings: [
        { provider: 'claude', score: 8 },
        { provider: 'openai', score: 6 },
        { provider: 'ollama', score: 4 },
      ],
      winner: 'claude',
      controversial: false,
      details: {},
    },
    duration: 12500,
    sessionId: 'test-session-123',
    providers: ['claude', 'openai', 'ollama'],
    confidenceThreshold: 0.7,
    sessionUrl: 'https://example.com/session/123',
    ...overrides,
  };
}

describe('computeVerdict', () => {
  it('returns pass for high confidence and consensus', () => {
    expect(computeVerdict(0.9, 0.8, 0.7)).toBe('pass');
  });

  it('returns fail when confidence below threshold', () => {
    expect(computeVerdict(0.3, 0.9, 0.7)).toBe('fail');
  });

  it('returns warn for low consensus', () => {
    expect(computeVerdict(0.8, 0.4, 0.5)).toBe('warn');
  });

  it('returns warn for borderline confidence', () => {
    expect(computeVerdict(0.55, 0.8, 0.5)).toBe('warn');
  });

  it('returns pass with zero threshold', () => {
    expect(computeVerdict(0.1, 0.8, 0)).toBe('warn');
  });
});

describe('buildCardData', () => {
  it('builds card data from input', () => {
    const data = buildCardData(makeInput());
    expect(data.verdict).toBe('pass');
    expect(data.verdictEmoji).toBe('✅');
    expect(data.confidence).toBe(0.9);
    expect(data.consensus).toBe(0.85);
    expect(data.topFinding).toBeTruthy();
    expect(data.dissent).toBe('Ollama disagreed on the naming conventions.');
    expect(data.providerBreakdown).toHaveLength(3);
    expect(data.providerBreakdown[0]!.isWinner).toBe(true);
    expect(data.sessionUrl).toBe('https://example.com/session/123');
  });

  it('handles no dissent', () => {
    const data = buildCardData(
      makeInput({
        synthesis: {
          ...makeInput().synthesis,
          minorityReport: undefined,
        },
      }),
    );
    expect(data.dissent).toBeNull();
  });

  it('handles "None" minority report', () => {
    const data = buildCardData(
      makeInput({
        synthesis: {
          ...makeInput().synthesis,
          minorityReport: 'None',
        },
      }),
    );
    expect(data.dissent).toBeNull();
  });

  it('uses default session URL when not provided', () => {
    const data = buildCardData(
      makeInput({
        sessionUrl: undefined,
      }),
    );
    expect(data.sessionUrl).toContain('test-session-123');
  });
});

describe('renderCompactMarkdown', () => {
  it('stays within 500 char budget', () => {
    const data = buildCardData(makeInput());
    const card = renderCompactMarkdown(data);
    expect(card.length).toBeLessThanOrEqual(500);
  });

  it('includes verdict, confidence, consensus', () => {
    const data = buildCardData(makeInput());
    const card = renderCompactMarkdown(data);
    expect(card).toContain('PASS');
    expect(card).toContain('90%');
    expect(card).toContain('85%');
  });

  it('includes dissent when present', () => {
    const data = buildCardData(makeInput());
    const card = renderCompactMarkdown(data);
    expect(card).toContain('Dissent');
  });

  it('includes provider names', () => {
    const data = buildCardData(makeInput());
    const card = renderCompactMarkdown(data);
    expect(card).toContain('claude');
    expect(card).toContain('👑');
  });

  it('enforces budget with very long content', () => {
    const longContent = 'A'.repeat(300) + '. ' + 'B'.repeat(300) + '.';
    const data = buildCardData(
      makeInput({
        synthesis: {
          ...makeInput().synthesis,
          content: longContent,
          minorityReport: 'C'.repeat(200),
        },
      }),
    );
    const card = renderCompactMarkdown(data);
    expect(card.length).toBeLessThanOrEqual(500);
  });
});

describe('renderDetailedMarkdown', () => {
  it('includes all sections', () => {
    const data = buildCardData(makeInput());
    const card = renderDetailedMarkdown(data);
    expect(card).toContain('## ');
    expect(card).toContain('Top Finding');
    expect(card).toContain('Dissent');
    expect(card).toContain('Provider Breakdown');
    expect(card).toContain('claude');
    expect(card).toContain('👑 Winner');
  });

  it('omits dissent section when none', () => {
    const data = buildCardData(
      makeInput({
        synthesis: { ...makeInput().synthesis, minorityReport: undefined },
      }),
    );
    const card = renderDetailedMarkdown(data);
    expect(card).not.toContain('Dissent');
  });
});

describe('renderJson', () => {
  it('produces valid JSON', () => {
    const data = buildCardData(makeInput());
    const json = renderJson(data);
    const parsed = JSON.parse(json);
    expect(parsed.verdict).toBe('pass');
    expect(parsed.confidence).toBe(0.9);
    expect(parsed.providerBreakdown).toHaveLength(3);
  });
});

describe('renderHtml', () => {
  it('produces HTML with card structure', () => {
    const data = buildCardData(makeInput());
    const html = renderHtml(data);
    expect(html).toContain('<div class="quorum-card">');
    expect(html).toContain('PASS');
    expect(html).toContain('<table>');
    expect(html).toContain('</div>');
  });

  it('includes dissent when present', () => {
    const data = buildCardData(makeInput());
    const html = renderHtml(data);
    expect(html).toContain('Dissent');
  });

  it('omits dissent when absent', () => {
    const data = buildCardData(
      makeInput({
        synthesis: { ...makeInput().synthesis, minorityReport: undefined },
      }),
    );
    const html = renderHtml(data);
    expect(html).not.toContain('Dissent');
  });
});

describe('renderGitHubAnnotations', () => {
  it('emits ::notice for pass', () => {
    const data = buildCardData(makeInput());
    const annotations = renderGitHubAnnotations(data);
    expect(annotations).toContain('::notice');
    expect(annotations).toContain('Passed');
  });

  it('emits ::error for fail', () => {
    const data = buildCardData(
      makeInput({
        synthesis: { ...makeInput().synthesis, confidenceScore: 0.3 },
        confidenceThreshold: 0.7,
      }),
    );
    const annotations = renderGitHubAnnotations(data);
    expect(annotations).toContain('::error');
    expect(annotations).toContain('Failed');
  });

  it('emits ::warning for warn', () => {
    const data = buildCardData(
      makeInput({
        synthesis: { ...makeInput().synthesis, consensusScore: 0.3 },
      }),
    );
    const annotations = renderGitHubAnnotations(data);
    expect(annotations).toContain('::warning');
    expect(annotations).toContain('Warning');
  });

  it('adds dissent annotation', () => {
    const data = buildCardData(makeInput());
    const annotations = renderGitHubAnnotations(data);
    expect(annotations).toContain('Dissent');
  });
});

describe('renderCard', () => {
  it('dispatches to correct format', () => {
    const data = buildCardData(makeInput());
    expect(renderCard(data, 'json')).toContain('"verdict"');
    expect(renderCard(data, 'html')).toContain('<div');
    expect(renderCard(data, 'markdown')).toContain('**Quorum');
    expect(renderCard(data, 'markdown', true)).toContain('## ');
  });
});

describe('generateSummaryCard', () => {
  it('generates compact markdown by default', () => {
    const card = generateSummaryCard(makeInput());
    expect(card.length).toBeLessThanOrEqual(500);
    expect(card).toContain('PASS');
  });

  it('generates detailed markdown', () => {
    const card = generateSummaryCard(makeInput(), 'markdown', true);
    expect(card).toContain('Provider Breakdown');
  });

  it('generates JSON', () => {
    const card = generateSummaryCard(makeInput(), 'json');
    expect(JSON.parse(card).verdict).toBe('pass');
  });
});

describe('generateAnnotations', () => {
  it('generates GitHub Actions annotations', () => {
    const annotations = generateAnnotations(makeInput());
    expect(annotations).toContain('::notice');
  });
});
