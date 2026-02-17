# Changelog

All notable changes to Quorum will be documented in this file.

---

## [0.12.0] — 2026-02-17

### The "Lean & Clean" Release

Dependency diet, config safety, CLI discoverability, and provider layer simplification.

#### Dependency Changes
- **chalk → picocolors** — replaced 15KB color library with 3KB alternative across all 8 CLI modules; no chaining API (uses `pc.bold(pc.cyan())` nesting instead)
- **pdf-lib → optionalDependencies** — saves ~2.5MB for users who never export PDF attestations; graceful error with install instructions on missing dep
- **Added zod** — runtime config validation for catching malformed `~/.quorum/config.yaml` early

#### Config Validation
- **Zod schema for CounselConfig** — validates provider array shape, auth discriminated union (5 methods), provider enum (12 values), with `.passthrough()` for forward compatibility
- **Soft validation** — `loadConfig()` warns on malformed configs but doesn't crash, so older config files still work

#### CLI Discoverability
- **--help examples on 14 commands** — practical usage examples via `addHelpText('after', ...)` on `ask`, `review`, `ci`, `versus`, `follow-up`, `watch`, `replay`, `rerun`, `explain`, `diff`, `stats`, `init`, `memory search`, `arena run`

#### Provider Layer Simplification
- **`mapProvider()` reduced** — from 12-entry record to 4-case switch; only keeps Quorum-specific remaps (`gemini-cli`→`google`, `custom`→`openai`, `kimi`→`kimi-coding`, `codex`→`openai-codex`); all other providers pass through to pi-ai natively
- **`resolveApiDetails()` reduced** — from 12-case switch to 3 hardcoded cases + pi-ai delegation; queries pi-ai's model registry for base URLs instead of hardcoding them
- **Bug fix** — groq, xai, and mistral were previously mapped to `openai`, preventing pi-ai from finding their models; now passed through correctly

#### Fixes
- Fixed stale `eslint-disable` directive in `attestation-export.ts`
- Fixed type errors in `streaming.test.ts` (`provider: 'test'` → `'custom'`, corrected `AgentProfile` and `ScoringWeights` shapes)

---

## [0.11.1] — 2026-02-17

### CI Fixes
- Bump minimum Node from 18 to 20 (transitive dep `@aws-sdk/client-bedrock-runtime` requires it)
- Drop Node 18 from CI matrix
- Run Prettier on split CLI modules
- Fix stale `dist/cli.js` path in streaming test (now `dist/cli/index.js`)

---

## [0.11.0] — 2026-02-17

### The "Audit Remediation" Release

Comprehensive code audit and remediation — bug fixes, major refactoring, dependency cleanup, and test coverage.

#### Bug Fixes
- **Version mismatch** — CLI was reporting `0.4.1` instead of `0.10.2`; now reads version dynamically from package.json
- **Groq/xAI provider routing** — both providers were in the type system but missing from `mapProvider()`, `resolveApiDetails()`, `detectProviders()`, and the CLI menu; now fully routed
- **Gemini CLI error message** — pointed users to the wrong npm package for installation
- **macOS Keychain** — added explicit platform guard (`process.platform !== 'darwin'`) instead of relying on catch block

#### Major Refactoring
- **CLI monolith split** — decomposed `src/cli.ts` (5,214 lines) into 9 focused modules in `src/cli/`:
  `index.ts`, `helpers.ts`, `ask.ts`, `review.ts`, `providers.ts`, `auth.ts`, `session.ts`, `analysis.ts`, `governance.ts`
- **CLIError pattern** — replaced 120 of 123 `process.exit()` calls with a `CLIError` class caught at the top level, enabling testability and graceful shutdown
- **inquirer → @inquirer/prompts** — migrated to lighter, tree-shakeable prompt library (only 4 functions used: `select`, `confirm`, `input`, `password`)

#### Testing
- **19 CLI integration tests** — first-ever CLI command tests covering `--version`, `--help`, provider management, error paths, and all subcommand help output
- **Vitest config** — added `vitest.config.ts` to prevent double-running tests from `dist/` (172 actual tests, was reporting 319)
- **Type-check script** — `tsconfig.check.json` + `npm run typecheck` covers both `src/` and `tests/`

#### Packaging & Build
- **Cleaned dist/** — removed 26 stale `.test.js` files that shipped to npm
- **.npmignore** — comprehensive exclusion list (test files, configs, docs, benchmarks)
- **.npmrc** — `engine-strict=true` enforces Node >= 18
- **Deleted dead code** — removed untracked draft CLI split (5,269 lines, never wired up)

---

## [0.6.0] — 2026-02-13

### 🔌 The "MCP Server" Release

Quorum is now an MCP tool — any MCP-compatible client can invoke deliberations programmatically.

#### MCP Server (#12)
- **`quorum mcp`** — starts an MCP server over stdio
- **5 tools exposed:**
  - `quorum_ask` — full multi-AI deliberation with all config options (rapid, evidence, adaptive, devil's advocate, profiles, provider filtering)
  - `quorum_review` — code review via deliberation (files, staged changes, diffs, PRs)
  - `quorum_versus` — head-to-head provider comparison with optional judge
  - `quorum_providers` — list configured providers with status
  - `quorum_history` — browse recent deliberation sessions
- **Works with:** Claude Desktop, Cursor, OpenClaw, and any MCP-compatible client
- **Zero config:** just add to your MCP client config and go

#### Claude Desktop Config
```json
{
  "mcpServers": {
    "quorum": {
      "command": "quorum",
      "args": ["mcp"]
    }
  }
}
```

---

## [0.5.0] — 2026-02-13

### 🧹 The "Clean House" Release

Developer experience overhaul — CI, linting, docs, and project infrastructure.

#### CI & Automation
- **GitHub Actions CI** — builds on Node 18, 20, 22 on every push/PR to main
- **Automated npm releases** — publish to npm on GitHub Release via release workflow
- **Lint & format checks** in CI pipeline

#### Developer Experience
- **ESLint + Prettier** — full linting and formatting tooling (#5)
- **Codebase cleanup** — fixed all lint errors and formatting across 25 files (zero errors/warnings)
- **CONTRIBUTING.md** — development setup, PR guidelines, code style (#10)
- **Issue templates** — bug report, feature request, and config
- **PR template** — description, related issues, checklist

#### Documentation
- **README audit** — removed aspirational features, fixed command inconsistencies (`re-run` → `rerun`), added undocumented commands and profiles
- **ROADMAP.md** — v1.0 roadmap with 15 tracked issues across 4 milestones
- **v1.0 roadmap issues** — #4–#18 covering DX, distribution, ecosystem, and stable release

---

## [0.4.0] — 2026-02-12

### 🏗️ The "Complete V2" Release

All ten V2 features are now shipped. This release adds the final six: deterministic replay, policy guardrails, deliberation memory, topology DSL, human-in-the-loop checkpoints, and the eval arena.

#### #29 Deterministic Replay + Signed Ledger
- **SHA-256 hash-chained ledger** — every deliberation recorded in `~/.quorum/ledger.json` with tamper-evident hash chain
- **ADR export** — export any deliberation as an Architecture Decision Record
- **`quorum re-run <id|last>`** — near-reproducible replay of previous deliberations
  - `--diff` — show differences between original and replay
  - `--dry-run` — preview what would be re-run without calling APIs
- **`quorum ledger`** subcommands:
  - `list` — show all ledger entries
  - `verify` — validate hash chain integrity
  - `show <id>` — inspect a specific entry
  - `export <id>` — export as ADR markdown

#### #30 Policy-as-Code Guardrails
- **YAML policy engine** — define rules that govern deliberation behavior
- **Pre/post deliberation evaluation** — policies checked before and after each run
- **4 action types:** `block` (halt), `warn` (continue with warning), `log` (silent record), `pause` (require confirmation)
- **`--policy <name>`** flag on `ask`, `review`, `ci`
- **`quorum policy`** subcommands:
  - `list` — show available policies
  - `check` — evaluate a policy against current config
- **Built-in policies:** `default` (permissive baseline) and `strict` (production-hardened)
- Policy files: `~/.quorum/policies/*.yaml` or project-local `.quorum/policies/`

#### #33 Deliberation Memory Graph
- **Cross-run keyword-based memory retrieval** — previous deliberation outcomes surfaced at run start when relevant
- **Contradiction detection** — flags when new conclusions conflict with prior decisions
- **Auto-save** — deliberation outcomes automatically stored after each run
- **`quorum memory`** subcommands:
  - `list` — show stored memories
  - `search <query>` — keyword search across memory graph
  - `clear` — reset memory store
  - `stats` — memory usage and graph statistics

#### #35 Cognitive Topology DSL
- **7 debate topologies** — each structures deliberation differently:
  - **`mesh`** (default) — all-vs-all, current behavior
  - **`star`** — hub-and-spoke, fast synthesis via central provider
  - **`tournament`** — bracket elimination, head-to-head with judging
  - **`map_reduce`** — split question into sub-questions, parallel answers, merge
  - **`adversarial_tree`** — binary attack/defend tree for stress-testing
  - **`pipeline`** — sequential refinement chain, each builds on previous
  - **`panel`** — moderated discussion with targeted follow-up questions
- **`--topology <name>`** flag on `ask`, `review`, `ci`
- **`--topology-hub`**, **`--topology-moderator`** for topology-specific config
- **Profile YAML:** `topology: tournament`, `topologyConfig: { bracketSeed: random }`
- **`quorum topologies`** (alias `topo`) — list all topologies with descriptions
- **5 bundled topology templates:** `quick-poll`, `deep-review`, `bracket-challenge`, `research-split`, `stress-test`
- **Visibility control** — each topology controls which providers see which responses per phase

#### #36 Human-in-the-Loop Checkpoints
- **Configurable pause points** — halt deliberation at any phase for human review
- **`--hitl`** flag on `ask`, `review`, `ci` — enables interactive checkpoints
- **Inject guidance** — add context or steer the deliberation mid-run
- **Override winners** — manually override vote results before synthesis
- **On-controversy auto-pause** — automatically pauses when entropy exceeds threshold (high disagreement)
- **Resume workflow** — continue deliberation after review with optional modifications
- Profile YAML: `hitl: true`, `hitlPhases: [debate, vote]`

#### #37 Eval Arena + Reputation System
- **Provider performance tracking** — records win rates, evidence quality, and outcome metrics per provider per domain
- **Reputation-weighted voting** — providers with stronger track records get proportionally more vote influence
- **Eval suites** — run standardized benchmarks against provider roster
- **`quorum arena`** subcommands:
  - `leaderboard` — overall provider rankings with reputation scores
  - `show <provider>` — detailed performance breakdown
  - `run [suite]` — execute an eval suite
  - `reset` — clear arena data
- **`--reputation`** flag — enable reputation-weighted voting for a deliberation
- Reputation data stored in `~/.quorum/arena.json`

#### New Files
- `src/ledger.ts` — hash-chained ledger, verification, ADR export
- `src/policy.ts` — YAML policy engine, evaluation, built-in policies
- `src/memory.ts` — deliberation memory graph, keyword retrieval, contradiction detection
- `src/topology.ts` — topology engine, plan builder, 7 topology implementations
- `src/hitl.ts` — human-in-the-loop checkpoints, pause/resume, guidance injection
- `src/arena.ts` — eval arena, reputation tracking, weighted voting integration
- `agents/topologies/*.yaml` — 5 bundled topology templates
- `agents/policies/{default,strict}.yaml` — built-in policy definitions

---

## [0.3.0] — 2026-02-12

### 🧠 The "Trust + Intelligence" Release

Four V2 features that make Quorum fundamentally smarter.

#### #28 Evidence-Backed Claims Protocol (Deep)
- **Sentence-level claim extraction** — every substantive assertion identified, not just tagged ones
- **Source quality tiers:** A (URL, 1.0) → B (file path, 0.8) → C (data/stats, 0.7) → D (reasoning, 0.4) → F (unsupported, 0.0)
- **Cross-provider claim validation** — detects corroborated claims (2+ providers agree) and contradictions
- **Voting penalty (strict mode):** evidence `weightedScore` applies as 0.5x–1.0x multiplier to Borda scores
- **Synthesis integration:** cross-reference matrix (corroborated/contradicted claims) injected into synthesis prompt
- **`quorum evidence <session|last>`** — full evidence report with tier breakdown, grades (A–F), per-provider claim details
  - Options: `--provider`, `--tier`, `--json`

#### #31 Native PR/CI Integration (Deep)
- **`quorum ci` command** — CI-optimized deliberation for pull requests
  - `--pr <number>`, `--diff [ref]`, `--staged` input modes
  - `--confidence-threshold <0-1>` — exit code 1 if below (CI gate)
  - `--format json|markdown|github` — structured output formats
  - `--post-comment` — auto-post review as PR comment via `gh`
  - `--label` — add `quorum:approved` / `quorum:needs-discussion` / `quorum:concerning` labels
  - `--max-files <n>` — skip if PR too large
  - Exit codes: 0 = pass, 1 = below threshold, 2 = error
- **GitHub Action** (`action.yml`) — drop-in composite action for any repo
  - Inputs: providers, profile, confidence-threshold, evidence, post-comment, add-labels, max-files, focus
  - Outputs: confidence, consensus, approved, evidence-grade, session-id, result-json
- **Risk matrix extraction** — auto-categorizes findings into Security, Performance, Breaking Changes, Correctness, Style, Testing with severity levels
- **Patch suggestion parsing** — detects code change suggestions from provider responses, deduplicates, formats as GitHub suggestions
- **PR comment format** — collapsible sections for risk matrix, dissent, evidence, patch suggestions
- **git.ts extensions:** `postPrComment()`, `addPrLabels()`, `removePrLabels()`, `getPrMetadata()`, `getPrChangedFiles()`, `ensureGhCli()`

#### #32 Adaptive Debate Controller
- **Disagreement entropy** — measures term divergence (Jaccard) + position entropy (Shannon) after each phase
- **Dynamic phase control:**
  - Low entropy after gather → skip to vote (providers already agree)
  - Low entropy after debate → skip adjust/rebuttal
  - High entropy after debate → add extra debate rounds (up to preset max)
  - High entropy after adjust → force rebuttal
- **4 presets:** `fast` (aggressive skip, 1 extra round), `balanced` (2 extra), `critical` (3 extra, never skips debate), `off`
- **`--adaptive <preset>`** flag on `ask`, `review`, `ci`
- **Multi-armed bandit learning** — tracks skip/add-round outcomes in `~/.quorum/adaptive-stats.json`, adjusts thresholds over time
- **Profile YAML support:** `adaptive: balanced`
- Adaptive decisions saved to session as `adaptive-decisions.json`

#### #34 Adversarial Red-Team Mode
- **Non-voting attacker agents** that stress-test the council's conclusions after debate
- **5 bundled attack packs** (52 vectors): `general`, `code`, `security`, `legal`, `medical`
- **Resilience scoring** — measures how well positions survive adversarial analysis (0–100%)
- **Structured output:** unresolved risks, mitigated risks, blind spots
- **Synthesis integration:** unresolved risks and blind spots injected into synthesis prompt
- **`--red-team`** flag on `ask`, `review`, `ci`
- **`--attack-pack <packs>`** — comma-separated pack selection (default: `general`)
- **`--custom-attacks <attacks>`** — ad-hoc attack prompts
- **`quorum attacks`** — list available attack packs with vector counts
- **Profile YAML:** `redTeam: true`, `attackPacks: [security, code]`, `customAttacks: [...]`

#### New Files
- `src/adaptive.ts` — entropy calculation, adaptive controller, bandit learning
- `src/ci.ts` — risk matrix, patch suggestions, PR comment/markdown formatting
- `src/redteam.ts` — attack engine, resilience scoring, report formatting
- `agents/attacks/{general,code,security,legal,medical}.yaml` — attack pack definitions
- `action.yml` + `action/entrypoint.sh` + `action/README.md` — GitHub Action

---

## [0.2.0] — 2026-02-12

### 🏛️ The "Consensus, Validated" Release

**Renamed from Code Counsel → Quorum** after dogfooding a naming deliberation (Claude Opus + Kimi K2.5 both independently picked "Quorum").

#### Core Engine
- 7-phase deliberation: gather → plan → formulate → debate → adjust → rebuttal → vote → synthesize
- Room-style debate: all providers see and critique ALL positions simultaneously
- Confidence-weighted synthesis: vote rankings influence final answer weighting
- Custom phase pipelines via `phases:` in profile YAML
- 4 voting algorithms: Borda count, ranked-choice (instant-runoff), approval, Condorcet
- Per-provider personas via `roles:` in profile YAML
- Devil's advocate mode (`--devils-advocate`)
- Weighted providers (`--weight claude=2,openai=1`)
- Evidence-Backed Claims Protocol (`--evidence advisory|strict`)

#### Commands
- `quorum ask` — core deliberation
- `quorum review` — file/code review with `--staged`, `--diff`, `--pr`
- `quorum versus` — head-to-head debate between two providers
- `quorum follow-up` — multi-turn deliberation on previous sessions
- `quorum explain` — meta-analysis of deliberation process
- `quorum diff` — compare two sessions with `--analyze`
- `quorum rerun` — re-run same question with different providers
- `quorum replay` — phase-by-phase streaming playback
- `quorum export` — HTML/Markdown report export
- `quorum stats` — provider win rates, participation, bar charts
- `quorum heatmap` — ASCII consensus heatmap (Spearman correlation)
- `quorum watch` — continuous review on file save

#### CLI Flags
- `--rapid` / `-r` — 3-phase fast mode
- `--dry-run` — preview prompts without API calls
- `--tools` / `--allow-shell` — tool use in gather phase
- `--voting-method` — select voting algorithm
- `--heatmap` / `--no-heatmap` — toggle consensus heatmap
- `--no-hooks` — skip plugin hooks
- `--evidence` — evidence-backed claims mode
- `--challenge-style`, `--focus`, `--convergence`, `--rounds` — inline profile overrides

#### Profiles
- `default.yaml` — balanced, adversarial, 7-phase
- `quick.yaml` — 3-phase rapid
- `thorough.yaml` — full pipeline, adversarial
- `brainstorm.yaml` — creative exploration
- `code-review.yaml` — code-focused
- `research.yaml` — research-oriented
- `decision.yaml` — decision matrix mode
- `panel.yaml` — per-provider personas
- `research-tools.yaml` — tools-enabled research
- `evidence.yaml` — strict evidence mode

#### Infrastructure
- Plugin/hook system with pre/post phase hooks
- `.quorumrc` project-local config
- Backward compatibility with `~/.counsel/` config
- Git/PR integration via `gh` CLI
- Session persistence with atomic writes
- Auth: API key, OAuth, keychain, env var methods
- All providers via `@mariozechner/pi-ai`

---

## [0.1.0] — 2026-02-11

### Initial Release (as "Code Counsel")
- Basic deliberation engine
- CLI with `counsel ask`
- Provider support: OpenAI, Anthropic, Ollama, Codex, Kimi, Gemini, DeepSeek, Mistral
- Session storage and replay
- Streaming output
