# ROADMAP.md — Quorum Feature Roadmap

*Created: 2026-02-12 | Source: Two independent AI feature reviews*

---

## 🟢 Tier 1 — Low Effort, High Impact

### 1. File/Code Review Mode
`quorum review <file>`, `quorum review src/**/*.ts`, `git diff | quorum review`
- CLI reads files, injects as context, auto-selects code-review profile
- Support file paths, globs, and piped diffs
- **Complexity: Low-Medium**

### 2. Rapid/Fast Mode (`--rapid` or `--fast`)
3-phase deliberation: gather → debate → synthesize (skip plan/formulate/adjust/rebuttal)
- ~3x faster, captures 80% of multi-perspective value
- Fills the gap between `--single` and full 7-phase
- **Complexity: Low**

### 3. Devil's Advocate Mode
One provider explicitly assigned contrarian role — forced to argue against emerging consensus
- Profile option: `devilsAdvocate: true` or `--devils-advocate` flag
- Rotates the role or assigns to lowest-confidence provider
- Fights groupthink (LLMs tend to converge)
- **Complexity: Low-Medium**

### 4. Per-Provider Persona/Role Assignment
Assign specific roles to providers in profile YAML:
```yaml
roles:
  claude: "security expert"
  openai: "performance engineer"  
  gemini: "UX advocate"
```
Each provider gets a different system prompt emphasizing their assigned expertise. Creates structured diversity.
- **Complexity: Low**

### 5. "What Would Change My Mind" Section
Add a synthesis prompt section: "What evidence or argument would overturn this conclusion?"
- Forces the council to articulate fragility of their answer
- Low effort prompt addition, high insight value
- **Complexity: Low**

### 6. Dry Run (`--dry-run`)
Preview all prompts that would be sent at each phase without calling APIs.
- Shows token budget allocation, provider assignments, phase pipeline
- Essential for profile authoring without wasting API calls
- **Complexity: Low**

### 7. Inline Profile Override via CLI Flags
`quorum ask --challenge-style socratic --focus "security,performance" "question"`
- Override any profile field without creating a YAML file
- Power users want quick knobs for one-off tweaks
- **Complexity: Low**

---

## 🟡 Tier 2 — Medium Effort, Strong Value

### 8. Follow-up / Continuation Mode
`quorum follow-up <session-id> "But what about X?"`
- Load previous session's synthesis as shared context
- Run new (possibly shorter) deliberation
- Enables multi-turn council conversations
- **Complexity: Medium**

### 9. Session Comparison (`quorum diff <s1> <s2>`)
Compare two deliberations side-by-side:
- Synthesis diffs, vote differences, consensus score changes
- A/B test provider sets and profiles
- "Did adding Gemini change the outcome?"
- **Complexity: Medium**

### 10. Decision Matrix Mode (`--profile decision`)
For "A vs B vs C" questions:
- Each provider evaluates ALL options against weighted criteria
- Produces structured scoring matrix
- Synthesis merges into composite decision grid
- **Complexity: Medium**

### 11. Custom Phase Pipelines
Define phases in profile YAML:
```yaml
phases: [gather, debate, synthesize]  # rapid
phases: [gather, formulate, debate, debate, adjust, vote, synthesize]  # double debate
```
- Engine becomes configurable rather than hardcoded 7-phase
- Different tasks need different deliberation structures
- **Complexity: Medium**

### 12. Provider Statistics (`quorum stats`)
Aggregate stats across all sessions:
- Win rates per provider, average deliberation time
- Agreement patterns (which pairs agree/disagree most)
- Consensus score distributions
- Helps tune provider selection and profiles
- **Complexity: Medium**

### 13. Confidence-Weighted Synthesis
Weight synthesis contributions by Borda vote scores:
- Winner's points get more space in synthesis
- Last-place provider's unique contributions flagged as lower-confidence
- Makes synthesis quantitatively weighted, not just qualitative
- **Complexity: Medium**

### 14. Debate Replay (`quorum replay <session>`)
Play back deliberation phase-by-phase with streaming output
- Like watching a debate unfold in real-time
- Support `--phase debate --provider claude` to drill in
- Builds trust and is genuinely fascinating to watch
- **Complexity: Medium**

### 15. Session Replay with Different Providers
`quorum replay <session-id> --providers claude,deepseek`
- Re-run same question with different providers, auto-compare
- Tests whether conclusions are provider-dependent or robust
- Scientific method applied to AI deliberation
- **Complexity: Medium**

### 16. Meta-Analysis (`quorum explain <session>`)
Ask a provider to analyze the deliberation itself:
- "Why did Claude win? What was the turning point?"
- Treats the session data as input for meta-analysis
- **Complexity: Low-Medium**

### 17. Head-to-Head Mode (`quorum versus`)
`quorum versus claude openai "Should we use microservices?"`
- Two providers, structured debate, comparison table output
- Simpler than full 7-phase, faster
- **Complexity: Low-Medium**

### 18. Cost Estimation & Tracking
- Pre-run: estimate cost from pi-ai model registry pricing
- Post-run: show actual token usage and cost per provider
- Cumulative tracking in `~/.quorum/usage.json`
- **Complexity: Medium**

---

## 🔵 Tier 3 — Higher Effort, Nice to Have

### 19. Report Export (`--output report.html`)
Export full deliberation as formatted Markdown/HTML:
- Collapsible phase sections, vote visualization, provider attributions
- Table of contents, shareable with non-CLI users
- **Complexity: Medium**

### 20. Git/PR Integration
`quorum review --staged`, `quorum review --pr <url>`
- Auto-detect git context, fetch PR diffs from GitHub
- Include commit messages and PR description as context
- **Complexity: High**

### 21. Watch Mode
`quorum watch <file> --profile code-review`
- Re-run deliberation on file save
- Paired with `--fast`, gives continuous AI code review
- **Complexity: Medium**

### 22. Plugin/Hook System
Pre/post hooks per phase in profile:
```yaml
hooks:
  pre-gather: "./scripts/fetch-context.sh"
  post-synthesis: "./scripts/post-to-slack.sh"
```
- Makes Counsel composable with existing workflows
- **Complexity: High**

### 23. MCP / Tool Use in Deliberation
Let providers use tools during gather phase:
- Web search, file reading, code execution
- Grounds deliberation in real-time information
- **Complexity: High**

### 24. Structured Disagreement Map / Consensus Heatmap
Visual agreement map showing which providers agreed/disagreed on specific points
- ASCII art in terminal, SVG in report output
- Shows topology of debate, not just the winner
- **Complexity: Medium-High**

### 25. Custom Voting Algorithms
Support multiple voting methods:
- Borda count (current), ranked-choice/instant-runoff, approval voting, Condorcet
- Profile option: `votingMethod: condorcet`
- Different methods surface different consensus patterns
- **Complexity: Medium**

### 26. Weighted Providers
`quorum ask --weight claude=2,openai=1 "question"`
- Give specific providers more vote weight
- Express domain expertise differences
- **Complexity: Low**

### 27. `.quorumrc` Project Config
Project-local config (like `.eslintrc`):
- Default profile, provider filters, focus areas
- Auto-loaded when running `counsel` in that directory
- **Complexity: Low**

---

## Status Tracker

### ✅ V1 Shipped (26/27)
| # | Feature | Notes |
|---|---------|-------|
| 1 | File/Code Review Mode | `quorum review <files>`, auto code-review profile |
| 2 | Rapid Mode | `--rapid` / `-r`, 3-phase pipeline |
| 3 | Devil's Advocate | `--devils-advocate`, contrarian role assignment |
| 4 | Per-Provider Personas | `roles:` in profile YAML, `agents/panel.yaml` |
| 5 | "What Would Change My Mind" | Synthesis prompt section |
| 6 | Dry Run | `--dry-run`, preview prompts/budget |
| 7 | Inline Profile Overrides | `--challenge-style`, `--focus`, `--convergence`, `--rounds` |
| 8 | Follow-up Mode | `quorum follow-up <session\|last> "question"` |
| 9 | Session Comparison | `quorum diff <s1> <s2>` with `--analyze` |
| 10 | Decision Matrix Mode | `agents/decision.yaml`, scoring grid in gather/synthesize |
| 11 | Custom Phase Pipelines | `phases:` in profile YAML, `agents/quick.yaml` + `thorough.yaml` |
| 12 | Provider Statistics | `quorum stats`, win rates, bar charts |
| 13 | Confidence-Weighted Synthesis | Vote rankings feed into synthesis prompt |
| 14 | Debate Replay | `quorum replay <session> --phase --provider --speed` |
| 15 | Re-run with Different Providers | `quorum rerun last --providers x,y --compare` |
| 16 | Meta-Analysis | `quorum explain <session\|last>` |
| 17 | Head-to-Head Mode | `quorum versus <p1> <p2> "question"` |
| 19 | Report Export | `quorum export last --format html --output report.html` |
| 20 | Git/PR Integration | `quorum review --staged`, `--diff`, `--pr <number>` |
| 21 | Watch Mode | `quorum watch src/*.ts --rapid --debounce 1000` |
| 22 | Plugin/Hook System | `hooks:` in profile YAML, pre/post per phase, `--no-hooks` |
| 23 | MCP/Tool Use | `--tools`, `--allow-shell`, `agents/research-tools.yaml` |
| 24 | Consensus Heatmap | `quorum heatmap last`, Spearman correlation, ASCII grid |
| 25 | Custom Voting Algorithms | Borda, ranked-choice, approval, Condorcet |
| 26 | Weighted Providers | `--weight claude=2,openai=1` + profile YAML |
| 27 | `.quorumrc` Project Config | Project-local YAML, walks to homedir |

### ⏸️ V1 Deferred (1/27)
| # | Feature | Notes |
|---|---------|-------|
| 18 | Cost Tracking | Deferred by user — revisit later |

---

## V2 Roadmap — Next Generation

*Source: 3-agent deliberation (Kimi K2.5 × Codex × Claude Opus) — 2026-02-12*
*Winner: Kimi | Synthesizer: Codex | Consensus: 0.82*

### Phase 1 — Trust + Production (build first)
| # | Feature | Description |
|---|---------|-------------|
| 28 | Evidence-Backed Claims Protocol | Claims require source metadata; voting penalizes unsupported assertions. Modes: `advisory`, `strict`. `quorum run --evidence strict` |
| 29 | Deterministic Replay + Signed Ledger | Persist all run artifacts (prompts, model versions, votes). Hash-chain ledger. `quorum replay <run-id>` for near-reproducible reruns. ADR-style decision records. |
| 30 | Policy-as-Code Guardrails | Rego/Cedar-style policies: allowed tools, escalation thresholds, max cost, required evidence level, human approval gates. |
| 31 | Native PR/CI Integration (Deep) | `/quorum` command in PRs/issues. CI confidence gates ("Security Council ≥ 0.8"). Returns patch suggestions, risk matrix, dissent summary. |

### Phase 2 — Quality + Cost Engine
| # | Feature | Description |
|---|---------|-------------|
| 32 | Adaptive Debate Controller | Dynamic round/model allocation based on disagreement entropy. Stop/expand logic. Presets: `fast`, `balanced`, `critical`. Multi-armed bandit optimization. |
| 33 | Deliberation Memory Graph | Cross-run graph memory: tasks, role setups, vote splits, outcomes. Retrieval at run start. Contradiction detection vs prior decisions. |
| 34 | Adversarial Red-Team Mode | Non-voting attacker agents. Domain attack packs (`code`, `security`, `legal`, `medical`). Outputs `resilience_score` + unresolved risk register. |

### Phase 3 — Moat + Platform
| # | Feature | Description |
|---|---------|-------------|
| 35 | Cognitive Topology DSL | Declarative debate structures: `star`, `mesh`, `tournament`, `map_reduce`, `adversarial_tree`. Template marketplace for common jobs. |
| 36 | Human-in-the-Loop Checkpoints | Mid-run decision gates. Live debugger showing argument graph, vote shifts, "why agent B changed mind." |
| 37 | Eval Arena + Reputation Specialists | Continuous benchmark suite. Track role/agent performance by domain. Reputation-weighted influence. Judge models as meta-evaluators. |
