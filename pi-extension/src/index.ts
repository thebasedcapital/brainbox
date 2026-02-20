/**
 * BrainBox Pi Extension
 *
 * Integrates BrainBox Hebbian memory into Pi coding agent.
 * Provides passive learning from tool usage and active recall
 * to inject relevant context before agent turns.
 *
 * Features:
 *   1. Lifecycle hooks: record file accesses + tool usage on every tool_result
 *   2. Context injection: neural recall injected before_agent_start and on input
 *   3. LLM-callable tools: brainbox_recall, brainbox_error, brainbox_stats
 *   4. Persistent widget: live neuron/superhighway/confidence status
 *   5. /brainbox command: show full stats via notify
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { BrainBoxPi } from "../brainbox-engine.js";

// --- Module-level state ---

let engine: BrainBoxPi | null = null;
let lastRecallConfidence = 0;
let sessionId = `pi-${Date.now()}`;

// Path skip patterns — mirror BrainBox core filters
const SKIP_PATTERNS = [
  /node_modules\//,
  /\.git\//,
  /\.DS_Store/,
  /\.swp$/,
  /\.tmp$/,
  /~$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
];

function shouldSkip(path: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(path));
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || p.startsWith("~/");
}

function resolvePath(p: string): string {
  if (p.startsWith("~/")) {
    return (process.env.HOME || "/root") + p.slice(1);
  }
  return p;
}

/** Extract file paths from tool params (read/write/edit) */
function extractFileFromParams(params: Record<string, unknown>): string | null {
  const candidates = [
    params["file_path"],
    params["path"],
    params["notebook_path"],
    params["filename"],
  ];
  for (const c of candidates) {
    if (typeof c === "string" && isAbsolutePath(c)) {
      return resolvePath(c);
    }
  }
  return null;
}

/** Extract file paths from tool result text (grep/glob output) */
function extractPathsFromResult(result: string): string[] {
  const paths: string[] = [];
  const lines = result.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Match absolute path at start of line (grep format: /path/to/file:...)
    const match = trimmed.match(/^(\/[^\s:]+)/);
    if (match && match[1]) {
      const p = match[1];
      if (!paths.includes(p)) paths.push(p);
    }
    // Match bare absolute path (glob format: one path per line)
    if (isAbsolutePath(trimmed) && !paths.includes(trimmed)) {
      paths.push(trimmed);
    }
  }
  return paths.filter((p) => !shouldSkip(p)).slice(0, 10);
}

/** Update the BrainBox widget with current state */
function updateWidget(ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[0]): void {
  if (!engine) return;
  try {
    const stats = engine.stats();
    const confidencePct = Math.round(lastRecallConfidence * 100);
    const confidenceStr =
      lastRecallConfidence >= 0.7
        ? `${confidencePct}% HIGH`
        : lastRecallConfidence >= 0.4
        ? `${confidencePct}% MED`
        : lastRecallConfidence > 0
        ? `${confidencePct}% LOW`
        : "no recall yet";

    ctx.ui.setWidget("brainbox", [
      `BrainBox  neurons:${stats.neuron_count}  superhighways:${stats.superhighways}  recall:${confidenceStr}`,
    ]);
  } catch {
    // Widget update failed — non-fatal
  }
}

// --- Extension Entry Point ---

export default function (pi: ExtensionAPI) {
  // ── 1. Session lifecycle ────────────────────────────────────────────────────

  pi.on("session_start", async (ctx) => {
    try {
      engine = new BrainBoxPi();
      sessionId = `pi-${Date.now()}`;
      updateWidget(ctx);
    } catch (err) {
      // Engine failed to initialize — log and continue without BrainBox
      console.error("[brainbox] Failed to initialize engine:", err);
      engine = null;
    }
  });

  pi.on("session_shutdown", async (_ctx) => {
    try {
      engine?.close();
      engine = null;
    } catch {
      // Ignore shutdown errors
    }
  });

  // ── 2. Passive learning: record every tool result ───────────────────────────

  pi.on("tool_result", async (ctx) => {
    if (!engine) return;

    try {
      const toolName = (ctx as any).tool_name as string | undefined;
      const params = ((ctx as any).tool_params ?? {}) as Record<string, unknown>;
      const result = (ctx as any).tool_result;
      const resultText = typeof result === "string" ? result : JSON.stringify(result ?? "");

      if (!toolName) return;

      // Always record the tool itself (tool chain learning)
      engine.record(toolName, "tool", `tool:${toolName}`);

      const nameLower = toolName.toLowerCase();

      if (nameLower === "read" || nameLower === "write" || nameLower === "edit") {
        // Extract file path from params
        const filePath = extractFileFromParams(params);
        if (filePath && !shouldSkip(filePath)) {
          engine.record(filePath, "file", `${toolName.toLowerCase()}:${filePath}`);
        }
      } else if (nameLower === "bash") {
        // Record command as tool neuron; extract file paths from the command string
        const cmd = typeof params["command"] === "string" ? params["command"] : "";
        if (cmd) {
          engine.record(`bash:${cmd.slice(0, 60)}`, "tool", `bash:${cmd.slice(0, 80)}`);
          // Extract explicit file paths from command
          const fileMatches = cmd.match(/(?:^|\s)((?:\/|~\/)[^\s;|&><'"]+)/g);
          if (fileMatches) {
            for (const m of fileMatches) {
              const p = resolvePath(m.trim());
              if (isAbsolutePath(p) && !shouldSkip(p)) {
                engine.record(p, "file", `bash:${cmd.slice(0, 60)}`);
              }
            }
          }
        }
      } else if (nameLower === "grep" || nameLower === "glob") {
        // Extract file paths from result text
        const paths = extractPathsFromResult(resultText);
        const pattern =
          typeof params["pattern"] === "string"
            ? params["pattern"]
            : typeof params["query"] === "string"
            ? params["query"]
            : "";
        const context = pattern ? `${nameLower}:${pattern}` : nameLower;
        for (const p of paths) {
          engine.record(p, "file", context);
        }
      } else {
        // Generic tool: try extracting a file path from params
        const filePath = extractFileFromParams(params);
        if (filePath && !shouldSkip(filePath)) {
          engine.record(filePath, "file", toolName);
        }
      }

      // Detect errors in result text and record them
      if (resultText.length > 0) {
        const errorMatch = resultText.match(
          /(?:Error|Exception|FAILED|error\[E\d+\]):\s*(.{10,120})/
        );
        if (errorMatch && errorMatch[1]) {
          const normalized = errorMatch[1]
            .replace(/0x[0-9a-f]+/gi, "0x...")
            .replace(/\d{10,}/g, "...")
            .replace(/:\d+:\d+/g, ":N:N")
            .slice(0, 120);
          engine.record(normalized, "error", toolName);
        }
      }

      updateWidget(ctx);
    } catch {
      // Learning failed — never crash the extension
    }
  });

  // ── 3. Context injection: before_agent_start ────────────────────────────────

  pi.on("before_agent_start", async (ctx) => {
    if (!engine) return;

    try {
      // Build query from recent context/messages if available
      const messages = ((ctx as any).messages ?? []) as Array<{ role: string; content: string }>;
      const recentUserMsg = messages
        .filter((m) => m.role === "user")
        .slice(-3)
        .map((m) => m.content)
        .join(" ")
        .slice(0, 300);

      if (!recentUserMsg || recentUserMsg.trim().length < 5) return;

      const results = await engine.recall(recentUserMsg, 5);
      if (results.length === 0) return;

      const confidentResults = results.filter((r) => r.confidence >= 0.4);
      if (confidentResults.length === 0) return;

      // Track max confidence for widget
      lastRecallConfidence = Math.max(...confidentResults.map((r) => r.confidence));

      const lines = ["[BrainBox] Neural recall — files accessed in similar contexts:"];
      for (const r of confidentResults) {
        const pct = Math.round(r.confidence * 100);
        const myelin = Math.round(r.neuron.myelination * 100);
        const level = pct >= 70 ? "HIGH" : pct >= 40 ? "MED" : "LOW";
        lines.push(`  - ${r.neuron.path} (confidence: ${pct}%, myelin: ${myelin}%, ${level})`);
      }
      lines.push("These files were frequently accessed together in similar past contexts.");

      // Inject as a system context message (display:false so it's silent to the user)
      await pi.sendMessage(lines.join("\n"), { display: false });

      updateWidget(ctx);
    } catch {
      // Context injection failed — non-fatal
    }
  });

  // ── 4. Context injection: on user input ─────────────────────────────────────

  pi.on("input", async (ctx) => {
    if (!engine) return;

    try {
      const userInput = ((ctx as any).input as string | undefined) ?? "";
      if (!userInput || userInput.trim().length < 5) return;

      const results = await engine.recall(userInput, 5);
      if (results.length === 0) return;

      const confidentResults = results.filter((r) => r.confidence >= 0.4);
      if (confidentResults.length === 0) return;

      lastRecallConfidence = Math.max(...confidentResults.map((r) => r.confidence));

      const lines = ["[BrainBox] Neural recall for your query:"];
      for (const r of confidentResults) {
        const pct = Math.round(r.confidence * 100);
        const myelin = Math.round(r.neuron.myelination * 100);
        const level = pct >= 70 ? "HIGH — use directly" : pct >= 40 ? "MED — verify" : "LOW";
        lines.push(`  - ${r.neuron.path} (${pct}%, myelin: ${myelin}%, ${level})`);
      }

      await pi.sendMessage(lines.join("\n"), { display: false });

      updateWidget(ctx);
    } catch {
      // Input recall failed — non-fatal
    }
  });

  // ── 5. Registered LLM-callable tools ────────────────────────────────────────

  pi.registerTool({
    name: "brainbox_recall",
    description:
      "Neural recall: find relevant files/tools using Hebbian memory instead of searching. " +
      "Returns results with confidence scores. Use BEFORE grep/glob — if confidence is HIGH (70%+), " +
      "read those files directly and skip the search entirely.",
    parameters: Type.Object({
      query: Type.String({ description: "What are you looking for?" }),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 5)", default: 5 })),
    }),
    execute: async ({ query, limit = 5 }) => {
      if (!engine) return "BrainBox is not initialized.";
      try {
        const results = await engine.recall(query, limit);
        if (results.length === 0) {
          return `No neural pathways found for "${query}". Fall back to grep/search.`;
        }

        const confidentResults = results.filter((r) => r.confidence >= 0.4);
        if (confidentResults.length === 0) {
          return `No confident pathways found for "${query}" (threshold: 40%). Try a broader search.`;
        }

        lastRecallConfidence = Math.max(...confidentResults.map((r) => r.confidence));

        const lines = confidentResults.map((r) => {
          const pct = Math.round(r.confidence * 100);
          const myelin = Math.round(r.neuron.myelination * 100);
          const level =
            pct >= 70
              ? "HIGH — read directly, skip search"
              : pct >= 40
              ? "MEDIUM — verify with quick check"
              : "LOW — confirm with search";
          return `  ${r.neuron.path} (confidence: ${pct}%, myelin: ${myelin}%, ${level})`;
        });

        const totalSaved = confidentResults.reduce((s, r) => s + r.estimated_tokens_saved, 0);
        const tip =
          confidentResults[0].confidence >= 0.7
            ? "High confidence — read these files directly, no search needed!"
            : "Medium confidence — consider a targeted search to verify.";

        return [
          `Neural recall for "${query}":`,
          ...lines,
          `Estimated tokens saved: ${totalSaved}`,
          tip,
        ].join("\n");
      } catch (err) {
        return `BrainBox recall failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  pi.registerTool({
    name: "brainbox_error",
    description:
      "Record an error and get immediate suggestions for which files likely contain the fix. " +
      "BrainBox learns error→fix patterns over time — the debugging immune system. " +
      "Call this when you encounter any error before starting to investigate.",
    parameters: Type.Object({
      error: Type.String({ description: "The error message or stack trace" }),
      query: Type.Optional(
        Type.String({ description: "What were you trying to do when this error occurred?" })
      ),
    }),
    execute: async ({ error, query }) => {
      if (!engine) return "BrainBox is not initialized.";
      try {
        const result = await engine.recordError(error, query);

        if (result.potentialFixes.length === 0) {
          return [
            `Error recorded: ${result.errorNeuron.path}`,
            "No known fixes yet — this is a new error pattern.",
            "After fixing, the files you edit will be learned as the fix.",
          ].join("\n");
        }

        const fixes = result.potentialFixes.map((r) => {
          const pct = Math.round(r.confidence * 100);
          const level = pct >= 70 ? "HIGH" : pct >= 40 ? "MEDIUM" : "LOW";
          return `  ${r.neuron.path} (confidence: ${pct}%, ${level})`;
        });

        return [
          `Error: ${result.errorNeuron.path}`,
          "Potential fix files:",
          ...fixes,
          result.potentialFixes[0].confidence >= 0.7
            ? "Read the high-confidence file first — likely contains the fix."
            : "Check suggested files, then record your actual fix for future learning.",
        ].join("\n");
      } catch (err) {
        return `BrainBox error recording failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  pi.registerTool({
    name: "brainbox_stats",
    description:
      "Show BrainBox Hebbian network statistics: neuron count, synapses, superhighways, " +
      "and estimated token savings from neural recall.",
    parameters: Type.Object({}),
    execute: async () => {
      if (!engine) return "BrainBox is not initialized.";
      try {
        const stats = engine.stats();
        const lines = [
          `BrainBox Network Stats`,
          `  Neurons:       ${stats.neuron_count}`,
          `  Synapses:      ${stats.synapse_count}`,
          `  Superhighways: ${stats.superhighways} (myelination > 50%)`,
          `  Avg myelin:    ${((stats.avg_myelination || 0) * 100).toFixed(1)}%`,
        ];

        if (stats.token_savings !== undefined) {
          lines.push(`  Tokens saved:  ${stats.token_savings.toLocaleString()}`);
        }

        return lines.join("\n");
      } catch (err) {
        return `BrainBox stats failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  // ── 6. /brainbox command ─────────────────────────────────────────────────────

  pi.registerCommand({
    name: "brainbox",
    description: "Show BrainBox Hebbian memory statistics",
    execute: async (ctx) => {
      if (!engine) {
        ctx.ui.notify("BrainBox is not initialized.");
        return;
      }
      try {
        const stats = engine.stats();
        const confidencePct = Math.round(lastRecallConfidence * 100);
        const msg = [
          `BrainBox Hebbian Memory`,
          `Neurons:       ${stats.neuron_count}`,
          `Synapses:      ${stats.synapse_count}`,
          `Superhighways: ${stats.superhighways}`,
          `Avg myelin:    ${((stats.avg_myelination || 0) * 100).toFixed(1)}%`,
          `Last recall:   ${confidencePct > 0 ? `${confidencePct}%` : "none yet"}`,
          `Session:       ${sessionId}`,
        ].join("\n");
        ctx.ui.notify(msg);
      } catch (err) {
        ctx.ui.notify(`BrainBox error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}
