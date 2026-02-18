#!/usr/bin/env node
/**
 * Trace exact synapse strengthening events to understand the co_access_count=14 result
 */
import { openDb } from "./db.js";
import { HebbianEngine } from "./hebbian.js";

const db = openDb();
db.exec("DELETE FROM neurons; DELETE FROM synapses; DELETE FROM access_log; DELETE FROM sessions;");

// Monkey-patch the engine to log synapse events
const origExec = db.prepare("SELECT 1").run; // just to get the type

const t0 = Date.now();
const CO_ACCESS_WINDOW = 60_000;
const LEARNING_RATE = 0.1;

// Simulate manually what the engine does
const recentAccesses = new Map<string, number>();
let synapseEvents: { from: string; to: string; delta: number; timeDiff: number }[] = [];

for (let i = 0; i < 10; i++) {
  const tA = t0 + i * 10_000;

  // --- Record fileA at tA ---
  const idA = "file:fileA.ts";
  // Check what's in recentAccesses
  for (const [recentId, recentTs] of recentAccesses) {
    if (recentId === idA) continue;
    const diff = tA - recentTs;
    if (diff > CO_ACCESS_WINDOW) continue;
    const timeFactor = 1 - diff / CO_ACCESS_WINDOW;
    const delta = LEARNING_RATE * timeFactor;
    synapseEvents.push({ from: idA, to: recentId, delta, timeDiff: diff });
    synapseEvents.push({ from: recentId, to: idA, delta, timeDiff: diff });
  }
  recentAccesses.set(idA, tA);

  // --- Record fileB at tA + 3000 (only first 5 iterations) ---
  if (i < 5) {
    const tB = tA + 3_000;
    const idB = "file:fileB.ts";
    for (const [recentId, recentTs] of recentAccesses) {
      if (recentId === idB) continue;
      const diff = tB - recentTs;
      if (diff > CO_ACCESS_WINDOW) continue;
      const timeFactor = 1 - diff / CO_ACCESS_WINDOW;
      const delta = LEARNING_RATE * timeFactor;
      synapseEvents.push({ from: idB, to: recentId, delta, timeDiff: diff });
      synapseEvents.push({ from: recentId, to: idB, delta, timeDiff: diff });
    }
    recentAccesses.set(idB, tB);
  }
}

// Count events per direction
const abEvents = synapseEvents.filter(e => e.from === "file:fileA.ts" && e.to === "file:fileB.ts");
const baEvents = synapseEvents.filter(e => e.from === "file:fileB.ts" && e.to === "file:fileA.ts");

console.log(`A→B strengthening events: ${abEvents.length}`);
for (const e of abEvents) {
  console.log(`  delta: ${e.delta.toFixed(4)} (time diff: ${e.timeDiff}ms)`);
}

console.log(`\nB→A strengthening events: ${baEvents.length}`);
for (const e of baEvents) {
  console.log(`  delta: ${e.delta.toFixed(4)} (time diff: ${e.timeDiff}ms)`);
}

const abTotal = abEvents.reduce((s, e) => s + e.delta, 0);
const baTotal = baEvents.reduce((s, e) => s + e.delta, 0);
console.log(`\nA→B total accumulated weight: ${Math.min(abTotal, 1).toFixed(4)} (raw: ${abTotal.toFixed(4)})`);
console.log(`B→A total accumulated weight: ${Math.min(baTotal, 1).toFixed(4)} (raw: ${baTotal.toFixed(4)})`);
console.log(`\nTotal co_access_count (upserts): A→B=${abEvents.length}, B→A=${baEvents.length}`);

// The actual DB upsert does: weight = MIN(weight + delta, 1.0)
// And co_access_count increments on each upsert
// So co_access_count = number of events, NOT number of sessions

db.close();
