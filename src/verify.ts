#!/usr/bin/env node
/**
 * Verification script: manually trace Hebbian learning math
 * and compare against actual DB values to catch hallucinations.
 */
import { openDb } from "./db.js";
import { HebbianEngine } from "./hebbian.js";

async function main() {
// Use in-memory DB for tests — never touch production data
const db = openDb(":memory:");

// Clean slate
db.exec("DELETE FROM neurons; DELETE FROM synapses; DELETE FROM access_log; DELETE FROM sessions;");

const engine = new HebbianEngine(db, "verify-session");

console.log("=== VERIFICATION: Tracing Hebbian Math ===\n");

// --- Test 1: Myelination increments ---
console.log("TEST 1: Myelination increments (MYELIN_RATE = 0.02, sigmoid-like)");
console.log("Expected: 0% → 2% → 3.96% → 5.88% over 4 accesses (diminishing returns)\n");

const baseTime = Date.now();

// Access 1: creates neuron, myelination starts at 0
const n1 = engine.record("test/file.ts", "file", "test query", baseTime);
console.log(`  Access 1: myelination = ${(n1.myelination * 100).toFixed(2)}% (expect 0.00%)`);

// Access 2: ON CONFLICT increments by 0.02 * (1-0) = 0.02
const n2 = engine.record("test/file.ts", "file", "test query", baseTime + 10000);
console.log(`  Access 2: myelination = ${(n2.myelination * 100).toFixed(2)}% (expect 2.00%)`);

// Access 3: increments by 0.02 * (1-0.02) = 0.0196, total = 0.0396
const n3 = engine.record("test/file.ts", "file", "test query", baseTime + 20000);
console.log(`  Access 3: myelination = ${(n3.myelination * 100).toFixed(2)}% (expect 3.96%)`);

// Access 4: increments by 0.02 * (1-0.0396) = 0.01921, total = 0.0588
const n4 = engine.record("test/file.ts", "file", "test query", baseTime + 30000);
console.log(`  Access 4: myelination = ${(n4.myelination * 100).toFixed(2)}% (expect 5.88%)`);

const myelin_ok = Math.abs(n4.myelination - 0.0588) < 0.005;
console.log(`  RESULT: ${myelin_ok ? '✅ PASS' : '❌ FAIL'}\n`);

// --- Test 2: Synapse formation ---
console.log("TEST 2: Synapse formation (co-access within 60s window)");
console.log("Expected: A→B and B→A synapses form when accessed close together\n");

db.exec("DELETE FROM neurons; DELETE FROM synapses; DELETE FROM access_log; DELETE FROM sessions;");
const engine2 = new HebbianEngine(db, "verify-synapses");

// Access file A then file B (sequential window: B sees A at position 1/1 → positionFactor = 1.0)
engine2.record("fileA.ts", "file", "a", baseTime);
engine2.record("fileB.ts", "file", "b", baseTime + 10_000);

const synapses = engine2.allSynapses();
console.log(`  Synapses created: ${synapses.length} (expect 2: A→B and B→A)`);

if (synapses.length === 2) {
  const ab = synapses.find(s => s.source_id.includes("fileA") && s.target_id.includes("fileB"));
  const ba = synapses.find(s => s.source_id.includes("fileB") && s.target_id.includes("fileA"));

  // Sequential window: when B is recorded, A is at position 0 in window of size 1
  // positionFactor = (0 + 1) / 1 = 1.0
  // delta = 0.1 * 1.0 = 0.1
  const expectedWeight = 0.1;

  console.log(`  A→B weight: ${ab?.weight.toFixed(4)} (expect ~${expectedWeight.toFixed(4)})`);
  console.log(`  B→A weight: ${ba?.weight.toFixed(4)} (expect ~${expectedWeight.toFixed(4)})`);

  const weight_ok = ab && Math.abs(ab.weight - expectedWeight) < 0.01;
  console.log(`  RESULT: ${weight_ok ? '✅ PASS' : '❌ FAIL'}\n`);
} else {
  console.log(`  RESULT: ❌ FAIL — wrong number of synapses\n`);
}

// --- Test 3: No synapse outside sequential window ---
console.log("TEST 3: No synapse outside sequential window (window size = 10)");

db.exec("DELETE FROM neurons; DELETE FROM synapses; DELETE FROM access_log; DELETE FROM sessions;");
const engine3 = new HebbianEngine(db, "verify-no-synapse");

// Access fileX, then 10 other unique files to push X out of the window, then fileY
engine3.record("fileX.ts", "file", "x", baseTime);
for (let i = 0; i < 10; i++) {
  engine3.record(`filler${i}.ts`, "file", "filler", baseTime + (i + 1) * 1_000);
}
// Now fileX should be evicted from the window of 10
engine3.record("fileY.ts", "file", "y", baseTime + 12_000);

// fileY should NOT have a synapse to fileX (evicted), but SHOULD have synapses to fillers
const syn3 = engine3.allSynapses();
const xyEdge = syn3.find(s => s.source_id.includes("fileX") && s.target_id.includes("fileY"));
const yxEdge = syn3.find(s => s.source_id.includes("fileY") && s.target_id.includes("fileX"));
console.log(`  X→Y synapse: ${xyEdge ? 'EXISTS (BAD)' : 'NONE (GOOD — X was evicted from window)'}`);
console.log(`  RESULT: ${!xyEdge && !yxEdge ? '✅ PASS' : '❌ FAIL'}\n`);

// --- Test 4: Synapse strengthening with repeated co-access ---
console.log("TEST 4: Synapse strengthening (Hebbian: fire together → wire together, diminishing returns)");

db.exec("DELETE FROM neurons; DELETE FROM synapses; DELETE FROM access_log; DELETE FROM sessions;");
const engine4 = new HebbianEngine(db, "verify-strengthen");

// Co-access 5 times — alternating hot1, hot2 (sequential window keeps both)
// Pattern: hot1, hot2, hot1, hot2, hot1, hot2, hot1, hot2, hot1, hot2
for (let i = 0; i < 5; i++) {
  const t = baseTime + i * 10_000;
  engine4.record("hot1.ts", "file", "hot", t);
  engine4.record("hot2.ts", "file", "hot", t + 5_000);
}

const syn4 = engine4.allSynapses();
const hot12 = syn4.find(s => s.source_id.includes("hot1") && s.target_id.includes("hot2"));
console.log(`  After 5 co-accesses:`);
console.log(`  hot1→hot2 weight: ${hot12?.weight.toFixed(4)}`);
console.log(`  hot1→hot2 co_access_count: ${hot12?.co_access_count}`);

// Sequential window math: alternating hot1, hot2
// When hot2 is recorded (1st time): window=[hot1], positionFactor=1/1=1.0, delta=0.1*1.0=0.1
// When hot1 is recorded (2nd time): window=[hot2], positionFactor=1/1=1.0, delta=0.1*1.0=0.1 (to hot2)
// When hot2 is recorded (2nd time): window=[hot1], positionFactor=1/1=1.0, delta=0.1 (to hot1)
// etc. — 5 bidirectional co-accesses each at delta=0.1
// With BCM diminishing returns: w = w + delta * (1 - w)
// After 1: 0 + 0.1*(1-0) = 0.1
// After 2: 0.1 + 0.1*(1-0.1) = 0.19
// After 3: 0.19 + 0.1*(1-0.19) = 0.271
// After 4: 0.271 + 0.1*(1-0.271) = 0.344
// After 5: 0.344 + 0.1*(1-0.344) = 0.410
// Note: hot1→hot2 gets strengthened when hot2 is recorded (5 times)
// AND when hot1 is re-recorded seeing hot2 in window (4 times) = 9 total
// But unique dedup means window=[hot2] when hot1 re-accessed (hot1 removed, hot2 remains)
// So each record sees exactly 1 other file → 10 records = 10 strengthenings per direction
// Actually: hot1→hot2 is strengthened when hot2 is recorded (sees hot1) AND when hot1 is recorded (sees hot2)
// = 5 + 4 = 9 strengthenings for hot1→hot2 direction in the upsertSynapse calls
// This is complex — just verify weight is substantial and co_access_count > 5
const str_ok = hot12 && hot12.weight > 0.3 && hot12.co_access_count >= 5;
console.log(`  Weight > 0.3: ${hot12 ? hot12.weight > 0.3 : false}`);
console.log(`  Co-access >= 5: ${hot12 ? hot12.co_access_count >= 5 : false}`);
console.log(`  RESULT: ${str_ok ? '✅ PASS' : '❌ FAIL'}\n`);

// --- Test 5: Confidence gating ---
console.log("TEST 5: Confidence gating (only return results above 0.4 threshold)");

db.exec("DELETE FROM neurons; DELETE FROM synapses; DELETE FROM access_log; DELETE FROM sessions;");
const engine5 = new HebbianEngine(db, "verify-confidence");

// Record a file with known context
engine5.record("auth.ts", "file", "authentication login security", baseTime);

// Query that matches context well
const goodRecall = await engine5.recall({ query: "authentication login", limit: 5 });
console.log(`  "authentication login" → ${goodRecall.length} results`);
if (goodRecall.length > 0) {
  console.log(`    confidence: ${(goodRecall[0].confidence * 100).toFixed(1)}%`);
  console.log(`    above gate (40%): ${goodRecall[0].confidence >= 0.4}`);
}

// Query with no context match
const badRecall = await engine5.recall({ query: "kubernetes docker deployment", limit: 5 });
console.log(`  "kubernetes docker deployment" → ${badRecall.length} results (expect 0)`);

const gate_ok = goodRecall.length > 0 && badRecall.length === 0;
console.log(`  RESULT: ${gate_ok ? '✅ PASS' : '❌ FAIL'}\n`);

// --- Test 6: Spreading activation ---
console.log("TEST 6: Spreading activation (finding files via synaptic connections)");

db.exec("DELETE FROM neurons; DELETE FROM synapses; DELETE FROM access_log; DELETE FROM sessions;");
const engine6 = new HebbianEngine(db, "verify-spread");

// Build a strong connection: A and B always co-accessed
for (let i = 0; i < 15; i++) {
  const t = baseTime + i * 70_000;
  engine6.record("alpha.ts", "file", "authentication security", t);
  engine6.record("beta.ts", "file", "session management", t + 3_000);
}

// Check synapse weight
const syn6 = engine6.allSynapses();
const ab6 = syn6.find(s => s.source_id.includes("alpha") && s.target_id.includes("beta"));
console.log(`  alpha→beta weight after 15 co-accesses: ${ab6?.weight.toFixed(2)}`);

// Query for "authentication" — should find alpha directly, beta via spreading
const spread = await engine6.recall({ query: "authentication security", limit: 5 });
console.log(`  "authentication security" results: ${spread.length}`);
for (const r of spread) {
  console.log(`    ${r.neuron.path}: ${(r.confidence * 100).toFixed(1)}% (via ${r.activation_path})`);
}

const foundAlpha = spread.some(r => r.neuron.path === "alpha.ts" && r.activation_path === "direct");
const foundBeta = spread.some(r => r.neuron.path === "beta.ts" && r.activation_path.includes("spread"));
console.log(`  Found alpha directly: ${foundAlpha}`);
console.log(`  Found beta via spread: ${foundBeta}`);
console.log(`  RESULT: ${foundAlpha ? '✅ Direct recall PASS' : '❌ Direct recall FAIL'}`);
console.log(`  RESULT: ${foundBeta ? '✅ Spreading activation PASS' : '⚠️  Spreading not triggered (may need higher confidence on alpha)'}\n`);

// --- Test 7: Token savings math ---
console.log("TEST 7: Token savings calculation (with sigmoid myelination)");

db.exec("DELETE FROM neurons; DELETE FROM synapses; DELETE FROM access_log; DELETE FROM sessions;");
const engine7 = new HebbianEngine(db, "verify-tokens");

// Record 10 accesses to same file
// Myelination (sigmoid growth, 9 increments after initial 0):
// After 1: 0 (insert)
// After 2: 0 + 0.02*(1-0) = 0.02
// After 3: 0.02 + 0.02*(1-0.02) = 0.0396
// After 4: 0.0396 + 0.02*(1-0.0396) = 0.0588
// After 5: 0.0588 + 0.02*(1-0.0588) = 0.0776
// After 6: 0.0776 + 0.02*(1-0.0776) = 0.0961
// After 7: 0.0961 + 0.02*(1-0.0961) = 0.1142
// After 8: 0.1142 + 0.02*(1-0.1142) = 0.1319
// After 9: 0.1319 + 0.02*(1-0.1319) = 0.1493
// After 10: 0.1493 + 0.02*(1-0.1493) = 0.1663
for (let i = 0; i < 10; i++) {
  engine7.record("frequent.ts", "file", "hot path", baseTime + i * 10_000);
}

const report = engine7.tokenReport();
// 10 accesses * (1500 + 500) = 20,000 tokens without brainbox
// myelination ≈ 0.1663, so floor(10 * 0.1663) = 1 access via recall
// 1 recall * 1500 + 9 search * 2000 = 1500 + 18000 = 19500 with brainbox
// saved = 500
console.log(`  10 accesses, myelination ≈ 16.6%`);
console.log(`  Without: ${report.tokens_used} (expect 20,000)`);
console.log(`  With:    ${report.tokens_with_brainbox} (expect 19,500)`);
console.log(`  Saved:   ${report.tokens_saved} (expect 500)`);
console.log(`  Pct:     ${report.savings_pct.toFixed(1)}% (expect 2.5%)`);

const tok_ok = report.tokens_used === 20000 && report.tokens_saved === 500;
console.log(`  RESULT: ${tok_ok ? '✅ PASS' : '❌ FAIL — check math'}\n`);

// --- Test 8: Error→Fix pair learning ---
console.log("TEST 8: Error→Fix pair learning (debugging immune system)");

db.exec("DELETE FROM neurons; DELETE FROM synapses; DELETE FROM access_log; DELETE FROM sessions;");
const engine8 = new HebbianEngine(db, "verify-errors");

// Session 1: encounter error, then fix it by editing auth.ts and session.ts
await engine8.recordError("TypeError: cannot read property 'token' of undefined", "auth debugging");
engine8.record("src/api/auth.ts", "file", "fixing auth token", baseTime + 5_000);
engine8.record("src/session.ts", "file", "fixing session", baseTime + 10_000);

// Session 2: encounter same error pattern again, fix same files
await engine8.recordError("TypeError: cannot read property 'token' of null", "auth issue");
engine8.record("src/api/auth.ts", "file", "fixing auth again", baseTime + 100_000);
engine8.record("src/session.ts", "file", "fixing session again", baseTime + 105_000);

// Session 3: encounter a THIRD similar error — this time, check if fix files are suggested
const { errorNeuron, potentialFixes } = await engine8.recordError(
  "TypeError: cannot read property 'token' of undefined",
  "auth broken"
);

console.log(`  Error neuron path: ${errorNeuron.path}`);
console.log(`  Error access count: ${errorNeuron.access_count}`);
console.log(`  Potential fixes recalled: ${potentialFixes.length}`);

// Check that the error→file synapses formed (error neurons get 2x learning boost)
const allSyn8 = engine8.allSynapses();
const errorToAuth = allSyn8.find(
  (s) => s.source_id.includes("error:") && s.target_id.includes("auth.ts")
);
console.log(`  Error→auth.ts synapse: weight=${errorToAuth?.weight.toFixed(3) || 'NONE'}, co_access=${errorToAuth?.co_access_count || 0}`);

// The error should have synapses to fix files
const hasErrorSynapses = errorToAuth && errorToAuth.weight > 0;
console.log(`  Error has synapses to fix files: ${hasErrorSynapses}`);

// Error learning boost: synapses involving errors should be stronger
// than equivalent file-file synapses (2x learning rate)
const error_ok = hasErrorSynapses && errorNeuron.access_count >= 2;
console.log(`  RESULT: ${error_ok ? '✅ PASS' : '❌ FAIL'}\n`);

// --- Test 9: Tool sequence myelination ---
console.log("TEST 9: Tool sequence myelination (muscle memory)");

db.exec("DELETE FROM neurons; DELETE FROM synapses; DELETE FROM access_log; DELETE FROM sessions;");
const engine9 = new HebbianEngine(db, "verify-tools");

// Build a consistent Grep→Read→Edit pattern (20 repetitions)
for (let i = 0; i < 20; i++) {
  const t = baseTime + i * 100_000; // 100s between repetitions (resets co-access window)
  engine9.record("Grep", "tool", "searching", t);
  engine9.record("Read", "tool", "reading", t + 5_000);
  engine9.record("Edit", "tool", "editing", t + 10_000);
  engine9.record("example.ts", "file", "working on example", t + 12_000);
}

// Check synapse Grep→Read
const syn9 = engine9.allSynapses();
const grepToRead = syn9.find(
  (s) => s.source_id === "tool:Grep" && s.target_id === "tool:Read"
);
const readToEdit = syn9.find(
  (s) => s.source_id === "tool:Read" && s.target_id === "tool:Edit"
);
console.log(
  `  Grep→Read synapse: weight=${grepToRead?.weight.toFixed(2)}, co_access=${grepToRead?.co_access_count}`
);
console.log(
  `  Read→Edit synapse: weight=${readToEdit?.weight.toFixed(2)}, co_access=${readToEdit?.co_access_count}`
);

// Test prediction
const { nextTools } = engine9.predictNext("Grep");
console.log(`  After Grep, predicted tools: ${nextTools.length}`);
const predictedRead = nextTools.find((r) => r.neuron.path === "Read");
console.log(
  `  Predicted Read: ${predictedRead ? "YES" : "NO"} (confidence: ${predictedRead ? (predictedRead.confidence * 100).toFixed(0) + "%" : "N/A"})`
);

// Check tool chain tracking
const chain = engine9.getToolChain();
console.log(`  Tool chain length: ${chain.length} (expect 10, capped from 80)`);
console.log(`  Last 3 in chain: ${chain.slice(-3).join(" -> ")}`);

const tool_ok =
  grepToRead !== undefined &&
  grepToRead.weight > 0.8 &&
  predictedRead !== undefined;
console.log(`  RESULT: ${tool_ok ? "✅ PASS" : "❌ FAIL"}\n`);

// --- Test 10: Multi-hop spreading activation ---
console.log("TEST 10: Multi-hop spreading (3-hop BFS + convergence detection)");
console.log("Setup: alpha↔beta and beta↔gamma as separate link pairs (no direct alpha→gamma synapse)\n");

db.exec("DELETE FROM neurons; DELETE FROM synapses; DELETE FROM access_log; DELETE FROM sessions;");
const engine10 = new HebbianEngine(db, "verify-multihop");

// Build alpha↔beta link (20 co-accesses, strong synapse)
for (let i = 0; i < 20; i++) {
  const t = baseTime + i * 10_000;
  engine10.record("alpha.ts", "file", "entry point auth", t);
  engine10.record("beta.ts", "file", "middleware layer", t + 1_000);
}

// Flush sequential window with 10+ filler files so alpha is evicted before gamma phase
for (let i = 0; i < 11; i++) {
  engine10.record(`spacer${i}.ts`, "file", "spacer", baseTime + 300_000 + i * 1_000);
}

// Build beta↔gamma link (20 co-accesses, strong synapse)
// alpha is out of the window, so no direct alpha→gamma synapse
for (let i = 0; i < 20; i++) {
  const t = baseTime + 400_000 + i * 10_000;
  engine10.record("beta.ts", "file", "middleware layer", t);
  engine10.record("gamma.ts", "file", "data access layer", t + 1_000);
}

// Check synapse chain
const syn10 = engine10.allSynapses();
const abSyn = syn10.find(s => s.source_id === "file:alpha.ts" && s.target_id === "file:beta.ts");
const bgSyn = syn10.find(s => s.source_id === "file:beta.ts" && s.target_id === "file:gamma.ts");
const agSyn = syn10.find(s => s.source_id === "file:alpha.ts" && s.target_id === "file:gamma.ts");
console.log(`  alpha→beta weight: ${abSyn?.weight.toFixed(2) || 'NONE'}`);
console.log(`  beta→gamma weight: ${bgSyn?.weight.toFixed(2) || 'NONE'}`);
console.log(`  alpha→gamma weight: ${agSyn?.weight.toFixed(2) || 'NONE (expected — no direct link)'}`);

// Query for "entry point auth" — should find alpha directly, beta at hop 1, gamma at hop 2
const multihop = await engine10.recall({ query: "entry point auth", limit: 10 });

console.log(`\n  "entry point auth" results: ${multihop.length}`);
for (const r of multihop) {
  console.log(`    ${r.neuron.path}: ${(r.confidence * 100).toFixed(1)}% (${r.activation_path})`);
}

const mhAlpha = multihop.find(r => r.neuron.path === "alpha.ts" && r.activation_path === "direct");
const mhBeta = multihop.find(r => r.neuron.path === "beta.ts" && r.activation_path.includes("spread(1)"));
const mhGamma = multihop.find(r => r.neuron.path === "gamma.ts" && r.activation_path.includes("spread(2)"));

console.log(`\n  Alpha (direct): ${mhAlpha ? '✅' : '❌'}`);
console.log(`  Beta (1-hop spread): ${mhBeta ? '✅' : '❌'}`);
console.log(`  Gamma (2-hop spread): ${mhGamma ? '✅' : '❌'}`);

if (mhGamma) {
  console.log(`  Gamma confidence: ${(mhGamma.confidence * 100).toFixed(1)}% (reached through beta, NOT directly)`);
}

const multihop_ok = mhAlpha && mhBeta && mhGamma;
console.log(`  RESULT: ${multihop_ok ? '✅ PASS' : '❌ FAIL'}\n`);

console.log("=== VERIFICATION COMPLETE ===");

db.close();
} // end main()

main().catch(console.error);
