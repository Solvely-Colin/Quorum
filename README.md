<div align="center">

# Quorum

**Multi-AI deliberation framework — diverge, challenge, converge.**

Ask a question. Multiple AI providers debate, critique, and refine each other's thinking. Get a synthesized answer that's better than any single model.

[![npm version](https://img.shields.io/npm/v/quorum-ai)](https://www.npmjs.com/package/quorum-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## Quick Start

```bash
npm install -g quorum-ai
quorum init          # auto-detect your AI providers
quorum ask "What's the best approach for error handling in TypeScript?"
```

That's it. Quorum finds your API keys, runs a 7-phase deliberation across providers, and returns a synthesized answer with confidence scores.

## How It Works

Quorum runs a **7-phase deliberation** across your configured AI providers:

1. **Gather** — Each provider responds independently, in isolation
2. **Plan** — Each sees others' takes and plans their argument
3. **Formulate** — Formal position statements
4. **Debate** — Every provider critiques all other positions simultaneously
5. **Adjust** — Each revises based on critiques received
6. **Rebuttal** — Final rebuttals or concessions (auto-skipped if consensus reached)
7. **Vote** — Ranked voting via Borda count (or ranked-choice, approval, Condorcet)

A **synthesis** phase follows: the runner-up (not the winner, to reduce bias) merges the best thinking into a definitive answer with a minority report.

## Features

- **Multi-provider deliberation** — Claude, GPT, Gemini, Kimi, DeepSeek, Mistral, Ollama, and more
- **Adaptive debate** — Auto-skip or extend rounds based on disagreement
- **Evidence protocol** — Providers cite sources; claims are cross-validated
- **Code review** — Review files, staged changes, PRs, or diffs
- **CI/CD integration** — Structured output, exit codes, auto-commenting
- **Policy guardrails** — YAML rules that block, warn, or pause deliberations
- **Deterministic replay** — SHA-256 hash-chained ledger for auditability
- **Human-in-the-loop** — Pause at any phase to inject guidance
- **Debate topologies** — Mesh, star, tournament, pipeline, and more
- **MCP server** — Use Quorum as a tool in Claude Desktop, Cursor, or any MCP client
- **Red team analysis** — Adversarial attack packs for robustness testing

## Provider Setup

Quorum auto-detects providers from environment variables:

| Provider           | Environment Variable           | Install                                                |
| ------------------ | ------------------------------ | ------------------------------------------------------ |
| OpenAI             | `OPENAI_API_KEY`               | [platform.openai.com](https://platform.openai.com)     |
| Anthropic (Claude) | `ANTHROPIC_API_KEY`            | [console.anthropic.com](https://console.anthropic.com) |
| Google (Gemini)    | `GOOGLE_GENERATIVE_AI_API_KEY` | [aistudio.google.com](https://aistudio.google.com)     |
| Kimi (Moonshot)    | `KIMI_API_KEY`                 | [platform.moonshot.cn](https://platform.moonshot.cn)   |
| DeepSeek           | `DEEPSEEK_API_KEY`             | [platform.deepseek.com](https://platform.deepseek.com) |
| Mistral            | `MISTRAL_API_KEY`              | [console.mistral.ai](https://console.mistral.ai)       |
| Groq               | `GROQ_API_KEY`                 | [console.groq.com](https://console.groq.com)           |
| Ollama             | _(local, no key)_              | [ollama.com](https://ollama.com)                       |

```bash
# Set your keys, then:
quorum init                    # auto-detect everything
quorum providers list          # see what's configured
quorum providers test          # verify they work
```

Or add manually:

```bash
quorum providers add --name deepseek --type deepseek --model deepseek-chat --env DEEPSEEK_API_KEY
```

See [docs/providers.md](docs/providers.md) for detailed setup instructions.

## CLI Reference

```bash
# Deliberation
quorum ask "question"                        # full 7-phase deliberation
quorum ask --rapid "question"                # 3-phase: gather → debate → synthesize
quorum ask -1 "quick question"               # single provider, no deliberation
quorum ask --evidence strict "question"      # require cited sources
quorum ask --adaptive balanced "question"    # auto-adjust based on disagreement
quorum ask --devils-advocate "question"      # force one provider contrarian
quorum ask --profile decision "question"     # use a named profile
quorum versus claude kimi "tabs vs spaces"   # head-to-head

# Code Review
quorum review src/auth.ts                    # review specific files
quorum review --staged                       # review staged changes
quorum review --pr 42                        # review a GitHub PR
quorum review --diff main                    # review diff against branch

# CI/CD
quorum ci --pr 42 --confidence-threshold 0.7 --post-comment

# Session Management
quorum history                               # list past sessions
quorum session last                          # view last session
quorum follow-up last "what about X?"        # continue deliberation
quorum export last --format html             # export as HTML
quorum rerun last --compare                  # re-run and compare

# Provider Management
quorum providers list | add | remove | test | models
quorum auth login | list | logout

# Advanced
quorum workspace                             # real-time deliberation UI
quorum mcp                                   # start MCP server
quorum watch src/*.ts                        # re-run on file changes
```

See [docs/cli.md](docs/cli.md) for the complete reference with all flags.

## Configuration

Config lives at `~/.quorum/config.yaml` (or project-local `quorum.yaml`):

```yaml
providers:
  - name: claude
    provider: anthropic
    model: claude-sonnet-4-20250514
    auth:
      method: env
      envVar: ANTHROPIC_API_KEY
  - name: openai
    provider: openai
    model: gpt-4o
    auth:
      method: env
      envVar: OPENAI_API_KEY

defaultProfile: default
```

### Profiles

Profiles customize deliberation behavior. Built-in: `default`, `brainstorm`, `code-review`, `research`, `decision`, `panel`, `quick`, `thorough`, `evidence`, `research-tools`.

```yaml
# ~/.quorum/agents/security-review.yaml
name: security-review
rounds: 1
focus: [security, authentication, authorization]
challengeStyle: adversarial
evidence: strict
adaptive: balanced
roles:
  claude: 'OWASP security expert'
  kimi: 'penetration tester'
votingMethod: condorcet
```

See [docs/configuration.md](docs/configuration.md) for all options.

## Architecture

```
src/
├── cli.ts            # CLI entry point (commander.js)
├── council-v2.ts     # 7-phase deliberation engine
├── providers/base.ts # Provider adapter (via pi-ai)
├── adaptive.ts       # Adaptive debate controller
├── evidence.ts       # Evidence protocol & cross-validation
├── policy.ts         # YAML policy guardrails engine
├── topology.ts       # 7 debate topologies (mesh, star, etc.)
├── arena.ts          # Eval arena & reputation system
├── ledger.ts         # Hash-chained audit trail
├── hitl.ts           # Human-in-the-loop checkpoints
├── memory-graph.ts   # Cross-run memory retrieval
├── voting.ts         # Pluggable voting algorithms
├── mcp.ts            # MCP server integration
├── config.ts         # YAML config & auto-detection
├── session.ts        # File-backed session persistence
└── types.ts          # Core TypeScript types
```

See [docs/architecture.md](docs/architecture.md) for a detailed walkthrough.

## Stability

Quorum follows [Semantic Versioning](https://semver.org/). Starting with v1.0:

- **CLI commands and flags** are stable — no breaking changes in minor releases
- **Config file format** (`config.yaml`, profile YAML) is stable
- **Programmatic exports** marked `@experimental` may change in minor releases
- See [API.md](API.md) for the full public API surface

## MCP Server

Run Quorum as a tool for AI agents:

```bash
quorum mcp
```

Add to Claude Desktop config:

```json
{
  "mcpServers": {
    "quorum": { "command": "quorum", "args": ["mcp"] }
  }
}
```

Exposes: `quorum_ask`, `quorum_review`, `quorum_versus`, `quorum_providers`, `quorum_history`.

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make changes with tests: `npm test`
4. Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`
5. Open a PR

```bash
git clone https://github.com/Solvely-Colin/Quorum.git
cd Quorum && npm install
npm run dev -- ask "test question"   # run from source
npm test                              # run tests
npm run lint                          # lint
npm run format                        # format
```

## License

[MIT](LICENSE) © Colin Johnson

## CI/CD

Managed by `solvely-launchpad`. Update with:

```bash
npx solvely-launchpad migrate --from v1 --to v1.x
```
