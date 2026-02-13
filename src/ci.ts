/**
 * CI-specific post-processing of deliberation results.
 * Extracts risk matrices and patch suggestions from synthesis and debate responses.
 * Pure functions — no I/O, no side effects.
 */

// --- Risk Matrix ---

export interface RiskItem {
  area: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  details: string;
  providers: string[];
}

export interface PatchSuggestion {
  file: string;
  line?: number;
  before?: string;
  after: string;
  rationale: string;
  providers: string[];
}

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface RiskCategory {
  area: string;
  keywords: RegExp[];
}

const RISK_CATEGORIES: RiskCategory[] = [
  {
    area: 'Security',
    keywords: [/\bsecurit/i, /\bvulnerabilit/i, /\binjection/i, /\bxss\b/i, /\bcsrf\b/i, /\bauth/i],
  },
  {
    area: 'Performance',
    keywords: [/\bperformance/i, /\bslow/i, /\bmemory leak/i, /\boptimiz/i, /\bhot[- ]?path/i],
  },
  {
    area: 'Breaking Changes',
    keywords: [/\bbreaking/i, /\bbackwards?\s*incompatible/i, /\bpublic api/i, /\bdeprecate/i],
  },
  {
    area: 'Correctness',
    keywords: [
      /\bbug/i,
      /\bcorrectness/i,
      /\bcrash/i,
      /\bdata loss/i,
      /\brace condition/i,
      /\bedge case/i,
      /\bcould fail/i,
    ],
  },
  {
    area: 'Style',
    keywords: [/\bstyle/i, /\bnaming/i, /\bformatting/i, /\bconvention/i, /\blint/i],
  },
  {
    area: 'Testing',
    keywords: [/\btesting/i, /\bcoverage/i, /\bmissing test/i, /\btest\b/i, /\buntested/i],
  },
];

const CRITICAL_PATTERNS = [
  /\bvulnerabilit/i,
  /\binjection/i,
  /\bcrash/i,
  /\bdata loss/i,
  /\bbreaking change to public api/i,
];
const HIGH_PATTERNS = [
  /\bsecurit/i,
  /\brace condition/i,
  /\bmemory leak/i,
  /\bbackwards?\s*incompatible/i,
];
const MEDIUM_PATTERNS = [/\bperformance/i, /\bcould fail/i, /\bedge case/i, /\bmissing test/i];
const _LOW_PATTERNS = [/\bstyle/i, /\bnaming/i, /\bformatting/i, /\bminor/i];

function determineRiskLevel(text: string): RiskLevel {
  const lower = text.toLowerCase();
  if (CRITICAL_PATTERNS.some((p) => p.test(lower))) return 'critical';
  if (HIGH_PATTERNS.some((p) => p.test(lower))) return 'high';
  if (MEDIUM_PATTERNS.some((p) => p.test(lower))) return 'medium';
  return 'low';
}

function escalateRisk(level: RiskLevel): RiskLevel {
  switch (level) {
    case 'low':
      return 'medium';
    case 'medium':
      return 'high';
    case 'high':
      return 'critical';
    case 'critical':
      return 'critical';
  }
}

function extractRelevantSentence(text: string, keywords: RegExp[]): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    if (keywords.some((k) => k.test(sentence))) {
      const trimmed = sentence.trim();
      return trimmed.length > 200 ? trimmed.slice(0, 197) + '...' : trimmed;
    }
  }
  return '';
}

function getAllResponses(
  synthesis: string,
  debateResponses: Record<string, string>,
  adjustResponses: Record<string, string>,
): Map<string, string[]> {
  // Returns map of provider -> texts, plus a special '_synthesis' key
  const result = new Map<string, string[]>();
  result.set('_synthesis', [synthesis]);
  for (const [provider, text] of Object.entries(debateResponses)) {
    const existing = result.get(provider) ?? [];
    existing.push(text);
    result.set(provider, existing);
  }
  for (const [provider, text] of Object.entries(adjustResponses)) {
    const existing = result.get(provider) ?? [];
    existing.push(text);
    result.set(provider, existing);
  }
  return result;
}

export function extractRiskMatrix(
  synthesis: string,
  debateResponses: Record<string, string>,
  adjustResponses: Record<string, string>,
): RiskItem[] {
  const responses = getAllResponses(synthesis, debateResponses, adjustResponses);
  const areaMap = new Map<string, { risk: RiskLevel; details: string; providers: Set<string> }>();

  for (const [provider, texts] of responses) {
    const combinedText = texts.join('\n');
    for (const category of RISK_CATEGORIES) {
      if (category.keywords.some((k) => k.test(combinedText))) {
        const providerName = provider === '_synthesis' ? undefined : provider;
        const existing = areaMap.get(category.area);
        const riskLevel = determineRiskLevel(combinedText);
        const sentence = extractRelevantSentence(combinedText, category.keywords);

        if (existing) {
          if (providerName) existing.providers.add(providerName);
          // Keep highest risk level
          const levels: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
          if (levels.indexOf(riskLevel) > levels.indexOf(existing.risk)) {
            existing.risk = riskLevel;
          }
          if (sentence && (!existing.details || sentence.length > existing.details.length)) {
            existing.details = sentence;
          }
        } else {
          const providers = new Set<string>();
          if (providerName) providers.add(providerName);
          areaMap.set(category.area, {
            risk: riskLevel,
            details: sentence,
            providers,
          });
        }
      }
    }
  }

  // Escalate risk if multiple providers flagged the same area
  const results: RiskItem[] = [];
  for (const [area, data] of areaMap) {
    let risk = data.risk;
    if (data.providers.size > 1) {
      risk = escalateRisk(risk);
    }
    if (data.details || data.providers.size > 0) {
      results.push({
        area,
        risk,
        details: data.details || `Flagged by ${data.providers.size} provider(s)`,
        providers: [...data.providers].sort(),
      });
    }
  }

  // Sort by severity
  const severityOrder: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  results.sort((a, b) => severityOrder[a.risk] - severityOrder[b.risk]);

  return results;
}

// --- Patch Suggestion Extraction ---

const _FILE_PATH_RE =
  /(?:(?:file:\s*|in\s+)`?)([a-zA-Z0-9_\-./]+\.(?:ts|js|tsx|jsx|py|go|rs|java|rb|css|scss|html|vue|svelte))\b`?/gi;
const LINE_NUMBER_RE = /(?:line\s+|L|:)(\d+)/i;
const CHANGE_PATTERN_RE =
  /(?:change|replace|rename)\s+["`']?(.+?)["`']?\s+(?:to|with)\s+["`']?(.+?)["`']?\s*[.;,]?$/gim;
const _SHOULD_BE_RE =
  /["`']?(.+?)["`']?\s+should\s+be\s+["`']?(.+?)["`']?\s+instead\s+of\s+["`']?(.+?)["`']?/gim;

interface CodeBlock {
  lang: string;
  code: string;
  startIdx: number;
  endIdx: number;
  isSuggestion: boolean;
}

function extractCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    blocks.push({
      lang: match[1] ?? '',
      code: match[2]?.trim() ?? '',
      startIdx: match.index,
      endIdx: match.index + match[0].length,
      isSuggestion: match[1] === 'suggestion',
    });
  }
  return blocks;
}

function findNearbyFilePath(text: string, position: number): string | undefined {
  // Look in a window around the code block for file paths
  const windowStart = Math.max(0, position - 300);
  const windowEnd = Math.min(text.length, position + 50);
  const window = text.slice(windowStart, windowEnd);

  const fileRe =
    /(?:(?:file:\s*|in\s+)`?)([a-zA-Z0-9_\-./]+\.(?:ts|js|tsx|jsx|py|go|rs|java|rb|css|scss|html|vue|svelte))\b`?/gi;
  let match: RegExpExecArray | null;
  let lastMatch: string | undefined;
  while ((match = fileRe.exec(window)) !== null) {
    lastMatch = match[1];
  }
  return lastMatch;
}

function findNearbyLineNumber(text: string, position: number): number | undefined {
  const windowStart = Math.max(0, position - 200);
  const windowEnd = Math.min(text.length, position + 50);
  const window = text.slice(windowStart, windowEnd);
  const match = LINE_NUMBER_RE.exec(window);
  return match ? parseInt(match[1], 10) : undefined;
}

function findRationale(text: string, blockStart: number, blockEnd: number): string {
  // Look for the sentence before or after the code block
  const before = text.slice(Math.max(0, blockStart - 300), blockStart).trim();
  const after = text.slice(blockEnd, Math.min(text.length, blockEnd + 300)).trim();

  // Prefer the sentence right before
  const beforeSentences = before.split(/(?<=[.!?:—])\s+/).filter((s) => s.length > 10);
  if (beforeSentences.length > 0) {
    const last = beforeSentences[beforeSentences.length - 1]!.trim();
    if (last.length > 10 && last.length < 300) return last;
  }

  // Fall back to sentence after
  const afterSentences = after.split(/(?<=[.!?])\s+/).filter((s) => s.length > 10);
  if (afterSentences.length > 0) {
    const first = afterSentences[0]!.trim();
    if (first.length > 10 && first.length < 300) return first;
  }

  return 'Suggested code change';
}

function _extractDiffSuggestions(text: string, provider: string): PatchSuggestion[] {
  const suggestions: PatchSuggestion[] = [];
  const blocks = extractCodeBlocks(text);

  for (const block of blocks) {
    const lines = block.code.split('\n');
    const hasPlus = lines.some((l) => l.startsWith('+'));
    const hasMinus = lines.some((l) => l.startsWith('-'));

    if (hasPlus && hasMinus) {
      const beforeLines = lines
        .filter((l) => l.startsWith('-'))
        .map((l) => l.slice(1))
        .join('\n');
      const afterLines = lines
        .filter((l) => l.startsWith('+'))
        .map((l) => l.slice(1))
        .join('\n');
      const file = findNearbyFilePath(text, block.startIdx);
      if (file) {
        suggestions.push({
          file,
          line: findNearbyLineNumber(text, block.startIdx),
          before: beforeLines || undefined,
          after: afterLines,
          rationale: findRationale(text, block.startIdx, block.endIdx),
          providers: [provider],
        });
      }
    }
  }
  return suggestions;
}

export function extractPatchSuggestions(
  synthesis: string,
  debateResponses: Record<string, string>,
  adjustResponses: Record<string, string>,
): PatchSuggestion[] {
  const allSuggestions: PatchSuggestion[] = [];
  const responses = getAllResponses(synthesis, debateResponses, adjustResponses);

  for (const [provider, texts] of responses) {
    const providerName = provider === '_synthesis' ? 'synthesis' : provider;
    for (const text of texts) {
      // Extract from code blocks
      const blocks = extractCodeBlocks(text);
      for (const block of blocks) {
        if (block.isSuggestion) {
          const file = findNearbyFilePath(text, block.startIdx);
          if (file) {
            allSuggestions.push({
              file,
              line: findNearbyLineNumber(text, block.startIdx),
              after: block.code,
              rationale: findRationale(text, block.startIdx, block.endIdx),
              providers: [providerName],
            });
          }
          continue;
        }

        // Check for diff-style blocks
        const lines = block.code.split('\n');
        const hasPlus = lines.some((l) => l.startsWith('+'));
        const hasMinus = lines.some((l) => l.startsWith('-'));
        if (hasPlus && hasMinus) {
          const file = findNearbyFilePath(text, block.startIdx);
          if (file) {
            const beforeLines = lines
              .filter((l) => l.startsWith('-'))
              .map((l) => l.slice(1))
              .join('\n');
            const afterLines = lines
              .filter((l) => l.startsWith('+'))
              .map((l) => l.slice(1))
              .join('\n');
            allSuggestions.push({
              file,
              line: findNearbyLineNumber(text, block.startIdx),
              before: beforeLines || undefined,
              after: afterLines,
              rationale: findRationale(text, block.startIdx, block.endIdx),
              providers: [providerName],
            });
            continue;
          }
        }

        // Regular code block with nearby file path
        const file = findNearbyFilePath(text, block.startIdx);
        if (file && block.code.length > 5) {
          allSuggestions.push({
            file,
            line: findNearbyLineNumber(text, block.startIdx),
            after: block.code,
            rationale: findRationale(text, block.startIdx, block.endIdx),
            providers: [providerName],
          });
        }
      }

      // Extract "Change X to Y" patterns (only if no code blocks found for this text)
      if (blocks.length === 0) {
        let match: RegExpExecArray | null;
        const changeRe = new RegExp(CHANGE_PATTERN_RE.source, CHANGE_PATTERN_RE.flags);
        while ((match = changeRe.exec(text)) !== null) {
          const file = findNearbyFilePath(text, match.index);
          if (file && match[1] && match[2]) {
            allSuggestions.push({
              file,
              line: findNearbyLineNumber(text, match.index),
              before: match[1].trim(),
              after: match[2].trim(),
              rationale: findRationale(text, match.index, match.index + match[0].length),
              providers: [providerName],
            });
          }
        }
      }
    }
  }

  // Deduplicate by file + after content
  const deduped = new Map<string, PatchSuggestion>();
  for (const suggestion of allSuggestions) {
    const key = `${suggestion.file}::${suggestion.after.trim().slice(0, 100)}`;
    const existing = deduped.get(key);
    if (existing) {
      for (const p of suggestion.providers) {
        if (!existing.providers.includes(p)) {
          existing.providers.push(p);
        }
      }
      // Keep line number if one has it
      if (!existing.line && suggestion.line) existing.line = suggestion.line;
      if (!existing.before && suggestion.before) existing.before = suggestion.before;
    } else {
      deduped.set(key, { ...suggestion });
    }
  }

  return [...deduped.values()];
}

// --- Formatters ---

interface FormatOptions {
  synthesis: string;
  consensus: number;
  confidence: number;
  evidenceGrade?: string;
  riskMatrix: RiskItem[];
  suggestions: PatchSuggestion[];
  dissent?: string;
  evidenceSummary?: string;
  providers: string[];
  duration: number;
}

function riskEmoji(risk: RiskLevel): string {
  switch (risk) {
    case 'low':
      return '🟢';
    case 'medium':
      return '🟡';
    case 'high':
      return '🔴';
    case 'critical':
      return '🔴';
  }
}

function riskLabel(risk: RiskLevel): string {
  const emoji = riskEmoji(risk);
  const label = risk.charAt(0).toUpperCase() + risk.slice(1);
  return risk === 'critical' ? `${emoji} **${label}**` : `${emoji} ${label}`;
}

function cleanSynthesisForSummary(synthesis: string): string {
  // Strip Scores and Minority Report sections, take first 2000 chars
  let cleaned = synthesis;
  // Remove common sections
  cleaned = cleaned.replace(
    /#{1,3}\s*(?:Scores?|Minority Report|Risk Matrix|Patch Suggestions?)[\s\S]*?(?=#{1,3}\s|\n$|$)/gi,
    '',
  );
  cleaned = cleaned.trim();
  if (cleaned.length > 2000) {
    cleaned = cleaned.slice(0, 2000) + '...';
  }
  return cleaned;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function formatSuggestionBlock(suggestion: PatchSuggestion): string {
  const lineInfo = suggestion.line ? ` (line ${suggestion.line})` : '';
  const rationale = suggestion.rationale ? ` — *${suggestion.rationale}*` : '';
  let block = `**${suggestion.file}**${lineInfo}${rationale}\n`;
  block += '```suggestion\n';
  block += suggestion.after + '\n';
  block += '```\n';
  block += `Suggested by: ${suggestion.providers.join(', ')}`;
  return block;
}

export function formatGitHubComment(options: FormatOptions): string {
  const {
    synthesis,
    consensus,
    confidence,
    evidenceGrade,
    riskMatrix,
    suggestions,
    dissent,
    evidenceSummary,
    providers,
    duration,
  } = options;

  const lines: string[] = [];
  lines.push('## 🏛️ Quorum Code Review\n');

  let statsLine = `**Consensus:** ${consensus.toFixed(2)} | **Confidence:** ${confidence.toFixed(2)}`;
  if (evidenceGrade) statsLine += ` | **Evidence:** ${evidenceGrade}`;
  lines.push(statsLine);
  lines.push(
    `**Providers:** ${providers.join(', ')} | **Duration:** ${formatDuration(duration)}\n`,
  );

  lines.push('### Summary\n');
  lines.push(cleanSynthesisForSummary(synthesis) + '\n');

  // Risk Matrix
  if (riskMatrix.length > 0) {
    lines.push(
      `<details><summary>🔍 Risk Matrix (${riskMatrix.length} item${riskMatrix.length === 1 ? '' : 's'})</summary>\n`,
    );
    lines.push('| Area | Risk | Details | Flagged By |');
    lines.push('|------|------|---------|------------|');
    for (const item of riskMatrix) {
      lines.push(
        `| ${item.area} | ${riskLabel(item.risk)} | ${item.details} | ${item.providers.join(', ')} |`,
      );
    }
    lines.push('\n</details>\n');
  }

  // Dissent
  if (dissent) {
    lines.push('<details><summary>⚖️ Dissent Summary</summary>\n');
    lines.push(dissent + '\n');
    lines.push('</details>\n');
  }

  // Evidence
  if (evidenceSummary) {
    lines.push('<details><summary>📋 Evidence Report</summary>\n');
    lines.push(evidenceSummary + '\n');
    lines.push('</details>\n');
  }

  // Patch Suggestions
  if (suggestions.length > 0) {
    lines.push(`<details><summary>💡 Patch Suggestions (${suggestions.length})</summary>\n`);
    for (let i = 0; i < suggestions.length; i++) {
      lines.push(formatSuggestionBlock(suggestions[i]!));
      if (i < suggestions.length - 1) lines.push('\n---\n');
    }
    lines.push('\n</details>\n');
  }

  lines.push('---');
  lines.push(
    `*Review by [Quorum](https://github.com/quorum-ai/quorum) · ${providers.join(', ')} · ${formatDuration(duration)}*`,
  );

  return lines.join('\n');
}

export function formatMarkdownReport(options: FormatOptions): string {
  const {
    synthesis,
    consensus,
    confidence,
    evidenceGrade,
    riskMatrix,
    suggestions,
    dissent,
    evidenceSummary,
    providers,
    duration,
  } = options;

  const lines: string[] = [];
  lines.push('# 🏛️ Quorum Code Review\n');

  let statsLine = `**Consensus:** ${consensus.toFixed(2)} | **Confidence:** ${confidence.toFixed(2)}`;
  if (evidenceGrade) statsLine += ` | **Evidence:** ${evidenceGrade}`;
  lines.push(statsLine);
  lines.push(
    `**Providers:** ${providers.join(', ')} | **Duration:** ${formatDuration(duration)}\n`,
  );

  lines.push('## Summary\n');
  lines.push(cleanSynthesisForSummary(synthesis) + '\n');

  // Risk Matrix
  if (riskMatrix.length > 0) {
    lines.push(
      `## 🔍 Risk Matrix (${riskMatrix.length} item${riskMatrix.length === 1 ? '' : 's'})\n`,
    );
    lines.push('| Area | Risk | Details | Flagged By |');
    lines.push('|------|------|---------|------------|');
    for (const item of riskMatrix) {
      lines.push(
        `| ${item.area} | ${riskLabel(item.risk)} | ${item.details} | ${item.providers.join(', ')} |`,
      );
    }
    lines.push('');
  }

  // Dissent
  if (dissent) {
    lines.push('## ⚖️ Dissent Summary\n');
    lines.push(dissent + '\n');
  }

  // Evidence
  if (evidenceSummary) {
    lines.push('## 📋 Evidence Report\n');
    lines.push(evidenceSummary + '\n');
  }

  // Patch Suggestions
  if (suggestions.length > 0) {
    lines.push(`## 💡 Patch Suggestions (${suggestions.length})\n`);
    for (let i = 0; i < suggestions.length; i++) {
      lines.push(formatSuggestionBlock(suggestions[i]!));
      if (i < suggestions.length - 1) lines.push('\n---\n');
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(
    `*Review by [Quorum](https://github.com/quorum-ai/quorum) · ${providers.join(', ')} · ${formatDuration(duration)}*`,
  );

  return lines.join('\n');
}
