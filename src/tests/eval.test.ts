import { describe, test, eq, ok, sandbox } from "../testkit.js";
import { parseOpenHands, parseOmp, parseToolCall, normalizePath } from "../eval/trajectory.js";
import { scoreRanking, pairedBootstrap } from "../eval/metrics.js";
import { BaselineIndex, BASELINES } from "../eval/baselines.js";
import { repositorySplit, selectTrajectories } from "../eval/sources.js";
import { replay } from "../eval/replay.js";
import { parseEvalArgs } from "../eval/index.js";
import { HebbianEngine } from "../hebbian.js";
import type { Trajectory } from "../eval/trajectory.js";

describe("Offline evaluation", () => {
  test("OpenHands view, str_replace and bash grep normalize explicit paths", () => {
    const row = parseOpenHands({ trajectory_id: "t", instance_id: "org__project-12", repo: "org/project", resolved: 1, trajectory: [
      { role: "user", content: "Fix authentication" },
      { role: "assistant", tool_calls: [
        { function: { name: "str_replace_editor", arguments: JSON.stringify({ command: "view", path: "/workspace/project/src/auth.py" }) } },
        { function: { name: "str_replace_editor", arguments: JSON.stringify({ command: "str_replace", path: "/workspace/project/src/auth.py", old_str: "a", new_str: "b" }) } },
        { function: { name: "execute_bash", arguments: JSON.stringify({ command: "grep -n 'authenticate' src/auth.py && cat tests/test_auth.py" }) } },
      ] },
    ] });
    ok(row.events.some(e => e.kind === "read" && e.path === "src/auth.py"));
    ok(row.events.some(e => e.kind === "edit" && e.path === "src/auth.py"));
    ok(row.events.some(e => e.kind === "search" && e.query === "authenticate"));
    ok(row.events.some(e => e.kind === "read" && e.path === "tests/test_auth.py"));
    ok(row.edited_files.join() === "src/auth.py"); eq(row.created_order, 12); eq(Number(row.outcome?.resolved), 1);
    ok(row.events.every((e,i) => e.ts_index === i));
  });
  test("Path normalization excludes outside-repo and remote content", () => {
    ok(normalizePath("/etc/passwd", "org/project") === undefined);
    ok(normalizePath("../secret.txt", "org/project") === undefined);
    ok(normalizePath("skill://browser", "org/project") === undefined);
    ok(normalizePath("/home/user/project/src/a.ts:2-8", "project", "/home/user/project") === "src/a.ts");
    const events = parseToolCall("execute_bash", { command: "sed -n '1,20p' src/a.py; sed -i 's/a/b/' src/b.py" }, "repo");
    ok(events.some(e => e.kind === "read" && e.path === "src/a.py"));
    ok(events.some(e => e.kind === "edit" && e.path === "src/b.py"));
  });
  test("OMP messages parse actual calls, not duplicated execution-start records", () => {
    const t = parseOmp([
      { type: "session", id: "s", timestamp: "2026-01-01T00:00:00Z", cwd: "/home/u/repo" },
      { type: "message", message: { role: "user", content: [{ type: "text", text: "repair" }] } },
      { type: "custom", data: { toolName: "read", args: { path: "src/a.ts" } } },
      { type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "read", arguments: { path: "/home/u/repo/src/a.ts:1-10" } }] } },
    ], "fallback");
    eq(t.events.length, 2); ok(t.repo === "/home/u/repo"); ok(t.task_text === "repair"); ok(t.events[1].path === "src/a.ts");
    const nested = parseToolCall("multi_tool_use.parallel", { tool_uses: [
      { recipient_name: "functions.bash", parameters: { command: "cat src/a.ts", cwd: "/home/u/repo/project" } },
      { recipient_name: "functions.edit", parameters: { patch: "*** Begin Patch\n[/home/u/repo/project/src/a.ts#123A]\nPUT 1.=1:\n+const a = [];\n*** End Patch" } },
    ] }, "/home/u/repo", "/home/u/repo");
    ok(nested.some(e => e.kind === "read" && e.path === "project/src/a.ts"));
    ok(nested.some(e => e.kind === "edit" && e.path === "project/src/a.ts"));
    eq(nested.filter(e => e.kind === "edit").length, 1);
  });
  test("MRR, nDCG, precision and recall match hand computed cases", () => {
    const metrics = scoreRanking(["x", "a", "b", "z"], ["a", "b"]);
    eq(metrics.mrr, 0.5); eq(metrics.recall1, 0); eq(metrics.recall3, 1); eq(metrics.precision5, 0.4);
    eq(metrics.ndcg10, (1 / Math.log2(3) + 1 / Math.log2(4)) / (1 + 1 / Math.log2(3)), 1e-9);
    eq(scoreRanking(["a", "a", "x"], ["a", "b"]).recall3, 0.5);
    eq(scoreRanking([], ["a"]).mrr, 0);
  });
  test("Paired clustered bootstrap is reproducible with exact constant delta", () => {
    const values = ["a","b","c"].map(task => ({ task, brainbox: 0.75, baseline: 0.25 }));
    const result = pairedBootstrap(values, 42); eq(result.delta, 0.5); eq(result.low, 0.5); eq(result.high, 0.5);
    ok(JSON.stringify(result) === JSON.stringify(pairedBootstrap(values,42)));
  });
  test("Baselines never rank outside the provided candidate universe", () => {
    const box = sandbox("eval-candidates");
    const previous = process.env.BRAINBOX_EMBEDDINGS;
    try {
      process.env.BRAINBOX_EMBEDDINGS = "off";
      box.engine.record("src/old.ts", "file");
      const index = new BaselineIndex(); index.touch("src/old.ts", "old", "prior"); index.touch("src/new.ts", "new", "target");
      for (const baseline of BASELINES) ok(index.rank(baseline, new Set(["src/old.ts"]), "new", new Set(), 42).join() === "src/old.ts");
    } finally {
      box.close();
      if (previous === undefined) delete process.env.BRAINBOX_EMBEDDINGS; else process.env.BRAINBOX_EMBEDDINGS = previous;
    }
  });
  test("Duplicate attempts of the same issue cannot become prior task history", () => {
    const fixture = (id: string, instance: string): Trajectory => ({ id, instance_id: instance, repo: "r", created_order: Number(instance.split("-").at(-1)), task_text: "", events: [], edited_files: [] });
    const selected = selectTrajectories([fixture("b","r-2"), fixture("a","r-2"), fixture("c","r-1")], { repos: 1, maxTasksPerRepo: 20, limitTrajectories: 20 });
    eq(selected.length, 2); ok(selected[0].instance_id === "r-1"); ok(selected[1].id === "a");
  });
  test("Target events never enter memory before task or next-file probes", async () => {
    const prior: Trajectory = { id: "prior", repo: "r", created_order: 1, task_text: "old", events: [{ kind: "read", path: "old.ts", tool: "read", ts_index: 0 }], edited_files: [] };
    const target: Trajectory = { id: "target", repo: "r", created_order: 2, task_text: "new", events: [
      { kind: "edit", path: "future.ts", tool: "edit", ts_index: 0 }, { kind: "read", path: "old.ts", tool: "read", ts_index: 1 },
    ], edited_files: ["future.ts"] };
    let targetProbes = 0;
    const result = await replay([target,prior], { embeddings: false, seed: 42, probes: ["p1","p2"], engineOpts: {} }, audit => {
      if (audit.trajectory.id !== "target") return;
      targetProbes++;
      ok(!audit.candidateUniverse.has("future.ts")); ok(audit.candidateUniverse.has("old.ts"));
      const accesses = audit.db.prepare("SELECT COUNT(*) AS count FROM access_log WHERE session_id='target'").get() as { count: number };
      if (audit.eventIndex <= 0) {
        eq(accesses.count,0);
        const future = audit.db.prepare("SELECT COUNT(*) AS count FROM neurons WHERE path='future.ts'").get() as { count: number };
        eq(future.count,0);
      } else eq(accesses.count,1);
    });
    eq(targetProbes,4); eq(result.coverage["p1-edit"].eligible,0); eq(result.coverage.p2.eligible,1);
  });
  test("Fixed seed and chronological ordering reproduce metrics and paired intervals", async () => {
    const fixture = [1,2,3].map<Trajectory>(order => ({
      id: `session-${order}`, repo: "r", task_text: "authentication cache", created_order: order,
      events: [
        { kind: "tool", tool: "read", ts_index: 0 },
        { kind: "read", path: "auth.ts", tool: "read", ts_index: 1 },
        { kind: "tool", tool: "edit", ts_index: 2 },
        { kind: "edit", path: "cache.ts", tool: "edit", ts_index: 3 },
      ], edited_files: ["cache.ts"],
    }));
    const options = { embeddings: false, seed: 123, probes: ["p1","p2","p3"] as const, engineOpts: {} };
    const first = await replay(fixture, { ...options, probes: [...options.probes] });
    const second = await replay([...fixture].reverse(), { ...options, probes: [...options.probes] });
    const metrics = (result: typeof first) => result.methods.map(row => ({ probe: row.probe, method: row.method, metrics: row.metrics, abstention: row.abstentionRate }));
    ok(JSON.stringify(metrics(first)) === JSON.stringify(metrics(second)));
    ok(JSON.stringify(first.comparisons) === JSON.stringify(second.comparisons));
  });
  test("Repository dev/test splits are deterministic, disjoint and respect global rank offsets", () => {
    const fixtures = ["a","b","c","d","e"].flatMap(repo => [1,2].map<Trajectory>(order => ({
      id: `${repo}-${order}`, instance_id: `${repo}-${order}`, repo, created_order: order, task_text: "", events: [], edited_files: [],
    })));
    const opts = { repos: 5, maxTasksPerRepo: 20, limitTrajectories: 100 };
    const dev = selectTrajectories(fixtures, { ...opts, split: "dev" });
    const heldout = selectTrajectories([...fixtures].reverse(), { ...opts, split: "test" });
    ok([...new Set(dev.map(t => t.repo))].join() === "a,c,e");
    ok([...new Set(heldout.map(t => t.repo))].join() === "b,d");
    ok(dev.every(t => !heldout.some(other => other.repo === t.repo)));
    eq(dev.length + heldout.length,fixtures.length);
    const shifted = selectTrajectories(fixtures,{ ...opts, repos: 3, reposOffset: 1, split: "dev" });
    ok([...new Set(shifted.map(t => t.repo))].join() === "c");
    const hashDev = selectTrajectories(fixtures,{ ...opts,split:"dev" },"hash");
    const hashTest = selectTrajectories(fixtures,{ ...opts,split:"test" },"hash");
    eq(hashDev.length + hashTest.length,fixtures.length);
    for (const repo of ["a","b","c","d","e"]) ok(repositorySplit(repo,0,"hash") === repositorySplit(repo,99,"hash"));
    ok(JSON.stringify(hashDev) === JSON.stringify(selectTrajectories([...fixtures].reverse(),{ ...opts,split:"dev" },"hash")));
  });
  test("Alternative production engine factory and training callback keep every tool system at top three", async () => {
    const fixture = [1,2].map<Trajectory>(order => ({
      id: `tools-${order}`, repo:"r", created_order:order, task_text:"tool sequence", edited_files:[],
      events:["a","b","c","d","e","f"].map((tool,ts_index) => ({kind:"tool",tool,ts_index})),
    }));
    let engines = 0; let callbacks = 0;
    const result = await replay(fixture,{ embeddings:false,seed:42,probes:["p3"],engineOpts:{},
      engineFactory:(db,sessionId,options) => { engines++; return new HebbianEngine(db,sessionId,options); },
      onProbeResult:row => {
        callbacks++;
        ok(row.trajectoryId === "tools-2");
        ok(Object.values(row.rankings).every(ranking => ranking.length <= 3));
        eq(Object.keys(row.rankings).length,6); eq(row.gold.length,1);
      },
    });
    eq(engines,2); eq(callbacks,6);
    ok(result.comparisons.every(row => row.metric === "mrr" || row.metric === "recall3"));
  });
  test("CLI validates ablations and preserves explicit probe selection", () => {
    const opts = parseEvalArgs(["--source","omp","--probe","p2","--engine-opts",'{"lexicalFts":false}',"--seed","7","--engine","old","--split","test","--repos-offset","2"]);
    ok(opts.source === "omp" && opts.probes.join() === "p2" && opts.engineOpts.lexicalFts === false); eq(opts.seed,7);
    ok(opts.engine === "old" && opts.split === "test"); eq(opts.reposOffset,2);
    let rejected = false;
    try { parseEvalArgs(["--engine-opts",'{"unknown":true}']); } catch { rejected = true; }
    ok(rejected);
  });
});
