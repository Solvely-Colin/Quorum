# Configuration Reference

## Config File Locations

Quorum searches for configuration in this order:

1. **Project-local:** `./quorum.yaml` (or legacy `./counsel.yaml`)
2. **Global:** `~/.quorum/config.yaml`

## Top-Level Config

```yaml
# ~/.quorum/config.yaml
providers:
  - name: claude
    provider: anthropic
    model: claude-sonnet-4-20250514
    auth:
      method: env
      envVar: ANTHROPIC_API_KEY
    timeout: 120  # seconds (optional)

  - name: ollama
    provider: ollama
    model: llama3
    auth:
      method: none
    baseUrl: http://localhost:11434  # optional

defaultProfile: default
profiles: {}
```

### Provider Config Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Unique identifier for this provider |
| `provider` | string | ✅ | Provider type: `openai`, `anthropic`, `codex`, `ollama`, `google`, `gemini-cli`, `mistral`, `deepseek`, `kimi`, `custom` |
| `model` | string | ✅ | Model identifier |
| `auth` | object | — | Authentication config (see below) |
| `baseUrl` | string | — | Custom API base URL |
| `timeout` | number | — | Per-provider timeout in seconds (default: 120) |

### Auth Methods

```yaml
# Environment variable (recommended)
auth:
  method: env
  envVar: OPENAI_API_KEY

# Direct API key (not recommended — use env instead)
auth:
  method: api_key
  apiKey: sk-...

# OAuth (Claude Code, etc.)
auth:
  method: oauth
  profileName: claude-code

# macOS Keychain
auth:
  method: oauth_keychain
  service: com.anthropic.claude-code

# No auth (local models)
auth:
  method: none
```

## Agent Profiles

Profiles live in `~/.quorum/agents/<name>.yaml` or inline in `config.yaml`.

```yaml
name: my-profile
rounds: 1
focus: [security, performance]
challengeStyle: adversarial  # adversarial | collaborative | socratic
isolation: true
blindReview: false

# Phase customization
phases: [gather, debate, adjust, vote, synthesize]  # custom pipeline

# Provider roles
roles:
  claude: "Security expert focused on OWASP Top 10"
  openai: "Performance engineer"

# Voting
votingMethod: borda  # borda | ranked-choice | approval | condorcet
weights:
  claude: 1.5
  openai: 1.0

# Evidence
evidence: strict  # off | advisory | strict

# Adaptive debate
adaptive: balanced  # fast | balanced | critical | off

# Topology
topology: mesh  # mesh | star | tournament | map_reduce | adversarial_tree | pipeline | panel
topologyConfig:
  hub: claude          # for star topology
  moderator: openai    # for panel topology

# Tools
tools: true
allowShellTool: false

# Red team
redTeam: true
attackPacks: [security, code]

# Human-in-the-loop
hitl: true
hitlPhases: [debate, vote]

# Hooks
hooks:
  pre-gather: "./scripts/fetch-context.sh"
  post-synthesis: "./scripts/notify-slack.sh"

# Scoring weights
scoringWeights:
  accuracy: 0.3
  reasoning: 0.25
  completeness: 0.2
  novelty: 0.15
  consensus: 0.1

# Custom phase prompts
prompts:
  gather:
    system: "You are an expert analyst..."
  debate:
    system: "Challenge every assumption..."
```

### All Profile Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | Profile name |
| `rounds` | number | 1 | Number of deliberation rounds |
| `focus` | string[] | [] | Topics to focus on |
| `challengeStyle` | string | `adversarial` | How providers critique: `adversarial`, `collaborative`, `socratic` |
| `isolation` | boolean | true | Whether providers see each other in gather phase |
| `blindReview` | boolean | false | Hide provider names during review |
| `phases` | string[] | all 7 | Custom phase pipeline |
| `roles` | object | — | Per-provider role descriptions |
| `votingMethod` | string | `borda` | Voting algorithm |
| `weights` | object | — | Per-provider vote weights |
| `evidence` | string | `off` | Evidence mode: `off`, `advisory`, `strict` |
| `adaptive` | string | `off` | Adaptive preset: `fast`, `balanced`, `critical`, `off` |
| `topology` | string | `mesh` | Debate topology |
| `tools` | boolean | false | Enable tool use in gather |
| `allowShellTool` | boolean | false | Enable shell tool |
| `redTeam` | boolean | false | Enable red team analysis |
| `attackPacks` | string[] | — | Red team attack pack names |
| `devilsAdvocate` | boolean | false | Force one provider contrarian |
| `decisionMatrix` | boolean | false | Structured decision scoring |
| `hitl` | boolean | false | Enable HITL checkpoints |
| `hooks` | object | — | Shell commands per phase |
| `convergenceThreshold` | number | — | Score threshold for early consensus |
| `excludeFromDeliberation` | string[] | — | Provider names to skip |
| `prompts` | object | — | Custom system prompts per phase |
| `scoringWeights` | object | — | Scoring dimension weights |

### Built-in Profiles

| Profile | Description |
|---------|-------------|
| `default` | Balanced deliberation |
| `brainstorm` | Creative, collaborative style |
| `code-review` | Focused on code quality |
| `research` | Deep analysis with evidence |
| `decision` | Structured decision matrix |
| `panel` | Panel-style with moderator |
| `quick` | Fast, fewer phases |
| `thorough` | Maximum depth |
| `evidence` | Evidence-strict mode |
| `research-tools` | Research with web search enabled |

## Policy Files

Policies live in `~/.quorum/policies/` or `.quorum/policies/`.

```yaml
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

Actions: `block`, `warn`, `log`, `pause`. Rules evaluate pre- and post-deliberation.

## Project-Local Config

Create `.quorumrc` in your project root. Quorum walks from cwd to homedir looking for it.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `QUORUM_CONFIG` | Override config file path |
| `QUORUM_HOME` | Override config directory (default: `~/.quorum`) |
| Provider API keys | See [providers.md](providers.md) |
