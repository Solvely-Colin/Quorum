import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules before importing the module under test
vi.mock('../config.js', () => ({
  loadConfig: vi.fn(),
  CONFIG_PATH: '/home/test/.quorum/config.yaml',
}));

vi.mock('../providers/base.js', () => ({
  createProvider: vi.fn(),
}));

import { runDoctor } from './doctor.js';
import { loadConfig } from '../config.js';
import { createProvider } from '../providers/base.js';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

// Mock existsSync for config file check
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn(actual.existsSync), readFileSync: actual.readFileSync };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

// Mock fetch for npm version check
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: config file exists
  (existsSync as any).mockImplementation((path: string) => {
    if (path === '/home/test/.quorum/config.yaml') return true;
    const { existsSync: real } = vi.importActual<typeof import('node:fs')>('node:fs') as any;
    return real(path);
  });
  // Mock readFile for config path to return valid YAML
  (readFile as any).mockImplementation(async (path: string, enc?: string) => {
    if (path === '/home/test/.quorum/config.yaml') {
      return 'providers:\n  - name: test\n    provider: openai\n    model: gpt-4o\n';
    }
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    return actual.readFile(path, enc as any);
  });
  // Default: npm returns current version
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ version: '0.0.0' }), // will differ from actual
  });
});

describe('doctor', () => {
  it('returns 0 when all checks pass', async () => {
    (loadConfig as any).mockResolvedValue({
      providers: [{ name: 'test-provider', provider: 'openai', model: 'gpt-4o' }],
    });
    (createProvider as any).mockResolvedValue({
      generate: vi.fn().mockResolvedValue('ok'),
    });

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runDoctor();
    spy.mockRestore();

    // May be 0 or non-zero depending on version mismatch (warn, not error)
    // Provider check should pass
    expect(code).toBe(0);
  });

  it('returns 1 when config file is missing', async () => {
    (existsSync as any).mockImplementation((path: string) => {
      if (path === '/home/test/.quorum/config.yaml') return false;
      const { existsSync: real } = vi.importActual<typeof import('node:fs')>('node:fs') as any;
      return real(path);
    });

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runDoctor();
    spy.mockRestore();

    expect(code).toBe(1);
  });

  it('returns 1 when a provider fails auth', async () => {
    (loadConfig as any).mockResolvedValue({
      providers: [{ name: 'bad-provider', provider: 'openai', model: 'gpt-4o' }],
    });
    (createProvider as any).mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { status: 401 }),
    );

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runDoctor();
    spy.mockRestore();

    expect(code).toBe(1);
  });

  it('returns 1 when provider connection is refused', async () => {
    (loadConfig as any).mockResolvedValue({
      providers: [{ name: 'ollama', provider: 'ollama', model: 'llama3' }],
    });
    (createProvider as any).mockRejectedValue(
      Object.assign(new Error('fetch failed: ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runDoctor();
    spy.mockRestore();

    expect(code).toBe(1);
  });

  it('handles multiple providers with mixed results', async () => {
    (loadConfig as any).mockResolvedValue({
      providers: [
        { name: 'good', provider: 'openai', model: 'gpt-4o' },
        { name: 'bad', provider: 'deepseek', model: 'deepseek-chat' },
      ],
    });
    (createProvider as any).mockImplementation(async (config: any) => {
      if (config.name === 'good') {
        return { generate: vi.fn().mockResolvedValue('ok') };
      }
      throw Object.assign(new Error('402 Payment Required'), { status: 402 });
    });

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runDoctor();
    spy.mockRestore();

    expect(code).toBe(1);
  });
});
