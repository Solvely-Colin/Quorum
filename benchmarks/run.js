#!/usr/bin/env node

/**
 * Quorum local overhead benchmarks.
 * Measures computation costs without any API calls.
 */

import { tallyWithMethod } from '../dist/voting.js';
import { generateHeatmap } from '../dist/heatmap.js';

function bench(name, fn, iterations = 1000) {
  // Warmup
  for (let i = 0; i < 10; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;

  const perOp = (elapsed / iterations).toFixed(3);
  console.log(`  ${name}: ${perOp}ms/op (${iterations} iterations, ${elapsed.toFixed(1)}ms total)`);
}

console.log('Quorum Local Overhead Benchmarks\n');

// --- Voting ---
console.log('Voting:');

const providers = ['claude', 'openai', 'gemini', 'kimi', 'deepseek'];
const positions = providers.map((p) => ({ provider: p, content: `Position from ${p}` }));

const ballots = providers.map((voter) => ({
  voter,
  rankings: [...providers].sort(() => Math.random() - 0.5),
}));

bench('Borda (5 providers)', () => {
  tallyWithMethod(ballots, positions, 'borda');
});

bench('Ranked-choice (5 providers)', () => {
  tallyWithMethod(ballots, positions, 'ranked-choice');
});

bench('Approval (5 providers)', () => {
  tallyWithMethod(ballots, positions, 'approval');
});

bench('Condorcet (5 providers)', () => {
  tallyWithMethod(ballots, positions, 'condorcet');
});

// --- Heatmap ---
console.log('\nHeatmap:');

const mockBallots = providers.map((voter) => ({
  voter,
  rankings: [...providers].sort(() => Math.random() - 0.5),
}));

bench('Heatmap generation (5 providers)', () => {
  generateHeatmap(mockBallots);
});

// --- Session serialization ---
console.log('\nSerialization:');

const mockSession = {
  id: 'bench-session',
  input: 'Test question for benchmarking',
  profile: { name: 'default', rounds: 1, focus: [], challengeStyle: 'adversarial' },
  providers: providers,
  rounds: [
    {
      number: 1,
      responses: providers.map((p) => ({
        provider: p,
        content: 'A '.repeat(500),
        round: 1,
        phase: 'diverge',
        timestamp: Date.now(),
      })),
      critiques: [],
      rebuttals: [],
    },
  ],
  synthesis: {
    content: 'Synthesized answer '.repeat(100),
    synthesizer: 'openai',
    consensusScore: 0.85,
    confidenceScore: 0.9,
    controversial: false,
    contributions: Object.fromEntries(providers.map((p) => [p, ['point 1', 'point 2']])),
  },
  startedAt: Date.now(),
  completedAt: Date.now(),
};

bench('JSON.stringify (session)', () => {
  JSON.stringify(mockSession);
});

bench('JSON.parse (session)', () => {
  JSON.parse(JSON.stringify(mockSession));
});

console.log('\nDone.');
