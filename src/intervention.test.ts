import { describe, it, expect } from 'vitest';
import {
  createHalt,
  createRedirect,
  createInjectEvidence,
  createRequestClarification,
  type Intervention,
} from './intervention.js';

describe('intervention', () => {
  describe('createHalt', () => {
    it('creates a halt intervention with hash', () => {
      const i = createHalt('DEBATE', 'Need expert input');
      expect(i.type).toBe('halt');
      expect(i.phase).toBe('DEBATE');
      expect(i.content).toBe('Need expert input');
      expect(i.hash).toBeTruthy();
      expect(i.timestamp).toBeGreaterThan(0);
    });
  });

  describe('createRedirect', () => {
    it('creates a redirect with constraints', () => {
      const i = createRedirect('GATHER', 'Wrong framing', ['focus on cost', 'ignore legacy']);
      expect(i.type).toBe('redirect');
      expect(i.constraints).toEqual(['focus on cost', 'ignore legacy']);
      expect(i.hash).toBeTruthy();
    });
  });

  describe('createInjectEvidence', () => {
    it('creates evidence injection with data', () => {
      const evidence = { source: 'arxiv', data: [1, 2, 3] };
      const i = createInjectEvidence('FORMULATE', 'New paper found', evidence);
      expect(i.type).toBe('inject-evidence');
      expect(i.evidence).toEqual(evidence);
      expect(i.content).toBe('New paper found');
      expect(i.hash).toBeTruthy();
    });
  });

  describe('createRequestClarification', () => {
    it('creates a clarification request', () => {
      const i = createRequestClarification('VOTE', 'What does "best" mean here?');
      expect(i.type).toBe('request-clarification');
      expect(i.content).toBe('What does "best" mean here?');
      expect(i.hash).toBeTruthy();
    });
  });

  describe('hash uniqueness', () => {
    it('different interventions have different hashes', () => {
      const a = createHalt('DEBATE', 'reason A');
      const b = createHalt('DEBATE', 'reason B');
      expect(a.hash).not.toBe(b.hash);
    });

    it('same type different phase has different hash', () => {
      // Timestamps will differ slightly, ensuring different hashes
      const a = createHalt('GATHER', 'same reason');
      const b = createHalt('DEBATE', 'same reason');
      expect(a.hash).not.toBe(b.hash);
    });
  });
});
