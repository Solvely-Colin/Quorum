# Changelog

All notable changes to Quorum will be documented in this file.

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
