#!/usr/bin/env node
/** PostToolUse / SessionEnd observation; failures never block the host agent. */
import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
import { recordEvents, recallSessionId, flushAntiRecall } from "./adapter.js";
import { openDb } from "./db.js";
import { compileProcedures } from "./procedures.js";
import type Database from "better-sqlite3";

process.env.BRAINBOX_DB_TIMEOUT_MS = "100";
process.env.BRAINBOX_HOOK = "1";
const adapter = new ClaudeCodeAdapter();
const response = JSON.stringify({ continue: true, suppressOutput: true });

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  if (!input || typeof input !== "object") return;
  const payload = input as Record<string, unknown>;
  const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
  const sessionId = recallSessionId(typeof payload.session_id === "string" ? payload.session_id : undefined, cwd);
  if (payload.hook_event_name === "SessionEnd" || payload.hook_event_name === "Stop") {
    flushAntiRecall(sessionId);
    let db: Database.Database | undefined;
    try {
      // Leave 200ms for closing/response before the hook's 3.5s watchdog.
      const deadline = 3300;
      if (performance.now() + 500 < deadline) {
        db = openDb();
        compileProcedures(db, { sessionId, deadline });
      }
    } catch {
      // Mining must never interfere with session shutdown.
    } finally {
      db?.close();
    }
    return;
  }
  const events = adapter.extractEvents(input);
  recordEvents(events, sessionId);
  let db: Database.Database | undefined;
  try {
    const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "unknown";
    const toolResponse = payload.tool_response && typeof payload.tool_response === "object"
      ? payload.tool_response as Record<string, unknown> : {};
    const truncate = (value: unknown) => {
      const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
      return text.length > 8192 ? text.slice(0, 8192) : text;
    };
    db = openDb();
    const seq = db.prepare("SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq FROM session_replay WHERE session_id=?")
      .get(sessionId) as { next_seq: number };
    db.prepare(`INSERT INTO session_replay(session_id, seq, ts, tool_name, tool_input, tool_result, exit_code, cwd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(sessionId, seq.next_seq, new Date().toISOString(), toolName,
      truncate(payload.tool_input), truncate(toolResponse.content ?? payload.tool_result ?? payload.output),
      typeof toolResponse.exit_code === "number" ? toolResponse.exit_code : null, cwd ?? null);
  } finally {
    db?.close();
  }
}

const timeout = setTimeout(() => {
  console.log(response);
  process.exit(0);
}, 3500);
main().catch(() => {}).finally(() => {
  clearTimeout(timeout);
  console.log(response);
});
