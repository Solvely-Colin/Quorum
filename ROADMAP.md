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
| 28 | Evidence-Backed Claims Protocol | See detailed spec below |
| 29 | Deterministic Replay + Signed Ledger | Persist all run artifacts (prompts, model versions, votes). Hash-chain ledger. `quorum replay <run-id>` for near-reproducible reruns. ADR-style decision records. |
| 30 | Policy-as-Code Guardrails | Rego/Cedar-style policies: allowed tools, escalation thresholds, max cost, required evidence level, human approval gates. |
| 31 | Native PR/CI Integration (Deep) | See detailed spec below |

### #28 Evidence-Backed Claims Protocol — Detailed Spec

**Priority:** Highest — this is what makes Quorum fundamentally different from "consensus = vibes"

**Impact ranking (Colin):** #2 overall (after PR/CI), #1 for building on next

#### 1. Structured Claim Extraction
- NLP-style sentence splitting — every substantive assertion is a claim, tagged or not
- Not just marker-adjacent text; full response parsing
- Claims deduped by semantic similarity within a provider's response

#### 2. Source Quality Tiers
Not all sources are equal — scored by verifiability:
| Tier | Type | Weight | Example |
|------|------|--------|---------|
| A | `url` (verifiable link) | 1.0 | `[source: https://docs.python.org/...]` |
| B | `file` (local path) | 0.8 | `[source: src/config.ts:42]` |
| C | `data` (stats with attribution) | 0.7 | `[source: "Node.js 2025 survey, 73% adoption"]` |
| D | `reasoning` (logical argument) | 0.4 | `[source: reasoning]` |
| F | unsupported | 0.0 | No tag |

#### 3. Cross-Provider Claim Validation
- Build a claim dedup matrix across all providers
- If N providers independently cite the same fact → corroboration score
- Contradictory claims flagged explicitly in evidence report
- Feeds into synthesis: "X's claim about Y was corroborated by Z but contradicted by W"

#### 4. Real Voting Penalty
- Evidence scores apply as **multipliers** to Borda scores (not just a footnote)
- `advisory` mode: evidence score shown but doesn't affect votes
- `strict` mode: unsupported claims get 0.5x vote weight
- Per-claim penalty: claims without sources weighted down in synthesis prompt

#### 5. CLI Command: `quorum evidence <session|last>`
- Claim breakdown per provider: supported vs unsupported
- Source quality distribution (tier A/B/C/D/F)
- Cross-reference matrix showing corroboration
- Overall evidence score with letter grade

#### 6. Synthesis Integration
- Synthesizer receives full evidence matrix, not just percentages
- Prompt includes: "Provider X's claim about Y was corroborated by Z (source tier A) but unsupported by W"
- Minority report flags claims that are well-sourced but outvoted

#### 7. Source Verification (optional, when `--tools` enabled)
- Fetch URLs to verify they exist and support the claim
- Mark verified vs unverified sources
- Dead links → downgrade source tier to D

#### Implementation Plan
- **Sub-agent 1 (Core):** Claim extraction, source tiers, cross-validation, scoring engine
- **Sub-agent 2 (Integration):** council-v2 voting penalty, synthesis prompt, evidence modes
- **Sub-agent 3 (CLI):** `quorum evidence` command, report formatting, output

---

### #31 Native PR/CI Integration (Deep) — Detailed Spec

**Priority:** #1 by impact — adoption driver, viral team spread

**What exists (V1 #20):** `quorum review --staged`, `--diff [ref]`, `--pr <number>` — local CLI only

#### 1. `quorum ci` Command (CI-optimized output)
New command for non-interactive CI environments:
```bash
quorum ci --pr <number> [options]
quorum ci --diff <ref> [options]
quorum ci --staged [options]
```
Options:
- `--confidence-threshold <0.0-1.0>` — exit code 1 if below threshold (gate)
- `--format json|markdown|github` — output format (github = PR comment markdown)
- `--post-comment` — automatically post result as PR comment via `gh`
- `--label` — add labels to PR based on result (e.g., `quorum:approved`, `quorum:needs-discussion`)
- `--evidence <mode>` — evidence mode (advisory/strict)
- `--profile <name>` — agent profile (defaults to `code-review`)
- `--max-files <n>` — skip if PR has more than N changed files
- `--focus <areas>` — focus areas (security, performance, etc.)

Exit codes: 0 = pass, 1 = below threshold, 2 = error

#### 2. GitHub Action (`action.yml`)
Reusable GitHub Action at repo root:
```yaml
# .github/workflows/quorum-review.yml
- uses: quorum-ai/quorum@v1
  with:
    providers: claude,kimi
    profile: code-review
    confidence-threshold: 0.7
    evidence: advisory
    post-comment: true
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    KIMI_API_KEY: ${{ secrets.KIMI_API_KEY }}
```

Creates `action.yml` + `action/entrypoint.sh` that:
- Installs quorum via npm
- Runs `quorum ci --pr $PR_NUMBER --format github --post-comment`
- Sets output variables: `confidence`, `consensus`, `winner`, `approved`

#### 3. PR Comment Format
```markdown
## 🏛️ Quorum Code Review

**Consensus:** 0.85 | **Confidence:** 0.78 | **Evidence:** B (62%)

### Summary
[Synthesis content — key findings]

<details><summary>🔍 Risk Matrix</summary>

| Area | Risk | Details |
|------|------|---------|
| Security | 🟡 Medium | SQL injection possible in query builder |
| Performance | 🟢 Low | No hot-path changes |
| Breaking Changes | 🔴 High | Public API signature changed |

</details>

<details><summary>⚖️ Dissent Summary</summary>
[Minority report — what the losing providers argued]
</details>

<details><summary>📋 Evidence Report</summary>
[Per-provider claim breakdown]
</details>

<details><summary>💡 Patch Suggestions</summary>

```suggestion
// file: src/query.ts, line 42
- const query = `SELECT * FROM ${table}`;
+ const query = `SELECT * FROM ${sanitize(table)}`;
```

</details>
```

#### 4. Structured CI Output (`--format json`)
```typescript
interface CIResult {
  approved: boolean;
  confidence: number;
  consensus: number;
  evidenceGrade: string;
  riskMatrix: Array<{ area: string; risk: 'low' | 'medium' | 'high' | 'critical'; details: string }>;
  suggestions: Array<{ file: string; line: number; before: string; after: string; rationale: string }>;
  dissent: string;
  synthesis: string;
  providers: string[];
  duration: number;
}
```

#### 5. Risk Matrix Generation
Add to synthesis prompt when in CI mode:
- Categorize findings into: Security, Performance, Breaking Changes, Correctness, Style, Testing
- Score each: low/medium/high/critical
- Extract from debate disagreements — if providers disagree on risk, flag as medium+

#### 6. Patch Suggestions
Parse provider responses for code suggestions:
- Detect ````suggestion` blocks or "change X to Y" patterns
- Normalize into GitHub suggestion format (file, line, before/after)
- Deduplicate across providers (majority wins)

#### Implementation Plan
- **Sub-agent 1 (CI Command):** `quorum ci` in cli.ts — PR/diff input, structured output, exit codes, `--post-comment`
- **Sub-agent 2 (GitHub Action):** `action.yml`, entrypoint, PR comment formatting, label management
- **Sub-agent 3 (Risk + Suggestions):** Risk matrix extraction, patch suggestion parsing, CI-specific synthesis prompts
- **Sub-agent 4 (git.ts extensions):** PR metadata (labels, reviewers, checks), comment posting via `gh api`

---

### Phase 2 — Quality + Cost Engine
| # | Feature | Description |
|---|---------|-------------|
| 32 | Adaptive Debate Controller | See detailed spec below |

### #32 Adaptive Debate Controller — Detailed Spec

**Priority:** #3 by impact — immediate quality/cost ROI on every deliberation

**Problem:** Fixed phase pipelines waste compute. Easy questions get 7 full phases. Hard questions might need extra debate rounds. No learning across sessions.

#### 1. Disagreement Entropy (`src/adaptive.ts`)
Measure how much providers disagree after each phase:
- **Term divergence:** inverse of `measureConvergence()` (already exists)
- **Position entropy:** Shannon entropy over key claim distribution
- **Sentiment polarity spread:** if providers have opposing conclusions
- Score 0.0 (total agreement) → 1.0 (total disagreement)

#### 2. Adaptive Phase Controller
After each phase, the controller decides: **continue**, **skip ahead**, or **add rounds**.
```typescript
interface AdaptiveDecision {
  action: 'continue' | 'skip' | 'add-round' | 'escalate';
  reason: string;
  entropy: number;
  phasesRemaining: string[];
}
```

Rules:
- **After gather:** if entropy < 0.2 → skip to vote+synthesize (they already agree)
- **After debate:** if entropy < 0.3 → skip adjust/rebuttal, go to vote
- **After debate:** if entropy > 0.8 → add another debate round (max 2 extra)
- **After adjust:** if entropy still > 0.7 → add rebuttal (even if would be skipped)
- Convergence threshold from profile still respected

#### 3. Presets (profile YAML)
```yaml
adaptive: fast       # aggressive skipping, 1 extra round max
adaptive: balanced   # default, up to 2 extra rounds
adaptive: critical   # conservative, up to 3 extra rounds, never skips
adaptive: off        # current behavior (no adaptation)
```

Also: `--adaptive <preset>` CLI flag override.

#### 4. Multi-Armed Bandit (learning across sessions)
Store outcome data in `~/.quorum/adaptive-stats.json`:
```typescript
interface AdaptiveStats {
  phaseSkips: Record<string, { count: number; avgConfidence: number }>;
  extraRounds: Record<string, { count: number; avgConfidence: number }>;
  providerPairEntropy: Record<string, number>; // "claude+kimi" → avg entropy
}
```
- Track: which skips led to high-confidence outcomes (good) vs low-confidence (bad)
- Over time, tune skip thresholds per provider combination
- Simple: just adjust thresholds by ±0.05 based on outcome history

#### 5. Council-v2 Integration
- Controller wraps the phase loop in `deliberate()`
- After each `runPhase()`, call `controller.evaluate()` to get next action
- Emit events: `adaptive:skip`, `adaptive:add-round`, `adaptive:escalate`
- Store adaptive decisions in session for replay/analysis

#### 6. CLI Output
Show adaptive decisions inline:
```
⚡ ADAPTIVE: Entropy 0.18 after GATHER — skipping to VOTE (providers agree)
⚡ ADAPTIVE: Entropy 0.82 after DEBATE — adding extra debate round (high disagreement)
```

#### Implementation Plan
- **Sub-agent 1 (Core):** `src/adaptive.ts` — entropy calculation, decision engine, presets, stats persistence
- **Sub-agent 2 (Integration):** Wire into `council-v2.ts` — phase loop wrapping, events, session storage
- **Sub-agent 3 (CLI + Types):** `--adaptive` flag in cli.ts, `adaptive` field in AgentProfile type, profile YAML support

---

| 33 | Deliberation Memory Graph | Cross-run graph memory: tasks, role setups, vote splits, outcomes. Retrieval at run start. Contradiction detection vs prior decisions. |
| 34 | Adversarial Red-Team Mode | See detailed spec below |

### #34 Adversarial Red-Team Mode — Detailed Spec

**Priority:** #4 by impact — unique, marketable, catches blind spots no other tool finds

**Concept:** Non-voting attacker agents that stress-test the council's conclusions. They participate in debate but DON'T vote — pure adversarial pressure.

#### 1. `--red-team` CLI Flag
```bash
quorum ask --red-team "Should we migrate to microservices?"
quorum ask --red-team --attack-pack security "Review our auth flow"
quorum ask --red-team custom "Find every flaw in this argument"
```

#### 2. Attack Packs (domain-specific attack strategies)
Bundled YAML files in `agents/attacks/`:
- **`general.yaml`** — logical fallacies, hidden assumptions, missing evidence, scope creep, survivorship bias
- **`code.yaml`** — edge cases, race conditions, error paths, injection, resource leaks, backwards compat
- **`security.yaml`** — OWASP top 10, privilege escalation, data exfiltration, supply chain, timing attacks
- **`legal.yaml`** — liability, compliance gaps, IP issues, regulatory risk, jurisdictional conflicts
- **`medical.yaml`** — contraindications, sample size issues, publication bias, off-label risks

#### 3. Red Team Agent Behavior
- Runs AFTER the main deliberation's adjust phase (sees all revised positions)
- Gets a special system prompt: "You are a red team agent. Your ONLY job is to find flaws, risks, and blind spots. Do not be constructive. Do not suggest fixes. Just break things."
- Each attack pack adds domain-specific attack vectors to the prompt
- Red team agents are clearly labeled in output (🔴 prefix)
- Their critiques feed into synthesis but they do NOT vote

#### 4. Resilience Score
```typescript
interface RedTeamResult {
  attacks: RedTeamAttack[];
  resilienceScore: number;      // 0-1: how well did positions survive?
  unresolvedRisks: string[];    // attacks no provider addressed
  mitigatedRisks: string[];     // attacks that were already covered
  blindSpots: string[];         // things nobody considered
}

interface RedTeamAttack {
  category: string;           // from attack pack
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  targetProvider?: string;    // who they're attacking
  addressed: boolean;         // was this already covered?
  addressedBy?: string[];     // which providers covered it
}
```

#### 5. Output
```
🔴 RED TEAM REPORT
Resilience: 72% | Attacks: 8 | Unresolved: 3

Unresolved Risks:
  🔴 [CRITICAL] No rate limiting on auth endpoint — nobody addressed this
  🔴 [HIGH] Session tokens don't expire — mentioned but not resolved
  🟡 [MEDIUM] Error messages leak stack traces — partially addressed by claude

Mitigated (already covered):
  ✅ SQL injection — addressed by claude, kimi
  ✅ CSRF protection — addressed by kimi
```

#### 6. Synthesis Integration
- Red team results appended to synthesis prompt as "adversarial findings"
- Synthesizer must address unresolved risks in the final answer
- Minority report includes red team blind spots

#### 7. Profile YAML
```yaml
redTeam: true
attackPacks: [security, code]
# Or custom attacks:
customAttacks:
  - "Check for GDPR compliance gaps"
  - "Find single points of failure"
```

#### Implementation Plan
- **Sub-agent 1 (Core):** `src/redteam.ts` — attack execution, resilience scoring, attack parsing, result types
- **Sub-agent 2 (Attack Packs):** `agents/attacks/*.yaml` — all 5 domain packs with structured attack vectors
- **Sub-agent 3 (Integration):** Wire into `council-v2.ts` + `cli.ts` + `types.ts` — flag, phase insertion, output

---

### Phase 3 — Moat + Platform
| # | Feature | Description |
|---|---------|-------------|
| 35 | Cognitive Topology DSL | Declarative debate structures: `star`, `mesh`, `tournament`, `map_reduce`, `adversarial_tree`. Template marketplace for common jobs. |
| 36 | Human-in-the-Loop Checkpoints | Mid-run decision gates. Live debugger showing argument graph, vote shifts, "why agent B changed mind." |
| 37 | Eval Arena + Reputation Specialists | Continuous benchmark suite. Track role/agent performance by domain. Reputation-weighted influence. Judge models as meta-evaluators. |
