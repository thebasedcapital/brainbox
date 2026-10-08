import type Database from "better-sqlite3";
import {
  embedText,
  cosineSimilarity,
  serializeEmbedding,
  deserializeEmbedding,
  isEmbeddingAvailable,
  EMBEDDING_DIM,
  EMBEDDING_MODEL_ID,
} from "./embeddings.js";
import type { SnippetMatch } from "./snippets.js";
import { searchSnippets } from "./snippets.js";

// --- Constants ---

/** Hebbian learning rate: how much a synapse strengthens per co-access */
const LEARNING_RATE = 0.1;

/** Myelination increment per access (superhighway formation) */
const MYELIN_RATE = 0.02;

/** Max myelination — asymptotic ceiling */
const MYELIN_MAX = 0.95;

/** Daily decay rate for synaptic weights (unused connections weaken) */
const SYNAPSE_DECAY_RATE = 0.02;

/** Daily decay rate for activation levels */
const ACTIVATION_DECAY_RATE = 0.15;

/** Daily decay rate for myelination (slower — superhighways persist) */
const MYELIN_DECAY_RATE = 0.005;

/** Minimum synapse weight before pruning */
const SYNAPSE_PRUNE_THRESHOLD = 0.05;

/** Minimum confidence to return a neural recall result */
const CONFIDENCE_GATE = 0.4;

/** High confidence — skip search entirely */
const HIGH_CONFIDENCE = 0.7;

/** Sequential unique file window size — last N unique files form co-access pairs regardless of time */
const CO_ACCESS_WINDOW_SIZE = 25;

/** Time decay factor — files accessed more recently in the sequence get stronger synapses */
/** Position 0 (most recent) = full strength, position N-1 = weakest */

/** Error neurons get boosted learning rate — errors are high-signal events */
const ERROR_LEARNING_BOOST = 2.0;

/** Hub penalty: files with >N synapses get reduced learning rate (like TF-IDF) */
const HUB_PENALTY_THRESHOLD = 20;
const HUB_PENALTY_FACTOR = 0.5;

/** Max hops for spreading activation (BFS depth limit) */
const MAX_SPREAD_HOPS = 3;

/** Max synapses to traverse per neuron during spreading (prevents graph explosion at scale) */
const MAX_SPREAD_FAN_OUT = 10;

/** Tool neurons get dampened during spreading — prevents Read/Edit/Grep/Bash from dominating */
const TOOL_SPREAD_DAMPENING = 0.3;

/** Anti-recall: base decay per ignored session (10%) */
const ANTI_RECALL_BASE_DECAY = 0.1;

/** Anti-recall: minimum synapse weight floor (prevents permanent forgetting) */
const ANTI_RECALL_FLOOR = 0.1;

/** Fan effect: max out-degree before capping (prevents near-zero fan factors) */
const FAN_DEGREE_CAP = 50;

/** Myelination cap in confidence formula (prevents superhighways from dominating) */
const MYELIN_CAP_IN_CONFIDENCE = 0.5;

/** Source code file extensions — prioritized in recall (v2.1 benchmark fix) */
const SOURCE_CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|py|rs|go|swift|java|c|cpp|h|hpp|rb|kt|scala|zig)$/i;

/** Documentation file extensions — deprioritized in recall */
const DOC_EXTENSIONS = /\.(md|txt|rst|adoc|doc|docx)$/i;

/** Boost for source code files in confidence amplifier (30%) */
const SOURCE_CODE_BOOST = 0.3;

/** Penalty for documentation files in confidence amplifier (15% reduction) */
const DOC_PENALTY = 0.15;

/** Strong synapse weight for explicit error→fix wiring.
 *  Must be high enough that error(~0.5 confidence) × weight × myelination > CONFIDENCE_GATE(0.4)
 *  Math: 0.5 × 0.85 × 1.0 = 0.425 > 0.4 ✓ */
const ERROR_FIX_RESOLVE_WEIGHT = 0.85;

/** Estimated tokens per file read (for token budget modeling) */
const TOKENS_PER_FILE_READ = 1500;

/** Estimated tokens per grep/search call */
const TOKENS_PER_SEARCH = 500;

// --- v3.0 Self-Healing Constants ---

/** SNAP plasticity sigmoid steepness (higher = sharper transition at midpoint) */
const SNAP_STEEPNESS = 8;

/** SNAP plasticity midpoint — synapses above this weight are increasingly frozen */
const SNAP_MIDPOINT = 0.5;

/** Noise bridge decay: weaken noise synapses by 20% per decay cycle */
const NOISE_BRIDGE_DECAY = 0.2;

/** Noise bridge: max co-access count to qualify as noise */
const NOISE_BRIDGE_MAX_CO_ACCESS = 2;

/** Noise bridge: max target activation to qualify */
const NOISE_BRIDGE_MAX_ACTIVATION = 0.1;

/** Noise bridge: max target myelination to qualify */
const NOISE_BRIDGE_MAX_MYELINATION = 0.05;

// --- v3.2 Homeostasis Constants ---

/** Target average myelination — if network avg exceeds this, scale down proportionally */
const HOMEOSTASIS_MYELIN_TARGET = 0.15;

/** Target average synapse weight — if network avg exceeds this, scale down proportionally */
const HOMEOSTASIS_WEIGHT_TARGET = 0.35;

/** Hyperactive threshold multiplier — neurons with access_count > avg * this get dampened */
const HOMEOSTASIS_HYPERACTIVE_MULT = 3;

/** Underactive threshold divisor — neurons with access_count < avg / this get boosted */
const HOMEOSTASIS_UNDERACTIVE_DIV = 3;

/** Hyperactive dampen factor (10% myelination reduction) */
const HOMEOSTASIS_DAMPEN = 0.9;

/** Underactive boost factor (5% myelination increase) */
const HOMEOSTASIS_BOOST = 1.05;

/** Synaptic tag capture window in minutes */
const TAG_CAPTURE_WINDOW_MINUTES = 60;

/** Weight to boost captured tagged synapses to */
const TAG_CAPTURE_WEIGHT = 0.3;

/** Myelination daily decay rate (for staleness projection) */
const MYELIN_DAILY_DECAY = 0.995;

/** Stopwords for keyword extraction from conversation */
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "can", "could", "must", "need", "to", "of",
  "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "it", "its", "this", "that", "these", "those", "i", "me", "my", "we",
  "our", "you", "your", "he", "she", "they", "them", "his", "her",
  "and", "or", "but", "not", "if", "then", "else", "so", "just", "also",
  "up", "out", "about", "like", "what", "how", "when", "where", "which",
  "who", "all", "each", "every", "both", "few", "more", "most", "some",
  "any", "no", "very", "too", "quite", "really", "here", "there",
]);

// --- Types ---

/** Individually ablatable, local-only ranking and learning mechanisms. */
export interface EngineOptions {
  baseLevelActivation: boolean;
  baseLevelDecay: number;
  temporalCandidates: boolean;
  lexicalFts: boolean;
  stdpReverseFactor: number;
  toolNgrams: boolean;
  targetedAntiRecall: boolean;
  degreeNormalizedSpread: boolean;
  embeddings: boolean;
  rankFusion: boolean;
  recencyWeight: number;
  frequencyWeight: number;
  lexicalWeight: number;
  /** Fusion weight for the code-snippet evidence channel; defaults to match lexicalWeight. */
  snippetWeight: number;
  baseLevelWeight: number;
  recurrenceWeight: number;
  hebbianWeight: number;
  sessionRecencyWeight: number;
  toolNgramWeight: number;
  toolRecencyWeight: number;
  toolFrequencyWeight: number;
  toolNgramMinSupport: number;
  /** Development-only channel snapshots; production avoids fitting-only work. */
  captureRankingChannels: boolean;
  /** Deterministic replay clock; omitted in ordinary hook processes. */
  referenceTimeMs?: number;
}

export const DEFAULT_ENGINE_OPTIONS: Readonly<EngineOptions> = Object.freeze({
  baseLevelActivation: true,
  baseLevelDecay: 0.5,
  temporalCandidates: true,
  lexicalFts: true,
  stdpReverseFactor: 0.5,
  toolNgrams: true,
  targetedAntiRecall: true,
  degreeNormalizedSpread: false,
  embeddings: true,
  rankFusion: true,
  recencyWeight: 1,
  frequencyWeight: 2,
  lexicalWeight: 4,
  snippetWeight: 4,
  baseLevelWeight: 0.5,
  recurrenceWeight: 0.2,
  hebbianWeight: 4,
  sessionRecencyWeight: 30,
  toolNgramWeight: 1,
  toolRecencyWeight: 0,
  toolFrequencyWeight: 0.5,
  toolNgramMinSupport: 4,
  captureRankingChannels: false,
});

export interface Neuron {
  id: string;
  type: "file" | "tool" | "error" | "semantic";
  path: string;
  activation: number;
  myelination: number;
  access_count: number;
  last_accessed: string | null;
  created_at: string;
  contexts: string[];
  embedding: Buffer | null;
  project: string | null;       // v5: project tag for filtering
  ignore_streak: number;        // v5: consecutive anti-recall ignores
  embedding_model?: string | null;
}

/** v5: Session summary with intent */
export interface SessionSummary {
  id: string;
  started_at: string;
  ended_at: string | null;
  total_accesses: number;
  tokens_used: number;
  tokens_saved: number;
  hit_rate: number;
  intent: string | null;
}

/** v5: Hub neuron with connectivity info */
export interface HubInfo {
  neuron: Neuron;
  outDegree: number;
  topConnections: { target: Neuron; weight: number }[];
}

/** v5: Stale neuron with decay projection */
export interface StaleNeuron {
  neuron: Neuron;
  daysSinceAccess: number;
  projectedMyelination: number; // what myelin will be after same period of continued inactivity
}

export interface Synapse {
  source_id: string;
  target_id: string;
  weight: number;
  co_access_count: number;
  last_fired: string | null;
}

export interface RecallResult {
  neuron: Neuron;
  confidence: number;       // 0-1: how confident we are this is relevant
  activation_path: string;  // how we got here: 'direct' | 'spread' | 'context' | 'snippet' | 'episodic'
  estimated_tokens_saved: number;
  snippets?: SnippetMatch[];  // v4.0: matching code snippets within this file
  source_edge?: { from: string; to: string };
}

export interface RecallOptions {
  query: string;
  token_budget?: number;    // max tokens to "spend" on recalled files
  limit?: number;           // max results
  type?: Neuron["type"];    // filter by neuron type
  /** Optional fixed candidate universe for leakage-safe offline evaluation. */
  candidatePaths?: ReadonlySet<string>;
}

export interface TokenReport {
  tokens_used: number;      // what you'd spend without BrainBox
  tokens_with_brainbox: number; // what you actually spend
  tokens_saved: number;
  savings_pct: number;
}

/** v3.0: Enhanced decay result with self-healing breakdown */
export interface DecayResult {
  pruned_synapses: number;       // dead + noise + stale synapses removed
  pruned_neurons: number;        // dead neurons removed
  pruned_orphans: number;        // v3.0: orphaned neurons (no connections) removed
  weakened_noise_bridges: number; // v3.0: noise bridge synapses weakened
  homeostasis: HomeostasisResult; // v3.2: homeostasis scaling results
}

/** v3.1: Sleep consolidation result (v3.3: CLS additions) */
export interface ConsolidationResult {
  sessions_replayed: number;     // sessions whose access patterns were replayed
  synapses_strengthened: number; // existing synapses reinforced during replay
  neurons_reviewed: number;      // Ebbinghaus spaced repetition boosts
  neurons_forgotten: number;     // neurons with extra decay (missed review windows)
  patterns_discovered: number;   // cross-session file pairs discovered
  // v3.3 CLS additions:
  temporal_pairs_found: number;  // temporal proximity discoveries
  directional_boosts: number;    // directional synapse adjustments
  triplets_found: number;        // multi-file triplet patterns
  episodic_rows_pruned: number;  // old access_log entries removed
}

/** v3.2: Homeostasis result */
export interface HomeostasisResult {
  myelin_scaled: boolean;        // was global myelin scaling triggered?
  myelin_scale_factor: number;   // 1.0 = no scaling needed
  weight_scaled: boolean;        // was global weight scaling triggered?
  weight_scale_factor: number;   // 1.0 = no scaling needed
  neurons_dampened: number;      // hyperactive neurons dampened
  neurons_boosted: number;       // underactive but valuable neurons boosted
  tags_expired: number;          // expired tags cleared
}

// --- Error normalization & fingerprinting (v2.3) ---

/**
 * Normalize error messages so similar errors cluster to the same neuron.
 * Strips line numbers, variable names, timestamps, hex addresses.
 */
export function normalizeError(errorMsg: string): string {
  return errorMsg
    .replace(/:\d+:\d+/g, ":X:X")              // line:col numbers
    .replace(/\bline \d+/gi, "line X")          // "line 42" references
    .replace(/'[^']*'/g, "'VAR'")               // single-quoted strings
    .replace(/"[^"]*"/g, '"VAR"')               // double-quoted strings
    .replace(/\b0x[0-9a-fA-F]+\b/g, "0xADDR")  // hex addresses
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}[:\d.]*/g, "TIMESTAMP") // ISO timestamps
    .replace(/\b\d{10,13}\b/g, "EPOCH")         // Unix timestamps (10-13 digits)
    .replace(/\bat\s+.*\(.*:\d+:\d+\)/g, "at STACKFRAME") // stack frames
    .trim();
}

/**
 * Extract error fingerprint for category-level matching (v2.3).
 * Groups similar errors into type|operation categories for O(1) lookup.
 * e.g. "TypeError: Cannot read property 'foo' of null" → "TYPE_ERROR|property_access"
 */
export function extractErrorFingerprint(errorMsg: string): {
  type: string;
  operation: string;
  fingerprint: string;
} {
  const msg = errorMsg.trim();

  // Error type patterns (priority order — first match wins)
  const typePatterns: [RegExp, string][] = [
    [/ECONNREFUSED/i, "CONNECTION_REFUSED"],
    [/ETIMEDOUT/i, "CONNECTION_TIMEOUT"],
    [/ENOTFOUND/i, "DNS_FAILURE"],
    [/ENOENT/i, "FILE_NOT_FOUND"],
    [/EACCES|EPERM/i, "PERMISSION_DENIED"],
    [/EMFILE|ENFILE/i, "FD_EXHAUSTION"],
    [/HTTP\/\d\.\d\s+[45]\d{2}|status[_\s]?code[:\s]+[45]\d{2}/i, "HTTP_ERROR"],
    [/TypeError/i, "TYPE_ERROR"],
    [/ReferenceError/i, "REFERENCE_ERROR"],
    [/SyntaxError/i, "SYNTAX_ERROR"],
    [/RangeError/i, "RANGE_ERROR"],
    [/KeyError/i, "KEY_ERROR"],
    [/ValueError/i, "VALUE_ERROR"],
    [/AttributeError/i, "ATTRIBUTE_ERROR"],
    [/ImportError|ModuleNotFoundError/i, "IMPORT_ERROR"],
    [/FileNotFoundError|No such file/i, "FILE_NOT_FOUND"],
    [/PermissionError/i, "PERMISSION_DENIED"],
    [/error\[E\d+\]/i, "RUST_COMPILE_ERROR"],
    [/cannot find module|Module not found/i, "MODULE_NOT_FOUND"],
    [/Cannot read propert|undefined is not|null is not/i, "NULL_REFERENCE"],
    [/out of memory|OOM|heap/i, "OUT_OF_MEMORY"],
    [/timeout|timed? ?out/i, "TIMEOUT"],
    [/assertion|assert/i, "ASSERTION_FAILED"],
    [/Traceback/i, "PYTHON_TRACEBACK"],
  ];

  // Operation patterns
  const opPatterns: [RegExp, string][] = [
    [/Cannot read propert|property.*of (null|undefined)/i, "property_access"],
    [/is not a function|is not callable/i, "function_call"],
    [/is not defined|is not declared/i, "variable_lookup"],
    [/import|require|from\s+['"]/i, "importing"],
    [/reading|read|fetch|load|open/i, "reading"],
    [/writing|write|save|store/i, "writing"],
    [/parsing|parse|JSON\.parse|decode/i, "parsing"],
    [/connect|listen|bind|socket/i, "connecting"],
    [/compil|build|transpil/i, "compiling"],
    [/execut|run|spawn|eval/i, "executing"],
    [/delete|remove|drop|unlink/i, "deleting"],
    [/query|select|insert|update/i, "querying"],
  ];

  let errorType = "GENERIC_ERROR";
  for (const [pattern, type] of typePatterns) {
    if (pattern.test(msg)) { errorType = type; break; }
  }

  let operation = "unknown";
  for (const [pattern, op] of opPatterns) {
    if (pattern.test(msg)) { operation = op; break; }
  }

  return { type: errorType, operation, fingerprint: `${errorType}|${operation}` };
}

// --- Engine ---

export class HebbianEngine {
  private db: Database.Database;
  private sessionId: string;
  private recentAccesses: string[] = []; // ordered unique neuron IDs (most recent last)
  private sessionAccessCount: number = 0; // ordinal access counter for directionality
  private readonly options: EngineOptions;
  private simulatedTimeMs?: number;
  private readonly recalledEdges = new Map<string, { from: string; to: string }[]>();
  private lastRankingChannels: Record<string, readonly string[]> = {};
  private lastRankingSupport: Record<string, number> = {};

  /** Clear the co-access window. Call between logical groups (e.g. git commits) during bootstrap. */
  clearCoAccessWindow(): void {
    this.recentAccesses = [];
  }

  /**
   * Seed a neuron directly (for bootstrap — bypasses co-access window).
   * Creates or updates a neuron without triggering synapse formation.
   */
  seedNeuron(path: string, type: Neuron["type"] = "file", context?: string): void {
    const id = this.neuronId(path, type);
    const now = new Date().toISOString();
    const contexts = context ? [context] : [];
    this.stmts.upsertNeuron.run({
      id, type, path, activation: 0.5, myelination: 0, now,
      contexts: JSON.stringify(contexts),
    });
    this.indexPath(id, path);
  }

  /**
   * Append a context string to an existing neuron's contexts array (v2.1).
   * Used by commit learning to add file lists after seedNeuron creates the neuron.
   */
  appendContext(neuronId: string, context: string): void {
    const neuron = this.stmts.getNeuron.get(neuronId) as Neuron | undefined;
    if (!neuron) return;
    const contexts: string[] = typeof neuron.contexts === "string"
      ? JSON.parse(neuron.contexts) : (neuron.contexts || []);
    if (!contexts.includes(context)) {
      contexts.push(context);
      // Keep contexts bounded (max 15)
      if (contexts.length > 15) contexts.splice(0, contexts.length - 15);
      this.db.prepare("UPDATE neurons SET contexts = ? WHERE id = ?")
        .run(JSON.stringify(contexts), neuronId);
    }
  }

  /**
   * Seed a synapse directly with a specific weight (for bootstrap — bypasses co-access window).
   * Weight is set directly, not added incrementally.
   */
  seedSynapse(pathA: string, pathB: string, weight: number, coAccessCount: number = 1, reverseWeight: number = weight): void {
    const idA = this.neuronId(pathA, "file");
    const idB = this.neuronId(pathB, "file");
    const now = new Date().toISOString();
    const clampedWeight = Math.min(Math.max(weight, 0), 1);
    const clampedReverse = Math.min(Math.max(reverseWeight, 0), 1);

    // Bidirectional
    this.db.prepare(`
      INSERT INTO synapses (source_id, target_id, weight, co_access_count, last_fired, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, target_id) DO UPDATE SET
        weight = MAX(synapses.weight, ?),
        co_access_count = synapses.co_access_count + ?
    `).run(idA, idB, clampedWeight, coAccessCount, now, now, clampedWeight, coAccessCount);

    this.db.prepare(`
      INSERT INTO synapses (source_id, target_id, weight, co_access_count, last_fired, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, target_id) DO UPDATE SET
        weight = MAX(synapses.weight, ?),
        co_access_count = synapses.co_access_count + ?
    `).run(idB, idA, clampedReverse, coAccessCount, now, now, clampedReverse, coAccessCount);
  }
  private toolChain: string[] = []; // Track tool sequence in current session

  // Anti-recall session tracking: which files were recalled vs actually opened
  private recalledThisSession: Set<string> = new Set();
  private openedThisSession: Set<string> = new Set();

  // Prepared statements
  private stmts: Record<string, Database.Statement>;

  constructor(db: Database.Database, sessionId?: string, opts?: Partial<EngineOptions>) {
    this.db = db;
    this.sessionId = sessionId || `session-${Date.now()}`;
    this.options = { ...DEFAULT_ENGINE_OPTIONS, ...opts };
    this.simulatedTimeMs = opts?.referenceTimeMs;
    this.options.stdpReverseFactor = Math.max(0, Math.min(1, this.options.stdpReverseFactor));
    this.options.baseLevelDecay = Math.max(0.01, this.options.baseLevelDecay);
    this.stmts = this.prepareStatements();

    // Create session record
    this.stmts.createSession.run({
      id: this.sessionId,
      now: new Date().toISOString(),
    });

    // Seed recentAccesses from DB — allows cross-invocation Hebbian learning
    // Load last N unique files in access order (most recent last)
    const recentRows = this.db.prepare(`
      SELECT neuron_id FROM access_log
      WHERE session_id = ?
      GROUP BY neuron_id
      ORDER BY MAX(id) DESC
      LIMIT ?
    `).all(this.sessionId, CO_ACCESS_WINDOW_SIZE) as { neuron_id: string }[];
    recentRows.reverse();
    // Rebuild unique sequential window from history
    for (const row of recentRows) {
      const idx = this.recentAccesses.indexOf(row.neuron_id);
      if (idx !== -1) this.recentAccesses.splice(idx, 1); // remove old position
      this.recentAccesses.push(row.neuron_id); // add at end (most recent)
    }
    // Trim to window size
    if (this.recentAccesses.length > CO_ACCESS_WINDOW_SIZE) {
      this.recentAccesses = this.recentAccesses.slice(-CO_ACCESS_WINDOW_SIZE);
    }
    // The aggregate SQL always emits a numeric n; better-sqlite3 does not infer result columns.
    const accessCount = this.db.prepare(
      "SELECT COALESCE(MAX(access_order), 0) AS n FROM access_log WHERE session_id = ?"
    ).get(this.sessionId) as { n: number };
    this.sessionAccessCount = accessCount.n;
    this.toolChain = (this.db.prepare(`
      SELECT n.path FROM access_log a JOIN neurons n ON n.id = a.neuron_id
      WHERE a.session_id = ? AND n.type = 'tool' ORDER BY a.id DESC LIMIT 10
    `).all(this.sessionId) as { path: string }[]).reverse().map(r => r.path);
  }

  private prepareStatements() {
    return {
      getNeuron: this.db.prepare(`SELECT * FROM neurons WHERE id = ?`),
      accessTimes: this.db.prepare(`
        SELECT timestamp FROM access_log WHERE neuron_id = ?
        ORDER BY timestamp DESC LIMIT 50
      `),
      fusionRecency: this.db.prepare(`
        SELECT n.*,
          (SELECT MAX(id) FROM access_log WHERE neuron_id=n.id) AS last_order
        FROM neurons n WHERE n.type=COALESCE(@type,n.type)
          AND (@type='tool' OR n.type!='tool')
          AND (@paths IS NULL OR n.path IN (SELECT value FROM json_each(@paths)))
        ORDER BY n.last_accessed DESC, last_order DESC, n.path LIMIT 100
      `),
      fusionFrequency: this.db.prepare(`
        SELECT * FROM neurons WHERE type=COALESCE(@type,type)
          AND (@type='tool' OR type!='tool')
          AND (@paths IS NULL OR path IN (SELECT value FROM json_each(@paths)))
        ORDER BY access_count DESC,path LIMIT 100
      `),
      searchLexical: this.db.prepare(`
        SELECT n.* FROM neuron_fts JOIN neurons n ON n.rowid = neuron_fts.rowid
        WHERE neuron_fts MATCH @query AND n.type != 'tool'
          AND (@type IS NULL OR n.type = @type)
          AND (@paths IS NULL OR n.path IN (SELECT value FROM json_each(@paths)))
        ORDER BY bm25(neuron_fts, 2.0, 1.0) LIMIT @limit
      `),
      hasSessionLexical: this.db.prepare(`
        SELECT 1 FROM neuron_fts JOIN neurons n ON n.rowid=neuron_fts.rowid
        WHERE neuron_fts MATCH @query AND n.id IN (SELECT value FROM json_each(@seeds))
        LIMIT 1
      `),
      searchPathSubstrings: this.db.prepare(`
        SELECT n.* FROM neuron_path_fts JOIN neurons n ON n.rowid=neuron_path_fts.rowid
        WHERE neuron_path_fts MATCH @query AND n.type != 'tool'
          AND (@type IS NULL OR n.type=@type)
          AND (@paths IS NULL OR n.path IN (SELECT value FROM json_each(@paths)))
        ORDER BY bm25(neuron_path_fts) LIMIT @limit
      `),
      synapseDegree: this.db.prepare("SELECT COUNT(*) AS n FROM synapses WHERE source_id = ?"),
      spreadSynapses: this.db.prepare(`
        SELECT * FROM synapses WHERE source_id = ? ORDER BY weight DESC LIMIT ${MAX_SPREAD_FAN_OUT}
      `),
      spreadDegree: this.db.prepare(`
        SELECT COUNT(*) AS n FROM (SELECT 1 FROM synapses WHERE source_id = ? LIMIT ${FAN_DEGREE_CAP})
      `),
      updatePathTokens: this.db.prepare("UPDATE neurons SET path_tokens = ? WHERE id = ? AND path_tokens != ?"),
      upsertToolNgram: this.db.prepare(`
        INSERT INTO tool_ngrams (suffix, next_id, occurrences) VALUES (?, ?, 1)
        ON CONFLICT(suffix, next_id) DO UPDATE SET occurrences = occurrences + 1
      `),
      predictToolNgram: this.db.prepare(`
        SELECT n.*, g.occurrences, SUM(g.occurrences) OVER () AS total
        FROM tool_ngrams g JOIN neurons n ON n.id = g.next_id
        WHERE g.suffix = @suffix AND (@paths IS NULL OR n.path IN (SELECT value FROM json_each(@paths)))
        ORDER BY g.occurrences DESC, n.id LIMIT @limit
      `),
      directionalPrediction: this.db.prepare(`
        SELECT n.*, MIN(s.weight * (1 + n.myelination), 0.99) AS confidence
        FROM synapses s JOIN neurons n ON n.id=s.target_id
        WHERE s.source_id=@source AND s.weight>=0.3 AND n.type=@type
          AND (@paths IS NULL OR n.path IN (SELECT value FROM json_each(@paths)))
        ORDER BY confidence DESC, s.weight DESC, s.rowid LIMIT @limit
      `),
      getNeuronByPath: this.db.prepare(
        `SELECT * FROM neurons WHERE path = ? AND type = ?`
      ),
      // v3.0: BCM myelination delta computed in TypeScript, passed as @myelination
      // For new neurons: @myelination = 0. For existing: @myelination = BCM-adjusted value.
      upsertNeuron: this.db.prepare(`
        INSERT INTO neurons (id, type, path, activation, myelination, access_count, last_accessed, created_at, contexts)
        VALUES (@id, @type, @path, @activation, @myelination, 1, @now, @now, @contexts)
        ON CONFLICT(id) DO UPDATE SET
          activation = @activation,
          myelination = @myelination,
          access_count = neurons.access_count + 1,
          last_accessed = @now,
          contexts = @contexts
      `),
      updateActivation: this.db.prepare(
        `UPDATE neurons SET activation = @activation WHERE id = @id`
      ),
      getSynapses: this.db.prepare(
        `SELECT * FROM synapses WHERE source_id = ? ORDER BY weight DESC`
      ),
      upsertSynapse: this.db.prepare(`
        INSERT INTO synapses (source_id, target_id, weight, co_access_count, last_fired, created_at)
        VALUES (@source, @target, @weight, 1, @now, @now)
        ON CONFLICT(source_id, target_id) DO UPDATE SET
          weight = MIN(synapses.weight + @delta * (1.0 - synapses.weight), 1.0),
          co_access_count = synapses.co_access_count + 1,
          last_fired = @now
      `),
      logAccess: this.db.prepare(`
        INSERT INTO access_log (neuron_id, session_id, query, timestamp, token_cost, access_order)
        VALUES (@neuron_id, @session_id, @query, @now, @token_cost, @access_order)
      `),
      createSession: this.db.prepare(`
        INSERT OR IGNORE INTO sessions (id, started_at) VALUES (@id, @now)
      `),
      updateSession: this.db.prepare(`
        UPDATE sessions SET
          total_accesses = total_accesses + 1,
          tokens_used = tokens_used + @tokens_used,
          tokens_saved = tokens_saved + @tokens_saved
        WHERE id = @id
      `),
      topByMyelination: this.db.prepare(`
        SELECT * FROM neurons
        WHERE type = COALESCE(@type, type)
          AND (@paths IS NULL OR path IN (SELECT value FROM json_each(@paths)))
        ORDER BY myelination DESC
        LIMIT @limit
      `),
      topByActivation: this.db.prepare(`
        SELECT * FROM neurons
        WHERE type = COALESCE(@type, type) AND activation > 0
        ORDER BY activation DESC
        LIMIT @limit
      `),
      searchByContext: this.db.prepare(`
        SELECT * FROM neurons
        WHERE contexts LIKE @pattern
          AND (@paths IS NULL OR path IN (SELECT value FROM json_each(@paths)))
        ORDER BY myelination DESC
        LIMIT @limit
      `),
      allNeurons: this.db.prepare(`SELECT * FROM neurons ORDER BY myelination DESC`),
      allSynapses: this.db.prepare(`SELECT * FROM synapses ORDER BY weight DESC`),
      // v3.0: Smart tiered pruning — considers weight + staleness + co-access
      pruneSynapses: this.db.prepare(`
        DELETE FROM synapses WHERE
          -- Dead: very low weight AND not recently used
          (weight < ${SYNAPSE_PRUNE_THRESHOLD} AND last_fired < datetime('now', '-7 days'))
          OR
          -- Noise: low weight AND single co-access (incidental overlap)
          (weight < 0.15 AND co_access_count <= 1 AND last_fired < datetime('now', '-3 days'))
          OR
          -- Stale: moderate weight but completely abandoned (30+ days)
          (weight < 0.3 AND last_fired < datetime('now', '-30 days'))
      `),
      // v3.0: Legacy flat prune for fresh synapses (keeps old behavior for <1 day old)
      pruneSynapsesFlat: this.db.prepare(
        `DELETE FROM synapses WHERE weight < ${SYNAPSE_PRUNE_THRESHOLD}`
      ),
      pruneNeurons: this.db.prepare(`
        DELETE FROM neurons WHERE activation < 0.01 AND myelination < 0.01 AND access_count < 2
      `),
      // v3.0: Prune orphaned neurons (no synapses, low activity)
      pruneOrphans: this.db.prepare(`
        DELETE FROM neurons WHERE type = 'file' AND access_count < 3 AND myelination < 0.05
        AND id NOT IN (SELECT source_id FROM synapses UNION SELECT target_id FROM synapses)
      `),
      // v3.0: Noise bridge detection — synapses connecting to dead-end low-value neurons
      detectNoiseBridges: this.db.prepare(`
        SELECT s.source_id, s.target_id FROM synapses s
        JOIN neurons n ON n.id = s.target_id
        WHERE s.weight < 0.3
          AND s.co_access_count <= ${NOISE_BRIDGE_MAX_CO_ACCESS}
          AND n.activation < ${NOISE_BRIDGE_MAX_ACTIVATION}
          AND n.myelination < ${NOISE_BRIDGE_MAX_MYELINATION}
          AND n.type = 'file'
      `),
      // v3.0: Weaken a specific synapse (for noise bridge decay)
      weakenSynapse: this.db.prepare(`
        UPDATE synapses SET weight = MAX(weight * (1 - @decay), ${SYNAPSE_PRUNE_THRESHOLD})
        WHERE source_id = @source AND target_id = @target
      `),
      // v3.0: Get synapse weight for SNAP plasticity
      getSynapseWeight: this.db.prepare(
        `SELECT weight FROM synapses WHERE source_id = ? AND target_id = ?`
      ),
      decayAll: this.db.prepare(`
        UPDATE neurons SET
          activation = activation * ${1 - ACTIVATION_DECAY_RATE},
          myelination = myelination * ${1 - MYELIN_DECAY_RATE}
      `),
      decaySynapses: this.db.prepare(`
        UPDATE synapses SET weight = weight * ${1 - SYNAPSE_DECAY_RATE}
      `),
      stats: this.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM neurons) as neuron_count,
          (SELECT COUNT(*) FROM synapses) as synapse_count,
          (SELECT COUNT(*) FROM neurons WHERE myelination > 0.5) as superhighways,
          (SELECT COUNT(*) FROM access_log) as total_accesses,
          (SELECT SUM(tokens_saved) FROM sessions) as total_tokens_saved,
          (SELECT AVG(myelination) FROM neurons) as avg_myelination
      `),
      recentAccesses: this.db.prepare(`
        SELECT neuron_id, MAX(timestamp) as last_ts
        FROM access_log
        WHERE session_id = @session_id
        GROUP BY neuron_id
        ORDER BY last_ts DESC
        LIMIT 20
      `),
      updateEmbedding: this.db.prepare(
        `UPDATE neurons SET embedding = @embedding, embedding_model = @model WHERE id = @id`
      ),
      neuronsWithoutEmbedding: this.db.prepare(
        `SELECT * FROM neurons WHERE embedding IS NULL OR embedding_model IS NULL OR embedding_model != '${EMBEDDING_MODEL_ID}'`
      ),
      neuronsWithEmbedding: this.db.prepare(
        `SELECT * FROM neurons WHERE embedding IS NOT NULL AND embedding_model = '${EMBEDDING_MODEL_ID}'`
      ),
      embeddingCoverage: this.db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN embedding IS NOT NULL AND embedding_model = '${EMBEDDING_MODEL_ID}' THEN 1 ELSE 0 END) as embedded
        FROM neurons
      `),
      // v3.2: Homeostasis — global averages
      avgMyelination: this.db.prepare(
        `SELECT AVG(myelination) as avg_myel FROM neurons WHERE type = 'file'`
      ),
      avgWeight: this.db.prepare(
        `SELECT AVG(weight) as avg_weight FROM synapses`
      ),
      avgAccessCount: this.db.prepare(
        `SELECT AVG(access_count) as avg_acc FROM neurons WHERE type = 'file' AND access_count > 0`
      ),
      // v3.2: Homeostasis — global scaling
      scaleMyelination: this.db.prepare(
        `UPDATE neurons SET myelination = myelination * @scale WHERE type = 'file'`
      ),
      scaleWeights: this.db.prepare(
        `UPDATE synapses SET weight = weight * @scale`
      ),
      // v3.2: Homeostasis — per-neuron dampening/boosting
      dampenHyperactive: this.db.prepare(`
        UPDATE neurons SET myelination = myelination * ${HOMEOSTASIS_DAMPEN}
        WHERE type = 'file' AND access_count > @threshold
      `),
      boostUnderactive: this.db.prepare(`
        UPDATE neurons SET myelination = MIN(myelination * ${HOMEOSTASIS_BOOST}, ${MYELIN_MAX})
        WHERE type = 'file' AND access_count < @threshold AND myelination > 0.05
      `),
      // v3.2: Synaptic tagging — find tagged synapses connected to a neuron within capture window
      getTaggedSynapses: this.db.prepare(`
        SELECT source_id, target_id, weight FROM synapses
        WHERE (source_id = @neuronId OR target_id = @neuronId)
          AND tagged_at IS NOT NULL
          AND tagged_at > @cutoff
      `),
      // v3.2: Synaptic tagging — capture (boost weight, clear tag)
      captureSynapse: this.db.prepare(`
        UPDATE synapses SET weight = MAX(weight, @weight), tagged_at = NULL
        WHERE source_id = @source AND target_id = @target
      `),
      // v3.2: Synaptic tagging — clear expired tags
      clearExpiredTags: this.db.prepare(`
        UPDATE synapses SET tagged_at = NULL
        WHERE tagged_at IS NOT NULL AND tagged_at < datetime('now', '-${TAG_CAPTURE_WINDOW_MINUTES} minutes')
      `),
      // v3.2: Synaptic tagging — set tag on a synapse
      tagSynapse: this.db.prepare(`
        UPDATE synapses SET tagged_at = @now
        WHERE source_id = @source AND target_id = @target AND tagged_at IS NULL
      `),
    };
  }

  // --- v3.0: BCM Sliding Threshold ---

  /**
   * Compute myelination delta using BCM-inspired sliding threshold.
   * High myelination → diminishing returns (prevents runaway).
   * High access count → diminishing returns (hub dampening).
   * New patterns (low myelin, low access) strengthen quickly.
   */
  private computeMyelinDelta(currentMyelin: number, accessCount: number): number {
    // BCM factor: 1.0 at 0% myelination, 0.0 at MYELIN_MAX (95%)
    const bcmFactor = 1 - (currentMyelin / MYELIN_MAX);

    // Access count dampening: 1/sqrt(n) — prevents hubs from accumulating
    const accessDampening = 1 / Math.sqrt(Math.max(accessCount, 1));

    // Floor at 10% of base rate — even superhighways get micro-reinforcement
    return MYELIN_RATE * bcmFactor * Math.max(accessDampening, 0.1);
  }

  /**
   * v3.0 SNAP: Sigmoidal plasticity rate for synapse updates.
   * Strong synapses (>0.6) are nearly frozen. Weak synapses (<0.3) are very plastic.
   * Returns a multiplier in (0, 1).
   */
  private snapPlasticity(currentWeight: number): number {
    return 1 / (1 + Math.exp(SNAP_STEEPNESS * (currentWeight - SNAP_MIDPOINT)));
  }

  // --- Core: Record an access (the learning event) ---

  record(
    path: string,
    type: Neuron["type"] = "file",
    query?: string,
    simulatedTimeMs?: number  // for simulation: override timestamp
  ): Neuron {
    const effectiveMs = simulatedTimeMs ?? this.simulatedTimeMs ?? Date.now();
    if (simulatedTimeMs !== undefined) this.simulatedTimeMs = simulatedTimeMs;
    const now = new Date(effectiveMs).toISOString();
    const id = this.neuronId(path, type);

    // Get existing neuron or create
    const existing = this.stmts.getNeuron.get(id) as Neuron | undefined;
    const rawCtx = existing?.contexts;
    const contexts: string[] = typeof rawCtx === "string" ? JSON.parse(rawCtx) : (rawCtx || []);
    if (query && !contexts.includes(query)) {
      contexts.push(query);
      // Keep only last 20 contexts
      if (contexts.length > 20) contexts.shift();
    }

    // Upsert neuron — v3.0: BCM sliding threshold for myelination
    if (existing) {
      // Existing neuron: compute BCM-adjusted myelination delta
      const myelinDelta = this.computeMyelinDelta(existing.myelination, existing.access_count);
      const newMyelin = Math.min(existing.myelination + myelinDelta, MYELIN_MAX);
      this.stmts.upsertNeuron.run({
        id, type, path,
        activation: 1.0,
        myelination: newMyelin, // BCM delta applied in TypeScript, not SQL
        now,
        contexts: JSON.stringify(contexts),
      });
    } else {
      // New neuron: start at 0 myelination, SQL INSERT path
      this.stmts.upsertNeuron.run({
        id, type, path,
        activation: 1.0,
        myelination: 0,
        now,
        contexts: JSON.stringify(contexts),
      });
    }
    this.indexPath(id, path);

    // Log the access
    this.sessionAccessCount++;
    this.stmts.logAccess.run({
      neuron_id: id,
      session_id: this.sessionId,
      query: query || null,
      now,
      token_cost: type === "file" ? TOKENS_PER_FILE_READ : TOKENS_PER_SEARCH,
      access_order: this.sessionAccessCount,
    });

    // --- Hebbian learning: strengthen synapses with recently co-accessed neurons ---
    // Sequential window: connect to last N unique files, strength decays by position (not time)
    // Position 0 = oldest in window (weakest), position N-1 = most recent (strongest)
    for (let i = 0; i < this.recentAccesses.length; i++) {
      const recentId = this.recentAccesses[i];
      if (recentId === id) continue;

      // Positional decay: most recent file in window = full strength, oldest = weakest
      const positionFactor = (i + 1) / this.recentAccesses.length; // 0.1..1.0

      // Error neurons get boosted learning — errors are high-signal events
      const recentNeuron = this.stmts.getNeuron.get(recentId) as Neuron | undefined;
      const involvesError = type === "error" || recentNeuron?.type === "error";
      let rate = involvesError ? LEARNING_RATE * ERROR_LEARNING_BOOST : LEARNING_RATE;

      // Hub penalty: files with many connections get reduced learning rate (like TF-IDF)
      // COUNT(*) always returns one numeric row; Statement's library type erases its SQL schema.
      const currentDegree = this.stmts.synapseDegree.get(id) as { n: number };
      const recentDegree = this.stmts.synapseDegree.get(recentId) as { n: number };
      if (currentDegree.n > HUB_PENALTY_THRESHOLD || recentDegree.n > HUB_PENALTY_THRESHOLD) {
        rate *= HUB_PENALTY_FACTOR;
      }

      const baseDelta = rate * positionFactor;

      // v3.0 SNAP: Apply sigmoidal plasticity — strong synapses resist further strengthening
      const fwdWeight = (this.stmts.getSynapseWeight.get(id, recentId) as { weight: number } | undefined)?.weight ?? 0;
      const revWeight = (this.stmts.getSynapseWeight.get(recentId, id) as { weight: number } | undefined)?.weight ?? 0;
      // Earlier → later gets the full update; later → earlier gets reduced STDP credit.
      const fwdDelta = baseDelta * this.snapPlasticity(fwdWeight) * this.options.stdpReverseFactor;
      const revDelta = baseDelta * this.snapPlasticity(revWeight);

      this.stmts.upsertSynapse.run({
        source: id,
        target: recentId,
        weight: fwdDelta,
        delta: fwdDelta,
        now,
      });
      this.stmts.upsertSynapse.run({
        source: recentId,
        target: id,
        weight: revDelta,
        delta: revDelta,
        now,
      });

      // v3.2: Tag newly created synapses (weight was 0 before = synapse didn't exist)
      if (fwdWeight === 0) {
        this.stmts.tagSynapse.run({ source: id, target: recentId, now });
      }
      if (revWeight === 0) {
        this.stmts.tagSynapse.run({ source: recentId, target: id, now });
      }
    }

    // v3.2: Synaptic capture — check if this access confirms any tagged synapses
    // If a tagged synapse connects to this neuron and is within the capture window, boost it
    const tagged = this.stmts.getTaggedSynapses.all({
      neuronId: id, cutoff: new Date(effectiveMs - TAG_CAPTURE_WINDOW_MINUTES * 60_000).toISOString(),
    }) as {
      source_id: string; target_id: string; weight: number;
    }[];
    for (const syn of tagged) {
      // captureSynapse uses MAX(weight, @weight) — preserves if already strong, boosts if weak
      // Also clears tagged_at = NULL
      this.stmts.captureSynapse.run({
        source: syn.source_id, target: syn.target_id,
        weight: TAG_CAPTURE_WEIGHT * (syn.source_id === id ? this.options.stdpReverseFactor : 1),
      });
    }

    // Track this access in sequential window (unique — remove old position if exists)
    const existingIdx = this.recentAccesses.indexOf(id);
    if (existingIdx !== -1) this.recentAccesses.splice(existingIdx, 1);
    this.recentAccesses.push(id);
    if (this.recentAccesses.length > CO_ACCESS_WINDOW_SIZE) {
      this.recentAccesses.shift(); // drop oldest
    }

    // Track tool chain for sequence prediction
    if (type === "tool") {
      for (let n = 1; n <= Math.min(3, this.toolChain.length); n++) {
        this.stmts.upsertToolNgram.run(JSON.stringify(this.toolChain.slice(-n)), id);
      }
      this.toolChain.push(path);
      if (this.toolChain.length > 10) this.toolChain.shift();
    }

    // Update session stats
    this.stmts.updateSession.run({
      id: this.sessionId,
      tokens_used: type === "file" ? TOKENS_PER_FILE_READ : TOKENS_PER_SEARCH,
      tokens_saved: 0,
    });

    // Track opened files for anti-recall session tracking
    if (type === "file") {
      this.openedThisSession.add(id);
    }

    // Auto-embed new neurons (fire-and-forget — never blocks record())
    const recorded = this.stmts.getNeuron.get(id) as Neuron;
    if (isEmbeddingAvailable() && !recorded.embedding) {
      this.embedNeuron(id).catch(() => {});
    }

    return recorded;
  }

  // --- Error→Fix pair learning ---

  /**
   * Record an error and immediately recall related fix files.
   * The error message is normalized so similar errors cluster to the same neuron.
   * Returns the error neuron and potential fix file suggestions.
   */
  async recordError(
    errorMsg: string,
    query?: string,
    simulatedTimeMs?: number
  ): Promise<{ errorNeuron: Neuron; potentialFixes: RecallResult[] }> {
    const normalized = normalizeError(errorMsg);
    const errorNeuron = this.record(normalized, "error", query, simulatedTimeMs);

    // v2.3: Also record under fingerprint for category-level matching
    const { fingerprint } = extractErrorFingerprint(errorMsg);
    const fingerprintNeuron = this.record(fingerprint, "error", normalized, simulatedTimeMs);
    // Wire fingerprint ↔ normalized error (strong bidirectional synapse)
    const normalizedId = this.neuronId(normalized, "error");
    const fingerprintId = this.neuronId(fingerprint, "error");
    if (normalizedId !== fingerprintId) {
      const now = new Date().toISOString();
      this.stmts.upsertSynapse.run({
        source: normalizedId, target: fingerprintId,
        weight: ERROR_FIX_RESOLVE_WEIGHT, delta: LEARNING_RATE * ERROR_LEARNING_BOOST, now,
      });
      this.stmts.upsertSynapse.run({
        source: fingerprintId, target: normalizedId,
        weight: ERROR_FIX_RESOLVE_WEIGHT, delta: LEARNING_RATE * ERROR_LEARNING_BOOST, now,
      });
    }

    // Recall files that might fix this error (general recall)
    const potentialFixes = await this.recall({
      query: normalized,
      type: "file",
      limit: 5,
      token_budget: 5000,
    });

    // Also check error→fix synapses directly (resolveError wiring).
    // recall() with type:"file" skips the error neuron as a seed,
    // so resolved fix files won't be found via spreading. Check explicitly.
    // Check both normalized and fingerprint synapses.
    const errorId = this.neuronId(normalized, "error");
    const errorSynapses = this.stmts.getSynapses.all(errorId) as Synapse[];
    for (const syn of errorSynapses) {
      if (syn.weight < 0.3) continue;
      const target = this.stmts.getNeuron.get(syn.target_id) as Neuron | undefined;
      if (!target || target.type !== "file") continue;
      if (potentialFixes.find(r => r.neuron.id === target.id)) continue; // already found

      const confidence = Math.min(syn.weight * (1 + target.myelination), 0.99);
      if (confidence < CONFIDENCE_GATE) continue;

      potentialFixes.push({
        neuron: this.parseNeuron(target),
        confidence,
        activation_path: `error→fix (resolved)`,
        estimated_tokens_saved: TOKENS_PER_SEARCH + TOKENS_PER_FILE_READ,
      });
    }

    potentialFixes.sort((a, b) => b.confidence - a.confidence);

    return { errorNeuron, potentialFixes };
  }

  /**
   * Wire an error to its fix files with strong synapses.
   * Call AFTER fixing a bug to teach BrainBox the error→fix pattern.
   * Creates bidirectional synapses at 4x base learning rate.
   */
  resolveError(
    errorMsg: string,
    fixPaths: string[],
    context?: string
  ): { errorNeuron: Neuron; fixNeurons: Neuron[] } {
    const normalized = normalizeError(errorMsg);
    const errorId = this.neuronId(normalized, "error");
    const now = new Date().toISOString();

    // Ensure error neuron exists
    let errorNeuron = this.stmts.getNeuron.get(errorId) as Neuron | undefined;
    if (!errorNeuron) {
      this.record(normalized, "error", context);
    }

    const fixNeurons: Neuron[] = [];

    for (const fixPath of fixPaths) {
      // Record the fix file (normal Hebbian learning)
      const fixNeuron = this.record(fixPath, "file", context);
      fixNeurons.push(fixNeuron);

      const fixId = this.neuronId(fixPath, "file");

      // Create STRONG bidirectional synapses: error ↔ fix
      this.stmts.upsertSynapse.run({
        source: errorId,
        target: fixId,
        weight: ERROR_FIX_RESOLVE_WEIGHT,
        delta: ERROR_FIX_RESOLVE_WEIGHT,
        now,
      });
      this.stmts.upsertSynapse.run({
        source: fixId,
        target: errorId,
        weight: ERROR_FIX_RESOLVE_WEIGHT,
        delta: ERROR_FIX_RESOLVE_WEIGHT,
        now,
      });
    }

    // v2.3: Also wire fingerprint → fix files for category-level matching
    const { fingerprint } = extractErrorFingerprint(errorMsg);
    const fingerprintId = this.neuronId(fingerprint, "error");
    if (fingerprintId !== errorId) {
      // Ensure fingerprint neuron exists
      if (!this.stmts.getNeuron.get(fingerprintId)) {
        this.record(fingerprint, "error", context);
      }
      for (const fixPath of fixPaths) {
        const fixId = this.neuronId(fixPath, "file");
        this.stmts.upsertSynapse.run({
          source: fingerprintId, target: fixId,
          weight: ERROR_FIX_RESOLVE_WEIGHT, delta: ERROR_FIX_RESOLVE_WEIGHT, now,
        });
      }
    }

    return {
      errorNeuron: this.stmts.getNeuron.get(errorId) as Neuron,
      fixNeurons,
    };
  }

  // --- Tool sequence prediction ---

  /**
   * Predict the next likely tool based on learned tool sequences.
   * Also predicts likely files to be accessed with that tool.
   */
  private predictHebbian(
    currentTool?: string,
    candidateTools?: ReadonlySet<string>,
    limit: number = 3
  ): { nextTools: RecallResult[]; likelyFiles: RecallResult[] } {
    const toolContext =
      currentTool || this.toolChain[this.toolChain.length - 1];

    if (!toolContext) {
      return { nextTools: [], likelyFiles: [] };
    }

    const currentNeuronId = this.neuronId(toolContext, "tool");
    const candidateToolsJson = candidateTools ? JSON.stringify([...candidateTools]) : null;

    const nextTools: RecallResult[] = [];
    if (this.options.toolNgrams) {
      const chain = [...this.toolChain];
      if (chain[chain.length - 1] !== toolContext) chain.push(toolContext);
      for (let n = Math.min(3, chain.length); n >= 1; n--) {
        const matches = this.stmts.predictToolNgram.all({
          limit,
          suffix: JSON.stringify(chain.slice(-n)), paths: candidateToolsJson,
        }) as (Neuron & { occurrences: number; total: number })[];
        if (matches.length === 0) continue;
        if (matches[0].total < this.options.toolNgramMinSupport) continue;
        for (const row of matches) {
          nextTools.push({
            neuron: this.parseNeuron(row), confidence: row.occurrences / row.total,
            activation_path: `tool ${n}-gram after ${chain.slice(-n).join(" → ")}`,
            estimated_tokens_saved: TOKENS_PER_SEARCH,
          });
        }
        break;
      }
    }
    const likelyFiles: RecallResult[] = [];
    for (const type of ["file", "tool"] as const) {
      if (type === "tool" && nextTools.length > 0) continue;
      const matches = this.stmts.directionalPrediction.all({
        source: currentNeuronId, type, paths: type === "tool" ? candidateToolsJson : null,
        limit: type === "tool" ? limit : 5,
      }) as (Neuron & { confidence: number })[];
      for (const target of matches) {
        const result: RecallResult = {
          neuron: this.parseNeuron(target), confidence: target.confidence,
          activation_path: `sequence after ${toolContext}`,
          source_edge: { from: currentNeuronId, to: target.id },
          estimated_tokens_saved: type === "file" ? TOKENS_PER_FILE_READ : TOKENS_PER_SEARCH,
        };
        if (type === "tool") nextTools.push(result);
        else likelyFiles.push(result);
      }
    }

    return { nextTools, likelyFiles };
  }

  /** Offline fitting sees only pre-target channel ranks, never future accesses or labels. */
  getLastRankingChannels(): Readonly<Record<string, readonly string[]>> {
    return this.lastRankingChannels;
  }

  /**
   * Fraction of the distinct query terms present verbatim (unstemmed) in the
   * neuron's raw text — its path plus recorded contexts. A term that matches only
   * through the porter stemmer (e.g. activation vs activity) does not count.
   */
  private queryTermCoverage(neuron: Neuron, terms: readonly string[]): number {
    if (terms.length === 0) return 1;
    const contexts = typeof neuron.contexts === "string" ? neuron.contexts : neuron.contexts.join(" ");
    const raw = `${neuron.path}\n${contexts}`.toLowerCase();
    const matched = terms.filter(term => raw.includes(term)).length;
    return matched / terms.length;
  }

  getLastRankingChannelSupport(): Readonly<Record<string, number>> {
    return this.lastRankingSupport;
  }

  predictNext(currentTool?: string, candidateTools?: ReadonlySet<string>): { nextTools: RecallResult[]; likelyFiles: RecallResult[] } {
    if (!this.options.rankFusion) return this.predictHebbian(currentTool, candidateTools);
    const paths = candidateTools ? JSON.stringify([...candidateTools]) : null;
    const recency = this.stmts.fusionRecency.all({ type: "tool", paths }) as Neuron[];
    const frequency = this.stmts.fusionFrequency.all({ type: "tool", paths }) as Neuron[];
    const classic = this.predictHebbian(currentTool, candidateTools, 100);
    const channels: Record<string, Neuron[]> = {
      recency, frequency, ngram: classic.nextTools.map(result => result.neuron),
    };
    this.lastRankingSupport = {};
    const toolContext = currentTool ?? this.toolChain[this.toolChain.length - 1];
    if (toolContext && this.options.toolNgrams && this.options.captureRankingChannels) {
      const chain = [...this.toolChain];
      if (chain[chain.length - 1] !== toolContext) chain.push(toolContext);
      for (let n = 1; n <= Math.min(3, chain.length); n++) {
        const matches = this.stmts.predictToolNgram.all({
          suffix: JSON.stringify(chain.slice(-n)), paths, limit: 100,
        }) as (Neuron & { total: number })[];
        channels[`ngram${n}`] = matches;
        this.lastRankingSupport[`ngram${n}`] = matches[0]?.total ?? 0;
      }
      channels.transition = this.stmts.directionalPrediction.all({
        source: this.neuronId(toolContext, "tool"), type: "tool", paths, limit: 100,
      }) as Neuron[];
    }
    this.lastRankingChannels = this.options.captureRankingChannels
      ? Object.fromEntries(Object.entries(channels).map(([name, neurons]) => [name, neurons.map(neuron => neuron.path)]))
      : {};
    const weights = {
      recency: this.options.toolRecencyWeight,
      frequency: this.options.toolFrequencyWeight,
      ngram: this.options.toolNgramWeight,
    };
    const candidates = new Map<string, { neuron: Neuron; score: number }>();
    for (const [name, weight] of Object.entries(weights)) {
      if (weight <= 0) continue;
      for (const [rank, neuron] of channels[name].entries()) {
        const candidate = candidates.get(neuron.id) ?? { neuron, score: 0 };
        candidate.score += weight / (20 + rank + 1);
        candidates.set(neuron.id, candidate);
      }
    }
    const maximum = Object.values(weights).reduce((sum, weight) => sum + Math.max(0, weight) / 21, 0);
    const classicById = new Map(classic.nextTools.map(result => [result.neuron.id, result]));
    const nextTools = [...candidates.values()].sort((a, b) => b.score - a.score || a.neuron.path.localeCompare(b.neuron.path))
      .slice(0, 3).map(candidate => ({
        neuron: this.parseNeuron(candidate.neuron),
        confidence: Math.min(0.99, candidate.score / Math.max(maximum, Number.EPSILON)),
        activation_path: classicById.get(candidate.neuron.id)?.activation_path ?? "tool rank fusion",
        estimated_tokens_saved: TOKENS_PER_SEARCH,
      }));
    return { nextTools, likelyFiles: classic.likelyFiles };
  }

  async recall(opts: RecallOptions): Promise<RecallResult[]> {
    let finalResults: RecallResult[];
    if (!this.options.rankFusion) {
      finalResults = await this.recallHebbian(opts);
      this.lastRankingChannels = { hebbian: finalResults.map(result => result.neuron.path) };
    } else {
      const { query, type, limit = 5, token_budget = 10000 } = opts;
      const paths = opts.candidatePaths ? JSON.stringify([...opts.candidatePaths]) : null;
      const queryEmbedding = this.options.embeddings ? await embedText(query) : null;
      const hebbian = await this.recallHebbian({ ...opts, limit: 100, token_budget: Number.MAX_SAFE_INTEGER }, queryEmbedding);
      const terms = query.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const coverageTerms = [...new Set(terms.filter(term => term.length > 2))];
      const expression = coverageTerms.map(term => `"${term}"*`).join(" OR ");
      const lexical = this.options.lexicalFts && expression ? this.stmts.searchLexical.all({
        query: expression, type: type ?? null, paths, limit: 100,
      }) as Neuron[] : [];
      // Code snippets are first-class fusion evidence, weighted like lexical matches.
      const snippetFiles: Neuron[] = [];
      if (this.options.snippetWeight > 0 && (!type || type === "file")) {
        try {
          const seenParents = new Set<string>();
          for (const match of searchSnippets(this.db, query, queryEmbedding, 20)) {
            if (opts.candidatePaths && !opts.candidatePaths.has(match.snippet.path)) continue;
            if (seenParents.has(match.snippet.parent_neuron_id)) continue;
            seenParents.add(match.snippet.parent_neuron_id);
            const parent = this.stmts.getNeuron.get(match.snippet.parent_neuron_id) as Neuron | undefined;
            if (parent) snippetFiles.push(parent);
          }
        } catch {
          // Snippet search unavailable (no snippets table, etc.) — skip the channel.
        }
      }
      const recurrence = this.options.temporalCandidates ? this.temporalCandidates(type, 100, paths) : [];
      // Query-blind myelination/popularity belongs in the prior channels, not in
      // the query-conditioned Hebbian channel. Retain genuine semantic matches,
      // lexical matches, snippet matches and the edges reached from those seeds.
      const queryEvidence = hebbian.filter(result =>
        result.activation_path.startsWith("direct") || result.activation_path.startsWith("spread(") ||
        result.activation_path.startsWith("fingerprint:") || result.activation_path.includes("snippet"));
      const channels: Record<string, Neuron[]> = {
        lexical,
        snippet: snippetFiles,
        hebbian: queryEvidence.map(result => result.neuron),
        recurrence: recurrence.map(result => result.neuron),
        recency: this.stmts.fusionRecency.all({ type: type ?? null, paths }) as Neuron[],
        frequency: this.stmts.fusionFrequency.all({ type: type ?? null, paths }) as Neuron[],
      };
      const candidates = new Map<string, { neuron: Neuron; score: number }>();
      for (const neurons of Object.values(channels)) {
        for (const neuron of neurons) {
          if (!candidates.has(neuron.id)) candidates.set(neuron.id, { neuron, score: 0 });
        }
      }
      channels["base-level"] = this.options.baseLevelActivation && (this.options.baseLevelWeight > 0 || this.options.captureRankingChannels)
        ? [...candidates.values()].map(candidate => ({
          neuron: candidate.neuron, activation: this.baseLevelActivation(candidate.neuron.id),
        })).sort((a, b) => b.activation - a.activation || a.neuron.path.localeCompare(b.neuron.path)).map(item => item.neuron)
        : [];
      this.lastRankingChannels = this.options.captureRankingChannels
        ? Object.fromEntries(Object.entries(channels).map(([name, neurons]) => [name, neurons.map(neuron => neuron.path)]))
        : {};
      // An explicit topic switch must not be drowned out by the preceding task's recent files.
      const sessionContext = this.recentAccesses.length > 0 && !!expression && !!this.stmts.hasSessionLexical.get({
        query: expression, seeds: JSON.stringify(this.recentAccesses),
      });
      this.lastRankingSupport = { "session-context": sessionContext ? 1 : 0 };
      const weights: Record<string, number> = {
        recency: sessionContext ? this.options.sessionRecencyWeight : this.options.recencyWeight,
        frequency: this.options.frequencyWeight,
        lexical: this.options.lexicalWeight,
        snippet: this.options.snippetWeight,
        "base-level": this.options.baseLevelWeight,
        recurrence: this.options.recurrenceWeight,
        hebbian: this.options.hebbianWeight,
      };
      for (const [name, weight] of Object.entries(weights)) {
        if (weight <= 0) continue;
        for (const [rank, neuron] of channels[name].entries()) {
          const candidate = candidates.get(neuron.id);
          if (!candidate) continue;
          // Lexical evidence is scaled by distinct-query-term coverage (matched
          // verbatim against the raw text, not the porter stem) so a file matching
          // one term only via stemming cannot outrank a file matching most terms.
          const scaled = name === "lexical" ? weight * this.queryTermCoverage(neuron, coverageTerms) : weight;
          candidate.score += scaled / (20 + rank + 1);
        }
      }
      const metadata = new Map([...recurrence, ...hebbian].map(result => [result.neuron.id, result]));
      for (const neuron of snippetFiles) {
        if (!metadata.has(neuron.id)) metadata.set(neuron.id, {
          neuron, confidence: 0, activation_path: "snippet",
          estimated_tokens_saved: TOKENS_PER_SEARCH + TOKENS_PER_FILE_READ,
        });
      }
      const maximum = Object.values(weights).reduce((sum, weight) => sum + Math.max(0, weight) / 21, 0);
      const supported = lexical.length > 0 || snippetFiles.length > 0 || hebbian.length > 0 || recurrence.length > 0;
      const ranked = supported ? [...candidates.values()].filter(candidate => candidate.score > 0)
        .sort((a, b) => b.score - a.score || a.neuron.path.localeCompare(b.neuron.path)) : [];
      finalResults = [];
      let remaining = token_budget;
      for (const candidate of ranked) {
        if (finalResults.length === limit) break;
        const cost = candidate.neuron.type === "file" ? TOKENS_PER_FILE_READ : TOKENS_PER_SEARCH;
        if (cost > remaining) continue;
        const existing = metadata.get(candidate.neuron.id);
        finalResults.push({
          ...(existing ?? {}),
          neuron: this.parseNeuron(candidate.neuron),
          confidence: Math.min(0.99, 0.4 + 0.6 * candidate.score / Math.max(maximum, Number.EPSILON)),
          activation_path: existing?.activation_path ?? "temporal rank fusion",
          estimated_tokens_saved: existing?.estimated_tokens_saved ?? TOKENS_PER_SEARCH,
        });
        remaining -= cost;
      }
    }
    for (const result of finalResults) {
      if (result.neuron.type === "file") this.trackRecalled(result.neuron.id, result.source_edge);
    }
    return finalResults;
  }

  /** Get the current session's tool chain. */
  getToolChain(): string[] {
    return [...this.toolChain];
  }

  // --- Core: Recall — spreading activation with confidence gating ---

  private async recallHebbian(opts: RecallOptions, precomputedQueryEmbedding?: Float32Array | null): Promise<RecallResult[]> {
    const { query, token_budget = 10000, limit = 5, type } = opts;
    const results: RecallResult[] = [];
    let tokenBudgetRemaining = token_budget;
    const candidatePathsJson = opts.candidatePaths ? JSON.stringify([...opts.candidatePaths]) : null;

    // Pre-compute query embedding (null if embeddings unavailable); the rank-fusion
    // caller shares its embedding so the local model runs once per recall.
    const queryEmbedding = precomputedQueryEmbedding !== undefined
      ? precomputedQueryEmbedding
      : this.options.embeddings ? await embedText(query) : null;

    // --- Phase 0: Error fingerprint fast path (v2.3) ---
    // If query looks like an error, try O(1) fingerprint lookup before any search.
    if (!type || type === "error") {
      const { fingerprint } = extractErrorFingerprint(query);
      const fpId = this.neuronId(fingerprint, "error");
      const fpNeuron = this.stmts.getNeuron.get(fpId) as Neuron | undefined;
      if (fpNeuron) {
        // Found a fingerprint match — traverse its fix synapses directly
        const fpSynapses = this.stmts.getSynapses.all(fpId) as Synapse[];
        for (const syn of fpSynapses) {
          if (syn.weight < 0.3) continue;
          const target = this.stmts.getNeuron.get(syn.target_id) as Neuron | undefined;
          if (!target) continue;
          if (type && target.type !== type) continue;
          if (target.type === "tool") continue;
          if (opts.candidatePaths && !opts.candidatePaths.has(target.path)) continue;

          const confidence = Math.min(syn.weight * (1 + target.myelination), 0.99);
          if (confidence < CONFIDENCE_GATE) continue;

          const tokenCost = target.type === "file" ? TOKENS_PER_FILE_READ : TOKENS_PER_SEARCH;
          if (tokenCost > tokenBudgetRemaining) continue;

          results.push({
            neuron: this.parseNeuron(target),
            confidence,
            activation_path: `fingerprint: ${fingerprint}`,
            source_edge: { from: fpId, to: syn.target_id },
            estimated_tokens_saved: TOKENS_PER_SEARCH + TOKENS_PER_FILE_READ,
          });
          tokenBudgetRemaining -= tokenCost;
        }
      }
    }

    // Indexed lexical candidates: path components/camelCase and stemmed contexts.
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const directMatches: Neuron[] = [];
    const lexicalRanks = new Map<string, number>();
    if (this.options.lexicalFts) {
      const terms = query.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const expression = [...new Set(terms.filter(t => t.length > 2))].map(t => `"${t}"*`).join(" OR ");
      if (expression) {
        const matches = this.stmts.searchLexical.all({
          query: expression, type: type ?? null, paths: candidatePathsJson, limit: 100,
        }) as Neuron[];
        for (const [rank, neuron] of matches.entries()) {
          directMatches.push(neuron);
          lexicalRanks.set(neuron.id, rank);
        }
        const pathExpression = [...new Set(terms.filter(t => t.length >= 4))].map(t => `"${t}"`).join(" OR ");
        if (pathExpression) {
          const pathMatches = this.stmts.searchPathSubstrings.all({
            query: pathExpression, type: type ?? null, paths: candidatePathsJson, limit: 100,
          }) as Neuron[];
          for (const neuron of pathMatches) {
            if (!directMatches.some(existing => existing.id === neuron.id)) directMatches.push(neuron);
          }
        }
      }
    } else {
      for (const keyword of keywords) {
        const matches = this.stmts.searchByContext.all({
          pattern: `%${keyword}%`, paths: candidatePathsJson, limit: 10,
        }) as Neuron[];
        for (const neuron of matches) {
          if (neuron.type !== "tool" && !directMatches.some(d => d.id === neuron.id)) directMatches.push(neuron);
        }
      }
    }

    // --- Phase 1b: Vector similarity scan + filename stem match (v2.1) ---
    // Scans all embedded neurons: admit candidates by embedding similarity OR filename match
    const queryKeywords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    if (queryEmbedding || (!this.options.lexicalFts && queryKeywords.length > 0)) {
      const embeddedNeurons = this.stmts.neuronsWithEmbedding.all() as Neuron[];
      for (const neuron of embeddedNeurons) {
        if (directMatches.find((d) => d.id === neuron.id)) continue; // already found by keywords
        if (type && neuron.type !== type) continue;
        // Tool exclusion: tools are bridges, never results (v1.0)
        if (neuron.type === "tool") continue;

        // Admit by embedding similarity
        let admitted = false;
        if (queryEmbedding && neuron.embedding) {
          const neuronEmb = deserializeEmbedding(neuron.embedding!);
          const sim = cosineSimilarity(queryEmbedding, neuronEmb);
          if (sim > 0.25) admitted = true;
        }

        // Admit by filename stem match (v2.1: prevents source files from being lost)
        if (!admitted && queryKeywords.length > 0) {
          const bname = neuron.path.toLowerCase().split("/").pop() || "";
          const stemLower = bname.replace(/\.[^.]+$/, "");
          if (queryKeywords.some((k) => stemLower.includes(k))) admitted = true;
        }

        if (admitted) directMatches.push(neuron);
      }
    }

    // Score direct matches, sort by confidence, THEN apply token budget (v2.1)
    // Previously budget was applied in discovery order — high-confidence files found
    // late in Phase 1b could be starved by lower-confidence early matches.
    const scoredMatches: RecallResult[] = [];
    for (const neuron of directMatches) {
      if (type && neuron.type !== type) continue;
      if (opts.candidatePaths && !opts.candidatePaths.has(neuron.path)) continue;
      const rank = lexicalRanks.get(neuron.id);
      const confidence = Math.max(this.computeConfidence(neuron, query, "direct", queryEmbedding),
        rank === undefined ? 0 : 0.45 / (1 + rank * 0.01));
      if (confidence < CONFIDENCE_GATE) continue;
      scoredMatches.push({
        neuron, confidence, activation_path: "direct",
        estimated_tokens_saved: TOKENS_PER_SEARCH,
      });
    }
    // Session recurrence competes before budget allocation, not only after lexical slots are filled.
    if (this.options.temporalCandidates) {
      for (const candidate of this.temporalCandidates(type, Math.max(20, limit * 4), candidatePathsJson)) {
        const existing = scoredMatches.find(match => match.neuron.id === candidate.neuron.id);
        if (!existing) scoredMatches.push(candidate);
        else if (candidate.confidence > existing.confidence) Object.assign(existing, candidate);
      }
    }
    scoredMatches.sort((a, b) => b.confidence - a.confidence);

    for (const candidate of scoredMatches) {
      const { neuron } = candidate;
      const tokenCost = neuron.type === "file" ? TOKENS_PER_FILE_READ : TOKENS_PER_SEARCH;
      if (tokenCost > tokenBudgetRemaining) continue;

      results.push({ ...candidate, neuron: this.parseNeuron(neuron) });
      tokenBudgetRemaining -= tokenCost;
    }

    // --- Phase 2: Multi-hop spreading activation (BFS by hop level) ---
    const activated = new Set(results.map((r) => r.neuron.id));

    // Frontier: neurons to spread from, seeded with direct matches
    let frontier: { neuronId: string; confidence: number; chain: string }[] =
      results.map((r) => ({
        neuronId: r.neuron.id,
        confidence: r.confidence,
        chain: r.neuron.path,
      }));
    if (this.options.temporalCandidates) {
      for (const id of this.recentAccesses) {
        if (!frontier.some(seed => seed.neuronId === id)) {
          const seed = this.stmts.getNeuron.get(id) as Neuron | undefined;
          if (seed?.type === "file") frontier.push({ neuronId: id, confidence: 0.65, chain: `session ${seed.path}` });
        }
      }
    }

    for (let hop = 0; hop < MAX_SPREAD_HOPS && frontier.length > 0 && tokenBudgetRemaining > 0; hop++) {
      const nextFrontier: typeof frontier = [];

      for (const seed of frontier) {
        // Bound the indexed read itself, not a JavaScript slice of every incident edge.
        const synapses = this.stmts.spreadSynapses.all(seed.neuronId) as Synapse[];

        // Fan effect (Anderson 1983, ACT-R): divide activation by sqrt(out_degree)
        // Hub neurons with many synapses dilute their signal proportionally
        // The degree cap is applied inside SQLite; the aggregate always returns a numeric n.
        const degree = this.stmts.spreadDegree.get(seed.neuronId) as { n: number };
        const outDegree = degree.n;
        const fanFactor = 1 / Math.pow(Math.max(1, Math.min(outDegree, FAN_DEGREE_CAP)),
          this.options.degreeNormalizedSpread ? 1 : 0.5);

        for (const syn of synapses) {
          if (syn.weight < 0.3) continue; // only strong connections

          const target = this.stmts.getNeuron.get(syn.target_id) as Neuron | undefined;
          if (!target) continue;
          if (type && target.type !== type) continue;
          if (opts.candidatePaths && !opts.candidatePaths.has(target.path)) continue;

          // Tool exclusion: tools are bridges (traverse synapses) but never appear in results (v1.0)
          if (target.type === "tool") continue;

          // Spreading activation: parent confidence * synapse weight * myelination boost * fan effect
          // Myelination capped at MYELIN_CAP_IN_CONFIDENCE to prevent superhighways dominating
          const myelinBoost = 1 + Math.min(target.myelination, MYELIN_CAP_IN_CONFIDENCE);
          const spreadConfidence = seed.confidence * syn.weight * myelinBoost * fanFactor;
          if (spreadConfidence < CONFIDENCE_GATE) continue;

          // Convergence: if already activated, take max confidence (Collins & Loftus)
          // Keep the original activation_path — first discovery is the most direct route
          if (activated.has(syn.target_id)) {
            const existing = results.find((r) => r.neuron.id === syn.target_id);
            if (existing && spreadConfidence > existing.confidence) {
              existing.confidence = Math.min(spreadConfidence, 0.99);
              existing.source_edge = { from: seed.neuronId, to: syn.target_id };
              existing.activation_path = `spread(${hop + 1}) via ${seed.chain}`;
            }
            continue;
          }

          const tokenCost = target.type === "file" ? TOKENS_PER_FILE_READ : TOKENS_PER_SEARCH;
          if (tokenCost > tokenBudgetRemaining) continue;

          const pathLabel = `spread(${hop + 1}) via ${seed.chain}`;
          results.push({
            neuron: this.parseNeuron(target),
            confidence: Math.min(spreadConfidence, 0.99),
            activation_path: pathLabel,
            source_edge: { from: seed.neuronId, to: syn.target_id },
            estimated_tokens_saved: TOKENS_PER_SEARCH + TOKENS_PER_FILE_READ,
          });
          activated.add(syn.target_id);
          tokenBudgetRemaining -= tokenCost;

          // Add to next frontier for deeper spreading
          nextFrontier.push({
            neuronId: syn.target_id,
            confidence: Math.min(spreadConfidence, 0.99),
            chain: `${seed.chain} → ${target.path}`,
          });
        }
      }

      frontier = nextFrontier;
    }

    // --- Phase 3: Top myelinated neurons as fallback (temporal priming) ---
    if (!this.options.temporalCandidates && results.length < limit) {
      const MYELIN_GATE = 0.15; // Lower gate: superhighways earned trust through repeated use
      const topMyelinated = this.stmts.topByMyelination.all({
        type: type || null,
        paths: candidatePathsJson,
        limit: limit - results.length,
      }) as Neuron[];

      for (const neuron of topMyelinated) {
        if (activated.has(neuron.id)) continue;
        // Skip tool neurons in fallback — they add noise when seeking files
        if (neuron.type === "tool") continue;
        const confidence = neuron.myelination * 0.5; // superhighway signal — frequently accessed
        if (confidence < MYELIN_GATE) continue;

        results.push({
          neuron: this.parseNeuron(neuron),
          confidence,
          activation_path: "myelinated",
          estimated_tokens_saved: TOKENS_PER_SEARCH,
        });
        activated.add(neuron.id);
      }
    }

    // v3.3: Merge episodic recall results — query access_log for recent working context
    const episodicResults = this.recallEpisodic(opts.query, Math.min(limit, 3), candidatePathsJson);
    for (const ep of episodicResults) {
      const existingIdx = results.findIndex(r => r.neuron.id === ep.neuron.id);
      if (existingIdx >= 0) {
        // Dedupe: take max confidence, prefer semantic path but note episodic contribution
        if (ep.confidence > results[existingIdx].confidence) {
          results[existingIdx].confidence = ep.confidence;
        }
      } else {
        results.push(ep);
      }
    }

    // v4.0: Merge snippet neuron results (System 2 — semantic code search)
    // FTS5 remains available when embeddings are off; sqlite-vec supplies dense candidates.
    if (!type || type === "file") {
        try {
          const snippetMatches = searchSnippets(this.db, query, queryEmbedding, 20);
          // Aggregate snippet matches to parent file neurons
          const fileSnippets = new Map<string, SnippetMatch[]>();
          for (const sm of snippetMatches) {
            if (opts.candidatePaths && !opts.candidatePaths.has(sm.snippet.path)) continue;
            const list = fileSnippets.get(sm.snippet.parent_neuron_id) || [];
            list.push(sm);
            fileSnippets.set(sm.snippet.parent_neuron_id, list);
          }

          for (const [parentId, matches] of fileSnippets) {
            const bestConf = Math.max(...matches.map(m => m.confidence));
            const existingIdx = results.findIndex(r => r.neuron.id === parentId);

            if (existingIdx >= 0) {
              // Both systems found this file — consensus bonus (15%)
              const boosted = Math.max(results[existingIdx].confidence, bestConf) * 1.15;
              results[existingIdx].confidence = Math.min(boosted, 0.99);
              results[existingIdx].activation_path += " +snippet";
              results[existingIdx].snippets = matches;
            } else {
              // Snippet-only discovery — file not found by Hebbian
              const parentNeuron = this.stmts.getNeuron.get(parentId) as Neuron | undefined;
              if (parentNeuron && parentNeuron.type === "file") {
                if (TOKENS_PER_FILE_READ > tokenBudgetRemaining) continue;
                results.push({
                  neuron: this.parseNeuron(parentNeuron),
                  confidence: bestConf,
                  activation_path: "snippet",
                  estimated_tokens_saved: TOKENS_PER_SEARCH + TOKENS_PER_FILE_READ,
                  snippets: matches,
                });
                tokenBudgetRemaining -= TOKENS_PER_FILE_READ;
              }
            }
          }
        } catch {
          // Snippet search failed (no snippets table, etc.) — silently skip
        }
    }

    // Sort by confidence, limit results
    results.sort((a, b) => b.confidence - a.confidence);
    const finalResults = results.slice(0, limit);

    return finalResults;
  }

  // --- Confidence computation ---

  private nowMs(): number {
    return this.simulatedTimeMs ?? Date.now();
  }

  private indexPath(id: string, path: string): void {
    const tokens = path.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").replace(/[/._-]+/g, " ");
    this.stmts.updatePathTokens.run(tokens, id, tokens);
  }

  /** ACT-R base level in hours, last 50 observations; sigmoid gives a bounded score. */
  baseLevelActivation(neuronId: string, nowMs: number = this.nowMs()): number {
    const times = this.stmts.accessTimes.all(neuronId) as { timestamp: string }[];
    let mass = 0;
    for (const { timestamp } of times) {
      const elapsed = (nowMs - Date.parse(timestamp)) / 3_600_000;
      if (Number.isFinite(elapsed)) mass += Math.pow(Math.max(1 / 60, elapsed), -this.options.baseLevelDecay);
    }
    return mass > 0 ? Math.log(mass) : -Infinity;
  }

  private baseLevelScore(neuron: Neuron): number {
    if (!this.options.baseLevelActivation) {
      return neuron.last_accessed
        ? Math.max(0, 1 - (this.nowMs() - Date.parse(neuron.last_accessed)) / (168 * 3_600_000))
        : 0;
    }
    let level = this.baseLevelActivation(neuron.id);
    // Bootstrap neurons have no access_log: use their single seed observation.
    if (!Number.isFinite(level) && neuron.last_accessed) {
      level = -this.options.baseLevelDecay * Math.log(Math.max(1 / 60,
        (this.nowMs() - Date.parse(neuron.last_accessed)) / 3_600_000));
    }
    return 1 / (1 + Math.exp(-level));
  }

  private temporalCandidates(type: Neuron["type"] | undefined, limit: number, candidatePathsJson: string | null): RecallResult[] {
    const seeds = this.recentAccesses.filter(id => id.startsWith("file:"));
    if (seeds.length === 0) return [];
    const placeholders = seeds.map(() => "?").join(",");
    const rows = this.db.prepare(`
      WITH edges AS (
        SELECT s.*, ROW_NUMBER() OVER (
          PARTITION BY target_id ORDER BY weight DESC, co_access_count DESC, source_id
        ) AS edge_rank
        FROM synapses s WHERE source_id IN (${placeholders}) AND weight >= 0.1
      )
      SELECT n.*, s.weight AS recurrence, s.co_access_count AS repeats,
        (SELECT COUNT(*) FROM synapses d WHERE d.source_id=n.id) AS degree,
        s.source_id AS producing_source
      FROM edges s JOIN neurons n ON n.id=s.target_id
      WHERE s.edge_rank=1 AND n.type != 'tool' AND (? IS NULL OR n.type=?)
        AND (? IS NULL OR n.path IN (SELECT value FROM json_each(?)))
      ORDER BY recurrence DESC, repeats DESC LIMIT ?
    `).all(...seeds, type ?? null, type ?? null, candidatePathsJson, candidatePathsJson, limit) as (Neuron & {
      recurrence: number; repeats: number; degree: number; producing_source: string;
    })[];
    const maxPopularity = Math.max(1, ...rows.map(n => Math.log1p(n.access_count)));
    const scored: RecallResult[] = [];
    for (const neuron of rows) {
      if (seeds.includes(neuron.id)) continue;
      const recurrence = Math.min(1, neuron.recurrence + 0.1 * Math.log1p(neuron.repeats));
      const popularity = Math.log1p(neuron.access_count) / maxPopularity / Math.sqrt(Math.max(1, neuron.degree));
      const confidence = Math.min(0.65, 0.7 * recurrence + 0.1 * popularity + 0.2 * this.baseLevelScore(neuron));
      if (confidence < CONFIDENCE_GATE) continue;
      scored.push({
        neuron: this.parseNeuron(neuron), confidence, activation_path: "temporal session recurrence",
        source_edge: { from: neuron.producing_source, to: neuron.id },
        estimated_tokens_saved: TOKENS_PER_SEARCH,
      });
    }
    return scored.sort((a, b) => b.confidence - a.confidence);
  }

  private antiRecallSynapses(neuronId: string): Synapse[] {
    const edges = this.options.targetedAntiRecall ? this.recalledEdges.get(neuronId) : undefined;
    if (edges?.length) {
      const statement = this.db.prepare("SELECT * FROM synapses WHERE source_id = ? AND target_id = ?");
      return edges.flatMap(edge => {
        const synapse = statement.get(edge.from, edge.to) as Synapse | undefined;
        return synapse ? [synapse] : [];
      });
    }
    return this.db.prepare("SELECT * FROM synapses WHERE source_id = ? OR target_id = ?")
      .all(neuronId, neuronId) as Synapse[];
  }

  private computeConfidence(
    neuron: Neuron,
    query: string,
    path: "direct" | "spread" | "myelinated",
    queryEmbedding?: Float32Array | null
  ): number {
    // v1.0: MULTIPLICATIVE confidence — context is a GATE, not additive.
    // If semantic match is 0, confidence is 0 regardless of myelination/recency.

    const contexts = typeof neuron.contexts === 'string'
      ? JSON.parse(neuron.contexts) as string[]
      : neuron.contexts;

    // Context score: embedding similarity or keyword fallback
    let contextScore = 0;
    if (queryEmbedding && neuron.embedding && neuron.embedding_model === EMBEDDING_MODEL_ID) {
      // Embedding-based: cosine similarity between query and neuron embeddings
      const neuronEmb = deserializeEmbedding(
        neuron.embedding instanceof Buffer ? neuron.embedding : Buffer.from(neuron.embedding)
      );
      contextScore = Math.max(0, cosineSimilarity(queryEmbedding, neuronEmb));
    } else {
      // Keyword fallback: substring matching
      const kwds = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const contextStr = contexts.join(" ").toLowerCase();
      const matchCount = kwds.filter((k) => contextStr.includes(k)).length;
      contextScore = kwds.length > 0 ? matchCount / kwds.length : 0;
    }

    // Myelination bonus (capped to prevent superhighway domination)
    const myelinBonus = Math.min(neuron.myelination, MYELIN_CAP_IN_CONFIDENCE) * 0.3;

    const recencyBonus = this.options.baseLevelActivation
      ? 0.2 * this.baseLevelScore(neuron)
      : (neuron.last_accessed
        ? Math.max(0, 1 - ((this.nowMs() - Date.parse(neuron.last_accessed)) / 3_600_000) / 168) * 0.2
        : 0);

    // Path bonus: file path contains query keywords (v2.1: stronger filename matching)
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const pathLower = neuron.path.toLowerCase();
    const pathMatchCount = keywords.filter((k) => pathLower.includes(k)).length;
    const pathBonus = keywords.length > 0 ? (pathMatchCount / keywords.length) * 0.4 : 0;

    // Filename stem match: query keyword matches basename directly (v2.1)
    // "hebbian" in query → hebbian.ts gets a context floor + amplifier boost.
    // This prevents the multiplicative gate from killing legitimate filename matches
    // where the file's embedding is about code patterns (not descriptive text).
    const basename = pathLower.split("/").pop() || "";
    const stem = basename.replace(/\.[^.]+$/, ""); // remove extension
    const stemMatch = keywords.some((k) => stem.includes(k) && k.length >= 4);
    if (stemMatch) {
      contextScore = Math.max(contextScore, 0.5); // guarantee minimum context for filename matches
    }
    const stemBonus = stemMatch ? 0.4 : 0;

    // File type bonus: source code files prioritized over docs (v2.1 benchmark fix)
    const typeBonus = SOURCE_CODE_EXTENSIONS.test(neuron.path) ? SOURCE_CODE_BOOST
      : DOC_EXTENSIONS.test(neuron.path) ? -DOC_PENALTY
      : 0;

    // Multiplicative: context gates everything else
    // confidence = contextScore × (1 + myelinBonus + recencyBonus + pathBonus + stemBonus + typeBonus)
    const score = contextScore * (1 + myelinBonus + recencyBonus + pathBonus + stemBonus + typeBonus);

    return Math.min(score, 1.0);
  }

  // --- Decay: run periodically (e.g., daily) to weaken unused connections ---

  decay(): DecayResult {
    // Phase 1: Global multiplicative decay (existing behavior)
    this.stmts.decayAll.run();
    this.stmts.decaySynapses.run();

    // Phase 2: v3.0 Anti-Hebbian noise bridge weakening
    // Detect synapses connecting to low-value dead-end neurons and weaken them
    const noiseBridges = this.stmts.detectNoiseBridges.all() as { source_id: string; target_id: string }[];
    let weakened_noise_bridges = 0;
    for (const nb of noiseBridges) {
      this.stmts.weakenSynapse.run({
        source: nb.source_id,
        target: nb.target_id,
        decay: NOISE_BRIDGE_DECAY,
      });
      weakened_noise_bridges++;
    }

    // Phase 3: Smart tiered pruning (v3.0 — considers staleness + co-access, not just weight)
    const synInfo = this.stmts.pruneSynapses.run();
    const pruned_synapses = synInfo.changes;

    // Phase 4: Also flat-prune any remaining ultra-low weight synapses (safety net)
    const flatInfo = this.stmts.pruneSynapsesFlat.run();
    const pruned_flat = flatInfo.changes;

    // Phase 5: Prune dead neurons
    const neuronInfo = this.stmts.pruneNeurons.run();
    const pruned_neurons = neuronInfo.changes;

    // Phase 6: v3.0 Prune orphaned neurons (no connections, low value)
    const orphanInfo = this.stmts.pruneOrphans.run();
    const pruned_orphans = orphanInfo.changes;

    // Phase 7: v3.2 Homeostasis — prevent inflation, balance activation
    const homeostasisResult = this.homeostasis();

    return {
      pruned_synapses: pruned_synapses + pruned_flat,
      pruned_neurons,
      pruned_orphans,
      weakened_noise_bridges,
      homeostasis: homeostasisResult,
    };
  }

  // --- v3.1: Sleep Consolidation ---

  /**
   * Sleep consolidation: replay past sessions, boost spaced-repetition neurons,
   * and discover cross-session patterns. Should be run during idle periods.
   *
   * Three mechanisms:
   * 1. Session replay — replays top sessions, strengthens existing synapses (never creates new)
   * 2. Ebbinghaus review — spaced repetition boost for neurons due for review
   * 3. Cross-session discovery — finds file pairs co-occurring across 3+ sessions
   */
  consolidate(): ConsolidationResult {
    const now = new Date().toISOString();
    let synapses_strengthened = 0;
    let neurons_reviewed = 0;
    let patterns_discovered = 0;

    // --- Phase 1: Session Replay ---
    // Find top sessions from last 7 days with >= 5 accesses
    const sessions = this.db.prepare(`
      SELECT session_id, COUNT(*) as cnt
      FROM access_log
      WHERE timestamp > datetime('now', '-7 days')
      GROUP BY session_id
      HAVING cnt >= 5
      ORDER BY cnt DESC
      LIMIT 5
    `).all() as { session_id: string; cnt: number }[];

    const CONSOLIDATION_DELTA = 0.01; // 10% of LEARNING_RATE — gentle reinforcement

    for (const session of sessions) {
      // Get access sequence in original order
      const accesses = this.db.prepare(`
        SELECT neuron_id FROM access_log
        WHERE session_id = ?
        ORDER BY access_order ASC, timestamp ASC
      `).all(session.session_id) as { neuron_id: string }[];

      // Replay through co-access window, only strengthening EXISTING synapses
      const window: string[] = [];

      for (const access of accesses) {
        for (const recentId of window) {
          if (recentId === access.neuron_id) continue;

          // Only strengthen existing synapses — never create phantom patterns
          const fwd = this.stmts.getSynapseWeight.get(access.neuron_id, recentId) as { weight: number } | undefined;
          if (fwd) {
            const delta = CONSOLIDATION_DELTA * this.snapPlasticity(fwd.weight);
            this.stmts.upsertSynapse.run({
              source: access.neuron_id,
              target: recentId,
              weight: delta,
              delta,
              now,
            });
            synapses_strengthened++;
          }

          const rev = this.stmts.getSynapseWeight.get(recentId, access.neuron_id) as { weight: number } | undefined;
          if (rev) {
            const delta = CONSOLIDATION_DELTA * this.snapPlasticity(rev.weight);
            this.stmts.upsertSynapse.run({
              source: recentId,
              target: access.neuron_id,
              weight: delta,
              delta,
              now,
            });
            synapses_strengthened++;
          }
        }

        // Update window (same dedup logic as record())
        const idx = window.indexOf(access.neuron_id);
        if (idx !== -1) window.splice(idx, 1);
        window.push(access.neuron_id);
        if (window.length > CO_ACCESS_WINDOW_SIZE) window.shift();
      }
    }

    // --- Phase 2: Ebbinghaus Spaced Repetition ---
    // Boost neurons with decent myelination that haven't been accessed in 1-7 days
    const dueForReview = this.db.prepare(`
      SELECT id, myelination, access_count FROM neurons
      WHERE myelination > 0.05
        AND last_accessed < datetime('now', '-1 day')
        AND last_accessed > datetime('now', '-7 days')
        AND type = 'file'
    `).all() as { id: string; myelination: number; access_count: number }[];

    for (const neuron of dueForReview) {
      // Small boost: 1/4 of what a normal access would give (very gentle)
      const boost = this.computeMyelinDelta(neuron.myelination, neuron.access_count) * 0.25;
      this.db.prepare(
        `UPDATE neurons SET myelination = MIN(myelination + ?, ?) WHERE id = ?`
      ).run(boost, MYELIN_MAX, neuron.id);
      neurons_reviewed++;
    }

    // Extra decay for neurons that missed ALL review windows (>7 days, still have myelin)
    const forgottenInfo = this.db.prepare(`
      UPDATE neurons SET myelination = myelination * 0.95
      WHERE myelination > 0.05
        AND last_accessed < datetime('now', '-7 days')
        AND type = 'file'
    `).run();
    const neurons_forgotten = forgottenInfo.changes;

    // --- Phase 3: Cross-Session Pattern Discovery ---
    // Find file pairs that co-occur in 3+ different sessions but lack strong synapses
    const crossSessionPairs = this.db.prepare(`
      SELECT a1.neuron_id as n1, a2.neuron_id as n2, COUNT(DISTINCT a1.session_id) as sessions
      FROM access_log a1
      JOIN access_log a2 ON a1.session_id = a2.session_id AND a1.neuron_id < a2.neuron_id
      WHERE a1.timestamp > datetime('now', '-7 days')
      GROUP BY a1.neuron_id, a2.neuron_id
      HAVING sessions >= 3
    `).all() as { n1: string; n2: string; sessions: number }[];

    for (const pair of crossSessionPairs) {
      const existing = this.stmts.getSynapseWeight.get(pair.n1, pair.n2) as { weight: number } | undefined;
      if (!existing) {
        // New weak synapse — needs confirmation from future real access
        const initWeight = 0.15;
        this.stmts.upsertSynapse.run({ source: pair.n1, target: pair.n2, weight: initWeight, delta: initWeight, now });
        this.stmts.upsertSynapse.run({ source: pair.n2, target: pair.n1, weight: initWeight, delta: initWeight, now });
        // v3.2: Tag cross-session discoveries — gives them a capture window to consolidate
        this.stmts.tagSynapse.run({ source: pair.n1, target: pair.n2, now });
        this.stmts.tagSynapse.run({ source: pair.n2, target: pair.n1, now });
        patterns_discovered++;
      } else if (existing.weight < 0.2) {
        // Weak existing synapse — consolidation bump
        const bump = 0.05 * this.snapPlasticity(existing.weight);
        this.stmts.upsertSynapse.run({ source: pair.n1, target: pair.n2, weight: bump, delta: bump, now });
        this.stmts.upsertSynapse.run({ source: pair.n2, target: pair.n1, weight: bump, delta: bump, now });
        synapses_strengthened += 2;
      }
    }

    // --- Phase 4: v3.3 Temporal Proximity Discovery ---
    // Find file pairs accessed within 60 seconds of each other across multiple occasions.
    // Richer than session co-occurrence — captures tight temporal coupling regardless of session boundaries.
    let temporal_pairs_found = 0;
    const temporalPairs = this.db.prepare(`
      SELECT a1.neuron_id as n1, a2.neuron_id as n2,
        COUNT(*) as proximity_count,
        AVG(ABS(JULIANDAY(a1.timestamp) - JULIANDAY(a2.timestamp)) * 86400) as avg_seconds
      FROM access_log a1
      JOIN access_log a2 ON a1.neuron_id < a2.neuron_id
        AND ABS(JULIANDAY(a1.timestamp) - JULIANDAY(a2.timestamp)) < (60.0 / 86400)
        AND a1.id != a2.id
      WHERE a1.timestamp > datetime('now', '-14 days')
      GROUP BY a1.neuron_id, a2.neuron_id
      HAVING proximity_count >= 3
    `).all() as { n1: string; n2: string; proximity_count: number; avg_seconds: number }[];

    for (const pair of temporalPairs) {
      const existing = this.stmts.getSynapseWeight.get(pair.n1, pair.n2) as { weight: number } | undefined;
      if (!existing) {
        // Weight by temporal distance: closer = stronger seed (0.15 to 0.30)
        const proximityBonus = 0.15 * (1 - Math.min(pair.avg_seconds, 60) / 60);
        const initWeight = 0.15 + proximityBonus;
        this.stmts.upsertSynapse.run({ source: pair.n1, target: pair.n2, weight: initWeight, delta: initWeight, now });
        this.stmts.upsertSynapse.run({ source: pair.n2, target: pair.n1, weight: initWeight, delta: initWeight, now });
        this.stmts.tagSynapse.run({ source: pair.n1, target: pair.n2, now });
        this.stmts.tagSynapse.run({ source: pair.n2, target: pair.n1, now });
        temporal_pairs_found++;
      } else if (existing.weight < 0.3) {
        // Temporal proximity confirms a weak synapse — bump it
        const bump = 0.03 * this.snapPlasticity(existing.weight);
        this.stmts.upsertSynapse.run({ source: pair.n1, target: pair.n2, weight: bump, delta: bump, now });
        this.stmts.upsertSynapse.run({ source: pair.n2, target: pair.n1, weight: bump, delta: bump, now });
        synapses_strengthened += 2;
      }
    }

    // --- Phase 5: v3.3 Directional Synapse Weighting ---
    // Use access_order to discover directional patterns: A consistently accessed before B.
    // If forward ratio > 2:1, boost the forward synapse by 20%.
    let directional_boosts = 0;
    const directionalPairs = this.db.prepare(`
      SELECT a1.neuron_id as first_id, a2.neuron_id as second_id, COUNT(*) as cnt
      FROM access_log a1
      JOIN access_log a2 ON a1.session_id = a2.session_id
        AND a1.neuron_id != a2.neuron_id
        AND a1.access_order < a2.access_order
        AND (a2.access_order - a1.access_order) <= 5
      WHERE a1.timestamp > datetime('now', '-14 days')
      GROUP BY a1.neuron_id, a2.neuron_id
      HAVING cnt >= 5
    `).all() as { first_id: string; second_id: string; cnt: number }[];

    // Build a map to compare forward vs reverse counts
    const dirMap = new Map<string, number>();
    for (const p of directionalPairs) {
      dirMap.set(`${p.first_id}→${p.second_id}`, p.cnt);
    }

    for (const p of directionalPairs) {
      const fwdKey = `${p.first_id}→${p.second_id}`;
      const revKey = `${p.second_id}→${p.first_id}`;
      const fwdCount = dirMap.get(fwdKey) || 0;
      const revCount = dirMap.get(revKey) || 0;

      // Only boost if forward is dominant (2:1 ratio)
      if (fwdCount > revCount * 2) {
        const existing = this.stmts.getSynapseWeight.get(p.first_id, p.second_id) as { weight: number } | undefined;
        if (existing && existing.weight > 0.1 && existing.weight < 0.8) {
          const boost = existing.weight * 0.2 * this.snapPlasticity(existing.weight);
          this.stmts.upsertSynapse.run({
            source: p.first_id, target: p.second_id,
            weight: boost, delta: boost, now,
          });
          directional_boosts++;
        }
      }
    }

    // --- Phase 6: v3.3 Multi-File Triplet Mining ---
    // Find {A, B, C} where all three pairs exist in cross-session results.
    // Triplet synapses get a 50% weight bonus.
    let triplets_found = 0;
    const pairSet = new Set<string>();
    const pairNodes = new Set<string>();
    for (const pair of crossSessionPairs) {
      const key = pair.n1 < pair.n2 ? `${pair.n1}|${pair.n2}` : `${pair.n2}|${pair.n1}`;
      pairSet.add(key);
      pairNodes.add(pair.n1);
      pairNodes.add(pair.n2);
    }

    // Build adjacency list from pairs for efficient triplet detection
    const adj = new Map<string, Set<string>>();
    for (const pair of crossSessionPairs) {
      if (!adj.has(pair.n1)) adj.set(pair.n1, new Set());
      if (!adj.has(pair.n2)) adj.set(pair.n2, new Set());
      adj.get(pair.n1)!.add(pair.n2);
      adj.get(pair.n2)!.add(pair.n1);
    }

    // Find triplets: for each node, check if any two of its neighbors are also connected
    const foundTriplets = new Set<string>();
    for (const [node, neighbors] of adj) {
      const neighborArr = [...neighbors];
      for (let i = 0; i < neighborArr.length && i < 20; i++) { // cap to avoid O(n³)
        for (let j = i + 1; j < neighborArr.length && j < 20; j++) {
          const a = neighborArr[i];
          const b = neighborArr[j];
          const abKey = a < b ? `${a}|${b}` : `${b}|${a}`;
          if (pairSet.has(abKey)) {
            // Triplet found: node, a, b
            const tripletKey = [node, a, b].sort().join('|');
            if (!foundTriplets.has(tripletKey)) {
              foundTriplets.add(tripletKey);
              // Boost all three pair synapses by 50% of their current weight (gentle)
              const tripletBonus = 0.05;
              for (const [x, y] of [[node, a], [node, b], [a, b]]) {
                const ex = this.stmts.getSynapseWeight.get(x, y) as { weight: number } | undefined;
                if (ex && ex.weight < 0.5) {
                  const boost = tripletBonus * this.snapPlasticity(ex.weight);
                  this.stmts.upsertSynapse.run({ source: x, target: y, weight: boost, delta: boost, now });
                  this.stmts.upsertSynapse.run({ source: y, target: x, weight: boost, delta: boost, now });
                }
              }
              triplets_found++;
            }
          }
        }
      }
    }

    // --- Phase 7: v3.3 Episodic Pruning ---
    // Patterns have been consolidated into semantic memory — episodic traces can fade.
    let episodic_rows_pruned = 0;

    // Delete entries older than 30 days (already consolidated)
    const pruneOld = this.db.prepare(`
      DELETE FROM access_log WHERE timestamp < datetime('now', '-30 days')
    `).run();
    episodic_rows_pruned += pruneOld.changes;

    // Cap at 5000 rows total (keep newest)
    const rowCount = (this.db.prepare(`SELECT COUNT(*) as cnt FROM access_log`).get() as { cnt: number }).cnt;
    if (rowCount > 5000) {
      const pruneExcess = this.db.prepare(`
        DELETE FROM access_log WHERE id NOT IN (
          SELECT id FROM access_log ORDER BY timestamp DESC LIMIT 5000
        )
      `).run();
      episodic_rows_pruned += pruneExcess.changes;
    }

    return {
      sessions_replayed: sessions.length,
      synapses_strengthened,
      neurons_reviewed,
      neurons_forgotten,
      patterns_discovered,
      temporal_pairs_found,
      directional_boosts,
      triplets_found,
      episodic_rows_pruned,
    };
  }

  // --- v3.2: Homeostasis ---

  /**
   * Run homeostatic regulation on the network:
   * 1. Global synaptic scaling — if avg myelination or weight exceeds target, scale down
   * 2. Per-neuron activation homeostasis — dampen hyperactive hubs, boost underactive valuable neurons
   * 3. Clear expired synaptic tags
   *
   * Call during decay cycle or standalone. Preserves relative ranking while preventing inflation.
   */
  homeostasis(): HomeostasisResult {
    let myelin_scaled = false;
    let myelin_scale_factor = 1.0;
    let weight_scaled = false;
    let weight_scale_factor = 1.0;
    let neurons_dampened = 0;
    let neurons_boosted = 0;
    let tags_expired = 0;

    // Phase 1: Global myelin scaling
    const myelinAvg = (this.stmts.avgMyelination.get() as { avg_myel: number | null })?.avg_myel;
    if (myelinAvg && myelinAvg > HOMEOSTASIS_MYELIN_TARGET) {
      myelin_scale_factor = HOMEOSTASIS_MYELIN_TARGET / myelinAvg;
      this.stmts.scaleMyelination.run({ scale: myelin_scale_factor });
      myelin_scaled = true;
    }

    // Phase 2: Global weight scaling
    const weightAvg = (this.stmts.avgWeight.get() as { avg_weight: number | null })?.avg_weight;
    if (weightAvg && weightAvg > HOMEOSTASIS_WEIGHT_TARGET) {
      weight_scale_factor = HOMEOSTASIS_WEIGHT_TARGET / weightAvg;
      this.stmts.scaleWeights.run({ scale: weight_scale_factor });
      weight_scaled = true;
    }

    // Phase 3: Per-neuron activation homeostasis
    const accessAvg = (this.stmts.avgAccessCount.get() as { avg_acc: number | null })?.avg_acc;
    if (accessAvg && accessAvg > 0) {
      const highThreshold = Math.ceil(accessAvg * HOMEOSTASIS_HYPERACTIVE_MULT);
      const lowThreshold = Math.floor(accessAvg / HOMEOSTASIS_UNDERACTIVE_DIV);

      const dampenInfo = this.stmts.dampenHyperactive.run({ threshold: highThreshold });
      neurons_dampened = dampenInfo.changes;

      if (lowThreshold > 0) {
        const boostInfo = this.stmts.boostUnderactive.run({ threshold: lowThreshold });
        neurons_boosted = boostInfo.changes;
      }
    }

    // Phase 4: Clear expired synaptic tags
    const tagInfo = this.stmts.clearExpiredTags.run();
    tags_expired = tagInfo.changes;

    return {
      myelin_scaled,
      myelin_scale_factor,
      weight_scaled,
      weight_scale_factor,
      neurons_dampened,
      neurons_boosted,
      tags_expired,
    };
  }

  // --- v3.3: Episodic Recall ---

  /**
   * Recall from episodic memory (access_log) directly.
   * Finds sessions where similar queries were used, returns co-accessed files.
   * Complements semantic recall() with recent working context.
   */
  recallEpisodic(query: string, limit: number = 5, candidatePathsJson: string | null = null): RecallResult[] {
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (keywords.length === 0) return [];

    // Step 1: Find sessions where any keyword appeared in query
    const placeholders = keywords.map(() => `query LIKE ?`).join(' OR ');
    const params = keywords.map(k => `%${k}%`);

    const matchingSessions = this.db.prepare(`
      SELECT DISTINCT session_id FROM access_log
      WHERE (${placeholders})
        AND timestamp > ?
      ORDER BY timestamp DESC LIMIT 10
    `).all(...params, new Date(this.nowMs() - 7 * 86_400_000).toISOString()) as { session_id: string }[];

    if (matchingSessions.length === 0) return [];

    // Step 2: Get all neurons from those sessions, ranked by frequency
    const sessionIds = matchingSessions.map(s => s.session_id);
    const sessionPlaceholders = sessionIds.map(() => '?').join(',');

    const sessionNeurons = this.db.prepare(`
      SELECT neuron_id, COUNT(*) as cnt, MAX(timestamp) as last_ts
      FROM access_log
      WHERE session_id IN (${sessionPlaceholders})
        AND (? IS NULL OR neuron_id IN (SELECT id FROM neurons WHERE path IN (SELECT value FROM json_each(?))))
      GROUP BY neuron_id
      ORDER BY cnt DESC
      LIMIT ?
    `).all(...sessionIds, candidatePathsJson, candidatePathsJson, limit * 2) as { neuron_id: string; cnt: number; last_ts: string }[];

    // Step 3: Map to RecallResult
    const results: RecallResult[] = [];
    for (const sn of sessionNeurons) {
      const neuron = this.stmts.getNeuron.get(sn.neuron_id) as Neuron | undefined;
      if (!neuron || neuron.type !== 'file') continue;

      // Episodic confidence: frequency in matching sessions × recency
      const ageHours = (this.nowMs() - new Date(sn.last_ts).getTime()) / (1000 * 3600);
      const recencyFactor = Math.max(0, 1 - ageHours / 168); // 0-1 over 7 days
      const freqFactor = Math.min(sn.cnt / 5, 1); // normalize, cap at 5 accesses
      const confidence = Math.min(freqFactor * (0.5 + recencyFactor * 0.5), 1.0);

      if (confidence >= CONFIDENCE_GATE) {
        results.push({
          neuron: this.parseNeuron(neuron),
          confidence,
          activation_path: 'episodic',
          estimated_tokens_saved: TOKENS_PER_FILE_READ,
        });
      }

      if (results.length >= limit) break;
    }

    return results;
  }

  // --- Anti-recall: negative Hebbian signal for noise reduction ---

  /**
   * Track that a file was recalled (suggested to agent).
   * Called by prompt hook when injecting recall results.
   */
  trackRecalled(neuronId: string, sourceEdge?: { from: string; to: string }): void {
    this.recalledThisSession.add(neuronId);
    if (sourceEdge) {
      const edges = this.recalledEdges.get(neuronId) ?? [];
      if (!edges.some(e => e.from === sourceEdge.from && e.to === sourceEdge.to)) {
        edges.push(sourceEdge);
        this.recalledEdges.set(neuronId, edges);
      }
    }
  }

  /**
   * Track that a file was actually opened/used by the agent.
   * Called by PostToolUse hook on Read/Edit/Write.
   */
  trackOpened(neuronId: string): void {
    this.openedThisSession.add(neuronId);
  }

  /**
   * Apply anti-recall decay: weaken synapses for files that were
   * recalled but never opened during this session.
   * Call at session end (or periodically).
   *
   * Returns { weakened: number of synapses weakened, ignored: files that were recalled but unused }
   */
  applyAntiRecall(): { weakened: number; ignored: string[] } {
    const ignored = [...this.recalledThisSession].filter(
      id => !this.openedThisSession.has(id)
    );

    if (ignored.length === 0) {
      return { weakened: 0, ignored: [] };
    }

    let weakened = 0;

    for (const ignoredId of ignored) {
      const synapses = this.antiRecallSynapses(ignoredId);

      for (const syn of synapses) {
        const newWeight = Math.max(
          ANTI_RECALL_FLOOR,
          syn.weight * (1 - ANTI_RECALL_BASE_DECAY)
        );
        if (newWeight < syn.weight) {
          this.db.prepare(
            "UPDATE synapses SET weight = ? WHERE source_id = ? AND target_id = ?"
          ).run(newWeight, syn.source_id, syn.target_id);
          weakened++;
        }
      }
    }

    return { weakened, ignored };
  }

  /**
   * Get anti-recall session state (for debugging/introspection).
   */
  getAntiRecallState(): { recalled: string[]; opened: string[]; ignored: string[]; source_edges: Record<string, { from: string; to: string }[]> } {
    const recalled = [...this.recalledThisSession];
    const opened = [...this.openedThisSession];
    const ignored = recalled.filter(id => !this.openedThisSession.has(id));
    return { recalled, opened, ignored, source_edges: Object.fromEntries(this.recalledEdges) };
  }

  // --- Token budget reporting ---

  tokenReport(): TokenReport {
    const neurons = this.stmts.allNeurons.all() as Neuron[];
    const totalAccesses = neurons.reduce((s, n) => s + n.access_count, 0);

    // Without BrainBox: every access costs search + read
    const tokensWithout = totalAccesses * (TOKENS_PER_SEARCH + TOKENS_PER_FILE_READ);

    // With BrainBox: myelinated paths skip search, high-confidence skips both
    let tokensWith = 0;
    for (const n of neurons) {
      const accessesViaRecall = Math.floor(n.access_count * n.myelination);
      const accessesViSearch = n.access_count - accessesViaRecall;

      // Recalled accesses: only pay read cost (skipped search)
      tokensWith += accessesViaRecall * TOKENS_PER_FILE_READ;
      // Searched accesses: pay full cost
      tokensWith += accessesViSearch * (TOKENS_PER_SEARCH + TOKENS_PER_FILE_READ);
    }

    const saved = tokensWithout - tokensWith;
    return {
      tokens_used: tokensWithout,
      tokens_with_brainbox: tokensWith,
      tokens_saved: saved,
      savings_pct: tokensWithout > 0 ? (saved / tokensWithout) * 100 : 0,
    };
  }

  // --- Stats ---

  stats() {
    return this.stmts.stats.get() as {
      neuron_count: number;
      synapse_count: number;
      superhighways: number;
      total_accesses: number;
      total_tokens_saved: number;
      avg_myelination: number;
    };
  }

  // --- Introspection ---

  allNeurons(): Neuron[] {
    return (this.stmts.allNeurons.all() as Neuron[]).map(this.parseNeuron);
  }

  allSynapses(): Synapse[] {
    return this.stmts.allSynapses.all() as Synapse[];
  }

  getSuperhighways(minMyelination = 0.5): Neuron[] {
    return this.allNeurons().filter((n) => n.myelination >= minMyelination);
  }

  // --- Embedding methods ---

  /**
   * Embed a single neuron's contexts and store the embedding in DB.
   * Returns true if successful, false if skipped/failed.
   */
  async embedNeuron(neuronId: string): Promise<boolean> {
    if (!isEmbeddingAvailable()) return false;

    const neuron = this.stmts.getNeuron.get(neuronId) as Neuron | undefined;
    if (!neuron) return false;

    const contexts = typeof neuron.contexts === "string"
      ? JSON.parse(neuron.contexts) as string[]
      : neuron.contexts;

    // Build text to embed: path + contexts
    const text = [neuron.path, ...contexts].join(" ");
    if (text.trim().length < 3) return false;

    const embedding = await embedText(text, "document");
    if (!embedding) return false;

    this.stmts.updateEmbedding.run({
      id: neuronId,
      embedding: serializeEmbedding(embedding),
      model: EMBEDDING_MODEL_ID,
    });
    return true;
  }

  /**
   * Batch embed all neurons that don't have embeddings yet.
   * Returns { embedded, skipped, failed } counts.
   */
  async embedAllNeurons(
    onProgress?: (done: number, total: number) => void
  ): Promise<{ embedded: number; skipped: number; failed: number }> {
    if (!isEmbeddingAvailable()) {
      return { embedded: 0, skipped: 0, failed: 0 };
    }

    const neurons = this.stmts.neuronsWithoutEmbedding.all() as Neuron[];
    let embedded = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < neurons.length; i++) {
      try {
        const ok = await this.embedNeuron(neurons[i].id);
        if (ok) embedded++;
        else skipped++;
      } catch {
        failed++;
      }
      if (onProgress) onProgress(i + 1, neurons.length);
    }

    return { embedded, skipped, failed };
  }

  /**
   * Get embedding coverage stats.
   */
  embeddingCoverage(): { total: number; embedded: number; pct: number } {
    const row = this.stmts.embeddingCoverage.get() as { total: number; embedded: number };
    return {
      total: row.total,
      embedded: row.embedded,
      pct: row.total > 0 ? (row.embedded / row.total) * 100 : 0,
    };
  }

  // --- v5: Session Intent Capture ---

  /**
   * Store a description of what this session is about.
   * Typically derived from the first user message.
   */
  setSessionIntent(intent: string): void {
    this.db.prepare(
      "UPDATE sessions SET intent = ? WHERE id = ?"
    ).run(intent, this.sessionId);
  }

  /**
   * Get the intent for the current session.
   */
  getSessionIntent(): string | null {
    const row = this.db.prepare(
      "SELECT intent FROM sessions WHERE id = ?"
    ).get(this.sessionId) as { intent: string | null } | undefined;
    return row?.intent ?? null;
  }

  /**
   * Get recent sessions with their intents and stats.
   */
  getRecentSessions(days = 7): SessionSummary[] {
    return this.db.prepare(`
      SELECT id, started_at, ended_at, total_accesses, tokens_used, tokens_saved, hit_rate, intent
      FROM sessions
      WHERE started_at >= datetime('now', '-' || ? || ' days')
      ORDER BY started_at DESC
    `).all(days) as SessionSummary[];
  }

  // --- v5: Hub Detection ---

  /**
   * Find the most-connected neurons by out-degree.
   * Returns hub neurons with their top connections sorted by weight.
   */
  getHubs(limit = 10): HubInfo[] {
    const hubs = this.db.prepare(`
      SELECT source_id, COUNT(*) as out_degree
      FROM synapses
      GROUP BY source_id
      ORDER BY out_degree DESC
      LIMIT ?
    `).all(limit) as { source_id: string; out_degree: number }[];

    return hubs.map(h => {
      const neuron = this.db.prepare("SELECT * FROM neurons WHERE id = ?").get(h.source_id) as Neuron | undefined;
      if (!neuron) return null;

      const topConns = this.db.prepare(`
        SELECT s.target_id, s.weight, n.*
        FROM synapses s
        JOIN neurons n ON n.id = s.target_id
        WHERE s.source_id = ?
        ORDER BY s.weight DESC
        LIMIT 5
      `).all(h.source_id) as (Neuron & { weight: number; target_id: string })[];

      return {
        neuron: this.parseNeuron(neuron),
        outDegree: h.out_degree,
        topConnections: topConns.map(c => ({
          target: this.parseNeuron(c),
          weight: c.weight,
        })),
      };
    }).filter(Boolean) as HubInfo[];
  }

  // --- v5: Staleness Detection ---

  /**
   * Detect neurons that were active/myelinated but haven't been accessed recently.
   * These are "fading superhighways" — patterns that used to be important but may be drifting.
   */
  detectStale(opts?: { minMyelination?: number; daysInactive?: number }): StaleNeuron[] {
    const minMyelin = opts?.minMyelination ?? 0.1;
    const daysInactive = opts?.daysInactive ?? 7;

    const stale = this.db.prepare(`
      SELECT *, CAST(
        (julianday('now') - julianday(last_accessed)) AS REAL
      ) as days_since
      FROM neurons
      WHERE type = 'file'
        AND myelination >= ?
        AND last_accessed IS NOT NULL
        AND last_accessed < datetime('now', '-' || ? || ' days')
      ORDER BY myelination DESC
    `).all(minMyelin, daysInactive) as (Neuron & { days_since: number })[];

    return stale.map(n => {
      const daysSince = Math.round(n.days_since);
      // Project forward: if inactive for N more days, what will myelination be?
      const projected = n.myelination * Math.pow(MYELIN_DAILY_DECAY, daysSince);
      return {
        neuron: this.parseNeuron(n),
        daysSinceAccess: daysSince,
        projectedMyelination: Math.round(projected * 1000) / 1000,
      };
    });
  }

  // --- v5: Project Tagging ---

  /**
   * Tag all file neurons under a given root path with a project name.
   * Returns the number of neurons tagged.
   */
  tagProject(projectRoot: string, projectName: string): number {
    // Ensure root ends with / for prefix matching
    const root = projectRoot.endsWith("/") ? projectRoot : projectRoot + "/";
    const result = this.db.prepare(`
      UPDATE neurons SET project = ?
      WHERE type = 'file' AND (path LIKE ? || '%' OR path LIKE ? || '%')
    `).run(projectName, root, projectRoot);
    return result.changes;
  }

  /**
   * Get all neurons tagged with a given project.
   */
  getProjectNeurons(projectName: string): Neuron[] {
    const rows = this.db.prepare(
      "SELECT * FROM neurons WHERE project = ? ORDER BY myelination DESC"
    ).all(projectName) as Neuron[];
    return rows.map(this.parseNeuron);
  }

  /**
   * Recall filtered to a specific project's neurons.
   */
  async recallForProject(opts: RecallOptions & { project: string }): Promise<RecallResult[]> {
    const results = await this.recall(opts);
    return results.filter(r => (r.neuron as any).project === opts.project);
  }

  // --- v5: Raw Conversation Capture ---

  /**
   * Capture session conversation content as a semantic neuron.
   * Extracts keywords from user messages at zero LLM cost.
   */
  captureSessionContext(messages: string[]): Neuron {
    const keywords = this.extractKeywords(messages);
    const path = `session:${this.sessionId}`;
    const id = this.neuronId(path, "semantic");
    const now = new Date().toISOString();

    // Upsert the semantic neuron
    this.db.prepare(`
      INSERT INTO neurons (id, type, path, activation, myelination, access_count, last_accessed, created_at, contexts)
      VALUES (?, 'semantic', ?, 1.0, 0, 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        activation = 1.0,
        access_count = access_count + 1,
        last_accessed = ?,
        contexts = ?
    `).run(id, path, now, now, JSON.stringify(keywords), now, JSON.stringify(keywords));

    return this.parseNeuron(
      this.db.prepare("SELECT * FROM neurons WHERE id = ?").get(id) as Neuron
    );
  }

  /**
   * Extract meaningful keywords from messages, filtering stopwords.
   */
  private extractKeywords(messages: string[]): string[] {
    const words = new Map<string, number>();
    for (const msg of messages) {
      for (const word of msg.toLowerCase().split(/\s+/)) {
        const clean = word.replace(/[^a-z0-9_.-]/g, "");
        if (clean.length >= 3 && !STOPWORDS.has(clean)) {
          words.set(clean, (words.get(clean) || 0) + 1);
        }
      }
    }
    // Sort by frequency DESC, take top 20
    return [...words.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([w]) => w);
  }

  // --- v5: Staleness Alerts ---

  /**
   * Generate a human-readable staleness alert string for prompt injection.
   * Returns null if nothing is stale (no noise).
   */
  getStalenessAlerts(opts?: { limit?: number; minMyelination?: number }): string | null {
    const stale = this.detectStale({
      minMyelination: opts?.minMyelination ?? 0.1,
    });
    if (stale.length === 0) return null;

    const limited = stale.slice(0, opts?.limit ?? 5);
    const parts = limited.map(s => {
      const currentPct = Math.round(s.neuron.myelination * 100);
      const projectedPct = Math.round(s.projectedMyelination * 100);
      return `${s.neuron.path} (${currentPct}%→${projectedPct}% myelin, ${s.daysSinceAccess}d idle)`;
    });

    return `Stale superhighways: ${parts.join(", ")}`;
  }

  // --- v5: Anti-Recall Escalation ---

  /**
   * Apply anti-recall with consecutive ignore streak escalation.
   * Formula: effective_decay = 1 - (1 - BASE_DECAY)^consecutive_ignores
   * Replaces the original flat 10% decay.
   */
  applyAntiRecallEscalated(): { weakened: number; ignored: string[]; streaksUpdated: number } {
    const ignored = [...this.recalledThisSession].filter(
      id => !this.openedThisSession.has(id)
    );

    // Reset streak for opened files that were recalled
    const opened = [...this.recalledThisSession].filter(
      id => this.openedThisSession.has(id)
    );
    for (const openedId of opened) {
      this.db.prepare(
        "UPDATE neurons SET ignore_streak = 0 WHERE id = ?"
      ).run(openedId);
    }

    if (ignored.length === 0) {
      return { weakened: 0, ignored: [], streaksUpdated: opened.length };
    }

    let weakened = 0;

    for (const ignoredId of ignored) {
      // Increment ignore streak
      this.db.prepare(
        "UPDATE neurons SET ignore_streak = ignore_streak + 1 WHERE id = ?"
      ).run(ignoredId);

      // Get current streak
      const neuron = this.db.prepare(
        "SELECT ignore_streak FROM neurons WHERE id = ?"
      ).get(ignoredId) as { ignore_streak: number } | undefined;
      const streak = neuron?.ignore_streak ?? 1;

      // Escalating decay: 1 - (1 - 0.1)^streak
      const effectiveDecay = 1 - Math.pow(1 - ANTI_RECALL_BASE_DECAY, streak);

      const synapses = this.antiRecallSynapses(ignoredId);

      for (const syn of synapses) {
        const newWeight = Math.max(
          ANTI_RECALL_FLOOR,
          syn.weight * (1 - effectiveDecay)
        );
        if (newWeight < syn.weight) {
          this.db.prepare(
            "UPDATE synapses SET weight = ? WHERE source_id = ? AND target_id = ?"
          ).run(newWeight, syn.source_id, syn.target_id);
          weakened++;
        }
      }
    }

    return { weakened, ignored, streaksUpdated: opened.length + ignored.length };
  }

  /**
   * Get current ignore streaks for all neurons that have been ignored.
   */
  getIgnoreStreaks(): Map<string, number> {
    const rows = this.db.prepare(
      "SELECT id, ignore_streak FROM neurons WHERE ignore_streak > 0"
    ).all() as { id: string; ignore_streak: number }[];
    return new Map(rows.map(r => [r.id, r.ignore_streak]));
  }

  // --- Helpers ---

  private neuronId(path: string, type: string): string {
    return `${type}:${path}`;
  }

  private parseNeuron(n: Neuron): Neuron {
    return {
      ...n,
      contexts: typeof n.contexts === "string" ? JSON.parse(n.contexts) : n.contexts,
    };
  }
}
