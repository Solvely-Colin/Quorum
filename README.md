<div align="center">

```
 ██████╗ ██╗   ██╗ ██████╗ ██████╗ ██╗   ██╗███╗   ███╗
██╔═══██╗██║   ██║██╔═══██╗██╔══██╗██║   ██║████╗ ████║
██║   ██║██║   ██║██║   ██║██████╔╝██║   ██║██╔████╔██║
██║▄▄ ██║██║   ██║██║   ██║██╔══██╗██║   ██║██║╚██╔╝██║
╚██████╔╝╚██████╔╝╚██████╔╝██║  ██║╚██████╔╝██║ ╚═╝ ██║
 ╚══▀▀═╝  ╚═════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝
```

*Consensus, validated.*

</div>

Multi-AI deliberation framework. Ask a question, get answers from multiple AI providers that debate, critique, and refine each other's positions — then synthesize the best answer.

## How It Works

Quorum runs a **7-phase deliberation** across your configured AI providers:

1. **GATHER** — Each provider generates an independent response in isolation
2. **PLAN** — Each sees others' initial takes and plans their argument strategy
3. **FORMULATE** — Each writes a formal position statement
4. **DEBATE** — Room-style: every provider critiques ALL other positions simultaneously
5. **ADJUST** — Each revises their position based on all critiques received
6. **REBUTTAL** — Final rebuttals/concessions (auto-skipped if consensus reached)
7. **VOTE** — Each provider ranks all positions; tallied via Borda count (or ranked-choice, approval, Condorcet)

A **synthesis** phase follows: the runner-up (not the winner, to reduce bias) merges the best thinking into a definitive answer with a minority report and "What Would Change My Mind" section.

## Quick Start

```bash
# From npm
npm install -g quorum-ai

# From source
git clone https://github.com/Solvely-Colin/Quorum.git
cd Quorum && npm install && npm run build && npm link
```

```bash
quorum init                    # auto-detect providers
quorum ask "Your question"     # full deliberation
```

## Usage

```bash
# Full deliberation
quorum ask "What's the best approach for error handling in TypeScript?"

# Rapid mode (3-phase: gather → debate → synthesize)
quorum ask --rapid "Quick comparison of React vs Svelte"

# Single provider (no deliberation)
quorum ask -1 "Quick question"

# Evidence-backed claims (providers must cite sources)
quorum ask --evidence strict "Is Rust faster than Go for web servers?"

# Adaptive debate (auto-skip/extend based on disagreement)
quorum ask --adaptive balanced "Should we use microservices?"

# Devil's advocate (one provider forced contrarian)
quorum ask --devils-advocate "Is our architecture correct?"

# Decision matrix (structured scoring grid)
quorum ask --profile decision "PostgreSQL vs MySQL vs SQLite for our use case"

# Head-to-head
quorum versus claude kimi "Tabs vs spaces"

# Filter providers, custom profile, pipe input
echo "Review this" | quorum ask -p claude,openai --profile code-review
```

## Code Review

```bash
# Review files
quorum review src/auth.ts src/utils.ts

# Review staged changes
quorum review --staged

# Review a PR
quorum review --pr 42

# Review diff against a branch
quorum review --diff main
```

## CI/CD Integration

```bash
# CI-optimized (structured output, exit codes, auto-comment)
quorum ci --pr 42 --confidence-threshold 0.7 --post-comment

# JSON output for pipelines
quorum ci --pr 42 --format json

# With evidence and labeling
quorum ci --pr 42 --evidence strict --label --format github
```

Exit codes: `0` = pass, `1` = below confidence threshold, `2` = error

## Adaptive Debate

The adaptive controller dynamically adjusts deliberation based on disagreement entropy:

```bash
quorum ask --adaptive fast "question"      # aggressive skipping
quorum ask --adaptive balanced "question"  # default, up to 2 extra rounds
quorum ask --adaptive critical "question"  # conservative, never skips debate
```

- **Low entropy after gather** → skip to vote (providers already agree)
- **High entropy after debate** → add extra debate rounds
- **Learns over time** via multi-armed bandit (stored in `~/.quorum/adaptive-stats.json`)

## Evidence Protocol

Providers tag claims with sources. Quorum scores and cross-validates them.

```bash
# Advisory mode (show scores, don't affect votes)
quorum ask --evidence advisory "question"

# Strict mode (unsupported claims penalized in voting)
quorum ask --evidence strict "question"

# Inspect evidence after a run
quorum evidence last
quorum evidence last --provider claude --tier A
```

Source quality tiers: **A** (URL) → **B** (file path) → **C** (data/stats) → **D** (reasoning) → **F** (unsupported)

Cross-provider validation detects corroborated and contradicted claims across providers.

## Policy Guardrails

Define rules that govern deliberation behavior using YAML policies:

```bash
# Use a built-in policy
quorum ask --policy strict "Should we deploy on Friday?"

# List available policies
quorum policy list

# Check a policy against current config
quorum policy check strict
```

Policies evaluate pre- and post-deliberation with four action types: `block`, `warn`, `log`, `pause`.

```yaml
# ~/.quorum/policies/my-policy.yaml
name: production
rules:
  - condition: confidence < 0.7
    action: block
    message: "Confidence too low for production decisions"
  - condition: evidence_grade < C
    action: warn
    message: "Evidence quality below threshold"
  - condition: providers_count < 3
    action: pause
    message: "Consider adding more providers"
```

Built-in policies: `default` (permissive baseline) and `strict` (production-hardened). Policy files are loaded from `~/.quorum/policies/` or project-local `.quorum/policies/`.

## Deterministic Replay + Ledger

Every deliberation is recorded in a SHA-256 hash-chained ledger for auditability and reproducibility:

```bash
# Re-run a previous deliberation
quorum rerun last
quorum rerun <session-id> --diff      # show differences vs original
quorum rerun <session-id> --dry-run   # preview without API calls

# Ledger management
quorum ledger list                      # show all entries
quorum ledger verify                    # validate hash chain integrity
quorum ledger show <id>                 # inspect a specific entry
quorum ledger export <id>              # export as ADR markdown
```

The ledger (`~/.quorum/ledger.json`) stores prompts, model versions, votes, and outcomes with tamper-evident hash chaining.

## Human-in-the-Loop Checkpoints

Pause deliberation at configurable phases for human review, guidance injection, or vote overrides:

```bash
# Enable HITL checkpoints
quorum ask --hitl "Critical architecture decision"

# Combines with other flags
quorum ask --hitl --evidence strict --adaptive critical "question"
```

When paused, you can:
- **Inject guidance** — add context or steer the deliberation
- **Override winners** — manually set vote results before synthesis
- **Resume** — continue with optional modifications

Auto-pause triggers when disagreement entropy exceeds threshold (high controversy).

Profile YAML: `hitl: true`, `hitlPhases: [debate, vote]`

## Eval Arena + Reputation

Track provider performance and use reputation-weighted voting:

```bash
# Arena commands
quorum arena leaderboard               # overall provider rankings
quorum arena show claude               # detailed breakdown for a provider
quorum arena run                       # run eval suite
quorum arena reset                     # clear arena data

# Enable reputation-weighted voting
quorum ask --reputation "question"
```

Providers build reputation scores based on win rates, evidence quality, and outcome metrics across domains. With `--reputation`, stronger-performing providers get proportionally more vote influence.

Reputation data stored in `~/.quorum/arena.json`.

## Session Tools

```bash
# Session management
quorum session list                     # list all sessions
quorum session show <id>                # show session details

# History
quorum history

# Follow-up on a previous deliberation
quorum follow-up last "But what about edge cases?"

# Compare two sessions
quorum diff <session1> <session2> --analyze

# Meta-analysis
quorum explain last

# Re-run with different providers
quorum rerun last --providers claude,deepseek --compare

# Replay debate in real-time
quorum replay last --speed slow

# Export report
quorum export last --format html --output report.html

# Provider stats (win rates, patterns)
quorum stats

# Consensus heatmap
quorum heatmap last

# Red team attack analysis
quorum attacks

# List available debate topologies
quorum topologies                       # or: quorum topo

# OAuth and credential management
quorum auth
```

## Profiles

Built-in: `default`, `brainstorm`, `code-review`, `research`, `decision`, `panel`, `quick`, `thorough`, `evidence`, `research-tools`

```yaml
# ~/.quorum/agents/my-profile.yaml
name: security-review
rounds: 1
focus: [security, authentication, authorization]
challengeStyle: adversarial
evidence: strict
adaptive: balanced
phases: [gather, debate, adjust, vote, synthesize]
roles:
  claude: "OWASP security expert"
  kimi: "penetration tester"
weights:
  claude: 1.5
votingMethod: condorcet
hooks:
  pre-gather: "./scripts/fetch-context.sh"
  post-synthesis: "./scripts/notify-slack.sh"
```

Project-local config via `.quorumrc` (walks cwd → homedir).

## Advanced Features

| Feature | Flag/Command | Description |
|---------|-------------|-------------|
| Weighted providers | `--weight claude=2,kimi=1` | Give providers more/less vote influence |
| Custom voting | `votingMethod: condorcet` | Borda, ranked-choice, approval, Condorcet |
| Watch mode | `quorum watch src/*.ts` | Re-run on file save |
| Tool use | `--tools` | Providers can web search, read files |
| Plugin hooks | `hooks:` in profile | Pre/post scripts per phase |
| Dry run | `--dry-run` | Preview prompts without API calls |
| Inline overrides | `--focus`, `--rounds`, etc. | Override profile fields from CLI |
| Policy guardrails | `--policy strict` | YAML policy engine with block/warn/log/pause |
| Ledger + replay | `quorum ledger verify` | SHA-256 hash-chained audit trail |
| HITL checkpoints | `--hitl` | Pause/resume with human guidance |
| Reputation voting | `--reputation` | Performance-weighted provider influence |
| Topology DSL | `--topology tournament` | 7 debate structures (mesh, star, etc.) |
| Memory graph | `quorum memory search` | Cross-run retrieval + contradiction detection |

## Provider Setup

```bash
quorum providers list           # show configured
quorum providers test           # test all
quorum providers models         # browse available
quorum providers add --name deepseek --type deepseek --model deepseek-chat --env DEEPSEEK_API_KEY
```

Auto-detects: OpenAI, Anthropic, Google, Kimi, DeepSeek, Mistral, Ollama, LM Studio, Claude Code OAuth, Gemini CLI.

Config: `~/.quorum/config.yaml`

## Architecture

```
src/
├── cli.ts            # CLI (commander.js)
├── council-v2.ts     # 7-phase deliberation engine
├── adaptive.ts       # Adaptive debate controller + bandit learning
├── arena.ts          # Eval arena, reputation tracking, weighted voting
├── evidence.ts       # Evidence-backed claims protocol
├── hitl.ts           # Human-in-the-loop checkpoints, pause/resume
├── ledger.ts         # Hash-chained ledger, verification, ADR export
├── memory.ts         # Deliberation memory graph, keyword retrieval
├── policy.ts         # YAML policy engine, evaluation, built-in policies
├── topology.ts       # Topology engine, 7 debate topologies
├── ci.ts             # CI output formatting, risk matrix, patch suggestions
├── git.ts            # Git/GitHub integration (PR, comments, labels)
├── voting.ts         # Pluggable voting algorithms
├── heatmap.ts        # Consensus heatmap (Spearman correlation)
├── hooks.ts          # Plugin/hook system
├── tools.ts          # MCP/tool use (web search, file read, shell)
├── export.ts         # Report export (markdown, HTML)
├── providers/base.ts # Provider adapter (all through pi-ai)
├── session.ts        # File-backed session persistence
├── config.ts         # YAML config + auto-detection
├── context.ts        # Token budget management
├── auth.ts           # OAuth + keychain + credentials
└── types.ts          # Core types
```

All providers route through [`@mariozechner/pi-ai`](https://github.com/nichochar/pi-ai) for unified API access.

## MCP Server (Model Context Protocol)

Quorum can run as an MCP server, exposing its deliberation capabilities as tools for any MCP-compatible client (Claude Desktop, Cursor, OpenClaw, etc.).

### Start the MCP server

```bash
quorum mcp
```

This starts a stdio-based MCP server that exposes the following tools:

| Tool | Description |
|------|-------------|
| `quorum_ask` | Run a full multi-AI deliberation on any question |
| `quorum_review` | Code review via multi-AI deliberation (files, staged, diff, PR) |
| `quorum_versus` | Head-to-head comparison between two providers |
| `quorum_providers` | List configured providers with status |
| `quorum_history` | List recent deliberation sessions |

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

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

If `quorum` isn't on your PATH, use the full path (e.g. from `which quorum` or `npx quorum`).

## License

MIT
