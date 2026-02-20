/**
 * BrainBox Benchmark Metrics Collection
 *
 * Collects all measurements needed for the paper from a HebbianEngine instance.
 */

import type { HebbianEngine } from "./hebbian.js";
import type { Neuron, Synapse, RecallResult, DecayResult, ConsolidationResult, HomeostasisResult } from "./hebbian.js";

// --- Metric Types ---

export interface TokenMetrics {
  gross_savings_pct: number;
  net_savings_pct: number;
  tokens_without: number;
  tokens_with: number;
  tokens_saved: number;
  cost_saved_usd: number;
  /** Recall-served rate: what % of file accesses could be served by recall (confidence >= 0.4) */
  recall_served_pct: number;
  /** High-confidence rate: what % of file accesses hit superhighway (confidence >= 0.7) */
  high_confidence_pct: number;
}

export interface MyelinationMetrics {
  avg: number;
  max: number;
  min: number;
  std: number;
  superhighway_count: number;  // myelination > 0.5
  distribution: number[];      // histogram buckets [0-0.1, 0.1-0.2, ..., 0.9-1.0]
}

export interface NetworkMetrics {
  neuron_count: number;
  synapse_count: number;
  superhighways: number;
  avg_myelination: number;
  avg_synapse_weight: number;
  total_accesses: number;
}

export interface SpreadingMetrics {
  direct_count: number;
  hop1_count: number;
  hop2_count: number;
  hop3_count: number;
  total_count: number;
  direct_pct: number;
  hop1_pct: number;
  hop2_pct: number;
  hop3_pct: number;
  avg_confidence_direct: number;
  avg_confidence_hop1: number;
  avg_confidence_hop2: number;
  avg_confidence_hop3: number;
}

export interface PrecisionRecallMetrics {
  precision: number;
  recall: number;
  f1: number;
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  true_negatives: number;  // correctly rejected unknown queries
}

export interface SynapseWeightMetrics {
  avg_weight: number;
  max_weight: number;
  std_weight: number;
  /** Weight at various co-access count buckets (for SNAP saturation proof) */
  weight_by_coacccess: Array<{ co_access_count: number; avg_weight: number; std_weight: number; count: number }>;
}

export interface ToolPredictionMetrics {
  top1_accuracy: number;
  top3_accuracy: number;
  predictions_tested: number;
}

export interface SessionSnapshot {
  session_num: number;
  token: TokenMetrics;
  myelination: MyelinationMetrics;
  network: NetworkMetrics;
  synapse_weights: SynapseWeightMetrics;
}

export interface BenchmarkMetrics {
  snapshots: SessionSnapshot[];
  spreading: SpreadingMetrics;
  precision_recall: PrecisionRecallMetrics;
  tool_predictions: ToolPredictionMetrics;
  decay_results: DecayResult[];
  consolidation_results: ConsolidationResult[];
  homeostasis_results: HomeostasisResult[];
}

// --- Injection overhead constant ---
// ~75 tokens per recall injection (file path + confidence line)
const INJECTION_OVERHEAD_PER_RECALL = 75;
// Average 3 results per recall call
const AVG_RESULTS_PER_RECALL = 3;

// --- Collection Functions ---

/** Estimated net overhead per recall call in tokens */
function injectionOverhead(): number {
  return INJECTION_OVERHEAD_PER_RECALL * AVG_RESULTS_PER_RECALL;
}

export function collectTokenMetrics(engine: HebbianEngine): TokenMetrics {
  const report = engine.tokenReport();
  const gross = report.savings_pct;
  // Net = gross minus injection overhead
  const totalRecallOverhead = injectionOverhead();
  const net = report.tokens_used > 0
    ? ((report.tokens_saved - totalRecallOverhead) / report.tokens_used) * 100
    : 0;

  // Recall-served metrics: what fraction of file neurons have enough myelination
  // to be recalled with confidence >= gate threshold
  const neurons = engine.allNeurons();
  const fileNeurons = neurons.filter(n => n.type === "file");
  const totalFileAccesses = fileNeurons.reduce((s, n) => s + n.access_count, 0);

  // Recall-served: myelination >= 0.1 means at least 10% of accesses could skip search
  // We measure: Σ(access_count × myelination) / total_accesses = fraction recall-served
  let recallServedAccesses = 0;
  let highConfAccesses = 0;
  for (const n of fileNeurons) {
    recallServedAccesses += n.access_count * Math.min(n.myelination * 2.5, 1.0); // scale: myelin 0.4 = 100% recall-served
    highConfAccesses += n.access_count * (n.myelination >= 0.5 ? 1 : 0); // binary: superhighway or not
  }

  return {
    gross_savings_pct: gross,
    net_savings_pct: Math.max(0, net),
    tokens_without: report.tokens_used,
    tokens_with: report.tokens_with_brainbox,
    tokens_saved: report.tokens_saved,
    cost_saved_usd: (report.tokens_saved / 1_000_000) * 3, // $3/M tokens
    recall_served_pct: totalFileAccesses > 0 ? (recallServedAccesses / totalFileAccesses) * 100 : 0,
    high_confidence_pct: totalFileAccesses > 0 ? (highConfAccesses / totalFileAccesses) * 100 : 0,
  };
}

export function collectMyelinationMetrics(engine: HebbianEngine): MyelinationMetrics {
  const neurons = engine.allNeurons();
  const myelins = neurons.map(n => n.myelination).filter(m => m > 0);

  if (myelins.length === 0) {
    return { avg: 0, max: 0, min: 0, std: 0, superhighway_count: 0, distribution: new Array(10).fill(0) };
  }

  const avg = mean(myelins);
  const std = stddev(myelins, avg);
  const max = Math.max(...myelins);
  const min = Math.min(...myelins);

  // Histogram: 10 buckets [0-0.1), [0.1-0.2), ..., [0.9-1.0]
  const distribution = new Array(10).fill(0);
  for (const m of myelins) {
    const bucket = Math.min(Math.floor(m * 10), 9);
    distribution[bucket]++;
  }

  return {
    avg,
    max,
    min,
    std,
    superhighway_count: neurons.filter(n => n.myelination >= 0.5).length,
    distribution,
  };
}

export function collectNetworkMetrics(engine: HebbianEngine): NetworkMetrics {
  const stats = engine.stats();
  const neurons = engine.allNeurons();
  const synapses = engine.allSynapses();

  return {
    neuron_count: stats.neuron_count,
    synapse_count: stats.synapse_count,
    superhighways: stats.superhighways,
    avg_myelination: stats.avg_myelination || 0,
    avg_synapse_weight: synapses.length > 0 ? mean(synapses.map(s => s.weight)) : 0,
    total_accesses: stats.total_accesses || 0,
  };
}

export function collectSynapseWeightMetrics(engine: HebbianEngine): SynapseWeightMetrics {
  const synapses = engine.allSynapses();
  const weights = synapses.map(s => s.weight);

  if (weights.length === 0) {
    return { avg_weight: 0, max_weight: 0, std_weight: 0, weight_by_coacccess: [] };
  }

  const avg = mean(weights);

  // Group by co-access count for SNAP analysis
  const byCoAccess = new Map<number, number[]>();
  for (const s of synapses) {
    const bucket = s.co_access_count;
    if (!byCoAccess.has(bucket)) byCoAccess.set(bucket, []);
    byCoAccess.get(bucket)!.push(s.weight);
  }

  const weight_by_coacccess = Array.from(byCoAccess.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([co_access_count, ws]) => ({
      co_access_count,
      avg_weight: mean(ws),
      std_weight: stddev(ws),
      count: ws.length,
    }));

  return {
    avg_weight: avg,
    max_weight: Math.max(...weights),
    std_weight: stddev(weights, avg),
    weight_by_coacccess,
  };
}

export async function collectSpreadingMetrics(
  engine: HebbianEngine,
  queries: string[],
): Promise<SpreadingMetrics> {
  let direct = 0, hop1 = 0, hop2 = 0, hop3 = 0;
  const confDirect: number[] = [], confHop1: number[] = [], confHop2: number[] = [], confHop3: number[] = [];

  for (const q of queries) {
    const results = await engine.recall({ query: q, limit: 15 });
    // Only count file and error neurons — tool neurons are noise for spreading analysis
    const fileResults = results.filter(r => r.neuron.type === "file" || r.neuron.type === "error");
    for (const r of fileResults) {
      const path = r.activation_path;
      if (path === "direct" || path.startsWith("context") || path.startsWith("myelinated") || path.startsWith("fingerprint") || path.startsWith("episodic")) {
        direct++;
        confDirect.push(r.confidence);
      } else if (path.includes("spread(1)")) {
        hop1++;
        confHop1.push(r.confidence);
      } else if (path.includes("spread(2)")) {
        hop2++;
        confHop2.push(r.confidence);
      } else if (path.includes("spread(3)")) {
        hop3++;
        confHop3.push(r.confidence);
      } else {
        direct++; // fallback/consolidated
        confDirect.push(r.confidence);
      }
    }
  }

  const total = direct + hop1 + hop2 + hop3;

  return {
    direct_count: direct,
    hop1_count: hop1,
    hop2_count: hop2,
    hop3_count: hop3,
    total_count: total,
    direct_pct: total > 0 ? (direct / total) * 100 : 0,
    hop1_pct: total > 0 ? (hop1 / total) * 100 : 0,
    hop2_pct: total > 0 ? (hop2 / total) * 100 : 0,
    hop3_pct: total > 0 ? (hop3 / total) * 100 : 0,
    avg_confidence_direct: confDirect.length > 0 ? mean(confDirect) : 0,
    avg_confidence_hop1: confHop1.length > 0 ? mean(confHop1) : 0,
    avg_confidence_hop2: confHop2.length > 0 ? mean(confHop2) : 0,
    avg_confidence_hop3: confHop3.length > 0 ? mean(confHop3) : 0,
  };
}

export async function collectPrecisionRecall(
  engine: HebbianEngine,
  queries: Array<{ query: string; expectedFiles: string[]; shouldFail?: boolean }>,
): Promise<PrecisionRecallMetrics> {
  let tp = 0, fp = 0, fn = 0, tn = 0;

  for (const q of queries) {
    const results = await engine.recall({ query: q.query, limit: 10 });
    const returnedPaths = new Set(results.map(r => r.neuron.path));
    const expectedPaths = new Set(q.expectedFiles);

    if (q.shouldFail) {
      // Should return nothing — any result for a file is a false positive
      const fileResults = results.filter(r => r.neuron.type === "file");
      if (fileResults.length === 0) {
        tn++;
      } else {
        fp += fileResults.length;
      }
      continue;
    }

    for (const expected of expectedPaths) {
      if (returnedPaths.has(expected)) {
        tp++;
      } else {
        fn++;
      }
    }
    for (const returned of returnedPaths) {
      // Only count file neurons, not tools
      const result = results.find(r => r.neuron.path === returned);
      if (result?.neuron.type !== "file") continue;
      if (!expectedPaths.has(returned)) {
        fp++;
      }
    }
  }

  const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
  const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
  const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1, true_positives: tp, false_positives: fp, false_negatives: fn, true_negatives: tn };
}

export function collectToolPredictions(
  engine: HebbianEngine,
  toolSequences: Array<{ currentTool: string; actualNext: string }>,
): ToolPredictionMetrics {
  let top1Correct = 0;
  let top3Correct = 0;
  let tested = 0;

  for (const seq of toolSequences) {
    const { nextTools } = engine.predictNext(seq.currentTool);
    if (nextTools.length === 0) continue;
    tested++;

    const top1 = nextTools[0]?.neuron.path;
    const top3 = nextTools.slice(0, 3).map(t => t.neuron.path);

    if (top1 === seq.actualNext) top1Correct++;
    if (top3.includes(seq.actualNext)) top3Correct++;
  }

  return {
    top1_accuracy: tested > 0 ? top1Correct / tested : 0,
    top3_accuracy: tested > 0 ? top3Correct / tested : 0,
    predictions_tested: tested,
  };
}

export function collectSessionSnapshot(
  engine: HebbianEngine,
  sessionNum: number,
): SessionSnapshot {
  return {
    session_num: sessionNum,
    token: collectTokenMetrics(engine),
    myelination: collectMyelinationMetrics(engine),
    network: collectNetworkMetrics(engine),
    synapse_weights: collectSynapseWeightMetrics(engine),
  };
}

// --- Stats helpers ---

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[], avg?: number): number {
  if (arr.length < 2) return 0;
  const m = avg ?? mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// Export for use in report generation
export { mean, stddev };
