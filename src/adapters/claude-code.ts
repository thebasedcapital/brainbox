/**
 * BrainBox Claude Code Adapter
 *
 * Translates Claude Code PostToolUse events into BrainBox AccessEvents.
 * Extracts file paths from Read/Edit/Write/Grep/Glob/NotebookEdit tool results,
 * and builds rich context strings (grep patterns, edit snippets, etc.).
 *
 * Also provides prompt enrichment via neural recall for UserPromptSubmit hooks.
 */

import type { DomainAdapter, AccessEvent } from "../adapter.js";
import { shouldSkipPath, isAbsolutePath, resolvePath, performRecall, detectBashError } from "../adapter.js";

// --- Types ---

export interface ClaudeCodeToolEvent {
  session_id?: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_result?: unknown;
}

// --- Adapter ---

export class ClaudeCodeAdapter implements DomainAdapter {
  readonly name = "claude-code";

  /**
   * Extract AccessEvents from a Claude Code PostToolUse event.
   * Returns tool neuron + file neurons for each file path found.
   */
  extractEvents(rawEvent: unknown): AccessEvent[] {
    const event = rawEvent as ClaudeCodeToolEvent;
    if (!event?.tool_name) return [];

    const context = buildContext(event);
    const events: AccessEvent[] = [];

    // Record the tool itself
    events.push({
      type: "tool",
      path: event.tool_name,
      context,
    });

    // Extract and record file paths
    const paths = extractPaths(event);
    for (const filePath of paths) {
      events.push({
        type: "file",
        path: filePath,
        context,
      });
    }

    // Detect errors from ANY tool (Bash, MCP, etc.)
    const result = typeof event.tool_result === "string" ? event.tool_result : "";
    if (result) {
      const error = detectBashError(result);
      if (error) {
        events.push({
          type: "error",
          path: error,
          context,
        });
      }
    }

    return events;
  }

  /**
   * Enrich a prompt with neural recall results.
   * Returns formatted string or null if no confident results.
   */
  async enrichPrompt(prompt: string, cwd?: string): Promise<string | null> {
    if (prompt.length < 5) return null;
    return performRecall(prompt, { cwd });
  }
}

// --- Path Extraction ---

function extractPaths(input: ClaudeCodeToolEvent): string[] {
  const { tool_name, tool_input, tool_result } = input;
  const paths: string[] = [];

  switch (tool_name) {
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit": {
      const fp = (tool_input.file_path || tool_input.notebook_path) as
        | string
        | undefined;
      if (fp && isAbsolutePath(fp)) paths.push(fp);
      break;
    }

    case "Grep": {
      if (typeof tool_result === "string") {
        const lines = tool_result.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const match = trimmed.match(/^(\/[^\s:]+)/);
          if (match && match[1]) {
            const p = match[1];
            if (!paths.includes(p)) paths.push(p);
          }
        }
      }
      break;
    }

    case "Glob": {
      if (typeof tool_result === "string") {
        const lines = tool_result.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && isAbsolutePath(trimmed)) {
            if (!paths.includes(trimmed)) paths.push(trimmed);
          }
        }
      }
      break;
    }

    case "Bash": {
      // Extract file paths mentioned in bash command (absolute and ~/ paths)
      const cmd = tool_input.command as string | undefined;
      if (cmd) {
        const fileMatch = cmd.match(/(?:^|\s)((?:\/|~\/)[^\s;|&>]+)/g);
        if (fileMatch) {
          for (const m of fileMatch) {
            const p = m.trim();
            if (isAbsolutePath(p) && !paths.includes(p)) paths.push(p);
          }
        }
      }
      break;
    }
  }

  // Resolve ~/paths to absolute, then filter and cap
  return paths.map(resolvePath).filter((p) => !shouldSkipPath(p)).slice(0, 10);
}

// --- Context Building ---

/** Build a meaningful context string from the tool input */
function buildContext(input: ClaudeCodeToolEvent): string {
  const { tool_name, tool_input } = input;

  switch (tool_name) {
    case "Grep": {
      const pattern = tool_input.pattern as string | undefined;
      return pattern ? `grep:${pattern}` : "Grep";
    }
    case "Glob": {
      const pattern = tool_input.pattern as string | undefined;
      return pattern ? `glob:${pattern}` : "Glob";
    }
    case "Edit": {
      const old = tool_input.old_string as string | undefined;
      if (old) return `edit:${old.slice(0, 60).replace(/\n/g, " ")}`;
      return "Edit";
    }
    case "Bash": {
      const cmd = tool_input.command as string | undefined;
      return cmd ? `bash:${cmd.slice(0, 80)}` : "Bash";
    }
    default:
      return tool_name;
  }
}
