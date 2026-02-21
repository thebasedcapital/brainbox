#!/usr/bin/env bash
# vault-glow-hook.sh
# PostToolUse hook: two jobs in one pass:
#
#   1. Vault files (.md in VAULT_PATH):
#      - Touch <file>.agent_active  (VaultWatcher sees "created" → node glows)
#      - Background job removes sentinel after GLOW_DURATION seconds
#
#   2. ALL file accesses (any Read/Edit/Write):
#      - Append one JSON line to ACTIVITY_LOG for the live ticker overlay
#      - Log rotated at MAX_LINES entries (tail -n keeps it small)
#
# Input: JSON on stdin (Claude Code PostToolUse event)
# Output: {"continue": true} on stdout

VAULT_PATH="${HOME}/.claude/projects/-Users-bbclaude/memory"
ACTIVITY_LOG="${HOME}/.vaultgraph-activity.jsonl"
GLOW_DURATION=3
MAX_LINES=50

# Read stdin
RAW=$(cat)

# Extract tool_name
TOOL=$(printf '%s' "$RAW" | jq -r '.tool_name // empty' 2>/dev/null)

case "$TOOL" in
  Read|Edit|Write)
    FILE=$(printf '%s' "$RAW" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
    ;;
  *)
    printf '{"continue":true,"suppressOutput":true}\n'
    exit 0
    ;;
esac

if [[ -z "$FILE" ]]; then
  printf '{"continue":true,"suppressOutput":true}\n'
  exit 0
fi

# --- Activity log: append for ALL file accesses ---
TS=$(date +%s)
# Shorten path for display: strip $HOME prefix
SHORT="${FILE/#$HOME/~}"
printf '{"file":"%s","tool":"%s","ts":%d}\n' "$SHORT" "$TOOL" "$TS" >> "$ACTIVITY_LOG" 2>/dev/null

# Rotate log: keep last MAX_LINES lines (non-blocking)
LINE_COUNT=$(wc -l < "$ACTIVITY_LOG" 2>/dev/null || echo 0)
if [[ "$LINE_COUNT" -gt "$MAX_LINES" ]]; then
  TMPF="${ACTIVITY_LOG}.tmp"
  tail -n "$MAX_LINES" "$ACTIVITY_LOG" > "$TMPF" 2>/dev/null && mv "$TMPF" "$ACTIVITY_LOG" 2>/dev/null
fi

# --- Vault glow: only for .md files inside VAULT_PATH ---
if [[ "$FILE" == "${VAULT_PATH}/"*.md ]]; then
  SENTINEL="${FILE}.agent_active"
  touch "$SENTINEL" 2>/dev/null
  (sleep "$GLOW_DURATION" && rm -f "$SENTINEL") &
  disown
fi

printf '{"continue":true,"suppressOutput":true}\n'
exit 0
