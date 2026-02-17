import { describe, it, expect } from 'vitest';
import { listOAuthProviders, getOAuthProviderById } from './oauth.js';

describe('listOAuthProviders', () => {
  it('returns an array of provider summaries', () => {
    const providers = listOAuthProviders();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
  });

  it('each provider has the expected shape', () => {
    const providers = listOAuthProviders();
    for (const p of providers) {
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('usesCallbackServer');
      expect(p).toHaveProperty('webCompatible');
      expect(typeof p.id).toBe('string');
      expect(typeof p.name).toBe('string');
      expect(typeof p.usesCallbackServer).toBe('boolean');
      expect(typeof p.webCompatible).toBe('boolean');
    }
  });
});

describe('getOAuthProviderById', () => {
  it('returns a provider with a login function for "anthropic"', () => {
    const provider = getOAuthProviderById('anthropic');
    expect(provider).toBeDefined();
    expect(provider!.id).toBe('anthropic');
    expect(typeof provider!.login).toBe('function');
  });

  it('returns undefined for a nonexistent provider', () => {
    const provider = getOAuthProviderById('nonexistent');
    expect(provider).toBeUndefined();
  });
});
