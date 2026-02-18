# BrainBox macOS Daemon — Vision & Handover

> For future agents implementing the system-level memory layer.
> Created: 2026-02-14 | Status: Planned (not yet implemented)
> Related: [[brainbox-architecture]], `RESEARCH-HOOKS.md`

## The Problem

BrainBox currently only learns when you use Claude Code or Kilo. If you edit a file in VS Code, vim, or Xcode — nothing is recorded. If you run shell commands — nothing. The entire learning system is blind to 90% of your actual work.

## The Vision

A macOS daemon that passively watches **everything** on your Mac — file edits in any editor, shell commands in any terminal — and feeds it into BrainBox's existing database. No configuration needed. No AI tools required. Someone at a random desk job who's never heard of Claude Code would benefit from the learned patterns the next time any AI tool queries BrainBox.

**One sentence:** Your Mac builds procedural memory of how you work, and any AI tool can query it.

## How It's Different From Alfred

Alfred indexes **what exists** (files, bookmarks, snippets) and lets you search it. BrainBox learns **what you do together** — which files you edit in the same session, which commands you run before fixing bugs, which directories you visit after reading docs.

Alfred answers: "Where is this file?"
BrainBox answers: "What files are related to what I'm working on right now?"

Alfred is a search engine. BrainBox is a learned association network. They don't compete — they complement.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                Your Mac (any activity)                │
└────────┬──────────────────────────────────┬──────────┘
         │ File writes                      │ Shell commands
         ▼                                  ▼
┌─────────────────┐              ┌──────────────────────┐
│  FSEvents       │              │  zsh preexec → sock  │
│  (npm fsevents) │              │  (non-blocking &!)   │
└────────┬────────┘              └──────────┬───────────┘
         │ debounce 2s                      │ JSON line
         └──────────────┬───────────────────┘
                        ▼
              ┌──────────────────┐
              │  BrainBox Daemon │  ← LaunchAgent (always on)
              │  SessionManager  │
              │  HebbianEngine   │
              └────────┬─────────┘
                       ▼
              ~/.brainbox/brainbox.db  ← shared with MCP, hooks, CLI
```

## Data Sources

### 1. FSEvents (File Writes)
- macOS native file system event API
- `npm fsevents` package — native binding, fast
- Watches configured directories (e.g. `~/Projects`, `~/Documents`)
- 2-second debounce batching, max 50 files per flush
- Filters: reuse existing `shouldSkipPath()` from `adapter.ts`, plus build dirs (`dist/`, `target/`, `.next/`)
- Context stored as `fswatch:<project-name>` (project = first dir after home)

### 2. zsh preexec (Shell Commands)
- Shell hook that fires before every command execution
- Sends JSON to Unix socket: `{"cwd":"...","command":"...","timestamp":...}`
- IPC via `~/.brainbox/shell.sock` (Unix domain socket — fastest, zero deps)
- Non-blocking: zsh sends via `nc -U` in background (`&!`) — never slows shell
- Heuristic parser: known file-taking commands (`vim`, `code`, `git`, `node`, `python`, `cat`, `grep`...)
- Extracts file args, resolves relative paths against CWD
- Context stored as `shell:vim`, `shell:git`, etc.

## Lifecycle: LaunchAgent

- `~/Library/LaunchAgents/com.brainbox.daemon.plist`
- `RunAtLoad: true` — starts at login
- `KeepAlive: { SuccessfulExit: false }` — auto-restart on crash
- Logs to `~/.brainbox/logs/`
- PID file at `~/.brainbox/daemon.pid`
- DB: same `~/.brainbox/brainbox.db` — WAL mode handles concurrent reads from MCP/CLI

## Session Management

- 15-minute idle timeout (configurable)
- New HebbianEngine session after idle — fresh co-access window
- Matches cognitive context-switch time
- Multiple data sources feed the same session — FSEvents and shell events interleave naturally

## Config (`~/.brainbox/daemon.json`)

```json
{
  "watch": ["~/Projects", "~/Documents"],
  "ignore": ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/target/**"],
  "debounce_ms": 2000,
  "max_batch_size": 50,
  "session_idle_minutes": 15,
  "socket_path": "~/.brainbox/shell.sock"
}
```

## What Existing Code to Reuse

- **`src/adapter.ts`** — `shouldSkipPath()`, `recordEvents()`, `LOW_SIGNAL_BASENAMES`, `AccessEvent` type
- **`src/hebbian.ts`** — `HebbianEngine.record()`, session creation, co-access window
- **`src/db.ts`** — `openDb()`, WAL mode already enabled
- **`src/adapters/claude-code.ts`** — reference for path extraction and context building

## New Files Needed

```
brainbox/src/daemon/
├── index.ts        # Entry point — start daemon, wire watchers
├── config.ts       # Load ~/.brainbox/daemon.json with defaults
├── fswatch.ts      # FSEvents watcher with 2s debounce batching
├── shellwatch.ts   # Unix socket server for zsh preexec events
└── session.ts      # Idle-timeout session boundaries (15 min)

brainbox/src/shell/
└── preexec.zsh     # zsh hook — sends JSON to Unix socket

brainbox/src/launchagent/
└── com.brainbox.daemon.plist   # LaunchAgent template
```

## CLI Extensions (add to existing `cli.ts`)

```
brainbox daemon start       # Start foreground (testing)
brainbox daemon install     # Copy plist → ~/Library/LaunchAgents/, launchctl bootstrap
brainbox daemon uninstall   # launchctl bootout, remove plist
brainbox daemon status      # Running? PID, uptime, events/min
brainbox daemon logs        # Tail daemon logs

brainbox shell install      # Append source line to ~/.zshrc
brainbox shell uninstall    # Remove from ~/.zshrc
```

## Dependencies

- `fsevents` — npm package, native macOS FSEvents binding
- `net` — Node.js built-in (Unix socket server)
- No other new deps

---

## The Consumer Problem

A daemon that passively learns is only half the story. The data has value only when something **queries** it. Current consumers:

1. **Claude Code** — prompt hook auto-injects recall (already works)
2. **Kilo** — native plugin does the same (already works)
3. **MCP tools** — any MCP-compatible agent can call `brainbox_recall` (already works)
4. **CLI** — `brainbox recall "what am I looking for"` (already works)

But for users who don't use AI coding tools, the daemon records data that nothing ever reads. That's the gap.

## Consumer Ideas

### 1. Menubar App — "Related Files"

A lightweight macOS menubar app that shows files related to what you're currently working on.

**How it works:**
- Watches the frontmost app's current file (via Accessibility API or FSEvents)
- Queries BrainBox: "what's related to this file?"
- Shows a dropdown of related files, ranked by confidence
- Click to open in default editor

**Tech:** Swift/SwiftUI menubar app, queries BrainBox DB directly (SQLite read) or via CLI subprocess.

**Value:** You're editing `auth.ts` and the menubar shows `session.ts`, `middleware.ts`, `auth.test.ts` — files you always edit together. One click to jump.

### 2. Spotlight-Like Recall UI

A keyboard-shortcut-activated overlay (like Alfred/Raycast) that does semantic search over your work patterns.

**How it works:**
- `Cmd+Shift+Space` (or similar) brings up a search bar
- Type "authentication" → shows files you've worked on in authentication contexts
- Not filename search (that's Spotlight) — behavioral pattern search
- Shows confidence scores and activation paths

**Tech:** SwiftUI overlay window with global hotkey. Same BrainBox query backend.

### 3. VS Code / Cursor Extension

A sidebar panel showing "Files you usually edit with this one" based on BrainBox synapses.

**How it works:**
- Extension watches `onDidChangeActiveTextEditor`
- Queries BrainBox for related files
- Shows ranked list in sidebar
- "Related files" section auto-updates as you navigate

### 4. Terminal Companion

When you `cd` into a project or run a command, show a brief "last time you worked on this, you also touched..." hint.

**How it works:**
- zsh precmd hook (after each command) queries BrainBox
- If high-confidence results exist for current CWD context, prints a subtle hint
- Non-intrusive: only shows when confidence > 70%

### 5. Git Commit Assistant

Before committing, show files that are usually edited together with your staged files but aren't staged yet. "Did you forget to include `session.ts`? You always edit it with `auth.ts`."

### 6. Browser Search Bar Injection

When you open your default browser and click any text field or search bar, BrainBox auto-suggests and inputs relevant context when the user presses Tab.

**How it works:**
- Browser extension watches for focused text inputs / search bars
- Queries BrainBox for context relevant to your current activity (frontmost project, recent files)
- Shows a ghost suggestion inline (like browser autofill) — press Tab to accept
- Works on any website: Google search, GitHub search, Stack Overflow, internal tools
- Example: you've been editing `auth.ts` and `session.ts` → open browser → search bar ghost-suggests "session token authentication middleware"

**Tech:** Chrome/Safari extension with native messaging to BrainBox CLI. Ghost text via DOM injection on focused inputs.

**Value:** Bridges the gap between file work and web search — your browser knows what you're working on without you typing it.

### 7. iOS/macOS Predictive Keyboard — "BrainBoard"

A custom keyboard for iOS (and suggestion bar for macOS) that brings iPhone-style predictive text to Mac, powered by BrainBox's learned associations. For Apple ecosystem users who switch between Mac and iPhone constantly.

**The insight:** macOS has no system-wide predictive text bar like iPhone does. People in the Apple ecosystem use Mac to send emails about work they just did, iMessage from phone about that email, Slack messages referencing files — and every time they retype the same project names, file names, and technical terms from scratch.

**How it works:**
- **macOS:** A floating suggestion bar (like Grammarly's overlay) that appears whenever the user types in any text field system-wide. Shows 3 contextual suggestions based on recent BrainBox activity — file names, project names, related terms
- **iOS:** A custom keyboard (like Grammarly, SwiftKey) with a prediction strip at the top. Syncs learned vocabulary from BrainBox via iCloud/local sync
- Learns your project vocabulary: if you've been working on `NanoClawSwift` with `HebbianEngine`, those terms appear as predictions when you start typing in Mail, Messages, Slack, etc.
- Not autocorrect — contextual prediction. "I just finished working on..." → suggests "the authentication refactor" because that's what BrainBox saw you editing

**Tech:**
- macOS: Input method or Accessibility-based floating bar (like Grammarly), reads BrainBox DB
- iOS: Custom keyboard extension with shared vocabulary synced via App Group / iCloud
- Sync: BrainBox daemon exports a lightweight "vocabulary snapshot" (top terms, recent project names) that iOS keyboard consumes
- No full DB on phone — just a compact prediction model built from the Mac's learned patterns

**Feasibility:** Long-term. Custom iOS keyboards are well-documented (UIInputViewController), and iCloud sync is straightforward. The hard part is making predictions feel natural and non-intrusive. Grammarly proves the UX pattern works. The unique value is that predictions come from your actual work patterns, not a generic language model.

**Value for "dumb users":** Someone who doesn't code at all but works in an office — they edit spreadsheets, write emails, create presentations. BrainBox daemon learns their file patterns. When they open Mail and start typing, the keyboard suggests project names, client names, and document titles they've been working with. Zero setup. It just knows.

## Implementation Priority

| Priority | Component | Effort | Value |
|----------|-----------|--------|-------|
| 1 | FSEvents watcher + daemon entry | ~2h | Core data collection |
| 2 | Shell watcher (zsh preexec) | ~1.5h | Captures terminal activity |
| 3 | LaunchAgent + install/uninstall | ~1h | Always-on lifecycle |
| 4 | Menubar app (related files) | ~3h | First consumer for non-AI users |
| 5 | Terminal companion (hints) | ~1h | Quick win for terminal users |
| 6 | Browser search bar injection | ~3h | Bridges file work → web search |
| 7 | VS Code extension | ~2h | Biggest editor audience |
| 8 | Spotlight-like recall UI | ~4h | Most powerful but most complex |
| 9 | BrainBoard (iOS/macOS keyboard) | ~weeks | Highest consumer reach, long-term play |

## Design Principles

1. **Zero config** — works out of the box with sensible defaults
2. **Never block** — daemon failures are silent, shell hooks are async, no user-visible latency
3. **Privacy first** — all data stays local in `~/.brainbox/`, no network calls
4. **Graceful degradation** — if daemon isn't running, everything else still works
5. **Feed the existing DB** — no new data stores, same `HebbianEngine`, same recall API
6. **Lightweight** — daemon should use <50MB RAM, <1% CPU in steady state

## Open Questions

- Should the menubar app be a separate repo or part of brainbox?
- Should we support bash/fish in addition to zsh?
- How to handle multiple users on the same Mac? (probably not a real concern)
- Should the daemon auto-embed new neurons? (depends on CPU budget — embedding is ~50ms each)
- What's the right watch depth for FSEvents? (recursive by default, but how many root dirs?)
