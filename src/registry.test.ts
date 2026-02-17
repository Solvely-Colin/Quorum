import { describe, it, expect } from 'vitest';
import {
  getProviderRegistry,
  getProviderModels,
  getAvailableProviders,
  QUORUM_PROVIDER_MAP,
  DISPLAY_NAMES,
  type ProviderInfo,
} from './registry.js';

describe('registry', () => {
  describe('getProviderRegistry', () => {
    it('returns a non-empty array of providers', () => {
      const registry = getProviderRegistry();
      expect(registry.length).toBeGreaterThan(0);
    });

    it('includes known providers', () => {
      const registry = getProviderRegistry();
      const ids = registry.map((p: ProviderInfo) => p.id);
      expect(ids).toContain('openai');
      expect(ids).toContain('anthropic');
      expect(ids).toContain('google');
    });

    it('each provider has required fields', () => {
      const registry = getProviderRegistry();
      for (const provider of registry) {
        expect(typeof provider.id).toBe('string');
        expect(typeof provider.piaiProvider).toBe('string');
        expect(typeof provider.displayName).toBe('string');
        expect(Array.isArray(provider.models)).toBe(true);
      }
    });

    it('models have required fields', () => {
      const registry = getProviderRegistry();
      // Pick a provider known to have models
      const openai = registry.find((p: ProviderInfo) => p.id === 'openai');
      expect(openai).toBeDefined();
      expect(openai!.models.length).toBeGreaterThan(0);

      const model = openai!.models[0];
      expect(typeof model.id).toBe('string');
      expect(typeof model.name).toBe('string');
      expect(typeof model.provider).toBe('string');
      expect(typeof model.api).toBe('string');
      expect(typeof model.baseUrl).toBe('string');
      expect(typeof model.reasoning).toBe('boolean');
      expect(Array.isArray(model.input)).toBe(true);
      expect(model.cost).toBeDefined();
      expect(typeof model.cost.input).toBe('number');
      expect(typeof model.cost.output).toBe('number');
      expect(typeof model.cost.cacheRead).toBe('number');
      expect(typeof model.cost.cacheWrite).toBe('number');
      expect(typeof model.contextWindow).toBe('number');
      expect(typeof model.maxTokens).toBe('number');
    });

    it('display names are set for known providers', () => {
      const registry = getProviderRegistry();
      const openai = registry.find((p: ProviderInfo) => p.id === 'openai');
      expect(openai!.displayName).toBe('OpenAI');
      const anthropic = registry.find((p: ProviderInfo) => p.id === 'anthropic');
      expect(anthropic!.displayName).toBe('Anthropic');
    });
  });

  describe('getProviderModels', () => {
    it('returns models for a known provider', () => {
      const models = getProviderModels('openai');
      expect(models.length).toBeGreaterThan(0);
      expect(typeof models[0].id).toBe('string');
    });

    it('returns empty array for unknown provider', () => {
      const models = getProviderModels('nonexistent-provider-xyz');
      expect(models).toEqual([]);
    });

    it('maps quorum names to pi-ai names', () => {
      // 'kimi' in quorum maps to 'kimi-coding' in pi-ai
      const models = getProviderModels('kimi');
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].provider).toBe('kimi-coding');
    });

    it('maps codex to openai-codex', () => {
      const models = getProviderModels('codex');
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].provider).toBe('openai-codex');
    });
  });

  describe('getAvailableProviders', () => {
    it('returns a non-empty string array', () => {
      const providers = getAvailableProviders();
      expect(providers.length).toBeGreaterThan(0);
      expect(typeof providers[0]).toBe('string');
    });

    it('includes core providers', () => {
      const providers = getAvailableProviders();
      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');
      expect(providers).toContain('google');
    });
  });

  describe('QUORUM_PROVIDER_MAP', () => {
    it('maps kimi to kimi-coding', () => {
      expect(QUORUM_PROVIDER_MAP['kimi']).toBe('kimi-coding');
    });

    it('maps codex to openai-codex', () => {
      expect(QUORUM_PROVIDER_MAP['codex']).toBe('openai-codex');
    });

    it('maps gemini-cli to google', () => {
      expect(QUORUM_PROVIDER_MAP['gemini-cli']).toBe('google');
    });
  });

  describe('DISPLAY_NAMES', () => {
    it('has entries for major providers', () => {
      expect(DISPLAY_NAMES['openai']).toBe('OpenAI');
      expect(DISPLAY_NAMES['anthropic']).toBe('Anthropic');
      expect(DISPLAY_NAMES['google']).toBe('Google');
      expect(DISPLAY_NAMES['mistral']).toBe('Mistral');
      expect(DISPLAY_NAMES['xai']).toBe('xAI');
    });
  });
});
