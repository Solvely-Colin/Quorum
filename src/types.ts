/**
 * Core types for Quorum
 */

// --- Provider ---

export interface ProviderConfig {
  name: string;
  provider: 'openai' | 'anthropic' | 'codex' | 'ollama' | 'google' | 'gemini-cli' | 'mistral' | 'deepseek' | 'kimi' | 'custom';
  model: string;
  auth?: AuthConfig;
  baseUrl?: string;
  /** Per-provider timeout in seconds (default 120) */
  timeout?: number;
  /** @deprecated Use auth.apiKey instead. Still works for backwards compat. */
  apiKey?: string;
}

export type AuthConfig =
  | { method: 'api_key'; apiKey: string }
  | { method: 'oauth'; profileName: string }  // references stored OAuth token
  | { method: 'oauth_keychain'; service: string }  // reads OAuth from macOS keychain (e.g. Claude Code)
  | { method: 'env'; envVar: string }          // reads key from env at runtime
  | { method: 'none' };                        // local models (Ollama, LM Studio)

export interface OAuthToken {
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;       // epoch ms
  clientId: string;
  tokenUrl: string;
  scopes?: string[];
}

export interface AuthStore {
  version: 1;
  tokens: Record<string, OAuthToken>;  // keyed by profile name
}

export interface ProviderAdapter {
  name: string;
  config?: ProviderConfig;
  generate(prompt: string, systemPrompt?: string): Promise<string>;
  /** Streaming generate — calls onDelta with text chunks, returns full text */
  generateStream?(prompt: string, systemPrompt: string | undefined, onDelta: (delta: string) => void): Promise<string>;
}

// --- Agent File (Deliberation Profile) ---

export interface PhasePrompts {
  // V2 phases
  gather?: { system: string };
  plan?: { system: string };
  formulate?: { system: string };
  debate?: { system: string };
  adjust?: { system: string };
  rebuttal?: { system: string };
  vote?: { system: string };
  synthesize?: { system: string };
  // V1 legacy
  diverge?: { system: string };
  challenge?: { system: string };
  defend?: { system: string };
}

export interface AgentProfile {
  name: string;
  rounds: number;
  convergenceThreshold?: number;
  focus: string[];
  challengeStyle: 'adversarial' | 'collaborative' | 'socratic';
  scoringWeights: ScoringWeights;
  isolation: boolean;
  blindReview: boolean;
  prompts?: PhasePrompts;
  phases?: string[];  // custom phase pipeline, e.g. ['gather', 'debate', 'synthesize']
  excludeFromDeliberation?: string[];  // provider names to skip (e.g. ['ollama'])
  roles?: Record<string, string>;  // provider name → role description
  devilsAdvocate?: boolean;
  decisionMatrix?: boolean;
  weights?: Record<string, number>;
  votingMethod?: 'borda' | 'ranked-choice' | 'approval' | 'condorcet';
  hooks?: Record<string, string>;  // e.g. "pre-gather" → shell command
  tools?: boolean;          // enable tool use in gather phase (default: false)
  allowShellTool?: boolean; // enable shell tool (default: false, requires tools: true)
  evidence?: 'off' | 'advisory' | 'strict';  // evidence-backed claims mode (default: 'off')
  adaptive?: 'fast' | 'balanced' | 'critical' | 'off';
  redTeam?: boolean;
  attackPacks?: string[];          // e.g. ['security', 'code']
  customAttacks?: string[];        // custom attack prompts
}

export interface ScoringWeights {
  accuracy: number;
  reasoning: number;
  completeness: number;
  novelty: number;
  consensus: number;
}

// --- Deliberation ---

export interface Response {
  provider: string;
  content: string;
  round: number;
  phase: 'diverge' | 'challenge' | 'defend' | 'converge';
  timestamp: number;
}

export interface Critique {
  reviewer: string;       // which provider reviewed
  target: string;         // which provider's response was reviewed
  targetContent?: string; // only included if blind review is off
  content: string;
  round: number;
}

export interface DeliberationSession {
  id: string;
  input: string;
  profile: AgentProfile;
  providers: string[];
  rounds: Round[];
  synthesis: Synthesis | null;
  startedAt: number;
  completedAt?: number;
}

export interface Round {
  number: number;
  responses: Response[];
  critiques: Critique[];
  rebuttals: Response[];
}

export interface Synthesis {
  content: string;
  synthesizer: string;
  consensusScore: number;
  confidenceScore: number;
  controversial: boolean;
  minorityReport?: string;
  contributions: Record<string, string[]>; // provider -> key contributions
  whatWouldChange?: string;
}

// --- Config ---

export interface CounselConfig {
  providers: ProviderConfig[];
  defaultProfile: string;
  profiles: Record<string, AgentProfile>;
}

// --- CLI ---

export interface AskOptions {
  providers?: string[];
  profile?: string;
  interactive?: boolean;
  rounds?: number;
}
