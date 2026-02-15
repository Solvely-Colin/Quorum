# Performance

## Baseline Expectations

Quorum's performance is primarily bound by LLM API latency, not local computation. The local overhead (prompt construction, voting, session persistence) is negligible (<100ms).

### Typical Deliberation Times

| Mode | Providers | Phases | Expected Duration |
|------|-----------|--------|-------------------|
| Single (`-1`) | 1 | 1 | 2-10s |
| Rapid (`--rapid`) | 3 | 3 | 15-45s |
| Full | 3 | 7 | 60-180s |
| Full | 5 | 7 | 90-300s |
| Thorough (2 rounds) | 5 | 7×2 | 180-600s |

### Factors Affecting Performance

1. **Provider latency** — varies by provider and model size. Groq and small Ollama models are fastest. Large cloud models (GPT-4, Claude Opus) are slowest.
2. **Number of providers** — phases run providers in parallel, but the slowest provider determines phase duration.
3. **Number of phases** — rapid mode (3 phases) is ~3× faster than full (7 phases).
4. **Context size** — longer prompts and more debate history increase token counts and latency.
5. **Adaptive skipping** — `--adaptive fast` can skip phases when consensus is reached early.

### Local Overhead Benchmarks

Run the benchmark script to measure local overhead:

```bash
node benchmarks/run.js
```

Expected results (Apple M-series):
- Session store read/write: <5ms
- Voting tally (5 providers): <1ms
- Heatmap generation: <2ms
- Prompt construction: <10ms
- Hash chain verification: <1ms per entry

### Optimization Tips

- Use `--rapid` for non-critical questions
- Use `--adaptive fast` to skip phases when providers agree
- Use `-1` (single mode) for simple questions
- Prefer faster providers (Groq, small Ollama models) for time-sensitive work
- Set per-provider `timeout` to avoid hanging on slow providers
- Use `--topology pipeline` for sequential (rather than all-to-all) debate

## Running Benchmarks

See [`benchmarks/README.md`](../benchmarks/README.md) for instructions on running the benchmark suite.
