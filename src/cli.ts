#!/usr/bin/env node
import { openDb } from "./db.js";
import { HebbianEngine } from "./hebbian.js";
import { bootstrap, printResult, type BootstrapOptions } from "./bootstrap.js";
import { isEmbeddingAvailable } from "./embeddings.js";
import { extractSnippets, extractAndStoreSnippets, prepareSnippetStatements, getSupportedLang } from "./snippets.js";
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execSync, fork } from "node:child_process";

const args = process.argv.slice(2);
const command = args[0];

const db = openDb();
const engine = new HebbianEngine(db);

// Main async wrapper for commands that need await
async function main() {
  await runCommand();
  db.close();
}

function usage() {
  console.log(`
brainbox — Hebbian memory for AI agents

COMMANDS:
  record <path> [--type file|tool|error] [--query "..."]
    Record an access event. Strengthens neuron, builds synapses.

  error "<error message>" [--query "what you were doing"]
    Record an error and get fix suggestions from learned patterns.

  resolve "<error message>" <fix_file> [more fix files...]
    Wire error→fix synapses after fixing a bug. Teaches BrainBox
    the pattern so future occurrences suggest these fix files.

  recall <query> [--budget 10000] [--limit 5] [--type file]
    Neural recall with spreading activation and confidence gating.
    Returns ranked results with confidence scores and token savings.

  stats
    Show network statistics: neurons, synapses, superhighways, tokens saved.

  neurons [--type file|tool|error] [--min-myelin 0.0]
    List all neurons sorted by myelination.

  synapses [--min-weight 0.0]
    List all synaptic connections sorted by weight.

  highways [--min 0.5]
    Show myelinated superhighways (frequently used paths).

  tokens
    Token budget report: estimated savings from neural recall.

  decay
    Run decay cycle: weaken unused connections, prune dead synapses.

  predict [--tool "ToolName"]
    Predict next tool in sequence based on learned patterns.

  chain
    Show current session's tool chain.

  hubs [--limit 10]
    Show most-connected neurons (hub detection) with top connections.

  stale [--min-myelin 0.1] [--days 7]
    Show decaying superhighways — files that were important but are fading.

  projects
    Show project tags and neuron counts per project.

  tag-project <path> <name>
    Tag all file neurons under <path> with project <name>.

  intent [text]
    Get or set the current session's intent.

  sessions [--days 7]
    Show recent sessions with their intents.

  streaks
    Show neurons with consecutive anti-recall ignore streaks.

  bootstrap [--repo /path] [--max-commits 200] [--imports] [--vault /path]
            [--patterns] [--sessions] [--auto] [--dry-run]
    Seed the neural network from available sources.
    --auto:     try all sources (git, vault, imports, patterns, sessions)
    --vault:    seed from VaultGraph wikilink graph
    --patterns: seed from directory/filename patterns (auth.ts <-> auth.test.ts)
    --imports:  seed from JS/TS import graph
    --sessions: seed from Claude Code session history (~/.claude/projects/)
    Git history is always attempted; skipped gracefully if unavailable.

  embed [--force]
    Batch-embed all neurons using Xenova/all-MiniLM-L6-v2 (384 dims).
    --force: re-embed all neurons (default: only embed missing).
    Requires: npm install @huggingface/transformers

  embed [--force]
    Embed all neurons using Xenova/all-MiniLM-L6-v2 (384 dims).
    --force: re-embed all neurons (not just missing).
    Requires: npm install @huggingface/transformers

  extract-snippets [--force] [--no-embed]
    Extract function/class/method snippets from all file neurons using tree-sitter.
    --force: re-extract all (default: skip files with existing snippets).
    --no-embed: skip embedding (faster, but snippet search won't work).
    Supports: TypeScript, JavaScript, Python, Rust, Swift.

  simulate
    Run a simulation showing Hebbian learning in action.

  graph
    Show the neural network as an ASCII graph.

  install
    Set up BrainBox for Claude Code: adds MCP server + hooks to settings.json.
    Safe to re-run — skips already-installed components.

  uninstall
    Remove BrainBox hooks and MCP server from Claude Code.
    Preserves database (~/.brainbox/).

  daemon start       Start daemon (foreground by default, --bg for background)
  daemon stop        Stop running daemon
  daemon status      Check daemon health
  daemon install     Install macOS LaunchAgent (auto-start on login)
  daemon uninstall   Remove LaunchAgent
  daemon shell-hook  Print zsh hook to add to ~/.zshrc

  replay
    List last 10 sessions with session ID, start time, tool count, unique files, errors.

  replay <session_id>
    Full session timeline: seq, time, tool name, input summary, result summary. Errors in red.

  replay <session_id> --errors
    Show only error events for that session.

  replay <session_id> --tool <name>
    Filter timeline by tool name (e.g. --tool Bash).

EXAMPLES:
  brainbox record src/api/auth.ts --query "authentication"
  brainbox record src/api/session.ts --query "session management"
  brainbox recall "websocket setup" --budget 5000
  brainbox stats
  brainbox tokens
`);
}

/** Boolean flags that don't take a value */
const BOOLEAN_FLAGS = new Set([
  "imports", "patterns", "sessions", "auto", "dry-run",
]);

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        parsed[key] = "true";
      } else if (i + 1 < args.length) {
        parsed[key] = args[i + 1];
        i++;
      }
    }
  }
  return parsed;
}

function formatConfidence(c: number): string {
  const pct = (c * 100).toFixed(0);
  if (c >= 0.7) return `\x1b[32m${pct}%\x1b[0m`; // green
  if (c >= 0.4) return `\x1b[33m${pct}%\x1b[0m`; // yellow
  return `\x1b[31m${pct}%\x1b[0m`; // red
}

function formatMyelin(m: number): string {
  const bars = Math.round(m * 10);
  const filled = "█".repeat(bars);
  const empty = "░".repeat(10 - bars);
  return `${filled}${empty} ${(m * 100).toFixed(0)}%`;
}

async function runCommand() {
switch (command) {
  case "record": {
    const path = args[1];
    if (!path) {
      console.error("Usage: brainbox record <path> [--type file] [--query '...']");
      process.exit(1);
    }
    const opts = parseArgs(args.slice(2));
    const type = (opts.type || "file") as "file" | "tool" | "error" | "semantic";
    const neuron = engine.record(path, type, opts.query);
    console.log(`⚡ Recorded: ${path}`);
    console.log(`   Type: ${type}`);
    console.log(`   Myelination: ${formatMyelin(neuron.myelination)}`);
    console.log(`   Access #${neuron.access_count}`);
    if (opts.query) console.log(`   Context: "${opts.query}"`);
    break;
  }

  case "error": {
    const errorMsg = args[1];
    if (!errorMsg) {
      console.error(
        'Usage: brainbox error "error message" [--query "what you were doing"]'
      );
      process.exit(1);
    }
    const opts = parseArgs(args.slice(2));
    const { errorNeuron, potentialFixes } = await engine.recordError(
      errorMsg,
      opts.query
    );

    console.log(`\x1b[31m!\x1b[0m Error recorded: ${errorNeuron.path}`);
    console.log(`   Access #${errorNeuron.access_count}`);

    if (potentialFixes.length === 0) {
      console.log(`\n   No known fixes yet — this is a new error pattern.`);
      console.log(
        `   After fixing, record the files you edited so BrainBox learns.`
      );
    } else {
      console.log(`\n   Potential fixes (learned from past patterns):\n`);
      for (const r of potentialFixes) {
        console.log(`  ${formatConfidence(r.confidence)}  ${r.neuron.path}`);
        console.log(`       via: ${r.activation_path}`);
      }
    }
    break;
  }

  case "resolve": {
    const errorSig = args[1];
    const fixFiles = args.slice(2).filter((a) => !a.startsWith("--"));
    if (!errorSig || fixFiles.length === 0) {
      console.error(
        'Usage: brainbox resolve "error message" <fix_file> [more fix files...]'
      );
      process.exit(1);
    }
    const { errorNeuron, fixNeurons } = engine.resolveError(errorSig, fixFiles);
    console.log(`\x1b[32m✓\x1b[0m Error→Fix wiring complete`);
    console.log(`   Error: ${errorNeuron.path}`);
    for (const fix of fixNeurons) {
      console.log(`   Fix:   ${fix.path}`);
    }
    console.log(`\n   Future occurrences will suggest these files.`);
    break;
  }

  case "recall": {
    const query = args[1];
    if (!query) {
      console.error("Usage: brainbox recall <query> [--budget 10000] [--limit 5]");
      process.exit(1);
    }
    const opts = parseArgs(args.slice(2));
    const results = await engine.recall({
      query,
      token_budget: parseInt(opts.budget || "10000"),
      limit: parseInt(opts.limit || "5"),
      type: opts.type as any,
    });

    if (results.length === 0) {
      console.log(`🔍 No neural recall for "${query}" — falling back to search`);
      console.log(`   (BrainBox needs more training data for this query)`);
    } else {
      console.log(`🧠 Neural recall for "${query}":\n`);
      for (const r of results) {
        console.log(`  ${formatConfidence(r.confidence)}  ${r.neuron.path}`);
        console.log(`       via: ${r.activation_path}`);
        console.log(`       myelin: ${formatMyelin(r.neuron.myelination)}`);
        console.log(`       tokens saved: ~${r.estimated_tokens_saved}`);
        if (r.snippets && r.snippets.length > 0) {
          for (const s of r.snippets.slice(0, 3)) {
            console.log(`       snippet: ${s.snippet.name} (${s.snippet.kind}, L${s.snippet.start_line}-${s.snippet.end_line}) ${(s.confidence * 100).toFixed(0)}%`);
          }
        }
        console.log();
      }
    }
    break;
  }

  case "commits": {
    const query = args[1];
    if (!query) {
      console.error("Usage: brainbox commits <query>");
      process.exit(1);
    }

    const { isCommitLearningEnabled, predictChangeSet, commitNeuronCount } = await import("./commit-learning.js");
    const count = commitNeuronCount(db);

    if (!isCommitLearningEnabled(db)) {
      console.log(`Commit learning not yet enabled (${count}/20 commit neurons)`);
      console.log("Run: brainbox bootstrap --auto");
      process.exit(1);
    }

    const predictions = await predictChangeSet(query, db, 0.4);

    if (predictions.length === 0) {
      console.log(`No commit matches for: "${query}"`);
    } else {
      console.log(`\n📦 Change-set predictions for: "${query}" (${count} commit neurons)\n`);
      for (const pred of predictions) {
        console.log(`  ${formatConfidence(pred.confidence)} "${pred.commitMessage.slice(0, 80)}"`);
        console.log(`     Commit: ${pred.commitHash}`);
        console.log(`     Files (${pred.files.length}):`);
        for (const f of pred.files.slice(0, 8)) {
          console.log(`       - ${f}`);
        }
        if (pred.files.length > 8) {
          console.log(`       ... and ${pred.files.length - 8} more`);
        }
        console.log();
      }
    }
    break;
  }

  case "stats": {
    const s = engine.stats();
    console.log(`🧠 BrainBox Network Stats\n`);
    console.log(`  Neurons:       ${s.neuron_count}`);
    console.log(`  Synapses:      ${s.synapse_count}`);
    console.log(`  Superhighways: ${s.superhighways} (myelin > 50%)`);
    console.log(`  Total accesses: ${s.total_accesses}`);
    console.log(`  Avg myelination: ${((s.avg_myelination || 0) * 100).toFixed(1)}%`);

    const t = engine.tokenReport();
    console.log(`\n  Token savings:`);
    console.log(`    Without BrainBox: ${t.tokens_used.toLocaleString()} tokens`);
    console.log(`    With BrainBox:    ${t.tokens_with_brainbox.toLocaleString()} tokens`);
    console.log(`    Saved:            ${t.tokens_saved.toLocaleString()} tokens (${t.savings_pct.toFixed(1)}%)`);

    const emb = engine.embeddingCoverage();
    console.log(`\n  Embeddings:`);
    console.log(`    Coverage: ${emb.embedded}/${emb.total} neurons (${emb.pct.toFixed(0)}%)`);
    console.log(`    Status:   ${emb.pct >= 90 ? "good" : emb.pct > 0 ? "partial — run 'brainbox embed'" : "none — run 'brainbox embed'"}`);

    try {
      const snippetStmts = prepareSnippetStatements(db);
      const { cnt } = snippetStmts.countSnippets.get() as any;
      if (cnt > 0) {
        const withEmb = (db.prepare(`SELECT COUNT(*) as cnt FROM snippets WHERE embedding IS NOT NULL`).get() as any).cnt;
        console.log(`\n  Snippets (v4.0):`);
        console.log(`    Total:    ${cnt}`);
        console.log(`    Embedded: ${withEmb}/${cnt} (${Math.round(withEmb / cnt * 100)}%)`);
      }
    } catch { /* snippets table may not exist yet */ }
    break;
  }

  case "neurons": {
    const opts = parseArgs(args.slice(1));
    const minMyelin = parseFloat(opts["min-myelin"] || "0");
    const neurons = engine.allNeurons()
      .filter((n) => !opts.type || n.type === opts.type)
      .filter((n) => n.myelination >= minMyelin);

    console.log(`🔬 Neurons (${neurons.length}):\n`);
    for (const n of neurons) {
      console.log(`  [${n.type.padEnd(5)}] ${n.path}`);
      console.log(`         myelin: ${formatMyelin(n.myelination)}  accesses: ${n.access_count}`);
    }
    break;
  }

  case "synapses": {
    const opts = parseArgs(args.slice(1));
    const minWeight = parseFloat(opts["min-weight"] || "0");
    const synapses = engine.allSynapses().filter((s) => s.weight >= minWeight);

    console.log(`🔗 Synapses (${synapses.length}):\n`);
    for (const s of synapses) {
      const strength = "●".repeat(Math.round(s.weight * 10));
      const empty = "○".repeat(10 - Math.round(s.weight * 10));
      console.log(
        `  ${s.source_id.replace(/^[^:]+:/, "")} → ${s.target_id.replace(/^[^:]+:/, "")}`
      );
      console.log(`    ${strength}${empty} ${(s.weight * 100).toFixed(0)}%  co-accessed: ${s.co_access_count}x`);
    }
    break;
  }

  case "highways": {
    const opts = parseArgs(args.slice(1));
    const min = parseFloat(opts.min || "0.5");
    const highways = engine.getSuperhighways(min);

    if (highways.length === 0) {
      console.log(`🛤️  No superhighways yet (min myelination: ${(min * 100).toFixed(0)}%)`);
      console.log(`   Keep using BrainBox — pathways form with repeated access.`);
    } else {
      console.log(`🛤️  Superhighways (myelin > ${(min * 100).toFixed(0)}%):\n`);
      for (const n of highways) {
        console.log(`  ${formatMyelin(n.myelination)}  ${n.path}  (${n.access_count} accesses)`);
      }
    }
    break;
  }

  case "tokens": {
    const t = engine.tokenReport();
    console.log(`💰 Token Budget Report\n`);
    console.log(`  Without BrainBox: ${t.tokens_used.toLocaleString()} tokens`);
    console.log(`  With BrainBox:    ${t.tokens_with_brainbox.toLocaleString()} tokens`);
    console.log(`  Saved:            ${t.tokens_saved.toLocaleString()} tokens`);
    console.log(`  Savings:          ${t.savings_pct.toFixed(1)}%`);

    // Estimate $ savings (Claude Sonnet pricing ~$3/1M input tokens)
    const dollarsSaved = (t.tokens_saved / 1_000_000) * 3;
    if (dollarsSaved > 0.01) {
      console.log(`  Est. cost saved:  $${dollarsSaved.toFixed(2)}`);
    }
    break;
  }

  case "decay": {
    const result = engine.decay();
    console.log(`🧹 Self-healing decay cycle complete`);
    console.log(`   Pruned synapses:        ${result.pruned_synapses}`);
    console.log(`   Pruned neurons:         ${result.pruned_neurons}`);
    console.log(`   Pruned orphans:         ${result.pruned_orphans}`);
    console.log(`   Weakened noise bridges: ${result.weakened_noise_bridges}`);
    const h = result.homeostasis;
    console.log(`   \x1b[36m⚖\x1b[0m Homeostasis:`);
    console.log(`     Myelin scaled:  ${h.myelin_scaled ? `yes (×${h.myelin_scale_factor.toFixed(3)})` : "no (within target)"}`);
    console.log(`     Weight scaled:  ${h.weight_scaled ? `yes (×${h.weight_scale_factor.toFixed(3)})` : "no (within target)"}`);
    console.log(`     Neurons dampened: ${h.neurons_dampened}`);
    console.log(`     Neurons boosted:  ${h.neurons_boosted}`);
    console.log(`     Tags expired:     ${h.tags_expired}`);
    break;
  }

  case "homeostasis": {
    const result = engine.homeostasis();
    console.log(`\x1b[36m⚖\x1b[0m Homeostasis complete`);
    console.log(`   Myelin scaled:    ${result.myelin_scaled ? `yes (×${result.myelin_scale_factor.toFixed(3)})` : "no (within target)"}`);
    console.log(`   Weight scaled:    ${result.weight_scaled ? `yes (×${result.weight_scale_factor.toFixed(3)})` : "no (within target)"}`);
    console.log(`   Neurons dampened: ${result.neurons_dampened}`);
    console.log(`   Neurons boosted:  ${result.neurons_boosted}`);
    console.log(`   Tags expired:     ${result.tags_expired}`);
    break;
  }

  case "consolidate":
  case "sleep": {
    const result = engine.consolidate();
    console.log(`\x1b[35m🌙\x1b[0m Sleep consolidation complete`);
    console.log(`   Sessions replayed:      ${result.sessions_replayed}`);
    console.log(`   Synapses strengthened:   ${result.synapses_strengthened}`);
    console.log(`   Neurons reviewed:        ${result.neurons_reviewed}`);
    console.log(`   Neurons extra-decayed:   ${result.neurons_forgotten}`);
    console.log(`   Patterns discovered:     ${result.patterns_discovered}`);
    console.log(`   \x1b[36mCLS\x1b[0m Complementary Learning:`);
    console.log(`     Temporal pairs:   ${result.temporal_pairs_found}`);
    console.log(`     Directional:      ${result.directional_boosts}`);
    console.log(`     Triplets:         ${result.triplets_found}`);
    console.log(`     Episodic pruned:  ${result.episodic_rows_pruned}`);
    break;
  }

  case "recall-episodic": {
    const q = args.slice(1).join(" ");
    if (!q) {
      console.error("Usage: brainbox recall-episodic <query>");
      process.exit(1);
    }
    const results = engine.recallEpisodic(q);
    if (results.length === 0) {
      console.log(`No episodic matches for "${q}"`);
    } else {
      console.log(`\x1b[35m📖\x1b[0m Episodic recall for "${q}":\n`);
      for (const r of results) {
        const conf = Math.round(r.confidence * 100);
        const color = conf >= 70 ? "\x1b[32m" : conf >= 50 ? "\x1b[33m" : "\x1b[31m";
        console.log(`  ${color}${conf}%\x1b[0m  ${r.neuron.path}`);
        console.log(`       via: ${r.activation_path}`);
      }
    }
    break;
  }

  case "predict": {
    const opts = parseArgs(args.slice(1));
    const { nextTools, likelyFiles } = engine.predictNext(opts.tool);
    const chain = engine.getToolChain();

    console.log(`\x1b[35m?\x1b[0m Tool Sequence Prediction\n`);
    console.log(`  Current chain: ${chain.join(" -> ") || "(empty)"}\n`);

    if (nextTools.length > 0) {
      console.log(`  Next likely tools:\n`);
      for (const r of nextTools) {
        console.log(`  ${formatConfidence(r.confidence)}  ${r.neuron.path}`);
        console.log(
          `       used ${r.neuron.access_count}x in past sessions`
        );
      }
      console.log();
    }

    if (likelyFiles.length > 0) {
      console.log(`  Likely files you'll need:\n`);
      for (const r of likelyFiles) {
        console.log(`  ${formatConfidence(r.confidence)}  ${r.neuron.path}`);
      }
    }

    if (nextTools.length === 0 && likelyFiles.length === 0) {
      console.log(`  No predictions yet — keep building tool chain patterns.`);
    }
    break;
  }

  case "chain": {
    const chain = engine.getToolChain();
    console.log(`\x1b[36m~\x1b[0m Current Tool Chain:\n`);
    if (chain.length === 0) {
      console.log(`  (empty) — record tool usage to build the chain`);
    } else {
      console.log(`  ${chain.join(" -> ")}`);
    }
    break;
  }

  case "simulate": {
    await runSimulation();
    break;
  }

  case "graph": {
    showGraph();
    break;
  }

  case "embed": {
    if (!isEmbeddingAvailable()) {
      console.error("@huggingface/transformers is not installed.");
      console.error("Run: cd ~/happy-cli-new/brainbox && npm install @huggingface/transformers");
      process.exit(1);
    }

    const opts = parseArgs(args.slice(1));
    const force = args.includes("--force");

    console.log(`\n🧬 BrainBox Embedding\n`);
    console.log(`  Model: Xenova/all-MiniLM-L6-v2 (384 dims)`);
    console.log(`  Mode: ${force ? "re-embed all" : "embed missing only"}\n`);

    if (force) {
      // Clear all embeddings to force re-embed
      db.prepare("UPDATE neurons SET embedding = NULL").run();
    }

    const coverage = engine.embeddingCoverage();
    console.log(`  Before: ${coverage.embedded}/${coverage.total} neurons embedded (${coverage.pct.toFixed(0)}%)\n`);

    const startMs = Date.now();
    const result = await engine.embedAllNeurons((done, total) => {
      if (done % 50 === 0 || done === total) {
        const pct = ((done / total) * 100).toFixed(0);
        process.stdout.write(`\r  Progress: ${done}/${total} (${pct}%)`);
      }
    });
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    console.log(`\n\n  Embedded: ${result.embedded}`);
    console.log(`  Skipped:  ${result.skipped}`);
    console.log(`  Failed:   ${result.failed}`);
    console.log(`  Time:     ${elapsed}s`);

    const after = engine.embeddingCoverage();
    console.log(`\n  After: ${after.embedded}/${after.total} neurons embedded (${after.pct.toFixed(0)}%)`);
    break;
  }

  case "daemon": {
    const sub = args[1];
    const {
      readPid,
      startDaemon,
      generateLaunchAgentPlist,
      generateShellHook,
      DAEMON_PATHS,
    } = await import("./daemon.js");

    switch (sub) {
      case "start": {
        if (args.includes("--bg")) {
          // Background: fork the daemon process
          const daemonScript = new URL("./daemon.ts", import.meta.url).pathname;
          const child = fork(daemonScript, [], {
            detached: true,
            stdio: "ignore",
          });
          child.unref();
          console.log(`BrainBox daemon started (PID ${child.pid})`);
        } else {
          // Foreground: run directly (useful for dev)
          db.close(); // close CLI's db — daemon opens its own
          await startDaemon();
        }
        break;
      }

      case "stop": {
        const pid = readPid();
        if (!pid) {
          console.log("Daemon not running.");
        } else {
          process.kill(pid, "SIGTERM");
          console.log(`Sent SIGTERM to daemon (PID ${pid})`);
        }
        break;
      }

      case "status": {
        const pid = readPid();
        if (!pid) {
          console.log("Daemon: not running");
        } else {
          console.log(`Daemon: running (PID ${pid})`);
          console.log(`  Socket: ${existsSync(DAEMON_PATHS.SOCKET_PATH) ? "active" : "missing"}`);
          console.log(`  Config: ${DAEMON_PATHS.CONFIG_PATH}`);

          // Show DB stats for daemon sessions
          const daemonSessions = db
            .prepare("SELECT COUNT(*) as cnt FROM sessions WHERE id LIKE 'daemon-%'")
            .get() as any;
          const daemonAccesses = db
            .prepare("SELECT COUNT(*) as cnt FROM access_log WHERE session_id LIKE 'daemon-%'")
            .get() as any;
          console.log(`  Daemon sessions: ${daemonSessions?.cnt || 0}`);
          console.log(`  Daemon events: ${daemonAccesses?.cnt || 0}`);
        }
        break;
      }

      case "install": {
        const plistDir = join(process.env.HOME || "~", "Library", "LaunchAgents");
        const plistPath = join(plistDir, "com.brainbox.daemon.plist");
        const logDir = join(DAEMON_PATHS.DATA_DIR, "logs");

        mkdirSync(plistDir, { recursive: true });
        mkdirSync(logDir, { recursive: true });
        writeFileSync(plistPath, generateLaunchAgentPlist());

        try {
          execSync(`launchctl load "${plistPath}"`, { stdio: "inherit" });
          console.log(`LaunchAgent installed: ${plistPath}`);
          console.log("Daemon will start on next login (or run: launchctl start com.brainbox.daemon)");
        } catch {
          console.log(`Plist written to ${plistPath}`);
          console.log("Load manually: launchctl load " + plistPath);
        }
        break;
      }

      case "uninstall": {
        const plistPath = join(
          process.env.HOME || "~",
          "Library",
          "LaunchAgents",
          "com.brainbox.daemon.plist"
        );
        if (!existsSync(plistPath)) {
          console.log("LaunchAgent not installed.");
        } else {
          try {
            execSync(`launchctl unload "${plistPath}"`, { stdio: "inherit" });
          } catch {}
          unlinkSync(plistPath);
          console.log("LaunchAgent removed.");
        }
        break;
      }

      case "shell-hook": {
        console.log(generateShellHook());
        break;
      }

      default:
        console.log("Usage: brainbox daemon [start|stop|status|install|uninstall|shell-hook]");
    }
    break;
  }

  case "bootstrap": {
    const opts = parseArgs(args.slice(1));
    const isAuto = args.includes("--auto");
    const bsOpts: BootstrapOptions = {
      repo: opts.repo || process.cwd(),
      maxCommits: parseInt(opts["max-commits"] || "200", 10),
      imports: args.includes("--imports") || isAuto,
      vault: opts.vault,
      patterns: args.includes("--patterns") || isAuto,
      sessions: args.includes("--sessions") || isAuto,
      auto: isAuto,
      dryRun: args.includes("--dry-run"),
    };

    console.log(`\n🧬 BrainBox Bootstrap\n`);
    console.log(`  Repo:        ${bsOpts.repo}`);
    console.log(`  Mode:        ${isAuto ? "auto (all sources)" : "manual"}`);
    console.log(`  Max commits: ${bsOpts.maxCommits}`);
    if (bsOpts.vault) console.log(`  Vault:       ${bsOpts.vault}`);
    console.log(`  Imports:     ${bsOpts.imports ? "yes" : "no"}`);
    console.log(`  Patterns:    ${bsOpts.patterns ? "yes" : "no"}`);
    console.log(`  Sessions:    ${bsOpts.sessions ? "yes" : "no"}`);
    console.log(`  Dry run:     ${bsOpts.dryRun ? "yes" : "no"}\n`);

    const result = bootstrap(bsOpts);
    printResult(result, bsOpts.dryRun);

    // Phase 7: Extract snippets from source files (v4.0)
    if (!bsOpts.dryRun && (args.includes("--snippets") || isAuto)) {
      console.log(`\nPhase 7: Snippet extraction (tree-sitter)...`);
      const snippetDb = openDb();
      const fileNeurons = snippetDb.prepare(
        `SELECT id, path FROM neurons WHERE type = 'file'`
      ).all() as { id: string; path: string }[];

      let snippetCount = 0, filesWithSnippets = 0;
      for (const n of fileNeurons) {
        if (!getSupportedLang(n.path)) continue;
        if (!existsSync(n.path)) continue;
        const count = await extractAndStoreSnippets(snippetDb, n.path, n.id, false); // no embed during bootstrap (too slow)
        if (count > 0) {
          snippetCount += count;
          filesWithSnippets++;
        }
      }
      snippetDb.close();
      console.log(`  Extracted ${snippetCount} snippets from ${filesWithSnippets} files`);
      console.log(`  Run 'brainbox extract-snippets' to embed them for semantic search`);
    }
    break;
  }

  case "extract-snippets": {
    const force = args.includes("--force");
    const embed = !args.includes("--no-embed");
    const stmts = prepareSnippetStatements(db);

    // Get all file neurons
    const fileNeurons = db.prepare(
      `SELECT id, path FROM neurons WHERE type = 'file' ORDER BY myelination DESC`
    ).all() as { id: string; path: string }[];

    console.log(`\nSnippet Extraction (tree-sitter)\n`);
    console.log(`  File neurons: ${fileNeurons.length}`);
    console.log(`  Force:        ${force ? "yes" : "no"}`);
    console.log(`  Embed:        ${embed ? "yes" : "no"}\n`);

    let scanned = 0, extracted = 0, embedded = 0, skipped = 0, errors = 0;

    for (const neuron of fileNeurons) {
      const lang = getSupportedLang(neuron.path);
      if (!lang) { skipped++; continue; }
      if (!existsSync(neuron.path)) { skipped++; continue; }

      // Skip if already has snippets (unless --force)
      if (!force) {
        const existing = stmts.getSnippetsForNeuron.all({ parentNeuronId: neuron.id }) as any[];
        if (existing.length > 0) { skipped++; continue; }
      }

      scanned++;
      try {
        const count = await extractAndStoreSnippets(db, neuron.path, neuron.id, embed);
        if (count > 0) {
          extracted += count;
          if (embed) embedded += count;
          process.stdout.write(`  ${neuron.path}: ${count} snippets\n`);
        }
      } catch (err) {
        errors++;
      }
    }

    const totalSnippets = (stmts.countSnippets.get() as any).cnt;
    console.log(`\n  Scanned: ${scanned} files`);
    console.log(`  Extracted: ${extracted} snippets`);
    if (embed) console.log(`  Embedded: ${embedded} snippets`);
    console.log(`  Skipped: ${skipped} (no lang support, missing, or existing)`);
    if (errors > 0) console.log(`  Errors: ${errors}`);
    console.log(`  Total snippets in DB: ${totalSnippets}`);
    break;
  }

  case "hubs": {
    const opts = parseArgs(args.slice(1));
    const limit = parseInt(opts.limit || "10");
    const hubs = engine.getHubs(limit);

    if (hubs.length === 0) {
      console.log("No hub neurons found. Build more synapses first.");
    } else {
      console.log(`\n🕸️  Hub Neurons (top ${hubs.length} by out-degree)\n`);
      for (const h of hubs) {
        const shortPath = h.neuron.path.length > 50
          ? "..." + h.neuron.path.slice(-47) : h.neuron.path;
        console.log(`  [${h.neuron.type}] ${shortPath}`);
        console.log(`         out-degree: ${h.outDegree}  myelin: ${formatMyelin(h.neuron.myelination)}`);
        if (h.topConnections.length > 0) {
          for (const c of h.topConnections) {
            const tgt = c.target.path.length > 40
              ? "..." + c.target.path.slice(-37) : c.target.path;
            console.log(`         → ${tgt}  (${(c.weight * 100).toFixed(0)}%)`);
          }
        }
        console.log();
      }
    }
    break;
  }

  case "stale": {
    const opts = parseArgs(args.slice(1));
    const minMyelin = parseFloat(opts["min-myelin"] || "0.1");
    const days = parseInt(opts.days || "7");
    const stale = engine.detectStale({ minMyelination: minMyelin, daysInactive: days });

    if (stale.length === 0) {
      console.log(`No stale neurons (min myelin: ${(minMyelin * 100).toFixed(0)}%, inactive > ${days}d)`);
    } else {
      console.log(`\n⏳ Stale Superhighways (${stale.length})\n`);
      for (const s of stale) {
        const currentPct = Math.round(s.neuron.myelination * 100);
        const projectedPct = Math.round(s.projectedMyelination * 100);
        console.log(`  ${s.neuron.path}`);
        console.log(`    myelin: ${currentPct}% → ${projectedPct}% (projected)  idle: ${s.daysSinceAccess}d`);
      }
    }
    break;
  }

  case "projects": {
    const rows = db.prepare(`
      SELECT project, COUNT(*) as cnt
      FROM neurons
      WHERE project IS NOT NULL
      GROUP BY project
      ORDER BY cnt DESC
    `).all() as { project: string; cnt: number }[];

    if (rows.length === 0) {
      console.log("No project tags yet. Use: brainbox tag-project <path> <name>");
    } else {
      console.log(`\n📁 Projects\n`);
      for (const r of rows) {
        console.log(`  ${r.project.padEnd(30)} ${r.cnt} neurons`);
      }
    }

    const untagged = (db.prepare(
      "SELECT COUNT(*) as cnt FROM neurons WHERE project IS NULL AND type = 'file'"
    ).get() as any).cnt;
    if (untagged > 0) {
      console.log(`\n  (${untagged} file neurons untagged)`);
    }
    break;
  }

  case "tag-project": {
    const projectPath = args[1];
    const projectName = args[2];
    if (!projectPath || !projectName) {
      console.error("Usage: brainbox tag-project <path> <name>");
      process.exit(1);
    }
    const tagged = engine.tagProject(projectPath, projectName);
    console.log(`Tagged ${tagged} neurons as "${projectName}"`);
    break;
  }

  case "intent": {
    const text = args.slice(1).join(" ");
    if (text) {
      engine.setSessionIntent(text);
      console.log(`Session intent set: "${text}"`);
    } else {
      const intent = engine.getSessionIntent();
      if (intent) {
        console.log(`Current session intent: "${intent}"`);
      } else {
        console.log("No intent set for current session.");
      }
    }
    break;
  }

  case "sessions": {
    const opts = parseArgs(args.slice(1));
    const days = parseInt(opts.days || "7");
    const sessions = engine.getRecentSessions(days);

    if (sessions.length === 0) {
      console.log(`No sessions in the last ${days} days.`);
    } else {
      console.log(`\n📋 Recent Sessions (last ${days}d)\n`);
      for (const s of sessions) {
        const date = s.started_at.split("T")[0];
        const time = s.started_at.split("T")[1]?.slice(0, 5) || "";
        const intent = s.intent ? `"${s.intent.slice(0, 60)}"` : "(no intent)";
        console.log(`  ${date} ${time}  ${intent}`);
        console.log(`    accesses: ${s.total_accesses}  tokens saved: ${s.tokens_saved}`);
      }
    }
    break;
  }

  case "streaks": {
    const streaks = engine.getIgnoreStreaks();
    if (streaks.size === 0) {
      console.log("No ignore streaks — all recalled files are being used.");
    } else {
      console.log(`\n🚫 Ignore Streaks (${streaks.size} neurons)\n`);
      const sorted = [...streaks.entries()].sort((a, b) => b[1] - a[1]);
      for (const [id, streak] of sorted) {
        const path = id.replace(/^file:/, "");
        const decay = (1 - Math.pow(0.9, streak)) * 100;
        console.log(`  ${path}`);
        console.log(`    streak: ${streak} sessions  effective decay: ${decay.toFixed(0)}%`);
      }
    }
    break;
  }

  case "install": {
    const { install } = await import("./installer.js");
    install();
    break;
  }

  case "uninstall": {
    const { uninstall } = await import("./installer.js");
    uninstall();
    break;
  }

  case "replay": {
    replayCommand(args.slice(1));
    break;
  }

  default:
    usage();
}
} // end runCommand()

// --- Replay: session timeline viewer ---

function replayCommand(args: string[]) {
  const RED   = "\x1b[31m";
  const GREEN  = "\x1b[32m";
  const YELLOW = "\x1b[33m";
  const BOLD   = "\x1b[1m";
  const RESET  = "\x1b[0m";

  // Check if session_replay table exists
  const tableCheck = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='session_replay'"
  ).get() as { name: string } | undefined;

  if (!tableCheck) {
    console.log("No session replay data yet. BrainBox hasn't captured any sessions.");
    return;
  }

  // Parse args
  const sessionId = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const errorsOnly = args.includes("--errors");
  const toolFlag   = (() => {
    const idx = args.indexOf("--tool");
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  })();

  function truncate(str: string | null | undefined, max = 120): string {
    if (!str) return "";
    const s = str.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  function isError(result: string | null | undefined): boolean {
    if (!result) return false;
    return /error|failed|traceback|exception/i.test(result);
  }

  function formatTs(ts: string): string {
    // ts is ISO string; display as HH:MM:SS
    try {
      const d = new Date(ts);
      return d.toTimeString().slice(0, 8);
    } catch {
      return ts.slice(11, 19) || ts;
    }
  }

  if (!sessionId) {
    // --- LIST MODE: show last 10 sessions ---
    const rows = db.prepare(`
      SELECT
        r.session_id,
        MIN(r.ts) AS started_at,
        COUNT(*) AS tool_count,
        COUNT(DISTINCT CASE
          WHEN r.tool_input IS NOT NULL AND r.tool_input != ''
          THEN json_extract(r.tool_input, '$.path')
        END) AS unique_files,
        SUM(CASE WHEN ${
          // inline the error check as SQL
          "r.tool_result LIKE '%error%' OR r.tool_result LIKE '%Error%' OR " +
          "r.tool_result LIKE '%failed%' OR r.tool_result LIKE '%traceback%' OR " +
          "r.tool_result LIKE '%exception%'"
        } THEN 1 ELSE 0 END) AS error_count
      FROM session_replay r
      GROUP BY r.session_id
      ORDER BY MIN(r.ts) DESC
      LIMIT 10
    `).all() as Array<{
      session_id: string;
      started_at: string;
      tool_count: number;
      unique_files: number;
      error_count: number;
    }>;

    if (rows.length === 0) {
      console.log("No sessions found in session_replay. Hooks may not have recorded any tool calls yet.");
      return;
    }

    console.log(`\n${BOLD}Recent Sessions (last 10)${RESET}\n`);
    console.log(
      "  " +
      "SESSION ID       ".padEnd(18) +
      "STARTED AT".padEnd(22) +
      "TOOLS".padEnd(8) +
      "FILES".padEnd(8) +
      "ERRORS"
    );
    console.log("  " + "─".repeat(66));

    for (const row of rows) {
      const shortId = row.session_id.length > 14
        ? row.session_id.slice(0, 14) + "…"
        : row.session_id.padEnd(15);

      let startedStr = row.started_at || "(unknown)";
      // Format ISO to readable
      try {
        const d = new Date(row.started_at);
        startedStr = d.toISOString().replace("T", " ").slice(0, 19);
      } catch { /* leave raw */ }

      const errStr = row.error_count > 0
        ? `${RED}${row.error_count}${RESET}`
        : `${GREEN}0${RESET}`;

      console.log(
        `  ${shortId.padEnd(18)}${startedStr.padEnd(22)}${String(row.tool_count).padEnd(8)}${String(row.unique_files || 0).padEnd(8)}${errStr}`
      );
    }
    console.log();
    console.log(`  ${YELLOW}Tip:${RESET} brainbox replay <session_id> — view full timeline`);
    console.log(`       brainbox replay <session_id> --errors — errors only`);
    console.log(`       brainbox replay <session_id> --tool Bash — filter by tool\n`);
    return;
  }

  // --- DETAIL MODE: show session timeline ---

  // Resolve partial session ID (prefix match)
  const allIds = (db.prepare(
    "SELECT DISTINCT session_id FROM session_replay ORDER BY session_id"
  ).all() as Array<{ session_id: string }>).map((r) => r.session_id);

  const matchedId = allIds.find((id) => id === sessionId || id.startsWith(sessionId));
  if (!matchedId) {
    console.error(`${RED}Session not found:${RESET} ${sessionId}`);
    console.error(`Run "brainbox replay" to list available sessions.`);
    process.exit(1);
  }

  // Build query with optional filters
  let sql = "SELECT seq, ts, tool_name, tool_input, tool_result, exit_code, duration_ms FROM session_replay WHERE session_id = ?";
  const params: (string | number)[] = [matchedId];

  if (toolFlag) {
    sql += " AND tool_name = ?";
    params.push(toolFlag);
  }

  sql += " ORDER BY seq ASC";

  const events = db.prepare(sql).all(...params) as Array<{
    seq: number;
    ts: string;
    tool_name: string;
    tool_input: string | null;
    tool_result: string | null;
    exit_code: number | null;
    duration_ms: number | null;
  }>;

  if (events.length === 0) {
    console.log(`No events found for session ${matchedId}${toolFlag ? ` with tool=${toolFlag}` : ""}.`);
    return;
  }

  // Apply --errors filter in-memory (simpler than SQL LIKE chains)
  const filtered = errorsOnly ? events.filter((e) => isError(e.tool_result)) : events;

  if (filtered.length === 0) {
    console.log(`No error events found in session ${matchedId}.`);
    return;
  }

  const shortSession = matchedId.length > 20 ? matchedId.slice(0, 20) + "…" : matchedId;
  const filterDesc = errorsOnly ? " (errors only)" : toolFlag ? ` (tool: ${toolFlag})` : "";
  console.log(`\n${BOLD}Session Timeline: ${shortSession}${filterDesc}${RESET}\n`);
  console.log(
    "  " +
    "SEQ ".padEnd(6) +
    "TIME    ".padEnd(10) +
    "TOOL".padEnd(20) +
    "INPUT SUMMARY".padEnd(40) +
    "RESULT SUMMARY"
  );
  console.log("  " + "─".repeat(110));

  for (const ev of filtered) {
    const hasErr = isError(ev.tool_result);
    const rowColor = hasErr ? RED : "";
    const rowReset = hasErr ? RESET : "";

    // Parse input summary: try JSON for file path, else truncate raw
    let inputSummary = "";
    if (ev.tool_input) {
      try {
        const parsed = JSON.parse(ev.tool_input) as Record<string, unknown>;
        // Common keys in priority order
        const key = parsed.command ?? parsed.path ?? parsed.pattern ?? parsed.query ?? parsed.content;
        if (key != null) {
          inputSummary = truncate(String(key), 38);
        } else {
          inputSummary = truncate(ev.tool_input, 38);
        }
      } catch {
        inputSummary = truncate(ev.tool_input, 38);
      }
    }

    const resultSummary = truncate(ev.tool_result, 45);

    const seqStr  = String(ev.seq).padEnd(6);
    const timeStr = formatTs(ev.ts).padEnd(10);
    const toolStr = ev.tool_name.padEnd(20);
    const inStr   = inputSummary.padEnd(40);

    console.log(`  ${rowColor}${seqStr}${timeStr}${toolStr}${inStr}${resultSummary}${rowReset}`);
  }

  // Footer stats
  const total  = filtered.length;
  const errors = filtered.filter((e) => isError(e.tool_result)).length;
  const totalMs = filtered.reduce((acc, e) => acc + (e.duration_ms || 0), 0);
  console.log("  " + "─".repeat(110));
  console.log(
    `\n  ${total} events  |  ` +
    (errors > 0 ? `${RED}${errors} errors${RESET}` : `${GREEN}0 errors${RESET}`) +
    (totalMs > 0 ? `  |  total duration: ${totalMs}ms` : "") +
    `\n`
  );
}

// --- Simulation: demonstrate Hebbian learning in action ---

async function runSimulation() {
  console.log(`\n🧠 BrainBox Simulation: Hebbian Learning in Action\n`);
  console.log(`${"─".repeat(60)}\n`);

  // Create a fresh engine for the simulation
  const simEngine = new HebbianEngine(db, `sim-${Date.now()}`);

  // Core file groups that a developer repeatedly accesses together
  const websocketFiles = [
    { path: "src/api/apiSession.ts", query: "websocket" },
    { path: "src/api/auth.ts", query: "authentication" },
    { path: "src/api/encryption.ts", query: "encrypt session" },
  ];
  const configFiles = [
    { path: "src/config.ts", query: "config" },
    { path: "src/env.ts", query: "environment" },
  ];
  const testFiles = [
    { path: "src/tests/session.test.ts", query: "test session" },
    { path: "src/tests/auth.test.ts", query: "test auth" },
  ];

  // 20 sessions of realistic developer behavior
  // Websocket trio accessed together in ~80% of sessions
  const sessionPlans: { name: string; files: typeof websocketFiles }[] = [
    { name: "Session  1: Build websocket",    files: [...websocketFiles, ...configFiles] },
    { name: "Session  2: Debug websocket",    files: [...websocketFiles] },
    { name: "Session  3: Refactor websocket", files: [...websocketFiles, ...testFiles] },
    { name: "Session  4: Quick ws fix",       files: websocketFiles.slice(0, 2) },
    { name: "Session  5: Encrypt update",     files: [websocketFiles[0], websocketFiles[2]] },
    { name: "Session  6: Auth overhaul",      files: [...websocketFiles, ...configFiles] },
    { name: "Session  7: WS + tests",         files: [...websocketFiles, ...testFiles] },
    { name: "Session  8: Quick fix",          files: websocketFiles.slice(0, 2) },
    { name: "Session  9: Full stack",         files: [...websocketFiles, ...configFiles, ...testFiles] },
    { name: "Session 10: WS debug",           files: [...websocketFiles] },
    { name: "Session 11: Auth token",         files: websocketFiles.slice(0, 2) },
    { name: "Session 12: Encrypt refactor",   files: [websocketFiles[0], websocketFiles[2]] },
    { name: "Session 13: Full WS",            files: [...websocketFiles] },
    { name: "Session 14: Test suite",         files: [...websocketFiles, ...testFiles] },
    { name: "Session 15: Config update",      files: [...configFiles, websocketFiles[0]] },
    { name: "Session 16: WS perf",            files: [...websocketFiles] },
    { name: "Session 17: Quick auth",         files: websocketFiles.slice(0, 2) },
    { name: "Session 18: Encrypt + test",     files: [websocketFiles[2], ...testFiles] },
    { name: "Session 19: Full WS refactor",   files: [...websocketFiles, ...testFiles] },
    { name: "Session 20: Final WS",           files: [...websocketFiles] },
  ];

  // Simulate with time gaps (10 seconds between files in a session)
  let simTime = Date.now();
  const milestones = [1, 5, 10, 20]; // show detail at these sessions
  let sessionNum = 0;

  for (const session of sessionPlans) {
    sessionNum++;
    const showDetail = milestones.includes(sessionNum);

    if (showDetail) console.log(`\n📁 ${session.name}`);

    for (const file of session.files) {
      // Simulate tool chain: Grep → Read before each file access
      simTime += 3_000;
      simEngine.record("Grep", "tool", `searching for ${file.query}`, simTime);
      simTime += 3_000;
      simEngine.record("Read", "tool", `reading ${file.path}`, simTime);
      simTime += 4_000;
      const neuron = simEngine.record(file.path, "file", file.query, simTime);
      if (showDetail) {
        console.log(
          `   ⚡ ${file.path.padEnd(35)} myelin: ${formatMyelin(neuron.myelination)}`
        );
      }
    }

    simTime += 3_600_000; // 1 hour between sessions

    // Show milestone summaries
    if (showDetail) {
      const s = simEngine.stats();
      console.log(
        `   📊 After ${sessionNum} sessions: ${s.neuron_count} neurons, ${s.synapse_count} synapses, ${s.superhighways} superhighways`
      );
    } else if (sessionNum % 5 === 0) {
      const s = simEngine.stats();
      console.log(
        `   ... Session ${sessionNum}: ${s.superhighways} superhighways forming`
      );
    }
  }

  // Now test recall
  console.log(`\n${"─".repeat(60)}`);
  console.log(`\n🔍 Testing neural recall after 20 sessions:\n`);

  const queries = [
    "websocket setup",
    "authentication flow",
    "encrypt session data",
    "test the session",
    "database connection", // never seen — should fail
  ];

  for (const q of queries) {
    const results = await simEngine.recall({ query: q, limit: 3 });
    if (results.length === 0) {
      console.log(`  ❌ "${q}" → No neural recall (would need grep)`);
    } else {
      console.log(`  ✅ "${q}" →`);
      for (const r of results) {
        console.log(
          `     ${formatConfidence(r.confidence)} ${r.neuron.path} (via ${r.activation_path})`
        );
      }
    }
    console.log();
  }

  // Show tool sequence predictions
  console.log(`\n> Tool Sequence Learning:\n`);
  const { nextTools: predTools } = simEngine.predictNext("Grep");
  if (predTools.length > 0) {
    console.log(`  After "Grep", predict next tool:`);
    for (const r of predTools) {
      console.log(`    ${formatConfidence(r.confidence)} ${r.neuron.path} (${r.neuron.access_count} times)`);
    }
  } else {
    console.log(`  No tool predictions yet (need more tool recordings)`);
  }
  console.log();

  // Show synapse strengths
  console.log(`${"─".repeat(60)}`);
  console.log(`\n🔗 Strongest synaptic connections (fire together → wire together):\n`);
  const synapses = simEngine.allSynapses().slice(0, 6);
  for (const s of synapses) {
    const src = s.source_id.replace(/^[^:]+:/, "").split("/").pop();
    const tgt = s.target_id.replace(/^[^:]+:/, "").split("/").pop();
    const bar = "●".repeat(Math.round(s.weight * 10)) + "○".repeat(10 - Math.round(s.weight * 10));
    console.log(`  ${src} ↔ ${tgt}`);
    console.log(`    ${bar} ${(s.weight * 100).toFixed(0)}%  (co-accessed ${s.co_access_count}x)`);
  }

  // Show token savings
  console.log(`\n${"─".repeat(60)}`);
  const report = simEngine.tokenReport();
  console.log(`\n💰 Token Savings Report:`);
  console.log(`   Without BrainBox: ${report.tokens_used.toLocaleString()} tokens`);
  console.log(`   With BrainBox:    ${report.tokens_with_brainbox.toLocaleString()} tokens`);
  console.log(
    `   Saved:            ${report.tokens_saved.toLocaleString()} tokens (${report.savings_pct.toFixed(1)}%)`
  );
  const dollarsSaved = (report.tokens_saved / 1_000_000) * 3;
  if (dollarsSaved > 0) {
    console.log(`   Est. cost saved:  $${dollarsSaved.toFixed(4)} (at $3/M tokens)`);
  }

  // Show tool sequence predictions
  console.log(`\n${"─".repeat(60)}`);
  console.log(`\n🔮 Tool Sequence Predictions:`);
  for (const tool of ["Grep", "Read", "Edit"]) {
    const { nextTools } = simEngine.predictNext(tool);
    if (nextTools.length > 0) {
      const predictions = nextTools
        .map((r) => `${r.neuron.path}(${(r.confidence * 100).toFixed(0)}%)`)
        .join(", ");
      console.log(`   After ${tool} → ${predictions}`);
    }
  }

  // Show multi-hop spreading depth distribution
  console.log(`\n${"─".repeat(60)}`);
  console.log(`\n🕸️  Multi-Hop Spreading Activation:\n`);

  const spreadQuery = "websocket";
  const spreadResults = await simEngine.recall({ query: spreadQuery, limit: 15 });

  const byDepth: Record<string, typeof spreadResults> = {
    direct: [], "hop-1": [], "hop-2": [], "hop-3": [],
  };

  for (const r of spreadResults) {
    if (r.activation_path === "direct") byDepth.direct.push(r);
    else if (r.activation_path.includes("spread(1)")) byDepth["hop-1"].push(r);
    else if (r.activation_path.includes("spread(2)")) byDepth["hop-2"].push(r);
    else if (r.activation_path.includes("spread(3)")) byDepth["hop-3"].push(r);
    else byDepth.direct.push(r); // myelinated fallback
  }

  console.log(`   Query: "${spreadQuery}"`);
  console.log(`   Direct hits:  ${byDepth.direct.length}`);
  console.log(`   1-hop spread: ${byDepth["hop-1"].length}`);
  console.log(`   2-hop spread: ${byDepth["hop-2"].length}`);
  console.log(`   3-hop spread: ${byDepth["hop-3"].length}`);

  for (const r of spreadResults) {
    console.log(`     ${formatConfidence(r.confidence)} ${r.neuron.path} (${r.activation_path})`);
  }

  // Show network stats
  console.log(`\n${"─".repeat(60)}`);
  console.log(`\n🧠 Final Network State:`);
  const finalStats = simEngine.stats();
  console.log(`   Neurons: ${finalStats.neuron_count}`);
  console.log(`   Synapses: ${finalStats.synapse_count}`);
  console.log(`   Superhighways: ${finalStats.superhighways}`);
  console.log(`   Avg myelination: ${((finalStats.avg_myelination || 0) * 100).toFixed(1)}%`);
}

// --- Graph visualization ---

function showGraph() {
  const neurons = engine.allNeurons();
  const synapses = engine.allSynapses().filter((s) => s.weight > 0.1);

  if (neurons.length === 0) {
    console.log("🧠 Empty network. Run 'brainbox simulate' to see it in action.");
    return;
  }

  console.log(`\n🧠 Neural Network Graph\n`);

  // Show nodes
  for (const n of neurons.slice(0, 15)) {
    const shortPath = n.path.length > 40 ? "..." + n.path.slice(-37) : n.path;
    const mBar = formatMyelin(n.myelination);
    console.log(`  [${n.type}] ${shortPath}`);
    console.log(`         ${mBar}  (${n.access_count} hits)\n`);

    // Show outgoing connections
    const outgoing = synapses.filter((s) => s.source_id === n.id);
    for (const syn of outgoing.slice(0, 3)) {
      const targetPath = syn.target_id.replace(/^[^:]+:/, "");
      const short = targetPath.length > 30 ? "..." + targetPath.slice(-27) : targetPath;
      const arrow = syn.weight > 0.5 ? "═══>" : syn.weight > 0.3 ? "───>" : "- ->";
      console.log(
        `         ${arrow} ${short}  (w: ${(syn.weight * 100).toFixed(0)}%)`
      );
    }
    if (outgoing.length > 0) console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
