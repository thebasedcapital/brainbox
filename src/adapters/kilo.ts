/**
 * BrainBox Kilo Adapter
 *
 * Translates Kilo ACP JSON events into BrainBox AccessEvents.
 * Kilo has no native hook system, so this adapter is called from
 * happy-cli's runKilo.ts when intercepting the JSON event stream.
 *
 * Kilo event format:
 * {
 *   type: "tool_use",
 *   part: {
 *     tool: "Read",
 *     callID: "...",
 *     state: {
 *       input: { file_path: "/path/to/file" },
 *       output: "file contents...",
 *       status: "completed"
 *     }
 *   }
 * }
 */

import type { DomainAdapter, AccessEvent } from "../adapter.js";
import { shouldSkipPath, isAbsolutePath, performRecall, detectBashError } from "../adapter.js";

// --- Types ---

export interface KiloToolEvent {
  type: string;
  part?: {
    tool?: string;
    callID?: string;
    id?: string;
    state?: {
      input?: Record<string, unknown>;
      output?: unknown;
      status?: string;
    };
  };
}

// --- Adapter ---

export class KiloAdapter implements DomainAdapter {
  readonly name = "kilo";

  /**
   * Extract AccessEvents from a Kilo ACP event.
   * Only processes completed tool_use events.
   */
  extractEvents(rawEvent: unknown): AccessEvent[] {
    const event = rawEvent as KiloToolEvent;
    if (!event?.type || event.type !== "tool_use") return [];
    if (!event.part?.state || event.part.state.status !== "completed") return [];

    const toolName = event.part.tool || "unknown";
    const input = event.part.state.input || {};
    const output = event.part.state.output;
    const context = buildKiloContext(toolName, input);
    const events: AccessEvent[] = [];

    // Record the tool itself
    events.push({
      type: "tool",
      path: toolName,
      context,
    });

    // Extract file paths from tool input/output
    const paths = extractKiloPaths(toolName, input, output);
    for (const filePath of paths) {
      events.push({
        type: "file",
        path: filePath,
        context,
      });
    }

    // Detect errors in Bash/shell output
    const bashTools = ["Bash", "bash", "shell"];
    if (bashTools.includes(toolName)) {
      const output = typeof event.part?.state?.output === "string" ? event.part.state.output : "";
      const error = detectBashError(output);
      if (error) {
        events.push({ type: "error", path: error, context });
      }
    }

    return events;
  }

  /**
   * Enrich a prompt with neural recall results.
   * Returns formatted string or null if no confident results.
   */
  async enrichPrompt(prompt: string, cwd?: string): Promise<string | null> {
    if (prompt.length < 15) return null;
    return performRecall(prompt, { cwd });
  }
}

// --- Path Extraction ---

function extractKiloPaths(
  toolName: string,
  input: Record<string, unknown>,
  output: unknown
): string[] {
  const paths: string[] = [];

  // Kilo uses same tool names as Claude Code (it's a fork)
  switch (toolName) {
    case "Read":
    case "read_file":
    case "Edit":
    case "Write":
    case "write_file":
    case "NotebookEdit": {
      const fp = (input.file_path || input.path || input.notebook_path) as
        | string
        | undefined;
      if (fp && isAbsolutePath(fp)) paths.push(fp);
      break;
    }

    case "Grep":
    case "search": {
      // Extract file paths from grep results
      if (typeof output === "string") {
        const lines = output.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const match = trimmed.match(/^(\/[^\s:]+)/);
          if (match && match[1] && !paths.includes(match[1])) {
            paths.push(match[1]);
          }
        }
      }
      break;
    }

    case "Glob":
    case "list_files": {
      if (typeof output === "string") {
        const lines = output.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && isAbsolutePath(trimmed) && !paths.includes(trimmed)) {
            paths.push(trimmed);
          }
        }
      }
      break;
    }

    case "Bash":
    case "bash":
    case "shell": {
      const cmd = (input.command || input.cmd) as string | undefined;
      if (cmd) {
        const fileMatch = cmd.match(/(?:^|\s)(\/[^\s;|&>]+)/g);
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

  return paths.filter((p) => !shouldSkipPath(p)).slice(0, 10);
}

// --- Context Building ---

function buildKiloContext(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case "Grep":
    case "search": {
      const pattern = (input.pattern || input.query) as string | undefined;
      return pattern ? `grep:${pattern}` : "Grep";
    }
    case "Glob":
    case "list_files": {
      const pattern = (input.pattern || input.glob) as string | undefined;
      return pattern ? `glob:${pattern}` : "Glob";
    }
    case "Edit": {
      const old = (input.old_string || input.old_text) as string | undefined;
      if (old) return `edit:${old.slice(0, 60).replace(/\n/g, " ")}`;
      return "Edit";
    }
    case "Bash":
    case "bash":
    case "shell": {
      const cmd = (input.command || input.cmd) as string | undefined;
      return cmd ? `bash:${cmd.slice(0, 80)}` : "Bash";
    }
    default:
      return toolName;
  }
}
