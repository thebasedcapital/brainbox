import { posix } from "node:path";

export interface TrajectoryEvent {
  kind: "read" | "edit" | "search" | "tool" | "error";
  path?: string;
  tool: string;
  query?: string;
  ts_index: number;
}
export interface Trajectory {
  id: string;
  repo: string;
  task_text: string;
  created_order: number;
  events: TrajectoryEvent[];
  edited_files: string[];
  instance_id?: string;
  outcome?: Record<string, unknown>;
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function argumentsObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return object(value);
  try { return object(JSON.parse(value)); } catch { return {}; }
}
export function normalizePath(raw: string, repo: string, cwd = ""): string | undefined {
  let path = raw.trim().replace(/^['"]|['"]$/g, "").replace(/:(?:raw|img|conflicts|[\d,+-]+)(?::raw)?$/, "");
  if (!path || /[\n*?<>|]/.test(path) || /^[a-z]+:\/\//i.test(path) || path.startsWith("~")) return undefined;
  const roots = [cwd, "/workspace/" + repo, "/workspace/" + repo.split("/").at(-1), "/workspace", "/testbed", "/repo"].filter(Boolean);
  for (const root of roots) if (path.startsWith(root + "/")) { path = path.slice(root.length + 1); break; }
  if (path.startsWith("/")) return undefined;
  path = posix.normalize(path.replace(/^\.\//, ""));
  return path === "." || path === ".." || path.startsWith("../") ? undefined : path;
}

/** Extract explicit operands only; directories/globs and shell output are not fabricated file accesses. */
export function parseToolCall(name: string, rawArgs: unknown, repo: string, cwd = ""): TrajectoryEvent[] {
  const args = argumentsObject(rawArgs);
  name = name.replace(/^(?:functions|multi_tool_use)\./, "");
  const events: TrajectoryEvent[] = [{ kind: "tool", tool: name, ts_index: 0 }];
  if (name === "parallel" && Array.isArray(args.tool_uses)) {
    for (const value of args.tool_uses) {
      const call = object(value);
      events.push(...parseToolCall(text(call.recipient_name), call.parameters, repo, cwd));
    }
    return events;
  }
  const add = (kind: TrajectoryEvent["kind"], raw: string, query?: string) => {
    const commandCwd = text(args.cwd);
    const operand = cwd && commandCwd.startsWith(cwd + "/") && !raw.startsWith("/") ? posix.join(commandCwd, raw) : raw;
    const path = normalizePath(operand, repo, cwd);
    if (path) events.push({ kind, path, tool: name, query: query?.slice(0, 500), ts_index: 0 });
  };
  const path = text(args.path) || text(args.file_path) || text(args.filename);
  const command = text(args.command);
  if (/str_replace_editor|file_editor/.test(name)) {
    if (path) add(command === "view" ? "read" : /create|str_replace|insert|undo_edit/.test(command) ? "edit" : "read", path);
  } else if (/^(read|Read|read_file)$/.test(name)) {
    if (path) add("read", path);
  } else if (/edit|write|apply_patch/i.test(name) && !/bash/.test(name)) {
    if (path) add("edit", path);
    const patch = text(args.patch) || text(args.input) || text(args.__arg1) || (typeof rawArgs === "string" ? rawArgs : "");
    for (const match of patch.matchAll(/^(?:\*\*\* (?:Update|Add|Delete) File: |\+\+\+ b\/)([^\n]+)$|^\[([^\n#\]]+)#[0-9A-F]{4}\]$/gm)) add("edit", match[1] || match[2]);
  } else if (/grep|search|glob|find/i.test(name) && !/bash/.test(name)) {
    events.push({ kind: "search", tool: name, query: (text(args.pattern) || text(args.query)).slice(0, 500), ts_index: 0 });
    if (path && /\.[\w]+$/.test(path)) add("read", path, text(args.pattern) || text(args.query));
  } else if (/bash|shell|exec/i.test(name)) {
    const shell = command || text(args.cmd) || text(args.script);
    // Each command is parsed independently so paths in one grep do not leak into another cat.
    for (const segment of shell.split(/&&|\|\||[;\n|]/)) {
      const words = segment.match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g) ?? [];
      const opIndex = words.findIndex(w => /^(?:cat|sed|grep|rg|find|head|tail|touch|tee)$/.test(w));
      if (opIndex < 0) continue;
      const op = words[opIndex];
      const operands = words.slice(opIndex + 1);
      const isSearch = /^(grep|rg|find)$/.test(op);
      const pattern = isSearch ? operands.find(w => !w.startsWith("-"))?.replace(/^['"]|['"]$/g, "") : undefined;
      if (isSearch) events.push({ kind: "search", tool: name, query: pattern, ts_index: 0 });
      for (const word of operands) {
        const clean = word.replace(/^['"]|['"]$/g, "");
        if (clean.startsWith("-") || clean === pattern || !/\.[a-zA-Z0-9_]+(?::\d+)?$/.test(clean)) continue;
        add(/^(touch|tee)$/.test(op) || (op === "sed" && operands.some(w => /^-.*i/.test(w))) ? "edit" : "read", clean, pattern);
      }
    }
    for (const match of shell.matchAll(/(?:\*\*\* (?:Update|Add|Delete) File: |(?:>|>>)\s*)([^\s'";]+)/g)) add("edit", match[1]);
  }
  return events;
}

export function parseOpenHands(rowValue: unknown): Trajectory {
  const row = object(rowValue);
  const repo = text(row.repo);
  const messages = Array.isArray(row.trajectory) ? row.trajectory : [];
  const events: TrajectoryEvent[] = [];
  let task = "";
  for (const value of messages) {
    const message = object(value);
    if (message.role === "user" && !task) task = text(message.content).slice(0, 500);
    if (Array.isArray(message.tool_calls)) for (const call of message.tool_calls) {
      const fn = object(object(call).function);
      events.push(...parseToolCall(text(fn.name), fn.arguments, repo));
    }
    if (message.role === "tool" && /Traceback|\bError:|FAILED|exception/i.test(text(message.content))) {
      events.push({ kind: "error", tool: text(message.name) || "tool", query: text(message.content).slice(-1000), ts_index: 0 });
    }
  }
  const instance = text(row.instance_id);
  const outcome: Record<string, unknown> = {};
  for (const key of Object.keys(row)) if (/resolved|reward|exit_status|gen_tests|pred_passes/.test(key)) outcome[key] = row[key];
  return { id: text(row.trajectory_id), repo, task_text: task, created_order: Number(instance.match(/-(\d+)$/)?.[1] ?? 0), instance_id: instance,
    events: events.map((event, ts_index) => ({ ...event, ts_index })), edited_files: [...new Set(events.filter(e => e.kind === "edit" && e.path).map(e => e.path!))].sort(), outcome };
}

export function parseOmp(lines: unknown[], fallbackId: string): Trajectory {
  let cwd = ""; let id = fallbackId; let timestamp = 0; let task = "";
  const events: TrajectoryEvent[] = [];
  for (const value of lines) {
    const line = object(value);
    if (line.type === "session") { cwd = text(line.cwd); id = text(line.id) || id; timestamp = Date.parse(text(line.timestamp)) || 0; }
    const message = object(line.message);
    if (!Array.isArray(message.content)) continue;
    for (const value of message.content) {
      const item = object(value);
      if (message.role === "user" && item.type === "text" && !task) task = text(item.text).slice(0, 500);
      if (message.role === "assistant" && /toolCall|tool_call/.test(text(item.type))) events.push(...parseToolCall(text(item.name), item.arguments, cwd, cwd));
      if (message.role === "toolResult" && (message.isError === true || /Traceback|\bError:|FAILED/.test(text(item.text)))) {
        events.push({ kind: "error", tool: text(message.toolName), query: text(item.text).slice(-1000), ts_index: 0 });
      }
    }
  }
  return { id, repo: cwd || "unknown-project", task_text: task, created_order: timestamp,
    events: events.map((event, ts_index) => ({ ...event, ts_index })), edited_files: [...new Set(events.filter(e => e.kind === "edit" && e.path).map(e => e.path!))].sort() };
}
