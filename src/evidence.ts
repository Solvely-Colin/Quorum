/**
 * Evidence-Backed Claims Protocol (EBCP)
 *
 * Parses, scores, and reports on evidence markers in provider responses.
 * Claims tagged with [source: ...] or [evidence: ...] are considered supported.
 */

export interface EvidenceClaim {
  claim: string;
  source?: string;        // URL, file path, or "reasoning"
  quoteSpan?: string;     // relevant quote from source
  confidence: number;     // 0-1 self-assessed
}

export interface EvidenceReport {
  provider: string;
  totalClaims: number;
  supportedClaims: number;  // claims with source
  unsupportedClaims: number;
  evidenceScore: number;    // ratio supported/total
  claims: EvidenceClaim[];
}

/**
 * Parse evidence-tagged claims from a provider response.
 *
 * Recognizes patterns:
 *   [source: URL/path/reasoning] or [evidence: URL/path/reasoning]
 *   Optionally followed by [quote: "..."] or [confidence: 0.X]
 *
 * Each sentence or paragraph containing a marker is treated as a claim.
 */
export function parseEvidence(response: string): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];

  // Match blocks: text followed by [source: ...] or [evidence: ...]
  // We split by markers and associate preceding text as the claim
  const markerRegex = /\[(?:source|evidence):\s*([^\]]+)\]/gi;
  const quoteRegex = /\[quote:\s*"?([^"\]]+)"?\]/i;
  const confidenceRegex = /\[confidence:\s*([\d.]+)\]/i;

  let match: RegExpExecArray | null;
  const markers: Array<{ index: number; source: string }> = [];

  while ((match = markerRegex.exec(response)) !== null) {
    markers.push({ index: match.index, source: match[1].trim() });
  }

  if (markers.length === 0) {
    // No markers found — treat entire response as one unsupported claim if non-trivial
    const trimmed = response.trim();
    if (trimmed.length > 20) {
      claims.push({
        claim: trimmed.slice(0, 200),
        confidence: 0.5,
      });
    }
    return claims;
  }

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    // Extract claim text: from previous marker end (or start) to this marker
    const prevEnd = i > 0 ? markers[i - 1].index + markers[i - 1].source.length + 10 : 0;
    let claimText = response.slice(prevEnd, marker.index).trim();

    // Clean up: take last sentence/paragraph before the marker
    const sentences = claimText.split(/(?<=[.!?])\s+/);
    claimText = sentences[sentences.length - 1] || claimText;
    claimText = claimText.replace(/^\s*[-•*]\s*/, '').trim();

    if (!claimText) claimText = '(claim at marker position)';

    // Check for optional quote and confidence after the marker
    const afterMarker = response.slice(marker.index, marker.index + 300);
    const quoteMatch = quoteRegex.exec(afterMarker);
    const confMatch = confidenceRegex.exec(afterMarker);

    claims.push({
      claim: claimText.slice(0, 300),
      source: marker.source,
      quoteSpan: quoteMatch?.[1],
      confidence: confMatch ? parseFloat(confMatch[1]) : 0.7,
    });
  }

  // Check for unsupported claims: sentences between markers that aren't near any marker
  // (simplified: we already captured marker-adjacent claims above)
  // Add a catch-all for text after the last marker
  const lastMarker = markers[markers.length - 1];
  const afterLast = response.slice(lastMarker.index + lastMarker.source.length + 10).trim();
  if (afterLast.length > 50) {
    // Remaining text without markers = unsupported claims
    const remainingSentences = afterLast.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20);
    for (const sentence of remainingSentences.slice(0, 5)) {
      // Only add if it doesn't contain a marker
      if (!/\[(?:source|evidence):/i.test(sentence)) {
        claims.push({
          claim: sentence.trim().slice(0, 300),
          confidence: 0.5,
        });
      }
    }
  }

  return claims;
}

/**
 * Score evidence: ratio of supported claims (those with a source) to total claims.
 */
export function scoreEvidence(claims: EvidenceClaim[]): number {
  if (claims.length === 0) return 0;
  const supported = claims.filter(c => c.source && c.source.length > 0).length;
  return supported / claims.length;
}

/**
 * Generate a full evidence report for a provider's response.
 */
export function generateEvidenceReport(provider: string, response: string): EvidenceReport {
  const claims = parseEvidence(response);
  const supported = claims.filter(c => c.source && c.source.length > 0).length;
  const unsupported = claims.length - supported;
  const evidenceScore = scoreEvidence(claims);

  return {
    provider,
    totalClaims: claims.length,
    supportedClaims: supported,
    unsupportedClaims: unsupported,
    evidenceScore,
    claims,
  };
}

/**
 * Evidence instruction text to inject into system prompts.
 */
export const EVIDENCE_INSTRUCTION = `Tag every substantive claim with [source: URL/path/reasoning]. Unsupported claims will be penalized in voting. Optionally add [quote: "relevant excerpt"] and [confidence: 0.X] after each source tag.`;

/**
 * Format evidence scores as a summary string.
 */
export function formatEvidenceSummary(reports: EvidenceReport[]): string {
  return reports
    .map(r => `${r.provider} ${Math.round(r.evidenceScore * 100)}%`)
    .join(', ');
}
