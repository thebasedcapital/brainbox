# BrainBox v4.0: Snippet Neurons

## Plan

Based on GLM-5's analysis + codebase review. Adds System 2 (semantic code search) alongside existing System 1 (Hebbian habit memory).

### Phase 1: Extraction + Storage (~200 LOC)

1. **Install `web-tree-sitter`** + download grammar WASMs for TS/JS, Python, Rust, Swift

2. **Create `src/snippets.ts`** — single file (matches codebase pattern)
   - `extractSnippets(filePath: string): Snippet[]` — tree-sitter extraction
   - Targets: exported functions, public classes, methods >10 lines
   - Skip: test files, node_modules, files >10k lines

3. **Add `snippets` table to `src/db.ts`** — v4 migration
   ```sql
   CREATE TABLE IF NOT EXISTS snippets (
     id TEXT PRIMARY KEY,
     parent_neuron_id TEXT NOT NULL REFERENCES neurons(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     kind TEXT NOT NULL,
     start_line INTEGER NOT NULL,
     end_line INTEGER NOT NULL,
     source TEXT NOT NULL,
     embedding BLOB,
     content_hash TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   ```

### Phase 2: Search + Merge (~150 LOC)

4. **Add `searchSnippets()` to `src/snippets.ts`**
   - Load all snippet embeddings, cosine similarity vs query embedding
   - SQLite scan fine at <50k snippets (~7.7MB)
   - Threshold: 0.35

5. **Modify `recall()` in `src/hebbian.ts`** to merge snippet results
   - Parallel execution: Hebbian + snippet search
   - Confidence >= 0.7 → skip snippets
   - 0.4-0.7 → merge (max confidence per file, 15% consensus bonus)
   - < 0.4 → snippet-only
   - Add `snippets?: SnippetMatch[]` to RecallResult

### Phase 3: CLI + Integration (~100 LOC)

6. **Add `extract-snippets` CLI command** to `src/cli.ts`

7. **Add snippet extraction to `src/bootstrap.ts`**

8. **Wire into daemon file-modify events** (debounced re-extraction)

### Files
- `package.json` — add web-tree-sitter
- `src/db.ts` — v4 migration
- `src/snippets.ts` — NEW (~250 LOC)
- `src/hebbian.ts` — modify recall() (~50 LOC)
- `src/cli.ts` — extract-snippets command (~40 LOC)
- `src/bootstrap.ts` — snippet extraction step (~30 LOC)

### Not Doing
- FAISS — overkill at <50k snippets
- Pattern layer (v4.1) — depends on snippets first
- Staleness check on every recall — daemon handles invalidation

---

# BrainBox Autoinstaller Plan

## Overview
Create `brainbox install` and `brainbox uninstall` commands to automate setting up BrainBox for new users.

## What Gets Installed

### 1. MCP Server
- Command: `claude mcp add brainbox -- npx tsx <path>/src/mcp.ts`
- Location: Claude's MCP configuration (auto-managed by `claude mcp add`)
- Currently hardcoded to `~/happy-cli-new/brainbox/src/mcp.ts` - needs dynamic path resolution

### 2. PostToolUse Hook
- File: `src/hook.ts` (already exists)
- Hook point: `PostToolUse`
- Purpose: Records Read/Edit/Write/Grep/Glob tool usage
- Entry in settings.json: `{ "type": "command", "command": "npx tsx <path>/src/hook.ts" }`

### 3. UserPromptSubmit Hook
- File: `src/prompt-hook.ts` (already exists)
- Hook point: `UserPromptSubmit`
- Purpose: Injects neural recall results into user prompts
- Entry in settings.json: `{ "type": "command", "command": "npx tsx <path>/src/prompt-hook.ts" }`

## Installation Path Resolution

Critical challenge: Determine where BrainBox is installed to construct correct paths.

### Detection Order

1. **Check if running from globally installed package**
   - `resolve` the `package.json` path from `import.meta.url`
   - If path is in global npm directory (e.g., `/usr/local/lib/node_modules/brainbox-hebbian`)
   - Use that path directly

2. **Check if running via npx**
   - `npx` creates in-memory temp locations
   - Strategy: Detect npx by checking if `process.argv[0]` contains `npx` or `npm`
   - Use `__dirname` of the script to get the actual location

3. **Check if running in development**
   - `__dirname` points to `~/happy-cli-new/brainbox/` or similar
   - Use that path

4. **Fallback: Query npm**
   - Run `npm root -g` to get global node_modules dir
   - Check if `brainbox-hebbian` exists there
   - If so, use `$(npm root -g)/brainbox-hebbian`

### Path Resolution Utility

Create `src/installer/install-path.ts` module:

```typescript
export function resolveInstallPath(): string {
  const importMeta = import.meta.url;
  const cliPath = fileURLToPath(importMeta);
  const cliDir = path.dirname(cliPath);

  if (cliDir.endsWith('dist')) {
    return path.dirname(cliDir);
  }

  if (cliDir.endsWith('src')) {
    return path.dirname(cliDir);
  }

  if (cliDir.includes('node_modules')) {
    return cliDir.split('node_modules/')[0] + 'node_modules/brainbox-hebbian';
  }

  const globalRoot = execSync('npm root -g').toString().trim();
  return path.join(globalRoot, 'brainbox-hebbian');
}
```

## `brainbox install` Command

### Step-by-Step Process

1. **Resolve install path**
   - Call `resolveInstallPath()` to get brainbox package root
   - Verify `src/hook.ts` and `src/prompt-hook.ts` exist
   - Exit with error if not found

2. **Read ~/.claude/settings.json**
   - Path: `~/.claude/settings.json`
   - If file doesn't exist, create skeleton: `{ "hooks": {} }`
   - Parse JSON, handle parse errors gracefully (create new file)

3. **Check if BrainBox already installed**
   - Look for hooks with commands containing `brainbox-hebbian` in the path
   - If PostToolUse and UserPromptSubmit hooks already exist with BrainBox commands:
     - Print warning: "BrainBox already installed"
     - Check if paths match current install location:
       - If paths differ: ask user if they want to update paths
       - If paths same: exit with success (no-op)

4. **Add MCP server**
   - Construct MCP command: `claude mcp add brainbox -- npx tsx ${installPath}/src/mcp.ts`
   - Execute: `execSync(cmd, { stdio: 'inherit' })`
   - Handle errors gracefully (already exists, Claude not found, etc.)

5. **Add PostToolUse hook**
   - Create hook entry with resolved path
   - Merge with existing hooks in settings.json (append, don't overwrite)
   - Check for duplicates to avoid adding twice

6. **Add UserPromptSubmit hook**
   - Same process as PostToolUse hook

7. **Write updated settings.json**
   - Pretty-print JSON (2-space indent)
   - Backup original file to `~/.claude/settings.json.backup` before writing
   - Write atomically (temp file + rename)

8. **Verify installation**
   - Re-read settings.json to confirm hooks present
   - Print summary of what was installed

9. **Initialize database if needed**
   - Check if `~/.brainbox-hebbian/brainbox.db` exists
   - If not: create empty DB with schema

### Edge Cases to Handle

1. **settings.json has existing hooks** - append, don't overwrite
2. **settings.json malformed** - error with --reset option to recreate
3. **Claude CLI not installed** - skip MCP, warn, continue with hooks
4. **Insufficient permissions** - error with fix suggestion
5. **npx/tsx not available** - error asking user to install tsx
6. **Multiple Claude installations** - target `~/.claude/settings.json`
7. **Package installed in multiple locations** - detect and offer update

## `brainbox uninstall` Command

### Step-by-Step Process

1. **Read ~/.claude/settings.json**
   - If missing: exit with success (nothing to uninstall)

2. **Find BrainBox hook entries**
   - Scan for entries with `brainbox-hebbian` in command
   - Store indices to remove

3. **Remove hooks from arrays**
   - Filter out BrainBox entries
   - Remove empty hook arrays

4. **Remove MCP server**
   - Execute: `claude mcp remove brainbox`
   - Handle errors gracefully

5. **Write updated settings.json**
   - Backup before writing

6. **Database cleanup (optional)**
   - Ask user if they want to delete data

### Edge Cases

1. **Malformed settings.json** - print error, don't modify
2. **Only some hooks installed** - remove what's found, warn
3. **Other hooks depend on BrainBox MCP** - user responsibility

## File Structure

### Files to Create

1. `src/installer/install-path.ts` - path resolution logic
2. `src/installer/settings.ts` - settings.json manipulation
3. `src/installer/mcp.ts` - MCP server management

### Files to Modify

1. `src/cli.ts` - add install/uninstall commands, update usage()

## Hook Entry Format

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "type": "command",
        "command": "npx tsx /path/to/hook.ts"
      }
    ],
    "UserPromptSubmit": [
      {
        "type": "command",
        "command": "npx tsx /path/to/prompt-hook.ts"
      }
    ]
  }
}
```

## Testing Strategy

### Test Cases

1. Fresh install (no existing hooks)
2. Install with existing hooks (should append)
3. Re-install (already has BrainBox hooks)
4. Uninstall clean
5. Malformed settings.json
6. npx vs global install
7. Missing dependencies (npx/tsx/claude)
8. Permission errors

### Manual Testing Commands

```bash
# Fresh install
npx brainbox install

# Re-install (should detect)
npx brainbox install

# Uninstall
npx brainbox uninstall
```

## Implementation Order

1. Create path resolution module
2. Create settings manipulation module
3. Create MCP management module
4. Add install/uninstall handlers to cli.ts
5. Build and test

## Dependencies

None new - uses existing Node.js built-ins.
