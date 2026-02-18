/**
 * BrainBox DomainAdapter Interface
 *
 * Pluggable system for passive observation from different data sources.
 * Each adapter translates domain-specific events into BrainBox AccessEvents,
 * which get recorded as neurons + synapses in the Hebbian engine.
 *
 * Built-in adapters:
 *   - ClaudeCodeAdapter: Claude Code PostToolUse + UserPromptSubmit hooks
 *   - KiloAdapter: Kilo ACP JSON event stream (via happy-cli)
 *
 * Future adapters:
 *   - zsh history, git post-commit, FSEvents, VS Code extension
 */

import { openDb } from "./db.js";
import { HebbianEngine } from "./hebbian.js";
import type { RecallResult, RecallOptions } from "./hebbian.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";

// --- Types ---

export interface AccessEvent {
  type: "file" | "tool" | "error" | "semantic";
  path: string;
  context: string;
  timestamp?: number;
}

export interface DomainAdapter {
  /** Adapter name (e.g. "claude-code", "kilo", "zsh") */
  readonly name: string;

  /** Extract BrainBox events from a raw domain event */
  extractEvents(rawEvent: unknown): AccessEvent[];

  /** Enrich a prompt with neural recall (optional) */
  enrichPrompt?(prompt: string, cwd?: string): Promise<string | null>;
}

// --- Path Filtering (shared across all adapters) ---

const SKIP_PATTERNS = [
  /node_modules\//,
  /\.git\//,
  /\.DS_Store/,
  /\.swp$/,
  /\.tmp$/,
  /~$/,
  /\/\.claude\/todos\//,
  /\/\.claude\/plans\//,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.gitignore$/,
  /\.env\.example$/,
  /\.eslintrc/,
  /tsconfig\.json$/,
  /bun\.lock$/,
];

/** Low-signal files that inflate via frequent commits but rarely help with tasks */
const LOW_SIGNAL_BASENAMES = new Set([
  "package.json",
  ".gitignore",
  ".env",
  ".env.example",
  ".env.dev",
  ".env.dev-local-server",
  "tsconfig.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  ".eslintrc.js",
  ".prettierrc",
  "bun.lock",
]);

export function shouldSkipPath(path: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(path));
}

export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || p.startsWith("~/");
}

/** Resolve ~ to $HOME so neurons use canonical absolute paths */
export function resolvePath(p: string): string {
  if (p.startsWith("~/")) {
    return (process.env.HOME || "/root") + p.slice(1);
  }
  return p;
}

// --- Recording Helper ---

/**
 * Record a batch of AccessEvents into BrainBox.
 * Opens DB, creates engine, records all events, closes DB.
 * Safe to call from any adapter — handles errors silently.
 */
export function recordEvents(events: AccessEvent[], sessionId: string): void {
  if (events.length === 0) return;

  const db = openDb();
  const engine = new HebbianEngine(db, sessionId);

  for (const event of events) {
    engine.record(event.path, event.type, event.context, event.timestamp);
  }

  db.close();
}

// --- Recall Helper ---

export interface RecallOpts {
  type?: "file" | "tool" | "error" | "semantic";
  limit?: number;
  token_budget?: number;
  minConfidence?: number;
  /** Working directory — prioritize files under this path */
  cwd?: string;
}

/**
 * Run neural recall and return formatted output string, or null if
 * no confident results. Used by prompt hooks to inject context.
 *
 * When `cwd` is set, files under that directory are boosted and
 * files outside are demoted — prevents cross-project contamination.
 */
export async function performRecall(
  query: string,
  opts: RecallOpts = {}
): Promise<string | null> {
  const {
    type = "file",
    limit = 5,
    token_budget = 5000,
    minConfidence = 0.5,
    cwd,
  } = opts;

  const db = openDb();
  const sessionId = `recall-${Date.now()}`;
  const engine = new HebbianEngine(db, sessionId);

  // --- Predictive pre-load (v2.2): auto-inject 0-2 files on first message ---
  // Uses consensus: both Hebbian + commit agree, OR single system >= 0.85
  if (!type || type === "file") {
    const isFirst = isFirstMessageInSession();
    if (isFirst) {
      // v5: Capture session intent from first message
      try {
        const intentDb = openDb();
        const intentEngine = new HebbianEngine(intentDb, sessionId);
        intentEngine.setSessionIntent(query.slice(0, 200));
        intentDb.close();
      } catch {
        // Intent capture failed — skip silently
      }

      try {
        const hebbianResults = await engine.recall({ query, type: "file", limit: 5, token_budget });
        const { isCommitLearningEnabled, predictChangeSet } = await import("./commit-learning.js");
        const commitEnabled = isCommitLearningEnabled(db);
        const commitPreds = commitEnabled
          ? await predictChangeSet(query, db, 0.5)
          : [];
        const commitFiles = new Set(commitPreds.flatMap(p => p.files));

        const preload: RecallResult[] = [];
        for (const r of hebbianResults) {
          if (r.neuron.type !== "file") continue;
          // Single system high confidence
          if (r.confidence >= 0.85) {
            preload.push(r);
          } else if (commitFiles.has(r.neuron.path) && r.confidence >= 0.6) {
            // Both systems agree
            preload.push(r);
          }
          if (preload.length >= 2) break;
        }

        if (preload.length > 0) {
          db.close();
          const lines = ["[brainbox] Predictive pre-load (first message):"];
          for (const r of preload) {
            const pct = Math.round(r.confidence * 100);
            const myelin = Math.round(r.neuron.myelination * 100);
            lines.push(`  - ${r.neuron.path} (confidence: ${pct}%, myelin: ${myelin}%)`);
          }
          lines.push("These files are predicted to be relevant based on task intent and history.");

          // Track for anti-recall
          const recalledIds = preload.map(r => r.neuron.id);
          trackRecalledFiles(sessionId, recalledIds);

          return lines.join("\n");
        }
      } catch {
        // Pre-load failed — fall through to normal recall
      }
    }
  }

  // Fetch extra candidates — we filter down after scoping + noise removal
  const fetchLimit = limit * 3;
  const fileResults = await engine.recall({ query, type, limit: fetchLimit, token_budget });

  // Also recall tools — learned MCP/tool preferences for this task type
  const toolResults = await engine.recall({ query, type: "tool", limit: 10, token_budget: 2000 });
  db.close();

  // --- File results ---
  let confident = fileResults.filter((r) => r.confidence >= minConfidence);

  // Remove low-signal files (package.json, .gitignore, etc.)
  confident = confident.filter((r) => {
    if (r.neuron.type !== "file") return true;
    const basename = r.neuron.path.split("/").pop() || "";
    return !LOW_SIGNAL_BASENAMES.has(basename);
  });

  // Project scoping: demote out-of-project files by 70%
  if (cwd) {
    const prefix = cwd.endsWith("/") ? cwd : cwd + "/";
    confident = confident
      .map((r) => ({
        ...r,
        confidence:
          r.neuron.type !== "file" || r.neuron.path.startsWith(prefix)
            ? r.confidence
            : r.confidence * 0.3,
      }))
      .filter((r) => r.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  confident = confident.slice(0, limit);

  // --- Commit change-set predictions (v2.1) ---
  // Merge predictions from commit neurons if enough data exists.
  if ((!type || type === "file") && confident.length < limit) {
    try {
      const { isCommitLearningEnabled, predictChangeSet } = await import("./commit-learning.js");
      const commitDb = openDb();
      if (isCommitLearningEnabled(commitDb)) {
        const predictions = await predictChangeSet(query, commitDb, minConfidence);
        for (const pred of predictions) {
          for (const filePath of pred.files) {
            // Skip if already in Hebbian results
            if (confident.find(r => r.neuron.path === filePath)) continue;

            // Look up the file neuron in DB
            const neuron = commitDb.prepare(
              "SELECT * FROM neurons WHERE path = ? AND type = 'file'"
            ).get(filePath) as any;
            if (!neuron) continue;

            confident.push({
              neuron: {
                ...neuron,
                contexts: typeof neuron.contexts === "string"
                  ? JSON.parse(neuron.contexts) : neuron.contexts,
              },
              confidence: pred.confidence * 0.9, // slight discount vs Hebbian
              activation_path: `commit: "${pred.commitMessage.slice(0, 60)}"`,
              estimated_tokens_saved: 1500,
            });

            if (confident.length >= limit) break;
          }
          if (confident.length >= limit) break;
        }
        confident.sort((a, b) => b.confidence - a.confidence);
        confident = confident.slice(0, limit);
      }
      commitDb.close();
    } catch {
      // Commit learning not available — skip silently
    }
  }

  // --- Tool results (MCP tool suggestions) ---
  // Only surface MCP tools (contain "__") with decent confidence and usage
  const confidentTools = toolResults
    .filter((r) => r.confidence >= minConfidence)
    .filter((r) => r.neuron.path.includes("__") || r.neuron.path.startsWith("zsh:"))
    .filter((r) => r.neuron.access_count >= 3) // must have been used 3+ times
    .slice(0, 3);

  if (confident.length === 0 && confidentTools.length === 0) return null;

  const lines: string[] = [];

  if (confident.length > 0) {
    lines.push("[brainbox] Neural recall for this task:");
    for (const r of confident) {
      const pct = Math.round(r.confidence * 100);
      const path = r.neuron.path;
      const myelin = Math.round(r.neuron.myelination * 100);
      lines.push(`  - ${path} (confidence: ${pct}%, myelin: ${myelin}%)`);
    }
    lines.push(
      "These files were frequently accessed together in similar contexts."
    );
  }

  if (confidentTools.length > 0) {
    lines.push("[brainbox] Preferred tools for this task type:");
    for (const r of confidentTools) {
      const pct = Math.round(r.confidence * 100);
      const tool = r.neuron.path;
      const uses = r.neuron.access_count;
      lines.push(`  - ${tool} (confidence: ${pct}%, used ${uses}x)`);
    }
    lines.push(
      "These tools worked well in similar past contexts. Prefer them over alternatives."
    );
  }

  // v5: Staleness alerts — surface decaying superhighways
  try {
    const alertDb = openDb();
    const alertEngine = new HebbianEngine(alertDb, `alert-${Date.now()}`);
    const stalenessAlert = alertEngine.getStalenessAlerts({ limit: 3, minMyelination: 0.15 });
    alertDb.close();
    if (stalenessAlert) {
      lines.push(`[brainbox] ${stalenessAlert}`);
    }
  } catch {
    // Staleness check failed — skip silently
  }

  // Anti-recall: track which file neurons were recalled this session
  const recalledIds = confident.map(r => r.neuron.id);
  if (recalledIds.length > 0) {
    trackRecalledFiles(sessionId, recalledIds);
  }

  return lines.join("\n");
}

// --- Bash Error Detection (shared across all adapters) ---

const ERROR_PATTERNS: RegExp[] = [
  // Python/Node tracebacks and exceptions
  /(?:Traceback|Error|Exception):\s*(.{10,120})/,
  // HTTP status errors (curl, requests, fetch)
  /(?:HTTP\/\d\.\d\s+[45]\d{2}|status[_\s]?code[:\s]+[45]\d{2})\s*(.*)/i,
  // JSON API error responses
  /"error"\s*:\s*\{[^}]*"message"\s*:\s*"([^"]{10,120})"/,
  /"error"\s*:\s*"([^"]{10,120})"/,
  // Network/connection failures
  /(Connection refused|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ConnectionError|ConnectionResetError).*/i,
  // Build/test failures
  /(?:FAILED|FAIL)\s+(.{5,120})/,
  // Rust compile errors
  /error\[E\d+\]:\s*(.{10,120})/,
  // Swift compile errors
  /error:\s*(.{10,120})/,
  // Generic "Error:" at start of line
  /^Error:\s*(.{10,120})/m,
];

/** Detect error patterns in command output. Returns normalized error string or null. */
export function detectBashError(output: string): string | null {
  if (!output || output.length < 10) return null;

  // Only scan last 2000 chars — errors are usually at the end
  const tail = output.slice(-2000);

  for (const pattern of ERROR_PATTERNS) {
    const match = tail.match(pattern);
    if (match) {
      const raw = (match[1] || match[0]).trim();
      // Normalize: strip volatile parts so similar errors cluster
      const normalized = raw
        .replace(/0x[0-9a-f]+/gi, "0x...")           // memory addresses
        .replace(/\d{10,}/g, "...")                    // timestamps/large numbers
        .replace(/:\d+:\d+/g, ":N:N")                 // line:col references
        .replace(/pid\s*\d+/gi, "pid ...")             // process IDs
        .replace(/\d+\.\d+\.\d+\.\d+:\d+/g, "...:...") // ip:port
        .replace(/port\s*\d+/gi, "port ...")           // port numbers
        .slice(0, 120);
      return normalized;
    }
  }

  return null;
}

// --- Predictive Pre-Load Helper (v2.2) ---

/**
 * Detect if this is likely the first message in a session.
 * Uses anti-recall session state age — if stale (>60s) or absent, it's first.
 */
function isFirstMessageInSession(): boolean {
  try {
    const state = loadAntiRecallState();
    if (!state) return true; // no state = first message
    const age = Date.now() - state.lastUpdate;
    return age > 60_000; // >1 minute since last recall = new session
  } catch {
    return false; // on error, skip pre-load
  }
}

// --- Anti-Recall Session State (persisted between hook invocations) ---

const ANTI_RECALL_DIR = join(process.env.HOME || "~", ".brainbox");
const ANTI_RECALL_FILE = join(ANTI_RECALL_DIR, "session-state.json");

interface AntiRecallState {
  sessionId: string;
  recalled: string[];   // neuron IDs recalled this session
  opened: string[];     // neuron IDs opened this session
  lastUpdate: number;   // epoch ms
}

function loadAntiRecallState(): AntiRecallState | null {
  try {
    if (!existsSync(ANTI_RECALL_FILE)) return null;
    const data = JSON.parse(readFileSync(ANTI_RECALL_FILE, "utf-8"));
    // Stale if >2 hours old (session probably ended)
    if (Date.now() - data.lastUpdate > 2 * 60 * 60 * 1000) return null;
    return data as AntiRecallState;
  } catch {
    return null;
  }
}

function saveAntiRecallState(state: AntiRecallState): void {
  try {
    mkdirSync(ANTI_RECALL_DIR, { recursive: true });
    writeFileSync(ANTI_RECALL_FILE, JSON.stringify(state));
  } catch {
    // Silent — never block hooks
  }
}

/**
 * Track recalled files (called from prompt hook after recall).
 * Adds to the session's recalled set.
 */
export function trackRecalledFiles(sessionId: string, neuronIds: string[]): void {
  const state = loadAntiRecallState() || {
    sessionId,
    recalled: [],
    opened: [],
    lastUpdate: Date.now(),
  };

  // If session changed, apply anti-recall for old session first
  if (state.sessionId !== sessionId && state.recalled.length > 0) {
    applyAntiRecallFromState(state);
    // Start fresh for new session
    state.sessionId = sessionId;
    state.recalled = [];
    state.opened = [];
  }

  for (const id of neuronIds) {
    if (!state.recalled.includes(id)) state.recalled.push(id);
  }
  state.lastUpdate = Date.now();
  saveAntiRecallState(state);
}

/**
 * Track opened files (called from PostToolUse hook on Read/Edit/Write).
 * Adds to the session's opened set.
 */
export function trackOpenedFile(sessionId: string, neuronId: string): void {
  const state = loadAntiRecallState() || {
    sessionId,
    recalled: [],
    opened: [],
    lastUpdate: Date.now(),
  };

  if (state.sessionId !== sessionId && state.recalled.length > 0) {
    applyAntiRecallFromState(state);
    state.sessionId = sessionId;
    state.recalled = [];
    state.opened = [];
  }

  if (!state.opened.includes(neuronId)) state.opened.push(neuronId);
  state.lastUpdate = Date.now();
  saveAntiRecallState(state);
}

/**
 * Apply anti-recall decay from persisted state.
 * Called when session transitions or on explicit flush.
 */
function applyAntiRecallFromState(state: AntiRecallState): void {
  const ignored = state.recalled.filter(id => !state.opened.includes(id));
  if (ignored.length === 0) return;

  try {
    const db = openDb();
    const engine = new HebbianEngine(db, `antirecall-${Date.now()}`);

    // Track what was recalled/opened into the engine, then apply escalated anti-recall
    for (const id of state.recalled) engine.trackRecalled(id);
    for (const id of state.opened) engine.trackOpened(id);
    const result = engine.applyAntiRecallEscalated();

    db.close();

    if (result.weakened > 0) {
      // Log for debugging (file-based, never stdout)
      const logMsg = `[brainbox] Anti-recall (escalated): weakened ${result.weakened} synapses for ${result.ignored.length} ignored files\n`;
      try {
        const logFile = join(ANTI_RECALL_DIR, "antirecall.log");
        appendFileSync(logFile, `${new Date().toISOString()} ${logMsg}`);
      } catch { /* */ }
    }
  } catch {
    // Silent — never block hooks
  }
}

/**
 * Flush anti-recall state (e.g., on session end).
 * Applies decay for any recalled-but-not-opened files.
 */
export function flushAntiRecall(): void {
  const state = loadAntiRecallState();
  if (state && state.recalled.length > 0) {
    applyAntiRecallFromState(state);
    // Clear state
    saveAntiRecallState({
      sessionId: state.sessionId,
      recalled: [],
      opened: [],
      lastUpdate: Date.now(),
    });
  }
}

// --- v5: Project Auto-Tagging ---

/** Auto-tag file neurons based on cwd. Derives project name from last path component. */
export function autoTagProject(cwd: string): void {
  try {
    const projectName = cwd.split("/").filter(Boolean).pop();
    if (!projectName) return;

    const db = openDb();
    const engine = new HebbianEngine(db, `tag-${Date.now()}`);
    engine.tagProject(cwd, projectName);
    db.close();
  } catch {
    // Silent — never block hooks
  }
}

// Re-export types that adapters need
export type { RecallResult, RecallOptions };
