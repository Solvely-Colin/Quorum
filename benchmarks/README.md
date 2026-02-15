# Quorum Benchmarks

## Local Overhead Benchmark

Measures the performance of Quorum's local components (no API calls):

```bash
node benchmarks/run.js
```

This benchmarks:
- Session store read/write
- Voting tally algorithms (Borda, ranked-choice, approval, Condorcet)
- Heatmap generation
- Hash chain operations

## End-to-End Benchmark

To benchmark actual deliberation with real providers:

```bash
# Ensure at least 2 providers are configured
quorum providers test

# Run a timed deliberation
time quorum ask --rapid "What is 2+2?" --json > /dev/null

# Full deliberation
time quorum ask "Compare REST vs GraphQL" --json > /dev/null
```

## Mock Provider Benchmark

The `run.js` script uses mock adapters to isolate local overhead from API latency. This gives you a baseline for Quorum's own computation costs.

### Expected Results

On Apple M-series hardware:

| Operation | Time |
|-----------|------|
| Voting (Borda, 5 ballots) | <1ms |
| Voting (Condorcet, 5 ballots) | <1ms |
| Heatmap (5 providers) | <2ms |
| Session JSON serialize | <5ms |
