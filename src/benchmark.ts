#!/usr/bin/env node
/**
 * BrainBox Benchmark Suite
 *
 * Generates reproducible evaluation numbers for the whitepaper.
 * All runs use in-memory SQLite — deterministic and reviewer-reproducible.
 *
 * Usage:
 *   npx tsx src/benchmark.ts                     # Run all scenarios (5 repeats)
 *   npx tsx src/benchmark.ts --scenario A1       # Run specific scenario
 *   npx tsx src/benchmark.ts --repeats 10        # More repeats for tighter CI
 *   npx tsx src/benchmark.ts --json              # Output raw JSON
 *   npx tsx src/benchmark.ts --latex             # Output LaTeX tables
 *   npx tsx src/benchmark.ts --production        # Also analyze production DB
 */

import { ALL_SCENARIOS } from "./benchmark-scenarios.js";
import { BenchmarkRunner } from "./benchmark-runner.js";
import type { AggregatedResult } from "./benchmark-runner.js";
import { toJSON, generateLatex, printSummary } from "./benchmark-report.js";
import { openDb } from "./db.js";
import { HebbianEngine } from "./hebbian.js";
import { collectSessionSnapshot, collectMyelinationMetrics, collectNetworkMetrics, collectSynapseWeightMetrics } from "./benchmark-metrics.js";
import { join } from "path";
import { existsSync, writeFileSync, mkdirSync } from "fs";

// --- Parse args ---

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    }
  }
  return opts;
}

const args = parseArgs(process.argv.slice(2));
const repeats = parseInt(args.repeats as string, 10) || 5;
const scenarioFilter = args.scenario as string | undefined;
const outputJson = !!args.json;
const outputLatex = !!args.latex;
const analyzeProduction = !!args.production;
const outputDir = (args.output as string) || join(process.cwd(), "benchmark-results");

async function main() {
  console.log(`\n🧪 BrainBox Benchmark Suite\n`);
  console.log(`   Repeats: ${repeats}`);
  console.log(`   Output:  ${outputDir}`);

  // Filter scenarios
  const scenarios = scenarioFilter
    ? ALL_SCENARIOS.filter(s => s.id === scenarioFilter)
    : ALL_SCENARIOS;

  if (scenarios.length === 0) {
    console.error(`Unknown scenario: ${scenarioFilter}`);
    console.error(`Available: ${ALL_SCENARIOS.map(s => s.id).join(", ")}`);
    process.exit(1);
  }

  console.log(`   Scenarios: ${scenarios.map(s => s.id).join(", ")}\n`);

  const runner = new BenchmarkRunner(repeats, true);
  const allResults: AggregatedResult[] = [];

  for (const scenario of scenarios) {
    console.log(`\n▶ Running ${scenario.id}: ${scenario.name}`);
    console.log(`  ${scenario.description}`);
    console.log(`  Sessions: ${scenario.sessions.length}, Checkpoints: ${scenario.checkpoints.join(",")}\n`);

    const result = await runner.runScenario(scenario);
    allResults.push(result);
    printSummary(result);
  }

  // Save results
  mkdirSync(outputDir, { recursive: true });

  // Always save JSON
  const jsonPath = join(outputDir, "results.json");
  writeFileSync(jsonPath, toJSON(allResults));
  console.log(`\n📁 JSON results: ${jsonPath}`);

  // LaTeX tables
  const latexPath = join(outputDir, "tables.tex");
  writeFileSync(latexPath, generateLatex(allResults));
  console.log(`📁 LaTeX tables: ${latexPath}`);

  if (outputJson) {
    console.log("\n--- JSON Output ---");
    console.log(toJSON(allResults));
  }

  if (outputLatex) {
    console.log("\n--- LaTeX Output ---");
    console.log(generateLatex(allResults));
  }

  // Production DB analysis
  if (analyzeProduction) {
    await analyzeProductionDb(outputDir);
  }

  // Print paper-ready summary
  printPaperSummary(allResults);
}

async function analyzeProductionDb(outputDir: string) {
  const dbPath = join(process.env.HOME || "~", ".brainbox", "brainbox.db");
  if (!existsSync(dbPath)) {
    console.log("\n⚠️  No production DB found at ~/.brainbox/brainbox.db");
    return;
  }

  console.log(`\n📊 Analyzing production DB: ${dbPath}`);
  const db = openDb(dbPath);
  const engine = new HebbianEngine(db, "production-analysis");

  const network = collectNetworkMetrics(engine);
  const myelination = collectMyelinationMetrics(engine);
  const synapseWeights = collectSynapseWeightMetrics(engine);

  const prodReport = {
    network,
    myelination,
    synapseWeights,
    tokenReport: engine.tokenReport(),
    superhighways: engine.getSuperhighways(0.5).map(n => ({
      path: n.path,
      type: n.type,
      myelination: n.myelination,
      access_count: n.access_count,
    })),
  };

  const prodPath = join(outputDir, "production.json");
  writeFileSync(prodPath, JSON.stringify(prodReport, null, 2));
  console.log(`📁 Production analysis: ${prodPath}`);

  console.log(`\n  Production Network:`);
  console.log(`    Neurons: ${network.neuron_count}`);
  console.log(`    Synapses: ${network.synapse_count}`);
  console.log(`    Superhighways: ${network.superhighways}`);
  console.log(`    Avg myelination: ${network.avg_myelination.toFixed(3)}`);
  console.log(`    Avg synapse weight: ${network.avg_synapse_weight.toFixed(3)}`);
  console.log(`    Token savings: ${engine.tokenReport().savings_pct.toFixed(1)}%`);

  db.close();
}

function printPaperSummary(results: AggregatedResult[]) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  PAPER-READY NUMBERS`);
  console.log(`${"═".repeat(60)}\n`);

  // Find A1 (primary scenario)
  const a1 = results.find(r => r.scenario_id === "A1");
  if (a1) {
    const last = a1.snapshots[a1.snapshots.length - 1];
    if (last) {
      console.log(`  Standard Workflow (A1, 20 sessions, N=${a1.runs}):`);
      console.log(`    Token savings (gross): ${last.gross_savings_pct.mean.toFixed(1)}% ± ${last.gross_savings_pct.std.toFixed(1)}%`);
      console.log(`    Token savings (net):   ${last.net_savings_pct.mean.toFixed(1)}% ± ${last.net_savings_pct.std.toFixed(1)}%`);
      console.log(`    Superhighways:         ${last.superhighway_count.mean.toFixed(0)} ± ${last.superhighway_count.std.toFixed(0)}`);
      console.log(`    Precision:             ${a1.precision_recall.precision.mean.toFixed(3)}`);
      console.log(`    Recall:                ${a1.precision_recall.recall.mean.toFixed(3)}`);
      console.log(`    F1:                    ${a1.precision_recall.f1.mean.toFixed(3)}`);
    }
  }

  // Cross-scenario final savings
  console.log(`\n  Cross-Scenario Comparison (final checkpoint):`);
  for (const r of results) {
    const last = r.snapshots[r.snapshots.length - 1];
    if (!last) continue;
    console.log(`    ${r.scenario_id.padEnd(4)} ${r.scenario_name.slice(0, 30).padEnd(32)} → ${last.gross_savings_pct.mean.toFixed(1)}% gross, F1: ${r.precision_recall.f1.mean.toFixed(3)}`);
  }

  console.log(`\n  (Full results in benchmark-results/results.json)`);
  console.log(`  (LaTeX tables in benchmark-results/tables.tex)\n`);
}

main().catch(err => {
  console.error("Benchmark error:", err);
  process.exit(1);
});
