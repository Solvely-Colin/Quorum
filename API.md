# Quorum Public API Reference

> **Stability:** Stable unless marked `@experimental`. Quorum follows [semver](https://semver.org/) — no breaking changes in minor/patch releases.

## CLI Commands

### Core

| Command | Description |
|---------|-------------|
| `quorum init` | Auto-detect and configure AI providers |
| `quorum ask <question>` | Run a full multi-AI deliberation |
| `quorum review [files...]` | Code review via multi-AI deliberation |
| `quorum ci` | CI/CD-optimized review with structured output |
| `quorum versus <a> <b> <question>` | Head-to-head provider debate |
| `quorum follow-up <question>` | Continue a previous deliberation |
| `quorum mcp` | Start MCP server for AI agent integration |

### Session Management

| Command | Description |
|---------|-------------|
| `quorum session <path>` | View a saved session |
| `quorum history` | List past deliberation sessions |
| `quorum export <session>` | Export session as markdown/HTML |
| `quorum diff <s1> <s2>` | Compare two sessions |
| `quorum explain <session>` | Meta-analyze a deliberation |
| `quorum replay <session>` | Replay debate in real-time |
| `quorum rerun <session>` | Re-run with original or modified config |
| `quorum stats` | Provider win rates and patterns |
| `quorum heatmap <session>` | Consensus heatmap visualization |
| `quorum verify <session>` | Verify session hash chain integrity |

### Provider Management

| Command | Description |
|---------|-------------|
| `quorum providers list` | List configured providers |
| `quorum providers add` | Add a provider |
| `quorum providers remove <name>` | Remove a provider |
| `quorum providers models [provider]` | Browse available models |
| `quorum providers test` | Test all configured providers |

### Auth

| Command | Description |
|---------|-------------|
| `quorum auth login <provider>` | OAuth device flow login |
| `quorum auth list` | List stored OAuth tokens |
| `quorum auth logout <provider>` | Remove OAuth token |

### Advanced

| Command | Description |
|---------|-------------|
| `quorum workspace` | Launch real-time deliberation workspace UI |
| `quorum watch <glob>` | Re-run on file changes |
| `quorum evidence <session>` | Inspect evidence from a run |
| `quorum attacks` | List red team attack packs |
| `quorum topologies` | List available debate topologies |
| `quorum calibration` | View calibration data |

### Sub-commands

| Parent | Sub-command | Description |
|--------|------------|-------------|
| `memory` | `list`, `search`, `clear`, `stats` | Deliberation memory graph |
| `policy` | `list`, `check`, `init`, `show`, `validate` | Policy guardrails |
| `ledger` | `list`, `verify`, `show`, `export`, `replay` | Hash-chained audit trail |
| `arena` | `leaderboard`, `show`, `run`, `reset` | Eval arena & reputation |
| `attest` | `view`, `diff`, `export` | Attestation chain |
| `schema` | `list`, `show`, `create`, `init` | Reasoning schemas |
| `uncertainty` | `trends` | Uncertainty tracking |

## Configuration File

Location: `~/.quorum/config.yaml` (or project-local `quorum.yaml`)

```yaml
providers:
  - name: claude
    provider: anthropic
    model: claude-sonnet-4-20250514
    auth:
      method: env
      envVar: ANTHROPIC_API_KEY

defaultProfile: default
profiles: {}
```

See [docs/configuration.md](docs/configuration.md) for full reference.

## Programmatic Exports

Quorum does not currently expose a stable programmatic API via `import`. The primary interface is the CLI and MCP server. The TypeScript types below are exported from `src/types.ts` for use by plugins and extensions:

### Stable Types

- `ProviderConfig` — Provider configuration
- `ProviderAdapter` — Provider adapter interface
- `AgentProfile` — Deliberation profile
- `DeliberationSession` — Full session data
- `Synthesis` — Synthesis result
- `CounselConfig` — Top-level config shape

### Stable Functions

- `loadConfig()` — Load configuration
- `saveConfig(config)` — Save configuration
- `detectProviders()` — Auto-detect available providers

### @experimental

The following are exported but not yet stable:

- `SessionStore` — File-backed session persistence
- `AdaptiveController` — Adaptive debate controller
- `EvidenceReport` / `CrossReference` — Evidence protocol types
- `RedTeamResult` — Red team analysis types
- `TopologyEngine` — Debate topology engine
- `PolicyEngine` — Policy evaluation engine
- `MemoryGraph` — Cross-run memory retrieval
- `AttestationChain` — Attestation/integrity types
- `CalibrationStore` — Calibration data
- `UncertaintyTracker` — Uncertainty tracking

## Versioning

Quorum follows [Semantic Versioning](https://semver.org/):

- **Major** (1.x → 2.0): Breaking changes to CLI flags, config format, or stable exports
- **Minor** (1.0 → 1.1): New commands, flags, or exports (backward compatible)
- **Patch** (1.0.0 → 1.0.1): Bug fixes only

Items marked `@experimental` may change in minor releases.
