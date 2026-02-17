import type { ProviderAdapter, ProviderConfig } from '../types.js';
import { resolveCredential } from '../auth.js';
import { completeSimple, streamSimple, getModels } from '@mariozechner/pi-ai';
import type {
  Api,
  Model,
  SimpleStreamOptions,
  KnownProvider,
  AssistantMessageEvent,
} from '@mariozechner/pi-ai';

// ============================================================================
// Auto-credential resolution for CLI-authed providers
// ============================================================================

/**
 * Read Claude Code's OAuth token from macOS Keychain.
 * Returns sk-ant-oat-* token which pi-ai handles natively (Bearer auth).
 *
 * Platform: macOS only — uses the `security` CLI (Keychain Services).
 * On Linux/Windows this returns null (no keychain available).
 */
async function resolveClaudeOAuthToken(): Promise<string | null> {
  // macOS-only: `security` CLI is not available on Linux/Windows
  if (process.platform !== 'darwin') return null;
  try {
    const { execFileSync } = await import('node:child_process');
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    const data = JSON.parse(raw);
    const oauth = data.claudeAiOauth ?? data;
    if (!oauth.accessToken) return null;
    // Check expiry (with 60s buffer)
    if (oauth.expiresAt && Date.now() > oauth.expiresAt - 60_000) return null;
    return oauth.accessToken;
  } catch {
    return null;
  }
}

// Note: Gemini CLI's OAuth token has cloud-platform scope (Vertex AI), not
// generativelanguage scope (AI Studio). Can't use it with pi-ai's google provider.
// If GOOGLE_API_KEY is set, the google provider works directly via pi-ai.
// Otherwise, we fall back to the gemini-cli child process shim.

// ============================================================================
// Pi-ai model resolution
// ============================================================================

/**
 * Map our simple provider config to a pi-ai Model descriptor.
 * If the model exists in pi-ai's registry, use that. Otherwise build one.
 */
function resolveModel(config: ProviderConfig): Model<Api> {
  // Check pi-ai's built-in model registry first
  const piProvider = mapProvider(config.provider);
  try {
    const all = getModels(piProvider as KnownProvider);
    const registered = all.find((m) => m.id === config.model);
    if (registered) {
      const resolved = {
        ...registered,
        baseUrl: config.baseUrl || registered.baseUrl,
      } as Model<Api>;
      // Kimi's anthropic-compatible endpoint doesn't support Anthropic-specific
      // beta headers (fine-grained-tool-streaming, interleaved-thinking, etc.).
      // These cause hangs/undefined behavior. Override to suppress them.
      if (config.provider === 'kimi') {
        (resolved as any).headers = {
          'anthropic-beta': 'none',
          'anthropic-dangerous-direct-browser-access': 'false',
        };
      }
      return resolved;
    }
  } catch {
    // Provider not in registry, build manually
  }

  // Build a model descriptor from config
  const { api, provider, baseUrl } = resolveApiDetails(config);
  return {
    id: config.model,
    name: config.name,
    api,
    provider,
    baseUrl,
    reasoning: false,
    input: ['text'] as ('text' | 'image')[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    headers: {},
  } as Model<Api>;
}

/**
 * Map Quorum provider names to pi-ai provider keys.
 * Most providers pass through directly — pi-ai handles them natively
 * (anthropic, openai, google, xai, groq, mistral, deepseek, ollama, etc.).
 * Only remap names that differ between Quorum config and pi-ai's registry.
 */
function mapProvider(p: ProviderConfig['provider']): string {
  switch (p) {
    case 'gemini-cli':
      return 'google'; // Quorum CLI shim; not a real pi-ai provider
    case 'custom':
      return 'openai'; // OpenAI-compatible custom endpoints
    case 'kimi':
      return 'kimi-coding'; // pi-ai's name for this provider
    case 'codex':
      return 'openai-codex'; // pi-ai's name for this provider
    default:
      return p; // pi-ai handles directly
  }
}

/**
 * Resolve API type + provider + baseUrl for a model not found in pi-ai's registry.
 * Delegates to pi-ai for known providers (anthropic, openai, google, xai, groq,
 * mistral, kimi-coding, openai-codex, etc.) by reading defaults from any registered
 * model. This keeps Quorum in sync as pi-ai adds providers or updates base URLs.
 * Only falls back to hardcoded values for providers pi-ai doesn't cover.
 */
function resolveApiDetails(config: ProviderConfig): {
  api: Api;
  provider: string;
  baseUrl: string;
} {
  // Handle providers pi-ai doesn't cover before attempting registry lookup
  switch (config.provider) {
    case 'deepseek':
      return {
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: config.baseUrl || 'https://api.deepseek.com/v1',
      };
    case 'ollama':
      return {
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: config.baseUrl || 'http://localhost:11434/v1',
      };
    case 'custom':
      // Custom endpoints use /v1/chat/completions (not responses) for broadest compat
      return { api: 'openai-completions', provider: 'openai', baseUrl: config.baseUrl || '' };
  }

  // Delegate to pi-ai: infer api/baseUrl from a registered model for this provider.
  const piProvider = mapProvider(config.provider);
  try {
    const models = getModels(piProvider as KnownProvider);
    if (models.length > 0) {
      const ref = models[0];
      return {
        api: ref.api,
        provider: ref.provider,
        baseUrl: config.baseUrl || ref.baseUrl,
      };
    }
  } catch {
    // Not a known pi-ai provider — fall through to default
  }

  // Unknown provider — assume OpenAI-compatible. Requires explicit baseUrl in config.
  return {
    api: 'openai-completions',
    provider: config.provider,
    baseUrl: config.baseUrl || '',
  };
}

// ============================================================================
// Provider creation — all through pi-ai, no CLI shims
// ============================================================================

/**
 * Resolve the API key for a provider, with auto-detection of CLI-authed tokens.
 * Priority: explicit config → env var → CLI OAuth tokens (keychain/creds files)
 */
async function resolveApiKey(config: ProviderConfig): Promise<string> {
  // 1. Explicit credential from auth config
  const credential = await resolveCredential(config);
  if (credential) return credential;

  // 2. Legacy apiKey field
  if (config.apiKey) return config.apiKey;

  // 3. Environment variables
  const envKey = process.env[`${config.provider.toUpperCase()}_API_KEY`];
  if (envKey) return envKey;

  // 4. Provider-specific env vars
  if (config.provider === 'codex' && process.env.CODEX_ACCESS_TOKEN) {
    return process.env.CODEX_ACCESS_TOKEN;
  }

  // 5. Auto-detect CLI OAuth tokens
  if (config.provider === 'anthropic') {
    const token = await resolveClaudeOAuthToken();
    if (token) return token; // pi-ai detects sk-ant-oat-* and uses Bearer auth
  }

  if (config.provider === 'google' || config.provider === 'gemini-cli') {
    if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  }

  // 6. Local providers don't need a key
  if (config.provider === 'ollama' || config.provider === 'custom') {
    return 'ollama'; // placeholder, not validated
  }

  // 7. Fallback
  return '';
}

/**
 * Create a provider adapter from config.
 * Gemini CLI uses a child-process shim (OAuth scope mismatch with AI Studio).
 * Everything else goes through pi-ai's unified API.
 */
export async function createProvider(config: ProviderConfig): Promise<ProviderAdapter> {
  // Gemini CLI shim — only used as fallback when no GOOGLE_API_KEY is available.
  // The CLI's OAuth token has cloud-platform scope (Vertex AI), not AI Studio scope.
  if (config.provider === 'gemini-cli') {
    // Always use CLI shim when explicitly configured as gemini-cli.
    // The CLI uses Vertex AI OAuth which has separate quota from AI Studio API keys.
    return createGeminiCli(config);
  }

  const apiKey = await resolveApiKey(config);
  const resolved = { ...config, apiKey };
  const model = resolveModel(resolved);
  const timeoutMs = (resolved.timeout ?? 120) * 1000;

  const buildOpts = (): SimpleStreamOptions => ({
    apiKey,
    maxTokens: 4096,
    ...(!['codex', 'google', 'kimi'].includes(resolved.provider) ? { reasoning: 'low' } : {}),
  });

  const buildContext = (prompt: string, systemPrompt?: string) => ({
    systemPrompt,
    messages: [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: prompt }],
        timestamp: Date.now(),
      },
    ],
  });

  const extractText = (result: {
    errorMessage?: string;
    content: Array<{ type: string; text?: string }>;
  }): string => {
    if (result.errorMessage) {
      throw new Error(
        `${resolved.provider}/${resolved.model}: ${result.errorMessage.slice(0, 200)}`,
      );
    }
    for (const block of result.content) {
      if (block.type === 'text' && block.text) return block.text;
    }
    for (const block of result.content) {
      if (block.type === 'thinking' && (block as any).thinking) return (block as any).thinking;
    }
    return '';
  };

  const withTimeout = <T>(promise: Promise<T>, label: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)),
          timeoutMs,
        ),
      ),
    ]);
  };

  return {
    name: resolved.name,
    config: resolved,
    async generate(prompt: string, systemPrompt?: string) {
      const result = await withTimeout(
        completeSimple(model, buildContext(prompt, systemPrompt), buildOpts()),
        `${resolved.name}`,
      );
      return extractText(result as any);
    },
    async generateStream(
      prompt: string,
      systemPrompt: string | undefined,
      onDelta: (delta: string) => void,
    ) {
      const ac = new AbortController();
      const timeoutId = setTimeout(() => ac.abort(), timeoutMs);
      const stream = streamSimple(model, buildContext(prompt, systemPrompt), buildOpts());
      let text = '';
      try {
        const abortPromise = new Promise<never>((_, reject) => {
          ac.signal.addEventListener(
            'abort',
            () => {
              // Close the underlying stream connection
              (
                stream as AsyncIterable<AssistantMessageEvent> & {
                  [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent>;
                }
              )
                [Symbol.asyncIterator]()
                .return?.();
              reject(new Error(`${resolved.name} stream timed out after ${timeoutMs / 1000}s`));
            },
            { once: true },
          );
        });
        const iterate = async () => {
          let lastChunkTime = Date.now();
          let gotFirstChunk = false;
          const idleCheckInterval = setInterval(() => {
            const idleMs = Date.now() - lastChunkTime;
            // 15s for first chunk (connection timeout), 30s after that (idle timeout)
            const threshold = gotFirstChunk ? 30000 : 15000;
            if (idleMs > threshold) {
              ac.abort();
            }
          }, 3000);
          try {
            for await (const event of stream as AsyncIterable<AssistantMessageEvent>) {
              if (ac.signal.aborted) break;
              if (event.type === 'text_delta') {
                lastChunkTime = Date.now();
                gotFirstChunk = true;
                text += event.delta;
                onDelta(event.delta);
              } else if (event.type === 'error') {
                throw new Error(`${resolved.name} stream error`);
              }
            }
          } finally {
            clearInterval(idleCheckInterval);
          }
        };
        await Promise.race([iterate(), abortPromise]);
      } catch (err) {
        // If we have partial text and it was a timeout, return what we have
        if (text && ac.signal.aborted) {
          return text;
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
      if (!text) {
        const result = await stream.result();
        return extractText(result as any);
      }
      return text;
    },
  };
}

// ============================================================================
// Gemini CLI Shim (child process)
// The Gemini CLI's OAuth token has cloud-platform scope (Vertex AI only).
// Pi-ai's google provider needs generativelanguage scope (AI Studio).
// Until we add Vertex AI support or get a GOOGLE_API_KEY, shell out to `gemini -p`.
// ============================================================================

async function createGeminiCli(config: ProviderConfig): Promise<ProviderAdapter> {
  // Verify gemini CLI is installed before creating the adapter
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('which', ['gemini'], { stdio: 'pipe' });
  } catch {
    throw new Error(
      'gemini CLI not found. Install it: npm i -g @google/gemini-cli\n' +
        'Or set GOOGLE_API_KEY to use the Google AI Studio API directly.',
    );
  }

  const timeoutMs = (config.timeout ?? 120) * 1000;
  return {
    name: config.name,
    config,
    async generate(prompt: string, systemPrompt?: string) {
      const input = systemPrompt ? `<system>${systemPrompt}</system>\n\n${prompt}` : prompt;
      const args = ['-p', input, '--sandbox'];
      if (config.model) args.push('-m', config.model);

      const { spawn } = await import('node:child_process');
      return new Promise<string>((resolve, reject) => {
        let settled = false;
        const proc = spawn('gemini', args, {
          env: { ...process.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '',
          stderr = '';
        proc.stdout.on('data', (d: Buffer) => {
          stdout += d.toString();
        });
        proc.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        proc.on('close', (code) => {
          if (settled) return;
          settled = true;
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            reject(new Error(`gemini-cli exited ${code}: ${stderr}`));
          }
        });
        proc.on('error', (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          proc.kill();
          reject(new Error(`gemini-cli timeout (${timeoutMs / 1000}s)`));
        }, timeoutMs);
        proc.on('close', () => clearTimeout(timer));
      });
    },
  };
}
