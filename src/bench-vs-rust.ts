#!/usr/bin/env npx tsx
/**
 * BrainBox TypeScript benchmark — matches Rust vs_typescript.rs for apples-to-apples comparison.
 * Run: BRAINBOX_DB=:memory: npx tsx src/bench-vs-rust.ts
 */

import { openDb } from "./db.js";
import { HebbianEngine } from "./hebbian.js";

function sandbox(): HebbianEngine {
  const db = openDb(":memory:");
  return new HebbianEngine(db, "bench");
}

function benchRecord(n: number): number {
  const engine = sandbox();
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    engine.record(`src/module${i % 50}.ts`, "file", `query for module ${i % 50}`);
  }
  return performance.now() - start;
}

async function benchRecall(networkSize: number, recallCount: number): Promise<number> {
  const engine = sandbox();
  for (let i = 0; i < networkSize; i++) {
    engine.record(`src/module${i}.ts`, "file", `authentication security module ${i}`);
  }
  const start = performance.now();
  for (let i = 0; i < recallCount; i++) {
    await engine.recall({ query: "authentication security", limit: 5 });
  }
  return performance.now() - start;
}

function benchDecay(networkSize: number): number {
  const engine = sandbox();
  for (let i = 0; i < networkSize; i++) {
    engine.record(`src/file${i}.ts`, "file", "query");
  }
  const start = performance.now();
  engine.decay();
  return performance.now() - start;
}

function benchConsolidate(networkSize: number): number {
  const engine = sandbox();
  for (let i = 0; i < networkSize; i++) {
    engine.record(`src/file${i}.ts`, "file", "query");
  }
  const start = performance.now();
  engine.consolidate();
  return performance.now() - start;
}

async function benchFullWorkflow(): Promise<[number, number, number]> {
  const engine = sandbox();
  const wsFiles = ["src/api/apiSession.ts", "src/api/auth.ts", "src/api/encryption.ts"];
  const configFiles = ["src/config.ts", "src/env.ts"];
  const testFiles = ["src/tests/session.test.ts", "src/tests/auth.test.ts"];
  const tools = ["Grep", "Read", "Edit"];

  const start = performance.now();

  for (let session = 0; session < 20; session++) {
    for (const file of wsFiles) {
      for (const tool of tools.slice(0, 2)) {
        engine.record(tool, "tool", "searching");
      }
      engine.record(file, "file", "websocket session auth");
    }
    if (session % 3 === 0) {
      for (const file of configFiles) {
        engine.record(file, "file", "configuration");
      }
    }
    if (session % 5 === 0) {
      for (const file of testFiles) {
        for (const tool of tools) {
          engine.record(tool, "tool", "testing");
        }
        engine.record(file, "file", "test auth session");
      }
    }
    if ([0, 4, 9, 14, 19].includes(session)) {
      await engine.recall({ query: "websocket session", limit: 5 });
      await engine.recall({ query: "authentication", limit: 5 });
    }
  }

  engine.decay();
  engine.consolidate();

  const queries = [
    "websocket session",
    "authentication security",
    "configuration environment",
    "test auth",
    "completely unknown xyz",
  ];
  for (const q of queries) {
    await engine.recall({ query: q, limit: 5 });
  }

  const elapsed = performance.now() - start;
  const stats = engine.stats();
  return [elapsed, stats.neuron_count, stats.synapse_count];
}

async function benchErrorFix(n: number): Promise<number> {
  const engine = sandbox();
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    await engine.recordError(`TypeError: cannot read property 'field${i}' of undefined`, "debugging");
    engine.record(`src/fix${i % 10}.ts`, "file", "fixing error");
    engine.resolveError(
      `TypeError: cannot read property 'field${i}' of undefined`,
      [`src/fix${i % 10}.ts`],
      "fixed it"
    );
  }
  return performance.now() - start;
}

async function main() {
  console.log("BrainBox TypeScript Benchmark");
  console.log("═══════════════════════════════════════════════════════\n");

  // Warm up
  sandbox();

  // Record
  console.log("Record (Hebbian learning):");
  for (const n of [100, 500, 1000, 5000]) {
    const ms = benchRecord(n);
    const perOp = (ms * 1000) / n;
    console.log(`  ${String(n).padStart(5)} records: ${ms.toFixed(2).padStart(8)}ms (${perOp.toFixed(1)}µs/op)`);
  }
  console.log();

  // Recall
  console.log("Recall (spreading activation):");
  for (const [net, queries] of [[50, 100], [200, 100], [500, 100]] as [number, number][]) {
    const ms = await benchRecall(net, queries);
    const perOp = (ms * 1000) / queries;
    console.log(`  ${String(net).padStart(4)} neurons, ${queries} recalls: ${ms.toFixed(2).padStart(8)}ms (${perOp.toFixed(1)}µs/recall)`);
  }
  console.log();

  // Decay
  console.log("Decay (pruning + homeostasis):");
  for (const n of [50, 200, 500]) {
    const ms = benchDecay(n);
    console.log(`  ${String(n).padStart(4)} neurons: ${ms.toFixed(2).padStart(8)}ms`);
  }
  console.log();

  // Consolidation
  console.log("Consolidation (sleep replay):");
  for (const n of [50, 200, 500]) {
    const ms = benchConsolidate(n);
    console.log(`  ${String(n).padStart(4)} neurons: ${ms.toFixed(2).padStart(8)}ms`);
  }
  console.log();

  // Error→Fix
  console.log("Error→Fix learning:");
  for (const n of [10, 50, 100]) {
    const ms = await benchErrorFix(n);
    const perOp = (ms * 1000) / n;
    console.log(`  ${String(n).padStart(4)} cycles: ${ms.toFixed(2).padStart(8)}ms (${perOp.toFixed(1)}µs/cycle)`);
  }
  console.log();

  // Full workflow
  console.log("Full 20-session developer workflow (mirrors Scenario A1):");
  const [ms, neurons, synapses] = await benchFullWorkflow();
  console.log(`  Total: ${ms.toFixed(2)}ms`);
  console.log(`  Network: ${neurons} neurons, ${synapses} synapses`);
  console.log();

  console.log("═══════════════════════════════════════════════════════");
  console.log("Done.");
}

main().catch(console.error);
