/**
 * BrainBox Benchmark Runner
 *
 * Executes scenarios in isolated in-memory databases with deterministic timing.
 * Runs each scenario N times and aggregates results with mean ± std.
 */

import { openDb } from "./db.js";
import { HebbianEngine } from "./hebbian.js";
import type { DecayResult, ConsolidationResult, HomeostasisResult } from "./hebbian.js";
import type { BenchmarkScenario } from "./benchmark-scenarios.js";
import {
  collectSessionSnapshot,
  collectSpreadingMetrics,
  collectPrecisionRecall,
  collectToolPredictions,
  mean,
  stddev,
  type SessionSnapshot,
  type BenchmarkMetrics,
  type SpreadingMetrics,
  type PrecisionRecallMetrics,
  type ToolPredictionMetrics,
} from "./benchmark-metrics.js";

// --- Result Types ---

export interface SingleRunResult {
  scenario_id: string;
  run_number: number;
  seed: number;
  metrics: BenchmarkMetrics;
  execution_time_ms: number;
}

export interface AggregatedSnapshot {
  session_num: number;
  gross_savings_pct: { mean: number; std: number };
  net_savings_pct: { mean: number; std: number };
  tokens_saved: { mean: number; std: number };
  recall_served_pct: { mean: number; std: number };
  high_confidence_pct: { mean: number; std: number };
  avg_myelination: { mean: number; std: number };
  max_myelination: { mean: number; std: number };
  superhighway_count: { mean: number; std: number };
  neuron_count: { mean: number; std: number };
  synapse_count: { mean: number; std: number };
  avg_synapse_weight: { mean: number; std: number };
}

export interface AggregatedResult {
  scenario_id: string;
  scenario_name: string;
  runs: number;
  snapshots: AggregatedSnapshot[];
  spreading: {
    direct_pct: { mean: number; std: number };
    hop1_pct: { mean: number; std: number };
    hop2_pct: { mean: number; std: number };
    hop3_pct: { mean: number; std: number };
    avg_conf_direct: { mean: number; std: number };
    avg_conf_hop1: { mean: number; std: number };
    avg_conf_hop2: { mean: number; std: number };
    avg_conf_hop3: { mean: number; std: number };
  };
  precision_recall: {
    precision: { mean: number; std: number };
    recall: { mean: number; std: number };
    f1: { mean: number; std: number };
  };
  tool_predictions: {
    top1_accuracy: { mean: number; std: number };
    top3_accuracy: { mean: number; std: number };
  };
  avg_execution_time_ms: number;
}

// --- Runner ---

export class BenchmarkRunner {
  constructor(
    private repeats: number = 5,
    private verbose: boolean = false,
  ) {}

  async runScenario(scenario: BenchmarkScenario): Promise<AggregatedResult> {
    const runs: SingleRunResult[] = [];

    for (let i = 0; i < this.repeats; i++) {
      const seed = 1000 + i; // deterministic seeds
      if (this.verbose) {
        process.stdout.write(`  Run ${i + 1}/${this.repeats}...`);
      }
      const startMs = Date.now();
      const result = await this.runOnce(scenario, seed, i + 1);
      result.execution_time_ms = Date.now() - startMs;
      runs.push(result);
      if (this.verbose) {
        console.log(` done (${result.execution_time_ms}ms)`);
      }
    }

    return this.aggregate(scenario, runs);
  }

  private async runOnce(
    scenario: BenchmarkScenario,
    seed: number,
    runNumber: number,
  ): Promise<SingleRunResult> {
    const db = openDb(":memory:");
    const engine = new HebbianEngine(db, `bench-${scenario.id}-${seed}`);

    const snapshots: SessionSnapshot[] = [];
    const decayResults: DecayResult[] = [];
    const consolidationResults: ConsolidationResult[] = [];
    const homeostasisResults: HomeostasisResult[] = [];

    // Simulate time progression
    let simTime = Date.now() - (scenario.sessions.length * 86_400_000); // start in "past"

    for (let sessionIdx = 0; sessionIdx < scenario.sessions.length; sessionIdx++) {
      const session = scenario.sessions[sessionIdx];
      const sessionNum = sessionIdx + 1;

      // Record all file/tool/error accesses in this session
      for (const access of session.files) {
        simTime += 5_000; // 5 seconds between accesses within session
        engine.record(
          access.path,
          access.type || "file",
          access.query,
          simTime,
        );
      }

      // Collect snapshot at checkpoints
      if (scenario.checkpoints.includes(sessionNum)) {
        snapshots.push(collectSessionSnapshot(engine, sessionNum));
      }

      // Run consolidation at milestones
      if (scenario.consolidationAt?.includes(sessionNum)) {
        const result = engine.consolidate();
        consolidationResults.push(result);
      }

      // Run decay between sessions
      if (scenario.decay?.enabled && sessionIdx < scenario.sessions.length - 1) {
        simTime += scenario.decay.interSessionGapMs;
        const result = engine.decay();
        decayResults.push(result);
        homeostasisResults.push(result.homeostasis);
      }
    }

    // Collect final metrics
    const recallQueries = scenario.recallQueries.map(q => q.query);
    const spreading = await collectSpreadingMetrics(engine, recallQueries);
    const precisionRecall = await collectPrecisionRecall(engine, scenario.recallQueries);

    // Tool prediction test: after sessions, predict Grep→Read, Read→Edit
    const toolPredictions = collectToolPredictions(engine, [
      { currentTool: "Grep", actualNext: "Read" },
      { currentTool: "Read", actualNext: "Edit" },
      { currentTool: "Edit", actualNext: "Bash" },
    ]);

    db.close();

    return {
      scenario_id: scenario.id,
      run_number: runNumber,
      seed,
      metrics: {
        snapshots,
        spreading,
        precision_recall: precisionRecall,
        tool_predictions: toolPredictions,
        decay_results: decayResults,
        consolidation_results: consolidationResults,
        homeostasis_results: homeostasisResults,
      },
      execution_time_ms: 0, // set by caller
    };
  }

  private aggregate(
    scenario: BenchmarkScenario,
    runs: SingleRunResult[],
  ): AggregatedResult {
    // Aggregate snapshots across runs for each checkpoint
    const snapshotsBySession = new Map<number, SessionSnapshot[]>();
    for (const run of runs) {
      for (const snap of run.metrics.snapshots) {
        if (!snapshotsBySession.has(snap.session_num)) {
          snapshotsBySession.set(snap.session_num, []);
        }
        snapshotsBySession.get(snap.session_num)!.push(snap);
      }
    }

    const aggregatedSnapshots: AggregatedSnapshot[] = [];
    for (const [sessionNum, snaps] of [...snapshotsBySession.entries()].sort((a, b) => a[0] - b[0])) {
      aggregatedSnapshots.push({
        session_num: sessionNum,
        gross_savings_pct: agg(snaps.map(s => s.token.gross_savings_pct)),
        net_savings_pct: agg(snaps.map(s => s.token.net_savings_pct)),
        tokens_saved: agg(snaps.map(s => s.token.tokens_saved)),
        recall_served_pct: agg(snaps.map(s => s.token.recall_served_pct)),
        high_confidence_pct: agg(snaps.map(s => s.token.high_confidence_pct)),
        avg_myelination: agg(snaps.map(s => s.myelination.avg)),
        max_myelination: agg(snaps.map(s => s.myelination.max)),
        superhighway_count: agg(snaps.map(s => s.myelination.superhighway_count)),
        neuron_count: agg(snaps.map(s => s.network.neuron_count)),
        synapse_count: agg(snaps.map(s => s.network.synapse_count)),
        avg_synapse_weight: agg(snaps.map(s => s.synapse_weights.avg_weight)),
      });
    }

    // Aggregate spreading metrics
    const spreadings = runs.map(r => r.metrics.spreading);
    const precisions = runs.map(r => r.metrics.precision_recall);
    const toolPreds = runs.map(r => r.metrics.tool_predictions);

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      runs: runs.length,
      snapshots: aggregatedSnapshots,
      spreading: {
        direct_pct: agg(spreadings.map(s => s.direct_pct)),
        hop1_pct: agg(spreadings.map(s => s.hop1_pct)),
        hop2_pct: agg(spreadings.map(s => s.hop2_pct)),
        hop3_pct: agg(spreadings.map(s => s.hop3_pct)),
        avg_conf_direct: agg(spreadings.map(s => s.avg_confidence_direct)),
        avg_conf_hop1: agg(spreadings.map(s => s.avg_confidence_hop1)),
        avg_conf_hop2: agg(spreadings.map(s => s.avg_confidence_hop2)),
        avg_conf_hop3: agg(spreadings.map(s => s.avg_confidence_hop3)),
      },
      precision_recall: {
        precision: agg(precisions.map(p => p.precision)),
        recall: agg(precisions.map(p => p.recall)),
        f1: agg(precisions.map(p => p.f1)),
      },
      tool_predictions: {
        top1_accuracy: agg(toolPreds.map(t => t.top1_accuracy)),
        top3_accuracy: agg(toolPreds.map(t => t.top3_accuracy)),
      },
      avg_execution_time_ms: mean(runs.map(r => r.execution_time_ms)),
    };
  }
}

// --- Helpers ---

function agg(values: number[]): { mean: number; std: number } {
  const m = mean(values);
  const s = stddev(values, m);
  return { mean: m, std: s };
}
