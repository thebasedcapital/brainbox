/**
 * Minimal async test harness shared by src/test.ts and src/tests/*.test.ts.
 * Test files register suites at import time; src/test.ts runs them all.
 */
import { openDb } from "./db.js";
import { HebbianEngine } from "./hebbian.js";

type TestFn = () => void | Promise<void>;

const allTests: { suite: string; name: string; fn: TestFn }[] = [];
let suiteCount = 0;
let currentSuiteName = "";

export function describe(name: string, fn: () => void) {
  suiteCount++;
  currentSuiteName = name;
  fn();
}

export function test(name: string, fn: TestFn) {
  allTests.push({ suite: currentSuiteName, name, fn });
}

export function eq(actual: number, expected: number, tolerance = 0.005, msg = "") {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${msg}expected ${expected}, got ${actual} (diff: ${Math.abs(actual - expected).toFixed(6)})`);
  }
}

export function ok(cond: boolean, msg = "assertion failed") {
  if (!cond) throw new Error(msg);
}

/** Create a fresh in-memory DB + engine. Fully isolated. */
export function sandbox(sessionId = "test") {
  const db = openDb(":memory:");
  const engine = new HebbianEngine(db, sessionId);
  const reset = () => {
    db.exec("DELETE FROM neurons; DELETE FROM synapses; DELETE FROM access_log; DELETE FROM sessions;");
  };
  return { db, engine, reset, close: () => db.close() };
}

/** Run every registered test; optional substring filter on "suite › name". */
export async function runAll(filter?: string) {
  const t0 = Date.now();
  let passCount = 0;
  let failCount = 0;
  let lastSuite = "";
  for (const t of allTests) {
    if (filter && !`${t.suite} › ${t.name}`.toLowerCase().includes(filter.toLowerCase())) continue;
    if (t.suite !== lastSuite) {
      console.log(`\n  ${t.suite}`);
      lastSuite = t.suite;
    }
    try {
      await t.fn();
      passCount++;
      console.log(`    ✅ ${t.name}`);
    } catch (e: unknown) {
      failCount++;
      console.log(`    ❌ ${t.name}`);
      console.log(`       ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const elapsed = Date.now() - t0;
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  ${suiteCount} suites, ${passCount + failCount} tests`);
  console.log(`  ✅ ${passCount} passed  ${failCount > 0 ? `❌ ${failCount} failed` : ""}`);
  console.log(`  ${elapsed}ms`);
  console.log(`${"─".repeat(50)}`);

  process.exitCode = failCount > 0 ? 1 : 0;
}
