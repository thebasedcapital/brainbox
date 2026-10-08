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
  // Hooks run under a hard wall-clock budget; they set BRAINBOX_DB_TIMEOUT_MS low so a
  // locked DB fails fast instead of blocking past the hook timeout. Set before any
  // statement that may need a lock (WAL switch, migrations).
  const timeoutEnv = Number(process.env.BRAINBOX_DB_TIMEOUT_MS);
  const busyTimeout = Number.isFinite(timeoutEnv) && timeoutEnv >= 0 ? Math.floor(timeoutEnv) : 5000;
  db.pragma(`busy_timeout = ${busyTimeout}`);
  db.pragma("journal_mode = WAL");
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

  // v7 Procedures: deterministic playbook mining, incremental evidence and outcomes.
  db.exec(`
    CREATE TABLE IF NOT EXISTS procedures (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('error_fix', 'workflow')),
      trigger_key TEXT NOT NULL,
      trigger_text TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      support INTEGER NOT NULL DEFAULT 0,
      helpful INTEGER NOT NULL DEFAULT 0,
      harmful INTEGER NOT NULL DEFAULT 0,
      last_validated TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deprecated INTEGER NOT NULL DEFAULT 0,
      provenance_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_procedures_trigger ON procedures(trigger_key, deprecated);
    CREATE TABLE IF NOT EXISTS procedure_candidates (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, trigger_key TEXT NOT NULL,
      trigger_text TEXT NOT NULL, steps_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS procedure_evidence (
      candidate_id TEXT NOT NULL REFERENCES procedure_candidates(id),
      session_id TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL,
      PRIMARY KEY(candidate_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS procedure_compile_sessions (
      session_id TEXT PRIMARY KEY, replay_id INTEGER NOT NULL, access_id INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS procedure_exposures (
      procedure_id TEXT NOT NULL REFERENCES procedures(id), session_id TEXT NOT NULL,
      replay_seq INTEGER NOT NULL, surfaced_at TEXT NOT NULL, outcome INTEGER,
      PRIMARY KEY(procedure_id, session_id, replay_seq)
    );
    CREATE INDEX IF NOT EXISTS idx_procedure_exposures_pending
      ON procedure_exposures(session_id, outcome);
    CREATE INDEX IF NOT EXISTS idx_procedure_compile_replay ON session_replay(session_id, id);
    CREATE INDEX IF NOT EXISTS idx_procedure_compile_access ON access_log(session_id, id);
    CREATE INDEX IF NOT EXISTS idx_procedure_candidates_trigger ON procedure_candidates(kind, trigger_key);
  `);

  // v8 RecallPolicy: durable recall attribution and once-only contextual rewards.
  db.exec(`
    CREATE TABLE IF NOT EXISTS policy_stats (
      context_key TEXT NOT NULL, arm TEXT NOT NULL, pulls INTEGER NOT NULL DEFAULT 0,
      reward_sum REAL NOT NULL DEFAULT 0, reward_sq REAL NOT NULL DEFAULT 0,
      PRIMARY KEY(context_key, arm)
    );
    CREATE TABLE IF NOT EXISTS policy_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, ts TEXT NOT NULL,
      query_hash TEXT NOT NULL, context_key TEXT NOT NULL, arm TEXT NOT NULL,
      injected_tokens INTEGER NOT NULL DEFAULT 0, learn INTEGER NOT NULL DEFAULT 1,
      finalized INTEGER NOT NULL DEFAULT 0, reward REAL
    );
    CREATE INDEX IF NOT EXISTS idx_policy_pending ON policy_decisions(session_id, finalized);
    CREATE INDEX IF NOT EXISTS idx_policy_unflushed ON policy_decisions(finalized, ts, session_id);
    CREATE INDEX IF NOT EXISTS idx_policy_session_time ON policy_decisions(session_id, ts);
    CREATE TABLE IF NOT EXISTS recall_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, ts TEXT NOT NULL,
      query_hash TEXT NOT NULL, query_snippet TEXT NOT NULL, neuron_id TEXT NOT NULL,
      rank INTEGER NOT NULL, confidence REAL NOT NULL, activation_path TEXT NOT NULL,
      source_from TEXT, source_to TEXT, injected INTEGER NOT NULL,
      opened INTEGER NOT NULL DEFAULT 0, edited INTEGER NOT NULL DEFAULT 0, arm TEXT NOT NULL,
      decision_id INTEGER REFERENCES policy_decisions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_recall_session ON recall_events(session_id, neuron_id, injected);
    CREATE INDEX IF NOT EXISTS idx_recall_neuron ON recall_events(neuron_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_recall_decision ON recall_events(decision_id);
  `);

  // v9 RankingCore: indexed power-law history, lexical candidates and tool suffixes.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_access_neuron_timestamp ON access_log(neuron_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_access_session_order ON access_log(session_id, access_order, id);
    CREATE TABLE IF NOT EXISTS ranking_migrations (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS tool_ngrams (
      suffix TEXT NOT NULL, next_id TEXT NOT NULL REFERENCES neurons(id) ON DELETE CASCADE,
      occurrences INTEGER NOT NULL, PRIMARY KEY(suffix, next_id)
    );
  `);
  if (!db.prepare("SELECT 1 FROM ranking_migrations WHERE name = 'lexical-ngrams'").get()) {
    db.transaction(() => {
      db.exec("ALTER TABLE neurons ADD COLUMN path_tokens TEXT NOT NULL DEFAULT ''");
      const update = db.prepare("UPDATE neurons SET path_tokens = ? WHERE id = ?");
      const page = db.prepare("SELECT rowid, id, path FROM neurons WHERE rowid > ? ORDER BY rowid LIMIT 512");
      let afterRowid = 0;
      for (;;) {
        const rows = page.all(afterRowid) as { rowid: number; id: string; path: string }[];
        if (rows.length === 0) break;
        for (const row of rows) {
          update.run(row.path.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").replace(/[/._-]+/g, " "), row.id);
          afterRowid = row.rowid;
        }
      }
      db.exec(`
        CREATE VIRTUAL TABLE neuron_fts USING fts5(path_tokens, contexts,
          content='neurons', content_rowid='rowid', tokenize='porter unicode61');
        INSERT INTO neuron_fts(neuron_fts) VALUES ('rebuild');
        CREATE TRIGGER neuron_fts_insert AFTER INSERT ON neurons BEGIN
          INSERT INTO neuron_fts(rowid,path_tokens,contexts) VALUES(new.rowid,new.path_tokens,new.contexts);
        END;
        CREATE TRIGGER neuron_fts_delete AFTER DELETE ON neurons BEGIN
          INSERT INTO neuron_fts(neuron_fts,rowid,path_tokens,contexts)
            VALUES('delete',old.rowid,old.path_tokens,old.contexts);
        END;
        CREATE TRIGGER neuron_fts_update AFTER UPDATE OF path_tokens,contexts ON neurons
        WHEN old.path_tokens != new.path_tokens OR old.contexts != new.contexts BEGIN
          INSERT INTO neuron_fts(neuron_fts,rowid,path_tokens,contexts)
            VALUES('delete',old.rowid,old.path_tokens,old.contexts);
          INSERT INTO neuron_fts(rowid,path_tokens,contexts) VALUES(new.rowid,new.path_tokens,new.contexts);
        END;
      `);
      // Backfill in SQLite, not an access-log-sized JavaScript array.
      // Replay is authoritative where present; access_log covers older sessions.
      db.exec(`
        WITH events AS (
          SELECT a.session_id,a.access_order AS seq,a.id AS event_id,n.path FROM access_log a
          JOIN neurons n ON n.id=a.neuron_id WHERE n.type='tool'
            AND NOT EXISTS(SELECT 1 FROM session_replay r WHERE r.session_id=a.session_id)
          UNION ALL
          SELECT r.session_id,r.seq,r.id,r.tool_name AS path FROM session_replay r
          JOIN neurons n ON n.id='tool:' || r.tool_name
        ), history AS (
          SELECT path,
            LAG(path,1) OVER sequence AS p1,
            LAG(path,2) OVER sequence AS p2,
            LAG(path,3) OVER sequence AS p3
          FROM events WINDOW sequence AS (PARTITION BY session_id ORDER BY seq,event_id)
        ), suffixes AS (
          SELECT json_array(p1) AS suffix,'tool:' || path AS next_id FROM history WHERE p1 IS NOT NULL
          UNION ALL
          SELECT json_array(p2,p1),'tool:' || path FROM history WHERE p2 IS NOT NULL
          UNION ALL
          SELECT json_array(p3,p2,p1),'tool:' || path FROM history WHERE p3 IS NOT NULL
        )
        INSERT INTO tool_ngrams(suffix,next_id,occurrences)
        SELECT suffix,next_id,COUNT(*) FROM suffixes GROUP BY suffix,next_id;
      `);
      db.prepare("INSERT INTO ranking_migrations(name) VALUES ('lexical-ngrams')").run();
    })();
  }

  // v7 CodeGraph: incremental structural file index, separate from learned synapses.
  db.exec(`
    CREATE TABLE IF NOT EXISTS codegraph_files (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      exports_json TEXT NOT NULL,
      PRIMARY KEY (repo, path)
    );
    CREATE TABLE IF NOT EXISTS code_edges (
      repo TEXT NOT NULL,
      from_path TEXT NOT NULL,
      to_path TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('import', 'call', 'inherit')),
      count INTEGER NOT NULL,
      seeded_weight REAL NOT NULL,
      PRIMARY KEY (repo, from_path, to_path, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_code_edges_target ON code_edges(repo, to_path);
    CREATE TABLE IF NOT EXISTS codegraph_seeds (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      weight REAL NOT NULL,
      co_access_count INTEGER NOT NULL,
      PRIMARY KEY (source_id, target_id)
    );
  `);
  const codeEdgeColumns = db.pragma("table_info(code_edges)") as { name: string }[];
  if (!codeEdgeColumns.some(column => column.name === "seeded_weight")) {
    db.transaction(() => {
      db.exec("ALTER TABLE code_edges ADD COLUMN seeded_weight REAL NOT NULL DEFAULT 0");
      const update = db.prepare("UPDATE code_edges SET seeded_weight = ? WHERE repo = ? AND from_path = ? AND to_path = ? AND kind = ?");
      for (const edge of db.prepare("SELECT repo,from_path,to_path,kind,count FROM code_edges").all() as { repo: string; from_path: string; to_path: string; kind: string; count: number }[]) {
        const weight = edge.kind === "call" ? Math.min(0.95, 0.65 + Math.log1p(edge.count - 1) * 0.08) : edge.kind === "inherit" ? 0.6 : 0.35;
        update.run(weight, edge.repo, edge.from_path, edge.to_path, edge.kind);
      }
      // Legacy indexes have no learning provenance. Adopt only exact initial seed
      // snapshots; ambiguous/reinforced synapses must remain owned by learning.
      db.exec(`
        WITH directions AS (
          SELECT 'file:' || from_path AS source_id,'file:' || to_path AS target_id,seeded_weight AS weight,count FROM code_edges
          UNION ALL
          SELECT 'file:' || to_path,'file:' || from_path,seeded_weight * 0.6,count FROM code_edges
        ), seeds AS (
          SELECT source_id,target_id,MAX(weight) AS weight,SUM(count) AS co_access_count
          FROM directions GROUP BY source_id,target_id
        )
        INSERT INTO codegraph_seeds(source_id,target_id,weight,co_access_count)
        SELECT seeds.source_id,seeds.target_id,seeds.weight,seeds.co_access_count FROM seeds
        JOIN synapses live ON live.source_id=seeds.source_id AND live.target_id=seeds.target_id
          AND live.weight=seeds.weight AND live.co_access_count=seeds.co_access_count;
      `);
      // Recompute capped priors on the next full scan, even if source text is unchanged.
      db.exec("UPDATE codegraph_files SET content_hash = ''");
    })();
  }

  // v7 HybridRetrieval: versioned chunks, model fingerprints and transactional BM25.
  const snippetColumns = new Set((db.pragma("table_info(snippets)") as { name: string }[]).map(c => c.name));
  for (const [name, declaration] of Object.entries({
    path: "TEXT NOT NULL DEFAULT ''",
    signature: "TEXT NOT NULL DEFAULT ''",
    chunker_version: "TEXT NOT NULL DEFAULT 'legacy'",
    model_id: "TEXT",
    dims: "INTEGER",
  })) {
    if (!snippetColumns.has(name)) db.exec(`ALTER TABLE snippets ADD COLUMN ${name} ${declaration}`);
  }
  const neuronColumns = db.pragma("table_info(neurons)") as { name: string }[];
  if (!neuronColumns.some(c => c.name === "embedding_model")) db.exec("ALTER TABLE neurons ADD COLUMN embedding_model TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS snippet_files (
      parent_neuron_id TEXT PRIMARY KEY REFERENCES neurons(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      chunker_version TEXT NOT NULL,
      model_id TEXT
    );
    CREATE TABLE IF NOT EXISTS snippet_vector_changes (snippet_rowid INTEGER PRIMARY KEY);
  `);
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'snippet_fts'").get()) {
    db.transaction(() => {
      db.exec(`
        UPDATE snippets SET path = COALESCE((SELECT path FROM neurons WHERE id = parent_neuron_id), '');
        CREATE VIRTUAL TABLE snippet_fts USING fts5(path, name, kind, source, content='snippets', content_rowid='rowid', tokenize='porter unicode61');
        INSERT INTO snippet_fts(snippet_fts) VALUES ('rebuild');
      `);
    })();
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS snippets_fts_insert AFTER INSERT ON snippets BEGIN
      INSERT INTO snippet_fts(rowid,path,name,kind,source) VALUES (new.rowid,new.path,new.name,new.kind,new.source);
    END;
    CREATE TRIGGER IF NOT EXISTS snippets_fts_delete AFTER DELETE ON snippets BEGIN
      INSERT INTO snippet_fts(snippet_fts,rowid,path,name,kind,source) VALUES ('delete',old.rowid,old.path,old.name,old.kind,old.source);
    END;
    CREATE TRIGGER IF NOT EXISTS snippets_fts_update AFTER UPDATE ON snippets BEGIN
      INSERT INTO snippet_fts(snippet_fts,rowid,path,name,kind,source) VALUES ('delete',old.rowid,old.path,old.name,old.kind,old.source);
      INSERT INTO snippet_fts(rowid,path,name,kind,source) VALUES (new.rowid,new.path,new.name,new.kind,new.source);
    END;
    CREATE TRIGGER IF NOT EXISTS snippets_vec_insert AFTER INSERT ON snippets BEGIN
      INSERT OR IGNORE INTO snippet_vector_changes(snippet_rowid) VALUES (new.rowid);
    END;
    CREATE TRIGGER IF NOT EXISTS snippets_vec_delete AFTER DELETE ON snippets BEGIN
      INSERT OR IGNORE INTO snippet_vector_changes(snippet_rowid) VALUES (old.rowid);
    END;
    CREATE TRIGGER IF NOT EXISTS snippets_vec_update AFTER UPDATE OF embedding, model_id, dims ON snippets BEGIN
      INSERT OR IGNORE INTO snippet_vector_changes(snippet_rowid) VALUES (old.rowid);
      INSERT OR IGNORE INTO snippet_vector_changes(snippet_rowid) VALUES (new.rowid);
    END;
  `);

  // v10 RankingCore: indexed substring path semantics without LIKE scans.
  if (!db.prepare("SELECT 1 FROM ranking_migrations WHERE name='path-substrings'").get()) {
    db.transaction(() => {
      db.exec(`
        CREATE VIRTUAL TABLE neuron_path_fts USING fts5(path, content='neurons', content_rowid='rowid', tokenize='trigram');
        INSERT INTO neuron_path_fts(neuron_path_fts) VALUES ('rebuild');
        CREATE TRIGGER neuron_path_insert AFTER INSERT ON neurons BEGIN
          INSERT INTO neuron_path_fts(rowid,path) VALUES(new.rowid,new.path);
        END;
        CREATE TRIGGER neuron_path_delete AFTER DELETE ON neurons BEGIN
          INSERT INTO neuron_path_fts(neuron_path_fts,rowid,path) VALUES('delete',old.rowid,old.path);
        END;
        CREATE TRIGGER neuron_path_update AFTER UPDATE OF path ON neurons BEGIN
          INSERT INTO neuron_path_fts(neuron_path_fts,rowid,path) VALUES('delete',old.rowid,old.path);
          INSERT INTO neuron_path_fts(rowid,path) VALUES(new.rowid,new.path);
        END;
        INSERT INTO ranking_migrations(name) VALUES('path-substrings');
      `);
    })();
  }

  // v11 RankingCore: retrieve only the ten strongest outgoing edges per spread seed.
  db.exec("CREATE INDEX IF NOT EXISTS idx_synapses_source_weight ON synapses(source_id, weight DESC)");

  // v12 RankingCore: bounded frequency and recency channels for rank fusion.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_neurons_frequency ON neurons(type,access_count DESC,path);
    CREATE INDEX IF NOT EXISTS idx_neurons_recency ON neurons(type,last_accessed DESC,path);
  `);
}