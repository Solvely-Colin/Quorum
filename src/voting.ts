/**
 * Voting algorithms for Quorum deliberation.
 */

export interface Ballot {
  voter: string;
  rankings: Array<{ provider: string; rank: number }>;
}

export interface VotingResult {
  rankings: Array<{ provider: string; score: number }>;
  winner: string;
  method: string;
  details?: string;
}

/**
 * Borda count: each voter awards (n - rank) points to each candidate.
 */
export function bordaCount(ballots: Ballot[]): VotingResult {
  const scores: Record<string, number> = {};

  for (const ballot of ballots) {
    const n = ballot.rankings.length;
    for (const { provider, rank } of ballot.rankings) {
      scores[provider] = (scores[provider] ?? 0) + (n - rank);
    }
  }

  const rankings = Object.entries(scores)
    .map(([provider, score]) => ({ provider, score }))
    .sort((a, b) => b.score - a.score);

  const winner = rankings[0]?.provider ?? '';
  const breakdown = rankings.map(r => `${r.provider}: ${r.score} pts`).join(', ');

  return {
    rankings,
    winner,
    method: 'borda',
    details: `Borda count — each voter awards (n - rank) points. ${breakdown}.`,
  };
}

/**
 * Ranked-choice / instant-runoff voting.
 * Eliminate last place, redistribute their first-preference votes, repeat.
 */
export function rankedChoice(ballots: Ballot[]): VotingResult {
  if (ballots.length === 0) {
    return { rankings: [], winner: '', method: 'ranked-choice', details: 'No ballots cast.' };
  }

  // Get all candidates
  const allCandidates = new Set<string>();
  for (const b of ballots) {
    for (const { provider } of b.rankings) allCandidates.add(provider);
  }

  const eliminated = new Set<string>();
  const roundLog: string[] = [];
  let round = 0;

  // Work with a copy of rankings per ballot
  const activeBallots = ballots.map(b => ({
    voter: b.voter,
    rankings: [...b.rankings].sort((a, b) => a.rank - b.rank),
  }));

  while (true) {
    round++;
    const remaining = [...allCandidates].filter(c => !eliminated.has(c));
    if (remaining.length <= 1) {
      const winner = remaining[0] ?? '';
      roundLog.push(`Round ${round}: ${winner} wins (last standing).`);
      break;
    }

    // Count first preferences among non-eliminated candidates
    const firstPrefs: Record<string, number> = {};
    for (const c of remaining) firstPrefs[c] = 0;

    for (const ballot of activeBallots) {
      const topChoice = ballot.rankings.find(r => !eliminated.has(r.provider));
      if (topChoice) {
        firstPrefs[topChoice.provider] = (firstPrefs[topChoice.provider] ?? 0) + 1;
      }
    }

    const totalVotes = Object.values(firstPrefs).reduce((a, b) => a + b, 0);
    const majority = totalVotes / 2;

    // Check for majority
    const sorted = Object.entries(firstPrefs).sort((a, b) => b[1] - a[1]);
    const prefsStr = sorted.map(([p, v]) => `${p}=${v}`).join(', ');
    
    if (sorted[0][1] > majority) {
      roundLog.push(`Round ${round}: ${prefsStr}. ${sorted[0][0]} has majority (${sorted[0][1]}/${totalVotes}).`);
      break;
    }

    // Eliminate lowest
    const minVotes = sorted[sorted.length - 1][1];
    const toEliminate = sorted.filter(([, v]) => v === minVotes).map(([p]) => p);
    // If tie at bottom, eliminate all tied
    for (const p of toEliminate) eliminated.add(p);

    roundLog.push(`Round ${round}: ${prefsStr}. Eliminated: ${toEliminate.join(', ')}.`);
  }

  // Build final rankings based on elimination order (last eliminated = lowest rank)
  const remaining = [...allCandidates].filter(c => !eliminated.has(c));
  const eliminatedOrder = [...eliminated]; // order of elimination
  const finalOrder = [...remaining, ...eliminatedOrder.reverse()];
  const rankings = finalOrder.map((provider, i) => ({ provider, score: finalOrder.length - i }));

  return {
    rankings,
    winner: remaining[0] ?? rankings[0]?.provider ?? '',
    method: 'ranked-choice',
    details: `Instant-runoff voting:\n${roundLog.join('\n')}`,
  };
}

/**
 * Approval voting: each voter approves top half of candidates. Most approvals wins.
 */
export function approvalVoting(ballots: Ballot[]): VotingResult {
  if (ballots.length === 0) {
    return { rankings: [], winner: '', method: 'approval', details: 'No ballots cast.' };
  }

  const approvals: Record<string, number> = {};
  const voterApprovals: string[] = [];

  for (const ballot of ballots) {
    const n = ballot.rankings.length;
    const approveThreshold = Math.ceil(n / 2); // top half
    const sorted = [...ballot.rankings].sort((a, b) => a.rank - b.rank);
    const approved = sorted.slice(0, approveThreshold).map(r => r.provider);

    for (const provider of approved) {
      approvals[provider] = (approvals[provider] ?? 0) + 1;
    }
    voterApprovals.push(`${ballot.voter} approves: ${approved.join(', ')}`);
  }

  const rankings = Object.entries(approvals)
    .map(([provider, score]) => ({ provider, score }))
    .sort((a, b) => b.score - a.score);

  // Include candidates with 0 approvals
  const allCandidates = new Set<string>();
  for (const b of ballots) for (const r of b.rankings) allCandidates.add(r.provider);
  for (const c of allCandidates) {
    if (!approvals[c]) rankings.push({ provider: c, score: 0 });
  }

  const winner = rankings[0]?.provider ?? '';

  return {
    rankings,
    winner,
    method: 'approval',
    details: `Approval voting (top half approved):\n${voterApprovals.join('\n')}\nResults: ${rankings.map(r => `${r.provider}=${r.score}`).join(', ')}.`,
  };
}

/**
 * Condorcet method: pairwise comparison. If a Condorcet winner exists (beats all others head-to-head),
 * they win. Otherwise, fall back to Borda count.
 */
export function condorcet(ballots: Ballot[]): VotingResult {
  if (ballots.length === 0) {
    return { rankings: [], winner: '', method: 'condorcet', details: 'No ballots cast.' };
  }

  const allCandidates = new Set<string>();
  for (const b of ballots) for (const r of b.rankings) allCandidates.add(r.provider);
  const candidates = [...allCandidates];

  // Build pairwise wins matrix
  // wins[a][b] = number of voters who prefer a over b
  const wins: Record<string, Record<string, number>> = {};
  for (const a of candidates) {
    wins[a] = {};
    for (const b of candidates) wins[a][b] = 0;
  }

  for (const ballot of ballots) {
    const rankMap = new Map(ballot.rankings.map(r => [r.provider, r.rank]));
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i], b = candidates[j];
        const ra = rankMap.get(a) ?? Infinity;
        const rb = rankMap.get(b) ?? Infinity;
        if (ra < rb) wins[a][b]++;
        else if (rb < ra) wins[b][a]++;
      }
    }
  }

  // Find Condorcet winner: beats all others in pairwise comparison
  const pairwiseLog: string[] = [];
  let condorcetWinner: string | null = null;

  for (const candidate of candidates) {
    const beatsAll = candidates.every(other => {
      if (other === candidate) return true;
      return wins[candidate][other] > wins[other][candidate];
    });
    if (beatsAll) {
      condorcetWinner = candidate;
      break;
    }
  }

  // Log pairwise results
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i], b = candidates[j];
      pairwiseLog.push(`${a} vs ${b}: ${wins[a][b]}-${wins[b][a]}`);
    }
  }

  if (condorcetWinner) {
    // Build rankings by number of pairwise wins
    const pairwiseWinCounts = candidates.map(c => ({
      provider: c,
      score: candidates.filter(o => o !== c && wins[c][o] > wins[o][c]).length,
    })).sort((a, b) => b.score - a.score);

    return {
      rankings: pairwiseWinCounts,
      winner: condorcetWinner,
      method: 'condorcet',
      details: `Condorcet winner found: ${condorcetWinner} beats all others head-to-head.\nPairwise: ${pairwiseLog.join('; ')}.`,
    };
  }

  // No Condorcet winner — fall back to Borda
  const bordaResult = bordaCount(ballots);
  return {
    rankings: bordaResult.rankings,
    winner: bordaResult.winner,
    method: 'condorcet',
    details: `No Condorcet winner (cycle detected). Pairwise: ${pairwiseLog.join('; ')}.\nFallback to Borda count: ${bordaResult.details}`,
  };
}

/**
 * Dispatch to the appropriate voting method.
 */
export function tallyWithMethod(
  ballots: Ballot[],
  method: 'borda' | 'ranked-choice' | 'approval' | 'condorcet' = 'borda',
): VotingResult {
  switch (method) {
    case 'borda': return bordaCount(ballots);
    case 'ranked-choice': return rankedChoice(ballots);
    case 'approval': return approvalVoting(ballots);
    case 'condorcet': return condorcet(ballots);
    default: return bordaCount(ballots);
  }
}
