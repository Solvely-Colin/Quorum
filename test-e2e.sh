#!/usr/bin/env bash
# Quorum v0.4.0 — End-to-End Feature Test
# Usage: bash test-e2e.sh 2>&1 | tee test-e2e.log

set -uo pipefail

PASS=0; FAIL=0; SKIP=0; ERRORS=()
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'

pass() { ((PASS++)); echo -e "  ${GREEN}✓${NC} $1"; }
fail() { ((FAIL++)); ERRORS+=("$1: $2"); echo -e "  ${RED}✗${NC} $1 — $2"; }
skip() { ((SKIP++)); echo -e "  ${YELLOW}⊘${NC} $1 — $2"; }

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Quorum v0.4.0 — End-to-End Test Suite${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ─── Meta ───
echo -e "${CYAN}▸ Meta${NC}"
OUT=$(quorum --version 2>&1); [[ "$OUT" == "0.4.0" ]] && pass "--version" || fail "--version" "got: $OUT"
OUT=$(quorum --help 2>&1); echo "$OUT" | grep -q "ask" && pass "--help" || fail "--help" "missing"

# ─── Providers ───
echo -e "\n${CYAN}▸ Providers${NC}"
OUT=$(quorum providers list 2>&1); echo "$OUT" | grep -qi "codex" && pass "providers list" || fail "providers list" "no output"

# ─── Core ───
echo -e "\n${CYAN}▸ Core Deliberation${NC}"
OUT=$(quorum ask "What is 2+2?" --providers codex,kimi --rapid 2>&1) || true
echo "$OUT" | grep -qi "winner\|consensus" && pass "ask --rapid (codex+kimi)" || fail "ask --rapid" "no result"
SESSION1=$(echo "$OUT" | grep -oE 'Session: [^ ]+' | tail -1 | sed 's/Session: //')

OUT=$(quorum ask "What is 3+3?" -1 --providers codex 2>&1) || true
echo "$OUT" | grep -qi "6\|codex" && pass "ask -1 (single)" || fail "ask -1" "no result"

# ─── Devil's Advocate ───
echo -e "\n${CYAN}▸ Devil's Advocate${NC}"
OUT=$(quorum ask "Should we use microservices?" --providers codex,kimi --devils-advocate --rapid 2>&1) || true
echo "$OUT" | grep -qi "winner\|consensus" && pass "ask --devils-advocate" || fail "devils-advocate" "no result"

# ─── Evidence ───
echo -e "\n${CYAN}▸ Evidence${NC}"
OUT=$(quorum ask "Is Rust faster than Go?" --providers codex,kimi --evidence strict --rapid 2>&1) || true
echo "$OUT" | grep -qi "winner\|consensus" && pass "ask --evidence strict" || fail "evidence" "no result"
EVSESSION=$(echo "$OUT" | grep -oE 'Session: [^ ]+' | tail -1 | sed 's/Session: //')
if [ -n "${EVSESSION:-}" ]; then
  OUT=$(quorum evidence "$EVSESSION" 2>&1) || true
  echo "$OUT" | grep -qi "claim\|evidence\|tier\|no evidence" && pass "evidence <session>" || fail "evidence cmd" "no output"
else
  skip "evidence <session>" "no session"
fi

# ─── Red Team ───
echo -e "\n${CYAN}▸ Red Team${NC}"
OUT=$(quorum attacks 2>&1); echo "$OUT" | grep -qi "general\|security" && pass "attacks list" || fail "attacks" "no packs"
OUT=$(quorum ask "How to store passwords?" --providers codex,kimi --red-team --attack-pack security --rapid 2>&1) || true
echo "$OUT" | grep -qi "winner\|consensus" && pass "ask --red-team" || fail "red-team" "no result"

# ─── Adaptive ───
echo -e "\n${CYAN}▸ Adaptive${NC}"
OUT=$(quorum ask "Best frontend framework?" --providers codex,kimi --adaptive balanced --rapid 2>&1) || true
echo "$OUT" | grep -qi "winner\|consensus" && pass "ask --adaptive balanced" || fail "adaptive" "no result"

# ─── Topologies ───
echo -e "\n${CYAN}▸ Topologies${NC}"
OUT=$(quorum topo 2>&1); echo "$OUT" | grep -qi "mesh\|star\|pipeline" && pass "topo list" || fail "topo list" "no output"
OUT=$(quorum ask "REST vs GraphQL" --providers codex,kimi --topology star 2>&1) || true
echo "$OUT" | grep -qi "winner\|consensus\|Topology" && pass "topology: star" || fail "topology: star" "no result"

# ─── Versus ───
echo -e "\n${CYAN}▸ Versus${NC}"
OUT=$(quorum versus codex kimi "Tabs or spaces?" 2>&1) || true
echo "$OUT" | grep -qi "winner\|verdict\|codex\|kimi" && pass "versus" || fail "versus" "no result"

# ─── Review ───
echo -e "\n${CYAN}▸ Review${NC}"
OUT=$(quorum review src/voting.ts --providers codex,kimi --rapid 2>&1) || true
echo "$OUT" | grep -qi "winner\|consensus" && pass "review <file>" || fail "review" "no result"

# ─── CI ───
echo -e "\n${CYAN}▸ CI${NC}"
OUT=$(quorum ci --staged --providers codex,kimi --format markdown 2>&1) || true
echo "$OUT" | grep -qi "no.*change\|risk\|pass\|confidence\|staged\|nothing" && pass "ci --staged" || fail "ci" "no result"

# ─── Session Management ───
echo -e "\n${CYAN}▸ Session Management${NC}"
OUT=$(quorum history 2>&1); echo "$OUT" | grep -qi "session\|ago\|no sessions" && pass "history" || fail "history" "no output"
OUT=$(quorum session last 2>&1); echo "$OUT" | grep -qi "phase\|gather\|session" && pass "session last" || fail "session last" "no output"

# ─── Export ───
echo -e "\n${CYAN}▸ Export${NC}"
OUT=$(quorum export last --format md 2>&1); echo "$OUT" | grep -qi "#\|deliberation\|provider" && pass "export markdown" || fail "export md" "no output"
OUT=$(quorum export last --format html 2>&1); echo "$OUT" | grep -qi "html\|div\|deliberation" && pass "export html" || fail "export html" "no output"

# ─── Explain ───
echo -e "\n${CYAN}▸ Explain${NC}"
OUT=$(quorum explain last --provider codex 2>&1) || true
echo "$OUT" | grep -qi "analysis\|explain\|deliberation\|meta\|session" && pass "explain last" || fail "explain" "no output"

# ─── Stats ───
echo -e "\n${CYAN}▸ Stats${NC}"
OUT=$(quorum stats 2>&1); echo "$OUT" | grep -qi "provider\|win\|session\|stat" && pass "stats" || fail "stats" "no output"

# ─── Heatmap ───
echo -e "\n${CYAN}▸ Heatmap${NC}"
OUT=$(quorum heatmap last 2>&1); echo "$OUT" | grep -qi "heatmap\|vote\|agreement\|no.*data" && pass "heatmap" || fail "heatmap" "no output"

# ─── Memory Graph ───
echo -e "\n${CYAN}▸ Memory Graph${NC}"
OUT=$(quorum memory stats 2>&1); echo "$OUT" | grep -qi "memor\|total\|stat" && pass "memory stats" || fail "memory stats" "no output"
OUT=$(quorum memory list 2>&1); echo "$OUT" | grep -qi "memor\|session\|no memor" && pass "memory list" || fail "memory list" "no output"

# ─── Policy ───
echo -e "\n${CYAN}▸ Policy Guardrails${NC}"
OUT=$(quorum policy list 2>&1); echo "$OUT" | grep -qi "default\|strict\|polic" && pass "policy list" || fail "policy list" "no output"
OUT=$(quorum ask "Is Python good?" --providers codex,kimi --policy default --rapid 2>&1) || true
echo "$OUT" | grep -qi "winner\|consensus" && pass "ask --policy default" || fail "ask --policy" "no result"

# ─── Ledger ───
echo -e "\n${CYAN}▸ Ledger${NC}"
OUT=$(quorum ledger list 2>&1); echo "$OUT" | grep -qi "ledger\|entry\|session\|no.*entries\|empty" && pass "ledger list" || fail "ledger list" "no output"
OUT=$(quorum ledger verify 2>&1); echo "$OUT" | grep -qi "valid\|integrity\|verified\|chain\|empty" && pass "ledger verify" || fail "ledger verify" "no output"

# ─── Arena ───
echo -e "\n${CYAN}▸ Arena${NC}"
OUT=$(quorum arena leaderboard 2>&1); echo "$OUT" | grep -qi "leader\|provider\|reputation\|no.*data\|empty" && pass "arena leaderboard" || fail "arena leaderboard" "no output"

# ─── Replay ───
echo -e "\n${CYAN}▸ Replay${NC}"
OUT=$(quorum replay last --speed fast 2>&1); echo "$OUT" | grep -qi "phase\|replay\|gather\|no.*session" && pass "replay last" || fail "replay" "no output"

# ─── Rerun ───
echo -e "\n${CYAN}▸ Rerun${NC}"
OUT=$(quorum rerun last --providers codex 2>&1) || true
echo "$OUT" | grep -qi "winner\|consensus\|rerun\|codex" && pass "rerun last" || fail "rerun" "no result"

# ─── Diff ───
echo -e "\n${CYAN}▸ Diff${NC}"
if [ -n "${SESSION1:-}" ]; then
  OUT=$(quorum diff "$SESSION1" last 2>&1) || true
  echo "$OUT" | grep -qi "diff\|compar\|session\|winner" && pass "diff" || fail "diff" "no output"
else
  skip "diff" "no sessions"
fi

# ─── Follow-up ───
echo -e "\n${CYAN}▸ Follow-up${NC}"
OUT=$(quorum follow-up last "Can you elaborate?" --providers codex,kimi --rapid 2>&1) || true
echo "$OUT" | grep -qi "winner\|consensus\|follow" && pass "follow-up" || fail "follow-up" "no result"

# ─── Summary ───
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${GREEN}✓ $PASS passed${NC}  ${RED}✗ $FAIL failed${NC}  ${YELLOW}⊘ $SKIP skipped${NC}"
echo -e "  Total: $((PASS + FAIL + SKIP)) tests"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo -e "\n${RED}Failures:${NC}"
  for err in "${ERRORS[@]}"; do echo -e "  ${RED}✗${NC} $err"; done
fi
echo ""
[ $FAIL -eq 0 ] && echo -e "${GREEN}🎉 All tests passed!${NC}" || echo -e "${RED}⚠️  $FAIL test(s) failed.${NC}"
exit $FAIL
