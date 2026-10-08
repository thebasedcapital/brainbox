import { describe, test, eq, ok, sandbox } from "../testkit.js";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { extractSnippetSource, extractAndStoreSnippets, searchSnippets, searchDenseSnippets, ensureSnippetVectorIndex, CHUNKER_VERSION } from "../snippets.js";
import { EMBEDDING_DIM, EMBEDDING_MODEL_ID, EMBEDDING_MODEL, serializeEmbedding, cosineSimilarity, embeddingModelStatus } from "../embeddings.js";

function vector(x: number, y: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM), norm = Math.hypot(x, y);
  v[0] = x / norm; v[1] = y / norm;
  return v;
}
function insert(db: Database.Database, id: string, parent: string, name: string, source: string, embedding: Float32Array | null, model = EMBEDDING_MODEL_ID): void {
  db.prepare(`INSERT INTO snippets(id,parent_neuron_id,path,name,kind,start_line,end_line,source,embedding,content_hash,chunker_version,model_id,dims,created_at,updated_at) VALUES (?,?,?,?,'function',1,3,? ,?,'test',?,?,?,datetime('now'),datetime('now'))`).run(id, parent, `/repo/${name}.ts`, name, source, embedding ? serializeEmbedding(embedding) : null, CHUNKER_VERSION, embedding ? model : null, embedding ? EMBEDDING_DIM : null);
}


const root = fileURLToPath(new URL("../../", import.meta.url));
function runNode(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, ["--import", "tsx", ...args], {
    cwd: root, env: { ...process.env, ...env }, input, encoding: "utf8", timeout: 15000,
  });
  if (result.error) throw result.error;
  ok(result.status === 0, result.stderr || `child exited ${result.status}`);
  return result.stdout;
}
describe("Hybrid retrieval", () => {
  test("cold-cache prompt hook finishes under four seconds with lexical snippets and no downloads", async () => {
    const s = sandbox(), dir = mkdtempSync(join(tmpdir(), "brainbox-hook-cold-"));
    const cache = join(dir, "cache"), path = join(dir, "opaque.ts"), dbPath = join(dir, "memory.db");
    mkdirSync(cache);
    try {
      writeFileSync(path, "export function quasarlexicaltoken() { /* inspect implementation */ return 'lexical fallback'; }\n");
      s.engine.seedNeuron(path);
      const neuron = s.db.prepare("SELECT id FROM neurons WHERE path = ?").get(path);
      if (!neuron || typeof neuron !== "object" || !("id" in neuron) || typeof neuron.id !== "string") throw new Error("seeded neuron missing");
      insert(s.db, "lexical-cold", neuron.id, "opaque", "function quasarlexicaltoken() { /* inspect implementation */ return 'lexical fallback'; }", null);
      await s.db.backup(dbPath);
      const started = Date.now();
      const output = runNode(["src/prompt-hook.ts"], {
        BRAINBOX_DB: dbPath, BRAINBOX_MODEL_CACHE: cache, BRAINBOX_EMBEDDINGS: "on",
        BRAINBOX_POLICY: "off", BRAINBOX_HOOK: "0",
      }, JSON.stringify({ prompt: "inspect quasarlexicaltoken implementation", cwd: dir, session_id: "cold-cache" }));
      const elapsed = Date.now() - started;
      ok(elapsed < 4000, `cold hook took ${elapsed}ms`);
      ok(output.includes(path), `lexical result missing: ${output}`);
      eq(readdirSync(cache).length, 0, 0, "hook downloaded files: ");
      console.log(`       cold-cache lexical hook: ${elapsed}ms`);
    } finally { rmSync(dir, { recursive: true, force: true }); s.close(); }
  });

  test("hook embedding deadline includes model loading and forbids remote requests", () => {
    // Real subprocess timers exercise the hook's wall-clock deadline, not a sleep-based race.
    const output = runNode(["--input-type=module", "-e", `
      import { env } from '@huggingface/transformers';
      import { embedText, HOOK_EMBEDDING_TIMEOUT_MS } from './src/embeddings.ts';
      env.useFSCache = false;
      env.useCustomCache = true;
      env.customCache = { match: async () => new Promise(() => {}), put: async () => {} };
      let fetches = 0;
      globalThis.fetch = async () => { fetches++; throw new Error('unexpected remote request'); };
      const start = Date.now();
      const result = await embedText('deadline regression');
      const elapsed = Date.now() - start;
      if (result !== null || env.allowRemoteModels || fetches || elapsed > HOOK_EMBEDDING_TIMEOUT_MS + 300) process.exit(1);
      const retry = Date.now();
      if (await embedText('second query') !== null || Date.now() - retry > 100) process.exit(2);
      console.log('deadline ' + elapsed + 'ms; remote requests ' + fetches);
      process.exit(0);
    `], { BRAINBOX_HOOK: "1", BRAINBOX_EMBEDDINGS: "on" });
    ok(output.includes("remote requests 0"));
    console.log(`       ${output.trim()}`);
  });

  test("model status distinguishes active quantization artifacts without downloading", () => {
    const dir = mkdtempSync(join(tmpdir(), "brainbox-model-status-"));
    const previous = process.env.BRAINBOX_MODEL_CACHE;
    try {
      process.env.BRAINBOX_MODEL_CACHE = dir;
      const before = embeddingModelStatus();
      ok(!before.cached, "empty cache was reported ready");
      for (const file of before.missing) {
        const path = join(dir, EMBEDDING_MODEL.id, file);
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, "fixture");
      }
      const after = embeddingModelStatus();
      ok(after.cached, "complete active-profile cache was not detected");
      eq(after.bytes, before.missing.length * 7);
    } finally {
      if (previous === undefined) delete process.env.BRAINBOX_MODEL_CACHE;
      else process.env.BRAINBOX_MODEL_CACHE = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("models status uses the configured cache without creating a memory database", () => {
    const dir = mkdtempSync(join(tmpdir(), "brainbox-model-cli-")), dbPath = join(dir, "must-not-exist.db");
    try {
      const output = runNode(["src/cli.ts", "models", "status"], {
        BRAINBOX_DB: dbPath, BRAINBOX_MODEL_CACHE: dir, BRAINBOX_EMBED_MODEL: "minilm",
      });
      ok(output.includes("Profile: minilm (fp32, 384 dims)") && output.includes("Cached: no"), output);
      ok(!existsSync(dbPath), "model management touched the memory database");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("stats reports NULL and mismatched legacy vectors and exact re-index commands", async () => {
    const s = sandbox(), dir = mkdtempSync(join(tmpdir(), "brainbox-legacy-stats-")), dbPath = join(dir, "memory.db");
    try {
      for (const name of ["legacy", "unknown", "current", "missing"]) s.engine.seedNeuron(`/repo/${name}.ts`);
      s.db.prepare("UPDATE neurons SET embedding=?, embedding_model=? WHERE path=?")
        .run(serializeEmbedding(vector(1, 0)), "legacy:384", "/repo/legacy.ts");
      s.db.prepare("UPDATE neurons SET embedding=?, embedding_model=NULL WHERE path=?")
        .run(serializeEmbedding(vector(1, 0)), "/repo/unknown.ts");
      s.db.prepare("UPDATE neurons SET embedding=?, embedding_model=? WHERE path=?")
        .run(serializeEmbedding(vector(1, 0)), EMBEDDING_MODEL_ID, "/repo/current.ts");
      const neuron = s.db.prepare("SELECT id FROM neurons WHERE path='/repo/current.ts'").get();
      if (!neuron || typeof neuron !== "object" || !("id" in neuron) || typeof neuron.id !== "string") throw new Error("seeded neuron missing");
      insert(s.db, "legacy", neuron.id, "legacy", "legacy token", vector(1, 0), "legacy:384");
      insert(s.db, "unknown", neuron.id, "unknown", "unknown token", vector(1, 0));
      s.db.prepare("UPDATE snippets SET model_id=NULL WHERE id='unknown'").run();
      insert(s.db, "current", neuron.id, "current", "current token", vector(1, 0));
      insert(s.db, "missing", neuron.id, "missing", "missing token", null);
      await s.db.backup(dbPath);
      const output = runNode(["src/cli.ts", "stats"], { BRAINBOX_DB: dbPath, BRAINBOX_EMBEDDINGS: "off" });
      ok(output.includes("Other-model neuron embeddings: 2"), output);
      ok(output.includes("Other-model snippet embeddings: 2"), output);
      ok(output.includes("brainbox extract-snippets --force") && output.includes("re-index: brainbox embed"));
    } finally { rmSync(dir, { recursive: true, force: true }); s.close(); }
  });

  test("batch neuron embedding selects mismatched and unknown fingerprints but skips current vectors", async () => {
    const s = sandbox(), previous = process.env.BRAINBOX_EMBEDDINGS;
    try {
      process.env.BRAINBOX_EMBEDDINGS = "on";
      for (const name of ["legacy", "unknown", "current"]) s.engine.seedNeuron(`/repo/${name}.ts`);
      s.db.prepare("UPDATE neurons SET embedding=?, embedding_model='legacy:384'").run(serializeEmbedding(vector(1, 0)));
      s.db.prepare("UPDATE neurons SET embedding_model=NULL WHERE path='/repo/unknown.ts'").run();
      s.db.prepare("UPDATE neurons SET embedding_model=? WHERE path='/repo/current.ts'").run(EMBEDDING_MODEL_ID);
      const visited: string[] = [];
      s.engine.embedNeuron = async id => { visited.push(id); return false; };
      await s.engine.embedAllNeurons();
      eq(visited.length, 2);
      const current = s.db.prepare("SELECT id FROM neurons WHERE path='/repo/current.ts'").get();
      if (!current || typeof current !== "object" || !("id" in current) || typeof current.id !== "string") throw new Error("seeded neuron missing");
      ok(!visited.includes(current.id), "current vector was unnecessarily reembedded");
    } finally {
      if (previous === undefined) delete process.env.BRAINBOX_EMBEDDINGS;
      else process.env.BRAINBOX_EMBEDDINGS = previous;
      s.close();
    }
  });

  test("cAST splits large entities, merges small siblings and covers module code", async () => {
    const statements = Array.from({ length: 60 }, (_, i) => `  total += input[${i}] ?? ${i};`).join("\n");
    const source = `import { readFileSync } from 'node:fs';\nconst unit = 1;\nconst scale = 2;\nexport function compute(input: number[]) {\n  let total = 0;\n${statements}\n  return total;\n}\nexport class Small {\n  first() { return 1; }\n  second() { return 2; }\n}\nconsole.log(unit, scale);`;
    const chunks = await extractSnippetSource(source, "typescript", 220);
    const large = chunks.filter(s => s.name === "compute");
    ok(large.length > 1, "large function was not split");
    ok(large.every(s => s.source.replace(/\s/g, "").length <= 220), "split exceeded character budget");
    ok(large.map(s => s.source).join("").includes("total += input[59]"), "last child disappeared");
    ok(chunks.some(s => s.kind === "chunk" && s.source.includes("const unit") && s.source.includes("const scale")), "module siblings not merged");
    ok(chunks.some(s => s.name === "Small.first"), "qualified method missing");
    ok(chunks.some(s => s.name === "Small"), "named class missing");
    ok(chunks.some(s => s.kind === "chunk" && s.source.includes("console.log")), "top-level code missing");
    ok(chunks.every(s => s.startLine <= s.endLine));
  });

  test("BM25 works without embeddings and RRF rewards consensus over single-channel hits", () => {
    const s = sandbox();
    try {
      s.engine.seedNeuron("/repo/retrieval.ts");
      const neuron = s.db.prepare("SELECT id FROM neurons WHERE path = ?").get("/repo/retrieval.ts");
      if (!neuron || typeof neuron !== "object" || !("id" in neuron) || typeof neuron.id !== "string") throw new Error("seeded neuron missing");
      const parent = neuron.id;
      insert(s.db, "lexical", parent, "fan", "fan fan fan fan fan fan", vector(0, 1));
      insert(s.db, "both", parent, "fanSpread", "fan spreading activation", vector(1, 0.05));
      insert(s.db, "dense", parent, "other", "unrelated code", vector(1, 0));
      const lexical = searchSnippets(s.db, "fan", null, 3);
      ok(lexical.length === 2 && lexical[0].snippet.id === "lexical", "BM25 ordering wrong");
      const hybrid = searchSnippets(s.db, "fan", vector(1, 0), 3);
      ok(hybrid[0].snippet.id === "both", "RRF did not favor strong consensus");
      ok(hybrid.every(m => m.confidence >= 0 && m.confidence <= 1));
      s.db.prepare("UPDATE snippets SET source = 'replacement', name = 'replacement', path = '/repo/replacement.ts' WHERE id = 'lexical'").run();
      ok(!searchSnippets(s.db, "fan", null, 3).some(m => m.snippet.id === "lexical"), "FTS update left stale terms");
      s.db.prepare("DELETE FROM snippets WHERE id = 'both'").run();
      eq(searchSnippets(s.db, "fan", null, 3).length, 0);
    } finally { s.close(); }
  });

  test("sqlite-vec cosine KNN matches brute force ordering and scores", () => {
    const s = sandbox();
    try {
      s.engine.seedNeuron("/repo/vectors.ts");
      const neuron = s.db.prepare("SELECT id FROM neurons WHERE path = ?").get("/repo/vectors.ts");
      if (!neuron || typeof neuron !== "object" || !("id" in neuron) || typeof neuron.id !== "string") throw new Error("seeded neuron missing");
      const parent = neuron.id;
      const vectors = [vector(1, 0.1), vector(1, 0.8), vector(0.8, 0.2), vector(0.2, 1)];
      vectors.forEach((v, i) => insert(s.db, `v${i}`, parent, `item${i}`, "code", v));
      ok(ensureSnippetVectorIndex(s.db), "native extension unavailable on test machine");
      const query = vector(1, 0.3);
      const expected = vectors.map((v, i) => ({ id: `v${i}`, score: cosineSimilarity(query, v) })).sort((a, b) => b.score - a.score);
      const actual = searchDenseSnippets(s.db, query, 4);
      eq(actual.length, expected.length);
      actual.forEach((match, i) => { ok(match.snippet.id === expected[i].id); eq(match.confidence, expected[i].score, 0.00001); });
      s.db.prepare("UPDATE snippets SET embedding = ? WHERE id = 'v3'").run(serializeEmbedding(query));
      ok(searchDenseSnippets(s.db, query, 4)[0].snippet.id === "v3", "vector update remained stale");
      s.db.prepare("DELETE FROM snippets WHERE id = 'v3'").run();
      ok(!searchDenseSnippets(s.db, query, 4).some(m => m.snippet.id === "v3"), "deleted vector remained indexed");
      s.db.prepare("DELETE FROM neurons WHERE id = ?").run(parent);
      eq(searchDenseSnippets(s.db, query, 4).length, 0);
    } finally { s.close(); }
  });

  test("incremental extraction skips unchanged files and atomically removes stale chunks", async () => {
    const s = sandbox(), dir = mkdtempSync(join(tmpdir(), "brainbox-retrieval-")), path = join(dir, "fixture.ts");
    try {
      s.engine.seedNeuron(path);
      const neuron = s.db.prepare("SELECT id FROM neurons WHERE path = ?").get(path);
      if (!neuron || typeof neuron !== "object" || !("id" in neuron) || typeof neuron.id !== "string") throw new Error("seeded neuron missing");
      const parent = neuron.id;
      writeFileSync(path, "export function obsolete() { return 'oldtoken'; }\n");
      ok(await extractAndStoreSnippets(s.db, path, parent, false) > 0);
      eq(await extractAndStoreSnippets(s.db, path, parent, false), 0);
      ok(searchSnippets(s.db, "oldtoken", null).length > 0);
      writeFileSync(path, "export function replacement() { return 'newtoken'; }\n");
      ok(await extractAndStoreSnippets(s.db, path, parent, false) > 0);
      eq(searchSnippets(s.db, "oldtoken", null).length, 0);
      ok(searchSnippets(s.db, "newtoken", null).length > 0);
      writeFileSync(path, "");
      eq(await extractAndStoreSnippets(s.db, path, parent, false), 0);
      const count = s.db.prepare("SELECT count(*) n FROM snippets").get();
      if (!count || typeof count !== "object" || !("n" in count) || typeof count.n !== "number") throw new Error("count missing");
      eq(count.n, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); s.close(); }
  });

  test("mismatched model and dimensions never enter dense results", () => {
    const s = sandbox();
    try {
      s.engine.seedNeuron("/repo/models.ts");
      const neuron = s.db.prepare("SELECT id FROM neurons WHERE path = ?").get("/repo/models.ts");
      if (!neuron || typeof neuron !== "object" || !("id" in neuron) || typeof neuron.id !== "string") throw new Error("seeded neuron missing");
      const parent = neuron.id;
      insert(s.db, "old-model", parent, "old", "code", vector(1, 0), "old-model:384");
      insert(s.db, "current", parent, "current", "code", vector(1, 0.1));
      insert(s.db, "bad-dims", parent, "badDims", "code", vector(1, 0));
      s.db.prepare("UPDATE snippets SET dims = 12 WHERE id = 'bad-dims'").run();
      const results = searchDenseSnippets(s.db, vector(1, 0), 10);
      eq(results.length, 1); ok(results[0].snippet.id === "current");
      eq(searchDenseSnippets(s.db, new Float32Array(12), 10).length, 0);
    } finally { s.close(); }
  });
});
