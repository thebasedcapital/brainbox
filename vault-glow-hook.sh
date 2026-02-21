#!/usr/bin/env bash
# vault-glow-hook.sh
# PostToolUse hook: flashes agent-active sentinel for vault files accessed by Claude.
#
# When Claude reads/edits a file inside VAULT_PATH, this hook:
#   1. Touches <file>.agent_active  (VaultWatcher sees "created" → node glows)
#   2. Spawns a background job that removes the sentinel after GLOW_DURATION seconds
#      (VaultWatcher sees "deleted" → glow stops, completion pulse fires)
#
# Input: JSON on stdin (Claude Code PostToolUse event)
# Output: {"continue": true} on stdout

VAULT_PATH="${HOME}/.claude/projects/-Users-bbclaude/memory"
GLOW_DURATION=3

# Read stdin
RAW=$(cat)

# Extract tool_name and file_path with jq (fast, always available on macOS via brew)
TOOL=$(printf '%s' "$RAW" | jq -r '.tool_name // empty' 2>/dev/null)

case "$TOOL" in
  Read|Edit|Write)
    FILE=$(printf '%s' "$RAW" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
    ;;
  *)
    # Not a file-access tool — exit immediately
    printf '{"continue":true,"suppressOutput":true}\n'
    exit 0
    ;;
esac

# Must be a .md file inside the vault
if [[ -z "$FILE" || "$FILE" != "${VAULT_PATH}/"*.md ]]; then
  printf '{"continue":true,"suppressOutput":true}\n'
  exit 0
fi

# Sentinel path
SENTINEL="${FILE}.agent_active"

# Touch sentinel (creates file → VaultWatcher fires onAgentStart)
touch "$SENTINEL" 2>/dev/null

# Background job: remove sentinel after GLOW_DURATION seconds
(sleep "$GLOW_DURATION" && rm -f "$SENTINEL") &
disown

printf '{"continue":true,"suppressOutput":true}\n'
exit 0
