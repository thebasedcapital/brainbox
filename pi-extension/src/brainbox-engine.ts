/**
 * BrainBox Pi Extension Engine
 *
 * A self-contained Hebbian memory engine for use inside the Pi coding agent extension.
 * Shares the same SQLite schema as the main BrainBox project but runs independently
 * without importing from the main brainbox package.
 *
 * Schema version: v5 (neurons, synapses, access_log, sessions)
 */

import Database from "better-sqlite3";
import { join, dirname } from "path";
import { mkdirSync } from "fs";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEARNING_RATE = 0.1;
const MYELIN_RATE = 0.02;
const MYELIN_MAX = 0.95;
const CO_ACCESS_WINDOW_SIZE = 25;
const MAX_SPREAD_HOPS = 3;
const MAX_SPREAD_FAN_OUT = 10;
const CONFIDENCE_GATE = 0.4;
const MYELIN_CAP_IN_CONFIDENCE = 0.5;
const HUB_PENALTY_THRESHOLD = 20;
const HUB_PENALTY_FACTOR = 0.5;
const ERROR_LEARNING_BOOST = 2.0;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RecallResult {
  path: string;
  type: string;
  confidence: number;
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW";
  myelination: number;
}

export interface StatsResult {
  neurons: number;
  synapses: number;
  superhighways: number;
  avgMyelination: number;
}

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

interface NeuronRow {
  id: string;
  type: string;
  path: string;
  activation: number;
  myelination: number;
  access_count: number;
  last_accessed: string | null;
  created_at: string;
  contexts: string;          // JSON-encoded string[]
  embedding: Buffer | null;
  project: string | null;
  ignore_streak: number;
}

interface SynapseRow {
  source_id: string;
  target_id: string;
  weight: number;
  co_access_count: number;
  last_fired: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

function openDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  return db;
}

function applySchema(db: Database.Database): void {
  // Core tables (as specified in the task)
  db.exec(`
    CREATE TABLE IF NOT EXISTS neurons (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      path TEXT NOT NULL,
      activation REAL DEFAULT 0,
      myelination REAL DEFAULT 0,
      access_count INTEGER DEFAULT 0,
      last_accessed TEXT,
      created_at TEXT NOT NULL,
      contexts TEXT DEFAULT '[]',
      embedding BLOB,
      project TEXT,
      ignore_streak INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS synapses (
      source_id TEXT NOT NULL REFERENCES neurons(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES neurons(id) ON DELETE CASCADE,
      weight REAL DEFAULT 0.1,
      co_access_count INTEGER DEFAULT 1,
      last_fired TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id)
    );

    CREATE TABLE IF NOT EXISTS access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      neuron_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      query TEXT,
      timestamp TEXT NOT NULL,
      token_cost INTEGER DEFAULT 0,
      access_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      total_accesses INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      tokens_saved INTEGER DEFAULT 0,
      hit_rate REAL DEFAULT 0,
      intent TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_neurons_type ON neurons(type);
    CREATE INDEX IF NOT EXISTS idx_neurons_myelination ON neurons(myelination DESC);
    CREATE INDEX IF NOT EXISTS idx_synapses_weight ON synapses(weight DESC);
    CREATE INDEX IF NOT EXISTS idx_access_log_session ON access_log(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_access_log_neuron ON access_log(neuron_id);
  `);

  // Safe migrations for columns that may already exist
  const migrateColumn = (sql: string) => {
    try { db.exec(sql); } catch { /* column already exists */ }
  };
  migrateColumn(`ALTER TABLE access_log ADD COLUMN access_order INTEGER DEFAULT 0`);
  migrateColumn(`ALTER TABLE neurons ADD COLUMN embedding BLOB DEFAULT NULL`);
  migrateColumn(`ALTER TABLE neurons ADD COLUMN project TEXT DEFAULT NULL`);
  migrateColumn(`ALTER TABLE neurons ADD COLUMN ignore_streak INTEGER DEFAULT 0`);
  migrateColumn(`ALTER TABLE sessions ADD COLUMN intent TEXT DEFAULT NULL`);
}

// ---------------------------------------------------------------------------
// BrainBoxPi
// ---------------------------------------------------------------------------

export class BrainBoxPi {
  private db: Database.Database;
  private sessionId: string;
  private recentAccesses: string[] = [];   // unique neuron IDs, most-recent last
  private accessCounter: number = 0;

  // Prepared statements (populated in constructor)
  private stmts!: ReturnType<typeof BrainBoxPi.prototype.prepareStatements>;

  constructor(dbPath?: string) {
    const defaultPath = join(
      process.env.HOME || "~",
      ".brainbox",
      "brainbox.db"
    );
    const resolvedPath =
      dbPath || process.env.BRAINBOX_DB || defaultPath;

    this.db = openDatabase(resolvedPath);
    this.sessionId = `pi-session-${randomUUID()}`;
    this.stmts = this.prepareStatements();

    // Create session record
    this.stmts.createSession.run({
      id: this.sessionId,
      now: new Date().toISOString(),
    });

    // Seed recentAccesses from the last hour so cross-invocation Hebbian learning works
    const recentRows = this.db
      .prepare(
        `SELECT neuron_id FROM access_log
         WHERE timestamp > datetime('now', '-1 hour')
         ORDER BY timestamp ASC, access_order ASC`
      )
      .all() as { neuron_id: string }[];

    for (const row of recentRows) {
      const idx = this.recentAccesses.indexOf(row.neuron_id);
      if (idx !== -1) this.recentAccesses.splice(idx, 1);
      this.recentAccesses.push(row.neuron_id);
    }
    if (this.recentAccesses.length > CO_ACCESS_WINDOW_SIZE) {
      this.recentAccesses = this.recentAccesses.slice(-CO_ACCESS_WINDOW_SIZE);
    }
  }

  // -------------------------------------------------------------------------
  // Prepared statement factory
  // -------------------------------------------------------------------------

  private prepareStatements() {
    return {
      getNeuron: this.db.prepare(`SELECT * FROM neurons WHERE id = ?`),
      upsertNeuron: this.db.prepare(`
        INSERT INTO neurons (id, type, path, activation, myelination, access_count, last_accessed, created_at, contexts)
        VALUES (@id, @type, @path, @activation, @myelination, 1, @now, @now, @contexts)
        ON CONFLICT(id) DO UPDATE SET
          activation  = @activation,
          myelination = @myelination,
          access_count = neurons.access_count + 1,
          last_accessed = @now,
          contexts = @contexts
      `),
      getSynapses: this.db.prepare(
        `SELECT * FROM synapses WHERE source_id = ? ORDER BY weight DESC`
      ),
      getSynapseWeight: this.db.prepare(
        `SELECT weight FROM synapses WHERE source_id = ? AND target_id = ?`
      ),
      getSynapseCount: this.db.prepare(
        `SELECT COUNT(*) as cnt FROM synapses WHERE source_id = ?`
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
        UPDATE sessions SET total_accesses = total_accesses + 1 WHERE id = @id
      `),
      searchByContext: this.db.prepare(`
        SELECT * FROM neurons
        WHERE (contexts LIKE @pattern OR path LIKE @pattern)
        ORDER BY myelination DESC
        LIMIT @limit
      `),
      topByMyelination: this.db.prepare(`
        SELECT * FROM neurons
        ORDER BY myelination DESC
        LIMIT @limit
      `),
      stats: this.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM neurons) as neuron_count,
          (SELECT COUNT(*) FROM synapses) as synapse_count,
          (SELECT COUNT(*) FROM neurons WHERE myelination >= 0.5) as superhighways,
          (SELECT AVG(myelination) FROM neurons) as avg_myelination
      `),
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private neuronId(path: string, type: string): string {
    return `${type}:${path}`;
  }

  private parseContexts(row: NeuronRow): string[] {
    try {
      return typeof row.contexts === "string"
        ? JSON.parse(row.contexts)
        : (row.contexts as unknown as string[]) || [];
    } catch {
      return [];
    }
  }

  /**
   * Myelination delta with diminishing returns (BCM-inspired).
   * New paths strengthen quickly; superhighways grow slowly.
   */
  private myelinDelta(currentMyelin: number): number {
    return MYELIN_RATE * (1 - currentMyelin / MYELIN_MAX);
  }

  /**
   * Compute recall confidence for a neuron against a query.
   * Formula (as specified):
   *   conf = contextMatch × (1 + myelinBonus + recencyBonus + pathBonus)
   */
  private computeConfidence(row: NeuronRow, query: string): number {
    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (keywords.length === 0) {
      // No meaningful keywords — use myelination as signal only
      return row.myelination * 0.5;
    }

    const contexts = this.parseContexts(row);
    const contextStr = contexts.join(" ").toLowerCase();

    // contextMatch: fraction of query keywords found in contexts (0-1)
    const contextMatches = keywords.filter((k) => contextStr.includes(k)).length;
    const contextMatch = contextMatches / keywords.length;

    // myelinBonus: min(myelination, 0.5) * 0.3
    const myelinBonus = Math.min(row.myelination, MYELIN_CAP_IN_CONFIDENCE) * 0.3;

    // recencyBonus: max(0, 1 - ageHours/168) * 0.2
    let recencyBonus = 0;
    if (row.last_accessed) {
      const ageMs = Date.now() - new Date(row.last_accessed).getTime();
      const ageHours = ageMs / 3_600_000;
      recencyBonus = Math.max(0, 1 - ageHours / 168) * 0.2;
    }

    // pathBonus: keyword match in path * 0.2
    const pathLower = row.path.toLowerCase();
    const pathMatches = keywords.filter((k) => pathLower.includes(k)).length;
    const pathBonus = (pathMatches / keywords.length) * 0.2;

    const score = contextMatch * (1 + myelinBonus + recencyBonus + pathBonus);
    return Math.min(score, 1.0);
  }

  private toRecallResult(row: NeuronRow, confidence: number): RecallResult {
    const level: RecallResult["confidenceLevel"] =
      confidence >= 0.7 ? "HIGH" : confidence >= 0.5 ? "MEDIUM" : "LOW";
    return {
      path: row.path,
      type: row.type,
      confidence,
      confidenceLevel: level,
      myelination: row.myelination,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Record an access to a file, tool, error, or semantic concept.
   *
   * Algorithm:
   *  1. Create/upsert neuron with incremented access_count and updated activation.
   *  2. Apply myelination with diminishing returns.
   *  3. Store query in contexts array (keep last 10).
   *  4. Create/strengthen bidirectional synapses with all neurons in the
   *     co-access window (last 25 unique accesses).
   *  5. Log to access_log and update session.
   */
  record(
    path: string,
    type: "file" | "tool" | "error" | "semantic",
    query?: string
  ): void {
    const id = this.neuronId(path, type);
    const now = new Date().toISOString();

    // Fetch existing neuron (may be undefined on first access)
    const existing = this.stmts.getNeuron.get(id) as NeuronRow | undefined;
    const contexts = existing ? this.parseContexts(existing) : [];

    if (query && !contexts.includes(query)) {
      contexts.push(query);
      if (contexts.length > 10) contexts.splice(0, contexts.length - 10);
    }

    // Compute new activation and myelination
    const newActivation = Math.min(
      (existing?.activation ?? 0) + 0.1,
      1.0
    );
    const currentMyelin = existing?.myelination ?? 0;
    const newMyelin = Math.min(
      currentMyelin + this.myelinDelta(currentMyelin),
      MYELIN_MAX
    );

    this.stmts.upsertNeuron.run({
      id,
      type,
      path,
      activation: newActivation,
      myelination: newMyelin,
      now,
      contexts: JSON.stringify(contexts),
    });

    // Log this access
    this.accessCounter++;
    this.stmts.logAccess.run({
      neuron_id: id,
      session_id: this.sessionId,
      query: query ?? null,
      now,
      token_cost: type === "file" ? 1500 : 500,
      access_order: this.accessCounter,
    });
    this.stmts.updateSession.run({ id: this.sessionId });

    // Hebbian synapse formation/strengthening with co-access window
    for (let i = 0; i < this.recentAccesses.length; i++) {
      const recentId = this.recentAccesses[i];
      if (recentId === id) continue;

      // Positional decay: most recent = full strength, oldest = weakest
      const positionFactor = (i + 1) / this.recentAccesses.length;

      // Error boost: errors are high-signal events
      const recentNeuron = this.stmts.getNeuron.get(recentId) as NeuronRow | undefined;
      const involvesError = type === "error" || recentNeuron?.type === "error";
      let rate = involvesError
        ? LEARNING_RATE * ERROR_LEARNING_BOOST
        : LEARNING_RATE;

      // Hub penalty: highly connected neurons get reduced learning rate
      const currentSynCount = (
        this.stmts.getSynapseCount.get(id) as { cnt: number }
      ).cnt;
      const recentSynCount = (
        this.stmts.getSynapseCount.get(recentId) as { cnt: number }
      ).cnt;
      if (
        currentSynCount > HUB_PENALTY_THRESHOLD ||
        recentSynCount > HUB_PENALTY_THRESHOLD
      ) {
        rate *= HUB_PENALTY_FACTOR;
      }

      const baseDelta = rate * positionFactor;

      // Synapse strengthening: weight = min(weight + delta * (1 - weight), 1.0)
      // This is the BCM rule as implemented in the upsertSynapse statement.
      this.stmts.upsertSynapse.run({
        source: id,
        target: recentId,
        weight: baseDelta,
        delta: baseDelta,
        now,
      });
      this.stmts.upsertSynapse.run({
        source: recentId,
        target: id,
        weight: baseDelta,
        delta: baseDelta,
        now,
      });
    }

    // Maintain co-access window (unique, most-recent last)
    const existingIdx = this.recentAccesses.indexOf(id);
    if (existingIdx !== -1) this.recentAccesses.splice(existingIdx, 1);
    this.recentAccesses.push(id);
    if (this.recentAccesses.length > CO_ACCESS_WINDOW_SIZE) {
      this.recentAccesses.shift();
    }
  }

  /**
   * Recall files/concepts relevant to a query using spreading activation.
   *
   * Algorithm:
   *  1. Keyword search: neurons whose contexts or path contain query keywords.
   *  2. Score each: contextMatch * (1 + myelinBonus + recencyBonus + pathBonus).
   *  3. Spreading activation: BFS from top results, 3 hops, fan-out 10.
   *  4. Filter to confidence >= 0.4; return sorted by confidence desc.
   */
  async recall(query: string, limit = 5): Promise<RecallResult[]> {
    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    // Phase 1: Direct keyword matches (context and path)
    const directMatches: NeuronRow[] = [];
    const seenIds = new Set<string>();

    for (const keyword of keywords) {
      const pattern = `%${keyword}%`;
      const rows = this.stmts.searchByContext.all({
        pattern,
        limit: 20,
      }) as NeuronRow[];
      for (const row of rows) {
        // Tool neurons are bridges only — never appear in results
        if (row.type === "tool") continue;
        if (!seenIds.has(row.id)) {
          seenIds.add(row.id);
          directMatches.push(row);
        }
      }
    }

    // Phase 2: Score direct matches and gate by confidence
    const scored: { row: NeuronRow; confidence: number }[] = [];
    for (const row of directMatches) {
      const confidence = this.computeConfidence(row, query);
      if (confidence >= CONFIDENCE_GATE) {
        scored.push({ row, confidence });
      }
    }
    scored.sort((a, b) => b.confidence - a.confidence);

    const results: RecallResult[] = scored.map(({ row, confidence }) =>
      this.toRecallResult(row, confidence)
    );
    const activatedIds = new Set(results.map((r) => this.neuronId(r.path, r.type)));

    // Phase 3: Spreading activation — BFS from top results, up to MAX_SPREAD_HOPS
    let frontier: { neuronId: string; confidence: number }[] = scored
      .slice(0, 5)
      .map(({ row, confidence }) => ({
        neuronId: row.id,
        confidence,
      }));

    for (
      let hop = 0;
      hop < MAX_SPREAD_HOPS && frontier.length > 0;
      hop++
    ) {
      const nextFrontier: typeof frontier = [];

      for (const seed of frontier) {
        const allSynapses = this.stmts.getSynapses.all(
          seed.neuronId
        ) as SynapseRow[];
        const synapses = allSynapses.slice(0, MAX_SPREAD_FAN_OUT);

        // Fan-effect: out-degree dampens spreading (Anderson 1983 ACT-R)
        const outDegree = allSynapses.length;
        const fanFactor = 1 / Math.sqrt(Math.min(outDegree, 50));

        for (const syn of synapses) {
          if (syn.weight < 0.3) continue;

          const target = this.stmts.getNeuron.get(
            syn.target_id
          ) as NeuronRow | undefined;
          if (!target) continue;

          // Tool neurons are bridges — skip as results but allow traversal
          if (target.type === "tool") continue;

          const myelinBoost =
            1 + Math.min(target.myelination, MYELIN_CAP_IN_CONFIDENCE);
          const spreadConf =
            seed.confidence * syn.weight * myelinBoost * fanFactor;

          if (spreadConf < CONFIDENCE_GATE) continue;

          const targetNeuronId = this.neuronId(target.path, target.type);

          if (activatedIds.has(targetNeuronId)) {
            // Convergence: take max confidence
            const existing = results.find(
              (r) =>
                this.neuronId(r.path, r.type) === targetNeuronId
            );
            if (existing && spreadConf > existing.confidence) {
              existing.confidence = Math.min(spreadConf, 0.99);
              existing.confidenceLevel =
                existing.confidence >= 0.7
                  ? "HIGH"
                  : existing.confidence >= 0.5
                  ? "MEDIUM"
                  : "LOW";
            }
            continue;
          }

          const cappedConf = Math.min(spreadConf, 0.99);
          results.push(this.toRecallResult(target, cappedConf));
          activatedIds.add(targetNeuronId);

          nextFrontier.push({ neuronId: syn.target_id, confidence: cappedConf });
        }
      }

      frontier = nextFrontier;
    }

    results.sort((a, b) => b.confidence - a.confidence);
    return results.slice(0, limit);
  }

  /**
   * Record an error and return potential fix file suggestions.
   *
   * The error message is stored as an error-type neuron and Hebbian learning
   * wires it to any recently co-accessed files.  The returned `fixes` are
   * the files most likely to resolve the error based on current memory.
   */
  async recordError(
    error: string,
    query?: string
  ): Promise<{ errorPath: string; fixes: RecallResult[] }> {
    this.record(error, "error", query);

    const fixes = await this.recall(error, 5);

    return {
      errorPath: this.neuronId(error, "error"),
      fixes,
    };
  }

  /**
   * Return aggregate statistics about the current BrainBox database.
   */
  stats(): StatsResult {
    const row = this.stmts.stats.get() as {
      neuron_count: number;
      synapse_count: number;
      superhighways: number;
      avg_myelination: number | null;
    };
    return {
      neurons: row.neuron_count,
      synapses: row.synapse_count,
      superhighways: row.superhighways,
      avgMyelination: row.avg_myelination ?? 0,
    };
  }

  /**
   * Close the database connection.  Call when the Pi extension shuts down.
   */
  close(): void {
    this.db.close();
  }
}
