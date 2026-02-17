/**
 * OAuth passthrough — thin wrapper over pi-ai's OAuth system.
 *
 * Re-exports pi-ai types and provides simplified functions for:
 * - Listing available OAuth providers
 * - Starting OAuth login flows
 * - Refreshing credentials
 * - Extracting API keys from OAuth credentials
 */

import { getOAuthProviders, getOAuthProvider, getOAuthApiKey } from '@mariozechner/pi-ai';

import type {
  OAuthCredentials,
  OAuthLoginCallbacks,
  OAuthProviderInterface,
  OAuthAuthInfo,
  OAuthPrompt,
} from '@mariozechner/pi-ai';

// Re-export pi-ai types for consumers
export type {
  OAuthCredentials,
  OAuthLoginCallbacks,
  OAuthProviderInterface,
  OAuthAuthInfo,
  OAuthPrompt,
};

export interface OAuthProviderSummary {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  webCompatible: boolean;
}

/**
 * List all available OAuth providers with summary info.
 */
export function listOAuthProviders(): OAuthProviderSummary[] {
  return getOAuthProviders().map((p) => ({
    id: p.id,
    name: p.name,
    usesCallbackServer: p.usesCallbackServer ?? false,
    // All pi-ai providers support manual code input as fallback
    webCompatible: true,
  }));
}

/**
 * Get an OAuth provider by ID.
 */
export function getOAuthProviderById(id: string): OAuthProviderInterface | undefined {
  return getOAuthProvider(id);
}

/**
 * Start an OAuth login flow for the given provider.
 */
export async function startOAuthLogin(
  providerId: string,
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
  const provider = getOAuthProvider(providerId);
  if (!provider) throw new Error(`Unknown OAuth provider: "${providerId}"`);
  return provider.login(callbacks);
}

/**
 * Refresh expired OAuth credentials.
 */
export async function refreshOAuthCredentials(
  providerId: string,
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
  const provider = getOAuthProvider(providerId);
  if (!provider) throw new Error(`Unknown OAuth provider: "${providerId}"`);
  return provider.refreshToken(credentials);
}

/**
 * Extract an API key from OAuth credentials, auto-refreshing if expired.
 * Returns both the key and (potentially refreshed) credentials to persist.
 */
export async function getApiKeyFromOAuth(
  providerId: string,
  credentials: OAuthCredentials,
): Promise<{ apiKey: string; credentials: OAuthCredentials }> {
  const result = await getOAuthApiKey(providerId, { [providerId]: credentials });
  if (!result) throw new Error(`Failed to get API key for OAuth provider "${providerId}"`);
  return { apiKey: result.apiKey, credentials: result.newCredentials };
}
