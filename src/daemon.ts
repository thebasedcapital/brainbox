/**
 * BrainBox Daemon — persistent FSEvents watcher + shell socket server.
 *
 * Learns from all file activity, not just Claude Code sessions.
 * Uses the same HebbianEngine, same SQLite DB, same better-sqlite3.
 *
 * Uses native macOS FSEvents (one fd per root dir, not per subdirectory).
 * This avoids the EMFILE exhaustion that chokidar causes on large trees.
 *
 * Usage:
 *   npx tsx src/daemon.ts                  # foreground (dev)
 *   npx tsx src/cli.ts daemon start        # background (daemonized)
 *   npx tsx src/cli.ts daemon stop         # graceful shutdown
 *   npx tsx src/cli.ts daemon status       # check health
 *   npx tsx src/cli.ts daemon install      # LaunchAgent (auto-start)
 *   npx tsx src/cli.ts daemon uninstall    # remove LaunchAgent
 */

import fsevents from "fsevents";
import { createServer, type Server, type Socket } from "node:net";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  chmodSync,
  statSync,
} from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { openDb } from "./db.js";
import { HebbianEngine } from "./hebbian.js";
import { shouldSkipPath } from "./adapter.js";
import { getSupportedLang, extractAndStoreSnippets, invalidateSnippetCache } from "./snippets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Config ---

const DATA_DIR = join(process.env.HOME || "~", ".brainbox");
const CONFIG_PATH = join(DATA_DIR, "config.json");
const PID_PATH = join(DATA_DIR, "daemon.pid");
const SOCKET_PATH = join(DATA_DIR, "daemon.sock");

interface DaemonConfig {
  watch: string[];
  ignore: string[];
  extensions: string[];
  debounce_ms: number;
  max_batch_size: number;
  session_idle_minutes: number;
  git_hooks: boolean;
  frontmost_app_poll_ms: number;
}

const DEFAULT_CONFIG: DaemonConfig = {
  watch: [
    // Add specific project roots here or in ~/.brainbox/config.json.
    // FSEvents uses one fd per root — safe to add many directories.
  ],
  ignore: [
    "node_modules/",
    ".git/",
    "dist/",
    "build/",
    ".next/",
    "target/",
    "__pycache__/",
    ".venv/",
    "venv/",
    ".build/",
    ".swiftpm/",
    "DerivedData/",
  ],
  extensions: [
    ".ts", ".tsx", ".js", ".jsx",
    ".py", ".rs", ".swift", ".go",
    ".md", ".json", ".yaml", ".yml", ".toml",
    ".sh", ".zsh", ".bash",
    ".css", ".scss", ".html", ".svelte", ".vue",
  ],
  debounce_ms: 2000,
  max_batch_size: 50,
  session_idle_minutes: 15,
  git_hooks: true,
  frontmost_app_poll_ms: 5000,
};

function loadConfig(): DaemonConfig {
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      return { ...DEFAULT_CONFIG, ...raw };
    } catch {
      log("warn", `Invalid config at ${CONFIG_PATH}, using defaults`);
    }
  }
  return DEFAULT_CONFIG;
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? join(process.env.HOME || "~", p.slice(2)) : p;
}

// --- Logging ---

function log(level: "info" | "warn" | "error" | "event", msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  const prefix =
    level === "event" ? "\x1b[36m+\x1b[0m" :
    level === "warn"  ? "\x1b[33m!\x1b[0m" :
    level === "error" ? "\x1b[31mx\x1b[0m" :
                        "\x1b[90m>\x1b[0m";
  console.log(`${ts} ${prefix} ${msg}`);
}

// --- Session Management ---

let currentSessionId = `daemon-${Date.now()}`;
let lastActivityMs = Date.now();

/** Reference to the DB for session-end decay (set in startDaemon) */
let daemonDb: ReturnType<typeof openDb> | null = null;

function getSessionId(config: DaemonConfig): string {
  const now = Date.now();
  const idleMs = config.session_idle_minutes * 60 * 1000;
  if (now - lastActivityMs > idleMs) {
    // v3.0: Run self-healing decay when session rotates (idle timeout)
    // v3.1: Run sleep consolidation after decay
    if (daemonDb) {
      try {
        const engine = new HebbianEngine(daemonDb, currentSessionId);
        const decayResult = engine.decay();
        log("info", `Self-healing decay: pruned ${decayResult.pruned_synapses} synapses, ${decayResult.pruned_orphans} orphans, weakened ${decayResult.weakened_noise_bridges} noise bridges`);
        const h = decayResult.homeostasis;
        if (h.myelin_scaled || h.weight_scaled || h.neurons_dampened || h.neurons_boosted) {
          log("info", `Homeostasis: myelin×${h.myelin_scale_factor.toFixed(3)} weight×${h.weight_scale_factor.toFixed(3)} dampened=${h.neurons_dampened} boosted=${h.neurons_boosted} tags_expired=${h.tags_expired}`);
        }
        const consolResult = engine.consolidate();
        log("info", `Sleep consolidation: replayed ${consolResult.sessions_replayed} sessions, strengthened ${consolResult.synapses_strengthened} synapses, discovered ${consolResult.patterns_discovered} patterns`);
      } catch (err: any) {
        log("error", `Decay/consolidation failed: ${err.message}`);
      }
    }
    currentSessionId = `daemon-${now}`;
    log("info", `New session: ${currentSessionId}`);
  }
  lastActivityMs = now;
  return currentSessionId;
}

// --- Debounced Batch Recorder ---

interface PendingEvent {
  path: string;
  context: string;
  timestamp: number;
}

let pendingEvents: PendingEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush(db: ReturnType<typeof openDb>, config: DaemonConfig) {
  flushTimer = null;
  if (pendingEvents.length === 0) return;

  const batch = pendingEvents.splice(0, config.max_batch_size);
  const sessionId = getSessionId(config);

  try {
    const engine = new HebbianEngine(db, sessionId);
    db.exec("BEGIN");
    for (const evt of batch) {
      engine.record(evt.path, "file", evt.context, evt.timestamp);
    }
    db.exec("COMMIT");
    log("info", `Flushed ${batch.length} events (session: ${sessionId.slice(0, 20)}...)`);
  } catch (err: any) {
    try { db.exec("ROLLBACK"); } catch {}
    log("error", `Flush failed: ${err.message}`);
  }
}

// --- Snippet Re-extraction Queue (v4.0) ---
// Debounced: collects modified source files, re-extracts snippets in batch

const snippetQueue = new Set<string>();
let snippetTimer: ReturnType<typeof setTimeout> | null = null;
const SNIPPET_DEBOUNCE_MS = 5000; // 5s debounce

function queueSnippetReExtraction(path: string) {
  if (!getSupportedLang(path)) return;
  snippetQueue.add(path);
  if (!snippetTimer) {
    snippetTimer = setTimeout(() => flushSnippetQueue(), SNIPPET_DEBOUNCE_MS);
  }
}

async function flushSnippetQueue() {
  snippetTimer = null;
  if (snippetQueue.size === 0) return;

  const paths = [...snippetQueue];
  snippetQueue.clear();

  try {
    const db = openDb();
    let updated = 0;
    for (const path of paths) {
      const neuronId = `file:${path}`;
      // Only re-extract if neuron exists (file is tracked)
      const neuron = db.prepare(`SELECT id FROM neurons WHERE id = ?`).get(neuronId);
      if (!neuron) continue;
      const count = await extractAndStoreSnippets(db, path, neuronId, false);
      if (count > 0) updated++;
    }
    if (updated > 0) {
      invalidateSnippetCache();
      log("info", `Re-extracted snippets for ${updated} files`);
    }
    db.close();
  } catch (err: any) {
    log("error", `Snippet re-extraction failed: ${err.message}`);
  }
}

function enqueue(
  evt: PendingEvent,
  db: ReturnType<typeof openDb>,
  config: DaemonConfig
) {
  // Dedup: skip if same path already pending
  if (pendingEvents.some((e) => e.path === evt.path)) return;

  pendingEvents.push(evt);

  // Flush immediately if batch is full
  if (pendingEvents.length >= config.max_batch_size) {
    if (flushTimer) clearTimeout(flushTimer);
    flush(db, config);
    return;
  }

  // Otherwise debounce
  if (!flushTimer) {
    flushTimer = setTimeout(() => flush(db, config), config.debounce_ms);
  }
}

// --- FSEvents Watcher (native macOS — one fd per root) ---

function startWatcher(
  config: DaemonConfig,
  db: ReturnType<typeof openDb>
): (() => void) {
  const dirs = config.watch.map(expandHome).filter((d) => existsSync(d));

  if (dirs.length === 0) {
    log("warn", "No watch directories exist. Add paths to ~/.brainbox/config.json");
    return () => {};
  }

  const extensionSet = new Set(config.extensions);
  const ignoreSegments = config.ignore;
  let eventCount = 0;
  const startMs = Date.now();

  // One native watcher per root directory — O(1) fd per dir.
  // fsevents.watch() returns a stop() function directly.
  const stopFns: (() => void)[] = [];

  for (const dir of dirs) {
    const stop = fsevents.watch(dir, (path: string, flags: number, id: string) => {
      // Extension filter
      const ext = extname(path);
      if (!extensionSet.has(ext)) return;

      // Ignore patterns — check if any segment matches
      if (ignoreSegments.some((seg) => path.includes(seg))) return;

      // Reuse existing skip logic (lock files, .DS_Store, etc.)
      if (shouldSkipPath(path)) return;

      // Parse FSEvents flags for rich context
      const info = fsevents.getInfo(path, flags);
      const context = `daemon:${info.event || "change"}`;

      eventCount++;
      log("event", `${info.event || "change"}: ${path}`);

      enqueue(
        { path, context, timestamp: Date.now() },
        db,
        config
      );

      // v4.0: Queue snippet re-extraction for modified source files
      if (info.event === "modified" || info.event === "created") {
        queueSnippetReExtraction(path);
      }
    });

    log("info", `Watching: ${dir}`);
    stopFns.push(stop);
  }

  log("info", `${dirs.length} FSEvents watchers active (${dirs.length} fds total)`);

  // Periodic stats (every 5 min)
  const statsInterval = setInterval(() => {
    const elapsed = ((Date.now() - startMs) / 60000).toFixed(0);
    const rate = eventCount > 0 ? (eventCount / (Date.now() - startMs) * 60000).toFixed(1) : "0";
    log("info", `Stats: ${eventCount} events in ${elapsed}min (${rate}/min)`);
  }, 5 * 60 * 1000);

  // Return cleanup function
  return () => {
    clearInterval(statsInterval);
    for (const stop of stopFns) stop();
  };
}

// --- Unix Socket Server ---

function startSocketServer(
  config: DaemonConfig,
  db: ReturnType<typeof openDb>
): Server {
  // Clean up stale socket
  if (existsSync(SOCKET_PATH)) {
    try { unlinkSync(SOCKET_PATH); } catch {}
  }

  const server = createServer((socket: Socket) => {
    let buffer = "";

    socket.on("data", (chunk) => {
      buffer += chunk.toString();

      // Process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          const path = evt.path || evt.file;
          const type = evt.type || "file";
          const context = evt.context || evt.cmd || "";

          if (!path) continue;

          if (type === "tool" || type === "error") {
            // Record tool/error neurons directly (no debounce)
            const sessionId = getSessionId(config);
            const engine = new HebbianEngine(db, sessionId);
            engine.record(path, type, context);
            log("event", `socket:${type}: ${path}`);
          } else {
            // File events go through debounced queue
            const absPath = path.startsWith("/") ? path : join(process.cwd(), path);
            if (!shouldSkipPath(absPath)) {
              log("event", `socket:file: ${absPath}`);
              enqueue(
                { path: absPath, context: context || "socket", timestamp: Date.now() },
                db,
                config
              );
            }
          }
        } catch {
          // Ignore malformed lines — shell hooks may send garbage
        }
      }
    });

    socket.on("error", () => {}); // ignore client disconnect errors
  });

  server.listen(SOCKET_PATH, () => {
    log("info", `Socket server: ${SOCKET_PATH}`);
  });

  server.on("error", (err) => {
    log("error", `Socket error: ${err.message}`);
  });

  return server;
}

// --- PID File ---

function writePid() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PID_PATH, String(process.pid));
}

function removePid() {
  try { unlinkSync(PID_PATH); } catch {}
}

export function readPid(): number | null {
  try {
    const pid = parseInt(readFileSync(PID_PATH, "utf-8").trim());
    // Check if process is alive
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

// --- Git Hooks Installer ---

const GIT_HOOK_MARKER = "# BrainBox git hook — DO NOT EDIT";

function generateGitHook(hookType: "post-commit" | "post-checkout" | "post-merge"): string {
  const header = `#!/bin/sh\n${GIT_HOOK_MARKER}\n`;

  switch (hookType) {
    case "post-commit":
      return `${header}
# Send committed files to BrainBox daemon
FILES=$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null)
if [ -n "$FILES" ]; then
  REPO=$(git rev-parse --show-toplevel 2>/dev/null)
  for f in $FILES; do
    echo "{\\"type\\":\\"file\\",\\"path\\":\\"$REPO/$f\\",\\"context\\":\\"git:commit\\"}" \\
      | nc -U ${SOCKET_PATH} 2>/dev/null
  done
fi
`;
    case "post-checkout":
      return `${header}
# Send branch switch context to BrainBox daemon
OLD_REF=$1
NEW_REF=$2
BRANCH_FLAG=$3
if [ "$BRANCH_FLAG" = "1" ]; then
  BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")
  echo "{\\"type\\":\\"tool\\",\\"path\\":\\"git:checkout\\",\\"context\\":\\"branch:$BRANCH\\"}" \\
    | nc -U ${SOCKET_PATH} 2>/dev/null
  # Send changed files between refs
  FILES=$(git diff --name-only "$OLD_REF" "$NEW_REF" 2>/dev/null | head -20)
  REPO=$(git rev-parse --show-toplevel 2>/dev/null)
  for f in $FILES; do
    echo "{\\"type\\":\\"file\\",\\"path\\":\\"$REPO/$f\\",\\"context\\":\\"git:checkout\\"}" \\
      | nc -U ${SOCKET_PATH} 2>/dev/null
  done
fi
`;
    case "post-merge":
      return `${header}
# Send merged files to BrainBox daemon
FILES=$(git diff-tree --name-only -r ORIG_HEAD HEAD 2>/dev/null | head -30)
REPO=$(git rev-parse --show-toplevel 2>/dev/null)
for f in $FILES; do
  echo "{\\"type\\":\\"file\\",\\"path\\":\\"$REPO/$f\\",\\"context\\":\\"git:merge\\"}" \\
    | nc -U ${SOCKET_PATH} 2>/dev/null
done
`;
  }
}

/** Find git repos in watched dirs and install hooks */
function installGitHooks(config: DaemonConfig): number {
  const hookTypes: Array<"post-commit" | "post-checkout" | "post-merge"> = [
    "post-commit", "post-checkout", "post-merge"
  ];
  let installed = 0;

  const dirs = config.watch.map(expandHome).filter((d) => existsSync(d));

  for (const watchDir of dirs) {
    // Find .git dirs up to 3 levels deep (avoid scanning huge trees)
    const gitDirs = findGitDirs(watchDir, 3);

    for (const gitDir of gitDirs) {
      const hooksDir = join(gitDir, "hooks");
      mkdirSync(hooksDir, { recursive: true });

      for (const hookType of hookTypes) {
        const hookPath = join(hooksDir, hookType);
        const hookContent = generateGitHook(hookType);

        // Check if hook already exists
        if (existsSync(hookPath)) {
          const existing = readFileSync(hookPath, "utf-8");
          if (existing.includes(GIT_HOOK_MARKER)) {
            // Already installed by us — update in place
            writeFileSync(hookPath, hookContent);
            chmodSync(hookPath, 0o755);
            continue;
          }
          // Existing hook from user/tool — append our hook
          if (!existing.includes("brainbox")) {
            const appended = existing.trimEnd() + "\n\n" + hookContent;
            writeFileSync(hookPath, appended);
            chmodSync(hookPath, 0o755);
            installed++;
            log("info", `Git hook appended: ${hookPath}`);
          }
        } else {
          // No existing hook — write ours
          writeFileSync(hookPath, hookContent);
          chmodSync(hookPath, 0o755);
          installed++;
          log("info", `Git hook installed: ${hookPath}`);
        }
      }
    }
  }

  return installed;
}

/** Recursively find .git directories up to maxDepth */
function findGitDirs(root: string, maxDepth: number): string[] {
  const results: string[] = [];

  function scan(dir: string, depth: number) {
    if (depth > maxDepth) return;
    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) {
      // Only use actual .git directories, not .git files (submodules/worktrees)
      try {
        if (statSync(gitPath).isDirectory()) {
          results.push(gitPath);
        }
      } catch {}
      return; // Don't recurse into git repos looking for nested ones
    }
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "target") continue;
        scan(join(dir, entry.name), depth + 1);
      }
    } catch {
      // Permission denied, etc.
    }
  }

  scan(root, 0);
  return results;
}

// --- Frontmost App Polling ---

let lastFrontmostApp = "";

function startFrontmostAppPoller(
  config: DaemonConfig,
  db: ReturnType<typeof openDb>
): (() => void) {
  if (config.frontmost_app_poll_ms <= 0) return () => {};

  const interval = setInterval(() => {
    try {
      const app = execSync(
        `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true' 2>/dev/null`,
        { timeout: 2000, encoding: "utf-8" }
      ).trim();

      if (app && app !== lastFrontmostApp) {
        lastFrontmostApp = app;
        const sessionId = getSessionId(config);
        const engine = new HebbianEngine(db, sessionId);
        engine.record(`app:${app}`, "tool", `frontmost:${app}`);
        log("event", `frontmost: ${app}`);
      }
    } catch {
      // osascript failed — ignore (headless, locked screen, etc.)
    }
  }, config.frontmost_app_poll_ms);

  log("info", `Frontmost app polling: every ${config.frontmost_app_poll_ms}ms`);
  return () => clearInterval(interval);
}

// --- Main ---

export async function startDaemon() {
  // Check for already-running daemon
  const existingPid = readPid();
  if (existingPid) {
    log("error", `Daemon already running (PID ${existingPid}). Use 'daemon stop' first.`);
    process.exit(1);
  }

  const config = loadConfig();
  const db = openDb();
  daemonDb = db; // v3.0: expose to session rotation for self-healing decay

  // Apple Silicon-tuned pragmas for long-running daemon
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000");
  db.pragma("temp_store = MEMORY");
  db.pragma("mmap_size = 268435456");
  db.pragma("wal_autocheckpoint = 1000");

  log("info", "BrainBox Daemon starting...");
  log("info", `PID: ${process.pid}`);
  log("info", `Session idle timeout: ${config.session_idle_minutes}min`);
  log("info", `Debounce: ${config.debounce_ms}ms, max batch: ${config.max_batch_size}`);

  writePid();

  const stopWatcher = startWatcher(config, db);
  const socketServer = startSocketServer(config, db);
  const stopAppPoller = startFrontmostAppPoller(config, db);

  // Install git hooks in all watched repos
  if (config.git_hooks) {
    const hookCount = installGitHooks(config);
    log("info", `Git hooks: ${hookCount} new hooks installed`);
  }

  // Graceful shutdown
  const shutdown = (signal: string) => {
    log("info", `Shutdown (${signal})...`);

    // Flush remaining events
    if (flushTimer) clearTimeout(flushTimer);
    flush(db, config);

    // v3.1: Final sleep consolidation on shutdown
    try {
      const engine = new HebbianEngine(db, currentSessionId);
      const result = engine.consolidate();
      log("info", `Shutdown consolidation: replayed ${result.sessions_replayed}, strengthened ${result.synapses_strengthened}, discovered ${result.patterns_discovered}`);
    } catch (err: any) {
      log("error", `Shutdown consolidation failed: ${err.message}`);
    }

    // Cleanup
    stopWatcher();
    stopAppPoller();
    socketServer.close();
    try { unlinkSync(SOCKET_PATH); } catch {}
    db.close();
    removePid();

    log("info", "Goodbye.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    log("error", `Uncaught: ${err.message}`);
    shutdown("exception");
  });
}

// --- CLI Helpers (exported for cli.ts) ---

export const DAEMON_PATHS = { DATA_DIR, CONFIG_PATH, PID_PATH, SOCKET_PATH };

export function generateLaunchAgentPlist(): string {
  const projectRoot = join(__dirname, "..");
  const logDir = join(DATA_DIR, "logs");

  // Use absolute paths — LaunchAgent has a minimal PATH
  const nodeBin = process.execPath; // absolute path to current node binary
  const tsxBin = join(projectRoot, "node_modules", ".bin", "tsx");
  const daemonTs = join(__dirname, "daemon.ts");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.brainbox.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${tsxBin}</string>
    <string>${daemonTs}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${join(logDir, "daemon.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join(logDir, "daemon.err")}</string>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
  <key>Nice</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>${process.env.HOME}</string>
  </dict>
</dict>
</plist>`;
}

export function generateShellHook(): string {
  return `# BrainBox shell hook — add to ~/.zshrc
# Sends commands to BrainBox daemon via Unix socket

brainbox_preexec() {
  local cmd="\${1%% *}"  # first word (command name)
  # Fire-and-forget: send to daemon socket, ignore errors
  echo "{\\"type\\":\\"tool\\",\\"path\\":\\"zsh:$cmd\\",\\"context\\":\\"$1\\"}" \\
    | nc -U ${SOCKET_PATH} 2>/dev/null &!
}

# Only activate if daemon socket exists
if [[ -S "${SOCKET_PATH}" ]]; then
  autoload -Uz add-zsh-hook
  add-zsh-hook preexec brainbox_preexec
fi
`;
}

// If run directly (not imported)
if (process.argv[1]?.endsWith("daemon.ts") || process.argv[1]?.endsWith("daemon.js")) {
  startDaemon();
}
