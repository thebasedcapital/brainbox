/**
 * BrainBox Pi Extension — Widget & Tool Renderer
 *
 * Provides:
 *   - renderWidget()       — persistent status bar lines for Pi's widget system
 *   - renderRecallCall()   — tool call display for brainbox_recall
 *   - renderRecallResult() — tool result display for brainbox_recall
 *   - renderErrorCall()    — tool call display for brainbox_error
 *   - renderErrorResult()  — tool result display for brainbox_error
 *   - renderStatsResult()  — tool result display for brainbox_stats
 */

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export interface WidgetState {
  neurons: number;
  superhighways: number;
  lastRecallPath?: string;
  lastRecallConfidence?: number;
  lastRecallTime?: number; // Date.now()
}

/** How long (ms) the "last recall" spotlight line is shown before reverting. */
const RECALL_SPOTLIGHT_MS = 10_000;

/**
 * Returns lines for ctx.ui.setWidget("brainbox", lines).
 * Returns [] (auto-hide) when there are no neurons yet.
 */
export function renderWidget(state: WidgetState): string[] {
  if (state.neurons === 0) {
    return [];
  }

  // Show the spotlight line if a recall happened within the last 10 seconds.
  const showSpotlight =
    state.lastRecallPath !== undefined &&
    state.lastRecallConfidence !== undefined &&
    state.lastRecallTime !== undefined &&
    Date.now() - state.lastRecallTime < RECALL_SPOTLIGHT_MS;

  if (showSpotlight) {
    const pct = Math.round((state.lastRecallConfidence ?? 0) * 100);
    const level = confidenceLevel(state.lastRecallConfidence ?? 0);
    return [
      `\u{1F9E0} BrainBox: \u2192 ${state.lastRecallPath} (${pct}% ${level}) | ${state.neurons} neurons`,
    ];
  }

  // Summary line
  const hwLabel = state.superhighways === 1 ? "superhighway" : "superhighways";
  const recallSuffix =
    state.lastRecallConfidence !== undefined
      ? ` | last recall: ${Math.round(state.lastRecallConfidence * 100)}% confidence`
      : "";

  return [
    `\u{1F9E0} BrainBox: ${state.neurons} neurons | ${state.superhighways} ${hwLabel}${recallSuffix}`,
  ];
}

// ---------------------------------------------------------------------------
// Tool renderers — brainbox_recall
// ---------------------------------------------------------------------------

export function renderRecallCall(input: { query: string }): string {
  return `\u{1F50D} Neural recall: "${input.query}"`;
}

export function renderRecallResult(result: any): string {
  // Result may be a raw JSON string (MCP text content) or a parsed object.
  const data = parseResult(result);

  if (!data || data.status === "no_recall") {
    return `\u{1F4E1} No neural pathways found. Falling back to search.`;
  }

  const results: any[] = data.results ?? [];
  const totalSaved: number = data.estimated_tokens_saved ?? 0;

  if (results.length === 0) {
    return `\u{1F4E1} No neural pathways found.`;
  }

  const header = `\u{1F4E1} Recall (${results.length} result${results.length !== 1 ? "s" : ""}${totalSaved > 0 ? `, ${totalSaved.toLocaleString()} tokens saved` : ""}):`;

  const rows = results.map((r: any) => {
    const path = String(r.path ?? r.neuron?.path ?? "?");
    const rawConf = parseConfidence(r.confidence ?? r.neuron?.confidence);
    const pct = Math.round(rawConf * 100);
    const level = confidenceLevel(rawConf);
    const myelinStr = formatMyelin(r.myelination ?? r.neuron?.myelination);
    return `  \u2192 ${padRight(path, 28)} ${padLeft(`${pct}%`, 3)} ${padRight(level, 6)}  myelin: ${myelinStr}`;
  });

  return [header, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Tool renderers — brainbox_error
// ---------------------------------------------------------------------------

export function renderErrorCall(input: { error: string }): string {
  // Truncate long error messages for the display line.
  const msg = input.error.length > 60 ? input.error.slice(0, 57) + "..." : input.error;
  return `\u26A1 Error lookup: "${msg}"`;
}

export function renderErrorResult(result: any): string {
  const data = parseResult(result);

  if (!data) {
    return `\u26A1 Error pattern recorded.`;
  }

  // No fixes found yet.
  if (data.status === "error_recorded" || !data.fix_suggestions || data.fix_suggestions.length === 0) {
    return `\u26A1 New error pattern recorded. No known fixes yet.`;
  }

  const sig = data.error_signature ?? "?";
  // Use just the first segment of the signature for the header (can be long).
  const shortSig = sig.length > 40 ? sig.slice(0, 37) + "..." : sig;

  const header = `\u{1F527} Fix suggestions for ${shortSig}:`;

  const rows = (data.fix_suggestions as any[]).map((fix: any) => {
    const path = String(fix.file ?? fix.path ?? "?");
    const rawConf = parseConfidence(fix.confidence);
    const pct = Math.round(rawConf * 100);
    const level = confidenceLevel(rawConf);
    return `  \u2192 ${padRight(path, 28)} ${padLeft(`${pct}%`, 3)} ${level}`;
  });

  return [header, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Tool renderers — brainbox_stats
// ---------------------------------------------------------------------------

export function renderStatsResult(result: any): string {
  const data = parseResult(result);

  if (!data) {
    return `\u{1F9E0} BrainBox: no stats available.`;
  }

  const net = data.network ?? {};
  const neurons: number = net.neurons ?? 0;
  const synapses: number = net.synapses ?? 0;
  const superhighways: number = net.superhighways ?? 0;
  const avgMyelin: string = net.avg_myelination ?? "0%";

  // Neuron breakdown if available (kilo-plugin returns flat counts; mcp returns network block)
  const fileCount: number = data.file_count ?? 0;
  const toolCount: number = data.tool_count ?? 0;
  const errorCount: number = data.error_count ?? 0;

  const neuronDetail =
    fileCount || toolCount || errorCount
      ? ` (${fileCount} file, ${toolCount} tool, ${errorCount} error)`
      : "";

  const lines = [
    `\u{1F9E0} BrainBox Network:`,
    `  Neurons:       ${neurons.toLocaleString()}${neuronDetail}`,
    `  Synapses:      ${synapses.toLocaleString()}`,
    `  Superhighways: ${superhighways}`,
    `  Avg myelin:    ${avgMyelin}`,
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a result value that may be:
 *   - Already a plain object (Pi passes parsed tool results)
 *   - A JSON string (MCP text content block)
 *   - An MCP content array: [{type:"text", text:"..."}]
 */
function parseResult(result: any): any {
  if (!result) return null;

  // MCP content array
  if (Array.isArray(result) && result[0]?.type === "text") {
    try {
      return JSON.parse(result[0].text);
    } catch {
      return null;
    }
  }

  // Raw JSON string
  if (typeof result === "string") {
    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  }

  // Already an object
  if (typeof result === "object") {
    return result;
  }

  return null;
}

/**
 * Normalise a confidence value that may arrive as:
 *   - A number 0–1 (e.g. 0.92)
 *   - A percentage string (e.g. "92%")
 *   - A number 0–100 (unlikely but guard against it)
 */
function parseConfidence(raw: any): number {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === "string") {
    const n = parseFloat(raw.replace("%", ""));
    return isNaN(n) ? 0 : n > 1 ? n / 100 : n;
  }
  if (typeof raw === "number") {
    return raw > 1 ? raw / 100 : raw;
  }
  return 0;
}

/** Format a myelination value (same polymorphism as confidence). */
function formatMyelin(raw: any): string {
  if (raw === undefined || raw === null) return "?";
  const n = parseConfidence(raw);
  return `${Math.round(n * 100)}%`;
}

function confidenceLevel(confidence: number): string {
  if (confidence >= 0.7) return "HIGH";
  if (confidence >= 0.4) return "MEDIUM";
  return "LOW";
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}
