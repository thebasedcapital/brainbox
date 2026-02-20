/**
 * BrainBox Benchmark Report Generator
 *
 * Converts aggregated benchmark results into JSON and LaTeX tables
 * ready for copy-paste into brainbox.tex.
 */

import type { AggregatedResult, AggregatedSnapshot } from "./benchmark-runner.js";

// --- JSON output ---

export function toJSON(results: AggregatedResult[]): string {
  return JSON.stringify(results, null, 2);
}

// --- LaTeX output ---

function fmt(v: { mean: number; std: number }, decimals = 1): string {
  if (v.std === 0) return v.mean.toFixed(decimals);
  return `${v.mean.toFixed(decimals)} {\\scriptsize$\\pm$ ${v.std.toFixed(decimals)}}`;
}

function fmtPct(v: { mean: number; std: number }): string {
  return `${fmt(v)}\\%`;
}

function fmtInt(v: { mean: number; std: number }): string {
  if (v.std === 0) return Math.round(v.mean).toString();
  return `${Math.round(v.mean)} {\\scriptsize$\\pm$ ${Math.round(v.std)}}`;
}

function fmtDollar(v: { mean: number; std: number }): string {
  return `\\$${v.mean.toFixed(3)}`;
}

export function generateLatex(results: AggregatedResult[]): string {
  const sections: string[] = [];

  for (const result of results) {
    sections.push(`% === Scenario ${result.scenario_id}: ${result.scenario_name} ===\n`);

    // Table 1: Token savings by session
    sections.push(generateTokenSavingsTable(result));

    // Table 2: Myelination growth
    sections.push(generateMyelinationTable(result));

    // Table 3: Network growth
    sections.push(generateNetworkTable(result));

    // Table 4: Spreading activation depth
    sections.push(generateSpreadingTable(result));

    // Table 5: Precision/recall
    sections.push(generatePrecisionRecallTable(result));

    // Table 6: SNAP saturation (synapse weights)
    sections.push(generateSynapseWeightNote(result));
  }

  // Cross-scenario comparison
  if (results.length > 1) {
    sections.push(generateCrossScenarioTable(results));
  }

  return sections.join("\n\n");
}

function generateTokenSavingsTable(result: AggregatedResult): string {
  const snaps = result.snapshots;
  if (snaps.length === 0) return "% No token savings data\n";

  let tex = `\\begin{table}[H]
\\centering
\\caption{Token savings by session (Scenario ${result.scenario_id}: ${result.scenario_name}, N=${result.runs})}
\\label{tab:tokens-${result.scenario_id.toLowerCase()}}
\\small
\\begin{tabular}{r c c c}
\\toprule
\\textbf{Session} & \\textbf{Gross Savings} & \\textbf{Net Savings} & \\textbf{Tokens Saved} \\\\
\\midrule\n`;

  for (const snap of snaps) {
    tex += `${snap.session_num} & ${fmtPct(snap.gross_savings_pct)} & ${fmtPct(snap.net_savings_pct)} & ${fmtInt(snap.tokens_saved)} \\\\\n`;
  }

  tex += `\\bottomrule
\\end{tabular}
\\end{table}`;
  return tex;
}

function generateMyelinationTable(result: AggregatedResult): string {
  const snaps = result.snapshots;
  if (snaps.length === 0) return "% No myelination data\n";

  let tex = `\\begin{table}[H]
\\centering
\\caption{Myelination growth (Scenario ${result.scenario_id}, N=${result.runs})}
\\label{tab:myelin-${result.scenario_id.toLowerCase()}}
\\small
\\begin{tabular}{r c c c}
\\toprule
\\textbf{Session} & \\textbf{Avg Myelination} & \\textbf{Max Myelination} & \\textbf{Superhighways} \\\\
\\midrule\n`;

  for (const snap of snaps) {
    tex += `${snap.session_num} & ${fmt(snap.avg_myelination, 3)} & ${fmt(snap.max_myelination, 3)} & ${fmtInt(snap.superhighway_count)} \\\\\n`;
  }

  tex += `\\bottomrule
\\end{tabular}
\\end{table}`;
  return tex;
}

function generateNetworkTable(result: AggregatedResult): string {
  const snaps = result.snapshots;
  if (snaps.length === 0) return "% No network data\n";

  let tex = `\\begin{table}[H]
\\centering
\\caption{Network growth (Scenario ${result.scenario_id}, N=${result.runs})}
\\label{tab:network-${result.scenario_id.toLowerCase()}}
\\small
\\begin{tabular}{r c c c}
\\toprule
\\textbf{Session} & \\textbf{Neurons} & \\textbf{Synapses} & \\textbf{Avg Weight} \\\\
\\midrule\n`;

  for (const snap of snaps) {
    tex += `${snap.session_num} & ${fmtInt(snap.neuron_count)} & ${fmtInt(snap.synapse_count)} & ${fmt(snap.avg_synapse_weight, 3)} \\\\\n`;
  }

  tex += `\\bottomrule
\\end{tabular}
\\end{table}`;
  return tex;
}

function generateSpreadingTable(result: AggregatedResult): string {
  const s = result.spreading;

  return `\\begin{table}[H]
\\centering
\\caption{Spreading activation depth distribution (Scenario ${result.scenario_id}, N=${result.runs})}
\\label{tab:spreading-${result.scenario_id.toLowerCase()}}
\\small
\\begin{tabular}{l c c}
\\toprule
\\textbf{Depth} & \\textbf{\\% of Results} & \\textbf{Mean Confidence} \\\\
\\midrule
Direct & ${fmtPct(s.direct_pct)} & ${fmt(s.avg_conf_direct, 3)} \\\\
Hop-1 & ${fmtPct(s.hop1_pct)} & ${fmt(s.avg_conf_hop1, 3)} \\\\
Hop-2 & ${fmtPct(s.hop2_pct)} & ${fmt(s.avg_conf_hop2, 3)} \\\\
Hop-3 & ${fmtPct(s.hop3_pct)} & ${fmt(s.avg_conf_hop3, 3)} \\\\
\\bottomrule
\\end{tabular}
\\end{table}`;
}

function generatePrecisionRecallTable(result: AggregatedResult): string {
  const pr = result.precision_recall;

  return `% Precision/Recall (Scenario ${result.scenario_id}):
% Precision: ${fmt(pr.precision, 3)}, Recall: ${fmt(pr.recall, 3)}, F1: ${fmt(pr.f1, 3)}`;
}

function generateSynapseWeightNote(result: AggregatedResult): string {
  return `% Synapse weight analysis for SNAP saturation proof
% See JSON output for weight_by_coacccess breakdown`;
}

function generateCrossScenarioTable(results: AggregatedResult[]): string {
  let tex = `\\begin{table}[H]
\\centering
\\caption{Cross-scenario comparison (final checkpoint, N=${results[0].runs} runs each)}
\\label{tab:cross-scenario}
\\small
\\begin{tabular}{l c c c c c}
\\toprule
\\textbf{Scenario} & \\textbf{Sessions} & \\textbf{Gross Savings} & \\textbf{Net Savings} & \\textbf{Precision} & \\textbf{F1} \\\\
\\midrule\n`;

  for (const r of results) {
    const lastSnap = r.snapshots[r.snapshots.length - 1];
    if (!lastSnap) continue;
    const sessions = lastSnap.session_num;
    tex += `${r.scenario_id}: ${r.scenario_name.slice(0, 25)} & ${sessions} & ${fmtPct(lastSnap.gross_savings_pct)} & ${fmtPct(lastSnap.net_savings_pct)} & ${fmt(r.precision_recall.precision, 2)} & ${fmt(r.precision_recall.f1, 2)} \\\\\n`;
  }

  tex += `\\bottomrule
\\end{tabular}
\\end{table}`;
  return tex;
}

// --- Console summary ---

export function printSummary(result: AggregatedResult): void {
  console.log(`\n${"━".repeat(60)}`);
  console.log(`  Scenario ${result.scenario_id}: ${result.scenario_name}`);
  console.log(`  Runs: ${result.runs} | Avg time: ${Math.round(result.avg_execution_time_ms)}ms`);
  console.log(`${"━".repeat(60)}\n`);

  // Token savings progression
  console.log("  Token Savings (myelination-weighted):");
  for (const snap of result.snapshots) {
    const bar = "█".repeat(Math.round(snap.gross_savings_pct.mean / 3));
    console.log(`    Session ${String(snap.session_num).padStart(3)}: ${bar} ${snap.gross_savings_pct.mean.toFixed(1)}% gross (recall-served: ${snap.recall_served_pct.mean.toFixed(1)}%, superhighway: ${snap.high_confidence_pct.mean.toFixed(1)}%)`);
  }

  // Myelination
  console.log("\n  Myelination:");
  for (const snap of result.snapshots) {
    console.log(`    Session ${String(snap.session_num).padStart(2)}: avg ${snap.avg_myelination.mean.toFixed(3)} | max ${snap.max_myelination.mean.toFixed(3)} | superhighways: ${snap.superhighway_count.mean.toFixed(0)}`);
  }

  // Network
  const lastSnap = result.snapshots[result.snapshots.length - 1];
  if (lastSnap) {
    console.log(`\n  Final Network: ${lastSnap.neuron_count.mean.toFixed(0)} neurons, ${lastSnap.synapse_count.mean.toFixed(0)} synapses`);
  }

  // Spreading activation
  const sp = result.spreading;
  console.log(`\n  Spreading Activation:`);
  console.log(`    Direct: ${sp.direct_pct.mean.toFixed(1)}% (conf: ${sp.avg_conf_direct.mean.toFixed(3)})`);
  console.log(`    Hop-1:  ${sp.hop1_pct.mean.toFixed(1)}% (conf: ${sp.avg_conf_hop1.mean.toFixed(3)})`);
  console.log(`    Hop-2:  ${sp.hop2_pct.mean.toFixed(1)}% (conf: ${sp.avg_conf_hop2.mean.toFixed(3)})`);
  console.log(`    Hop-3:  ${sp.hop3_pct.mean.toFixed(1)}% (conf: ${sp.avg_conf_hop3.mean.toFixed(3)})`);

  // Precision/Recall
  const pr = result.precision_recall;
  console.log(`\n  Recall Quality:`);
  console.log(`    Precision: ${pr.precision.mean.toFixed(3)} ± ${pr.precision.std.toFixed(3)}`);
  console.log(`    Recall:    ${pr.recall.mean.toFixed(3)} ± ${pr.recall.std.toFixed(3)}`);
  console.log(`    F1:        ${pr.f1.mean.toFixed(3)} ± ${pr.f1.std.toFixed(3)}`);

  // Tool predictions
  const tp = result.tool_predictions;
  console.log(`\n  Tool Predictions:`);
  console.log(`    Top-1: ${(tp.top1_accuracy.mean * 100).toFixed(0)}% | Top-3: ${(tp.top3_accuracy.mean * 100).toFixed(0)}%`);

  console.log();
}
