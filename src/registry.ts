/**
 * Provider & model registry — thin wrapper over pi-ai's getProviders()/getModels().
 *
 * Erases pi-ai's Model<Api> generic into plain, serializable interfaces
 * so web consumers can use them without importing pi-ai internals.
 */

import { getProviders, getModels } from '@mariozechner/pi-ai';
import type { KnownProvider } from '@mariozechner/pi-ai';

// ============================================================================
// Public interfaces — plain objects, no generics
// ============================================================================

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  input: string[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
}

export interface ProviderInfo {
  id: string;
  piaiProvider: string;
  displayName: string;
  models: ModelInfo[];
}

// ============================================================================
// Quorum ↔ pi-ai name mappings
// ============================================================================

/**
 * Maps quorum provider names to pi-ai KnownProvider names.
 * Only entries that differ are listed — everything else passes through.
 */
export const QUORUM_PROVIDER_MAP: Record<string, string> = {
  'gemini-cli': 'google',
  custom: 'openai',
  kimi: 'kimi-coding',
  codex: 'openai-codex',
};

/** Human-readable display names for providers. */
export const DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  'google-antigravity': 'Google Antigravity',
  'google-gemini-cli': 'Google Gemini CLI',
  'google-vertex': 'Google Vertex AI',
  'github-copilot': 'GitHub Copilot',
  mistral: 'Mistral',
  groq: 'Groq',
  xai: 'xAI',
  'kimi-coding': 'Kimi Coding',
  'openai-codex': 'OpenAI Codex',
  cerebras: 'Cerebras',
  huggingface: 'Hugging Face',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax CN',
  opencode: 'OpenCode',
  openrouter: 'OpenRouter',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  'amazon-bedrock': 'Amazon Bedrock',
  'azure-openai-responses': 'Azure OpenAI',
  zai: 'zAI',
};

// ============================================================================
// Registry functions
// ============================================================================

function mapModel(m: Record<string, unknown>): ModelInfo {
  return {
    id: m.id as string,
    name: m.name as string,
    provider: m.provider as string,
    api: m.api as string,
    baseUrl: m.baseUrl as string,
    reasoning: m.reasoning as boolean,
    input: m.input as string[],
    cost: m.cost as ModelInfo['cost'],
    contextWindow: m.contextWindow as number,
    maxTokens: m.maxTokens as number,
  };
}

/**
 * Get the full provider registry — all pi-ai providers with their models,
 * mapped to plain serializable objects.
 */
export function getProviderRegistry(): ProviderInfo[] {
  const piProviders = getProviders() as string[];
  return piProviders.map((piName) => {
    const models = getModels(piName as KnownProvider);
    return {
      id: piName,
      piaiProvider: piName,
      displayName: DISPLAY_NAMES[piName] ?? piName,
      models: models.map((m) => mapModel(m as unknown as Record<string, unknown>)),
    };
  });
}

/**
 * Get models for a single provider. Returns [] for unknown providers.
 */
export function getProviderModels(provider: string): ModelInfo[] {
  const piName = QUORUM_PROVIDER_MAP[provider] ?? provider;
  try {
    const models = getModels(piName as KnownProvider);
    return models.map((m) => mapModel(m as unknown as Record<string, unknown>));
  } catch {
    return [];
  }
}

/**
 * Get all available provider IDs (pi-ai names).
 */
export function getAvailableProviders(): string[] {
  return getProviders() as string[];
}
