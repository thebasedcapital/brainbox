#!/usr/bin/env node
/**
 * BrainBox UserPromptSubmit Hook
 *
 * Runs neural recall against the user's prompt and injects relevant
 * file suggestions into Claude's context — zero MCP calls needed.
 *
 * Stdin: JSON with { prompt: "..." } from Claude Code
 * Stdout: Text injected as system-reminder (like VaultGraph hook)
 *
 * Only outputs when high-confidence results exist.
 * Silent (exit 0) when BrainBox has nothing useful to add.
 *
 * Uses the ClaudeCodeAdapter (DomainAdapter pattern) for recall.
 */

import { ClaudeCodeAdapter } from "./adapters/claude-code.js";

const adapter = new ClaudeCodeAdapter();

async function main() {
  // Read stdin — Claude Code sends { prompt: "..." }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();

  if (!raw) process.exit(0);

  let prompt: string;
  let cwd: string | undefined;
  try {
    const data = JSON.parse(raw);
    prompt = data.prompt || "";
    cwd = data.cwd;
  } catch {
    // Not JSON — try raw text (piped directly)
    prompt = raw;
  }

  // Skip very short prompts ("yes", "ok", "y", etc.)
  if (prompt.length < 5) process.exit(0);

  try {
    const enriched = await adapter.enrichPrompt!(prompt, cwd);
    if (enriched) {
      console.log(enriched);
    }
  } catch {
    // BrainBox failure — silent exit, never block Claude
    process.exit(0);
  }
}

// Safety timeout
const timeout = setTimeout(() => process.exit(0), 4000);
main().finally(() => clearTimeout(timeout));
