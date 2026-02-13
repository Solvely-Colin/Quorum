import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse, stringify } from 'yaml';
import { getModels } from '@mariozechner/pi-ai';
import type { KnownProvider } from '@mariozechner/pi-ai';
import type { AgentProfile, CounselConfig, ProviderConfig } from './types.js';

// Prefer ~/.quorum/, fall back to legacy ~/.counsel/ for backward compat
const LEGACY_CONFIG_DIR = join(homedir(), '.counsel');
const CONFIG_DIR = existsSync(join(homedir(), '.quorum'))
  ? join(homedir(), '.quorum')
  : existsSync(LEGACY_CONFIG_DIR)
    ? LEGACY_CONFIG_DIR
    : join(homedir(), '.quorum');
const CONFIG_PATH = join(CONFIG_DIR, 'config.yaml');

const DEFAULT_CONFIG: CounselConfig = {
  providers: [],
  defaultProfile: 'default',
  profiles: {},
};

export async function loadConfig(): Promise<CounselConfig> {
  // Check project-local first (quorum.yaml, legacy counsel.yaml), then global
  let localPath = join(process.cwd(), 'quorum.yaml');
  if (!existsSync(localPath)) localPath = join(process.cwd(), 'counsel.yaml');
  const path = existsSync(localPath) ? localPath : CONFIG_PATH;

  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  const raw = await readFile(path, 'utf-8');
  return { ...DEFAULT_CONFIG, ...parse(raw) };
}

export async function saveConfig(config: CounselConfig): Promise<void> {
  // Always save to ~/.quorum/ (the new canonical location)
  const saveDir = join(homedir(), '.quorum');
  const savePath = join(saveDir, 'config.yaml');
  await mkdir(saveDir, { recursive: true });
  await writeFile(savePath, stringify(config), { encoding: 'utf-8', mode: 0o600 });
}

export async function addProvider(provider: ProviderConfig): Promise<void> {
  const config = await loadConfig();
  config.providers = config.providers.filter((p) => p.name !== provider.name);
  config.providers.push(provider);
  await saveConfig(config);
}

/**
 * Auto-detect available AI providers on the system.
 * Checks environment variables for API keys and probes for local services.
 */
export async function detectProviders(): Promise<ProviderConfig[]> {
  const found: ProviderConfig[] = [];

  // 1. Environment variable API keys — resolve best model from pi-ai registry
  //    preferredModels: ordered list of preferred model IDs to look for in registry
  const envChecks: Array<{
    env: string;
    name: string;
    provider: ProviderConfig['provider'];
    piaiProvider: string;
    preferredModels: string[];
  }> = [
    {
      env: 'OPENAI_API_KEY',
      name: 'openai',
      provider: 'openai',
      piaiProvider: 'openai',
      preferredModels: ['gpt-5.2-pro', 'gpt-5-pro', 'o3-pro', 'gpt-4o', 'gpt-4o-mini'],
    },
    {
      env: 'ANTHROPIC_API_KEY',
      name: 'claude',
      provider: 'anthropic',
      piaiProvider: 'anthropic',
      preferredModels: ['claude-opus-4-1', 'claude-opus-4-0', 'claude-sonnet-4-20250514'],
    },
    {
      env: 'GOOGLE_API_KEY',
      name: 'gemini',
      provider: 'google',
      piaiProvider: 'google',
      preferredModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    },
    {
      env: 'MISTRAL_API_KEY',
      name: 'mistral',
      provider: 'mistral',
      piaiProvider: 'mistral',
      preferredModels: ['mistral-large-latest'],
    },
    {
      env: 'DEEPSEEK_API_KEY',
      name: 'deepseek',
      provider: 'deepseek',
      piaiProvider: 'deepseek',
      preferredModels: ['deepseek-chat'],
    },
    {
      env: 'KIMI_API_KEY',
      name: 'kimi',
      provider: 'kimi',
      piaiProvider: 'kimi-coding',
      preferredModels: ['k2p5', 'kimi-k2-thinking'],
    },
    {
      env: 'CODEX_ACCESS_TOKEN',
      name: 'codex',
      provider: 'codex' as ProviderConfig['provider'],
      piaiProvider: 'openai-codex',
      preferredModels: ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1'],
    },
  ];

  for (const check of envChecks) {
    if (process.env[check.env]) {
      // Query pi-ai for available models, match against our preference order
      let model = check.preferredModels[0];
      try {
        const models = getModels(check.piaiProvider as KnownProvider);
        if (models.length > 0) {
          // Pick first preferred model that exists in registry
          const match = check.preferredModels.find((pref) => models.some((m) => m.id === pref));
          model = match || models[0].id;
        }
      } catch {
        // Provider not in pi-ai registry, use first preferred
      }

      found.push({
        name: check.name,
        provider: check.provider,
        model,
        auth: { method: 'env' as const, envVar: check.env },
      });
    }
  }

  // 2. Claude Code OAuth (macOS Keychain) — only if no ANTHROPIC_API_KEY found
  if (!found.some((p) => p.name === 'claude')) {
    try {
      const { execFileSync } = await import('node:child_process');
      const raw = execFileSync(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      const data = JSON.parse(raw);
      const oauth = data.claudeAiOauth ?? data;
      if (oauth.accessToken && (!oauth.expiresAt || Date.now() < oauth.expiresAt - 60_000)) {
        found.push({
          name: 'claude',
          provider: 'anthropic',
          model: 'claude-opus-4-1',
          auth: { method: 'oauth_keychain' as const, service: 'Claude Code-credentials' },
        });
      }
    } catch {
      // Claude Code not installed or no keychain entry
    }
  }

  // 2b. Gemini CLI fallback — only if no GOOGLE_API_KEY was found above
  if (!found.some((p) => p.name === 'gemini')) {
    try {
      const { execFileSync } = await import('node:child_process');
      const version = execFileSync('gemini', ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (version) {
        found.push({
          name: 'gemini',
          provider: 'gemini-cli' as ProviderConfig['provider'],
          model: 'gemini-2.5-flash',
          auth: { method: 'none' as const },
        });
      }
    } catch {
      // Gemini CLI not installed
    }
  }

  // 3. Ollama (local)
  try {
    const resp = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      const allModels = data.models ?? [];
      // Filter out embedding models (not usable for chat/deliberation)
      const embedPatterns = /embed|nomic|bge|e5-|gte-|snowflake|all-minilm/i;
      const chatModels = allModels.filter((m) => !embedPatterns.test(m.name));
      // Prefer well-known chat models
      const preferredOllama = [
        'qwen2.5:32b',
        'qwen2.5:14b',
        'qwen2.5:7b',
        'llama3',
        'mistral',
        'codellama',
        'deepseek-coder',
      ];
      const models = chatModels.length > 0 ? chatModels : allModels;
      if (models.length > 0) {
        const preferred = preferredOllama.find((pref) =>
          models.some((m) => m.name.startsWith(pref)),
        );
        found.push({
          name: 'ollama',
          provider: 'ollama',
          model: preferred || models[0].name,
        });
      }
    }
  } catch {
    // Ollama not running
  }

  // 3. LM Studio (local, OpenAI-compatible)
  try {
    const resp = await fetch('http://localhost:1234/v1/models', {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { data?: Array<{ id: string }> };
      const models = data.data ?? [];
      if (models.length > 0) {
        found.push({
          name: 'lmstudio',
          provider: 'custom',
          model: models[0].id,
          baseUrl: 'http://localhost:1234/v1',
        });
      }
    }
  } catch {
    // LM Studio not running
  }

  return found;
}

/**
 * Load an agent profile from YAML file.
 * Searches: ./agents/, ~/.quorum/agents/, then built-in agents.
 */
export async function loadAgentProfile(name: string): Promise<AgentProfile | null> {
  const { fileURLToPath } = await import('node:url');
  const { dirname } = await import('node:path');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const builtinDir = join(__dirname, '..', 'agents');

  const searchPaths = [
    join(process.cwd(), 'agents', `${name}.yaml`),
    join(homedir(), '.quorum', 'agents', `${name}.yaml`),
    join(homedir(), '.counsel', 'agents', `${name}.yaml`), // legacy fallback
    join(builtinDir, `${name}.yaml`),
  ];

  for (const p of searchPaths) {
    if (existsSync(p)) {
      const raw = await readFile(p, 'utf-8');
      return parse(raw) as AgentProfile;
    }
  }

  return null;
}

/**
 * Project-local config from `.quorumrc` (YAML).
 * Walks from cwd up to homedir looking for `.quorumrc`.
 */
export interface ProjectConfig {
  path: string;
  profile?: string;
  providers?: string[];
  focus?: string[];
  challengeStyle?: 'adversarial' | 'collaborative' | 'socratic';
  rounds?: number;
  weights?: Record<string, number>;
}

export async function loadProjectConfig(): Promise<ProjectConfig | null> {
  const home = homedir();
  let dir = process.cwd();

  while (true) {
    // Prefer .quorumrc, fall back to legacy .counselrc
    let candidate = join(dir, '.quorumrc');
    if (!existsSync(candidate)) candidate = join(dir, '.counselrc');
    if (existsSync(candidate)) {
      const raw = await readFile(candidate, 'utf-8');
      const parsed = parse(raw) as Record<string, unknown> | null;
      if (parsed && typeof parsed === 'object') {
        return {
          path: candidate,
          profile: typeof parsed.profile === 'string' ? parsed.profile : undefined,
          providers: Array.isArray(parsed.providers) ? parsed.providers.map(String) : undefined,
          focus: Array.isArray(parsed.focus) ? parsed.focus.map(String) : undefined,
          challengeStyle:
            typeof parsed.challengeStyle === 'string' &&
            ['adversarial', 'collaborative', 'socratic'].includes(parsed.challengeStyle)
              ? (parsed.challengeStyle as ProjectConfig['challengeStyle'])
              : undefined,
          rounds: typeof parsed.rounds === 'number' ? parsed.rounds : undefined,
          weights:
            parsed.weights && typeof parsed.weights === 'object' && !Array.isArray(parsed.weights)
              ? (parsed.weights as Record<string, number>)
              : undefined,
        };
      }
    }

    // Stop at home directory
    if (dir === home) break;
    const parent = join(dir, '..');
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  return null;
}

export { CONFIG_PATH };
