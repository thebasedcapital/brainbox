import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { extname, isAbsolute, normalize, relative } from "node:path";
import { detectBashError } from "./adapter.js";
import { extractErrorFingerprint } from "./hebbian.js";

/** Named controls make procedural mining/retrieval independently ablatable. */
export const PROCEDURE_POLICY = {
  enabled: true, workflowMinSessions: 3, minSequence: 3, maxSequence: 6,
  maxPerTrigger: 5, matchLimit: 3, candidateLimit: 80, overlapThreshold: 0.6,
} as const;

export interface Procedure {
  id: string;
  kind: "error_fix" | "workflow";
  trigger_key: string;
  trigger_text: string;
  steps: string[];
  support: number;
  helpful: number;
  harmful: number;
  last_validated: string | null;
  created_at: string;
  updated_at: string;
  deprecated: number;
  provenance: { session_id: string; seq: number; ts: string }[];
}
export interface ProcedureMatch { procedure: Procedure; score: number; triggerMatch: number }
export interface CompileResult {
  sessions: number; created: number; refined: number; validated: number; deprecated: number;
}
interface StoredProcedure extends Omit<Procedure, "steps" | "provenance"> {
  steps_json: string; provenance_json: string;
}
interface Replay {
  id: number; session_id: string; seq: number; ts: string; tool_name: string;
  tool_input: string | null; tool_result: string | null; exit_code: number | null; cwd: string | null;
}
interface Access { id: number; path: string; type: string; query: string | null; timestamp: string }
interface Event { seq: number; ts: string; tool: string; files: string[]; command: string; error: string | null; failed: boolean; success: boolean; label: string }
interface Candidate { id: string; kind: Procedure["kind"]; trigger_key: string; trigger_text: string; steps_json: string }
interface Exposure { procedure_id: string; replay_seq: number; outcome: number | null }
interface PendingFailure { event: Event; editIndex: number }

function parse(value: string | null): unknown {
  try { return JSON.parse(value || "null") as unknown; } catch { return null; }
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function decode(row: StoredProcedure): Procedure {
  const { steps_json, provenance_json, ...rest } = row;
  const evidence = parse(provenance_json);
  const provenance = Array.isArray(evidence) ? evidence.flatMap(value => {
    const entry = object(value);
    return typeof entry.session_id === "string" && typeof entry.seq === "number" && typeof entry.ts === "string"
      ? [{ session_id: entry.session_id, seq: entry.seq, ts: entry.ts }] : [];
  }) : [];
  return { ...rest, steps: strings(parse(steps_json)), provenance };
}
function identifier(kind: string, trigger: string, steps: string[]): string {
  return createHash("sha256").update(JSON.stringify([kind, trigger, steps])).digest("hex").slice(0, 20);
}
function canonicalTool(name: string): string {
  const tail = name.split(/[.:/]/).pop()?.toLowerCase() || name.toLowerCase();
  const names: Record<string, string> = { bash: "Bash", execute: "Bash", shell: "Bash", read: "Read", read_file: "Read", edit: "Edit", edit_file: "Edit", apply_patch: "Edit", write: "Write", write_file: "Write", multiedit: "Edit", grep: "Grep", search: "Grep", glob: "Glob" };
  return names[tail] || "Unknown";
}
const controls = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;
function singleLine(text: string, maxChars: number): string {
  return text.replace(controls, " ").replace(/\s+/g, " ").trim().slice(0, maxChars);
}
function canonicalFile(file: string, cwd?: string | null): string | null {
  if (!file || file.length > 200 || file.replace(controls, "") !== file) return null;
  const path = normalize(isAbsolute(file) && cwd ? relative(cwd, file) : file);
  return isAbsolute(path) || path === ".." || path.startsWith("../") || path.length > 200 ? null : path;
}
function canonicalStep(step: string): string | null {
  if (step.startsWith("Bash(") && step.endsWith(")")) return `Bash(${singleLine(step.slice(5, -1), 160)})`;
  const match = /^(Read|Edit|Write|Grep|Glob)(?: (.+))?$/u.exec(step);
  if (!match) return null;
  if (!match[2]) return match[1];
  const file = canonicalFile(match[2]);
  return file ? `${match[1]} ${file}` : null;
}
function triggerText(error: string): string {
  const fingerprint = extractErrorFingerprint(error).fingerprint;
  const normalized = detectBashError(error);
  return normalized ? `${fingerprint}: ${singleLine(normalized, 80)}` : fingerprint;
}
function fileKind(file: string): string {
  const cleaned = file.replace(/:\d+(?:[-+]\d+)?$/, "");
  const extension = extname(cleaned);
  const directory = cleaned.includes("/src/") || cleaned.startsWith("src/") ? "src/" : cleaned.includes("/tests/") || cleaned.startsWith("tests/") ? "tests/" : "";
  return `${directory}*${extension || "(no extension)"}`;
}
function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ").replace(/^cd\s+\S+\s*&&\s*/, "");
}
function similarCommand(a: string, b: string): boolean {
  const first = normalizeCommand(a), second = normalizeCommand(b);
  if (!first || !second) return false;
  if (first === second) return true;
  const left = first.split(" "), right = second.split(" ");
  if (left[0] !== right[0] || Math.min(left.length, right.length) < 2) return false;
  const intersection = left.filter(token => right.includes(token)).length;
  return intersection / Math.max(left.length, right.length) >= 0.8;
}
function outputText(value: string | null): string {
  const decoded = parse(value);
  if (Array.isArray(decoded)) return decoded.map(item => object(item).text).filter((text): text is string => typeof text === "string").join("\n");
  const record = object(decoded);
  return [record.stdout, record.stderr, record.text].filter((text): text is string => typeof text === "string").join("\n") || value || "";
}
function replayEvent(row: Replay, nearby: () => Access[]): Event {
  const input = object(parse(row.tool_input));
  const tool = canonicalTool(row.tool_name);
  let files = [input.file_path, input.path, input.file, input.filename].filter((file): file is string => typeof file === "string");
  const edits = input.edits;
  if (Array.isArray(edits)) for (const entry of edits) {
    const edit = object(entry);
    if (typeof edit.file_path === "string") files.push(edit.file_path);
  }
  const patch = typeof input.patch === "string" ? input.patch : row.tool_input?.startsWith("*** Begin Patch") ? row.tool_input : "";
  for (const match of patch.matchAll(/^(?:\*\*\* (?:Update|Add) File: |\[)([^\n#\]]+)/gm)) files.push(match[1]);
  const command = singleLine(typeof input.command === "string" ? input.command : typeof input.cmd === "string" ? input.cmd : "", 160);
  const output = outputText(row.tool_result);
  const detected = tool === "Bash" ? detectBashError(output) : null;
  // Access events supplement truncated/missing replay payloads, never establish success.
  if (!files.length && ["Read", "Edit", "Write"].includes(tool)) files = nearby().filter(access => access.type === "file").map(access => access.path);
  const failed = tool === "Bash" && (row.exit_code !== null ? row.exit_code !== 0 : detected !== null);
  // Preserve the error class: detectBashError deliberately strips TypeError prefixes.
  const errorLine = detected ? output.slice(-2000).split("\n").find(line => line.includes(detected)) : undefined;
  const error = detected ? errorLine?.trim() || detected : failed ? "Command failed" : null;
  const success = tool === "Bash" && (row.exit_code === 0 || (row.exit_code === null && !detected));
  files = [...new Set(files.flatMap(file => {
    const path = canonicalFile(file, row.cwd);
    return path ? [path] : [];
  }))];
  const suffix = tool === "Bash" && command ? `(${command})` : files.length ? ` ${fileKind(files[0])}` : "";
  return { seq: row.seq, ts: row.ts, tool, files, command, error, failed, success, label: tool + suffix };
}
/** Binary timestamp lookup avoids scanning all accesses for every replay row. */
function sessionEvents(rows: Replay[], accesses: Access[], checkBudget: () => void): Event[] {
  const timed = accesses.map(access => ({ access, time: Date.parse(access.timestamp) }))
    .filter(entry => Number.isFinite(entry.time)).sort((a, b) => a.time - b.time);
  return rows.map((row, index) => {
    if ((index & 255) === 0) checkBudget();
    return replayEvent(row, () => {
      const time = Date.parse(row.ts);
      let low = 0, high = timed.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (timed[middle].time < time - 1000) low = middle + 1; else high = middle;
      }
      const nearby: Access[] = [];
      for (let index = low; index < timed.length && timed[index].time <= time + 1000; index++) nearby.push(timed[index].access);
      return nearby;
    });
  });
}
function overlap(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  // Ordered overlap counts each repeated tool only once per occurrence.
  const lengths = Array<number>(b.length + 1).fill(0);
  for (const left of a) {
    let diagonal = 0;
    for (let index = 1; index <= b.length; index++) {
      const previous = lengths[index];
      lengths[index] = left === b[index - 1] ? diagonal + 1 : Math.max(lengths[index], lengths[index - 1]);
      diagonal = previous;
    }
  }
  return lengths[b.length] / Math.max(a.length, b.length) >= PROCEDURE_POLICY.overlapThreshold;
}

export function listProcedures(db: Database.Database, includeDeprecated = false): Procedure[] {
  return (db.prepare(`SELECT * FROM procedures ${includeDeprecated ? "" : "WHERE deprecated = 0"} ORDER BY support DESC, updated_at DESC, id`).all() as StoredProcedure[]).map(decode);
}
export function getProcedure(db: Database.Database, id: string): Procedure | null {
  const row = db.prepare("SELECT * FROM procedures WHERE id = ?").get(id) as StoredProcedure | undefined;
  return row ? decode(row) : null;
}
export function deprecateProcedure(db: Database.Database, id: string): boolean {
  return db.prepare("UPDATE procedures SET deprecated = 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id).changes > 0;
}
export function recordProcedureOutcome(db: Database.Database, id: string, helpful: boolean): void {
  db.prepare(`UPDATE procedures SET helpful = helpful + ?, harmful = harmful + ?, last_validated = ?, updated_at = ?,
    deprecated = CASE WHEN harmful + ? > helpful + ? + 2 THEN 1 ELSE deprecated END WHERE id = ?`)
    .run(helpful ? 1 : 0, helpful ? 0 : 1, new Date().toISOString(), new Date().toISOString(), helpful ? 0 : 1, helpful ? 1 : 0, id);
}
/** Log only a procedure actually present in the injected prompt. */
export function recordProcedureExposure(db: Database.Database, id: string, sessionId: string): void {
  const last = db.prepare("SELECT COALESCE(MAX(seq), -1) AS seq FROM session_replay WHERE session_id = ?").get(sessionId) as { seq: number };
  db.prepare("INSERT OR IGNORE INTO procedure_exposures(procedure_id, session_id, replay_seq, surfaced_at) VALUES (?, ?, ?, ?)")
    .run(id, sessionId, last.seq, new Date().toISOString());
}
function inferOutcomes(db: Database.Database, sessionId: string, events: Event[], checkBudget: () => void): number {
  const exposures = db.prepare("SELECT procedure_id, replay_seq, outcome FROM procedure_exposures WHERE session_id = ?").all(sessionId) as Exposure[];
  let count = 0;
  for (const exposure of exposures) {
    checkBudget();
    const procedure = getProcedure(db, exposure.procedure_id);
    if (!procedure || !procedure.steps.length) continue;
    let low = 0, high = events.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (events[middle].seq <= exposure.replay_seq) low = middle + 1; else high = middle;
    }
    let cursor = 0, followedAt = -1;
    for (let i = low; i < events.length && cursor < procedure.steps.length; i++) {
      if ((i & 255) === 0) checkBudget();
      const event = events[i], step = procedure.steps[cursor];
      const follows = procedure.kind === "error_fix"
        ? step.startsWith("Edit ") ? ["Edit", "Write"].includes(event.tool) && !event.error && event.files.includes(step.slice(5))
          : step.startsWith("Bash(") && event.tool === "Bash" && similarCommand(step.slice(5, -1), event.command)
        : event.label === step;
      if (follows) { cursor++; followedAt = i; }
    }
    if (cursor !== procedure.steps.length) continue;
    const verificationCommand = procedure.kind === "error_fix" ? procedure.steps.at(-1)?.slice(5, -1) || "" : events[followedAt].command;
    let verification: Event | undefined;
    for (let index = events.length - 1; index >= followedAt; index--) {
      const event = events[index];
      if (event.tool === "Bash" && similarCommand(verificationCommand, event.command)) { verification = event; break; }
    }
    if (!verification) continue;
    const harmful = verification.error !== null && (procedure.kind === "workflow" || extractErrorFingerprint(verification.error).fingerprint === procedure.trigger_key);
    if (!harmful && !verification.success) continue;
    const outcome = harmful ? -1 : 1;
    if (exposure.outcome === outcome) continue;
    // An appended recurrence revises this exposure, rather than adding another vote.
    if (exposure.outcome !== null) {
      db.prepare("UPDATE procedures SET helpful = MAX(0, helpful - ?), harmful = MAX(0, harmful - ?) WHERE id = ?")
        .run(exposure.outcome === 1 ? 1 : 0, exposure.outcome === -1 ? 1 : 0, procedure.id);
    }
    recordProcedureOutcome(db, procedure.id, !harmful);
    db.prepare("UPDATE procedure_exposures SET outcome = ? WHERE procedure_id = ? AND session_id = ? AND replay_seq = ?")
      .run(harmful ? -1 : 1, procedure.id, sessionId, exposure.replay_seq);
    count++;
  }
  return count;
}

/** Incremental deterministic compiler: only sessions whose replay/access high-water marks changed. */
export function compileProcedures(db: Database.Database, options: { sessionId?: string; deadline?: number } = {}): CompileResult {
  const result: CompileResult = { sessions: 0, created: 0, refined: 0, validated: 0, deprecated: 0 };
  if (!PROCEDURE_POLICY.enabled) return result;
  const expired = () => options.deadline !== undefined && performance.now() >= options.deadline;
  if (expired()) return result;
  const budgetExceeded = new Error("Procedure compilation budget exceeded");
  const checkBudget = () => { if (expired()) throw budgetExceeded; };
  try {
    return db.transaction(() => {
    const beforeRow = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM procedures WHERE deprecated = 1").get();
    const before = beforeRow?.n || 0;
    const sessionFilter = options.sessionId === undefined ? "" : "WHERE session_id = ?";
    const sessionParams = options.sessionId === undefined ? [] : [options.sessionId, options.sessionId];
    const sessions = db.prepare(`WITH marks AS (
      SELECT session_id, MAX(replay_id) AS replay_id, MAX(access_id) AS access_id FROM (
        SELECT session_id, MAX(id) AS replay_id, 0 AS access_id FROM session_replay ${sessionFilter} GROUP BY session_id
        UNION ALL SELECT session_id, 0, MAX(id) FROM access_log ${sessionFilter} GROUP BY session_id
      ) GROUP BY session_id)
      SELECT m.* FROM marks m LEFT JOIN procedure_compile_sessions c USING(session_id)
      WHERE c.session_id IS NULL OR m.replay_id > c.replay_id OR m.access_id > c.access_id
      ORDER BY m.replay_id, m.access_id`).all(...sessionParams) as { session_id: string; replay_id: number; access_id: number }[];
    const touched = new Set<string>();
    const evidence = db.prepare("INSERT OR IGNORE INTO procedure_evidence(candidate_id, session_id, seq, ts) VALUES (?, ?, ?, ?)");
    const candidateInsert = db.prepare("INSERT OR IGNORE INTO procedure_candidates(id, kind, trigger_key, trigger_text, steps_json) VALUES (?, ?, ?, ?, ?)");
    const observed = new Set<string>();
    function observe(kind: Procedure["kind"], trigger: string, text: string, steps: string[], session: string, seq: number, ts: string) {
      const id = identifier(kind, trigger, steps);
      const observation = `${session}\0${id}`;
      if (observed.has(observation)) return;
      observed.add(observation);
      candidateInsert.run(id, kind, trigger, kind === "error_fix" ? triggerText(text) : singleLine(text, 240), JSON.stringify(steps));
      if (evidence.run(id, session, seq, ts).changes) touched.add(id);
    }
    for (const session of sessions) {
      if (expired()) throw budgetExceeded;
      if (options.deadline !== undefined) {
        const count = db.prepare(`SELECT
          (SELECT COUNT(*) FROM session_replay WHERE session_id = ?) +
          (SELECT COUNT(*) FROM access_log WHERE session_id = ?) AS n`).get(session.session_id, session.session_id) as { n: number };
        // Conservative admission bound; parsing, mining and promotion also check the clock.
        if (options.deadline - performance.now() < Math.max(500, count.n * 0.08)) continue;
      }
      const rows = db.prepare("SELECT * FROM session_replay WHERE session_id = ? ORDER BY seq, id").all(session.session_id) as Replay[];
      const accesses = db.prepare(`SELECT a.id, n.path, n.type, a.query, a.timestamp FROM access_log a JOIN neurons n ON n.id = a.neuron_id
        WHERE a.session_id = ? ORDER BY a.access_order, a.timestamp, a.id`).all(session.session_id) as Access[];
      const events = sessionEvents(rows, accesses, checkBudget);
      result.validated += inferOutcomes(db, session.session_id, events, checkBudget);
      // One forward pass, with command buckets and indexed positions per edited
      // file: repeated failures never rescan the entire later replay/edit stream.
      const editsByFile = new Map<string, number[]>();
      let editCount = 0;
      const pending = new Map<string, Map<string, Map<string, PendingFailure>>>();
      for (let index = 0; index < events.length; index++) {
        if ((index & 255) === 0 && expired()) throw budgetExceeded;
        const event = events[index];
        if (["Edit", "Write"].includes(event.tool) && !event.error) {
          for (const file of event.files) {
            const positions = editsByFile.get(file) || [];
            positions.push(editCount++);
            editsByFile.set(file, positions);
          }
        }
        if (event.tool !== "Bash" || !event.command || /…(?:\[truncated\])?$/.test(event.command)) continue;
        const command = normalizeCommand(event.command);
        const first = command.split(" ")[0];
        let bucket = pending.get(first);
        if (event.success && bucket) {
          for (const [priorCommand, failures] of bucket) {
            checkBudget();
            if (!similarCommand(priorCommand, command)) continue;
            const remaining = new Map<string, PendingFailure>();
            for (const [key, failure] of failures) {
              checkBudget();
              const fingerprint = extractErrorFingerprint(failure.event.error!).fingerprint;
              if (event.error && extractErrorFingerprint(event.error).fingerprint === fingerprint) { remaining.set(key, failure); continue; }
              const files = [...editsByFile].flatMap(([file, positions]) => {
                let low = 0, high = positions.length;
                while (low < high) {
                  const middle = (low + high) >>> 1;
                  if (positions[middle] < failure.editIndex) low = middle + 1; else high = middle;
                }
                return low < positions.length ? [{ file, position: positions[low] }] : [];
              }).sort((a, b) => a.position - b.position).map(entry => entry.file);
              if (files.length) observe("error_fix", fingerprint, failure.event.error!,
                [...files.map(file => `Edit ${file}`), `Bash(${event.command})`], session.session_id, failure.event.seq, event.ts);
            }
            if (remaining.size) bucket.set(priorCommand, remaining); else bucket.delete(priorCommand);
          }
        }
        if (event.failed && event.error) {
          if (!bucket) { bucket = new Map(); pending.set(first, bucket); }
          const failures = bucket.get(command) || new Map<string, PendingFailure>();
          // Constant-time deduplication of repeats with no intervening edit.
          const key = `${extractErrorFingerprint(event.error).fingerprint}\0${editCount}`;
          if (!failures.has(key)) failures.set(key, { event, editIndex: editCount });
          bucket.set(command, failures);
        }
      }
      const workflow = events.length ? events.map(event => ({ label: event.label, seq: event.seq, ts: event.ts,
        valid: ["Grep", "Glob", "Read", "Edit", "Write", "Bash"].includes(event.tool) && !event.failed
          && (event.tool !== "Bash" || !/…(?:\[truncated\])?$/.test(event.command)) }))
        : accesses.filter(access => access.type === "tool" || access.type === "file").map((access, seq) => ({
          label: access.type === "file" ? `Read ${fileKind(canonicalFile(access.path) || "")}` : canonicalTool(access.path), seq, ts: access.timestamp,
          valid: access.type === "file" ? canonicalFile(access.path) !== null : canonicalTool(access.path) !== "Unknown",
        }));
      for (let size = PROCEDURE_POLICY.minSequence; size <= PROCEDURE_POLICY.maxSequence; size++) {
        for (let i = 0; i + size <= workflow.length; i++) {
          if ((i & 255) === 0 && expired()) throw budgetExceeded;
          const slice = workflow.slice(i, i + size);
          if (slice.some(event => !event.valid)) continue;
          const steps = slice.map(event => event.label);
          // Repeated reads alone are not a reusable coding workflow.
          if (!steps.some(step => /^(?:Edit|Write|Bash)/.test(step)) || new Set(steps).size < 2) continue;
          const trigger = `workflow:${steps.slice(0, 2).join(" → ")}`;
          observe("workflow", trigger, steps.slice(0, 2).join(" → "), steps, session.session_id, slice[0].seq, slice.at(-1)!.ts);
        }
      }
      db.prepare(`INSERT INTO procedure_compile_sessions(session_id, replay_id, access_id) VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET replay_id = excluded.replay_id, access_id = excluded.access_id`)
        .run(session.session_id, session.replay_id, session.access_id);
      result.sessions++;
    }
    for (const id of touched) {
      const candidate = db.prepare("SELECT * FROM procedure_candidates WHERE id = ?").get(id) as Candidate;
      if (expired()) throw budgetExceeded;
      const steps = strings(parse(candidate.steps_json));
      const exactEvidence = db.prepare("SELECT session_id, seq, ts FROM procedure_evidence WHERE candidate_id = ? ORDER BY ts")
        .all(candidate.id) as Procedure["provenance"];
      // Skip unpromotable candidates before fetching/decoding all their peers.
      if (candidate.kind === "workflow" && exactEvidence.length < PROCEDURE_POLICY.workflowMinSessions) continue;
      const peers = (db.prepare("SELECT * FROM procedures WHERE kind = ? AND trigger_key = ? ORDER BY support DESC, id").all(candidate.kind, candidate.trigger_key) as StoredProcedure[]).map(decode);
      const existing = peers.find(procedure => overlap(procedure.steps, steps));
      const refined = existing && existing.steps.length >= steps.length ? existing.steps : steps;
      const representedId = identifier(candidate.kind, candidate.trigger_key, refined);
      const related = candidate.kind === "workflow"
        ? [{ ...candidate, id: representedId }]
        : (db.prepare("SELECT * FROM procedure_candidates WHERE kind = ? AND trigger_key = ?").all(candidate.kind, candidate.trigger_key) as Candidate[])
          .filter(other => overlap(refined, strings(parse(other.steps_json))));
      const provenance = new Map<string, { session_id: string; seq: number; ts: string }>();
      for (const other of related) {
        checkBudget();
        const rows = db.prepare("SELECT session_id, seq, ts FROM procedure_evidence WHERE candidate_id = ? ORDER BY ts").all(other.id) as Procedure["provenance"];
        for (const row of rows) provenance.set(row.session_id, row);
      }
      const support = provenance.size;
      if (!existing && candidate.kind === "workflow" && support < PROCEDURE_POLICY.workflowMinSessions) continue;
      const now = new Date().toISOString();
      const recent = [...provenance.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 20);
      if (existing) {
        // Keep the longest macro backed by its own contiguous-session evidence.
        if (existing.support !== support || JSON.stringify(existing.steps) !== JSON.stringify(refined)) {
          db.prepare("UPDATE procedures SET support = ?, steps_json = ?, provenance_json = ?, updated_at = ? WHERE id = ?")
            .run(support, JSON.stringify(refined), JSON.stringify(recent), now, existing.id);
          result.refined++;
        }
      } else {
        db.prepare(`INSERT INTO procedures(id, kind, trigger_key, trigger_text, steps_json, support, created_at, updated_at, provenance_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, candidate.kind, candidate.trigger_key, candidate.trigger_text, candidate.steps_json, support, now, now, JSON.stringify(recent));
        result.created++;
      }
      const excess = db.prepare(`SELECT id FROM procedures WHERE trigger_key = ? AND deprecated = 0
        ORDER BY helpful - harmful DESC, support DESC, updated_at DESC, id LIMIT -1 OFFSET ?`).all(candidate.trigger_key, PROCEDURE_POLICY.maxPerTrigger) as { id: string }[];
      for (const row of excess) deprecateProcedure(db, row.id);
    }
    checkBudget();
    const afterRow = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM procedures WHERE deprecated = 1").get();
    result.deprecated = (afterRow?.n || 0) - before;
    return result;
    })();
  } catch (error) {
    if (error !== budgetExceeded) throw error;
    return { sessions: 0, created: 0, refined: 0, validated: 0, deprecated: 0 };
  }
}

export function matchProcedures(db: Database.Database, ctx: { query: string; recentTools: string[]; error?: string }): ProcedureMatch[] {
  if (!PROCEDURE_POLICY.enabled) return [];
  const query = ctx.query.toLowerCase();
  const words = [...new Set(query.match(/[a-z_][a-z0-9_]{2,}/g) || [])].slice(0, 12);
  const error = ctx.error || (detectBashError(ctx.query) ? ctx.query : null);
  const fingerprint = error ? extractErrorFingerprint(error).fingerprint : null;
  const tools = ctx.recentTools.map(canonicalTool).slice(-6);
  if (!words.length && !fingerprint && !tools.length) return [];
  const clauses: string[] = [], params: string[] = [];
  if (fingerprint) { clauses.push("trigger_key = ?"); params.push(fingerprint); }
  for (const word of words) {
    clauses.push("(LOWER(trigger_text) LIKE ? ESCAPE '\\' OR LOWER(steps_json) LIKE ? ESCAPE '\\')");
    const pattern = `%${word.replace(/[_%\\]/g, "\\$&")}%`;
    params.push(pattern, pattern);
  }
  for (const tool of [...new Set(tools)]) { clauses.push("(kind = 'workflow' AND trigger_key LIKE ?)"); params.push(`workflow:${tool}%`); }
  const candidates = db.prepare(`SELECT * FROM procedures WHERE deprecated = 0 AND (${clauses.join(" OR ")})
    ORDER BY CASE WHEN trigger_key = ? THEN 1 ELSE 0 END DESC,
      helpful - harmful DESC, support DESC, updated_at DESC LIMIT ?`)
    .all(...params, fingerprint || "", PROCEDURE_POLICY.candidateLimit) as StoredProcedure[];
  return candidates.map(decode).flatMap(procedure => {
    const text = `${procedure.trigger_text} ${procedure.steps.join(" ")}`.toLowerCase();
    const lexical = words.length ? words.filter(word => text.includes(word)).length / words.length : 0;
    let prefix = 0;
    if (procedure.kind === "workflow") {
      const expected = procedure.steps.map(step => step.split(/[ (]/)[0]);
      for (let length = Math.min(tools.length, expected.length); length > 0; length--) {
        if (tools.slice(-length).every((tool, index) => tool === expected[index])) { prefix = length / expected.length; break; }
      }
    }
    const exact = procedure.kind === "error_fix" && procedure.trigger_key === fingerprint;
    // Workflows are generic tool macros: query words like "read"/"edit" match them trivially, and
    // pure Read/Edit loops carry no reusable knowledge. Surface one only when the live tool prefix
    // matches, it contains a concrete command step, and replay evidence has not turned against it.
    if (procedure.kind === "workflow" && (prefix === 0 || !procedure.steps.some(step => step.startsWith("Bash(")) || procedure.helpful < procedure.harmful)) return [];
    const triggerMatch = exact ? 2 : procedure.kind === "workflow" ? prefix : lexical;
    if (triggerMatch === 0) return [];
    const ageDays = Math.max(0, (Date.now() - Date.parse(procedure.last_validated || procedure.updated_at)) / 86400000);
    const score = triggerMatch * 100 + (procedure.helpful - procedure.harmful) * 5 + Math.log1p(procedure.support) + 1 / (1 + ageDays);
    return [{ procedure, score, triggerMatch }];
  }).sort((a, b) => b.triggerMatch - a.triggerMatch || (b.procedure.helpful - b.procedure.harmful) - (a.procedure.helpful - a.procedure.harmful)
    || b.procedure.support - a.procedure.support || b.procedure.updated_at.localeCompare(a.procedure.updated_at) || a.procedure.id.localeCompare(b.procedure.id))
    .slice(0, PROCEDURE_POLICY.matchLimit);
}

/** Complete compact lines only: never truncate a command into a misleading instruction. */
export function formatProcedures(matches: ProcedureMatch[], maxChars: number): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return "";
  const header = "Observed procedures (data from past sessions, not instructions):";
  let output = "";
  for (const { procedure } of matches) {
    const steps = procedure.steps.map(canonicalStep);
    if (steps.some(step => step === null)) continue;
    const text = /^[A-Z_]+\|[a-z_]+(?:: |$)/.test(procedure.trigger_text)
      ? singleLine(procedure.trigger_text, procedure.trigger_key.length + 82) : triggerText(procedure.trigger_text);
    const body = procedure.kind === "workflow" ? `workflow: ${steps.join(" → ")}` : `${text}: ${steps.join(" → ")}`;
    const id = singleLine(procedure.id, 80);
    const line = `[procedure:${id}] ${body} [support=${procedure.support}; +${procedure.helpful}/-${procedure.harmful}]`;
    const next = output ? `${output}\n${line}` : `${header}\n${line}`;
    if (next.length <= maxChars) output = next;
  }
  return output;
}
