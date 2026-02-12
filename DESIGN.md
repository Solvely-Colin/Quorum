# Quorum

**Codename:** Quorum
**Status:** Design Phase
**Author:** Colin Johnson / Solvely
**License:** Open Source (TBD — MIT or Apache 2.0)

---

## Vision

An open-source framework that orchestrates multiple AI systems into a deliberative council — weighing, challenging, and synthesizing their outputs to produce the best possible outcome, free from single-model bias.

No single AI gets the final say. Every answer is earned through structured debate.

**This is not a coding tool.** It's a *thinking* tool. Code is a heavy use case, but Quorum works for anything: writing, prompt engineering, research, idea clarification, decision-making, strategy. If a question has a better answer hiding behind bias, this finds it.

---

## Target Users

- **Developers** already using AI for code gen, review, and architecture
- **Vibe coders** — building with AI as a core workflow, not a side tool
- **AI power users** — people who prompt multiple models and compare outputs manually

These are people who *already know* one model isn't enough. Quorum automates what they're doing by hand: asking multiple AIs, comparing, picking the best parts.

---

## Problem

Today's AI workflows have a fundamental flaw: **single-model dependency.** You pick one AI, trust its output, and ship it. But every model has blind spots, training biases, and failure modes. What if the answer you got was just the *first* answer, not the *best* one?

Current "multi-model" approaches are either:
- **Naive voting** — majority rules, no reasoning
- **Sequential chains** — one model feeds the next, compounding errors
- **Human-in-the-loop** — doesn't scale, still biased by which model the human trusts

---

## Solution

Quorum creates a **structured deliberation process** across multiple AI systems. Think of it as a panel of experts who must debate, defend, and refine their positions before a decision is made.

### Core Loop

```
Input (prompt/task)
    ↓
┌─────────────────────────────┐
│  1. DIVERGE — Independent   │  Each AI generates its own response
│     Generation              │  in isolation (no cross-contamination)
├─────────────────────────────┤
│  2. CHALLENGE — Adversarial │  Each response is critiqued by the
│     Review                  │  other AIs (find flaws, gaps, biases)
├─────────────────────────────┤
│  3. DEFEND — Rebuttal       │  Original authors respond to critiques,
│                             │  revise or hold their ground
├─────────────────────────────┤
│  4. CONVERGE — Synthesis    │  A synthesizer model (or algorithm)
│     & Scoring               │  merges the best elements into a
│                             │  final output with confidence scores
└─────────────────────────────┘
    ↓
Output (weighted, challenged, refined)
```

---

## Key Principles

### 1. No Model Is Privileged
Every participating AI gets equal standing. No model is hardcoded as "the smart one." Weighting is earned through performance, not reputation.

### 2. Isolation Before Deliberation
Initial responses are generated independently. No model sees another's output until the challenge phase. This prevents anchoring bias.

### 3. Adversarial by Design
Critique isn't optional — it's structural. Every response gets challenged. This surfaces weaknesses that consensus-seeking misses.

### 4. Transparent Reasoning
Every step is logged: who said what, what was challenged, what survived. The user sees the deliberation trail, not just the final answer.

### 5. Domain-Agnostic
Works for code, research, writing, strategy, architecture — any task where quality matters more than speed.

---

## Use Cases

| Domain | Example |
|--------|---------|
| **Code** | Generate implementations from multiple models → cross-review for bugs, edge cases, performance → synthesize best approach |
| **Research** | Multiple AIs research a topic independently → challenge each other's sources and conclusions → produce balanced synthesis |
| **Architecture** | Propose system designs → adversarial review for scalability, security, cost → refined architecture |
| **Prompting** | Optimize a prompt by having AIs critique and improve each other's prompt engineering |
| **Decision Making** | Evaluate options with multiple AIs playing devil's advocate on each |

---

## Architecture (High-Level)

```
┌──────────────────────────────────────────┐
│              Quorum CLI / API       │
├──────────────────────────────────────────┤
│              Orchestrator                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Session  │ │ Scoring │ │  Round  │   │
│  │ Manager  │ │ Engine  │ │ Control │   │
│  └─────────┘ └─────────┘ └─────────┘   │
├──────────────────────────────────────────┤
│           Provider Adapters              │
│  ┌───────┐ ┌───────┐ ┌──────┐ ┌─────┐  │
│  │OpenAI │ │Claude │ │Gemini│ │Local│  │
│  │       │ │       │ │      │ │Ollama│  │
│  └───────┘ └───────┘ └──────┘ └─────┘  │
│  ┌───────┐ ┌───────┐ ┌──────┐          │
│  │Mistral│ │DeepSk │ │Custom│          │
│  │       │ │       │ │      │          │
│  └───────┘ └───────┘ └──────┘          │
├──────────────────────────────────────────┤
│           Output Layer                   │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ │
│  │Synthesis│ │Confidence│ │ Audit    │ │
│  │ Report  │ │ Scores   │ │ Trail    │ │
│  └─────────┘ └──────────┘ └──────────┘ │
└──────────────────────────────────────────┘
```

### Components

**Orchestrator** — Controls the deliberation flow (rounds, timing, termination conditions).

**Provider Adapters** — Uniform interface to any AI backend. OpenAI, Anthropic, Google, Mistral, DeepSeek, local models via Ollama — anything with a chat API.

**Session Manager** — Tracks the full deliberation: inputs, each model's responses, critiques, rebuttals, and final synthesis.

**Scoring Engine** — Weights outputs based on configurable criteria:
- Factual accuracy (verifiable claims)
- Reasoning quality (logical coherence)
- Completeness (coverage of edge cases)
- Novelty (unique insights not raised by others)
- Consensus (agreement across models)

**Round Control** — Manages how many deliberation rounds occur. Can be fixed (e.g., 2 rounds) or dynamic (converge when delta drops below threshold).

---

## Scoring & Weighting

### Anti-Bias Mechanisms

1. **Blind Review** — During challenge phase, critiques don't know which model produced the original (prevents brand bias)
2. **Rotating Synthesizer** — The model that produces the final synthesis rotates; no single model always gets the last word
3. **Historical Calibration** — Track model accuracy over time; weight adjusts based on track record per domain
4. **Minority Report** — Dissenting opinions are preserved in output, not silenced by majority

### Confidence Scoring

Each output includes:
- **Consensus Score** (0-1) — How much agreement across models
- **Confidence Score** (0-1) — Strength of evidence/reasoning
- **Controversy Flag** — Highlights where models fundamentally disagreed
- **Source Attribution** — Which model contributed which elements

---

## Configuration

```yaml
# quorum.yaml
council:
  providers:
    - name: claude
      model: claude-sonnet-4-20250514
      provider: anthropic
    - name: gpt
      model: gpt-4o
      provider: openai
    - name: gemini
      model: gemini-2.0-flash
      provider: google
    - name: local
      model: qwen2.5:14b
      provider: ollama

  deliberation:
    rounds: 2                    # Max deliberation rounds
    convergence_threshold: 0.85  # Stop early if consensus > this
    isolation: true              # Independent generation (no peeking)
    blind_review: true           # Hide model identity during critique

  scoring:
    weights:
      accuracy: 0.3
      reasoning: 0.25
      completeness: 0.2
      novelty: 0.15
      consensus: 0.1
    
  output:
    include_audit_trail: true
    include_minority_report: true
    format: markdown             # markdown | json | html
```

---

## Onboarding

First run experience is critical. The framework should **discover and guide**, not assume.

```
$ quorum init

👋 Welcome to Quorum.

Let me figure out what AI tools you have available...

Scanning...
  ✅ ollama — found (models: qwen2.5:14b, llama3.2)
  ✅ claude — CLI detected (claude)
  ✅ openai — API key found (OPENAI_API_KEY)
  ❌ gemini — not found

You've got 3 providers ready. That's enough for a solid council.

Want to add more?
  [1] Add an API key (OpenAI, Anthropic, Google, Mistral, DeepSeek...)
  [2] Connect a local model (Ollama, llama.cpp, LM Studio)
  [3] Done — let's go

>
```

### Detection Strategy
1. **CLI scan** — check PATH for known tools (`ollama`, `claude`, `aichat`, `gemini`, etc.)
2. **Env vars** — check for `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, etc.
3. **Local services** — probe localhost ports for Ollama (11434), LM Studio (1234), etc.
4. **Guided add** — walk the user through adding any provider they have credentials for
5. **Test connection** — verify each provider actually works before saving

Config gets written to `~/.quorum/config.yaml` (or project-local `quorum.yaml`).

Users can re-run `quorum init` anytime to add/remove providers or run `quorum providers add <name>`.

---

## CLI Interface (Proposed)

```bash
# Onboarding
quorum init

# Simple query
quorum ask "What's the best database for time-series data?"

# Code generation
quorum code "Build a rate limiter in Go" --lang go

# Research
quorum research "Compare CRDT vs OT for real-time collaboration"

# Architecture review
quorum review ./architecture.md

# With specific providers
quorum ask "..." --providers claude,gpt,gemini

# Interactive deliberation (watch the debate)
quorum ask "..." --interactive

# Manage providers
quorum providers list
quorum providers add openai
quorum providers test
```

---

## Differentiators vs Existing Tools

| Feature | Quorum | Simple Routing (e.g., OpenRouter) | Agent Swarms |
|---------|-------------|-----------------------------------|--------------|
| Independent generation | ✅ | ❌ (picks one model) | Varies |
| Adversarial challenge | ✅ | ❌ | Rarely |
| Blind review | ✅ | N/A | ❌ |
| Audit trail | ✅ | ❌ | Sometimes |
| Minority report | ✅ | N/A | ❌ |
| Domain-agnostic | ✅ | ✅ | Usually narrow |
| Provider-agnostic | ✅ | ✅ | Varies |
| Open source | ✅ | Some | Some |

---

## Design Decisions

### Language-Agnostic by Nature
Quorum is **not tied to a programming language or domain.** It's a deliberation framework. The task could be:
- Writing production code
- Crafting a better prompt
- Clarifying a vague idea into a sharp spec
- Researching a topic with conflicting sources
- Naming a product
- Designing a system architecture

The framework doesn't care. It runs the same diverge → challenge → converge loop regardless of domain.

### Bring Your Own AI
Users configure whichever providers and models they have access to. Could be all cloud APIs, all local models, or a mix. Quorum is the orchestration layer — it doesn't gatekeep which AIs participate.

### Cost Is the User's Call
Multi-model = multi-cost. The framework provides:
- **Transparency** — estimated token usage before and actual usage after each session
- **Presets** — quick (2 models, 1 round), thorough (3-4 models, 2 rounds), exhaustive (all models, converge-until-stable)
- **Caps** — optional per-session token/cost limits
- **Local-first option** — run entirely on local models (Ollama, llama.cpp) for $0

But the framework never restricts. If someone wants to throw 8 models at a problem, that's their choice.

### Agent Files (Deliberation Profiles)
Instead of hardcoded deliberation logic, each use case gets an **agent file** — a config that defines how the council behaves for that domain:

```yaml
# agents/code-review.yaml
name: Code Review Council
rounds: 2
focus:
  - correctness
  - edge_cases
  - performance
  - readability
challenge_style: adversarial    # adversarial | collaborative | socratic
scoring_weights:
  accuracy: 0.35
  completeness: 0.30
  reasoning: 0.20
  novelty: 0.15
```

```yaml
# agents/brainstorm.yaml
name: Brainstorm Council
rounds: 3
focus:
  - creativity
  - feasibility
  - uniqueness
challenge_style: socratic       # Push ideas further, don't tear down
scoring_weights:
  novelty: 0.40
  feasibility: 0.30
  reasoning: 0.20
  consensus: 0.10
```

Users create, share, and remix agent files. The framework ships with sensible defaults; the community builds the rest.

### Audit Trail as a Feature
The deliberation log isn't a debug artifact — it's a **first-class output.** Seeing *how* the council reached its conclusion (who argued what, what got challenged, what survived) is often more valuable than the final answer. Every session produces:
- The synthesized output
- The full deliberation trail (who said what, round by round)
- Confidence scores and minority reports
- A "decision rationale" summary

### Name
"Quorum" is the **working codename.** Final name TBD — will be brainstormed using the framework itself as a first real test.

### Development Strategy
Build solo first. Get the core solid and working. Then open source it. No design-by-committee on the foundation.

---

## Monetization / Token Model

### Bags.fm Integration
Launch a project coin on [Bags](https://bags.fm) tied to Quorum. Potential mechanics:

- **Access tiers** — Hold X tokens for premium agent files, priority hosted API, advanced analytics
- **Governance** — Token holders vote on roadmap priorities, default agent file configs, which models to benchmark
- **Bounties** — Fund community contributions (new agent files, provider adapters, scoring plugins) with token rewards
- **Staking for compute** — Stake tokens to access a hosted deliberation API (offsets infrastructure costs)
- **Early supporter upside** — Early backers get tokens before the framework gains traction; value grows with adoption

### Why Crypto vs Traditional SaaS?
- **Community alignment** — Token holders are invested in the project's success, not just paying customers
- **Open source compatible** — The framework stays free; the token adds a value layer on top without paywalling the core
- **Funding without VC** — Bootstrap development through token launch, not pitch decks

## Open Questions

1. **Synthesis Strategy** — Should the synthesizer be a dedicated model call, or algorithmic merging?
2. **Streaming** — Can we stream the deliberation in real-time for interactive mode?
3. **Plugin System** — Should providers and scoring be pluggable from day one?

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-11 | TypeScript for implementation | Async-native, first-class AI SDKs, npm distribution (`npx`), large contributor pool. Validated by CodeBot. Future: language-agnostic protocol layer so other runtimes can plug in. |

---

## Roadmap (Proposed)

### Phase 0 — MVP (Pre-Repo)
Build locally, prove the loop works before anything goes public.
- [ ] Pick implementation language (best for scale + ease of use)
- [ ] Core orchestrator: diverge → challenge → converge
- [ ] Provider adapters: 2-3 providers minimum
- [ ] `quorum init` onboarding (auto-detect + guided setup)
- [ ] `quorum ask` with basic output + audit trail
- [ ] **First test:** Council names itself

### Phase 1 — Foundation (Public Repo)
- [ ] Blind review system
- [ ] Historical calibration / model performance tracking
- [ ] Configurable scoring weights
- [ ] `code` and `research` specialized modes
- [ ] Interactive mode (watch the debate)

### Phase 3 — Ecosystem
- [ ] Plugin system for custom providers and scorers
- [ ] API server mode (not just CLI)
- [ ] Web UI for deliberation visualization
- [ ] Integration with CI/CD (code review counsel)
- [ ] Community scoring benchmarks

---

## Prior Art & Inspiration

- **Constitutional AI** (Anthropic) — AI critiquing AI outputs
- **Mixture of Experts** — routing to specialized models
- **Debate (OpenAI research)** — adversarial AI alignment technique
- **Ensemble Methods (ML)** — combining multiple models for better predictions
- **Judicial Systems** — adversarial process → better truth-finding

---

*This is a living document. It will evolve as the design solidifies.*
