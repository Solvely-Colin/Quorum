/**
 * Context budget management — keeps prompts within provider limits.
 */

export interface ProviderLimits {
  contextLength: number;
  outputReserve: number;    // tokens reserved for output + reasoning
}

/** Known provider context limits */
export const PROVIDER_LIMITS: Record<string, ProviderLimits> = {
  'claude-cli':  { contextLength: 200_000, outputReserve: 4_096 },
  'anthropic':   { contextLength: 200_000, outputReserve: 4_096 },
  'kimi':        { contextLength: 262_144, outputReserve: 8_192 },  // reasoning eats tokens
  'ollama':      { contextLength: 8_192,   outputReserve: 2_048 },  // default num_ctx
  'openai':      { contextLength: 128_000, outputReserve: 4_096 },
  'google':      { contextLength: 1_000_000, outputReserve: 8_192 },
  'deepseek':    { contextLength: 128_000, outputReserve: 8_192 },
  'mistral':     { contextLength: 128_000, outputReserve: 4_096 },
};

/** Rough token estimate (~3.5 chars per token for English) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Available input tokens for a provider */
export function availableInput(provider: string, systemPromptTokens: number): number {
  const limits = PROVIDER_LIMITS[provider] ?? { contextLength: 32_000, outputReserve: 4_096 };
  return limits.contextLength - limits.outputReserve - systemPromptTokens;
}

/**
 * Fit multiple text blocks into a token budget.
 * Returns texts truncated/summarized to fit.
 * Priority items are kept full; others get proportionally trimmed.
 */
export function fitToBudget(
  blocks: Array<{ key: string; text: string; priority: 'full' | 'trimmable' }>,
  budgetTokens: number,
): Record<string, string> {
  const result: Record<string, string> = {};

  // First pass: calculate totals
  let fullTokens = 0;
  let trimmableTokens = 0;

  for (const b of blocks) {
    const tokens = estimateTokens(b.text);
    if (b.priority === 'full') fullTokens += tokens;
    else trimmableTokens += tokens;
  }

  const totalNeeded = fullTokens + trimmableTokens;

  // Everything fits
  if (totalNeeded <= budgetTokens) {
    for (const b of blocks) result[b.key] = b.text;
    return result;
  }

  // Keep full-priority items, trim the rest proportionally
  const remainingBudget = Math.max(0, budgetTokens - fullTokens);
  const trimRatio = trimmableTokens > 0 ? remainingBudget / trimmableTokens : 0;

  for (const b of blocks) {
    if (b.priority === 'full') {
      result[b.key] = b.text;
    } else {
      const maxChars = Math.floor(b.text.length * trimRatio);
      if (maxChars >= b.text.length) {
        result[b.key] = b.text;
      } else if (maxChars < 100) {
        result[b.key] = '[omitted — context budget exceeded]';
      } else {
        result[b.key] = b.text.slice(0, maxChars) + '\n\n[...truncated to fit context budget]';
      }
    }
  }

  return result;
}
