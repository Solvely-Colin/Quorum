# Quorum Code Review — GitHub Action

Multi-AI deliberation code review for pull requests. Quorum runs your PR diff through multiple AI providers, reaches consensus, and posts results.

## Quick Start

```yaml
# .github/workflows/quorum-review.yml
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: quorum-ai/quorum@v1
        with:
          providers: claude,openai
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `providers` | ✅ | — | Comma-separated provider names (e.g., `claude,kimi,openai`) |
| `profile` | | `code-review` | Agent profile name |
| `confidence-threshold` | | `0` | Minimum confidence (0.0–1.0). Fails the step if below. |
| `evidence` | | `off` | Evidence mode: `off`, `advisory`, `strict` |
| `post-comment` | | `true` | Post review as PR comment |
| `add-labels` | | `false` | Add labels to PR based on result |
| `max-files` | | `50` | Skip review if PR has more than N changed files |
| `focus` | | — | Comma-separated focus areas (e.g., `security,performance`) |
| `node-version` | | `20` | Node.js version |
| `quorum-version` | | `latest` | Quorum npm package version |

## Outputs

| Output | Description |
|--------|-------------|
| `confidence` | Confidence score (0.0–1.0) |
| `consensus` | Consensus score (0.0–1.0) |
| `approved` | Whether review passed the confidence threshold |
| `evidence-grade` | Evidence grade (A–F) |
| `session-id` | Session ID for the review |
| `result-json` | Full result as JSON |

## Examples

### With Evidence Mode

```yaml
- uses: quorum-ai/quorum@v1
  with:
    providers: claude,kimi
    evidence: advisory
    focus: security,correctness
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Confidence Gate

```yaml
- uses: quorum-ai/quorum@v1
  id: review
  with:
    providers: claude,openai,kimi
    confidence-threshold: '0.7'
    evidence: strict
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

- name: Check result
  if: always()
  run: |
    echo "Confidence: ${{ steps.review.outputs.confidence }}"
    echo "Approved: ${{ steps.review.outputs.approved }}"
```

### Block Merge on Low Confidence

Use `confidence-threshold` — the step will exit non-zero if the score is below the threshold, which blocks the workflow (and merge, if required).

```yaml
- uses: quorum-ai/quorum@v1
  with:
    providers: claude,openai
    confidence-threshold: '0.8'
    post-comment: 'true'
    add-labels: 'true'
```
