#!/usr/bin/env node
/**
 * BrainBox Kilo Recording Entry Point
 *
 * Receives a Kilo tool_use event on stdin, extracts file paths using
 * the KiloAdapter, and records them into BrainBox.
 *
 * Called by happy-cli's runKilo.ts as a fire-and-forget subprocess.
 *
 * Stdin: JSON { event: KiloToolEvent, sessionId: string }
 * Stdout: nothing (silent operation)
 */

import { KiloAdapter } from "./kilo.js";
import { recordEvents } from "../adapter.js";

const adapter = new KiloAdapter();

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) process.exit(0);

  try {
    const { event, sessionId } = JSON.parse(raw);
    const events = adapter.extractEvents(event);
    recordEvents(events, sessionId || `kilo-${Date.now()}`);
  } catch {
    // Silent failure — never block Kilo
  }
}

const timeout = setTimeout(() => process.exit(0), 3000);
main().finally(() => clearTimeout(timeout));
