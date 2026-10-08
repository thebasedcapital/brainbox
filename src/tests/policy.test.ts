import { describe, test, eq, ok, sandbox } from "../testkit.js";
import { ARM_LIMIT, beginPolicyDecision, compactRecall, flushPolicySession, logRecallEvents,
  explainRecall, markRecallAccess, POLICY_TOKEN_COST, policyContext, selectPolicyArm } from "../policy.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { KiloAdapter } from "../adapters/kilo.js";
import type { RecallResult } from "../hebbian.js";
import { performRecall } from "../adapter.js";
import { openDb } from "../db.js";
import { HebbianEngine } from "../hebbian.js";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function runBandit(hits: boolean) {
  const { db, engine, close } = sandbox("policy-training");
  const results: RecallResult[] = Array.from({ length: 5 }, (_, i) => ({
    neuron: engine.record(`/project/file${i}.ts`, "file", "refactor code"),
    confidence: 0.9, activation_path: "context", estimated_tokens_saved: 100,
  }));
  const counts: Record<string, number> = {};
  for (let i = 0; i < 2000; i++) {
    const arm = selectPolicyArm(db, "training", true);
    const session = `round-${i}`;
    const selected = results.slice(0, ARM_LIMIT[arm]);
    const decision = beginPolicyDecision(db, session, "refactor", "training", arm, selected.length * 160);
    logRecallEvents(db, decision, session, "refactor", results, new Set(selected.map(r => r.neuron.id)), arm);
    if (hits) for (const rank of [2, 3]) markRecallAccess(db, session, results[rank - 1].neuron.id);
    flushPolicySession(db, session);
    if (i >= 1800) counts[arm] = (counts[arm] || 0) + 1;
  }
  close();
  return counts;
}

describe("Injection policy", () => {
  test("ignored injections converge to SILENT", () => {
    const counts = runBandit(false);
    ok((counts.SILENT || 0) >= 180, JSON.stringify(counts));
  });
  test("rank two and three hits converge to TOP3", () => {
    const counts = runBandit(true);
    ok((counts.TOP3 || 0) >= 180, JSON.stringify(counts));
  });
  test("conservative prior and disabled policy keep TOP5", () => {
    const { db, close } = sandbox();
    ok(selectPolicyArm(db, "new", true) === "TOP5");
    ok(selectPolicyArm(db, "new", false) === "TOP5");
    ok(policyContext("fix Error in file", 0.9, true, false) === "high:error:project:later");
    close();
  });
  test("recall events account edited and opened rank rewards exactly once", () => {
    const { db, engine, close } = sandbox();
    const results: RecallResult[] = [1, 2, 3].map(i => ({ neuron: engine.record(`/p/${i}.ts`, "file"),
      confidence: 0.8, activation_path: "spread", estimated_tokens_saved: 100,
      source_edge: { from: "file:/p/seed.ts", to: `file:/p/${i}.ts` } }));
    const decision = beginPolicyDecision(db, "reward", "code", "context", "TOP3", 400);
    logRecallEvents(db, decision, "reward", "code", results, new Set(results.map(r => r.neuron.id)), "TOP3");
    markRecallAccess(db, "another-session", results[0].neuron.id);
    markRecallAccess(db, "reward", results[1].neuron.id);
    markRecallAccess(db, "reward", results[2].neuron.id, true);
    const outcome = flushPolicySession(db, "reward");
    eq(outcome.reward, 1 / 2 + 1.5 / 3 - POLICY_TOKEN_COST * 100 / 1000);
    eq(flushPolicySession(db, "reward").decisions, 0);
    const row = db.prepare("SELECT pulls, reward_sum, reward_sq FROM policy_stats WHERE context_key='context'")
      .get() as { pulls: number; reward_sum: number; reward_sq: number };
    eq(row.pulls, 1); eq(row.reward_sum, outcome.reward); eq(row.reward_sq, outcome.reward ** 2);
    const unopened = db.prepare("SELECT opened FROM recall_events WHERE rank=1").get() as { opened: number };
    eq(unopened.opened, 0);
    close();
  });
  test("interleaved tool and file citations retain presentation ranks, rewards and explanation", () => {
    const { db, engine, close } = sandbox();
    try {
      const file: RecallResult = { neuron: engine.record("/p/target.ts", "file"),
        confidence: 0.8, activation_path: "context", estimated_tokens_saved: 100 };
      const omitted: RecallResult = { neuron: engine.record("/p/omitted.ts", "file"),
        confidence: 0.7, activation_path: "context", estimated_tokens_saved: 100 };
      const tool: RecallResult = { neuron: engine.record("mcp__memory__search", "tool"),
        confidence: 0.9, activation_path: "context", estimated_tokens_saved: 100 };
      const truncated: RecallResult = { neuron: engine.record("/p/truncated.ts", "file"),
        confidence: 0.6, activation_path: "context", estimated_tokens_saved: 100 };
      const budget = compactRecall([tool, file]).text.length;
      const formatted = compactRecall([tool, file, truncated], budget);
      eq(formatted.included.length, 2);
      ok(formatted.text.includes(`1. ${tool.neuron.path}`));
      ok(formatted.text.includes(`2. ${file.neuron.path}`));
      const decision = beginPolicyDecision(db, "interleaved", "memory", "mixed", "TOP3", budget);
      logRecallEvents(db, decision, "interleaved", "memory", [file, omitted, truncated, tool],
        new Set(formatted.included.map(result => result.neuron.id)), "TOP3");
      const rows = db.prepare("SELECT neuron_id, rank, injected FROM recall_events ORDER BY rank").all() as {
        neuron_id: string; rank: number; injected: number;
      }[];
      ok(rows[0].neuron_id === tool.neuron.id); eq(rows[0].rank, 1); eq(rows[0].injected, 1);
      ok(rows[1].neuron_id === file.neuron.id); eq(rows[1].rank, 2); eq(rows[1].injected, 1);
      ok(rows[2].neuron_id === omitted.neuron.id); eq(rows[2].rank, 3); eq(rows[2].injected, 0);
      ok(rows[3].neuron_id === truncated.neuron.id); eq(rows[3].rank, 4); eq(rows[3].injected, 0);
      const explanation = explainRecall(db, { sessionId: "interleaved", rank: 1 }) as {
        neuron: { id: string };
      };
      ok(explanation.neuron.id === tool.neuron.id);
      const excludedExplanation = explainRecall(db, { sessionId: "interleaved", rank: 3 });
      ok(excludedExplanation !== null && typeof excludedExplanation === "object" &&
        "status" in excludedExplanation && excludedExplanation.status === "not_found");
      markRecallAccess(db, "interleaved", tool.neuron.id);
      markRecallAccess(db, "interleaved", file.neuron.id, true);
      markRecallAccess(db, "interleaved", omitted.neuron.id, true);
      eq(flushPolicySession(db, "interleaved").reward,
        1 + 1.5 / 2 - POLICY_TOKEN_COST * Math.ceil(budget / 4) / 1000);
    } finally {
      close();
    }
  });
  test("deleted recalled files are skipped, refilled and absent from the prompt hook", async () => {
    const root = mkdtempSync(join(tmpdir(), "brainbox-policy-deleted-"));
    const dbPath = join(root, "memory.db");
    const previousDb = process.env.BRAINBOX_DB;
    const db = openDb(dbPath);
    try {
      process.env.BRAINBOX_DB = dbPath;
      const engine = new HebbianEngine(db, "seed");
      const paths = [join(root, "memory-first.ts"), join(root, "memory-second.ts")];
      const query = "repair memory implementation";
      for (const path of paths) {
        writeFileSync(path, "export const memory = 1;\n");
        for (let i = 0; i < 12; i++) engine.record(path, "file", query);
      }
      const opts = { cwd: root, sessionId: "deleted", limit: 1, policy: false };
      const before = await performRecall(query, opts);
      ok(before !== null, "fixture must inject a real recalled file before deletion");
      const shown = db.prepare(`SELECT n.path FROM recall_events r JOIN neurons n ON n.id=r.neuron_id
        WHERE r.session_id='deleted' AND r.injected=1 ORDER BY r.id DESC LIMIT 1`).get() as { path: string };
      const survivor = paths.find(path => path !== shown.path)!;
      unlinkSync(shown.path);
      const after = await performRecall(query, opts);
      ok(after?.includes(`1. ${survivor}`) === true, "deleted top candidate must be refilled by the surviving file");
      ok(!after?.includes(shown.path), "deleted path must not appear in injected text");
      const events = db.prepare(`SELECT n.path, r.rank, r.injected FROM recall_events r JOIN neurons n ON n.id=r.neuron_id
        WHERE r.decision_id=(SELECT MAX(id) FROM policy_decisions WHERE session_id='deleted') ORDER BY r.rank`)
        .all() as { path: string; rank: number; injected: number }[];
      ok(events[0].path === survivor); eq(events[0].rank, 1); eq(events[0].injected, 1);
      const stale = events.find(event => event.path === shown.path);
      ok(stale !== undefined, "stale candidate remains in recall history");
      eq(stale!.injected, 0); ok(stale!.rank > 1);
      const hook = spawnSync(process.execPath,
        ["--import", "tsx", fileURLToPath(new URL("../prompt-hook.ts", import.meta.url))], {
          input: JSON.stringify({ prompt: query, cwd: root, session_id: "deleted-hook" }),
          env: { ...process.env, BRAINBOX_DB: dbPath, BRAINBOX_POLICY: "off" },
          encoding: "utf8", timeout: 6000,
        });
      eq(hook.status ?? -1, 0, 0, hook.stderr || hook.error?.message);
      ok(hook.stdout.includes(survivor), "prompt hook must actually inject the surviving file");
      ok(!hook.stdout.includes(shown.path), "prompt hook must not inject the recalled deleted file");
    } finally {
      if (previousDb === undefined) delete process.env.BRAINBOX_DB;
      else process.env.BRAINBOX_DB = previousDb;
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("hook events mark only actual reads and edits, not search matches", () => {
    const { db, engine, close } = sandbox();
    const neuron = engine.record("/p/target.ts", "file");
    const result: RecallResult = { neuron, confidence: 0.8, activation_path: "context", estimated_tokens_saved: 100 };
    const decision = beginPolicyDecision(db, "hook", "code", "context", "TOP1", 100);
    logRecallEvents(db, decision, "hook", "code", [result], new Set([neuron.id]), "TOP1");
    const adapter = new ClaudeCodeAdapter();
    for (const tool of ["Grep", "Read", "Edit"]) {
      const events = adapter.extractEvents({ tool_name: tool, tool_input: { file_path: neuron.path }, tool_result: neuron.path });
      for (const event of events) if (event.type === "file" && event.access) {
        markRecallAccess(db, "hook", `file:${event.path}`, event.access === "edit");
      }
      const row = db.prepare("SELECT opened, edited FROM recall_events").get() as { opened: number; edited: number };
      eq(row.opened, tool === "Grep" ? 0 : 1); eq(row.edited, tool === "Edit" ? 1 : 0);
    }
    const kiloEvents = new KiloAdapter().extractEvents({ type: "tool_use", part: { tool: "read_file",
      state: { status: "completed", input: { path: neuron.path } } } });
    ok(kiloEvents.some(event => event.access === "open"));
    close();
  });
  test("compact formatter includes line ranges and respects all budgets", () => {
    const { engine, close } = sandbox();
    const neuron = engine.record("/p/policy.ts", "file");
    const result: RecallResult = { neuron, confidence: 0.9, activation_path: "one two three four five six seven eight nine ten",
      estimated_tokens_saved: 100, snippets: [{ confidence: 0.9, snippet: {
        id: "snippet", parent_neuron_id: neuron.id, path: neuron.path, name: "choose", kind: "function",
        start_line: 10, end_line: 25, source: "function choose() {}", signature: "choose()",
        embedding: null, content_hash: "hash", chunker_version: "test", model_id: null, dims: null,
      } }] };
    const full = compactRecall([result]);
    ok(full.text.includes("/p/policy.ts:10-25"));
    ok(full.text.includes("one two three four five six seven eight"));
    ok(!full.text.includes("nine"));
    for (const budget of [0, 10, 50, 100, 1800]) ok(compactRecall([result], budget).text.length <= budget);
    eq(compactRecall([result], full.text.length - 1).included.length, 0);
    close();
  });
});
