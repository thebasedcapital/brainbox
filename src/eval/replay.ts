import { performance } from "node:perf_hooks";
import { openDb } from "../db.js";
import { HebbianEngine } from "../hebbian.js";
import { embedText } from "../embeddings.js";
import { BASELINES, BaselineIndex } from "./baselines.js";
import { pairedBootstrap, percentile, scoreRanking } from "./metrics.js";
import type Database from "better-sqlite3";
import type { EngineOptions, RecallOptions } from "../hebbian.js";
import type { Metrics } from "./metrics.js";
import type { Trajectory } from "./trajectory.js";

export type Probe = "p1" | "p2" | "p3";
export interface ReplayMatch { neuron: { path: string }; confidence: number }
/** Production call surface only; historical engines need not expose current neuron internals. */
export interface ReplayEngine {
  record(path: string, type: "file" | "tool", query?: string, simulatedTimeMs?: number): unknown;
  recordError(error: string, query?: string, simulatedTimeMs?: number): Promise<unknown>;
  resolveError(error: string, fixes: string[], query?: string): unknown;
  recall(options: RecallOptions): Promise<ReplayMatch[]>;
  predictNext(tool?: string, candidates?: ReadonlySet<string>): { nextTools: ReplayMatch[] };
  embedAllNeurons(): Promise<unknown>;
  getLastRankingChannels?(): Readonly<Record<string, readonly string[]>>;
  getLastRankingChannelSupport?(): Readonly<Record<string, number>>;
}
export type EngineFactory = (db: Database.Database, sessionId: string, options: Partial<EngineOptions>) => ReplayEngine;
export interface ReplayOptions {
  embeddings: boolean; seed: number; probes: Probe[]; engineOpts: Partial<EngineOptions>;
  engineFactory?: EngineFactory;
  dbFactory?: (path: string) => Database.Database;
  legacyOverfetch?: boolean;
  onProbeResult?: (result: ProbeTrainingResult) => void;
}
export interface ProbeAudit { trajectory: Trajectory; probe: Probe; eventIndex: number; candidateUniverse: Set<string>; db: Database.Database }
export interface ProbeTrainingResult {
  label: string; trajectoryId: string; gold: readonly string[];
  rankings: Readonly<Record<string, readonly string[]>>;
  channels?: Readonly<Record<string, readonly string[]>>;
  channelSupport?: Readonly<Record<string, number>>;
  sessionContext: boolean;
}
interface Observation { task: string; probe: string; method: string; metrics: Metrics; latencyMs: number; tokens: number; abstained: boolean }
interface Coverage { gold: number; eligible: number; probes: number; scored: number }
export interface EvaluationSummary {
  observations: number;
  embeddingColdMs: number;
  embeddingPreparationMs: number;
  coverage: Record<string, Coverage>;
  methods: { probe: string; method: string; samples: number; metrics: Metrics; abstentionRate: number; latencyP50Ms: number; latencyP95Ms: number; meanInjectedTokens: number }[];
  comparisons: { probe: string; baseline: string; metric: "mrr" | "recall5" | "recall3"; delta: number; low: number; high: number; tasks: number }[];
}

export async function replay(trajectories: Trajectory[], opts: ReplayOptions, onProbe?: (audit: ProbeAudit) => void): Promise<EvaluationSummary> {
  const previousEnv = process.env.BRAINBOX_EMBEDDINGS;
  const observations: Observation[] = [];
  const coverage: Record<string, Coverage> = {};
  let coldMs = 0; let preparationMs = 0;
  const mode = opts.embeddings ? "on" : "off";
  process.env.BRAINBOX_EMBEDDINGS = mode;
  try {
    if (opts.embeddings) {
      const start = performance.now(); const vector = await embedText("offline coding memory evaluation"); coldMs = performance.now() - start;
      if (!vector) throw new Error("Embeddings were requested but the local embedding model could not load; no disabled fallback is scored");
    }
    const groups = new Map<string, Trajectory[]>();
    for (const t of trajectories) { const group = groups.get(t.repo) ?? []; group.push(t); groups.set(t.repo, group); }
    for (const [, tasks] of [...groups].sort((a,b) => a[0].localeCompare(b[0]))) {
      const db = (opts.dbFactory ?? openDb)(":memory:");
      const files = new BaselineIndex(); const tools = new BaselineIndex();
      let tick = 0;
      const epoch = Date.UTC(2026, 9, 8);
      try {
        for (const trajectory of tasks.sort((a,b) => a.created_order - b.created_order || a.id.localeCompare(b.id))) {
          const engineOptions = { ...opts.engineOpts, embeddings: opts.embeddings, referenceTimeMs: epoch + tick * 1000 };
          const engine: ReplayEngine = opts.engineFactory ? opts.engineFactory(db, trajectory.id, engineOptions) : new HebbianEngine(db, trajectory.id, engineOptions);
          const priorFiles = files.candidates(); const priorTools = tools.candidates();
          const touched = new Set<string>(); const touchedTools = new Set<string>();
          let context = trajectory.task_text.slice(0, 500); let previousTool: string | undefined; let pendingError: string | undefined;
          const prepareEmbeddings = async () => {
            if (!opts.embeddings) return;
            process.env.BRAINBOX_EMBEDDINGS = "on";
            const start = performance.now(); await engine.embedAllNeurons(); preparationMs += performance.now() - start;
          };
          const score = async (probe: Probe, label: string, allGold: string[], query: string, eventIndex: number) => {
            const universe = probe === "p3" ? priorTools : priorFiles;
            const gold = [...new Set(allGold)].filter(path => universe.has(path));
            const cov = coverage[label] ?? { gold: 0, eligible: 0, probes: 0, scored: 0 };
            cov.gold += new Set(allGold).size; cov.eligible += gold.length; cov.probes++; coverage[label] = cov;
            onProbe?.({ trajectory, probe, eventIndex, candidateUniverse: universe, db });
            if (!gold.length) return;
            cov.scored++;
            await prepareEmbeddings();
            process.env.BRAINBOX_EMBEDDINGS = mode;
            const start = performance.now();
            const requestedLimit = opts.legacyOverfetch ? 50 : 10;
            const results = probe === "p3" ? engine.predictNext(previousTool, universe).nextTools : await engine.recall({
              query, type: "file", limit: requestedLimit, token_budget: requestedLimit * 1500, candidatePaths: universe,
            });
            const latencyMs = performance.now() - start;
            // Historical engines cannot restrict candidates internally. Over-fetch, then enforce the
            // same final universe/top-10/15k file budget; this deliberately mildly favors old recall.
            const ranking = [...new Set(results.map(result => result.neuron.path).filter(path => universe.has(path)))].slice(0, probe === "p3" ? 3 : 10);
            const tokenEstimate = Math.ceil(ranking.slice(0, 5).map(path => `- ${path}\n`).join("").length / 4);
            observations.push({ task: trajectory.id, probe: label, method: `brainbox-${mode}`, metrics: scoreRanking(ranking, gold), latencyMs, tokens: tokenEstimate, abstained: ranking.length === 0 });
            const index = probe === "p3" ? tools : files;
            const rankingByMethod: Record<string, readonly string[]> | undefined = opts.onProbeResult ? { [`brainbox-${mode}`]: ranking } : undefined;
            for (const baseline of BASELINES) {
              const start = performance.now();
              const ranked = index.rank(baseline, universe, query, probe === "p3" ? touchedTools : touched, opts.seed + observations.length).slice(0, probe === "p3" ? 3 : 10);
              const latencyMs = performance.now() - start;
              if (rankingByMethod) rankingByMethod[baseline] = ranked;
              observations.push({ task: trajectory.id, probe: label, method: baseline, metrics: scoreRanking(ranked, gold), latencyMs,
                tokens: Math.ceil(ranked.slice(0, 5).map(path => `- ${path}\n`).join("").length / 4), abstained: ranked.length === 0 });
            }
            if (rankingByMethod) opts.onProbeResult?.({
              label, trajectoryId: trajectory.id, gold, rankings: rankingByMethod,
              channels: engine.getLastRankingChannels?.(), channelSupport: engine.getLastRankingChannelSupport?.(), sessionContext: eventIndex >= 0,
            });
          };
          if (opts.probes.includes("p1")) {
            await score("p1", "p1-edit", trajectory.edited_files, context, -1);
            const reads = trajectory.events.filter(e => e.kind === "read" && e.path).map(e => e.path!);
            await score("p1", "p1-read", reads, context, -1);
          }
          for (const event of trajectory.events) {
            if (event.kind === "tool" && opts.probes.includes("p3")) await score("p3", "p3", [event.tool], context, event.ts_index);
            if (event.path && (event.kind === "read" || event.kind === "edit") && opts.probes.includes("p2")) {
              await score("p2", "p2", [event.path], context, event.ts_index);
            }
            // No event is recorded until every probe about it has completed. Queries contain prefix context only.
            process.env.BRAINBOX_EMBEDDINGS = "off";
            const query = event.query || context;
            const time = epoch + ++tick * 1000;
            if (event.kind === "tool") {
              engine.record(event.tool, "tool", query, time); tools.touch(event.tool, query, trajectory.id); touchedTools.add(event.tool); previousTool = event.tool;
            } else if (event.kind === "error") {
              pendingError = event.query || "tool error"; await engine.recordError(pendingError, context, time);
            } else if (event.path && (event.kind === "read" || event.kind === "edit")) {
              engine.record(event.path, "file", query, time); files.touch(event.path, query, trajectory.id); touched.add(event.path);
              if (event.kind === "edit" && pendingError) { engine.resolveError(pendingError, [event.path], query); pendingError = undefined; }
            }
            if (event.query) context = `${trajectory.task_text.slice(0, 350)} ${event.query.slice(0, 150)}`;
          }
          await prepareEmbeddings();
        }
      } finally { db.close(); }
    }
  } finally {
    if (previousEnv === undefined) delete process.env.BRAINBOX_EMBEDDINGS; else process.env.BRAINBOX_EMBEDDINGS = previousEnv;
  }
  const methods: EvaluationSummary["methods"] = [];
  const comparisons: EvaluationSummary["comparisons"] = [];
  const labels = [...new Set(observations.map(row => row.probe))].sort();
  for (const probe of labels) {
    const subset = observations.filter(row => row.probe === probe);
    for (const method of [`brainbox-${mode}`, ...BASELINES]) {
      const rows = subset.filter(row => row.method === method);
      const metrics = scoreRanking([], []);
      for (const key of Object.keys(metrics) as (keyof Metrics)[]) metrics[key] = rows.reduce((sum,row) => sum + row.metrics[key],0) / Math.max(1, rows.length);
      methods.push({ probe, method, samples: rows.length, metrics, abstentionRate: rows.filter(row => row.abstained).length / Math.max(1, rows.length),
        latencyP50Ms: percentile(rows.map(row => row.latencyMs), 0.5), latencyP95Ms: percentile(rows.map(row => row.latencyMs), 0.95),
        meanInjectedTokens: rows.reduce((sum,row) => sum + row.tokens,0) / Math.max(1, rows.length) });
    }
    const brainbox = subset.filter(row => row.method === `brainbox-${mode}`);
    for (const baseline of BASELINES) {
      const rows = subset.filter(row => row.method === baseline);
      const pairedMetrics = probe === "p3" ? ["mrr", "recall3"] as const : ["mrr", "recall5"] as const;
      for (const metric of pairedMetrics) {
        const interval = pairedBootstrap(brainbox.map((row,i) => ({ task: row.task, brainbox: row.metrics[metric], baseline: rows[i].metrics[metric] })), opts.seed);
        comparisons.push({ probe, baseline, metric, ...interval });
      }
    }
  }
  return { observations: observations.length, embeddingColdMs: coldMs, embeddingPreparationMs: preparationMs, coverage, methods, comparisons };
}
