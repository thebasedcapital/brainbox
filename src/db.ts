import Database from "better-sqlite3";
import { join, dirname } from "path";
import { mkdirSync } from "fs";

const DATA_DIR = join(process.env.HOME || "~", ".brainbox");

/**
 * Open the BrainBox database.
 * Priority: explicit dbPath arg > BRAINBOX_DB env var > default ~/.brainbox/brainbox.db
 * Use BRAINBOX_DB for isolated testing: BRAINBOX_DB=/tmp/test.db npx tsx src/cli.ts ...
 */
export function openDb(dbPath?: string): Database.Database {
  const path = dbPath || process.env.BRAINBOX_DB || join(DATA_DIR, "brainbox.db");
  // Create parent dir for file-based DBs (skip for :memory: and explicit paths)
  if (!path.startsWith(":")) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    -- Neurons: each unique file path, tool call, error message, or semantic concept
    CREATE TABLE IF NOT EXISTS neurons (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,          -- 'file' | 'tool' | 'error' | 'semantic'
      path TEXT NOT NULL,          -- file path, tool name, error signature, or concept
      activation REAL DEFAULT 0,   -- current activation level (0-1)
      myelination REAL DEFAULT 0,  -- superhighway status (0-1), grows with use
      access_count INTEGER DEFAULT 0,
      last_accessed TEXT,          -- ISO-8601
      created_at TEXT NOT NULL,
      contexts TEXT DEFAULT '[]'   -- JSON array of query strings that activated this
    );

    -- Synapses: weighted connections between neurons (Hebbian "fire together, wire together")
    CREATE TABLE IF NOT EXISTS synapses (
      source_id TEXT NOT NULL REFERENCES neurons(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES neurons(id) ON DELETE CASCADE,
      weight REAL DEFAULT 0.1,     -- synaptic strength (0-1)
      co_access_count INTEGER DEFAULT 1,
      last_fired TEXT,             -- ISO-8601
      created_at TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id)
    );

    -- Access log: raw event stream for learning
    CREATE TABLE IF NOT EXISTS access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      neuron_id TEXT NOT NULL REFERENCES neurons(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,    -- groups accesses within a session
      query TEXT,                  -- what the agent was looking for
      timestamp TEXT NOT NULL,
      token_cost INTEGER DEFAULT 0, -- estimated tokens used for this access
      access_order INTEGER DEFAULT 0 -- ordinal position within session (for directionality)
    );

    -- Session summaries: aggregate stats per session
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      total_accesses INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      tokens_saved INTEGER DEFAULT 0, -- estimated tokens saved by neural recall
      hit_rate REAL DEFAULT 0         -- % of accesses served by neural recall
    );

    -- Indexes for fast queries
    CREATE INDEX IF NOT EXISTS idx_neurons_type ON neurons(type);
    CREATE INDEX IF NOT EXISTS idx_neurons_myelination ON neurons(myelination DESC);
    CREATE INDEX IF NOT EXISTS idx_synapses_weight ON synapses(weight DESC);
    CREATE INDEX IF NOT EXISTS idx_access_log_session ON access_log(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_access_log_neuron ON access_log(neuron_id);
  `);

  // v2 migration: add access_order column to existing tables
  try {
    db.exec(`ALTER TABLE access_log ADD COLUMN access_order INTEGER DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  // v3 migration: add embedding BLOB column to neurons
  try {
    db.exec(`ALTER TABLE neurons ADD COLUMN embedding BLOB DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // v3.2 migration: add tagged_at column to synapses (synaptic tagging + capture)
  try {
    db.exec(`ALTER TABLE synapses ADD COLUMN tagged_at TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // v5 migration: session intent, project tagging, ignore streak
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN intent TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE neurons ADD COLUMN project TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE neurons ADD COLUMN ignore_streak INTEGER DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  // v4.0 migration: snippet neurons table
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_snippets_parent ON snippets(parent_neuron_id);
    CREATE INDEX IF NOT EXISTS idx_snippets_name ON snippets(name);
  `);

  // v6 migration: session replay table for full tool call capture
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_replay (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        ts TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tool_input TEXT,
        tool_result TEXT,
        exit_code INTEGER,
        cwd TEXT,
        duration_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_replay_session ON session_replay(session_id, seq);
      CREATE INDEX IF NOT EXISTS idx_replay_tool ON session_replay(tool_name);
      CREATE INDEX IF NOT EXISTS idx_replay_ts ON session_replay(ts);
    `);
  } catch {}
}