# Quorum

Multi-AI deliberation framework. Ask a question, get answers from multiple AI providers that debate, critique, and refine each other's positions — then synthesize the best answer.

## How It Works

Quorum runs a **7-phase deliberation** across your configured AI providers:

1. **GATHER** — Each provider generates an independent response in isolation
2. **PLAN** — Each sees others' initial takes and plans their argument strategy
3. **FORMULATE** — Each writes a formal position statement, informed by awareness of others
4. **DEBATE** — Room-style: every provider critiques ALL other positions simultaneously
5. **ADJUST** — Each revises their position based on all critiques received
6. **REBUTTAL** — Final round of rebuttals/concessions (skipped if consensus reached)
7. **VOTE** — Each provider ranks all positions; votes are tallied with Borda count scoring

A **synthesis** phase follows: the runner-up (not the winner, to reduce bias) merges the best thinking into a definitive answer with a minority report.

## Setup

```bash
# Install globally
npm install -g quorum-ai
# Or from source
cd quorum-ai && npm install && npm run build && npm link

# Auto-detect providers from environment
quorum init
```

Quorum auto-detects providers from:
- Environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, etc.)
- Claude Code OAuth (macOS Keychain)
- Gemini CLI
- Ollama (local)
- LM Studio (local)

## Usage

```bash
# Ask the council (full deliberation)
quorum ask "What's the best approach for error handling in TypeScript?"

# Single provider mode (no deliberation, with streaming)
quorum ask -1 "Quick question" 
quorum ask --single claude "Explain monads"

# Pipe input
echo "Review this code" | quorum ask

# Use a specific profile
quorum ask --profile code-review "Review my auth implementation"

# Filter providers
quorum ask -p claude,openai "Compare React vs Svelte"

# JSON output (for scripting)
quorum ask --json "question"

# Save full audit trail
quorum ask --audit ./audit.json "question"
```

## Profiles

Profiles control deliberation behavior. Built-in profiles:

- **default** — Balanced deliberation
- **brainstorm** — Creative, divergent thinking
- **code-review** — Focused on code quality, bugs, security
- **research** — Thorough, evidence-based analysis

Custom profiles go in `~/.quorum/agents/myprofile.yaml` or `./agents/myprofile.yaml`:

```yaml
name: my-profile
rounds: 1
focus: [security, performance]
challengeStyle: adversarial  # adversarial | collaborative | socratic
scoringWeights:
  accuracy: 0.3
  reasoning: 0.3
  completeness: 0.2
  novelty: 0.1
  consensus: 0.1
isolation: true
blindReview: false
```

## Provider Configuration

```bash
# List providers
quorum providers list

# Add manually
quorum providers add --name deepseek --type deepseek --model deepseek-chat --env DEEPSEEK_API_KEY

# Remove
quorum providers remove ollama

# Test all providers
quorum providers test

# Browse available models
quorum providers models
quorum providers models anthropic
```

Config is stored in `~/.quorum/config.yaml`. Per-provider timeout (default 120s) can be set in the config:

```yaml
providers:
  - name: claude
    provider: anthropic
    model: claude-sonnet-4-20250514
    timeout: 180
    auth:
      method: env
      envVar: ANTHROPIC_API_KEY
```

## Sessions & History

Every deliberation is saved to `~/.quorum/sessions/<id>/`.

```bash
# View a past session (all phases summarized)
quorum session ~/.quorum/sessions/<id>

# View a specific phase in detail
quorum session ~/.quorum/sessions/<id> --phase debate
quorum session ~/.quorum/sessions/<id> --phase synthesis

# List past sessions
quorum history
quorum history -n 50
```

## Architecture

```
src/
├── cli.ts            # Commander-based CLI entry point
├── council-v2.ts     # 7-phase deliberation engine
├── providers/
│   └── base.ts       # Provider adapter (all through pi-ai)
├── session.ts        # File-backed session persistence
├── config.ts         # YAML config + provider auto-detection
├── context.ts        # Token budget management + truncation
├── auth.ts           # OAuth device flow + keychain + credential resolution
└── types.ts          # Core type definitions
```

All providers route through [`@mariozechner/pi-ai`](https://github.com/nichochar/pi-ai) for unified API access. The only exception is `gemini-cli`, which uses a child process shim due to OAuth scope differences.

Context management keeps prompts within each provider's token limits — full-priority content is preserved while lower-priority content is proportionally trimmed.

## License

MIT
