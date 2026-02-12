# Deliberation V2 — Context-Aware Multi-Phase Council

## Problem with V1
- Prompts grow unbounded across rounds → Kimi/Qwen choke
- No context budget management
- Phases too simple (diverge/challenge/defend)
- No voting mechanism

## Provider Context Limits
| Provider | Context | Effective Budget* |
|----------|---------|------------------|
| Claude Sonnet | 200K tokens | ~150K usable |
| Kimi Coode | 262K tokens | ~50K usable (reasoning eats ~80% of completion tokens) |
| Qwen 14B (Ollama) | 32K tokens (default 8K) | ~6K usable at 8K ctx |

*Effective = context minus system prompt, reasoning overhead, and output tokens

## Solution: File-Backed Phases with Context Windowing

Each phase writes its output to a session file. Next phase reads only what it needs — not the entire history.

### Session Directory Structure
```
.counsel/sessions/<session-id>/
├── meta.json              # session config, providers, timing
├── 01-gather.json         # phase 1: independent research/generation
├── 02-plan.json           # phase 2: each model plans its argument
├── 03-formulate.json      # phase 3: full position statements
├── 04-debate.json         # phase 4: cross-examination
├── 05-adjust.json         # phase 5: revised positions
├── 06-rebuttal.json       # phase 6: final defense
├── 07-vote.json           # phase 7: ranked voting + rationale
└── synthesis.json         # final merged output
```

### Phases

#### 1. GATHER (Independent)
Each model generates initial response in isolation.
- Input: original prompt only
- Context: minimal (system + prompt)
- Output: raw response per model
- **No cross-contamination**

#### 2. PLAN (Independent)
Each model sees OTHER models' gather output (not its own) and plans its argument strategy.
- Input: other models' gather outputs (summarized if needed)
- Context: system + summaries + planning prompt
- Output: argument outline per model
- **Key insight: models see what others think BEFORE formulating**

#### 3. FORMULATE (Independent)
Each model writes its full position, informed by its plan and awareness of others' initial takes.
- Input: own gather output + own plan + OTHER models' gather summaries
- Context: kept tight — own stuff full, others summarized
- Output: formal position statement per model

#### 4. DEBATE (Room-style — all-vs-all)
Every model sees and critiques ALL other models' positions simultaneously, like a debate floor.
- Input: all other models' formulated positions
- Context: system + all positions (trimmed to budget) + debate prompt
- Output: critique of every other position, addressed by name
- **Key insight: room-style creates richer cross-pollination than round-robin pairing**

#### 5. ADJUST (Independent)
Each model sees ALL critiques from the entire council and revises its position.
- Input: own position + all critiques received from every other member
- Context: own position (full) + all critiques (trimmed to budget)
- Output: revised position per model
- Falls back to formulate output if generation fails

#### 6. REBUTTAL (Room-style)
Each model reviews ALL other members' revised positions and gives final takes.
- Input: own original critiques + all other members' revised positions
- Context: own critiques (trimmable) + revised positions (full)
- Output: brief rebuttals or concessions, addressed to each member
- **Skipped if convergence threshold reached (positions already agree)**

#### 7. VOTE (Independent)
Each model ranks ALL final positions (including its own) and explains why.
- Input: all adjusted positions (summarized to fit context)
- Context: summaries + voting prompt
- Output: ranked list + rationale per model
- **Synthesis uses vote tallies, not just one model's judgment**

### Context Management Strategy

```
estimateTokens(text) → rough count (chars / 4)

For each phase:
  1. Calculate available context = provider.contextLimit - systemPrompt - outputReserve
  2. If inputs fit → pass full text
  3. If inputs don't fit → summarize prior phases:
     a. Ask the model itself to summarize (1 extra call, but stays in budget)
     b. Or truncate with "[truncated, see session file for full]"
  4. Write phase output to file immediately
  5. Next phase reads from files, not memory
```

### Token Estimation
```typescript
function estimateTokens(text: string): number {
  // ~4 chars per token for English, ~2 for CJK
  return Math.ceil(text.length / 3.5);
}
```

### Output Reserve by Provider
| Provider | Reasoning Overhead | Output Reserve | Total Reserve |
|----------|-------------------|----------------|---------------|
| Claude | 0 (thinking separate) | 4096 | 4096 |
| Kimi | ~5x output (reasoning) | 8192 | 8192 |
| Qwen | 0 | 2048 | 2048 |

### Debate Model (Room-Style)
With N providers, every member critiques ALL others simultaneously:
```
3 providers: A critiques B+C, B critiques A+C, C critiques A+B
2 providers: A critiques B, B critiques A
```
This creates richer debate dynamics — everyone sees the full landscape of positions
and can identify cross-cutting themes, contradictions between multiple positions, etc.

### Vote Scoring
```
For each position:
  score = sum of (N - rank) across all voters
  
  e.g., 3 voters rank position X as [1st, 2nd, 1st]:
  score = (3-1) + (3-2) + (3-1) = 2 + 1 + 2 = 5
  
Winner = highest score
Controversial = top 2 scores within 1 point
```

## Implementation Plan
1. Add `PhaseRunner` class that manages file I/O per phase
2. Add `ContextBudget` utility for token estimation + truncation
3. Refactor `Council.deliberate()` to use 7-phase flow
4. Update agent YAML schema to support per-phase prompts for all 7 phases
5. Test with Claude + Kimi (2 providers)
6. Re-add Ollama with proper context windowing (set num_ctx based on need)
