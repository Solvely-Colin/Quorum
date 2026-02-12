#!/bin/bash
set -euo pipefail

# --- Defaults ---
PROVIDERS=""
PROFILE="code-review"
CONFIDENCE_THRESHOLD="0"
EVIDENCE="off"
POST_COMMENT="true"
ADD_LABELS="false"
MAX_FILES="50"
FOCUS=""

# --- Parse arguments ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --providers)       PROVIDERS="$2"; shift 2 ;;
    --profile)         PROFILE="$2"; shift 2 ;;
    --confidence-threshold) CONFIDENCE_THRESHOLD="$2"; shift 2 ;;
    --evidence)        EVIDENCE="$2"; shift 2 ;;
    --post-comment)    POST_COMMENT="$2"; shift 2 ;;
    --add-labels)      ADD_LABELS="$2"; shift 2 ;;
    --max-files)       MAX_FILES="$2"; shift 2 ;;
    --focus)           FOCUS="$2"; shift 2 ;;
    *) echo "::warning::Unknown argument: $1"; shift ;;
  esac
done

# --- Helper: set output with fallback ---
set_output() {
  local name="$1" value="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "${name}=${value}" >> "$GITHUB_OUTPUT"
  fi
}

# --- Set default outputs (overwritten on success) ---
set_defaults() {
  set_output "confidence" "0"
  set_output "consensus" "0"
  set_output "approved" "false"
  set_output "evidence-grade" "N/A"
  set_output "session-id" ""
  set_output "result-json" "{}"
}

# --- Preflight checks ---
if ! command -v quorum &>/dev/null; then
  echo "::error::quorum CLI not found. Ensure quorum-ai is installed."
  set_defaults
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "::error::jq not found. It should be pre-installed on GitHub runners."
  set_defaults
  exit 1
fi

if [[ -z "${PR_NUMBER:-}" ]]; then
  echo "::error::PR_NUMBER is not set. This action must run on pull_request events."
  set_defaults
  exit 1
fi

if [[ -z "$PROVIDERS" ]]; then
  echo "::error::providers input is required."
  set_defaults
  exit 1
fi

# --- Build command ---
CMD=(quorum ci --pr "$PR_NUMBER" --format json)
CMD+=(-p "$PROVIDERS")
CMD+=(--profile "$PROFILE")
CMD+=(--confidence-threshold "$CONFIDENCE_THRESHOLD")
CMD+=(--max-files "$MAX_FILES")

if [[ "$EVIDENCE" != "off" ]]; then
  CMD+=(--evidence "$EVIDENCE")
fi

if [[ "$POST_COMMENT" == "true" ]]; then
  CMD+=(--post-comment)
fi

if [[ "$ADD_LABELS" == "true" ]]; then
  CMD+=(--label)
fi

if [[ -n "$FOCUS" ]]; then
  CMD+=(--focus "$FOCUS")
fi

# --- Run ---
echo "::group::Quorum Code Review"
echo "Running: ${CMD[*]}"

RESULT_FILE=$(mktemp)
EXIT_CODE=0
"${CMD[@]}" > "$RESULT_FILE" 2>&1 || EXIT_CODE=$?

cat "$RESULT_FILE"
echo "::endgroup::"

# --- Parse output & set outputs ---
if [[ $EXIT_CODE -eq 0 ]] && jq -e . "$RESULT_FILE" &>/dev/null; then
  RESULT=$(cat "$RESULT_FILE")
  set_output "confidence"     "$(echo "$RESULT" | jq -r '.confidence // 0')"
  set_output "consensus"      "$(echo "$RESULT" | jq -r '.consensus // 0')"
  set_output "approved"       "$(echo "$RESULT" | jq -r '.approved // false')"
  set_output "evidence-grade" "$(echo "$RESULT" | jq -r '.evidenceGrade // "N/A"')"
  set_output "session-id"     "$(echo "$RESULT" | jq -r '.sessionId // ""')"
  set_output "result-json"    "$(echo "$RESULT" | jq -c '.')"
else
  echo "::warning::Failed to parse quorum output as JSON (exit code: $EXIT_CODE)"
  set_defaults
fi

rm -f "$RESULT_FILE"
exit $EXIT_CODE
