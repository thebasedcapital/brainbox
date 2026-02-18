#!/usr/bin/env node
/**
 * Independent verification: query SQLite directly, bypass the engine entirely.
 * Compare raw DB values against hand-calculated expectations.
 */
import Database from "better-sqlite3";
import { openDb } from "./db.js";
import { HebbianEngine } from "./hebbian.js";

const db = openDb();
let pass = 0;
let fail = 0;

function check(name: string, actual: number, expected: number, tolerance = 0.001) {
  const ok = Math.abs(actual - expected) < tolerance;
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}: ${actual} === ${expected}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}: got ${actual}, expected ${expected} (diff: ${Math.abs(actual - expected)})`);
  }
}

console.log("=== INDEPENDENT VERIFICATION: Raw SQL vs Hand Calculations ===\n");

// --- Setup: record known events ---
db.exec("DELETE FROM neurons; DELETE FROM synapses; DELETE FROM access_log; DELETE FROM sessions;");
const engine = new HebbianEngine(db, "rawsql-verify");

const t0 = Date.now();

// 10 accesses to fileA, co-accessed with fileB in first 5
for (let i = 0; i < 10; i++) {
  engine.record("fileA.ts", "file", "alpha query", t0 + i * 10_000);
  if (i < 5) {
    engine.record("fileB.ts", "file", "beta query", t0 + i * 10_000 + 3_000);
  }
}

// --- RAW SQL: Check neuron myelination ---
console.log("1. Myelination via raw SQL (v3.0 BCM sliding threshold):");
const neuronA = db.prepare("SELECT myelination, access_count FROM neurons WHERE path = 'fileA.ts'").get() as any;
const neuronB = db.prepare("SELECT myelination, access_count FROM neurons WHERE path = 'fileB.ts'").get() as any;

// v3.0 BCM: delta = MYELIN_RATE * (1 - myelin/MYELIN_MAX) * max(1/sqrt(accessCount), 0.1)
// fileA: 10 accesses. BCM gives diminishing returns as myelin + access count increase.
// After 10: ~0.0901 (vs old formula: 0.1663 — BCM prevents runaway)
check("fileA myelination", neuronA.myelination, 0.0901, 0.005);
check("fileA access_count", neuronA.access_count, 10);

// fileB: 5 accesses. BCM:
// After 5: ~0.0545 (vs old formula: 0.0776 — BCM dampens high-frequency access)
check("fileB myelination", neuronB.myelination, 0.0545, 0.005);
check("fileB access_count", neuronB.access_count, 5);

// --- RAW SQL: Check synapse weights ---
console.log("\n2. Synapse weights via raw SQL (with diminishing returns):");
const synAB = db.prepare(
  "SELECT weight, co_access_count FROM synapses WHERE source_id = 'file:fileA.ts' AND target_id = 'file:fileB.ts'"
).get() as any;
const synBA = db.prepare(
  "SELECT weight, co_access_count FROM synapses WHERE source_id = 'file:fileB.ts' AND target_id = 'file:fileA.ts'"
).get() as any;

// v3.0: SNAP sigmoidal plasticity + diminishing returns.
// v3.2: Synaptic tagging + capture — new synapses get tagged, early re-access captures at 0.3
// This gives synapses a head start (0.3 vs natural ~0.1), increasing final weight.
// 14 co-accesses total with SNAP + capture → converges at ~0.612
check("A→B weight", synAB.weight, 0.612, 0.01);
check("A→B co_access_count", synAB.co_access_count, 14);
check("B→A weight", synBA.weight, 0.612, 0.01); // symmetric
check("B→A co_access_count", synBA.co_access_count, 14);

// --- RAW SQL: Check access_log count ---
console.log("\n3. Access log integrity:");
const logCount = db.prepare("SELECT COUNT(*) as cnt FROM access_log").get() as any;
// 10 fileA + 5 fileB = 15
check("total access_log entries", logCount.cnt, 15);

// --- RAW SQL: Check no phantom neurons ---
console.log("\n4. No phantom neurons:");
const neuronCount = db.prepare("SELECT COUNT(*) as cnt FROM neurons").get() as any;
check("neuron count", neuronCount.cnt, 2); // only fileA and fileB

// --- RAW SQL: Check synapse count ---
console.log("\n5. Synapse count (bidirectional pairs):");
const synapseCount = db.prepare("SELECT COUNT(*) as cnt FROM synapses").get() as any;
check("synapse count", synapseCount.cnt, 2); // A→B and B→A only

// --- CROSS-CHECK: Engine values match raw SQL ---
console.log("\n6. Engine vs raw SQL cross-check:");
const engineNeurons = engine.allNeurons();
const engineA = engineNeurons.find(n => n.path === "fileA.ts");
const engineB = engineNeurons.find(n => n.path === "fileB.ts");

check("engine fileA myelin matches SQL", engineA!.myelination, neuronA.myelination);
check("engine fileB myelin matches SQL", engineB!.myelination, neuronB.myelination);

const engineSynapses = engine.allSynapses();
const engSynAB = engineSynapses.find(s => s.source_id.includes("fileA") && s.target_id.includes("fileB"));
check("engine A→B weight matches SQL", engSynAB!.weight, synAB.weight);

// --- VERIFY TOKEN MATH ---
console.log("\n7. Token savings math (with v3.0 BCM myelination):");
const report = engine.tokenReport();
// 15 accesses * 2000 (search + read) = 30,000 without
check("tokens without brainbox", report.tokens_used, 30000);
// v3.0 BCM: lower myelination values
// fileA: 10 accesses, myelin≈0.0901, floor(10*0.0901)=0 via recall, 10 via search
// fileB: 5 accesses, myelin≈0.0545, floor(5*0.0545)=0 via recall, 5 via search
// With: 0*1500 + 10*2000 + 0*1500 + 5*2000 = 20000 + 10000 = 30000
check("tokens with brainbox", report.tokens_with_brainbox, 30000);
check("tokens saved", report.tokens_saved, 0);

// --- SUMMARY ---
console.log(`\n${"═".repeat(50)}`);
console.log(`RESULTS: ${pass} passed, ${fail} failed out of ${pass + fail} checks`);
console.log(`${"═".repeat(50)}`);

if (fail > 0) {
  console.log("\n⚠️  DISCREPANCIES FOUND — investigate before trusting the engine!");
  process.exit(1);
} else {
  console.log("\n✅ ALL MATH VERIFIED — engine values match hand calculations and raw SQL.");
}

db.close();
