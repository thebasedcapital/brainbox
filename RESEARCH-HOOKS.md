# macOS Passive Observation Hooks for BrainBox
## Source: Perplexity Deep Research (2026-02-13)

## High-level Comparison

| Mechanism | Primary scope | Data fidelity | Typical latency | True daemon? | Node.js difficulty |
|-----------|--------------|---------------|-----------------|-------------|-------------------|
| FSEvents | Filesystem trees | Medium (path + coarse flags) | 10s-100s ms, batched | Yes (user or system daemon) | Easy (npm `fsevents`) |
| Accessibility + Event Taps | Focus, windows, keyboard/mouse | High (per-event, per-window) | Sub-ms to few ms | Yes (UI agent with AX perms) | Medium/Hard (native module/FFI) |
| zsh `preexec` | Shell commands | High (exact command line) | ~0 ms | No (per-shell hook) | Easy (shell -> HTTP/Unix socket) |
| Git hooks | Git lifecycle | High (per commit/push) | On Git events | No (per-repo / global template) | Easy (hooks call Node) |
| Chrome extension APIs | Browsing + DevTools | High within Chrome | Event-driven, ~ms | Background worker only | Medium (native messaging -> Node) |
| VS Code extension API | Editor/debug/terminal | High within VS Code | Event-driven, ~ms | Only while VS Code open | Easy/Medium (extension <-> Node) |
| Endpoint Security | System-wide process/file | Very high (syscall-level) | Near-syscall latency | Yes (system extension + daemon) | Hard (Swift/C system ext -> Node) |

## 1. FSEvents

### Data Exposed
- Directory-tree change notifications (create, delete, modify, move)
- Events per path with bitmask flags
- No process attribution or operation type beyond coarse event kind
- Useful for: mapping activity to repo paths/file types, inferring "editing sessions" from write event clusters

### Latency
- `fseventsd` coalesces multiple changes within short windows — batched, not per-syscall
- Typically 10s to low 100s of ms; "near-real-time" but not keystroke-granular

### Daemon Capability
- Normal user-space processes, run as launchd user agent
- No special entitlements needed beyond filesystem access

### Node.js Implementation
```js
const fsevents = require('fsevents');
const stop = fsevents.watch('/Users/me/src', (path, flags, id) => {
  const info = fsevents.getInfo(path, flags, id);
  // info = { event: 'modified'|'created'|..., type: 'file'|'directory', path, ... }
});
```

## 2. Accessibility API + Event Taps

### Data Exposed
- AX API: focused app bundle ID, window title, window frame, document path
- Focus changes between windows/apps
- Event taps: global keyboard/mouse input (TCC-controlled)
- Useful for: time-on-task metrics, which editor/terminal is frontmost

### Latency
- Sub-millisecond — synchronous with event loop

### Daemon Capability
- Background agent app with Accessibility permissions (Settings -> Privacy -> Accessibility)
- Some AX patterns unreliable from pure CLI binary — proper app bundle safer

### Node.js Implementation
- **Option 1:** Native Node addon (C++/Swift) wrapping AX + CGEventTap
- **Option 2:** Companion Swift app communicating via Unix socket/HTTP
- Swift-companion pattern is least painful due to TCC quirks

## 3. zsh preexec Hooks

### Data Exposed
- `preexec`: fires before each command execution — raw command line
- Can tag by directory, git repo, timestamp
- Ideal for shell history with timing without parsing history files

### Latency
- ~0 ms — synchronous, fires right before execution

### Daemon Capability
- Lives inside shell process, not system daemon
- Pattern: `preexec` writes events to Unix socket or log file, Node daemon aggregates

### Node.js Implementation
Shell side (`.zshrc`):
```zsh
preexec() {
  emulate -L zsh
  local cmd="$1"
  local cwd="$PWD"
  print -r -- "$EPOCHREALTIME|$cwd|$cmd" >> "$HOME/.devtelemetry-shell.log" &
}
```
Node side: long-lived process tailing log (`fs.watch` + streaming) or listening on Unix socket.

## 4. Git Hooks

### Data Exposed
- Repo path, current branch, staged file list, diffs at commit time
- Push targets (remote name/URL, refs) in pre-push
- Global hooks via `git config --global core.hooksPath <dir>`
- Great for commit-centric metrics; blind to editing between commits

### Latency
- Event-driven: triggered only when Git is invoked, synchronous hook execution

### Daemon Capability
- One-shot scripts, not daemons
- Pattern: hook sends JSON event over HTTP/Unix socket to Node daemon

### Node.js Implementation
```bash
#!/usr/bin/env bash
node /usr/local/lib/devtelemetry/git-hook.js post-commit "$@"
```
Best practice: tiny shim hook -> persistent Node daemon over IPC (avoids startup overhead per commit).

## 5. Chrome Extension APIs

### Data Exposed
- `chrome.tabs`: tab creation, updates, URL/title/favicons
- `chrome.webNavigation`: navigation lifecycle (onBeforeNavigate, onCommitted, onDOMContentLoaded, onCompleted)
- `chrome.devtools.*`: network, console, DOM snapshot for inspected pages
- Track: URLs/domains visited, time per site, devtools usage

### Latency
- Event-driven, within milliseconds of browser action

### Daemon Capability
- MV3: service worker that spins up on events (runs only while Chrome running)
- Use Chrome "native messaging" to send events to external Node daemon

### Node.js Implementation
- Native messaging host: stdin/stdout JSON protocol
- Extension sends summarized events via `chrome.runtime.connectNative`
- Node side: reading/writing JSON on stdin/stdout

## 6. VS Code Extension APIs

### Data Exposed
- `workspace.onDidOpenTextDocument`, `onDidChangeTextDocument`, `onDidSaveTextDocument`
- `window.onDidChangeActiveTextEditor`
- `window.onDidOpenTerminal`, `onDidCloseTerminal`, `onDidWriteTerminalData`
- `debug.onDidStartDebugSession`, `onDidTerminateDebugSession`
- Full picture: files open/edited/saved, languages, debugging activity, terminal usage

### Latency
- Immediate on user action — negligible for telemetry

### Daemon Capability
- Runs within VS Code extension host — active only while VS Code running
- Pattern: extension forwards events to separate Node daemon over TCP/Unix socket

### Node.js Implementation
```ts
import * as vscode from 'vscode';
import { TelemetryClient } from './client';

export function activate(ctx: vscode.ExtensionContext) {
  const client = new TelemetryClient();
  ctx.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(doc => {
      client.send({
        type: 'vscode_save',
        path: doc.uri.fsPath,
        language: doc.languageId,
        timestamp: Date.now()
      });
    })
  );
}
```

## 7. Endpoint Security Framework (ESF)

### Data Exposed
- Process lifecycle: fork, exec, exit
- File system: open, create, rename, unlink, mmap, chmod, chown
- Network and IPC primitives
- AUTH_* (can block/allow) and NOTIFY_* (observe-only)
- Most complete passive telemetry on macOS short of kernel instrumentation

### Latency
- Near-syscall — emitted at syscall boundaries

### Daemon Capability
- Requires system extension with `com.apple.developer.endpoint-security.client` entitlement
- Needs Apple approval and notarization — EDR-class product requirement

### Node.js Implementation
- Must write ES client in C/Obj-C/Swift inside system extension
- Forward events to Node via Unix sockets/gRPC
- Only viable for security/EDR-class products

## Recommended Stack for BrainBox

**Easiest high-leverage hooks (all Node-friendly):**
1. `fsevents` (filesystem) — npm package, LaunchAgent daemon
2. zsh `preexec` + tiny IPC — log file or Unix socket
3. VS Code extension — already Node/TypeScript
4. Chrome extension + native messaging — stdin/stdout JSON

**Native companion needed:**
5. Accessibility + Event Taps — Swift agent -> Node daemon
6. Endpoint Security — Swift system extension (overkill for our use case)
