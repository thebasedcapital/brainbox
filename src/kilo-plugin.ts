/**
 * BrainBox Kilo Plugin
 *
 * Exposes BrainBox Hebbian memory as native Kilo tools.
 * Kilo's plugin SDK supports custom tools (not lifecycle hooks),
 * so we register callable tools that the agent can invoke directly.
 *
 * Tools:
 *   brainbox_record  — Record a file/tool access (Hebbian learning)
 *   brainbox_recall  — Neural recall with spreading activation
 *   brainbox_stats   — Network statistics and token savings
 *   brainbox_decay   — Run decay cycle to prune dead synapses
 *   brainbox_error   — Record error and get fix suggestions
 *
 * Install: add to ~/.config/kilo/config.json:
 *   "plugin": ["/Users/bbclaude/happy-cli-new/brainbox/dist/kilo-plugin.js"]
 */

import type { Plugin } from "@kilocode/plugin";
import { tool } from "@kilocode/plugin";
import { openDb } from "./db.js";
import { HebbianEngine } from "./hebbian.js";

function getEngine(sessionId?: string): { engine: HebbianEngine; db: ReturnType<typeof openDb> } {
  const db = openDb();
  const engine = new HebbianEngine(db, sessionId || `kilo-${Date.now()}`);
  return { engine, db };
}

const brainboxPlugin: Plugin = async (_ctx) => {
  return {
    tool: {
      brainbox_record: tool({
        description: "Record a file/tool access. Strengthens neural pathways through Hebbian learning. Call this every time you read or edit a file.",
        args: {
          path: tool.schema.string().describe("File path, tool name, or error signature"),
          type: tool.schema.enum(["file", "tool", "error", "semantic"]).default("file").describe("Neuron type"),
          query: tool.schema.string().optional().describe("What were you looking for? (context for learning)"),
        },
        async execute(args) {
          const { engine, db } = getEngine();
          try {
            const neuron = engine.record(args.path, args.type, args.query);
            const pct = (neuron.myelination * 100).toFixed(0);
            const msg = neuron.myelination > 0.5
              ? `Superhighway! ${args.path} is deeply myelinated.`
              : neuron.access_count === 1
              ? `New neuron created for ${args.path}.`
              : `Pathway strengthened. Myelination: ${pct}%`;
            return `Recorded: ${args.path} | myelination: ${pct}% | accesses: ${neuron.access_count} | ${msg}`;
          } finally {
            db.close();
          }
        },
      }),

      brainbox_recall: tool({
        description: "Neural recall: find relevant files/tools using Hebbian memory instead of grep. Returns results with confidence scores. Use BEFORE searching — if confidence is high, skip the search entirely to save tokens.",
        args: {
          query: tool.schema.string().describe("What are you looking for?"),
          limit: tool.schema.number().default(5).describe("Max results"),
          type: tool.schema.enum(["file", "tool", "error", "semantic"]).optional().describe("Filter by neuron type"),
        },
        async execute(args) {
          const { engine, db } = getEngine();
          try {
            const results = await engine.recall({
              query: args.query,
              type: args.type,
              limit: args.limit,
              token_budget: 10000,
            });

            if (results.length === 0) {
              return `No neural pathways found for "${args.query}". Fall back to grep/search.`;
            }

            const lines = results.map((r) => {
              const pct = Math.round(r.confidence * 100);
              const myelin = Math.round(r.neuron.myelination * 100);
              const level = pct >= 70 ? "HIGH" : pct >= 40 ? "MEDIUM" : "LOW";
              return `  ${r.neuron.path} (confidence: ${pct}%, myelin: ${myelin}%, ${level})`;
            });

            const totalSaved = results.reduce((s, r) => s + r.estimated_tokens_saved, 0);
            return `Neural recall for "${args.query}":\n${lines.join("\n")}\nEstimated tokens saved: ${totalSaved}`;
          } finally {
            db.close();
          }
        },
      }),

      brainbox_stats: tool({
        description: "Show BrainBox network statistics: neurons, synapses, superhighways, and token savings.",
        args: {},
        async execute() {
          const { engine, db } = getEngine();
          try {
            const s = engine.stats();
            const t = engine.tokenReport();
            const highways = engine.getSuperhighways(0.5);
            const emb = engine.embeddingCoverage();

            const topHw = highways.slice(0, 5).map((h) =>
              `  ${h.path} (myelin: ${(h.myelination * 100).toFixed(0)}%, accesses: ${h.access_count})`
            );

            return [
              `Neurons: ${s.neuron_count}`,
              `Synapses: ${s.synapse_count}`,
              `Superhighways: ${s.superhighways} (myelin > 50%)`,
              `Avg myelination: ${((s.avg_myelination || 0) * 100).toFixed(1)}%`,
              `Embeddings: ${emb.embedded}/${emb.total} (${emb.pct.toFixed(0)}%)`,
              `Token savings: ${t.tokens_saved.toLocaleString()} saved (${t.savings_pct.toFixed(1)}%)`,
              `Top superhighways:`,
              ...topHw,
            ].join("\n");
          } finally {
            db.close();
          }
        },
      }),

      brainbox_decay: tool({
        description: "Run a decay cycle: weaken unused neural connections and prune dead synapses. Run periodically (e.g., daily).",
        args: {},
        async execute() {
          const { engine, db } = getEngine();
          try {
            const result = engine.decay();
            return `Decay complete. Pruned ${result.pruned_synapses} dead synapses.`;
          } finally {
            db.close();
          }
        },
      }),

      brainbox_error: tool({
        description: "Record an error and get suggestions for which files likely contain the fix. BrainBox learns error->fix patterns over time.",
        args: {
          error: tool.schema.string().describe("The error message or stack trace"),
          query: tool.schema.string().optional().describe("What were you trying to do?"),
        },
        async execute(args) {
          const { engine, db } = getEngine();
          try {
            const { errorNeuron, potentialFixes } = await engine.recordError(args.error, args.query);

            if (potentialFixes.length === 0) {
              return `Error recorded: ${errorNeuron.path}\nNo known fixes yet — this is a new error pattern. After fixing, record the files you edited so BrainBox learns.`;
            }

            const fixes = potentialFixes.map((r) => {
              const pct = Math.round(r.confidence * 100);
              const level = pct >= 70 ? "HIGH" : pct >= 40 ? "MEDIUM" : "LOW";
              return `  ${r.neuron.path} (confidence: ${pct}%, ${level})`;
            });

            return `Error: ${errorNeuron.path}\nPotential fixes:\n${fixes.join("\n")}`;
          } finally {
            db.close();
          }
        },
      }),
    },
  };
};

export default brainboxPlugin;
