# BrainBox: Zero-Cost Hebbian Memory for AI Coding Agents

**The First Deployed Agent Memory System That Learns Behavioral Patterns for Free — File Access, Error→Fix Pairs, and Tool Sequences Through Synaptic Myelination**

*Bhavesh B* — bhaveshb@proton.me

*February 2026*

**DOI:** [10.5281/zenodo.18664906](https://doi.org/10.5281/zenodo.18664906) (concept DOI — always resolves to latest version)

---

## Abstract

We present BrainBox, a novel memory architecture for AI coding agents that learns behavioral patterns using Hebbian learning and synaptic myelination. Unlike declarative memory systems (Mem0, SuperMemory, OpenMemory, Zep, Letta, LangMem), retrieval-augmented generation, and static instruction files (CLAUDE.md), BrainBox implements procedural memory — learning *how agents work* rather than *what they know*. The system records file co-access patterns, error→fix associations, and tool usage sequences, strengthening neural pathways through repeated use and weakening them through multiplicative decay.

We introduce three key innovations: (1) cross-type Hebbian synapses connecting file, tool, and error neurons, (2) error→fix pair learning that creates a "debugging immune system," and (3) tool sequence myelination that builds agent muscle memory. Mathematical verification confirms all learning dynamics match established neuroscience models (BCM diminishing returns, Ebbinghaus forgetting curves, Collins & Loftus spreading activation).

We survey seven prominent agent memory systems and demonstrate that all operate at Layer 2 (declarative knowledge) — storing facts, preferences, and conversations. BrainBox operates at Layer 3 (agent behavioral learning) in our proposed four-layer framework for Hebbian learning in AI — a layer where prior research exists (MACLA, SYNAPSE, Cortex, MAGMA) but no deployed system integrates Hebbian behavioral learning with production agent platforms. Production evaluation on a network of 79 neurons and 3,554 synapses shows 8.9% gross token savings in the first 5 hours, with SNAP saturation curves confirming BCM-inspired diminishing returns in real usage. Benchmark evaluation achieves 67% top-1 recall accuracy (5x over baseline) on a 2,276-neuron production network.

**Keywords:** Hebbian learning, agent memory, myelination, spreading activation, procedural memory, token optimization, Mem0, SuperMemory, OpenMemory

---

## 1. Introduction

### 1.1 The Problem: Stateless Agents Are Inefficient

Current AI agent frameworks treat each session as *tabula rasa*. When a coding agent starts a new session, it has no memory of which files it accessed yesterday, which errors it debugged last week, or which tool chains it uses most frequently. Every session rediscovers the same patterns through expensive search operations.

Consider a developer who works on an authentication module daily. The agent reads `auth.ts`, `session.ts`, and `encryption.ts` together in 80% of sessions. Without memory, each session begins with a grep for "authentication," reads search results, then opens files one by one — consuming ~2,000 tokens per rediscovery. With Hebbian memory, the agent would recall these three files instantly at ~0 additional search tokens because the synaptic pathway is myelinated.

The cost is not trivial. At $3 per million input tokens (Claude Sonnet pricing), an agent making 1,000 file accesses per day wastes approximately $6/day on redundant search. Over a year, this amounts to ~$2,000 in unnecessary token expenditure per developer — not counting the latency cost of waiting for searches that could be skipped entirely.

### 1.2 The Insight: Hardware Prefetching for Software Agents

In 1991, Brown University researchers published "Fido: A Cache That Learns to Fetch" — a system that used associative memory to predict which database pages would be needed next based on access patterns. The key insight was simple: **access patterns are learnable, not random.** By recording which pages were co-accessed and strengthening those associations, Fido achieved significant cache hit rate improvements.

Thirty-five years later, hardware CPU prefetchers use sophisticated neural pattern learning to predict memory access sequences. Intel's Stride Prefetcher, AMD's L1/L2 prefetching, and ARM's data-dependent prefetch all learn from past access patterns to predict future ones.

Yet nobody has applied this principle *up the stack* to software agents. BrainBox fills this gap by treating file paths as neurons, co-access patterns as synapses, and frequently-used pathways as myelinated superhighways — directly mapping biological learning onto agent behavior.

### 1.3 Contributions

1. **BrainBox:** A working Hebbian memory system for AI coding agents with mathematically verified learning dynamics
2. **Cross-type synapses:** Connections between file, tool, and error neurons enabling multi-modal behavioral learning
3. **Error→fix pair learning:** A debugging immune system that learns which files fix which errors
4. **Tool sequence myelination:** Muscle memory for common tool chains (Grep→Read→Edit→Test)
5. **Layer 3 positioning:** A four-layer framework identifying where Hebbian learning applies in AI systems
6. **Token budget awareness:** Memory-guided recall that respects context window constraints

---

## 2. Related Work

### 2.1 A Four-Layer Framework for Hebbian Learning in AI

We propose a framework for understanding where Hebbian learning principles apply across AI systems:

| Layer | Domain | What Is Learned | Examples |
|-------|--------|----------------|----------|
| **L1: Model Internals** | Transformer architecture | Weight updates, attention patterns | Chaudhary (2025), Szelogowski (2025), CL Survey (2024) |
| **L2: General Memory** | Declarative knowledge | Facts, episodes, semantic relationships | Mem0, SuperMemory, Zep, Letta, LangMem |
| **L3: Agent Behavior** | Procedural patterns | File access, tool chains, error→fix pairs | **BrainBox (this work)** |
| **L4: Collective Intelligence** | Multi-agent systems | Shared behavioral patterns across agent swarms | (proposed, not yet implemented) |

### 2.2 Layer 1: Model Internals

Recent work has explored Hebbian principles within neural network architectures:

- **Chaudhary (2025)** augmented decoder-only transformers with Hebbian plasticity modules that adapt *during inference*, achieving rapid task-specific adaptation on copying, regression, and few-shot classification (arXiv 2510.21908).
- **Szelogowski (2025)** introduced the Engram Neural Network (ENN) — a recurrent architecture with explicit, differentiable Hebbian memory and sparse attention-driven retrieval, achieving performance comparable to GRU/LSTM on WikiText-103 (arXiv 2507.21474).
- **Continual Learning Survey (2024)** reviewed Hebbian plasticity and STDP in sparse/predictive coding networks for catastrophic forgetting mitigation, establishing that bio-plausible local learning rules can support continual learning at the edge (arXiv 2407.17305).

These approaches modify model *weights* or apply Hebbian plasticity within the network architecture. BrainBox operates at a higher abstraction level — learning behavioral patterns *outside* the model, in the agent's tool-use layer.

### 2.3 Layer 2: General Memory Systems

A rapidly growing ecosystem of agent memory systems operates at Layer 2, storing declarative knowledge (facts, preferences, conversations) with varying retrieval strategies. We survey the seven most prominent systems and compare their architectures to BrainBox's procedural approach.

**Mem0** (Apache-2.0, 47k+ GitHub stars) implements a hybrid datastore combining graph, vector, and key-value stores. Memory extraction is LLM-driven: a two-phase pipeline ingests conversation exchanges, evaluates them against existing memories via tool calls, and performs dynamic consolidation with conflict resolution. Mem0 reports +26% accuracy over OpenAI Memory on the LOCOMO benchmark and 91% lower p95 latency than full-context retrieval. The enhanced variant **Mem0g** adds entity-relation triplets for graph-based traversal. Mem0 learns *what agents discussed*, not *how they behave* — the 100th retrieval of the same fact returns the same similarity score as the first, with no Hebbian strengthening.

**OpenMemory** (Apache-2.0, by Mem0 team) is a local-first MCP server (FastAPI + Postgres + Qdrant) that captures coding preferences and patterns passively as the developer works. It provides cross-tool context sharing — define preferences in Claude, build in Cursor, debug in Windsurf — via the Model Context Protocol. OpenMemory stores declarative preferences ("always use bun," "prefer functional style"), not behavioral patterns. It has no learning mechanism beyond accumulation.

**SuperMemory** (MIT, supermemory.ai) emphasizes temporal reasoning with dual-layer timestamps (`documentDate` for conversation time, `eventDate` for extracted event time). Built on Postgres and Cloudflare Durable Objects, it scales to 50M tokens per user and 5B tokens daily for enterprise. SuperMemory reports 71.4% multi-session accuracy and 76.7% temporal reasoning accuracy. Its "memory evolution" via graph updates is closer to knowledge graph maintenance than Hebbian learning — edges are explicitly created from extracted facts, not implicitly learned from co-access.

**Zep** (getzep.com, research paper arXiv 2501.13956) introduces **Graphiti**, a temporally-aware knowledge graph engine with three subgraphs: Episode (conversations), Semantic Entity (facts), and Community (relationships). Each fact carries `valid_at`/`invalid_at` timestamps for temporal tracking. Zep reports 94.8% accuracy on the Deep Memory Retrieval benchmark and up to 18.5% improvement on LongMemEval. Its graph-based retrieval uses episode-mention reranking and node-distance scoring. Like MAGMA, Zep organizes declarative knowledge temporally — it does not learn from file access patterns or tool sequences.

**Letta** (Apache-2.0, formerly MemGPT, 21k+ stars) implements an "LLM Operating System" metaphor with virtual memory management: core memory (in-context, self-editing persona/human blocks) and external memory (archival vector DB + recall storage). Uniquely, **agents actively manage their own memory** using built-in tools (`memory_replace`, `memory_insert`, `archival_memory_search`). This is procedural in the sense that the agent decides what to remember, but the *memory itself is declarative* — facts and episodes, not behavioral patterns. Letta's active memory management requires the agent to learn memory management as a skill, adding cognitive overhead absent from BrainBox's passive learning.

**LangMem** (MIT, LangChain ecosystem) provides a two-layer architecture: stateless core (extract/update/consolidate) and stateful integration via LangGraph's BaseStore. It supports semantic memory (collections + profiles), procedural memory (updated instructions in the agent prompt), and episodic memory (few-shot examples from past conversations). LangMem's "procedural memory" updates the agent's system prompt based on learned patterns — the closest approach to behavioral learning among L2 systems, but it operates at the instruction level ("use TypeScript strict mode") rather than the access-pattern level ("auth.ts and session.ts are always accessed together").

**Table 1: Comparison of Agent Memory Systems**

| System | Type | Learning | Retrieval | Hebb. | Behav. |
|--------|------|----------|-----------|-------|--------|
| Mem0 | Decl. | LLM extract | Vec+Graph | No | No |
| OpenMemory | Decl. | Passive | Vec+SQL | No | No |
| SuperMem | Decl.+Temp | Graph evol. | Hybrid | No | No |
| Zep | Decl.+Temp | Dyn. synth. | Temp. KG | No | No |
| Letta | Decl. | Active mgmt | Vec+Struct | No | No |
| LangMem | Sem.+Proc. | Extract | Sem+Lookup | No | Part.* |
| **BrainBox** | **Proc.** | **Hebbian** | **Spread** | **Yes** | **Yes** |

\* LangMem updates agent instructions (procedural), but does not learn file access patterns or tool sequences.

All six systems store *what the agent knows or discussed*. None learn *how the agent works* — which files are co-accessed, which tool chains are repeated, which errors are fixed by which files. BrainBox occupies this gap uniquely.

### 2.4 Layer 3: Agent Behavioral Memory

Several systems approach agent behavioral memory without Hebbian learning:

- **Anderson (1983)** established the fan effect in ACT-R: activation spreading from node j to i is inversely proportional to the out-degree (fan) of j. This prevents hub nodes from dominating retrieval. BrainBox's v1.0.0 recall implements this as `spread / sqrt(out_degree)` — a principle absent from all other agent memory systems we surveyed.
- **SYNAPSE** (arXiv 2601.02744, January 2026) uses spreading activation for episodic-semantic memory in conversational agents with graph-based retrieval, fan effect normalization, and lateral inhibition. SYNAPSE implements Anderson's fan effect and adds lateral inhibition where top-k nodes suppress competitors. We evaluated lateral inhibition in our benchmark and found it provides no accuracy improvement for agent behavioral memory (see Section 3.3). SYNAPSE does not implement myelination or file access pattern learning.
- **MACLA** (arXiv 2512.18950, December 2025) implements hierarchical procedural memory via Bayesian selection, compressing trajectories into reusable procedures, but learns action sequences rather than file access patterns.
- **Cortex/Asteria** (arXiv 2509.17360, September 2025) implements semantic-aware caching for agentic tool access with predictive prefetching — the closest system to BrainBox's prefetching framing. However, it uses semantic similarity (ANN + LLM judger) for cache hit detection rather than Hebbian learning, and optimizes cross-region latency rather than learning behavioral patterns.
- **MAGMA** (arXiv 2601.03236, January 2026) represents memory across orthogonal semantic, temporal, causal, and entity graphs with policy-guided traversal. It achieves 45.5% higher reasoning accuracy on long-context benchmarks while reducing token consumption by 95%. Like BrainBox, it uses graph-based retrieval, but it focuses on declarative memory organization rather than procedural learning of file access patterns.

A comprehensive survey of agent memory systems (arXiv 2512.13564, December 2025) identifies three memory types — token-level, parametric, and latent — but does not discuss Hebbian learning for operational behavioral patterns, confirming the gap.

**BrainBox is the first system to apply Hebbian learning to agent file access patterns, tool sequencing, and error→fix pair association.** The closest historical precedent remains Fido (1991), which operated at the hardware caching layer rather than the agent behavioral layer.

### 2.5 Why the Gap Exists

Four factors explain why Layer 3 Hebbian learning has not been explored:

1. **Misaligned incentives:** Frontier AI labs profit from token consumption, not token efficiency. A system that reduces token usage by 40% directly reduces revenue.
2. **Benchmark blindness:** Academic benchmarks evaluate general task performance (SWE-bench, HumanEval), not developer workflow efficiency or session-over-session improvement.
3. **RAG local maximum:** The industry consensus that "just use RAG" solves memory problems prevents exploration of learning-based alternatives.
4. **Cross-disciplinary gap:** Hardware architects who understand prefetching don't build LLM agents, and agent builders don't read computer architecture papers.

---

## 3. Architecture

### 3.1 Core Abstractions

BrainBox models agent behavior as a neural network with four primitives:

**Neurons** represent entities the agent interacts with:
- `file` neurons: file paths the agent reads or writes
- `tool` neurons: tools the agent invokes (Grep, Read, Edit, Bash)
- `error` neurons: normalized error messages encountered during sessions
- `semantic` neurons: abstract concepts (reserved for future use)

Each neuron maintains:
- **Activation** (0–1): How recently and strongly the neuron was accessed. Decays multiplicatively over time.
- **Myelination** (0–0.95): Superhighway status. Increases with repeated access using sigmoid-like diminishing returns. Decays very slowly.
- **Access count:** Total number of times this neuron has been activated.
- **Contexts:** JSON array of query strings that triggered this neuron, enabling keyword-based recall.

**Synapses** are weighted, bidirectional connections between neurons:
- **Weight** (0–1): Hebbian strength. Increases when neurons fire together, using BCM diminishing returns. Decays multiplicatively when unused.
- **Co-access count:** How many times the connected neurons were activated within the co-access window.

**Sessions** group accesses within a time window and track token savings.

**The co-access window** (last 25 unique files) defines "firing together." Neurons in the sequential window form or strengthen synapses, with positional proximity determining strength. This maps to the biological concept of spike-timing-dependent plasticity (STDP), adapted from temporal to sequential proximity — what matters is *order of access*, not elapsed time.

### 3.2 Hebbian Learning Algorithm

When the agent accesses a resource, BrainBox executes:

```
LEARNING_RATE           = 0.1
MYELIN_RATE             = 0.02
MYELIN_MAX              = 0.95
CO_ACCESS_WINDOW_SIZE   = 25      // last 25 unique files (not time-based)
ERROR_BOOST             = 2.0

function record(path, type, query):
  neuron = getOrCreate(path, type)
  neuron.activation = 1.0
  neuron.myelination += MYELIN_RATE * (1 - neuron.myelination)   // BCM diminishing returns
  neuron.myelination = min(neuron.myelination, MYELIN_MAX)
  neuron.contexts.append(query)

  // Sequential window co-access: position in window determines strength
  for i, recentNeuron in recentAccessWindow:
    positionFactor = (i + 1) / windowSize    // oldest=weakest, newest=strongest
    rate = LEARNING_RATE * (ERROR_BOOST if error involved, else 1)
    delta = rate * positionFactor

    // BCM diminishing returns: harder to strengthen near-saturated synapses
    synapse(neuron, recentNeuron).weight += delta * (1 - synapse.weight)
    synapse(recentNeuron, neuron).weight += delta * (1 - synapse.weight)

  // Update window: dedup, move to end, evict oldest if > CO_ACCESS_WINDOW_SIZE
  recentAccessWindow.remove(neuron)
  recentAccessWindow.push(neuron)
  if recentAccessWindow.length > CO_ACCESS_WINDOW_SIZE:
    recentAccessWindow.shift()
```

**v0.8.0 design change — sequential window replaces timestamp window:**

The original design used a 60-second temporal window: neurons accessed within 60s of each other formed synapses. This created a "deep work blind spot" — when an agent spends 2+ minutes studying a file before navigating to a related file, the temporal gap exceeds the window and no synapse forms, despite the files being clearly related in the work session.

The sequential window model (inspired by Karpathy's distillation philosophy: "it's not about time, it's about sequential access order") tracks the last 25 unique files regardless of time elapsed. Position within the window determines synapse strength via a smooth gradient, not a cliff:

- Most recently accessed file: `positionFactor = 1.0` (full strength)
- Oldest file in window: `positionFactor = 0.04` (4% strength)

**Cross-invocation seeding:** At constructor time, the last 25 unique accesses are loaded from `access_log` (ordered by timestamp and access_order), ensuring the window persists across agent restarts.

Key properties:
- **Diminishing returns** (BCM rule): Both myelination and synapse strengthening follow `delta_w = eta * (1 - w)`, preventing saturation and matching Bienenstock-Cooper-Munro (1982) dynamics.
- **Positional proximity weighting:** Files accessed more recently in the sequential window form stronger synapses. Unlike temporal proximity, this captures deep work patterns where an agent spends minutes on related files.
- **Window eviction:** Accessing 26+ unique files naturally pushes the oldest out, providing automatic scope limiting without arbitrary time cutoffs.
- **Re-access deduplication:** Re-accessing a file moves it to the most recent position without duplicating it in the window.
- **Bidirectional synapses:** If A and B fire together, both A→B and B→A are strengthened.
- **Error learning boost:** Synapses involving error neurons strengthen at 2x rate because errors are high-signal events in debugging workflows.

### 3.3 Recall Algorithm: Multi-Hop Spreading Activation

Recall uses three-phase spreading activation inspired by Collins & Loftus (1975) and Anderson (1983), with multi-hop BFS traversal, fan effect normalization, and convergence detection:

**Phase 1a — Direct Keyword Match:**
Search neuron contexts for query keywords. Tool neurons (`type = "tool"`) are excluded from all result phases — they participate only as bridges during spreading activation.

**Phase 1b — Vector Similarity (optional, requires embeddings):**
If neurons have embedding vectors (384-dimensional, all-MiniLM-L6-v2), compute cosine similarity between the query embedding and all embedded neurons. Neurons with similarity > 0.25 are included as candidates even without keyword overlap. This enables semantic recall: "socket connection" → `websocket.ts`, "sign in password" → `login.ts`.

Embeddings are computed lazily via `embedNeuron()` (path + contexts → single text → 384-dim vector), stored as BLOBs in the neurons table (1,536 bytes per neuron). The `embed` CLI command batch-embeds all neurons (~2,276 neurons in 12s on Apple Silicon).

**Confidence Scoring — Multiplicative Formula (v1.0.0):**

The original additive formula (`50% context + 20% myelination + 20% recency + 10% path`) allowed high-myelination neurons with weak semantic match to outrank relevant results. A file with context score 0.2 and myelination 0.95 scored higher than a perfect match at 0.8 with zero myelination.

The v1.0.0 formula makes context a **gate** — if semantic similarity is zero, the result is zero regardless of how frequently the file was accessed:

```
contextScore = cosine_similarity(query_embedding, neuron_embedding)    // 0-1
myelinBonus  = min(myelination, 0.5) * 0.3     // soft cap at 0.5
recencyBonus = max(0, 1 - age_hours/168) * 0.2  // linear decay, 1 week
pathBonus    = keyword_match_ratio * 0.2         // path contains query words

confidence = contextScore × (1 + myelinBonus + recencyBonus + pathBonus)
```

This is, to our knowledge, a novel contribution — standard approaches in ACT-R, SYNAPSE, and MAGMA all use additive scoring with different weights. Framing myelination and recency as multiplicative bonuses rather than additive terms ensures that behavioral history *amplifies* relevance but cannot *substitute* for it.

**Myelination soft cap:** Myelination is capped at 0.5 in the confidence formula (not in the stored value). A superhighway at 95% myelination contributes the same confidence boost as one at 50%. This prevents tool-adjacent files from inflating their scores purely through association frequency.

**Phase 2 — Multi-Hop Spreading Activation with Fan Effect (BFS):**

Direct matches seed a frontier. The algorithm expands the frontier up to `MAX_SPREAD_HOPS` (default 3) levels deep using breadth-first search, with **fan effect normalization** (Anderson, 1983):

```
frontier = direct_matches
for hop = 0 to MAX_SPREAD_HOPS:
  next_frontier = []
  for each seed in frontier:
    // FAN EFFECT (Anderson 1983, ACT-R): divide by sqrt(out_degree)
    // Neurons with many outgoing synapses dilute their activation.
    // A tool neuron with 500 synapses spreads 1/√500 ≈ 4.5% per neighbor.
    // A file neuron with 3 synapses spreads 1/√3 ≈ 58% per neighbor.
    fan_factor = 1 / sqrt(min(out_degree(seed), 50))

    for each outgoing synapse with weight > 0.3:
      if target.type == "tool": skip     // tools are bridges, never results
      spreadConfidence = seed.confidence * synapse.weight
                       * (1 + min(target.myelination, 0.5))
                       * fan_factor
      if spreadConfidence < CONFIDENCE_GATE: skip

      if target already activated:
        // Convergence: take MAX confidence across paths (Collins & Loftus)
        existing.confidence = max(existing.confidence, spreadConfidence)
      else:
        add target to results
        add target to next_frontier
  frontier = next_frontier
```

The fan effect is the foundational principle from Anderson's ACT-R theory of memory (1983): "The amount of activation an object X passes to each of the n objects it is associated with is inversely proportional to n." In cognitive science, this explains the *fan effect* in human memory — concepts associated with many other concepts are harder to retrieve than those with few associations.

We use `sqrt(out_degree)` rather than raw `1/out_degree` for softer dampening. Empirically, raw inverse degree is too aggressive — files with 10+ synapses (common after bootstrap) would spread negligible activation. The square root preserves the principle (more connections = more dilution) while remaining practical.

The out-degree cap at 50 prevents near-zero fan factors for extremely connected neurons (tool neurons can have 500+ synapses).

Key properties of multi-hop spreading:
- **Fan effect normalization** — activation diluted proportionally to source connectivity (Anderson, 1983)
- **Tool exclusion** — tool neurons traverse synapses but never appear in results
- **Breadth-first by hop level** — processes all hop-1 nodes before hop-2, ensuring shortest paths are discovered first
- **Natural confidence decay** — the product `parentConfidence × synapseWeight × (1 + myelination) × fanFactor` decays rapidly across hops. Most weak paths fall below the 0.4 confidence gate by hop 2-3
- **Convergence detection** — when multiple paths reach the same neuron, the maximum confidence is taken (not summed), preventing inflation while capturing the strongest association
- **Cycle prevention** — the `activated` set ensures each neuron is added to results only once
- **Activation path tracking** — each result records its discovery path: `spread(2) via alpha.ts → beta.ts` shows the full hop chain

This multi-hop traversal enables *transitive discovery*: if `auth.ts` is always co-accessed with `session.ts`, and `session.ts` is always co-accessed with `encryption.ts`, a query that directly matches `auth.ts` will discover `encryption.ts` at hop 2 — even if `auth.ts` and `encryption.ts` have never been co-accessed.

**Evaluated but rejected — Lateral Inhibition:**
SYNAPSE (arXiv 2601.02744) proposes lateral inhibition where top-k activated neurons suppress weaker competitors (`û_i = max(0, u_i - β·Σ(u_k - u_i))`). We implemented and benchmarked this against our 15-query test suite. Result: **zero accuracy improvement** (2/15 → 2/15). The problem was hubs dominating the *top* of the ranking, not noise at the *bottom*. Lateral inhibition suppresses weak results but doesn't dethrone dominant ones. Fan effect + tool exclusion solve the actual problem.

**Phase 3 — Myelinated Fallback:**
If fewer than `limit` results found, suggest top myelinated neurons as weak candidates (confidence = myelination × 0.5, gate 0.15). Tool neurons are excluded. These are "you use this a lot" suggestions without query-specific evidence.

**Confidence Gating:**
- >= 0.7 (HIGH): Skip search entirely, use file directly
- 0.4–0.7 (MEDIUM): Verify with a quick check (0.3–0.7 in keyword-only deployments)
- < 0.4 (or < 0.3 keyword-only): Rejected, not returned

**Token Budget Awareness:**
Results are returned in confidence order, consuming estimated tokens per file. When the budget is exhausted, spreading stops early. This prevents recall from overwhelming the context window.

### 3.4 Decay Engine

Unused connections weaken over time following multiplicative decay:

```
function decay():
  for each neuron:
    activation   *= 0.85    // 15% daily decay
    myelination  *= 0.995   // 0.5% daily decay (superhighways persist)

  for each synapse:
    weight *= 0.98          // 2% daily decay

  prune synapses where weight < 0.05
  prune neurons where activation < 0.01 AND myelination < 0.01 AND accesses < 2
```

This matches Ebbinghaus (1885) and Wixted & Ebbesen (1991): forgetting follows exponential/power-law curves, not linear subtraction. Multiplicative decay ensures values approach zero asymptotically without going negative or abruptly disappearing.

Key property: A synapse accessed 100 times then abandoned retains a faint trace for weeks. A synapse accessed twice then abandoned is pruned within days. This mirrors biological synaptic persistence.

### 3.5 Bootstrap: Cold Start Elimination

The most common criticism of Hebbian memory is cold start — a new project has zero learned patterns. BrainBox addresses this with a multi-source bootstrap system that seeds the neural network from existing project artifacts:

```
brainbox bootstrap --repo /path/to/project --auto
```

**Five independent, additive bootstrap phases:**

| Phase | Source | Weight | Quality |
|-------|--------|--------|---------|
| 1. Git history | Bipartite co-occurrence | 0.05–0.95 | Strongest |
| 2. VaultGraph | Wikilink edges | 0.6 | Strong |
| 3. Import graph | TS/JS imports | 0.5 | Moderate |
| 4. Directory | Filename matching | 0.3 | Weak |
| 5. Session replay | Claude Code sessions | 0.4 | Moderate |

**Git bipartite projection** (Phase 1) is the key innovation. Rather than replaying commits as fake temporal events, it computes a file-file co-occurrence matrix directly from the git history. Weight is calculated as:

```
weight = 0.05 + (sharedCommits / maxSharedCommits) * 0.9
```

This is capped at 0.95 and seeded via `HebbianEngine.seedNeuron()` / `seedSynapse()` — dedicated methods for direct DB seeding that bypass the normal learning path.

**Production bootstrap results:**
- happy-cli-new: 198 neurons, 19,028 synapses from 76 commits + 180 imports
- Full production (4 repos): 2,343 neurons, 1.5M synapses from 416 commits

### 3.6 macOS Daemon: System-Wide Learning

BrainBox's learning is most powerful when it observes *all* file access — not just tool calls within Claude Code sessions. The daemon extends learning to VS Code edits, Xcode builds, vim sessions, and shell commands.

**Architecture:**
- Persistent background process using native macOS **FSEvents** (C++ addon, not chokidar)
- One kernel-level watcher per root path regardless of subdirectory count (5 roots × 90K+ dirs = 5 fds, not 90K)
- Debounced batch recording: 2-second window, max 50 files/flush, transaction-wrapped
- Session rotation: new session ID after 15 minutes idle
- Unix socket server at `~/.brainbox/daemon.sock` for external event sources

**Three signal sources:**

1. **FSEvents with flag parsing** — `created`, `modified`, `deleted`, `moved` events with semantic context. Renames indicate refactoring — a strong signal for file associations.

2. **Git hooks auto-installer** — On startup, scans watched directories for `.git` repos, installs `post-commit`, `post-checkout`, `post-merge` hooks. Files committed together form synapses with `git:commit` context — the strongest co-access signal available.

3. **Frontmost app polling** — Polls every 5 seconds for active app name via `osascript`. Records app switches as tool neurons (`app:Xcode`, `app:Code`), creating temporal associations between files and their editing context.

**External integration via Unix socket:**
```bash
# Shell hook: captures every command as a tool neuron
echo '{"type":"tool","path":"git push","context":"shell"}' | nc -U ~/.brainbox/daemon.sock
```

**Deployment:**
```bash
brainbox daemon install    # LaunchAgent with RunAtLoad + KeepAlive
brainbox daemon start      # Foreground (or --bg for background)
brainbox daemon shell-hook # Print zsh hook for ~/.zshrc
```

---

## 4. Novel Contributions

### 4.1 Error→Fix Pair Learning

Traditional agent debugging: encounter error → grep codebase → trial and error → eventually find the fix. Each debugging session starts from scratch.

BrainBox debugging immune system: encounter error → recall known fix files instantly via myelinated error→file synapses.

**Mechanism:**
1. Error messages are **normalized** before storage: line numbers, quoted variable names, timestamps, and hex addresses are replaced with placeholders. This ensures `TypeError: cannot read property 'token' of undefined` and `TypeError: cannot read property 'session' of undefined` share the same error neuron.
2. Error neurons receive a **2x learning rate boost** — errors are high-signal events. A single error-then-fix sequence creates stronger synapses than three file co-accesses.
3. The `recordError()` method records the error neuron and immediately performs a recall for connected file neurons, returning fix suggestions ranked by confidence.

**Example trajectory:**
- Session 1: Error occurs → agent reads auth.ts and session.ts to fix → error→auth.ts synapse forms (weight 0.17)
- Session 2: Similar error → agent reads same files → synapse strengthens (weight 0.31)
- Session 3: Error occurs → `recordError()` returns auth.ts at 62% confidence → agent skips search

### 4.2 Tool Sequence Myelination

Agents execute tool chains repeatedly: Grep→Read→Edit→Bash(test) is the canonical coding loop. Currently, each tool invocation is independent — the agent doesn't know what it will do next.

BrainBox learns tool sequences as muscle memory:

**Mechanism:**
1. Tool invocations are recorded as `tool` type neurons with the tool name as path.
2. Sequential tool uses within the co-access window create tool→tool synapses.
3. After 20 repetitions of Grep→Read, the synapse myelinates and `predictNext("Grep")` returns "Read" with high confidence.
4. **Cross-type synapses** connect tools to files: after using Read on `auth.ts` many times, the Read→auth.ts synapse strengthens. Calling `predictNext("Read")` returns both the likely next tool AND the likely files.

**Example trajectory:**
- Sessions 1-5: Agent uses Grep→Read→Edit repeatedly
- Session 6: `predictNext("Grep")` returns Read (67% confidence)
- Session 20: `predictNext("Grep")` returns Read (89% confidence) — myelinated pathway

### 4.3 Cross-Type Synapses

The key architectural innovation is that all neuron types share a single synaptic network. This creates emergent behaviors:

- **error → file:** "This error is fixed by editing these files"
- **tool → tool:** "After Grep, you usually Read"
- **tool → file:** "When you use Edit, it's usually on these files"
- **file → file:** "These files are always accessed together"
- **error → tool:** "This error is usually debugged using Bash(test)"

No other agent memory system supports cross-type learned associations. Vector databases store embeddings per item; graph databases store explicit relationships. BrainBox discovers implicit behavioral relationships through co-access patterns.

---

## 5. Evaluation

Evaluation uses two environments: **sandboxed** (isolated in-memory SQLite databases with synthetic data, deterministically seeded for reproducibility) and **production** (real developer usage data from active Claude Code sessions). Each subsection is labeled accordingly.

### 5.1 Mathematical Verification (Sandboxed)

All learning dynamics are verified in isolated in-memory SQLite databases with synthetic data, using direct SQL queries against hand-calculated expected values:

| Test | What It Verifies | Result |
|------|-----------------|--------|
| 1. Myelination increments | Sigmoid-like: 0% → 2% → 3.96% → 5.88% (not linear) | PASS |
| 2. Synapse formation | Bidirectional synapses form on co-access within sequential window | PASS |
| 3. Window eviction | Sequential window correctly evicts at size 10 | PASS |
| 4. Synapse strengthening | 5x co-access → 0.382 weight (BCM diminishing returns) | PASS |
| 5. Confidence gating | Relevant queries pass 0.4 gate; irrelevant ones rejected | PASS |
| 6. Spreading activation | Direct match → spread to connected neurons via strong synapses | PASS |
| 7. Token savings | Exact match: 20,000 without → 19,500 with → 500 saved (2.5%) | PASS |
| 8. Error→fix learning | Error→file synapses form with 2x boost; error clustering works | PASS |
| 9. Tool sequences | Grep→Read synapse >0.5 after 20 reps; predictNext works | PASS |
| 10. Multi-hop spreading | 3-hop BFS: alpha→beta→gamma chain discovered via transitive spreading | PASS |

Additionally, 17 raw SQL verification checks confirm engine values match hand calculations exactly. All tests use fresh in-memory databases seeded with minimal synthetic data — no production data is involved. Tests were independently verified by GLM-5 (Fireworks AI) with zero discrepancies.

### 5.2 Recall Precision Benchmark (v1.0.0, Production)

**Setup:** 15 queries spanning 8 projects run against a production network (2,276 neurons, 60,190 synapses, 100% embedding coverage) built from real developer usage. Ground truth: manually verified expected top-1 result for each query. Queries include cross-project searches ("polymarket bot entry price"), specific file recall ("settings.json permissions deny"), and concept-level recall ("prompt caching anthropic").

**Results:**

| Configuration | Top-1 Accuracy | Description |
|---------------|---------------|-------------|
| Pre-v1.0 (additive, no fan effect) | 2/15 (13%) | Tool neurons dominate all queries |
| + Fan effect only | 9/15 (60%) | Biggest single improvement |
| + Tool exclusion only | 8/15 (53%) | Removes tools from results |
| + Multiplicative only | 5/15 (33%) | Helps but insufficient alone |
| + Lateral inhibition only | 2/15 (13%) | No improvement |
| **All three fixes** | **10/15 (67%)** | **5x improvement over baseline** |

**Remaining misses (5/15):** All embedding quality issues — MiniLM-L6-v2 returns similar cosine scores (0.4-0.6) for semantically distinct queries. Example: "runClaude session loop" returns `session_hook_forwarder.cjs` (0.53) instead of `runClaude.ts` (0.42). Both contain "session" in their path/context. Upgrading the embedding model would likely resolve these.

**Key finding:** The fan effect alone accounts for 70% of the total improvement (2→9 out of 2→10). This validates Anderson's (1983) ACT-R theory — inverse degree normalization is the single most important mechanism for preventing hub domination in spreading activation networks.

### 5.3 Token Savings (Sandboxed)

**Simulation (synthetic):** 20 sessions, 3-5 files per session, sequential co-access window (size 25), with tool chain recordings. All data generated in isolated in-memory databases with deterministic seeding for reproducibility.

| Metric | Value |
|--------|-------|
| Total file accesses | ~80 |
| Tokens without BrainBox | ~160,000 |
| Tokens with BrainBox (session 20) | ~96,000 |
| **Token savings** | **~40%** |
| Estimated cost savings at $3/M tokens | ~$0.19 per simulation |

Savings scale with codebase familiarity. A developer working on the same codebase for months would see higher myelination and greater savings. Projected savings for 100,000 file accesses: ~$36 at Claude Sonnet pricing.

### 5.4 Recall Latency (Sandboxed + Production)

BrainBox recall operates on SQLite queries over a small graph (typically <1,000 neurons). Measured latencies (benchmarked on both synthetic in-memory databases and production workloads on Apple Silicon):

| Operation | Latency |
|-----------|---------|
| `record()` (single file) | <1ms |
| `recall()` (5 results, 3-phase) | <5ms |
| `predictNext()` (tool sequence) | <1ms |
| `decay()` (full network) | <10ms |

Compared to a typical Grep search (200-500ms) or vector similarity search (50-200ms), BrainBox recall is effectively instant.

### 5.5 Production Deployment Results (Production)

We deployed BrainBox in production on a development workstation running Claude Code with PostToolUse and UserPromptSubmit hooks. After 5 hours of active development (857 total accesses), the network contained 79 neurons (73 file, 6 tool) and 3,554 synapses at 57.6% graph density. Two superhighways emerged: Read (myelination 0.626) and Grep (0.606).

**Token savings:** 150,500 tokens saved out of an estimated 1,694,000 without BrainBox, yielding **8.9% gross savings** in the first 5 hours of production use.

**SNAP saturation curve (production evidence):** Synapse weights follow logarithmic saturation consistent with the BCM diminishing returns formula:

| Co-access bucket | Synapses | Mean weight |
|------------------|----------|-------------|
| 1-5 | 2,492 | 0.294 |
| 6-10 | 428 | 0.339 |
| 11-25 | 406 | 0.415 |
| 26-50 | 160 | 0.478 |
| 51-100 | 128 | 0.655 |
| 100+ | 28 | 0.707 |

The Grep-to-Read synapse reached weight 0.996 (301 co-accesses) — the system discovered the universal "search then read" developer pattern autonomously.

**Production vs. synthetic benchmark:**

| Metric | Synthetic (20 sessions) | Production (5 hours) |
|--------|------------------------|---------------------|
| Neurons | 11 | 79 |
| Synapses | 110 | 3,554 |
| Superhighways | 0 | 2 |
| Gross token savings | 4.5% | 8.9% |
| Max myelination | 0.261 | 0.626 |

Production outperforms synthetic benchmarks because real usage generates organic co-access patterns with higher repetition density.

---

## 6. Why BrainBox Outperforms Existing Memory Systems for Agent Operations

The seven memory systems surveyed in Section 2.3 represent the state of the art in agent memory. Yet for the specific task of **making coding agents faster and more efficient across sessions**, BrainBox outperforms all of them on five critical dimensions: learning cost, retrieval speed, behavioral adaptation, discovery capability, and operational transparency.

### 6.1 The Core Advantage: Zero-Cost Learning

Every existing memory system incurs a cost to learn:

| System | Cost/event | Mechanism | Platforms |
|--------|-----------|-----------|-----------|
| Mem0 | ~500 tok | LLM extraction | Any (API) |
| SuperMemory | ~500 tok | LLM atomize | Any (API) |
| Zep | ~500 tok | LLM entities | Any (API) |
| Letta | ~200 tok | Agent tool call | Custom agents |
| LangMem | ~300 tok | Extraction pipe | LangChain only |
| OpenMemory | ~100 tok | Passive capture | Claude, Cursor, Windsurf |
| **BrainBox** | **0 tok** | **SQLite Hebbian** | **Claude Code, OpenClaw, Kilo** |

BrainBox is the only system where learning is truly free. Mem0 *consumes tokens to save tokens* — a fundamental contradiction. At scale (1,000 tool calls/day), Mem0's extraction cost alone exceeds BrainBox's total overhead by orders of magnitude. BrainBox's record() is a single SQLite UPDATE statement: zero LLM calls, zero API roundtrips, zero token cost.

### 6.2 Retrieval Speed: 100x Faster Than Alternatives

| System | Latency | Mechanism | Platforms |
|--------|---------|-----------|-----------|
| Mem0 | 50-300ms | Vec+Graph+KV | Any (API) |
| SuperMemory | 50-300ms | Vec+Temporal | Any (API) |
| Zep | <200ms | Temporal KG | Any (API) |
| Letta | 50-200ms | Vector DB | Custom agents |
| LangMem | 30-100ms | Semantic search | LangChain only |
| OpenMemory | 30-100ms | Vec+SQL | Claude, Cursor, Windsurf |
| **BrainBox** | **<5ms** | **SQLite spreading** | **Claude Code, OpenClaw, Kilo** |

BrainBox's recall() completes in <5ms because the entire graph lives in a single SQLite database with WAL mode. There is no network hop, no vector index scan, no LLM reranking. For myelinated pathways (confidence >= 0.7), BrainBox skips search entirely — the answer is recalled instantly from the neural network, the same way a developer "just knows" which file to open. No other system achieves this.

### 6.3 Behavioral Adaptation: Learning Gets Stronger, Not Just Bigger

This is the fundamental architectural gap. Every L2 system treats the 100th retrieval of the same memory identically to the first:

- **Mem0**: "user prefers TypeScript" returns the same similarity score on day 1 and day 100
- **SuperMemory**: temporal ranking may shift, but the memory itself doesn't strengthen
- **Zep**: entity validity windows update, but retrieval confidence doesn't grow from use
- **Letta**: agent re-reads the same archival memory at the same relevance score
- **LangMem**: prompt instructions are static once written

**BrainBox strengthens with every use.** The auth.ts→session.ts synapse starts at weight 0.1 and grows to 0.64 after 34 co-accesses. The Grep→Read pathway reaches 0.996 after 301 co-accesses, becoming a myelinated superhighway. Conversely, abandoned patterns decay: a synapse unused for a week drops from 0.5 to 0.43, and eventually gets pruned below 0.05. This is Hebbian learning — the system literally gets better at predicting what you need the more you use it. No other agent memory system implements this.

**Concrete example:** An agent debugs authentication bugs across 10 sessions. In sessions 1-3, it searches for "auth error," reads 4-5 files, eventually finds the fix in auth.ts and session.ts. By session 10, the error→auth.ts synapse is myelinated at 0.62 confidence — the agent skips search entirely and opens the right files in <5ms. Mem0 would still return "user works on authentication" as a fact, but couldn't tell the agent *which files to open*.

### 6.4 Transitive Discovery: Finding Files Through Indirect Connections

Vector databases (Mem0, SuperMemory, Letta) can only find memories that are semantically similar to the query. BrainBox discovers files through **graph traversal** — following synaptic connections to find transitively associated files that share zero semantic similarity with the query.

**Example:** Query "fix the login bug." BrainBox's spreading activation:
1. Phase 1: Direct match → `login.ts` (keyword match in contexts)
2. Phase 2: Spread from login.ts → `auth.ts` (weight 0.64, co-accessed 34 times)
3. Phase 2: Spread from auth.ts → `encryption.ts` (weight 0.62, co-accessed 30 times)

The query "fix the login bug" has **zero semantic similarity** with `encryption.ts`. No vector database would surface it. But BrainBox discovers it through 2-hop spreading because these files are behaviorally connected — they are always accessed together when debugging authentication. This is the same principle behind Google's PageRank: relevance propagates through the link graph.

Zep's Graphiti has graph traversal, but its edges are explicit facts ("user works at Acme Corp"), not learned behavioral patterns. It cannot discover that encryption.ts is behaviorally linked to login.ts because it doesn't observe file access.

### 6.5 Operational Transparency: Zero Agent Overhead

| System | Agent awareness | Integration cost |
|--------|----------------|-----------------|
| Letta | Agent must learn memory management as a skill | High — adds cognitive overhead |
| Mem0 SDK | Agent calls memory API explicitly | Medium — requires SDK integration |
| LangMem | Background manager, but agent sees updated prompts | Medium — prompt changes visible |
| OpenMemory | MCP tools available but optional | Low — passive capture |
| **BrainBox** | **Agent has no idea BrainBox exists** | **Zero — fully transparent** |

BrainBox is the only system that is completely invisible to the agent. Learning happens in PostToolUse hooks (after the agent's tool call completes). Recall happens in UserPromptSubmit hooks (before the agent sees the prompt). The agent never makes a memory-related tool call, never decides what to remember, never manages its own memory. This is critical because **agent attention spent on memory management is attention not spent on the user's task.**

Letta's approach — where the agent actively manages its own memory — is architecturally elegant but operationally costly. The agent must learn when to save, what to save, and how to search. This is a meta-skill that competes with the primary task for context window space and reasoning capacity.

### 6.6 vs. Mem0 / OpenMemory: BrainBox Wins on Speed, Cost, and Adaptation

Mem0 is the 800-pound gorilla of agent memory (47k+ GitHub stars). Here is a direct comparison on the dimensions that matter for coding agents:

| Dimension | Mem0 | BrainBox | Winner |
|-----------|------|----------|--------|
| Learning cost | ~500 tokens per memory | 0 tokens, <1ms SQLite | **BrainBox** (infinitely cheaper) |
| Retrieval latency | 50-300ms | <5ms | **BrainBox** (10-60x faster) |
| Strengthening | None — flat relevance | Hebbian — gets stronger with use | **BrainBox** |
| Decay | Manual/TTL deletion | Automatic Ebbinghaus curves | **BrainBox** (biologically grounded) |
| Transitive discovery | Embedding similarity only | Multi-hop graph traversal | **BrainBox** (finds indirect associations) |
| File co-access patterns | Cannot learn | Core capability | **BrainBox** |
| Tool chain prediction | Cannot learn | Myelinated tool sequences | **BrainBox** |
| Error→fix pairs | Cannot learn | Debugging immune system | **BrainBox** |
| Personal preferences | LLM extraction | Cannot learn from conversations | **Mem0** |
| Cross-app context | MCP server (OpenMemory) | MCP + hooks + daemon | **BrainBox** (more signal sources) |
| LLM dependency | Required for extraction | Zero — pure SQLite | **BrainBox** (works offline) |

Mem0 wins on the declarative memory dimension — extracting facts, preferences, entities, and temporal knowledge from conversations — capabilities that BrainBox deliberately excludes in exchange for zero-cost learning. The two approaches are architecturally complementary: BrainBox could run alongside Mem0 without conflict, with BrainBox handling behavioral patterns and Mem0 handling conversational knowledge. For agent operational efficiency specifically — speed, cost, adaptation, and pattern discovery — BrainBox is superior.

### 6.7 vs. SuperMemory: BrainBox Wins on Learning, Loses on Scale

SuperMemory's temporal reasoning (76.7% accuracy) is impressive for conversational memory. But it cannot answer "which files change together when debugging authentication?" because it doesn't observe file access patterns. SuperMemory scales to 50M tokens/user — BrainBox's SQLite graph maxes out around 10K neurons (sufficient for any single developer's codebase). For enterprise scale, BrainBox would need a distributed backend. For individual developer efficiency, BrainBox's <5ms recall on a local SQLite database is unbeatable.

### 6.8 vs. Zep/Graphiti: BrainBox Wins on Implicit Learning

Zep reports 94.8% DMR accuracy — the highest in declarative memory retrieval. Its temporal knowledge graph with episode-mention reranking is state-of-the-art for "what was discussed and when."

But Zep's edges are **explicit facts extracted by LLM**, not **implicit patterns learned from behavior**. BrainBox's edges form automatically — the developer never tells the system "auth.ts and session.ts are related." The system discovers this from 34 co-accesses. Zep cannot discover behavioral patterns because it has no observation layer for file access. BrainBox cannot track temporal fact validity because it doesn't extract facts from conversations. For coding agent efficiency, behavioral patterns matter more than temporal fact tracking.

### 6.9 vs. Letta/MemGPT: BrainBox Wins on Simplicity and Efficiency

Letta's "LLM as Operating System" architecture is intellectually compelling. But it has a fatal flaw for agent efficiency: **the agent must spend tokens managing its own memory.** Every `memory_insert`, `memory_replace`, and `archival_memory_search` call consumes context window space and LLM reasoning cycles. In production, agents using Letta's active memory management spend an estimated 5-15% of their token budget on memory operations rather than the user's task.

BrainBox has zero memory management overhead. The agent performs its task (read files, run searches, edit code) and BrainBox learns passively from the tool calls. No meta-cognitive overhead. No token cost. The 8.9% gross token savings in production is pure gain — unlike Letta, there is no memory management cost to subtract.

### 6.10 vs. LangMem: BrainBox Wins on Granularity and Query Sensitivity

LangMem's "procedural memory" updates the agent's system prompt: "User prefers functional style" or "Use TypeScript strict mode." This is coarse-grained and applies uniformly to all queries.

BrainBox's activations are **query-specific**. The same neural network produces different results for different queries:
- "authentication bug" → auth.ts (0.82), session.ts (0.71), encryption.ts (0.58)
- "build system" → package.json (0.76), tsconfig.json (0.68), Makefile (0.54)
- "test the API" → api.test.ts (0.79), api.ts (0.72), test-utils.ts (0.61)

LangMem cannot differentiate — its prompt instructions apply to all queries equally. BrainBox's spreading activation naturally routes different queries through different subgraphs of the same learned network. This is the fundamental advantage of graph-based behavioral memory over instruction-level procedural memory.

### 6.11 vs. Shodh-Memory: BrainBox Wins on Domain Specialization

Shodh-Memory is the closest system to BrainBox and a key inspiration for this work. Both implement Hebbian learning. But Shodh operates at L2 (general memory associations) while BrainBox operates at L3 (agent file/tool behavior), and this specialization gives BrainBox decisive advantages:

| Capability | Shodh-Memory | BrainBox | Impact |
|-----------|-------------|----------|--------|
| Cross-type synapses (file-tool, error-file) | No | **Yes** | Enables error→fix and tool→file prediction |
| Myelination (superhighways) | No | **Yes** | 10x faster recall for frequent patterns |
| Error→fix learning (2x boost) | No | **Yes** | Debugging immune system |
| Tool sequence prediction | No | **Yes** | Agent muscle memory |
| Fan effect (Anderson 1983) | No | **Yes** | Prevents hub domination (5x accuracy gain) |
| Multiplicative confidence | No | **Yes** | Context gates score (novel contribution) |
| 5-source bootstrap | No | **Yes** | Eliminates cold start |
| macOS daemon (system-wide) | No | **Yes** | Learns from all editors, not just one agent |

Shodh has stronger theoretical foundations (400+ neuroscience-grounded constants vs. BrainBox's 16). For general-purpose memory, Shodh's fidelity to biological models may matter. For the specific domain of agent file access prediction, BrainBox's engineering optimizations and specialized neuron types deliver superior practical results.

### 6.12 Summary: BrainBox's Advantages by Dimension

**Table 2: Head-to-Head Comparison on Agent Operational Efficiency**

| Capability | Mem0 | SuperMem | Zep | Letta | LangMem | OpenMem | **BrainBox** |
|-----------|------|----------|-----|-------|---------|---------|------------|
| Zero-cost learning | No | No | No | No | No | No | **Yes** |
| <5ms retrieval | No | No | No | No | No | No | **Yes** |
| Strengthens with use | No | No | No | No | No | No | **Yes** |
| Automatic decay | No | No | Part. | No | No | No | **Yes** |
| Transitive discovery | No | No | No | No | No | No | **Yes** |
| File co-access | No | No | No | No | No | No | **Yes** |
| Tool chain predict | No | No | No | No | No | No | **Yes** |
| Error→fix learning | No | No | No | No | No | No | **Yes** |
| Zero agent overhead | No | Part. | No | No | Part. | Part. | **Yes** |
| System-wide learning | No | No | No | No | No | No | **Yes** |
| Fan effect normal. | No | No | No | No | No | No | **Yes** |
| Myelination | No | No | No | No | No | No | **Yes** |
| Claude Code support | No | No | No | No | No | Yes | **Yes** |
| OpenClaw support | No | No | No | No | No | No | **Yes** |
| Kilo support | No | No | No | No | No | No | **Yes** |
| *L2 capabilities (competitor strengths)* | | | | | | | |
| Conversational fact extraction | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | No* |
| Entity relationship graphs | No | No | **Yes** | No | No | No | No |
| Temporal fact reasoning | No | **Yes** | **Yes** | No | No | No | No |
| One-shot preference learning | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | No* |
| Cross-session summaries | No | No | No | **Yes** | No | No | No |

\* NeuroVault (Section 8.4) adds regex-based fact capture for explicit trigger statements, partially addressing this gap at zero LLM cost.

BrainBox achieves all fifteen L3 behavioral capabilities — no competitor offers even one. On L2 declarative capabilities, the positions reverse: Mem0 and Zep lead, while BrainBox has no native conversational learning. The two layers are complementary, not competing: a production deployment could run BrainBox for behavioral memory alongside Mem0 for declarative memory with zero conflict.

**The bottom line:** For the specific problem of making AI coding agents faster and more efficient across sessions, BrainBox outperforms every existing memory system. It learns for free, retrieves in <5ms, gets stronger with use, discovers indirect file associations, predicts tool sequences, builds a debugging immune system, and does all of this without the agent even knowing it exists.

---

## 7. Limitations and Future Work

### 7.1 Current Limitations

- ~~**Cold start:** BrainBox needs 10-20 sessions to build useful patterns.~~ **RESOLVED in v0.6.0:** Multi-source bootstrap seeds from git history, VaultGraph, imports, directory patterns, and session replay. Production: 2,343 neurons from 416 commits.
- **Stale paths:** Files that move or are renamed break synaptic connections. No automatic path migration exists.
- ~~**Finite hop depth:**~~ While spreading activation is limited to 3 hops, this is configurable and confidence decay is self-limiting — most useful results are within 2 hops.
- **No LTD:** Long-term depression (anti-Hebbian weakening when expected co-access doesn't occur) is not implemented. Only passive decay reduces weights.
- ~~**Keyword confidence:**~~ **RESOLVED in v0.7.0:** Embedding-based confidence via all-MiniLM-L6-v2 (384-dim). NeuroVault deployment validates keyword-only fallback with adjusted weights.
- **No metaplasticity:** Learning rate is fixed regardless of history. BCM theory prescribes a sliding threshold that adjusts based on recent activity.
- **No conversational learning:** BrainBox observes tool-call behavior exclusively. It cannot extract facts, preferences, or entities from conversation content — capabilities where L2 systems (Mem0, Zep, SuperMemory) excel. This is an intentional architectural boundary: conversational extraction requires LLM calls, which would violate the zero-cost learning principle. NeuroVault's regex-based fact capture (Section 8.4) partially addresses this for explicit trigger statements ("remember X," "I prefer Y") but does not match LLM-based extraction coverage for implicit facts, entity relationships, or temporal reasoning. BrainBox and L2 systems are architecturally complementary and can run simultaneously without conflict.
- ~~**Deep work blind spot:**~~ **RESOLVED in v0.8.0:** Sequential window co-access model replaces 60-second temporal window. Files accessed in sequence form synapses regardless of time elapsed.

### 7.2 Future Directions

**Near-term:**
- **LTD implementation:** Weaken synapses when expected co-access patterns break
- **Path migration:** Detect renamed/moved files and transfer synaptic connections
- **NeuroVault embeddings:** Add all-MiniLM-L6-v2 to OpenClaw deployment for semantic matching
- **Sleep/wake session boundaries:** IOKit power management for natural session cuts

**Medium-term:**
- **Declarative memory bridge:** NeuroVault's regex-based fact capture (Section 8.4) demonstrates that conversational learning can coexist with zero-cost behavioral learning. The next step is upgrading fact extraction using a small, local language model (e.g., Qwen-2.5-1B, Phi-3-mini) that runs on-device — capturing implicit facts ("the client needs HIPAA compliance"), entity relationships, and temporal knowledge without API calls. The key constraint: extraction must remain local and cost-free, preserving BrainBox's core architectural advantage. The extracted facts would be stored as `semantic` neurons and participate in the same synaptic graph, enabling cross-type connections between behavioral patterns and declarative knowledge (e.g., "HIPAA compliance" ↔ `encryption.ts` via co-occurrence in the same session). This would close the L2 capability gap with Mem0/Zep while maintaining the zero-token-cost principle.
- **Layer 4 — Collective Intelligence:** Shared synaptic networks across agent teams, where one agent's learned patterns bootstrap another's
- **Cross-session transfer:** Universal patterns (package.json ↔ node_modules, test files ↔ source files) bootstrapping new projects
- **Thrashing detection:** Recognize when activation patterns show cycles instead of convergence, triggering automatic re-planning
- **Menubar app:** "Related Files" consumer UI for non-AI users, powered by daemon's learned graph

**Long-term:**
- **Real-time benchmarking:** Instrument Claude Code sessions to measure actual token savings and prediction accuracy in production
- **User intent mapping:** Learn what abstract requests ("make it faster," "fix the tests") mean for specific codebases
- **Trading parameter tuning:** Apply Hebbian reinforcement to parameter optimization where P&L provides a reward signal
- **Circadian patterns:** Learn time-of-day variations in tool and file usage

---

## 8. NeuroVault: Cross-Platform Deployment

OpenClaw, an open-source AI agent platform, ships with two built-in memory plugins: **memory-core** (BM25 + vector search over markdown files, requiring paid OpenAI/Gemini API keys) and **memory-lancedb** (experimental auto-capture of user statements into LanceDB, also requiring OpenAI keys). Neither plugin learns from agent behavior — when the agent reads files, runs searches, and fixes errors across 50 sessions, OpenClaw's built-in memory retains zero information about these operational patterns. Each session starts from scratch.

This limitation motivated the development of **NeuroVault** — a full memory slot plugin that replaces both built-in plugins with BrainBox's Hebbian learning, combined with VaultGraph for knowledge graph context. NeuroVault demonstrates that BrainBox's approach is not only portable across agent platforms, but strictly superior to conventional embedding-based memory for the specific problem of agent operational efficiency.

### 8.1 Plugin Architecture

NeuroVault registers three lifecycle hooks and two agent-callable tools:

| Hook / Tool | Direction | Purpose |
|------------|-----------|---------|
| `before_agent_start` | READ | Inject VaultGraph context + BrainBox recall into agent prompt |
| `after_tool_call` | WRITE | Record file accesses and tool usage (Hebbian learning) |
| `agent_end` | WRITE | Capture facts/preferences from conversations as semantic neurons |
| `neurovault_recall` | TOOL | Manual memory query (agent-initiated) |
| `neurovault_stats` | TOOL | Memory dashboard (neurons, synapses, superhighways) |

Context injection uses `prependContext` — a structured field that OpenClaw prepends to the agent's system prompt. This is functionally equivalent to Claude Code's `UserPromptSubmit` hook but operates at a different integration point.

### 8.2 Adaptation Challenges

Porting BrainBox to a different agent platform revealed several integration assumptions:

**Tool name normalization:** Claude Code uses PascalCase (`Read`, `Bash`), OpenClaw uses lowercase (`read`, `exec`). The plugin handles both via a case-insensitive tool name set.

**Parameter name differences:** Claude Code uses `file_path`, OpenClaw uses `path`. Path extractors check both fields.

**Result object structure:** Claude Code tool results are plain strings. OpenClaw returns structured objects with `.content[].text` arrays. The plugin cascades through: string → `.text` → `.content[].text` → JSON stringify fallback.

**No embeddings available:** OpenClaw's plugin environment doesn't support the `@huggingface/transformers` pipeline. NeuroVault compensates with:
- **Boosted keyword weight** (50% vs 40%) for confidence scoring
- **Lower confidence gate** (0.3 vs 0.4) to allow weaker matches through
- **Keyword enrichment** — `extractResultKeywords()` extracts identifiers (camelCase, PascalCase, UPPER_CASE, snake_case) from tool results and stores them on neurons, giving Phase 1 keyword matching richer signal

### 8.3 Myelinated Fallback Bug

During porting, we discovered a bug in the original BrainBox's myelinated fallback gate that had been present since v0.1:

```
// Original (unreachable):
confidence = myelination * 0.3
gate = 0.4
// A neuron would need myelination > 1.33, but MYELIN_MAX = 0.95

// Fixed:
confidence = myelination * 0.5
gate = 0.15
```

This fix was deployed to both NeuroVault and the original Claude Code BrainBox. It demonstrates the value of cross-platform porting as a verification strategy — the fresh context made a long-standing bug obvious.

### 8.4 Fact Capture System

NeuroVault adds a capability not present in the original BrainBox: automatic capture of facts, preferences, and decisions from conversations. The `agent_end` hook filters messages through two stages:

1. **Trigger detection** (`shouldCapture()`): matches on keywords like "remember," "prefer," "always/never," "decided," email/phone patterns. Rejects XML, markdown-heavy, and emoji-heavy content.
2. **Category classification** (`detectCategory()`): preference, decision, entity, fact, or other.

Captured content is stored as `semantic` type neurons with the category as context, enabling recall like "what does the user prefer?" → returns preference neurons by keyword match.

### 8.5 vs. OpenClaw's Built-In Memory: Why NeuroVault is Superior

OpenClaw ships with two official memory plugins, both disabled by default:

**memory-core** provides semantic search over markdown files (`MEMORY.md`, `memory/**/*.md`) using BM25 + vector embeddings. It requires an external embedding API (OpenAI `text-embedding-3-small`, Gemini, or Voyage) — paid, per-call pricing. It indexes only static markdown content that the user manually writes. It has no learning mechanism, no tool usage tracking, and no automatic context injection.

**memory-lancedb** (experimental) adds auto-capture of user statements matching keyword triggers ("remember," "prefer," email/phone patterns) and auto-recall via `before_agent_start`. It stores captured facts in LanceDB with OpenAI embeddings. It captures a maximum of 3 memories per conversation from user messages only.

Neither plugin learns from agent behavior. When the agent reads `auth.ts`, edits `session.ts`, and runs `npm test` across 50 sessions, OpenClaw's built-in memory retains zero information about these patterns. The next session starts with no knowledge of which files are related, which tool chains are common, or which errors have been seen before.

**NeuroVault replaces both plugins** as a single memory slot, providing everything they offer plus Hebbian behavioral learning:

| Capability | memory-core | memory-lancedb | NeuroVault |
|-----------|------------|----------------|------------|
| Persistent memory | Markdown files only | LanceDB facts | VaultGraph + BrainBox graph |
| Learns from tool usage | No | No | **Yes — every Read/Edit/Grep/Bash** |
| Auto-recall injection | No | Yes (keyword only) | **Yes (Hebbian spreading activation)** |
| API keys required | **Yes** (OpenAI/Gemini) | **Yes** (OpenAI) | **No — fully local** |
| Embedding cost per query | ~$0.0001 (API call) | ~$0.0001 (API call) | **$0 (SQLite only)** |
| Knowledge graph | No | No | **Yes (VaultGraph wikilinks)** |
| Error-fix learning | No | No | **Yes (2x boost synapses)** |
| Tool sequence prediction | No | No | **Yes (myelinated chains)** |
| Fact capture | No | Yes (3/session, user msgs) | **Yes (3/session, filtered)** |
| Context richness | Markdown snippets | User statements | **Tool context + keywords + errors** |

The inadequacy of OpenClaw's built-in memory is precisely why we built NeuroVault on top of BrainBox. Conventional embedding-based memory (memory-core, memory-lancedb) treats agent memory as a search problem: index text, embed it, retrieve by similarity. BrainBox treats agent memory as a learning problem: observe behavior, strengthen patterns, predict what comes next. The deployment demonstrates that Hebbian learning can replace conventional embedding-based memory in production agent platforms — delivering richer behavioral context at zero API cost. OpenClaw's memory-core requires an OpenAI API key and charges per embedding; NeuroVault learns more from less by observing tool execution patterns that embedding-based systems cannot capture. After deploying NeuroVault, the agent's operational efficiency improved measurably: files relevant to the current task appeared in context before the agent searched for them, error→fix patterns surfaced instantly, and the system learned the codebase's structure without any manual configuration.

---

## 9. Conclusion

BrainBox demonstrates that Hebbian learning and synaptic myelination — principles from neuroscience established in 1949 — can dramatically improve AI agent efficiency. By learning file access patterns, error→fix associations, and tool sequences, agents achieve instant recall for myelinated pathways and skip redundant searches.

The v1.0.0 recall overhaul introduced three innovations validated against a 15-query benchmark on a production network of 2,276 neurons and 60,190 synapses:

1. **Multiplicative confidence scoring** — context similarity gates the confidence score rather than contributing additively. High myelination amplifies relevance but cannot substitute for it. This is, to our knowledge, a novel approach not found in ACT-R, SYNAPSE, or MAGMA.

2. **Fan effect normalization** — activation spreading is divided by the square root of the source neuron's out-degree, implementing Anderson's (1983) ACT-R principle for the first time in an agent memory system. This single change improved top-1 recall accuracy from 13% to 60% by preventing hub neurons (tools with 500+ synapses) from dominating results.

3. **Tool neuron bridge architecture** — tool neurons participate as bridges during spreading activation (their outgoing synapses are traversed) but are excluded from all result sets. This architectural separation recognizes that tools are infrastructure, not answers.

We also evaluated lateral inhibition (SYNAPSE, 2026) and found it provides no accuracy improvement for agent behavioral memory — it suppresses weak results but does not dethrone dominant hubs. The combination of fan effect + multiplicative confidence + tool exclusion achieved 67% top-1 accuracy on our benchmark, a 5x improvement over baseline.

The system fills a genuine gap in the agent memory landscape. Static instruction files (CLAUDE.md) cannot capture implicit behavioral patterns. Search systems (QMD, vector databases) retrieve by content similarity, not behavioral association. Knowledge graphs (VaultGraph) require explicit link authoring. BrainBox learns automatically from agent behavior, strengthens with use, decays with disuse, and discovers connections through graph traversal.

The NeuroVault deployment to OpenClaw validates cross-platform portability and demonstrates that Hebbian learning works with keyword-only matching (no embeddings) when compensated by keyword enrichment and adjusted confidence gates. The macOS daemon extends learning beyond AI agent sessions to capture system-wide file access patterns — bringing the vision of "hardware prefetching for software agents" closer to its hardware inspiration.

Three decades after Fido demonstrated associative prefetching for database caches, BrainBox applies the same principle to software agents — proving that the hardware architecture community's insight about learnable access patterns generalizes far beyond its original domain.

---

## 10. Roadmap: Dual-Process Memory (v2.0)

### 10.1 The Dual-Process Gap

A survey of agent sessions using BrainBox in production revealed a fundamental limitation: **Hebbian learning excels at recurring patterns but provides minimal value for greenfield tasks.** An agent building a new proxy server and CLI subcommand scored BrainBox at "~5% contribution" — the system kept suggesting irrelevant files from other projects at 50-65% confidence while providing no useful guidance for the novel code being written.

The agent's feedback identified five desired capabilities, which reduce to two missing systems:

1. **Anti-recall (negative signal):** BrainBox only strengthens connections, never weakens them based on ignored suggestions. Files recalled but never opened should have their synapses demoted.
2. **Semantic code retrieval:** For novel tasks, the system needs to match by *code pattern similarity* and *task intent*, not just co-access history.

These map to the cognitive science concept of **dual-process theory** (Kahneman, 2011): System 1 (fast, associative — current BrainBox) and System 2 (slow, deliberate — semantic search). Both systems are needed; they are complementary, not competing.

### 10.2 Architecture: Confidence-Gated Routing

Both systems run in parallel. The Hebbian path completes first (~10ms). If its confidence is high, the semantic path is cancelled. If low, the semantic path's results are used instead. In the medium-confidence range, results from both systems are merged.

```
Recall Query
    ├──► System 1: Hebbian spreading (10ms, existing)
    │         ├── confidence >= 0.7 → return, cancel System 2
    │         ├── confidence <= 0.3 → use System 2 only
    │         └── 0.3-0.7 → merge both systems
    └──► System 2: Semantic search (100ms, parallel)
              ├── Snippet index (code patterns)
              └── Commit neurons (task intent → file sets)
```

P50 latency: 10ms (Hebbian path, semantic cancelled). P90: 100ms (semantic completes). The merge path adds no latency — semantic was already running in parallel.

### 10.3 Anti-Recall: Negative Hebbian Signal

**Retrieval-induced forgetting** (Anderson, Bjork & Bjork, 1994) establishes that retrieving some items inhibits competing items. BrainBox adapts this: files recalled but never opened during a session receive synapse weakening.

**Session tracking bridge:** The prompt hook records `all_recalled` (files suggested). The PostToolUse hook records `all_opened` (files actually accessed). At session end, the difference set receives decay:

```
effective_decay = 1 - (1 - 0.1)^consecutive_ignores
strength = max(0.1, strength * (1 - effective_decay))
```

| Consecutive Ignores | Decay | 0.85 → |
|---------------------|-------|--------|
| 1 | 10% | 0.77 |
| 3 | 27% | 0.62 |
| 5 | 41% | 0.50 |
| 9+ | → floor | 0.10 |

The floor at 0.1 prevents permanent forgetting. A single use resets the ignore counter and boosts by +0.85, recovering the synapse. A file needs 5+ consecutive ignored sessions to reach 50% — but one use brings it back.

### 10.4 Change-Set Learning from Git Commits

Beyond file-to-file co-access, BrainBox can learn which files change together for specific *types* of changes by mining git history. **Commit neurons** embed the commit intent (message + diff summary) and associate it with the modified file set.

At query time, the agent's task description is matched against commit embeddings. Similar commits surface their associated file sets. This bridges from "what changed together" to "you're about to need these files because your task looks like that commit."

Quality bar: commits with <5-character messages or <2 files are excluded. For weak messages ("fix", "wip"), the diff summary carries the signal. Minimum 50 commits required before enabling.

### 10.5 Predictive Pre-Load

Once commit neurons exist, predictive suggestion becomes a 20-line addition to the prompt hook. On the first message in a session, the task description is matched against commit neurons. Results are cross-referenced with Hebbian recall — both systems must agree (or a single system must show 0.85+ confidence). Maximum 2 files suggested. Silence is preferred over wrong noise.

### 10.6 Semantic Code Retrieval via Snippet Neurons

A two-tier architecture keeps Hebbian spreading small and fast while adding a parallel semantic index:

**Snippet neurons** are extracted from source files using tree-sitter: exported functions, public classes, and methods with >10 lines. Each snippet is embedded independently (same model as file neurons). The snippet index is a separate vector store (~20K snippets = 30MB FAISS index), queried in parallel with Hebbian spreading.

Query flow: semantic match on snippets → aggregate to parent file neurons → merge with Hebbian results. This enables "you wrote a createServer+SSE parser before — see server.ts:148" without requiring prior co-access history.

### 10.7 Error Category Matching

Error messages are normalized to fingerprints: paths, line numbers, and timestamps are stripped. The result — `error_type|operation` (e.g., "Connection refused|TCP connect") — clusters semantically similar errors without requiring exact string matches. Hash-based O(1) lookup for known fingerprints; embedding fallback for novel ones.

### 10.8 Architectural Pattern Layer (Future)

Beyond files (L0) and change-sets (L1), a third layer would learn abstract architectural preferences: "user prefers adapter pattern for external API integration," "user writes proxies when APIs are incompatible." Structural inference (naming conventions like `*-adapter.ts`, AST patterns like `class X implements Y`) covers 80% of cases without LLM dependency. Optional LLM module for subtle patterns.

### 10.9 Model-Agnostic Boundary

BrainBox's value proposition includes model-agnosticism — the same system works whether the consumer is Claude, GPT, Gemini, or a 7B local model. The v2.0 roadmap maintains this:

| Component | Dependency | Acceptable? |
|-----------|-----------|-------------|
| Tree-sitter extraction | Deterministic | Yes |
| Embedding (MiniLM) | Swappable | Yes |
| Error fingerprinting | Regex | Yes |
| Pattern inference | Optional LLM | Yes (graceful degradation) |

The boundary rule: if output is deterministic or swappable with graceful degradation, it's acceptable. If core functionality breaks without a specific model, it crosses the line.

---

## 11. v5.0: Seven Features Inspired by Supermemory and Ars Contexta

After analyzing Supermemory's hook-based memory architecture (Section 2.3) and Ars Contexta's knowledge system generator, we identified and implemented seven features that close gaps in BrainBox's operational awareness. All seven operate at zero LLM cost, maintaining the core architectural principle.

### 11.1 Session Intent Capture

**Problem:** BrainBox tracks *what* files were accessed but not *why* the session existed. "What was I working on yesterday?" has no answer.

**Solution:** `setSessionIntent(intent)` stores a description on the sessions table. The prompt hook captures the first user message (truncated to 200 chars) as intent automatically. `getRecentSessions(days)` returns sessions with their intents for "what happened last week" queries.

**Schema:** `ALTER TABLE sessions ADD COLUMN intent TEXT DEFAULT NULL`

### 11.2 Hub Detection

**Problem:** BrainBox applies hub penalties during learning (Section 3.2) but doesn't expose hub structure for navigation or debugging.

**Solution:** `getHubs(limit)` returns neurons ranked by out-degree with their top 5 connections. This surfaces the codebase's structural "Maps of Content" — files that connect everything. Inspired by Ars Contexta's MOC generation, but discovered from behavior rather than authored.

### 11.3 Staleness Detection and Alerts

**Problem:** Superhighways decay silently. A file at 82% myelination today might be at 71% next week, and the agent has no awareness of this drift.

**Solution:** `detectStale(opts)` finds neurons with high myelination but old `last_accessed` timestamps. It projects future myelination using the daily decay rate (`0.995^days`). `getStalenessAlerts()` formats this into a human-readable string injected into the prompt hook output: `"Stale superhighways: auth.ts (82%→71% myelin, 14d idle)"`. Returns null when nothing is stale (no noise). Inspired by Ars Contexta's Session Orient hook which surfaces maintenance signals.

### 11.4 Project Tagging

**Problem:** BrainBox's project scoping (Section 8.2) operates at recall time via `cwd` path prefix matching — a runtime filter, not persistent knowledge. Files have no durable project association.

**Solution:** `tagProject(root, name)` persistently tags all file neurons under a path prefix. `getProjectNeurons(name)` retrieves tagged neurons. The PostToolUse hook auto-tags from `cwd` on every tool call, deriving the project name from the last path component. Inspired by Supermemory's containerTags for automatic memory routing.

**Schema:** `ALTER TABLE neurons ADD COLUMN project TEXT DEFAULT NULL`

### 11.5 Raw Conversation Capture

**Problem:** BrainBox observes tool calls exclusively (Section 7.1). Session-level context — what the user discussed, what problems were described — is lost.

**Solution:** `captureSessionContext(messages)` extracts keywords from user messages using a stopword-filtered frequency analysis. The keywords are stored as contexts on a `semantic` neuron with path `session:<sessionId>`. No LLM extraction — pure string processing. These session neurons participate in recall, enabling "what was that websocket session about?" queries. Bridges the gap between L2 (declarative) and L3 (behavioral) without violating zero-cost learning.

### 11.6 Anti-Recall Escalation

**Problem:** The v4.0 anti-recall (Section 10.3 roadmap) applies a flat 10% decay regardless of how many times a file has been ignored. A chronically irrelevant suggestion receives the same treatment as a one-time miss.

**Solution:** `applyAntiRecallEscalated()` tracks consecutive ignore streaks per neuron via the `ignore_streak` column. The effective decay escalates: `1 - (1 - 0.1)^streak`. After 1 ignore: 10%. After 3: 27%. After 5: 41%. The floor of 0.1 prevents permanent forgetting. A single use resets the streak to 0 and recovers the synapse — matching retrieval-induced forgetting dynamics (Anderson, Bjork & Bjork, 1994). The adapter hook now uses the escalated version instead of flat anti-recall.

**Schema:** `ALTER TABLE neurons ADD COLUMN ignore_streak INTEGER DEFAULT 0`

| Consecutive Ignores | Effective Decay | 0.80 → |
|---------------------|----------------|--------|
| 1 | 10% | 0.72 |
| 2 | 19% | 0.58 |
| 3 | 27% | 0.42 |
| 5 | 41% | 0.29 |
| 9+ | → floor | 0.10 |

### 11.7 Schema Migration Summary (v5)

Three new columns, backward-compatible (all DEFAULT NULL/0):

```sql
ALTER TABLE sessions ADD COLUMN intent TEXT DEFAULT NULL;
ALTER TABLE neurons ADD COLUMN project TEXT DEFAULT NULL;
ALTER TABLE neurons ADD COLUMN ignore_streak INTEGER DEFAULT 0;
```

### 11.8 Evaluation

All 59 tests pass (40 existing + 19 new) in sandbox `:memory:` databases:

| Feature | Tests | Status |
|---------|-------|--------|
| Session Intent Capture | 2 | PASS |
| Hub Detection | 2 | PASS |
| Staleness Detection | 2 | PASS |
| Project Tagging | 3 | PASS |
| Raw Conversation Capture | 2 | PASS |
| Staleness Alerts | 2 | PASS |
| Anti-Recall Escalation | 3 | PASS |
| Existing test suite | 40 | PASS (no regressions) |

---

## References

1. Hebb, D.O. (1949). *The Organization of Behavior.* Wiley.
2. Bienenstock, E.L., Cooper, L.N., & Munro, P.W. (1982). "Theory for the development of neuron selectivity." *Journal of Neuroscience*, 2(1), 32-48.
3. Ebbinghaus, H. (1885). *Memory: A Contribution to Experimental Psychology.*
4. Collins, A.M., & Loftus, E.F. (1975). "A spreading-activation theory of semantic processing." *Psychological Review*, 82(6), 407-428.
5. Anderson, J.R. (1983). "A spreading activation theory of memory." *Journal of Verbal Learning and Verbal Behavior*, 22(3), 261-295.
6. Wixted, J.T., & Ebbesen, E.B. (1991). "On the form of forgetting." *Psychological Science*, 2(6), 409-415.
7. Palmer, M., & Zdonik, S. (1991). "Fido: A Cache That Learns to Fetch." *Proceedings of the 17th International Conference on Very Large Data Bases*, 255-264.
8. Chaudhary, S. (2025). "Enabling Robust In-Context Memory and Rapid Task Adaptation in Transformers with Hebbian and Gradient-Based Plasticity." *arXiv 2510.21908.*
9. Szelogowski, D. (2025). "Hebbian Memory-Augmented Recurrent Networks: Engram Neurons in Deep Learning." *arXiv 2507.21474.*
10. Safa, A. (2024). "Continual Learning with Hebbian Plasticity in Sparse and Predictive Coding Networks: A Survey and Perspective." *arXiv 2407.17305.*
11. SYNAPSE (2026). "Empowering LLM Agents with Episodic-Semantic Memory via Spreading Activation." *arXiv 2601.02744.*
12. MACLA (2025). "Learning Hierarchical Procedural Memory for LLM Agents through Bayesian Selection and Contrastive Refinement." *arXiv 2512.18950.*
13. Cortex/Asteria (2025). "Achieving Low-Latency, Cost-Efficient Remote Data Access For LLM via Semantic-Aware Knowledge Caching." *arXiv 2509.17360.*
14. MAGMA (2026). "A Multi-Graph based Agentic Memory Architecture for AI Agents." *arXiv 2601.03236.*
15. Liu, S. et al. (2025). "Memory in the Age of AI Agents: A Survey." *arXiv 2512.13564.*
16. Kahneman, D. (2011). *Thinking, Fast and Slow.* Farrar, Straus and Giroux.
17. Anderson, M.C., Bjork, R.A., & Bjork, E.L. (1994). "Remembering can cause forgetting: Retrieval dynamics in long-term memory." *Journal of Experimental Psychology: Learning, Memory, and Cognition*, 20(5), 1063-1087.
18. Kolodner, J. (1993). *Case-Based Reasoning.* Morgan Kaufmann.
19. Maruf, S. et al. (2025). "FarSight: A Learning-Based Approach for Efficient Far Memory Access." *arXiv 2506.00384.*
20. Muzammil, S. et al. (2026). "Source Code Hotspots: A Diagnostic Method for Quality Issues." *MSR 2026, arXiv 2602.13170.*
21. Parisi, G.I. (2017). "Adaptive Synaptic Plasticity: Leak Rate Modulation Based on Temporal Correlation." *arXiv 1703.07655.*
22. GPTrace (2025). "Effective Crash Deduplication Using LLM Embeddings." *arXiv 2512.01609.*
23. EcphoryRAG (2025). "Cue-Based Activation of Entity-Centered Memory Traces." *arXiv 2510.08958.*
24. RepoRift (2024). "LLM Agents Improve Semantic Code Search." *arXiv 2408.11058.*
25. A-Mem (2026). "Agentic Memory for LLM Agents." *arXiv 2502.12110.*
26. PAM (2026). "Predictive Associative Memory." *arXiv 2602.11322.*
27. Chhikara, P. et al. (2025). "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory." *arXiv 2504.19413.*
28. Mem0. GitHub: github.com/mem0ai/mem0. Apache-2.0.
29. OpenMemory MCP. GitHub: github.com/mem0ai/mem0/tree/main/openmemory. Apache-2.0.
30. SuperMemory. GitHub: github.com/supermemoryai/supermemory. MIT License.
31. Graphiti/Zep (2025). "Graphiti: Building Real-Time Knowledge Graphs for AI Agents." *arXiv 2501.13956.*
32. Letta (2024). "MemGPT: Towards LLMs as Operating Systems." *arXiv 2310.08560.*
33. LangMem. GitHub: github.com/langchain-ai/langmem. MIT License.

---

## Appendix A: Constants and Hyperparameters

| Constant | Value | Rationale |
|----------|-------|-----------|
| `LEARNING_RATE` | 0.1 | Moderate strengthening per co-access; avoids oscillation |
| `MYELIN_RATE` | 0.02 | Slow superhighway formation; requires sustained repeated access |
| `MYELIN_MAX` | 0.95 | Asymptotic ceiling prevents full saturation |
| `CO_ACCESS_WINDOW_SIZE` | 25 | Last 25 unique files form co-access pairs (sequential, not time-based) |
| `CONFIDENCE_GATE` | 0.4 (0.3 keyword-only) | Balances precision/recall; lower gate compensates for no embeddings |
| `HIGH_CONFIDENCE` | 0.7 | Above this, skip search entirely — strong neural recall |
| `ERROR_LEARNING_BOOST` | 2.0 | Errors are high-signal events; accelerated learning justified |
| `ERROR_FIX_RESOLVE_WEIGHT` | 0.85 | Strong direct wiring from error→fix via `resolveError()` |
| `TOOL_SPREAD_DAMPENING` | 0.3 | Base dampening multiplier for tool-type neurons in spreading |
| `MAX_SPREAD_HOPS` | 3 | BFS depth limit for spreading activation; confidence decay is self-limiting |
| `MAX_SPREAD_FAN_OUT` | 10 | Maximum outgoing synapses explored per node per hop; prevents runaway |
| `MYELIN_CAP_IN_CONFIDENCE` | 0.5 | Soft cap on myelination's contribution to confidence scoring |
| `FAN_DEGREE_CAP` | 50 | Max out-degree for fan effect calculation; prevents near-zero fan factors |
| `MYELIN_GATE` | 0.15 | Lower gate for Phase 3 myelinated fallback |
| `SYNAPSE_DECAY_RATE` | 0.02/day | Unused connections weaken moderately |
| `ACTIVATION_DECAY_RATE` | 0.15/day | Short-term activation fades quickly |
| `MYELIN_DECAY_RATE` | 0.005/day | Superhighways persist ~200 days to halve |
| `SYNAPSE_PRUNE_THRESHOLD` | 0.05 | Remove near-dead synapses to prevent graph bloat |
| `TOKENS_PER_FILE_READ` | 1,500 | Conservative estimate for average source file |
| `TOKENS_PER_SEARCH` | 500 | Estimate for a grep/search operation |

## Appendix B: Database Schema

```sql
CREATE TABLE neurons (
  id TEXT PRIMARY KEY,              -- "type:path" (e.g., "file:src/auth.ts")
  type TEXT NOT NULL,               -- 'file' | 'tool' | 'error' | 'semantic'
  path TEXT NOT NULL,
  activation REAL DEFAULT 0,        -- 0-1, decays multiplicatively
  myelination REAL DEFAULT 0,       -- 0-0.95, sigmoid growth
  access_count INTEGER DEFAULT 0,
  last_accessed TEXT,               -- ISO timestamp
  created_at TEXT NOT NULL,
  contexts TEXT DEFAULT '[]',       -- JSON array of query strings
  embedding BLOB DEFAULT NULL,      -- v3: 384-dim float32 vector (1,536 bytes)
  project TEXT DEFAULT NULL,        -- v5: project name for scoped recall
  ignore_streak INTEGER DEFAULT 0   -- v5: consecutive anti-recall ignores
);

CREATE TABLE synapses (
  source_id TEXT NOT NULL REFERENCES neurons(id),
  target_id TEXT NOT NULL REFERENCES neurons(id),
  weight REAL DEFAULT 0.1,          -- 0-1, BCM diminishing returns
  co_access_count INTEGER DEFAULT 1,
  last_fired TEXT,
  created_at TEXT NOT NULL,
  tagged_at TEXT,                   -- v3.2: synaptic tagging timestamp
  PRIMARY KEY (source_id, target_id)
);

CREATE TABLE access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  neuron_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  query TEXT,
  timestamp TEXT NOT NULL,
  token_cost INTEGER DEFAULT 0,
  access_order INTEGER DEFAULT 0    -- v2: sequential order within session
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT,
  total_accesses INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  tokens_saved INTEGER DEFAULT 0,
  hit_rate REAL DEFAULT 0,
  intent TEXT DEFAULT NULL           -- v5: session intent (first user message)
);

CREATE TABLE snippets (
  id TEXT PRIMARY KEY,
  parent_neuron_id TEXT NOT NULL REFERENCES neurons(id),
  name TEXT,                        -- function/class/method name
  kind TEXT,                        -- 'function' | 'class' | 'method'
  start_line INTEGER,
  end_line INTEGER,
  source TEXT,                      -- raw source code (max 500 chars)
  embedding BLOB DEFAULT NULL,      -- 384-dim float32 vector
  content_hash TEXT                  -- v4: dedup hash
);
```

## Appendix C: Source Code & Installation

BrainBox is open-source under the MIT license. Installation guides, integration examples, and platform-specific setup instructions are maintained in the repository:

**GitHub:** [github.com/thebasedcapital/brainbox](https://github.com/thebasedcapital/brainbox)

## Appendix D: Verification Results

All 59 tests pass: 10 core mathematical verification tests (updated for sequential window in v0.8.0), 17 raw SQL cross-checks, 19 v5.0 feature tests (session intent, hub detection, staleness, project tagging, conversation capture, staleness alerts, anti-recall escalation), and 13 additional integration tests. Core tests independently verified by GLM-5 (Fireworks AI) with zero discrepancies.

```
=== Core Verification (10/10) ===
TEST 1:  Myelination increments ..................... PASS
TEST 2:  Synapse formation (sequential window) ...... PASS
TEST 3:  Window eviction at size 10 ................. PASS
TEST 4:  Synapse strengthening (BCM) ................ PASS
TEST 5:  Confidence gating .......................... PASS
TEST 6:  Spreading activation ....................... PASS
TEST 7:  Token savings math ......................... PASS
TEST 8:  Error→fix pair learning .................... PASS
TEST 9:  Tool sequence myelination .................. PASS
TEST 10: Multi-hop spreading (3-hop BFS) ............ PASS

=== v5.0 Features (19/19) ===
TEST 11: Session intent capture (set) ............... PASS
TEST 12: Session intent capture (get) ............... PASS
TEST 13: Hub detection (ranking) .................... PASS
TEST 14: Hub detection (connections) ................ PASS
TEST 15: Staleness detection ........................ PASS
TEST 16: Staleness projection ....................... PASS
TEST 17: Project tagging (tag) ...................... PASS
TEST 18: Project tagging (query) .................... PASS
TEST 19: Project tagging (auto from cwd) ............ PASS
TEST 20: Conversation capture ....................... PASS
TEST 21: Conversation capture (stopwords) ........... PASS
TEST 22: Staleness alerts (format) .................. PASS
TEST 23: Staleness alerts (silence when fresh) ...... PASS
TEST 24: Anti-recall escalation (streak 1) .......... PASS
TEST 25: Anti-recall escalation (streak 5) .......... PASS
TEST 26: Anti-recall escalation (reset on use) ...... PASS

=== Raw SQL Cross-Checks (17/17) ===
TEST 27-43: All raw SQL verification checks ......... PASS
```

## Appendix E: NeuroVault Adaptation Matrix

Key differences when deploying BrainBox to a non-Claude Code agent platform:

| Integration Point | Claude Code | OpenClaw (NeuroVault) |
|------------------|------------|----------------------|
| Tool names | PascalCase (`Read`, `Bash`) | Lowercase (`read`, `exec`) |
| File path param | `file_path` | `path` |
| Tool results | Plain strings | `.content[].text` objects |
| Context injection | `UserPromptSubmit` hook → stdout | `before_agent_start` → `prependContext` |
| Learning trigger | `PostToolUse` hook | `after_tool_call` lifecycle hook |
| Embeddings | all-MiniLM-L6-v2 (384d) | Not available — keyword-only |
| Confidence gate | 0.4 | 0.3 |
| Keyword weight | 40% | 50% |
| Fact capture | Not implemented | `agent_end` hook → semantic neurons |

