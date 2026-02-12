/**
 * Auth layer — supports API keys, environment variables, and OAuth device flow.
 *
 * OAuth tokens stored in ~/.quorum/auth.json with auto-refresh.
 * Device flow: user visits a URL, enters a code, framework polls for token.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AuthConfig, AuthStore, OAuthToken, ProviderConfig } from './types.js';

const AUTH_PATH = join(homedir(), '.quorum', 'auth.json');

// Known OAuth configs per provider
const OAUTH_PROVIDERS: Record<string, {
  clientId: string;
  deviceAuthUrl: string;
  tokenUrl: string;
  scopes: string[];
}> = {
  openai: {
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann', // OpenAI public device client
    deviceAuthUrl: 'https://auth.openai.com/oauth/device/code',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    scopes: ['openai.public'],
  },
  google: {
    clientId: '', // Users provide their own via Google Cloud Console
    deviceAuthUrl: 'https://oauth2.googleapis.com/device/code',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/generative-language'],
  },
};

// --- Auth Store ---

async function loadAuthStore(): Promise<AuthStore> {
  if (!existsSync(AUTH_PATH)) return { version: 1, tokens: {} };
  try {
    return JSON.parse(await readFile(AUTH_PATH, 'utf-8'));
  } catch {
    return { version: 1, tokens: {} };
  }
}

async function saveAuthStore(store: AuthStore): Promise<void> {
  await mkdir(join(homedir(), '.quorum'), { recursive: true });
  await writeFile(AUTH_PATH, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

// --- Resolve credentials at runtime ---

/**
 * Resolve the API key/token for a provider config.
 * Handles all auth methods: api_key, env, oauth (with auto-refresh), legacy apiKey field.
 */
export async function resolveCredential(config: ProviderConfig): Promise<string | null> {
  const auth = config.auth;

  // Legacy compat: bare apiKey field
  if (!auth && config.apiKey) return config.apiKey;

  if (!auth || auth.method === 'none') return null;

  switch (auth.method) {
    case 'api_key':
      return auth.apiKey;

    case 'env':
      return process.env[auth.envVar] ?? null;

    case 'oauth': {
      const store = await loadAuthStore();
      const token = store.tokens[auth.profileName];
      if (!token) return null;

      // Check expiry, refresh if needed
      if (token.expiresAt && Date.now() > token.expiresAt - 60_000) {
        const refreshed = await refreshOAuthToken(token);
        if (refreshed) {
          store.tokens[auth.profileName] = refreshed;
          await saveAuthStore(store);
          return refreshed.accessToken;
        }
        return null; // refresh failed
      }

      return token.accessToken;
    }

    case 'oauth_keychain':
      return resolveKeychainOAuth(auth.service);
  }
}

/**
 * For OAuth tokens (like Claude Code's), exchange for a short-lived API key
 * via the provider's key exchange endpoint. Returns a usable API key.
 */
export async function exchangeOAuthForApiKey(
  oauthToken: string,
  provider: string,
): Promise<string | null> {
  if (provider === 'anthropic' && oauthToken.startsWith('sk-ant-oat')) {
    return exchangeAnthropicOAuth(oauthToken);
  }
  // Other providers can be added here
  return null;
}

/**
 * Exchange a Claude Code OAuth token for a short-lived Anthropic API key.
 * Uses the same endpoint Claude Code uses internally.
 */
async function exchangeAnthropicOAuth(oauthToken: string): Promise<string | null> {
  try {
    const resp = await fetch('https://api.anthropic.com/api/oauth/claude_cli/create_api_key', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${oauthToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'claude-code/1.0',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        name: 'quorum-session-key',
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`OAuth key exchange failed (${resp.status}): ${body}`);
      return null;
    }

    const data = await resp.json() as { api_key?: string; key?: string };
    return data.api_key ?? data.key ?? null;
  } catch (err) {
    console.error('OAuth key exchange error:', err);
    return null;
  }
}

// --- OAuth Device Flow ---

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

/**
 * Start OAuth device flow for a provider.
 * Returns instructions for the user and a poll function.
 */
export async function startDeviceFlow(
  provider: string,
  clientId?: string,
): Promise<{
  userCode: string;
  verificationUrl: string;
  poll: () => Promise<OAuthToken | null>;
}> {
  const oauthConfig = OAUTH_PROVIDERS[provider];
  if (!oauthConfig && !clientId) {
    throw new Error(`No OAuth config for "${provider}". Provide a clientId.`);
  }

  const resolvedClientId = clientId ?? oauthConfig.clientId;
  const deviceAuthUrl = oauthConfig?.deviceAuthUrl;
  const tokenUrl = oauthConfig?.tokenUrl;

  if (!deviceAuthUrl || !tokenUrl) {
    throw new Error(`OAuth URLs not configured for "${provider}".`);
  }

  // Request device code
  const resp = await fetch(deviceAuthUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: resolvedClientId,
      scope: (oauthConfig?.scopes ?? []).join(' '),
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    throw new Error(`Device auth request failed: ${resp.status}`);
  }

  const device = await resp.json() as DeviceCodeResponse;

  const poll = async (): Promise<OAuthToken | null> => {
    const deadline = Date.now() + device.expires_in * 1000;
    const interval = (device.interval || 5) * 1000;

    while (Date.now() < deadline) {
      await sleep(interval);

      const tokenResp = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: resolvedClientId,
          device_code: device.device_code,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (tokenResp.ok) {
        const data = await tokenResp.json() as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
        };

        const token: OAuthToken = {
          provider,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
          clientId: resolvedClientId,
          tokenUrl,
          scopes: oauthConfig?.scopes,
        };

        // Save to store
        const store = await loadAuthStore();
        store.tokens[provider] = token;
        await saveAuthStore(store);

        return token;
      }

      // Check if still pending
      const err = await tokenResp.json().catch(() => ({})) as { error?: string };
      if (err.error === 'authorization_pending' || err.error === 'slow_down') {
        continue;
      }

      // Expired or denied
      return null;
    }

    return null;
  };

  return {
    userCode: device.user_code,
    verificationUrl: device.verification_uri_complete ?? device.verification_uri,
    poll,
  };
}

// --- Refresh ---

async function refreshOAuthToken(token: OAuthToken): Promise<OAuthToken | null> {
  if (!token.refreshToken) return null;

  try {
    const resp = await fetch(token.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: token.clientId,
        refresh_token: token.refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) return null;

    const data = await resp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    return {
      ...token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? token.refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : token.expiresAt,
    };
  } catch {
    return null;
  }
}

// --- List stored OAuth profiles ---

export async function listOAuthProfiles(): Promise<Record<string, OAuthToken>> {
  const store = await loadAuthStore();
  return store.tokens;
}

export async function removeOAuthProfile(name: string): Promise<void> {
  const store = await loadAuthStore();
  delete store.tokens[name];
  await saveAuthStore(store);
}

// --- macOS Keychain OAuth (e.g. Claude Code) ---

interface KeychainOAuthData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

const KEYCHAIN_REFRESH_CONFIG: Record<string, { tokenUrl: string; clientId: string }> = {
  'Claude Code-credentials': {
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44ea-aac0-57992d009fdf',
  },
};

/**
 * Read OAuth token from macOS Keychain, auto-refresh if expired.
 * Supports Claude Code and any future keychain-stored OAuth.
 */
async function resolveKeychainOAuth(service: string): Promise<string | null> {
  try {
    const { execFileSync } = await import('node:child_process');
    const raw = execFileSync(
      'security', ['find-generic-password', '-s', service, '-w'],
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();

    const data = JSON.parse(raw);

    // Claude Code stores under claudeAiOauth key
    const oauth: KeychainOAuthData = data.claudeAiOauth ?? data;
    if (!oauth.accessToken) return null;

    // Check expiry
    if (oauth.expiresAt && Date.now() > oauth.expiresAt - 60_000) {
      // Try to refresh
      if (oauth.refreshToken) {
        const refreshed = await refreshKeychainToken(service, oauth);
        if (refreshed) return refreshed;
      }
      // Token expired, no refresh available
      return null;
    }

    return oauth.accessToken;
  } catch {
    return null;
  }
}

async function refreshKeychainToken(
  service: string,
  oauth: KeychainOAuthData,
): Promise<string | null> {
  const config = KEYCHAIN_REFRESH_CONFIG[service];
  if (!config || !oauth.refreshToken) return null;

  try {
    const resp = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.clientId,
        refresh_token: oauth.refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) return null;

    const tokens = await resp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    // Update keychain with new tokens
    const { execFileSync } = await import('node:child_process');
    const raw = execFileSync(
      'security', ['find-generic-password', '-s', service, '-w'],
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    const data = JSON.parse(raw);
    const updated = {
      ...data,
      claudeAiOauth: {
        ...(data.claudeAiOauth ?? {}),
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? oauth.refreshToken,
        expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      },
    };

    // Write back to keychain
    const encoded = JSON.stringify(updated);
    try {
      execFileSync('security', ['delete-generic-password', '-s', service], { timeout: 5000 });
    } catch {
      // May not exist yet
    }
    execFileSync(
      'security', ['add-generic-password', '-s', service, '-a', 'credentials', '-w', encoded],
      { timeout: 5000 },
    );

    return tokens.access_token;
  } catch {
    return null;
  }
}

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { AUTH_PATH };
