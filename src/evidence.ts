/**
 * Evidence-Backed Claims Protocol (EBCP)
 *
 * Parses, scores, and reports on evidence markers in provider responses.
 * Features sentence-level claim extraction, source quality tiers,
 * cross-provider validation, and weighted scoring.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export type SourceTier = 'A' | 'B' | 'C' | 'D' | 'F';

export interface EvidenceClaim {
  claim: string;
  source?: string;
  sourceTier: SourceTier;
  quoteSpan?: string;
  confidence: number;
  claimHash: string;
}

export interface EvidenceReport {
  provider: string;
  totalClaims: number;
  supportedClaims: number;
  unsupportedClaims: number;
  evidenceScore: number;
  tierBreakdown: Record<SourceTier, number>;
  weightedScore: number;
  claims: EvidenceClaim[];
}

export interface CrossReference {
  claimText: string;
  providers: string[];
  corroborated: boolean;
  contradicted: boolean;
  contradictions?: string[];
  bestSourceTier: SourceTier;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EVIDENCE_INSTRUCTION = `Tag every substantive claim with [source: URL/path/data/reasoning].
Source quality tiers: URL (strongest) > file path > data/stats > reasoning (weakest).
Unsupported claims are penalized in voting. Use [quote: "excerpt"] for key evidence.
Optionally add [confidence: 0.X] after each source tag.`;

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'out',
  'off',
  'over',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'because',
  'but',
  'and',
  'or',
  'if',
  'while',
  'about',
  'up',
  'that',
  'this',
  'it',
  'its',
  'they',
  'them',
  'their',
  'we',
  'our',
  'you',
  'your',
  'he',
  'she',
  'his',
  'her',
  'i',
  'me',
  'my',
  'also',
  'which',
  'what',
  'who',
]);

const NEGATION_PATTERNS = [
  /\bnot\b/i,
  /\bno\b/i,
  /\bnever\b/i,
  /\bwon'?t\b/i,
  /\bcan'?t\b/i,
  /\bdoesn'?t\b/i,
  /\bisn'?t\b/i,
  /\baren'?t\b/i,
  /\bwasn'?t\b/i,
  /\bweren'?t\b/i,
  /\bshouldn'?t\b/i,
  /\bwouldn'?t\b/i,
  /\bcouldn'?t\b/i,
  /\bhardly\b/i,
  /\brarely\b/i,
  /\bseldom\b/i,
  /\binstead\b/i,
  /\bavoid\b/i,
  /\bwithout\b/i,
];

const FILLER_PATTERNS = [
  /^(however|therefore|additionally|furthermore|moreover|in\s+conclusion|to\s+summarize|overall|in\s+summary)[,.]?\s*$/i,
  /^(let'?s|here'?s|now|next|first|second|third|finally)[,:]?\s*$/i,
];

// ---------------------------------------------------------------------------
// Tier Detection & Weights
// ---------------------------------------------------------------------------

export function tierWeight(tier: SourceTier): number {
  switch (tier) {
    case 'A':
      return 1.0;
    case 'B':
      return 0.8;
    case 'C':
      return 0.7;
    case 'D':
      return 0.4;
    case 'F':
      return 0.0;
  }
}

function detectSourceTier(source: string | undefined): SourceTier {
  if (!source) return 'F';
  const s = source.trim();
  if (/^https?:\/\//i.test(s)) return 'A';
  if (
    /\.(ts|js|tsx|jsx|py|go|rs|java|rb|c|cpp|h|json|yaml|yml|md|txt|sh|css|html)\b/i.test(s) ||
    /^[./~]/.test(s) ||
    /:\d+/.test(s) ||
    /^src\//.test(s)
  )
    return 'B';
  if (/\d+%|\d+\.\d+|\$\d|#\d/.test(s) && /[""]|according|study|report|survey|research/i.test(s))
    return 'C';
  if (/reasoning|logic|deduct|infer|because|argument/i.test(s)) return 'D';
  // Fallback heuristics
  if (/\//.test(s) && s.length > 3) return 'B'; // path-like
  if (/\d/.test(s) && s.length > 5) return 'C'; // has data
  return 'D'; // has some source text, treat as reasoning
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClaimHash(text: string): string {
  return createHash('sha256')
    .update(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim(),
    )
    .digest('hex')
    .slice(0, 12);
}

function isFiller(text: string): boolean {
  if (text.length < 30) return true;
  for (const p of FILLER_PATTERNS) {
    if (p.test(text)) return true;
  }
  return false;
}

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function hasNegation(text: string): boolean {
  return NEGATION_PATTERNS.some((p) => p.test(text));
}

// ---------------------------------------------------------------------------
// Claim Extraction
// ---------------------------------------------------------------------------

/**
 * Parse evidence-tagged claims from a provider response.
 * Extracts at sentence level, detects source tiers, and assigns claim hashes.
 */
export function parseEvidence(response: string): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];
  const seen = new Set<string>();

  // Strip and collect all source/evidence markers with positions
  const markerRegex = /\[(?:source|evidence):\s*([^\]]+)\]/gi;
  const quoteRegex = /\[quote:\s*"?([^"\]]+)"?\]/gi;
  const confidenceRegex = /\[confidence:\s*([\d.]+)\]/gi;

  // Build a map of character positions to their associated source
  interface MarkerInfo {
    start: number;
    end: number;
    source: string;
  }
  const markers: MarkerInfo[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRegex.exec(response)) !== null) {
    markers.push({ start: m.index, end: m.index + m[0].length, source: m[1].trim() });
  }

  // Collect quotes
  interface QuoteInfo {
    start: number;
    end: number;
    text: string;
  }
  const quotes: QuoteInfo[] = [];
  while ((m = quoteRegex.exec(response)) !== null) {
    quotes.push({ start: m.index, end: m.index + m[0].length, text: m[1].trim() });
  }

  // Collect confidence tags
  interface ConfInfo {
    start: number;
    end: number;
    value: number;
  }
  const confs: ConfInfo[] = [];
  while ((m = confidenceRegex.exec(response)) !== null) {
    confs.push({ start: m.index, end: m.index + m[0].length, value: parseFloat(m[1]) });
  }

  // Strip all tags from response to get clean text for sentence splitting
  const cleanText = response
    .replace(/\[(?:source|evidence):\s*[^\]]+\]/gi, ' ')
    .replace(/\[quote:\s*"?[^"\]]*"?\]/gi, ' ')
    .replace(/\[confidence:\s*[\d.]+\]/gi, ' ');

  // Split into sentences
  const sentences = cleanText
    .split(/(?<=[.!?])\s+|\n{2,}|\n(?=[-•*\d])/g)
    .map((s) => s.replace(/^\s*[-•*\d.)\s]+/, '').trim())
    .filter((s) => s.length > 0);

  // For each sentence, find its position in original text and associate markers
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (isFiller(trimmed)) continue;

    // Find this sentence's approximate position in original
    const cleanLower = cleanText.toLowerCase();
    const sentLower = trimmed.toLowerCase().slice(0, 60);
    const approxPos = cleanLower.indexOf(sentLower);

    // Find the nearest source marker after (or shortly before) this sentence position
    // We map clean-text positions roughly to original positions
    let bestMarker: MarkerInfo | undefined;
    let bestQuote: QuoteInfo | undefined;
    let bestConf: ConfInfo | undefined;

    if (approxPos >= 0) {
      // Find original position by counting non-tag characters
      const origPos = mapCleanToOriginal(response, approxPos);

      // Look for markers near this sentence (within reasonable range)
      const sentEnd = origPos + trimmed.length + 100;
      for (const mk of markers) {
        if (mk.start >= origPos - 50 && mk.start <= sentEnd + 200) {
          if (!bestMarker || Math.abs(mk.start - origPos) < Math.abs(bestMarker.start - origPos)) {
            bestMarker = mk;
          }
        }
      }

      // Associate quote/confidence near the marker or sentence
      const searchEnd = bestMarker ? bestMarker.end + 200 : sentEnd + 200;
      const searchStart = origPos - 20;
      for (const q of quotes) {
        if (q.start >= searchStart && q.start <= searchEnd) {
          bestQuote = q;
          break;
        }
      }
      for (const c of confs) {
        if (c.start >= searchStart && c.start <= searchEnd) {
          bestConf = c;
          break;
        }
      }
    }

    const source = bestMarker?.source;
    const sourceTier = detectSourceTier(source);
    const confidence = bestConf?.value ?? (source ? 0.7 : 0.5);
    const hash = makeClaimHash(trimmed);

    if (seen.has(hash)) continue;
    seen.add(hash);

    // Remove the marker from being reused
    if (bestMarker) {
      const idx = markers.indexOf(bestMarker);
      if (idx >= 0) markers.splice(idx, 1);
    }
    if (bestQuote) {
      const idx = quotes.indexOf(bestQuote);
      if (idx >= 0) quotes.splice(idx, 1);
    }
    if (bestConf) {
      const idx = confs.indexOf(bestConf);
      if (idx >= 0) confs.splice(idx, 1);
    }

    claims.push({
      claim: trimmed.slice(0, 300),
      source,
      sourceTier,
      quoteSpan: bestQuote?.text,
      confidence,
      claimHash: hash,
    });
  }

  // If no claims extracted but response is non-trivial, add as single unsupported claim
  if (claims.length === 0 && response.trim().length > 20) {
    const text = response.trim().slice(0, 200);
    claims.push({
      claim: text,
      sourceTier: 'F',
      confidence: 0.5,
      claimHash: makeClaimHash(text),
    });
  }

  return claims;
}

/**
 * Map a position in cleaned text back to approximate position in original.
 */
function mapCleanToOriginal(original: string, cleanPos: number): number {
  const tagRegex = /\[(?:source|evidence|quote|confidence):[^\]]*\]/gi;
  let offset = 0;
  let cleanOffset = 0;
  let lastEnd = 0;
  let m2: RegExpExecArray | null;

  const tags: Array<{ start: number; length: number }> = [];
  while ((m2 = tagRegex.exec(original)) !== null) {
    tags.push({ start: m2.index, length: m2[0].length });
  }

  for (const tag of tags) {
    const gapBefore = tag.start - lastEnd;
    if (cleanOffset + gapBefore > cleanPos) {
      return lastEnd + (cleanPos - cleanOffset);
    }
    cleanOffset += gapBefore;
    offset = tag.start + tag.length;
    lastEnd = offset;
  }

  return lastEnd + (cleanPos - cleanOffset);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score evidence: ratio of supported claims to total claims.
 */
export function scoreEvidence(claims: EvidenceClaim[]): number {
  if (claims.length === 0) return 0;
  const supported = claims.filter((c) => c.source && c.source.length > 0).length;
  return supported / claims.length;
}

/**
 * Weighted evidence score using tier weights.
 */
export function weightedScoreEvidence(claims: EvidenceClaim[]): number {
  if (claims.length === 0) return 0;
  const total = claims.reduce((sum, c) => sum + tierWeight(c.sourceTier), 0);
  return total / claims.length;
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

/**
 * Generate a full evidence report for a provider's response.
 */
export function generateEvidenceReport(provider: string, response: string): EvidenceReport {
  const claims = parseEvidence(response);
  const supported = claims.filter((c) => c.source && c.source.length > 0).length;
  const unsupported = claims.length - supported;

  const tierBreakdown: Record<SourceTier, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const c of claims) {
    tierBreakdown[c.sourceTier]++;
  }

  return {
    provider,
    totalClaims: claims.length,
    supportedClaims: supported,
    unsupportedClaims: unsupported,
    evidenceScore: scoreEvidence(claims),
    tierBreakdown,
    weightedScore: weightedScoreEvidence(claims),
    claims,
  };
}

// ---------------------------------------------------------------------------
// Cross-Provider Validation
// ---------------------------------------------------------------------------

/**
 * Cross-validate claims across multiple provider reports.
 */
export function crossValidateClaims(reports: EvidenceReport[]): CrossReference[] {
  interface ClaimEntry {
    text: string;
    words: string[];
    provider: string;
    tier: SourceTier;
    hasNeg: boolean;
  }

  const allClaims: ClaimEntry[] = [];
  for (const report of reports) {
    for (const claim of report.claims) {
      allClaims.push({
        text: claim.claim,
        words: significantWords(claim.claim),
        provider: report.provider,
        tier: claim.sourceTier,
        hasNeg: hasNegation(claim.claim),
      });
    }
  }

  // Group similar claims
  const groups: ClaimEntry[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < allClaims.length; i++) {
    if (assigned.has(i)) continue;
    const group = [allClaims[i]];
    assigned.add(i);

    for (let j = i + 1; j < allClaims.length; j++) {
      if (assigned.has(j)) continue;
      if (areSimilar(allClaims[i], allClaims[j])) {
        group.push(allClaims[j]);
        assigned.add(j);
      }
    }

    if (group.length > 1 || true) {
      // include all for completeness
      groups.push(group);
    }
  }

  const tierOrder: SourceTier[] = ['A', 'B', 'C', 'D', 'F'];

  return groups.map((group) => {
    const providers = [...new Set(group.map((c) => c.provider))];
    const corroborated = providers.length >= 2;

    // Check for contradictions: same topic but opposite negation
    let contradicted = false;
    const contradictions: string[] = [];
    if (providers.length >= 2) {
      const withNeg = group.filter((c) => c.hasNeg);
      const withoutNeg = group.filter((c) => !c.hasNeg);
      if (withNeg.length > 0 && withoutNeg.length > 0) {
        // Ensure they're from different providers
        const negProviders = new Set(withNeg.map((c) => c.provider));
        const posProviders = new Set(withoutNeg.map((c) => c.provider));
        for (const p of negProviders) {
          if (!posProviders.has(p) || negProviders.size > 1) {
            contradicted = true;
            for (const c of withNeg) contradictions.push(c.text);
            break;
          }
        }
      }
    }

    const bestTier = tierOrder.find((t) => group.some((c) => c.tier === t)) ?? 'F';

    return {
      claimText: group[0].text,
      providers,
      corroborated,
      contradicted,
      ...(contradictions.length > 0 ? { contradictions } : {}),
      bestSourceTier: bestTier,
    };
  });
}

function areSimilar(
  a: { text: string; words: string[] },
  b: { text: string; words: string[] },
): boolean {
  const aLower = a.text.toLowerCase();
  const bLower = b.text.toLowerCase();

  // One contains the other
  if (aLower.includes(bLower) || bLower.includes(aLower)) return true;

  // Share 3+ significant words
  const shared = a.words.filter((w) => b.words.includes(w));
  return shared.length >= 3;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format evidence scores as a summary string with tier breakdown.
 */
export function formatEvidenceSummary(reports: EvidenceReport[]): string {
  return reports
    .map((r) => {
      const tierStr = (['A', 'B', 'C', 'D', 'F'] as SourceTier[])
        .filter((t) => r.tierBreakdown[t] > 0)
        .map((t) => `${t}:${r.tierBreakdown[t]}`)
        .join(' ');
      return `${r.provider}: ${Math.round(r.evidenceScore * 100)}% evidence (weighted: ${Math.round(r.weightedScore * 100)}%) [${tierStr}]`;
    })
    .join('\n');
}
