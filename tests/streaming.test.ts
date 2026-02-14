import { describe, it, expect, vi } from 'vitest';
import { CouncilV2 } from '../src/council-v2.js';
import type { ProviderAdapter, ProviderConfig, AgentProfile } from '../src/types.js';

function makeAdapter(name: string, opts?: { stream?: boolean }): ProviderAdapter {
  const adapter: ProviderAdapter = {
    name,
    config: { name, provider: 'test', model: `${name}-model`, auth: { method: 'none' as const } },
    async generate() {
      return `Response from ${name}`;
    },
  };
  if (opts?.stream) {
    adapter.generateStream = async (_prompt, _sys, onDelta) => {
      const text = `Streamed from ${name}`;
      for (const ch of text) {
        onDelta(ch);
      }
      return text;
    };
  }
  return adapter;
}

function makeProfile(): AgentProfile {
  return {
    name: 'test',
    description: 'test profile',
    focus: ['testing'],
    challengeStyle: 'collaborative',
    rounds: 1,
    convergenceThreshold: 0.7,
  };
}

function makeProviderConfigs(names: string[]): ProviderConfig[] {
  return names.map((name) => ({
    name,
    provider: 'test',
    model: `${name}-model`,
    auth: { method: 'none' as const },
  }));
}

describe('Streaming events', () => {
  it('emits stream:start, stream:delta, stream:end when streaming is enabled', async () => {
    const adapters = [makeAdapter('alice', { stream: true }), makeAdapter('bob', { stream: true })];
    const configs = makeProviderConfigs(['alice', 'bob']);
    const events: Array<{ event: string; data: unknown }> = [];

    const council = new CouncilV2(adapters, configs, makeProfile(), {
      streaming: true,
      rapid: true,
      noHooks: true,
      noMemory: true,
      onEvent(event, data) {
        events.push({ event, data });
      },
    });

    await council.deliberate('Test question');

    const streamStarts = events.filter((e) => e.event === 'stream:start');
    const streamDeltas = events.filter((e) => e.event === 'stream:delta');
    const streamEnds = events.filter((e) => e.event === 'stream:end');

    // Should have stream events for both providers across phases
    expect(streamStarts.length).toBeGreaterThan(0);
    expect(streamDeltas.length).toBeGreaterThan(0);
    expect(streamEnds.length).toBeGreaterThan(0);

    // Each stream:start should have provider and phase
    for (const e of streamStarts) {
      const d = e.data as { provider: string; phase: string };
      expect(d.provider).toBeTruthy();
      expect(d.phase).toBeTruthy();
    }

    // Each stream:end should have duration
    for (const e of streamEnds) {
      const d = e.data as { provider: string; phase: string; duration: number };
      expect(d.duration).toBeGreaterThanOrEqual(0);
    }
  });

  it('falls back to non-streaming when generateStream is not available', async () => {
    const adapters = [makeAdapter('alice'), makeAdapter('bob')]; // no stream support
    const configs = makeProviderConfigs(['alice', 'bob']);
    const events: Array<{ event: string; data: unknown }> = [];

    const council = new CouncilV2(adapters, configs, makeProfile(), {
      streaming: true,
      rapid: true,
      noHooks: true,
      noMemory: true,
      onEvent(event, data) {
        events.push({ event, data });
      },
    });

    await council.deliberate('Test question');

    // Should have no stream events since adapters don't support streaming
    const streamStarts = events.filter((e) => e.event === 'stream:start');
    expect(streamStarts.length).toBe(0);

    // But should still have responses
    const responses = events.filter((e) => e.event === 'response');
    expect(responses.length).toBeGreaterThan(0);
  });

  it('calls onStreamDelta when streaming is enabled', async () => {
    const adapters = [makeAdapter('alice', { stream: true }), makeAdapter('bob', { stream: true })];
    const configs = makeProviderConfigs(['alice', 'bob']);
    const deltas: Array<{ provider: string; phase: string; delta: string }> = [];

    const council = new CouncilV2(adapters, configs, makeProfile(), {
      streaming: true,
      rapid: true,
      noHooks: true,
      noMemory: true,
      onStreamDelta(provider, phase, delta) {
        deltas.push({ provider, phase, delta });
      },
    });

    await council.deliberate('Test question');

    expect(deltas.length).toBeGreaterThan(0);
    // Verify deltas came from our adapters
    const providers = new Set(deltas.map((d) => d.provider));
    expect(providers.has('alice')).toBe(true);
    expect(providers.has('bob')).toBe(true);
  });
});

describe('CLI --live flag', () => {
  it('is accepted by the CLI parser', async () => {
    const { execSync } = await import('node:child_process');
    const cwd = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
    const result = execSync('node dist/cli.js ask --help', {
      cwd,
      encoding: 'utf-8',
    });
    expect(result).toContain('--live');
  });
});
