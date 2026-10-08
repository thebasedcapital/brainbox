import { describe, test, eq, ok, sandbox } from "../testkit.js";
import { HebbianEngine } from "../hebbian.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../db.js";
import { CHUNKER_VERSION } from "../snippets.js";

describe("Ranking research", () => {
  test("base level favors recent frequent observations and retains a power-law tail", () => {
    const { engine, close } = sandbox();
    const now = Date.now();
    engine.record("old.ts", "file", "memory", now - 100 * 3_600_000);
    for (let i = 0; i < 5; i++) engine.record("recent.ts", "file", "memory", now - (i + 1) * 3_600_000);
    ok(engine.baseLevelActivation("file:recent.ts", now) > engine.baseLevelActivation("file:old.ts", now));
    const mass100 = Math.exp(engine.baseLevelActivation("file:old.ts", now));
    const mass400 = Math.exp(engine.baseLevelActivation("file:old.ts", now + 300 * 3_600_000));
    eq(mass400 / mass100, 0.5, 0.00001, "fourfold age halves d=.5 mass, not exponential decay: ");
    close();
  });

  test("base level bounds history to latest fifty observations", () => {
    const { engine, close } = sandbox();
    const now = Date.now();
    for (let i = 0; i < 60; i++) engine.record("many.ts", "file", undefined, now - 3_600_000);
    eq(Math.exp(engine.baseLevelActivation("file:many.ts", now)), 50, 0.00001);
    close();
  });

  test("simulated timestamps persist in neuron and access log", () => {
    const { db, engine, close } = sandbox();
    const time = Date.UTC(2020, 1, 2, 3, 4, 5);
    const neuron = engine.record("clock.ts", "file", "clock", time);
    const row = db.prepare("SELECT timestamp FROM access_log WHERE neuron_id=?").get(neuron.id) as { timestamp: string };
    ok(row.timestamp === new Date(time).toISOString());
    ok(neuron.last_accessed === row.timestamp);
    close();
  });

  test("constructor replay clock and implicit error-fix records remain time-correct", async () => {
    const { db, close } = sandbox();
    const now = Date.UTC(2020, 1, 2);
    const engine = new HebbianEngine(db, "clock", { embeddings: false, referenceTimeMs: now });
    engine.record("history.ts", "file", "history", now - 3_600_000);
    const restored = new HebbianEngine(db, "clock", { embeddings: false, referenceTimeMs: now });
    eq(restored.baseLevelActivation("file:history.ts"), 0, 0.00001);
    await restored.recordError("TypeError: x is undefined", "repair", now);
    restored.resolveError("TypeError: x is undefined", ["fixed.ts"]);
    const row = db.prepare("SELECT timestamp FROM access_log WHERE neuron_id='file:fixed.ts'").get() as { timestamp: string };
    ok(row.timestamp === new Date(now).toISOString(), "resolveError must preserve simulation time");
    close();
  });

  test("STDP preserves full forward and reduced reverse including tag capture", () => {
    const { db, close } = sandbox();
    const engine = new HebbianEngine(db, "direction", { stdpReverseFactor: 0.5 });
    engine.record("before.ts"); engine.record("after.ts");
    const forward = engine.allSynapses().find(s => s.source_id === "file:before.ts")!;
    const reverse = engine.allSynapses().find(s => s.source_id === "file:after.ts")!;
    ok(forward.weight > reverse.weight, "tag capture must not erase directional learning");
    eq(reverse.weight / forward.weight, 0.5, 0.001);
    close();
  });

  test("longest tool suffix disambiguates and backs off across invocations", () => {
    const { db, close } = sandbox();
    // Exercise single-observation suffix semantics separately from the fitted production support floor.
    const options = { toolNgrams: true, rankFusion: false, toolNgramMinSupport: 1 };
    for (const [session, tools] of [["a", ["Grep", "Read", "Edit", "Bash"]], ["b", ["Glob", "Read", "Edit", "Write"]]] as const) {
      const engine = new HebbianEngine(db, session, options);
      for (const tool of tools) engine.record(tool, "tool");
    }
    const engine = new HebbianEngine(db, "predict", options);
    for (const tool of ["Grep", "Read", "Edit"]) engine.record(tool, "tool");
    const restored = new HebbianEngine(db, "predict", options);
    const prediction = restored.predictNext().nextTools[0];
    ok(prediction.neuron.path === "Bash", "three-tool suffix distinguishes workflow");
    ok(prediction.activation_path.includes("3-gram"));
    const backoff = new HebbianEngine(db, "backoff", options);
    for (const tool of ["Unseen", "Read", "Edit"]) backoff.record(tool, "tool");
    ok(backoff.predictNext().nextTools.every(r => r.activation_path.includes("2-gram")), "unknown three-gram backs off to known two-gram");
    close();
  });

  test("tool prediction falls back to directional synapses without suffix evidence", () => {
    const { db, engine, close } = sandbox();
    engine.record("Start", "tool"); engine.record("Finish", "tool");
    db.exec("DELETE FROM tool_ngrams");
    const prediction = engine.predictNext("Start").nextTools;
    ok(prediction.some(r => r.neuron.path === "Finish"));
    close();
  });

  for (const escalated of [false, true]) {
    test(`attributed anti-recall only weakens producing edge (${escalated ? "escalated" : "flat"})`, () => {
      const { engine, close } = sandbox();
      for (const file of ["source.ts", "target.ts", "other.ts"]) engine.seedNeuron(file);
      engine.seedSynapse("source.ts", "target.ts", 0.8);
      engine.seedSynapse("other.ts", "target.ts", 0.7);
      engine.trackRecalled("file:target.ts", { from: "file:source.ts", to: "file:target.ts" });
      const result = escalated ? engine.applyAntiRecallEscalated() : engine.applyAntiRecall();
      eq(result.weakened, 1, 0);
      for (const synapse of engine.allSynapses()) {
        const expected = synapse.source_id === "file:source.ts" && synapse.target_id === "file:target.ts" ? 0.72
          : synapse.source_id === "file:target.ts" && synapse.target_id === "file:source.ts" ? 0.8 : 0.7;
        eq(synapse.weight, expected, 0.00001);
      }
      close();
    });
  }

  test("FTS retrieves tokenized camel paths, stemming, and escaped query punctuation", async () => {
    const { db, close } = sandbox();
    const engine = new HebbianEngine(db, "fts", { embeddings: false, temporalCandidates: false });
    engine.seedNeuron("src/httpClient/request_parser.ts", "file", "parsing payloads");
    for (const query of ["http client", "request parser", "parse", "quest", 'parser \" OR * (']) {
      const results = await engine.recall({ query });
      ok(results.some(r => r.neuron.path.endsWith("request_parser.ts")), `missing lexical result for ${query}`);
    }
    close();
  });

  test("session-conditioned temporal candidates recover keyword misses without cross-session seeds", async () => {
    const { db, close } = sandbox();
    const learn = new HebbianEngine(db, "learn", { embeddings: false });
    learn.seedNeuron("entry.ts"); learn.seedNeuron("dependency.ts");
    learn.seedSynapse("entry.ts", "dependency.ts", 0.8, 10);
    const engine = new HebbianEngine(db, "context", { embeddings: false, temporalCandidates: true });
    engine.record("entry.ts", "file", "unrelated");
    const results = await engine.recall({ query: "completely missed terminology" });
    ok(results.some(r => r.neuron.path === "dependency.ts" && r.source_edge?.from === "file:entry.ts"));
    const other = new HebbianEngine(db, "isolated", { embeddings: false, temporalCandidates: true });
    ok((await other.recall({ query: "completely missed terminology" })).length === 0);
    close();
  });

  test("fixed evaluation universes filter before lexical and suffix candidate limits", async () => {
    const { db, close } = sandbox();
    const engine = new HebbianEngine(db, "universe", { embeddings: false, temporalCandidates: false, toolNgrams: true });
    for (let i = 0; i < 120; i++) engine.seedNeuron(`new${i}.ts`, "file", "topic");
    engine.seedNeuron("known.ts", "file", "topic");
    const files = await engine.recall({
      query: "topic", candidatePaths: new Set(["known.ts"]), token_budget: 1500,
    });
    ok(files.length === 1 && files[0].neuron.path === "known.ts", "novel matches must not consume lexical slots or budget");
    for (let i = 0; i < 15; i++) {
      const learn = new HebbianEngine(db, `new-tool-${i}`);
      for (const tool of ["Read", `New${i}`, "Read", `New${i}`]) learn.record(tool, "tool");
    }
    const old = new HebbianEngine(db, "old-tool");
    old.record("Read", "tool"); old.record("Old", "tool");
    const tools = engine.predictNext("Read", new Set(["Old"])).nextTools;
    ok(tools.length === 1 && tools[0].neuron.path === "Old", "suffix LIMIT must apply after fixed-universe restriction");
    close();
  });

  test("explicit authentication query outranks newer popular unrelated files", async () => {
    const { db, close } = sandbox();
    const before = Date.UTC(2026, 0, 1);
    const auth = new HebbianEngine(db, "auth-history", { embeddings: false });
    auth.record("src/auth/login.ts", "file", "authentication login", before);
    const recent = new HebbianEngine(db, "unrelated", { embeddings: false });
    for (let file = 0; file < 24; file++) {
      for (let access = 0; access < 12; access++) {
        recent.record(`src/weather/forecast${file}.ts`, "file", "weather forecast rendering",
          before + 72 * 3600000 + file * 1000 + access);
      }
    }
    const results = await recent.recall({ query: "authentication login", type: "file" });
    ok(results[0]?.neuron.path === "src/auth/login.ts", "explicit topic must beat unrelated popular recent files");
    close();
  });

  test("query-conditioned spread beats unrelated popular files", async () => {
    const { db, close } = sandbox();
    const before = Date.UTC(2026, 0, 1);
    const paired = new HebbianEngine(db, "paired", { embeddings: false });
    for (let access = 0; access < 20; access++) {
      paired.record("src/checkout/transaction.ts", "file", "settlement transaction", before + access * 2);
      paired.record("src/storage/journal.ts", "file", "persistence storage", before + access * 2 + 1);
    }
    const recent = new HebbianEngine(db, "unrelated", { embeddings: false });
    for (let file = 0; file < 24; file++) {
      for (let access = 0; access < 40; access++) {
        recent.record(`src/weather/forecast${file}.ts`, "file", "weather forecast rendering",
          before + 72 * 3600000 + file * 1000 + access);
      }
    }
    const results = await recent.recall({ query: "settlement transaction", type: "file" });
    const partnerRank = results.findIndex(result => result.neuron.path === "src/storage/journal.ts");
    ok(partnerRank >= 0 && partnerRank < 3, "strong nonlexical partner must beat unrelated popular recent files");
    ok(results[partnerRank].source_edge?.from === "file:src/checkout/transaction.ts", "spread keeps producing edge");
    close();
  });

  test("legacy database migration backfills lexical paths and tool suffixes once", async () => {
    const directory = mkdtempSync(join(tmpdir(), "brainbox-ranking-"));
    const path = join(directory, "legacy.db");
    let db = openDb(path);
    try {
      const old = new HebbianEngine(db, "legacy", { embeddings: false });
      old.seedNeuron("src/httpClient.ts", "file", "network transport");
      for (const tool of ["Grep", "Read", "Edit"]) old.record(tool, "tool");
      // Reconstruct the pre-ranking schema while retaining genuine historical rows.
      db.exec(`
        DROP TRIGGER neuron_fts_insert; DROP TRIGGER neuron_fts_delete; DROP TRIGGER neuron_fts_update;
        DROP TRIGGER neuron_path_insert; DROP TRIGGER neuron_path_delete; DROP TRIGGER neuron_path_update;
        DROP TABLE neuron_fts; DROP TABLE neuron_path_fts;
        DROP TABLE tool_ngrams; DROP TABLE ranking_migrations;
        ALTER TABLE neurons DROP COLUMN path_tokens;
      `);
      db.close();
      db = openDb(path);
      const migrated = new HebbianEngine(db, "query", { embeddings: false, temporalCandidates: false });
      ok((await migrated.recall({ query: "http client" })).some(r => r.neuron.path === "src/httpClient.ts"));
      ok(migrated.predictNext("Read").nextTools[0]?.neuron.path === "Edit");
      // SQL SUM over the nonempty suffix table returns a numeric n.
      const before = db.prepare("SELECT SUM(occurrences) AS n FROM tool_ngrams").get() as { n: number };
      db.close();
      db = openDb(path);
      const after = db.prepare("SELECT SUM(occurrences) AS n FROM tool_ngrams").get() as { n: number };
      eq(after.n, before.n, 0,
        "reopening must not double-count historic suffixes: ");
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("lexical rank fusion scales by verbatim query-term coverage over porter stems", async () => {
    const { db, close } = sandbox();
    const before = Date.UTC(2026, 0, 1);
    const engine = new HebbianEngine(db, "coverage", { embeddings: false });
    // Matches "consolidation"/"memory" only through the porter stem (consolid/,
    // memor-) and "sleep"/"learning" not at all: zero verbatim term coverage.
    for (let access = 0; access < 5; access++) {
      engine.record("src/ticker/status.ts", "file", "consolidated memorisation of somnolent states",
        before + access * 1000);
    }
    // Verbatim match on three of the four query terms, recorded older and less often.
    for (let access = 0; access < 5; access++) {
      engine.record("src/memory/routine.ts", "file", "sleep learning replay",
        before - 3600000 + access * 1000);
    }
    const results = await engine.recall({ query: "memory consolidation sleep learning", type: "file" });
    ok(results[0]?.neuron.path === "src/memory/routine.ts",
      "file matching 3/4 query terms verbatim must outrank a stem-only match");
    close();
  });

  test("snippet evidence forms a fusion channel that can surface files on its own", async () => {
    const { db, close } = sandbox();
    const before = Date.UTC(2026, 0, 1);
    const engine = new HebbianEngine(db, "snippets", { embeddings: false });
    engine.record("src/graph/spread.ts", "file", "ui component plumbing", before);
    engine.record("src/ui/button.ts", "file", "button rendering", before);
    db.prepare(
      `INSERT INTO snippets(id,parent_neuron_id,path,name,kind,start_line,end_line,source,embedding,content_hash,chunker_version,model_id,dims,created_at,updated_at)
       VALUES (?,?,?,?,'function',1,3,?,NULL,'test',?,?,NULL,datetime('now'),datetime('now'))`,
    ).run("snippet-1", "file:src/graph/spread.ts", "src/graph/spread.ts", "propagate",
      "spreading activation across the graph nodes", CHUNKER_VERSION, null);
    const results = await engine.recall({ query: "spreading activation graph", type: "file" });
    ok(results[0]?.neuron.path === "src/graph/spread.ts",
      "snippet-only evidence must surface the parent file");
    ok(results[0]?.activation_path.includes("snippet"), "snippet discovery must be labeled");
    close();
  });
});
