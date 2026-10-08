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
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isCommitLearningEnabled, predictChangeSet } from "./commit-learning.js";
import { matchProcedures, formatProcedures, recordProcedureExposure } from "./procedures.js";
import {
  ARM_LIMIT, INJECTION_CHAR_BUDGET, beginPolicyDecision, compactRecall, flushPolicySession,
  logRecallEvents, markRecallAccess, policyContext, selectPolicyArm,
} from "./policy.js";
import type { Neuron } from "./hebbian.js";
import type Database from "better-sqlite3";

// --- Types ---

export interface AccessEvent {
  type: "file" | "tool" | "error" | "semantic";
  path: string;
  context: string;
  timestamp?: number;
  /** Only actual reads/edits count as recall hits, never search listings. */
  access?: "open" | "edit";
}

export interface DomainAdapter {
  /** Adapter name (e.g. "claude-code", "kilo", "zsh") */
  readonly name: string;

  /** Extract BrainBox events from a raw domain event */
  extractEvents(rawEvent: unknown): AccessEvent[];

  /** Enrich a prompt with neural recall (optional) */
  enrichPrompt?(prompt: string, cwd?: string, sessionId?: string): Promise<string | null>;
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
  let db: Database.Database | undefined;
  try {
    db = openDb();
    db.pragma("busy_timeout = 100");
    const engine = new HebbianEngine(db, sessionId);
    for (const event of events) {
      engine.record(event.path, event.type, event.context, event.timestamp);
      if (event.type === "file" && event.access) {
        markRecallAccess(db, sessionId, `file:${event.path}`, event.access === "edit");
      }
    }
  } catch {
    // Observation must never block the calling agent.
  } finally {
    db?.close();
  }
}

// --- Recall Helper ---

export interface RecallOpts {
  type?: "file" | "tool" | "error" | "semantic";
  limit?: number;
  token_budget?: number;
  minConfidence?: number;
  /** Working directory — prioritize files under this path */
  cwd?: string;
  sessionId?: string;
  maxChars?: number;
  /** Explicit user-requested retrieval bypasses automatic injection gating. */
  policy?: boolean;
}

/**
 * Run neural recall and return formatted output string, or null if
 * no confident results. Used by prompt hooks to inject context.
 *
 * When `cwd` is set, files under that directory are boosted and
 * files outside are demoted — prevents cross-project contamination.
 */
export async function performRecall(query: string, opts: RecallOpts = {}): Promise<string | null> {
  const { type = "file", limit = 5, token_budget = 5000, minConfidence = 0.5, cwd } = opts;
  const sessionId = recallSessionId(opts.sessionId, cwd);
  const maxChars = Math.max(0, Math.min(opts.maxChars ?? INJECTION_CHAR_BUDGET, token_budget * 4));
  let db: Database.Database | undefined;
  try {
    db = openDb();
    db.pragma("busy_timeout = 100");
    // Only idle sessions are flushed implicitly: parallel host sessions retain their feedback window.
    const idleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const priorSessions = db.prepare(`SELECT session_id FROM policy_decisions WHERE finalized=0
      GROUP BY session_id HAVING MAX(ts)<? AND NOT EXISTS (
        SELECT 1 FROM access_log WHERE access_log.session_id=policy_decisions.session_id AND timestamp>=?
      )`).all(idleBefore, idleBefore) as { session_id: string }[];
    for (const previous of priorSessions) flushRecallSession(db, previous.session_id);
    const first = !db.prepare("SELECT 1 FROM policy_decisions WHERE session_id=? AND ts>=? LIMIT 1")
      .get(sessionId, idleBefore);
    const engine = new HebbianEngine(db, sessionId);
    if (first) engine.setSessionIntent(query.slice(0, 200));
    const fileResults = await engine.recall({ query, type, limit: Math.max(5, limit * 3), token_budget });
    const toolResults = type === "file"
      ? await engine.recall({ query, type: "tool", limit: 10, token_budget: 2000 }) : [];
    const prefix = cwd && (cwd.endsWith("/") ? cwd : cwd + "/");
    let confident = fileResults.map(r => ({
      ...r,
      confidence: prefix && r.neuron.type === "file" && !r.neuron.path.startsWith(prefix)
        ? r.confidence * 0.3 : r.confidence,
    })).filter(r => r.confidence >= minConfidence &&
      (r.neuron.type !== "file" || !LOW_SIGNAL_BASENAMES.has(r.neuron.path.split("/").pop() || "")));
    if (type === "file" && confident.length < limit && isCommitLearningEnabled(db)) {
      const predictions = await predictChangeSet(query, db, minConfidence);
      for (const prediction of predictions) {
        for (const path of prediction.files) {
          if (prefix && !path.startsWith(prefix) || confident.some(r => r.neuron.path === path)) continue;
          const row = db.prepare("SELECT * FROM neurons WHERE path=? AND type='file'").get(path) as (Omit<Neuron, "contexts"> & { contexts: string }) | undefined;
          if (!row || LOW_SIGNAL_BASENAMES.has(path.split("/").pop() || "")) continue;
          confident.push({ neuron: { ...row, contexts: JSON.parse(row.contexts) as string[] },
            confidence: prediction.confidence * 0.9, activation_path: `commit: ${prediction.commitMessage.slice(0, 60)}`,
            estimated_tokens_saved: 1500 });
          if (confident.length >= limit) break;
        }
        if (confident.length >= limit) break;
      }
    }
    const tools = toolResults.filter(r => r.confidence >= minConfidence && r.neuron.access_count >= 3 &&
      (r.neuron.path.includes("__") || r.neuron.path.startsWith("zsh:"))).slice(0, 3);
    confident = [...confident, ...tools].sort((a, b) => b.confidence - a.confidence);
    const projectKnown = !!prefix && !!db.prepare("SELECT 1 FROM neurons WHERE path>=? AND path<? LIMIT 1").get(prefix, prefix + "\uffff");
    const contextKey = policyContext(query, confident[0]?.confidence ?? 0, projectKnown, first);
    const learn = opts.policy !== false && process.env.BRAINBOX_POLICY !== "off";
    const arm = selectPolicyArm(db, contextKey, learn);
    const selected: RecallResult[] = [];
    const injectionLimit = Math.min(limit, ARM_LIMIT[arm]);
    for (const result of confident) {
      if (selected.length >= injectionLimit) break;
      // Check only candidates about to be shown, refilling slots left by deleted files.
      if (result.neuron.type === "file" && isAbsolutePath(result.neuron.path) &&
        !existsSync(resolvePath(result.neuron.path))) continue;
      selected.push(result);
    }
    const formatted = compactRecall(selected, maxChars);
    let text = formatted.text;
    if (arm !== "SILENT") {
      const recentTools = (db.prepare("SELECT tool_name FROM session_replay WHERE session_id=? ORDER BY seq DESC LIMIT 6")
        .all(sessionId) as { tool_name: string }[]).map(row => row.tool_name).reverse();
      const matches = matchProcedures(db, { query, recentTools, error: /error|exception|fail/i.test(query) ? query : undefined });
      // Format individually so exposure attribution cannot include budget-truncated matches.
      for (const match of matches) {
        const remaining = maxChars - text.length - (text ? 1 : 0);
        const output = formatProcedures([match], remaining);
        if (!output || output.length > remaining) continue;
        text += `${text ? "\n" : ""}${output}`;
        recordProcedureExposure(db, match.procedure.id, sessionId);
      }
    }
    const injectedIds = new Set(formatted.included.map(r => r.neuron.id));
    const seen = new Set<string>();
    const logged = [...confident, ...fileResults, ...toolResults].filter(r => {
      if (seen.has(r.neuron.id)) return false;
      seen.add(r.neuron.id);
      return true;
    });
    db.transaction(() => {
      const decisionId = beginPolicyDecision(db!, sessionId, query, contextKey, arm, text.length, learn);
      logRecallEvents(db!, decisionId, sessionId, query, logged, injectedIds, arm);
    })();
    return text || null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
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


/** Stable fallback joins prompt and tool hooks when a host omits its session id. */
export function recallSessionId(sessionId?: string, cwd?: string): string {
  return sessionId || process.env.BRAINBOX_SESSION_ID ||
    `local-${createHash("sha256").update(cwd || process.cwd()).digest("hex").slice(0, 16)}`;
}

// --- Durable anti-recall and policy session accounting ---

function flushRecallSession(db: Database.Database, sessionId: string): void {
  flushPolicySession(db, sessionId, () => {
    const rows = db.prepare(`SELECT neuron_id, opened, edited, source_from, source_to FROM recall_events
      WHERE session_id=? AND injected=1 AND decision_id IN (SELECT id FROM policy_decisions WHERE finalized=0 AND session_id=?)`)
      .all(sessionId, sessionId) as { neuron_id: string; opened: number; edited: number; source_from: string | null; source_to: string | null }[];
    const engine = new HebbianEngine(db, sessionId);
    for (const row of rows) {
      engine.trackRecalled(row.neuron_id, row.source_from && row.source_to ? { from: row.source_from, to: row.source_to } : undefined);
      if (row.opened || row.edited) engine.trackOpened(row.neuron_id);
    }
    engine.applyAntiRecallEscalated();
  });
}

/** Legacy public entry point now records real, session-scoped SQLite hits. */
export function trackOpenedFile(sessionId: string, neuronId: string, edited = false): void {
  let db: Database.Database | undefined;
  try {
    db = openDb();
    db.pragma("busy_timeout = 100");
    markRecallAccess(db, sessionId, neuronId, edited);
  } catch { /* Hooks fail closed. */ } finally { db?.close(); }
}

/** Flush pending sessions exactly once; history remains available for MCP explanation. */
export function flushAntiRecall(sessionId?: string): void {
  let db: Database.Database | undefined;
  try {
    db = openDb();
    db.pragma("busy_timeout = 100");
    const sessions = sessionId ? [{ session_id: sessionId }]
      : db.prepare("SELECT DISTINCT session_id FROM policy_decisions WHERE finalized=0").all() as { session_id: string }[];
    for (const session of sessions) flushRecallSession(db, session.session_id);
  } catch { /* Never block session shutdown. */ } finally { db?.close(); }
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
