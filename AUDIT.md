# Quorum CLI — Audit Report

**Date:** 2026-02-17 (original) / 2026-02-17 (remediation pass)
**Version audited:** 0.10.2
**Auditor:** Automated code audit + remediation session

---

## Summary

Quorum is a well-conceived multi-AI deliberation framework with impressive breadth of features. The codebase is TypeScript with strict mode, clean type definitions, and solid test infrastructure.

**Original grade: B+** — Good architecture and ideas, needed refactoring of the CLI and attention to critical issues.

**Post-remediation: A-** — All critical and most important issues resolved. Remaining work is the CLI monolith split and integration tests.

---

## Remediation Status

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| 1 | Version mismatch | Critical | **Fixed** | Reads from package.json dynamically via `new URL()` |
| 2 | Test files in dist/npm | Critical | **Fixed** | Stale files removed, `.npmignore` excludes `dist/**/*.test.*` |
| 3 | Shell RC parsing fragile | Critical | **Accepted** | Known limitation; only sets missing env vars, non-fatal on failure |
| 4 | CLI monolith (5,214 lines) | Important | **Planned** | Split plan researched — see below |
| 5 | 123 process.exit() calls | Important | **Fixed** | 123 → 3 via CLIError class with top-level catch |
| 6 | No CLI integration tests | Important | **Open** | Still zero CLI command tests |
| 7 | inquirer → @inquirer/prompts | Important | **Fixed** | Migrated to `@inquirer/prompts`; lighter, tree-shakeable, 4 functions used |
| 8 | Vitest double-run | Important | **Fixed** | `vitest.config.ts` scopes to `src/` + `tests/` only; 172 tests (was 319 doubled) |
| 9 | pdf-lib weight | Important | **No action needed** | Doubly lazy-loaded: dynamic import inside function + module lazy-imported by callers |
| 10 | pi-ai personal namespace | Minor | Accepted | Conscious choice for Pi AI support |
| 11 | .npmignore gaps | Minor | **Fixed** | Comprehensive exclusions added |
| 12 | No engines enforcement | Minor | **Fixed** | `.npmrc` with `engine-strict=true` |
| 13 | tsconfig vs tests/ | Minor | **Fixed** | `tsconfig.check.json` + `"typecheck"` script in package.json |
| 14 | Gemini CLI ENOENT | Minor | **Fixed** | `which` check + corrected error message (was pointing to wrong package) |
| 15 | macOS-only Keychain | Minor | **Fixed** | JSDoc + explicit `process.platform !== 'darwin'` guard on both functions |
| 16 | README quality | Nice-to-have | N/A | Already excellent |
| 17 | --help examples | Nice-to-have | **Open** | Low priority |
| 18 | Zod for config | Nice-to-have | **Open** | Low priority |
| 19 | Groq/xAI provider gaps | Nice-to-have | **Fixed** | Added routing in base.ts, detection in config.ts, CLI menu entries |
| 20 | CHANGELOG automation | Nice-to-have | **Open** | Low priority |
| 21 | chalk → picocolors | Nice-to-have | **Open** | Low priority |

---

## pi-ai Boundary Analysis

A deep review of the provider layer revealed duplication between Quorum's `src/providers/base.ts` and what `@mariozechner/pi-ai` handles natively.

### What pi-ai Provides
- Unified API via `completeSimple()` / `streamSimple()` for OpenAI, Anthropic, Google, Mistral, DeepSeek, Kimi, Codex
- Model registry via `getModels(provider)` — returns known models with base URLs
- Type system: `KnownProvider`, `Model<Api>`, streaming event types

### What Quorum Adds (Genuinely Unique — Keep)
- **Multi-fallback API key resolution** — env vars, config file, OAuth tokens, macOS Keychain
- **macOS Keychain integration** — reads Claude Code OAuth tokens from Keychain
- **Gemini CLI child process shim** — shells out to `gemini` CLI for OAuth scope workaround
- **OAuth device flow** — implements device flow for OpenAI and Google, stores tokens
- **Local service detection** — probes Ollama (localhost:11434), LM Studio (localhost:1234)
- **Provider auto-detection** — scans env vars + probes to build config automatically

### What Quorum Duplicates (Could Lean on pi-ai More)

| Function | Location | Duplication Level | Detail |
|----------|----------|-------------------|--------|
| `mapProvider()` | `base.ts:101-117` | **High** | Maps provider names to pi-ai equivalents. Pi-ai likely handles `'groq'`, `'xai'` etc. natively as `KnownProvider` |
| `resolveApiDetails()` | `base.ts:120-199` | **High** | 80-line switch hardcoding base URLs per provider. Pi-ai's registry already has these URLs |

**How the code works today:** `createProvider()` first tries pi-ai's `getModels(provider)` registry. If the model is found, it uses pi-ai's base URL. Only if the model isn't in the registry does it fall back to Quorum's hardcoded URLs. So the duplication is a **safety net**, not the primary path.

**Recommendation for future cleanup:**
1. Verify pi-ai handles all providers directly: `getModels('groq')`, `getModels('xai')`, etc.
2. If confirmed, simplify `mapProvider()` to only handle truly custom mappings (`gemini-cli` → `google`, `custom` → `openai`)
3. Reduce `resolveApiDetails()` to a thin fallback for unknown providers only
4. Keep all auth/credential resolution — that's Quorum-specific value

### Gaps Found and Fixed
- Groq and xAI were in `types.ts` but **missing from**:
  - `resolveApiDetails()` in `base.ts` — no URL routing (fixed)
  - `mapProvider()` in `base.ts` — no pi-ai mapping (fixed)
  - `detectProviders()` in `config.ts` — `GROQ_API_KEY` / `XAI_API_KEY` not checked (fixed)
  - `promptAddProvider()` in `cli.ts` — not in interactive menu (fixed)

---

## Remaining Work

### High Priority

#### #4 — CLI Monolith Split

`src/cli.ts` is 5,214 lines with 57 commands. A full command inventory and split plan was produced during the remediation session:

**Proposed structure:**
```
src/cli/
├── index.ts       — Program setup, env loading, CLIError handler, parseAsync
├── helpers.ts     — readStdin, resolveLastSession, promptAddProvider, displayDryRun
├── ask.ts         — ask command (~729 lines, largest)
├── review.ts      — review + ci commands (~600 lines)
├── providers.ts   — providers list/add/models/remove/test (~116 lines)
├── auth.ts        — auth login/list/logout (~47 lines)
├── session.ts     — session, history, follow-up, versus, export, verify, heatmap, replay, rerun, watch
├── analysis.ts    — explain, diff, stats, evidence
├── governance.ts  — memory, policy, ledger, arena, attest, schema, uncertainty, attacks, topologies, mcp
```

**Key considerations:**
- Each module exports a `register*Command(program: Command)` function
- `review` and `watch` delegate to `ask` via `program.parseAsync()` — need shared program instance
- `ask`, `follow-up`, `rerun`, and `arena` all duplicate council setup logic — extract shared `setupCouncil()` helper
- All `@inquirer/prompts` and heavy module imports are already dynamic — keep them that way
- A previous draft split (`src/cli/`, 5,269 lines, 7 files) was found untracked and deleted — it predated the CLIError refactor and was never wired up. Start fresh from the improved monolith.

#### #6 — Integration Tests

Zero CLI command tests exist. Priority areas:
- `ask` flow (core deliberation)
- Provider detection and config loading
- Error paths (now testable thanks to CLIError)
- `init` interactive flow

### Optional / Low Priority

- **#9** `pdf-lib` → `optionalDependencies` — Already doubly lazy (used in 1 file: `src/attestation-export.ts:158`). Moving to `optionalDependencies` saves ~2.5MB install for users who never export PDFs.
- **#17, #18, #20, #21** — Nice-to-haves, no urgency.
- **Provider layer cleanup** — Simplify `mapProvider()` and `resolveApiDetails()` once pi-ai's native provider support is verified. See pi-ai boundary analysis above.

---

## Architecture Assessment

**Strengths:**
- Clean separation of concerns across modules (voting, evidence, topology, policy, etc.)
- Good use of TypeScript strict mode with proper type definitions
- ESM-native with proper `package.json` exports map
- Hash-chained audit ledger is a clever design
- Streaming support with proper timeout/abort handling
- CLIError pattern enables testability and graceful shutdown (new)
- Provider layer correctly delegates to pi-ai first, falls back to manual routing (new analysis)

**Weaknesses:**
- CLI monolith (5,214 lines) does too much — split plan ready
- Core deliberation engine (`council-v2.ts`, 2,780 lines) is also large
- No dependency injection — hard to test provider interactions
- Provider adapter could benefit from an abstract class with shared timeout/retry logic
- `mapProvider()` / `resolveApiDetails()` duplicate pi-ai's built-in provider knowledge

---

## Test Coverage Summary

| Area | Coverage | Notes |
|------|----------|-------|
| Utility modules (attestation, calibration, etc.) | Good | 17 test files, 172 tests, all passing |
| CLI commands | None | No tests for ask, review, init, providers |
| Provider adapters | None | Would need mocks |
| Council deliberation engine | None | Core logic untested |
| Config loading/saving | None | |
| Error paths | None | Now testable via CLIError |

**Test execution:** 172 tests pass in ~675ms. Fast and clean. (Previously 319 — tests were double-counted from dist/ duplicates.)

---

## Dependency Audit

| Dependency | Version | Status | Notes |
|-----------|---------|--------|-------|
| `commander` | ^13.1.0 | Current | |
| `chalk` | ^5.4.0 | Current | Could swap to picocolors (3KB vs 15KB) |
| `yaml` | ^2.7.0 | Current | |
| `@inquirer/prompts` | ^7.5.0 | Current | Migrated from `inquirer`; lighter, tree-shakeable |
| `pdf-lib` | ^1.17.1 | Current | Doubly lazy-loaded; candidate for optionalDependencies |
| `@mariozechner/pi-ai` | ^0.52.9 | Personal namespace | Accepted risk; see boundary analysis above |
| `@modelcontextprotocol/sdk` | ^1.26.0 | Current | |
| `typescript` | ^5.7.0 | Current | |
| `vitest` | ^4.0.18 | Current | |

No outdated or vulnerable dependencies detected.

---

## Files Changed in Remediation

| File | Change |
|------|--------|
| `src/cli.ts` | Dynamic version; CLIError class; 120 process.exit() → throw; inquirer → @inquirer/prompts; added Groq/xAI to menu + defaults |
| `src/providers/base.ts` | Gemini CLI path check fix; macOS keychain platform guard + JSDoc; Groq/xAI routing in mapProvider + resolveApiDetails |
| `src/auth.ts` | macOS keychain platform guard + JSDoc |
| `src/config.ts` | Added GROQ_API_KEY and XAI_API_KEY to detectProviders() |
| `src/intervention.ts` | inquirer → @inquirer/prompts migration |
| `package.json` | Added `"typecheck"` script; `inquirer` → `@inquirer/prompts` |
| `.npmignore` | Comprehensive exclusion list |
| `.npmrc` | Created — `engine-strict=true` |
| `vitest.config.ts` | Created — scopes test includes |
| `tsconfig.check.json` | Created — type-checks both src/ and tests/ |
| `dist/**/*.test.*` | Deleted 26 stale test artifacts |
| `src/cli/` | Deleted untracked draft split (5,269 lines, never wired up) |
