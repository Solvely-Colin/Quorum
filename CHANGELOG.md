# Changelog

All notable changes to Quorum will be documented in this file.

---

## [0.3.0] — 2026-02-12

### 🧠 The "Trust + Intelligence" Release

Three V2 features that make Quorum fundamentally smarter.

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

#### New Files
- `src/adaptive.ts` — entropy calculation, adaptive controller, bandit learning
- `src/ci.ts` — risk matrix, patch suggestions, PR comment/markdown formatting
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
