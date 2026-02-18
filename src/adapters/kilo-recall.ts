#!/usr/bin/env node
/**
 * BrainBox Kilo Recall Entry Point
 *
 * Receives a prompt on stdin, runs neural recall, and outputs
 * formatted recall results to stdout.
 *
 * Called by happy-cli's runKilo.ts before spawning kilo headless.
 *
 * Stdin: raw prompt text
 * Stdout: formatted recall results (or empty if no confident results)
 */

import { KiloAdapter } from "./kilo.js";

const adapter = new KiloAdapter();

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const prompt = Buffer.concat(chunks).toString("utf-8").trim();
  if (!prompt || prompt.length < 15) process.exit(0);

  try {
    const enriched = await adapter.enrichPrompt!(prompt);
    if (enriched) {
      console.log(enriched);
    }
  } catch {
    // Silent failure
  }
}

const timeout = setTimeout(() => process.exit(0), 3000);
main().finally(() => clearTimeout(timeout));
