#!/usr/bin/env node

/**
 * BrainBox PostToolUse Hook for Claude Code
 *
 * Automatically records file accesses and tool usage into BrainBox
 * whenever Claude Code uses Read, Edit, Write, Grep, or Glob tools.
 *
 * Runs as a Claude Code hook — receives JSON on stdin, outputs JSON on stdout.
 * Never blocks Claude's workflow (always exits with continue: true).
 *
 * Uses the ClaudeCodeAdapter (DomainAdapter pattern) for event extraction.
 */

import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
import { recordEvents, trackOpenedFile, autoTagProject } from "./adapter.js";
import { openDb } from "./db.js";

const adapter = new ClaudeCodeAdapter();

async function main() {
  // Read stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    // Invalid JSON — bail silently
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    process.exit(0);
  }

  try {
    const sessionId =
      (input as any)?.session_id || `hook-${Date.now()}`;
    const events = adapter.extractEvents(input);
    recordEvents(events, sessionId);

    // Session replay: capture full tool call for debuggability
    try {
      const toolName = (input as any)?.tool_name || (input as any)?.tool?.name || 'unknown';
      const toolInput = (input as any)?.tool_input ?? (input as any)?.tool?.input ?? null;
      const toolResult = (input as any)?.tool_response?.content ?? (input as any)?.output ?? null;
      const exitCode = (input as any)?.tool_response?.exit_code ?? null;
      const cwd = (input as any)?.cwd ?? null;

      // Truncate large payloads to 8KB to avoid DB bloat
      const truncate = (v: unknown, max = 8192) => {
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        return s && s.length > max ? s.slice(0, max) + '…[truncated]' : s;
      };

      const db = openDb();
      // Get next seq for this session
      const seqRow = db.prepare(
        `SELECT COALESCE(MAX(seq), -1) + 1 as next_seq FROM session_replay WHERE session_id = ?`
      ).get(sessionId) as { next_seq: number };

      db.prepare(`
        INSERT INTO session_replay (session_id, seq, ts, tool_name, tool_input, tool_result, exit_code, cwd)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        seqRow.next_seq,
        new Date().toISOString(),
        toolName,
        truncate(toolInput),
        truncate(toolResult),
        exitCode,
        cwd
      );
    } catch {
      // never block Claude
    }


    // Anti-recall: track opened files (Read/Edit/Write = file was actually used)
    for (const event of events) {
      if (event.type === "file") {
        trackOpenedFile(sessionId, `file:${event.path}`);
      }
    }

    // v5: Auto-tag project from file paths (derives project name from path structure)
    const cwd = (input as any)?.cwd;
    if (cwd) {
      autoTagProject(cwd);
    }
  } catch {
    // BrainBox recording failed — never block Claude
  }

  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(0);
}

// Safety timeout — never hang
const timeout = setTimeout(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(0);
}, 4000);

main().finally(() => clearTimeout(timeout));
