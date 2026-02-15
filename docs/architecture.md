# Architecture

## Overview

Quorum is a multi-AI deliberation framework. It orchestrates multiple LLM providers through a structured debate process to produce higher-quality, more reliable answers than any single model.

## Core Engine: 7-Phase Deliberation

The deliberation engine (`council-v2.ts`) runs the following phases:

### Phase 1: Gather
Each provider generates an independent response **in isolation**. No provider sees another's output. This ensures diverse initial perspectives.

### Phase 2: Plan
Each provider now sees all other providers' initial responses and plans their argument strategy. This is where providers identify points of agreement and disagreement.

### Phase 3: Formulate
Each provider writes a formal position statement based on their plan.

### Phase 4: Debate
**Room-style debate** — every provider critiques ALL other positions simultaneously (not round-robin pairs). This creates swarm dynamics where weak arguments are challenged from multiple angles.

### Phase 5: Adjust
Each provider revises their position based on all critiques received. Providers can strengthen, modify, or abandon positions.

### Phase 6: Rebuttal
Final rebuttals or concessions. **Auto-skipped** if consensus has already been reached (measured by disagreement entropy).

### Phase 7: Vote
Each provider ranks all positions. Votes are tallied using the configured method:
- **Borda count** (default) — points by rank position
- **Ranked-choice** — instant-runoff elimination
- **Approval** — binary approve/reject
- **Condorcet** — pairwise comparison winner

### Synthesis
The **runner-up** (not the winner, to reduce confirmation bias) synthesizes the best thinking into a definitive answer including:
- Main answer with merged insights
- Minority report (dissenting views)
- "What Would Change My Mind" section
- Per-provider contribution attribution

## Phase Customization

Profiles can specify custom phase pipelines:
```yaml
# Rapid mode (3 phases)
phases: [gather, debate, synthesize]

# Skip planning
phases: [gather, formulate, debate, adjust, vote, synthesize]
```

## Provider Architecture

All providers route through [`pi-ai`](https://github.com/nichochar/pi-ai) for unified API access. The `ProviderAdapter` interface requires only:

```typescript
interface ProviderAdapter {
  name: string;
  generate(prompt: string, systemPrompt?: string): Promise<string>;
  generateStream?(prompt: string, systemPrompt: string | undefined, onDelta: (delta: string) => void): Promise<string>;
}
```

This makes adding new providers trivial — any OpenAI-compatible API works out of the box.

## Adaptive Debate Controller

The adaptive system (`adaptive.ts`) dynamically adjusts deliberation based on **disagreement entropy**:

- **Low entropy after gather** → providers already agree → skip to vote
- **High entropy after debate** → add extra debate rounds
- Uses **multi-armed bandit** learning to optimize skip/extend decisions over time

Presets: `fast` (aggressive skipping), `balanced` (default), `critical` (never skips).

## Debate Topologies

The topology engine (`topology.ts`) supports 7 debate structures:

| Topology | Description |
|----------|-------------|
| **Mesh** | Every provider debates every other (default) |
| **Star** | Hub provider debates all others; spokes only see hub |
| **Tournament** | Bracket-style elimination |
| **Map-Reduce** | Split question into sub-questions, merge results |
| **Adversarial Tree** | Binary tree of challenger pairs |
| **Pipeline** | Sequential: each builds on the previous |
| **Panel** | Moderator-guided discussion |

## Evidence Protocol

When enabled (`--evidence strict`), providers must tag claims with sources:

- Claims are parsed and scored by quality tier: **A** (URL) → **B** (file) → **C** (data) → **D** (reasoning) → **F** (unsupported)
- Cross-provider validation detects corroborated and contradicted claims
- In strict mode, unsupported claims are penalized in voting

## Session Persistence

Sessions are stored as JSON files in `~/.quorum/sessions/`. Each phase's output is saved incrementally via `SessionStore`, enabling:
- Resume after interruption
- Post-hoc analysis
- Deterministic replay

## Ledger & Integrity

Every deliberation is recorded in a **SHA-256 hash-chained ledger** (`~/.quorum/ledger.json`). Each entry chains to the previous via cryptographic hash, creating a tamper-evident audit trail.

## Memory Graph

The memory graph (`memory-graph.ts`) enables cross-run retrieval:
- Stores key insights from each deliberation
- Keyword-based retrieval for relevant prior context
- Contradiction detection across sessions

## Policy Engine

YAML-based policy rules (`policy.ts`) evaluate pre- and post-deliberation:
- `block` — prevent deliberation from proceeding
- `warn` — show warning but continue
- `log` — silent logging
- `pause` — require human confirmation

## Human-in-the-Loop

HITL checkpoints (`hitl.ts`) pause deliberation at configurable phases. During pause:
- Inject guidance or additional context
- Override vote results
- Resume with modifications
- Auto-triggers on high-controversy scenarios

## MCP Integration

The MCP server (`mcp.ts`) exposes Quorum as tools for AI agents via stdio-based Model Context Protocol, enabling Claude Desktop, Cursor, and other MCP clients to invoke deliberations.

## Data Flow

```
User Input
    ↓
CLI (commander.js) → parse flags, load config/profile
    ↓
Council V2 Engine
    ↓
┌─────────────────────────────────────────┐
│  For each phase:                         │
│  1. Build prompts (with context budget)  │
│  2. Run providers in parallel            │
│  3. Collect & store responses            │
│  4. Run adaptive check (skip/extend?)    │
│  5. Run policy check (block/warn?)       │
│  6. HITL checkpoint (pause?)             │
│  7. Run hooks (pre/post scripts)         │
└─────────────────────────────────────────┘
    ↓
Synthesis → Voting → Final Output
    ↓
Session saved → Ledger entry → Memory stored
```

## Context Management

The context manager (`context.ts`) handles token budgets:
- Estimates token counts for prompts
- Fits debate history within model context windows
- Prioritizes recent and high-relevance content when truncating
