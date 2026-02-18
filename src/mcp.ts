#!/usr/bin/env node
/**
 * BrainBox MCP Server
 *
 * Exposes Hebbian memory as MCP tools for Claude Code:
 *   - brainbox_record:  Record a file/tool access (learning event)
 *   - brainbox_recall:  Neural recall with spreading activation
 *   - brainbox_stats:   Network statistics and token savings
 *   - brainbox_decay:   Run decay cycle
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "./db.js";
import { HebbianEngine } from "./hebbian.js";

const db = openDb();
const engine = new HebbianEngine(db, `mcp-${Date.now()}`);

const server = new McpServer({
  name: "brainbox",
  version: "0.1.0",
});

// --- Tool: Record an access ---
server.tool(
  "brainbox_record",
  "Record a file/tool access. Strengthens neural pathways through Hebbian learning. Call this every time you read or edit a file.",
  {
    path: z.string().describe("File path, tool name, or error signature"),
    type: z
      .enum(["file", "tool", "error", "semantic"])
      .default("file")
      .describe("Neuron type"),
    query: z
      .string()
      .optional()
      .describe("What were you looking for? (context for learning)"),
  },
  async ({ path, type, query }) => {
    const neuron = engine.record(path, type, query);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              recorded: path,
              myelination: `${(neuron.myelination * 100).toFixed(0)}%`,
              access_count: neuron.access_count,
              message:
                neuron.myelination > 0.5
                  ? `Superhighway! ${path} is deeply myelinated.`
                  : neuron.access_count === 1
                  ? `New neuron created for ${path}.`
                  : `Pathway strengthened. Myelination: ${(neuron.myelination * 100).toFixed(0)}%`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: Neural recall ---
server.tool(
  "brainbox_recall",
  "Neural recall: find relevant files/tools using Hebbian memory instead of grep. Returns results with confidence scores. Use BEFORE searching — if confidence is high, skip the search entirely to save tokens.",
  {
    query: z.string().describe("What are you looking for?"),
    token_budget: z
      .number()
      .default(10000)
      .describe("Max tokens to spend on recalled files"),
    limit: z.number().default(5).describe("Max results"),
    type: z
      .enum(["file", "tool", "error", "semantic"])
      .optional()
      .describe("Filter by neuron type"),
  },
  async ({ query, token_budget, limit, type }) => {
    const results = await engine.recall({ query, token_budget, limit, type });

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "no_recall",
                message:
                  "No neural pathways found for this query. Fall back to grep/search.",
                query,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const totalSaved = results.reduce(
      (s, r) => s + r.estimated_tokens_saved,
      0
    );

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              status: "recalled",
              results: results.map((r) => ({
                path: r.neuron.path,
                type: r.neuron.type,
                confidence: `${(r.confidence * 100).toFixed(0)}%`,
                confidence_level:
                  r.confidence >= 0.7
                    ? "HIGH — skip search, use directly"
                    : r.confidence >= 0.4
                    ? "MEDIUM — verify with quick check"
                    : "LOW — confirm with search",
                activation_path: r.activation_path,
                myelination: `${(r.neuron.myelination * 100).toFixed(0)}%`,
              })),
              estimated_tokens_saved: totalSaved,
              tip:
                results[0].confidence >= 0.7
                  ? "High confidence — read these files directly, no search needed!"
                  : "Medium confidence — consider a targeted search to verify.",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: Stats ---
server.tool(
  "brainbox_stats",
  "Show BrainBox network statistics: neurons, synapses, superhighways, and token savings.",
  {},
  async () => {
    const s = engine.stats();
    const t = engine.tokenReport();
    const highways = engine.getSuperhighways(0.5);
    const emb = engine.embeddingCoverage();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              network: {
                neurons: s.neuron_count,
                synapses: s.synapse_count,
                superhighways: s.superhighways,
                avg_myelination: `${((s.avg_myelination || 0) * 100).toFixed(1)}%`,
              },
              embeddings: {
                embedded: emb.embedded,
                total: emb.total,
                coverage: `${emb.pct.toFixed(0)}%`,
              },
              token_savings: {
                without_brainbox: t.tokens_used,
                with_brainbox: t.tokens_with_brainbox,
                saved: t.tokens_saved,
                savings_pct: `${t.savings_pct.toFixed(1)}%`,
              },
              top_superhighways: highways.slice(0, 5).map((h) => ({
                path: h.path,
                myelination: `${(h.myelination * 100).toFixed(0)}%`,
                accesses: h.access_count,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: Decay ---
server.tool(
  "brainbox_decay",
  "Run a decay cycle: weaken unused neural connections and prune dead synapses. Run periodically (e.g., daily).",
  {},
  async () => {
    const result = engine.decay();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              message: "Decay cycle complete",
              pruned_synapses: result.pruned_synapses,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: Error recording with fix suggestions ---
server.tool(
  "brainbox_error",
  "Record an error and get immediate suggestions for which files likely contain the fix. BrainBox learns error→fix patterns over time — the debugging immune system.",
  {
    error: z.string().describe("The error message or stack trace"),
    query: z
      .string()
      .optional()
      .describe("What were you trying to do when this error occurred?"),
  },
  async ({ error, query }) => {
    const { errorNeuron, potentialFixes } = await engine.recordError(error, query);

    if (potentialFixes.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "error_recorded",
                message:
                  "Error recorded. No known fixes yet — this is a new error pattern.",
                error_signature: errorNeuron.path,
                tip: "After fixing this error, record the files you edited. BrainBox will learn the pattern.",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              status: "potential_fixes_found",
              error_signature: errorNeuron.path,
              fix_suggestions: potentialFixes.map((r) => ({
                file: r.neuron.path,
                confidence: `${(r.confidence * 100).toFixed(0)}%`,
                confidence_level:
                  r.confidence >= 0.7
                    ? "HIGH — this file likely contains the fix"
                    : r.confidence >= 0.4
                    ? "MEDIUM — check this file"
                    : "LOW — possible related file",
                reason: r.activation_path,
              })),
              next_steps:
                potentialFixes[0].confidence >= 0.7
                  ? "Read the high-confidence files directly."
                  : "Check suggested files, then record the actual fix for learning.",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: Resolve error→fix wiring ---
server.tool(
  "brainbox_resolve",
  "Record that a specific error was fixed by editing these files. Creates strong error→fix synapses for future debugging. Call this AFTER fixing a bug.",
  {
    error: z.string().describe("The error message or signature"),
    fix_files: z
      .array(z.string())
      .describe("Files that were edited to fix this error"),
    context: z
      .string()
      .optional()
      .describe("What was being attempted when the error occurred"),
  },
  async ({ error, fix_files, context }) => {
    const { errorNeuron, fixNeurons } = engine.resolveError(
      error,
      fix_files,
      context
    );

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              status: "resolved",
              error_signature: errorNeuron.path,
              fix_files: fixNeurons.map((n) => n.path),
              message:
                "Error→fix pattern learned. Future occurrences of this error will suggest these files.",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: Predict next tool in sequence ---
server.tool(
  "brainbox_predict_next",
  "Predict the next tool you'll likely use based on learned tool sequences. Also suggests files you'll probably need. Builds muscle memory from repeated tool chains.",
  {
    current_tool: z
      .string()
      .optional()
      .describe(
        "Current tool name (e.g., 'Grep', 'Read'). Omit to use last recorded tool."
      ),
  },
  async ({ current_tool }) => {
    const { nextTools, likelyFiles } = engine.predictNext(current_tool);
    const chain = engine.getToolChain();

    if (nextTools.length === 0 && likelyFiles.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "no_prediction",
                message:
                  "No learned tool sequences yet. Keep using BrainBox to build patterns.",
                current_chain: chain,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              status: "prediction",
              current_tool: current_tool || chain[chain.length - 1],
              current_chain: chain,
              next_tools: nextTools.map((r) => ({
                tool: r.neuron.path,
                confidence: `${(r.confidence * 100).toFixed(0)}%`,
                times_followed: r.neuron.access_count,
              })),
              likely_files: likelyFiles.map((r) => ({
                file: r.neuron.path,
                confidence: `${(r.confidence * 100).toFixed(0)}%`,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
