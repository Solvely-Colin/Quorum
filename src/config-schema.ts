import { z } from 'zod';

const AuthConfigSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('api_key'), apiKey: z.string() }).passthrough(),
  z.object({ method: z.literal('oauth'), profileName: z.string() }).passthrough(),
  z.object({ method: z.literal('oauth_keychain'), service: z.string() }).passthrough(),
  z
    .object({
      method: z.literal('oauth_piai'),
      providerId: z.string(),
      credentials: z
        .object({
          refresh: z.string(),
          access: z.string(),
          expires: z.number(),
        })
        .passthrough(),
    })
    .passthrough(),
  z.object({ method: z.literal('env'), envVar: z.string() }).passthrough(),
  z.object({ method: z.literal('none') }).passthrough(),
]);

const ProviderConfigSchema = z
  .object({
    name: z.string(),
    provider: z.enum([
      'openai',
      'anthropic',
      'codex',
      'ollama',
      'google',
      'gemini-cli',
      'mistral',
      'deepseek',
      'kimi',
      'groq',
      'xai',
      'custom',
    ]),
    model: z.string(),
    auth: AuthConfigSchema.optional(),
    baseUrl: z.string().optional(),
    timeout: z.number().optional(),
    apiKey: z.string().optional(),
  })
  .passthrough();

export const CounselConfigSchema = z
  .object({
    providers: z.array(ProviderConfigSchema).default([]),
    defaultProfile: z.string().default('default'),
    profiles: z.record(z.string(), z.any()).default({}),
  })
  .passthrough();
