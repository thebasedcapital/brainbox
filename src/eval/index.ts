import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ENGINE_OPTIONS } from "../hebbian.js";
import { loadNebius, loadOmp } from "./sources.js";
import { replay } from "./replay.js";
import { LEGACY_COMMIT, loadReplayEngine } from "./engines.js";
import type { EvaluationSplit } from "./sources.js";
import type { EngineOptions } from "../hebbian.js";
import type { Probe, EvaluationSummary } from "./replay.js";

export interface EvalOptions {
  source: "nebius" | "omp"; repos: number; maxTasksPerRepo: number; limitTrajectories: number;
  embeddings: boolean; probes: Probe[]; seed: number; json: boolean; engineOpts: Partial<EngineOptions>;
  engine: "old" | "new"; split?: EvaluationSplit; reposOffset: number;
}
export function parseEvalArgs(args: string[]): EvalOptions {
  const values: Record<string, string> = {};
  const allowed: Record<string, true> = { source: true, repos: true, "max-tasks-per-repo": true, "limit-trajectories": true, embeddings: true, probe: true, seed: true, json: true, "engine-opts": true, engine: true, split: true, "repos-offset": true };
  for (let i = 0; i < args.length; i++) {
    const match = args[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!match || !allowed[match[1]]) throw new Error(`Unknown eval argument: ${args[i]}`);
    const key = match[1];
    if (key === "json") { values.json = "true"; continue; }
    const value = match[2] ?? args[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value`);
    values[key] = value;
  }
  const source = values.source ?? "nebius";
  if (source !== "nebius" && source !== "omp") throw new Error("--source must be nebius or omp");
  const embeddings = values.embeddings ?? process.env.BRAINBOX_EMBEDDINGS ?? "off";
  if (embeddings !== "on" && embeddings !== "off") throw new Error("--embeddings must be on or off");
  const engine = values.engine ?? "new";
  if (engine !== "old" && engine !== "new") throw new Error("--engine must be old or new");
  const split = values.split;
  if (split !== undefined && split !== "dev" && split !== "test") throw new Error("--split must be dev or test");
  const reposOffset = Number(values["repos-offset"] ?? 0);
  if (!Number.isInteger(reposOffset) || reposOffset < 0) throw new Error("--repos-offset must be a nonnegative integer");
  const probes = (values.probe ?? "p1,p2,p3").split(",");
  if (!probes.length || probes.some(probe => !["p1", "p2", "p3"].includes(probe))) throw new Error("--probe must be a comma-separated selection of p1,p2,p3");
  const engineOpts: Partial<EngineOptions> = {};
  if (values["engine-opts"]) {
    const parsed: unknown = JSON.parse(values["engine-opts"]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--engine-opts must be a JSON object");
    for (const [key, value] of Object.entries(parsed)) {
      const defaults: Record<string, unknown> = DEFAULT_ENGINE_OPTIONS;
      if (!Object.hasOwn(defaults, key) && key !== "referenceTimeMs") throw new Error(`Unknown engine option: ${key}`);
      const expected = key === "referenceTimeMs" ? "number" : typeof defaults[key];
      if (typeof value !== expected || (typeof value === "number" && !Number.isFinite(value))) throw new Error(`Invalid engine option ${key}: expected ${expected}`);
      Object.assign(engineOpts, { [key]: value });
    }
  }
  const repos = Number(values.repos ?? 5); const maxTasksPerRepo = Number(values["max-tasks-per-repo"] ?? 20);
  const limitTrajectories = Number(values["limit-trajectories"] ?? repos * maxTasksPerRepo); const seed = Number(values.seed ?? 42);
  if ([repos,maxTasksPerRepo,limitTrajectories].some(value => !Number.isInteger(value) || value < 1)) throw new Error("Repo/task/trajectory limits must be positive integers");
  if (!Number.isSafeInteger(seed)) throw new Error("--seed must be an integer");
  return { source, repos, maxTasksPerRepo, limitTrajectories, embeddings: embeddings === "on", probes: [...new Set(probes)] as Probe[], seed, json: values.json === "true", engineOpts, engine, split, reposOffset };
}
export function formatTable(summary: EvaluationSummary): string {
  const lines = ["| Probe | Method | N | R@1 | R@3 | R@5 | R@10 | MRR | nDCG@10 | P@5 | Abstain | p50/p95 ms | Tokens |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"];
  for (const row of summary.methods.filter(row => row.probe !== "p3")) {
    const m = row.metrics;
    lines.push(`| ${row.probe} | ${row.method} | ${row.samples} | ${m.recall1.toFixed(3)} | ${m.recall3.toFixed(3)} | ${m.recall5.toFixed(3)} | ${m.recall10.toFixed(3)} | ${m.mrr.toFixed(3)} | ${m.ndcg10.toFixed(3)} | ${m.precision5.toFixed(3)} | ${row.abstentionRate.toFixed(3)} | ${row.latencyP50Ms.toFixed(2)}/${row.latencyP95Ms.toFixed(2)} | ${row.meanInjectedTokens.toFixed(1)} |`);
  }
  const tools = summary.methods.filter(row => row.probe === "p3");
  if (tools.length) {
    lines.push("", "| Probe | Method | N | R@1 | R@3 | MRR@3 | Abstain | p50/p95 ms | Tokens |", "|---|---|---:|---:|---:|---:|---:|---:|---:|");
    for (const row of tools) lines.push(`| p3 | ${row.method} | ${row.samples} | ${row.metrics.recall1.toFixed(3)} | ${row.metrics.recall3.toFixed(3)} | ${row.metrics.mrr.toFixed(3)} | ${row.abstentionRate.toFixed(3)} | ${row.latencyP50Ms.toFixed(2)}/${row.latencyP95Ms.toFixed(2)} | ${row.meanInjectedTokens.toFixed(1)} |`);
  }
  lines.push("", "BrainBox minus baseline, paired trajectory-cluster bootstrap (1,000 seeded resamples; 95% CI):");
  for (const toolMode of [false, true]) {
    const comparisons = summary.comparisons.filter(row => row.metric === "mrr" && (row.probe === "p3") === toolMode);
    if (!comparisons.length) continue;
    lines.push("", `| Probe | Baseline | ${toolMode ? "MRR@3" : "MRR"} delta [95% CI] | Recall@${toolMode ? "3" : "5"} delta [95% CI] |`, "|---|---|---:|---:|");
    for (const row of comparisons) {
      const recall = summary.comparisons.find(item => item.probe === row.probe && item.baseline === row.baseline && item.metric === (toolMode ? "recall3" : "recall5"))!;
      lines.push(`| ${row.probe} | ${row.baseline} | ${row.delta.toFixed(3)} [${row.low.toFixed(3)}, ${row.high.toFixed(3)}] | ${recall.delta.toFixed(3)} [${recall.low.toFixed(3)}, ${recall.high.toFixed(3)}] |`);
    }
  }
  lines.push("", "Coverage (gold already seen in prior trajectories; novel files/tools excluded from ranking scores):");
  for (const [probe, row] of Object.entries(summary.coverage)) lines.push(`- ${probe}: ${row.eligible}/${row.gold} gold (${(100 * row.eligible / Math.max(1,row.gold)).toFixed(1)}%); ${row.scored}/${row.probes} probes scored`);
  lines.push("", `Embedding cold load: ${summary.embeddingColdMs.toFixed(1)} ms; document preparation: ${summary.embeddingPreparationMs.toFixed(1)} ms. Token estimate: top-5 '- path' characters / 4 (not observed token savings).`);
  return lines.join("\n");
}
export async function runEval(args: string[]): Promise<void> {
  const options = parseEvalArgs(args);
  const engine = await loadReplayEngine(options.engine, options.embeddings);
  const source = options.source === "nebius" ? await loadNebius(options) : await loadOmp(options);
  const summary = await replay(source.trajectories, { ...options, ...engine });
  const reportedSummary = { ...summary,
    methods: summary.methods.map(row => row.probe === "p3" ? { ...row, metrics: { recall1: row.metrics.recall1, recall3: row.metrics.recall3, mrrAt3: row.metrics.mrr } } : row),
    comparisons: summary.comparisons.map(row => row.probe === "p3" && row.metric === "mrr" ? { ...row, metric: "mrrAt3" } : row),
  };
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = join(process.cwd(), "eval-results", timestamp);
  await mkdir(directory, { recursive: true });
  // Never serialize local task text, events, paths or sessions into result artifacts.
  const result = { timestamp, options, trajectories: source.trajectories.length, source: source.metadata,
    protocol: { history: "strict prior trajectories; candidate universe fixed at target start", duplicate_issues: "one attempt per instance",
      gold: "edited and read files separately; prefix-only next access and next tool", confidence_intervals: "paired trajectory-cluster bootstrap",
      file_rank_limit: 10, file_token_budget: 15000, tool_rank_limit: 3, metrics_conditioned_on_prior_coverage: true,
      legacy_commit: options.engine === "old" ? LEGACY_COMMIT : undefined,
      legacy_overfetch: options.engine === "old" ? "inner top50/75k, then outer fixed universe top10/15k; mildly favors old recall" : undefined,
      legacy_clock: options.engine === "old" ? "original wall-clock timestamp behavior retained" : undefined,
      seed: options.seed }, summary: reportedSummary };
  await writeFile(join(directory, "results.json"), JSON.stringify(result, null, 2) + "\n");
  if (options.json) console.log(JSON.stringify(result, null, 2)); else console.log(formatTable(summary));
  console.error(`Results: ${join(directory, "results.json")}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runEval(process.argv.slice(2)).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
