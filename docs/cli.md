# CLI Reference

## Global Options

```
quorum --version    Show version
quorum --help       Show help
```

---

## `quorum init`

Auto-detect and configure AI providers.

```bash
quorum init [--non-interactive]
```

| Flag | Description |
|------|-------------|
| `--non-interactive` | Skip prompts, auto-configure detected providers |

---

## `quorum ask [question]`

Run a full multi-AI deliberation. If no question is provided, reads from stdin.

```bash
quorum ask "question"
echo "question" | quorum ask
```

| Flag | Description |
|------|-------------|
| `-p, --providers <names>` | Comma-separated provider names to use |
| `--profile <name>` | Agent profile (default: `default`) |
| `-1, --single [name]` | Single provider mode (skip deliberation) |
| `-r, --rapid` | Rapid mode: gather → debate → synthesize only |
| `-v, --verbose` | Show phase-by-phase progress |
| `--live` | Stream text from each provider as it arrives |
| `--json` | Output result as JSON |
| `--audit <path>` | Save full session JSON to file |
| `--dry-run` | Preview prompts without making API calls |
| `--timeout <seconds>` | Override per-provider timeout |
| `--rounds <n>` | Override number of rounds |
| `--focus <topics>` | Comma-separated focus topics |
| `--convergence <n>` | Override convergence threshold (0.0-1.0) |
| `--challenge-style <style>` | Override: `adversarial`, `collaborative`, `socratic` |
| `--voting-method <method>` | `borda`, `ranked-choice`, `approval`, `condorcet` |
| `--weight <spec>` | Provider weights: `claude=2,kimi=1` |
| `--heatmap` / `--no-heatmap` | Toggle consensus heatmap |
| `--no-hooks` | Skip pre/post hooks |
| `--tools` | Enable tool use (web search, file read) |
| `--allow-shell` | Enable shell tool (requires `--tools`) |
| `--evidence <mode>` | `off`, `advisory`, `strict` |
| `--adaptive <preset>` | `fast`, `balanced`, `critical`, `off` |
| `--devils-advocate` | Force one provider contrarian |
| `--red-team` | Enable adversarial red-team analysis |
| `--attack-packs <packs>` | Comma-separated attack pack names |
| `--custom-attacks <attacks>` | Comma-separated custom attack prompts |
| `--topology <type>` | `mesh`, `star`, `tournament`, `map_reduce`, `adversarial_tree`, `pipeline`, `panel` |
| `--topology-hub <provider>` | Hub for star topology |
| `--topology-moderator <provider>` | Moderator for panel topology |
| `--no-memory` | Skip deliberation memory |
| `--reputation` | Enable reputation-weighted voting |
| `--hitl` | Enable HITL checkpoints |
| `--hitl-checkpoints <list>` | Comma-separated checkpoint list |
| `--hitl-threshold <n>` | HITL controversy threshold (default: 0.5) |
| `--policy <name>` | Apply named policy for guardrails |
| `--interactive` | Enable intervention points between phases |
| `--schema <name>` | Use a reasoning schema |

---

## `quorum review [files...]`

Code review via multi-AI deliberation.

```bash
quorum review src/auth.ts src/utils.ts
quorum review --staged
quorum review --pr 42
quorum review --diff main
```

| Flag | Description |
|------|-------------|
| `--staged` | Review staged changes (`git diff --cached`) |
| `--pr <number>` | Review a GitHub PR (requires `gh` CLI) |
| `--diff [ref]` | Review diff against a ref (default: `HEAD`) |
| `--card` | Output a summary card |
| `--card-detailed` | Detailed summary card (no char limit) |
| All `ask` flags | Also accepted (providers, profile, rapid, etc.) |

---

## `quorum ci`

CI/CD-optimized code review with structured output and exit codes.

```bash
quorum ci --pr 42 --confidence-threshold 0.7 --post-comment
quorum ci --pr 42 --format json
```

Exit codes: `0` = pass, `1` = below confidence, `2` = error.

---

## `quorum versus <provider1> <provider2> [question]`

Head-to-head debate between two providers.

---

## `quorum follow-up [question]`

Continue a previous deliberation with a follow-up question. Uses "last" session by default.

---

## Session Commands

```bash
quorum session <path|last>         # view a saved session
quorum history                      # list past sessions
quorum export <session> [--format html|markdown] [--output file]
quorum diff <session1> <session2> [--analyze]
quorum explain <session>            # meta-analyze
quorum replay <session> [--speed slow|normal|fast]
quorum rerun <session> [--diff] [--dry-run] [--providers X] [--compare]
quorum stats                        # provider win rates
quorum heatmap <session>            # consensus visualization
quorum verify <session>             # hash chain integrity
quorum evidence <session>           # evidence inspection
```

---

## Provider Commands

```bash
quorum providers list
quorum providers add --name <n> --type <t> --model <m> --env <var>
quorum providers remove <name>
quorum providers models [provider]
quorum providers test
```

---

## Auth Commands

```bash
quorum auth login <provider>
quorum auth list
quorum auth logout <provider>
```

---

## Advanced Commands

```bash
quorum workspace                    # real-time deliberation UI
quorum watch <glob>                 # re-run on file changes
quorum mcp                          # start MCP server
quorum attacks                      # list red team attack packs
quorum topologies                   # list debate topologies
quorum calibration                  # view calibration data
```

---

## Sub-command Groups

### `quorum memory`
```bash
quorum memory list                  # list stored memories
quorum memory search <query>        # search by keyword
quorum memory clear                 # clear memory graph
quorum memory stats                 # memory graph statistics
```

### `quorum policy`
```bash
quorum policy list                  # list available policies
quorum policy check <file>          # check policy against config
quorum policy init                  # initialize default policies
quorum policy show <name>           # show policy details
quorum policy validate <file>       # validate policy file
```

### `quorum ledger`
```bash
quorum ledger list                  # show all entries
quorum ledger verify                # validate hash chain
quorum ledger show <id>             # inspect entry
quorum ledger export <id>           # export as ADR markdown
quorum ledger replay <id>           # deterministic replay
```

### `quorum arena`
```bash
quorum arena leaderboard            # provider rankings
quorum arena show <provider>        # detailed stats
quorum arena run <suite>            # run eval suite
quorum arena reset                  # clear arena data
```

### `quorum attest`
```bash
quorum attest view <session>        # view attestation chain
quorum attest diff <s1> <s2>        # compare attestation chains
quorum attest export <session>      # export as certificate
```

### `quorum schema`
```bash
quorum schema list                  # list reasoning schemas
quorum schema show <name>           # show schema details
quorum schema create                # create new schema
quorum schema init                  # initialize built-in schemas
```

### `quorum uncertainty`
```bash
quorum uncertainty trends           # view uncertainty trends
```
