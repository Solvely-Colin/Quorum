/**
 * Attestation Diff — compare attestation chains across two sessions.
 */

import type { AttestationChain, AttestationRecord } from './attestation.js';

export interface AttestationDiffEntry {
  phase: string;
  status: 'match' | 'diverged' | 'only-left' | 'only-right';
  details?: string;
  left?: AttestationRecord;
  right?: AttestationRecord;
}

export interface AttestationDiffResult {
  sessionLeft: string;
  sessionRight: string;
  entries: AttestationDiffEntry[];
  divergedAt?: string;
  summary: string;
}

/**
 * Compare two attestation chains and produce a diff.
 */
export function diffAttestationChains(
  left: AttestationChain,
  right: AttestationChain,
): AttestationDiffResult {
  const entries: AttestationDiffEntry[] = [];
  let divergedAt: string | undefined;

  const maxLen = Math.max(left.records.length, right.records.length);

  for (let i = 0; i < maxLen; i++) {
    const l = left.records[i];
    const r = right.records[i];

    if (l && r) {
      if (l.phase !== r.phase) {
        if (!divergedAt) divergedAt = l.phase;
        entries.push({
          phase: `${l.phase} / ${r.phase}`,
          status: 'diverged',
          details: `Phase mismatch: left="${l.phase}", right="${r.phase}"`,
          left: l,
          right: r,
        });
      } else if (l.outputsHash === r.outputsHash && l.inputsHash === r.inputsHash) {
        entries.push({ phase: l.phase, status: 'match', left: l, right: r });
      } else {
        if (!divergedAt) divergedAt = l.phase;
        const parts: string[] = [];
        if (l.inputsHash !== r.inputsHash) parts.push('inputs differ');
        if (l.outputsHash !== r.outputsHash) parts.push('outputs differ');
        if (l.providerId !== r.providerId)
          parts.push(`providers differ (${l.providerId} vs ${r.providerId})`);
        entries.push({
          phase: l.phase,
          status: 'diverged',
          details: parts.join('; '),
          left: l,
          right: r,
        });
      }
    } else if (l) {
      entries.push({ phase: l.phase, status: 'only-left', left: l });
    } else if (r) {
      entries.push({ phase: r.phase, status: 'only-right', right: r });
    }
  }

  const matchCount = entries.filter((e) => e.status === 'match').length;
  const divergedCount = entries.filter((e) => e.status === 'diverged').length;

  let summary: string;
  if (divergedCount === 0 && entries.every((e) => e.status === 'match')) {
    summary = 'Sessions are identical across all phases.';
  } else if (divergedAt) {
    summary = `Sessions diverged at ${divergedAt} phase. ${matchCount} matching, ${divergedCount} diverged.`;
  } else {
    summary = `${matchCount} matching phases. Sessions have different numbers of phases.`;
  }

  return {
    sessionLeft: left.sessionId,
    sessionRight: right.sessionId,
    entries,
    divergedAt,
    summary,
  };
}

/**
 * Format attestation diff for terminal display.
 */
export function formatAttestationDiff(diff: AttestationDiffResult): string {
  const lines: string[] = [`Attestation Diff: ${diff.sessionLeft} ↔ ${diff.sessionRight}`, ''];

  for (const entry of diff.entries) {
    const icon =
      entry.status === 'match'
        ? '✅'
        : entry.status === 'diverged'
          ? '❌'
          : entry.status === 'only-left'
            ? '◀️'
            : '▶️';

    lines.push(`  ${icon} ${entry.phase} — ${entry.status}`);
    if (entry.details) {
      lines.push(`      ${entry.details}`);
    }
    if (entry.left) {
      lines.push(`      Left:  ${entry.left.hash.slice(0, 16)}... (${entry.left.providerId})`);
    }
    if (entry.right) {
      lines.push(`      Right: ${entry.right.hash.slice(0, 16)}... (${entry.right.providerId})`);
    }
  }

  lines.push('');
  lines.push(diff.summary);

  return lines.join('\n');
}
