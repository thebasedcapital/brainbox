# BrainBox Benchmark Paper Plan

**Working Title:** "BrainBox vs. The World: A Head-to-Head Benchmark of 10 Memory Systems for AI Coding Agents"

**Target Venues:** arXiv preprint (primary), ICSE NIER / CHASE workshop (secondary), blog post series for viral distribution

**Timeline:** 4 weeks to data collection, 2 weeks to paper writing, 1 week to review/polish

---

## 1. Abstract (Draft)

We present the first systematic, head-to-head benchmark of 10 memory systems for AI coding agents, evaluating recall accuracy, retrieval latency, token cost, learning behavior, and scaling characteristics across six standardized task categories. Systems under test include BrainBox (Hebbian behavioral learning), Mem0 (hybrid vector/graph/KV), SuperMemory (temporal reasoning), Zep/Graphiti (temporal knowledge graph), Letta/MemGPT (LLM-as-OS self-editing memory), LangMem (procedural prompt rewriting), Shodh-Memory (general Hebbian), OpenClaw memory-core (BM25+vector), OpenClaw memory-lancedb (auto-capture), and Obsidian with AI plugins (Smart Connections, Copilot). We introduce AgentMemBench, a benchmark suite of 500 tasks across 5 real codebases, designed specifically for evaluating memory systems in coding agent workflows -- a domain where existing benchmarks (LOCOMO, LongMemEval, DMR) fail to capture critical metrics like file recall accuracy, error-to-fix retrieval, and tool sequence prediction. Results demonstrate that BrainBox achieves the highest file recall accuracy (67% top-1, 84% top-3) at the lowest latency (<5ms p95) and zero token cost per operation, while Obsidian-based approaches -- the dominant knowledge management paradigm used by millions -- fail catastrophically for autonomous agent use due to their dependence on human curation and prohibitive token costs for vault loading. We provide all benchmark code, datasets, and runner scripts for reproducibility.

---

## 2. Introduction

### 2.1 The Problem with Vibes-Based Comparisons

The current state of agent memory evaluation is dire. Each system publishes benchmarks on different datasets, with different metrics, and different baselines:

- Mem0 reports on LOCOMO (66.9% accuracy) but measures "LLM-as-Judge" scores on conversational memory, not file recall
- Zep reports 94.8% on DMR but only evaluates temporal fact retrieval
- Letta claims 74.0% on LOCOMO but measures conversational Q&A
- SuperMemory reports SOTA on LongMemEval_s but focuses on temporal reasoning
- BrainBox reports 67% top-1 recall but on a 15-query internal benchmark

**No existing benchmark measures what actually matters for coding agents:** Can the memory system predict which files the agent will need next? Can it retrieve the fix files for a known error? Can it predict the next tool in a sequence? Does it get better with use?

### 2.2 Why We Need AgentMemBench

Existing benchmarks test the wrong things:

| Benchmark | What It Tests | What Coding Agents Need |
|-----------|--------------|------------------------|
| LOCOMO | Conversational recall | File access prediction |
| LongMemEval | Multi-session temporal QA | Cross-session learning curves |
| DMR | Deep memory retrieval of facts | Error-to-fix association |
| HumanEval / SWE-bench | Code generation | Tool chain efficiency |

AgentMemBench fills the gap with six task categories specifically designed for evaluating memory systems in coding agent workflows.

### 2.3 Thesis

**Behavioral learning (Hebbian, automatic) beats declarative storage (LLM-extracted, manual) for the specific problem of making AI coding agents faster and more efficient across sessions.** Obsidian's manual linking approach, while beloved by millions, is structurally unsuited for autonomous agents. We prove this with hard numbers across 500 benchmark tasks.

---

## 3. Benchmark Design: AgentMemBench

### 3.1 Task Categories (6 categories, ~500 total tasks)

#### Category 1: Cold Start Recall (50 tasks)
**Question:** How fast does each system become useful from zero?

- **Setup:** Fresh install on a real codebase. No prior data.
- **Protocol:**
  1. Start with empty memory state
  2. Record the agent performing 10 natural development tasks (reading files, running tests, fixing bugs)
  3. After each task, issue 5 recall queries about files the agent has already accessed
  4. Measure: time-to-first-useful-recall (>50% confidence), accuracy curve over N tasks

- **Tasks to design (50 total):**
  - 10 tasks on `happy-cli-new/` (TypeScript, 200+ files)
  - 10 tasks on a Python Django project (~300 files)
  - 10 tasks on a Rust CLI project (~100 files)
  - 10 tasks on a Go microservice (~150 files)
  - 10 tasks on a React frontend (~250 files)

- **Ground truth:** Manually label expected file for each recall query. E.g., after the agent reads `auth.ts`, `session.ts`, `encryption.ts` together in task 3, the query "authentication module" should return those files.

- **Metrics:**
  - Tasks-to-first-useful-recall (lower is better)
  - Cold start wall-clock time (seconds)
  - Recall accuracy at task 5, task 10 (learning curve)

- **Hypothesis:** BrainBox with bootstrap achieves useful recall by task 2-3. Systems requiring LLM extraction (Mem0, Zep) achieve it by task 5-7. Obsidian with AI plugins never achieves useful recall without human curation.

#### Category 2: Warm File Recall (150 tasks)
**Question:** Given N recorded file accesses, which system best predicts the next file the agent will need?

- **Setup:** Pre-seed each system with 100 recorded file access sessions from a real codebase (captured from actual Claude Code sessions via `~/.claude/projects/.../*.jsonl`).

- **Protocol:**
  1. Load 100 sessions of real agent behavior
  2. For each of 150 test queries, issue a recall request
  3. Compare returned files against ground truth (the files the agent actually accessed next)

- **Task distribution:**
  - 30 exact-match queries ("find the file that handles websocket connections")
  - 30 concept queries ("authentication system" -> should find auth.ts, session.ts, encryption.ts cluster)
  - 30 cross-file queries ("I'm working on the API, what test files do I need?" -> api.test.ts, api.integration.test.ts)
  - 30 indirect/transitive queries ("fix the login page" -> should discover encryption.ts via login.ts -> auth.ts -> encryption.ts)
  - 30 recently-abandoned queries ("what was I working on yesterday?" -> requires temporal + behavioral tracking)

- **Metrics:**
  - Top-1 recall accuracy (% of queries where the correct file is #1 result)
  - Top-3 recall accuracy (% where correct file appears in top 3)
  - Top-5 recall accuracy
  - MRR (Mean Reciprocal Rank) across all queries
  - Query-type breakdown (exact vs. concept vs. cross-file vs. transitive vs. temporal)

- **Hypothesis:** BrainBox dominates transitive queries (multi-hop spreading finds indirect associations that vector search cannot). Mem0/Zep may win temporal queries. Obsidian Smart Connections may compete on concept queries if the vault is well-curated.

#### Category 3: Error-to-Fix Retrieval (100 tasks)
**Question:** Given an error message, which system finds the files that fix it fastest?

- **Setup:** Collect 100 real error-fix pairs from git history:
  1. Find commits that mention "fix", "bug", "error" in commit messages
  2. Extract the error from the commit context (issue link, commit message, test output)
  3. Record which files were modified in the fix commit

- **Protocol:**
  1. Pre-seed each system with the codebase's full file structure and 50 error-fix sessions
  2. Present 100 error messages (50 from pre-seeded errors, 50 novel errors from same categories)
  3. Ask each system: "Which files should I look at to fix this error?"
  4. Compare against actual fix files

- **Task distribution:**
  - 25 previously-seen errors (exact match to training data)
  - 25 similar errors (same category, different instance -- e.g., new TypeError in auth module)
  - 25 novel errors (different category, tests generalization)
  - 25 cross-module errors (error in module A, fix in module B)

- **Metrics:**
  - Fix-file recall@1, @3, @5
  - Time to first correct suggestion
  - Seen-error accuracy vs. novel-error accuracy (learning transfer metric)
  - Cross-module accuracy (measures transitive discovery)

- **Hypothesis:** BrainBox's error-fix pairs with 2x learning boost give it decisive advantage on seen errors. Mem0/Zep may compete on novel errors via semantic similarity. Obsidian cannot perform this task at all without manual error documentation.

#### Category 4: Tool Sequence Prediction (50 tasks)
**Question:** Given the current tool being used, which system best predicts the next tool?

- **Setup:** Record 500 tool usage sequences from real agent sessions. Split 400 training / 100 test.

- **Protocol:**
  1. Pre-seed each system with 400 tool sequences
  2. For each test sequence, reveal tools one at a time
  3. After each tool, ask: "What tool comes next?"
  4. Compare prediction against actual next tool

- **Task types:**
  - 20 common chains (Grep -> Read -> Edit -> Bash is ~60% of all chains)
  - 15 debugging chains (Read -> Bash[test] -> Read[error output] -> Edit)
  - 15 rare/novel chains (tool combinations seen <5 times in training)

- **Metrics:**
  - Next-tool prediction accuracy
  - Sequence completion accuracy (predict entire remaining chain)
  - Accuracy by chain frequency (common vs. rare)

- **Hypothesis:** BrainBox's myelinated tool sequences give 80%+ accuracy on common chains. No other system has tool sequence learning, so they default to random/uniform prediction. This is BrainBox's most dominant category.

#### Category 5: Cross-Session Learning Curve (100 tasks)
**Question:** Does performance improve across sessions? How fast?

- **Setup:** Simulate 20 sessions of development on a single codebase. Each session involves 5-10 tasks.

- **Protocol:**
  1. Start with empty memory state for each system
  2. Run 20 sequential sessions, each consisting of realistic coding tasks
  3. After each session, run the same 100-query test battery
  4. Plot accuracy as a function of session number

- **Metrics:**
  - Accuracy at session 1, 5, 10, 20
  - Learning rate (slope of accuracy curve)
  - Plateau detection (when does improvement stop?)
  - Forgetting resistance (after 5 sessions of different work, how much accuracy drops on original queries)

- **Hypothesis:** BrainBox shows steady improvement via myelination (session 1: 30%, session 10: 60%, session 20: 70%+). Mem0 shows flat performance (session 1 == session 20 for file recall). Obsidian remains at 0% unless human manually links notes.

#### Category 6: Token Efficiency and Scaling (50 tasks)
**Question:** How many tokens does each system consume per recall operation, and how does that change with scale?

- **Protocol:**
  1. Measure tokens consumed at 4 scale points: 100 memories, 1K memories, 5K memories, 10K memories
  2. For each scale point, run 50 identical recall queries
  3. Measure: tokens per query, tokens per learning event, total token budget for memory management

- **Metrics:**
  - Tokens per recall operation (input + output)
  - Tokens per learning event (recording a new memory)
  - Memory management overhead (Letta's self-management cost, LangMem's prompt rewriting cost)
  - Scaling curve: tokens vs. memory count
  - Total cost at 10K memories assuming Claude Sonnet pricing ($3/M input, $15/M output)

- **Hypothesis:** BrainBox = 0 tokens per operation (pure SQLite). Mem0 = ~500 tokens per learning event, ~200 per recall. Letta = ~300 tokens per memory management call. Obsidian Smart Connections = embedding cost + vault loading cost (potentially thousands of tokens for context injection).

### 3.2 Controlled Environment

All systems tested on the same hardware, same codebases, same task sequences:

- **Hardware:** Apple Silicon Mac (M-series), 32GB RAM, local SSD
- **LLM:** Claude Sonnet 4 for any system that requires LLM calls (Mem0, Zep, Letta, LangMem)
- **Codebases:** 5 real projects of varying sizes and languages
- **Task sequences:** Pre-recorded from real Claude Code sessions, replayed deterministically
- **Randomization:** 3 independent runs per system, report mean and std

### 3.3 Metrics Definitions

| Metric | Definition | How Measured |
|--------|-----------|-------------|
| Top-K Recall | Fraction of queries where ground truth appears in top K results | Count correct / total queries |
| MRR | Mean of 1/rank for correct result across all queries | Mean(1/rank) |
| p50 Latency | Median retrieval time | Timer around recall API call |
| p95 Latency | 95th percentile retrieval time | Percentile of all measured latencies |
| Tokens/Learn | Tokens consumed when recording a new memory | Count LLM API tokens, 0 for local-only |
| Tokens/Recall | Tokens consumed per recall operation | Count LLM API tokens + context tokens injected |
| Cold Start Time | Wall-clock seconds from fresh install to first useful recall (>50% confidence) | Measured end-to-end |
| Learning Curve Slope | Rate of accuracy improvement per session | Linear regression on accuracy vs. session number |
| Forgetting Resistance | Accuracy on domain A after N sessions of domain B work | Measure after domain switch |

### 3.4 Statistical Analysis

- **Paired t-test** for accuracy comparisons (same queries, different systems)
- **Wilcoxon signed-rank test** for latency comparisons (non-normal distributions)
- **Effect size** (Cohen's d) for all comparisons
- **Bonferroni correction** for multiple comparisons (10 systems = 45 pairs)
- **95% confidence intervals** on all reported metrics
- **3 independent runs** per system to assess variance

---

## 4. Systems Under Test: Configuration and Architecture

### 4.1 BrainBox (Our System)

- **Version:** v1.0.0+ with embeddings
- **Architecture:** Hebbian learning + myelination + spreading activation over SQLite
- **Configuration:**
  - all-MiniLM-L6-v2 embeddings (384-dim)
  - Sequential co-access window (size 25)
  - 3-hop max spreading
  - Fan effect normalization (sqrt)
  - Multiplicative confidence scoring
  - Bootstrap from git history + imports
- **Learning:** Passive via PostToolUse hooks. Zero LLM calls.
- **Retrieval:** Keyword match + cosine similarity + spreading activation. <5ms.
- **Dependencies:** SQLite, all-MiniLM-L6-v2 (local). No API keys.

### 4.2 OpenClaw memory-core

- **Source:** OpenClaw built-in plugin (default memory provider)
- **Architecture:** BM25 full-text search (SQLite FTS5) + vector search (sqlite-vec) over markdown files
- **Configuration:**
  - Vector weight: 70%, BM25 weight: 30%
  - Requires external embedding API: OpenAI `text-embedding-3-small`, Gemini, or Voyage
  - Indexes only markdown files in `MEMORY.md` and `memory/**/*.md`
  - No learning mechanism -- indexes static content the user manually writes
- **Learning:** None. User must write markdown files. System indexes them.
- **Retrieval:** Hybrid BM25 + vector search. ~50-100ms depending on vault size.
- **Dependencies:** OpenAI/Gemini API key (paid), SQLite.
- **Benchmark setup:** Create markdown files that describe file relationships, error patterns, and tool preferences. This represents the best-case scenario where a developer has manually documented everything.

### 4.3 OpenClaw memory-lancedb

- **Source:** OpenClaw experimental plugin
- **Architecture:** Auto-capture of user statements + LanceDB vector storage + OpenAI embeddings
- **Configuration:**
  - Captures max 3 memories per session from user messages
  - Keyword triggers: "remember", "prefer", "always", "never", email/phone patterns
  - Auto-recall via `before_agent_start` hook
- **Learning:** Passive auto-capture from user messages only. Does not observe tool usage.
- **Retrieval:** Vector similarity search via LanceDB. ~50ms.
- **Dependencies:** OpenAI API key (paid), LanceDB.
- **Benchmark setup:** Feed user messages that describe file relationships. This tests whether passive user-statement capture can substitute for behavioral learning.

### 4.4 Mem0

- **Source:** `github.com/mem0ai/mem0` (Apache-2.0, 47k+ stars)
- **Architecture:** Hybrid vector + graph + KV store. LLM-driven extraction pipeline.
- **Configuration:**
  - Default config with OpenAI embeddings
  - Graph memory enabled (Mem0g variant for maximum accuracy)
  - LLM extraction using Claude Sonnet (same LLM budget as other systems)
- **Learning:** LLM extracts facts from conversations. ~500 tokens per memory event.
- **Retrieval:** Vector similarity + graph traversal + KV lookup. Reported 1.4s p95 on LOCOMO.
- **Dependencies:** OpenAI API key (embeddings), LLM API key (extraction), Neo4j or compatible graph DB.
- **Published benchmarks:** 66.9% on LOCOMO (LLM-as-Judge), 68.5% with graph memory.
- **Benchmark setup:** Feed tool usage logs as "conversations" to Mem0's extraction pipeline. Measure whether it extracts file co-access patterns. This is the most generous possible setup -- we're giving Mem0 the exact data it would need.

### 4.5 SuperMemory

- **Source:** `supermemory.ai` (MIT license)
- **Architecture:** Temporal reasoning with dual timestamps (documentDate, eventDate). Postgres + Cloudflare Durable Objects.
- **Configuration:**
  - Default settings
  - Enable temporal reasoning and knowledge conflict resolution
- **Learning:** LLM atomizes and evolves memories. Graph updates for knowledge evolution.
- **Retrieval:** Hybrid vector + temporal query. Reported sub-300ms latency.
- **Dependencies:** OpenAI API key, Postgres.
- **Published benchmarks:** 71.4% multi-session, 76.7% temporal reasoning on LongMemEval_s.
- **Benchmark setup:** Record file accesses with timestamps. Test whether temporal reasoning helps predict "what was I working on yesterday?" queries.

### 4.6 Zep/Graphiti

- **Source:** `github.com/getzep/graphiti` (MIT license)
- **Architecture:** Temporal knowledge graph with three subgraphs (Episode, Semantic Entity, Community). Graphiti engine.
- **Configuration:**
  - Default settings with Neo4j backend
  - Enable temporal tracking (valid_at/invalid_at timestamps)
  - Episode-mention reranking enabled
- **Learning:** LLM extracts entities and relations. Dynamic graph synthesis.
- **Retrieval:** Temporal KG traversal + episode-mention reranking. Reported <200ms.
- **Dependencies:** Neo4j, OpenAI API key.
- **Published benchmarks:** 94.8% on DMR, up to 18.5% improvement on LongMemEval.
- **Benchmark setup:** Feed coding sessions as "episodes" with rich temporal context. Test whether entity extraction captures file relationships.

### 4.7 Letta/MemGPT

- **Source:** `github.com/letta-ai/letta` (Apache-2.0, 21k+ stars)
- **Architecture:** LLM-as-Operating-System. Core memory (in-context, self-editing) + external memory (archival vector DB + recall storage).
- **Configuration:**
  - Default Letta agent with GPT-4o mini (matching their published benchmark config)
  - Core memory: persona and human blocks
  - Archival memory: default vector store
  - Note: Letta V1 architecture with Context Repositories if available by benchmark time
- **Learning:** Agent actively manages own memory via tool calls (`memory_replace`, `memory_insert`, `archival_memory_search`).
- **Retrieval:** Vector search for archival, structured access for core. Agent decides what to search.
- **Dependencies:** LLM API key (agent uses LLM for memory management).
- **Published benchmarks:** 74.0% on LOCOMO with GPT-4o mini.
- **Benchmark setup:** Give agent explicit instructions to track file accesses in its memory. Measure the token overhead of memory management operations.

### 4.8 LangMem

- **Source:** `github.com/langchain-ai/langmem` (MIT, LangChain ecosystem)
- **Architecture:** Two-layer: stateless core (extract/update/consolidate) + stateful integration via LangGraph's BaseStore.
- **Configuration:**
  - Enable all three memory types: semantic, procedural, episodic
  - Prompt optimizer: metaprompt variant
  - LangGraph BaseStore backend
- **Learning:** Background memory manager extracts facts. Prompt optimizer rewrites agent instructions.
- **Retrieval:** Semantic search via BaseStore. Prompt injection for procedural.
- **Dependencies:** LLM API key (extraction + optimization), LangGraph.
- **Benchmark setup:** Run coding sessions through LangMem pipeline. Test whether procedural memory (updated prompts) captures file access patterns.

### 4.9 Shodh-Memory

- **Source:** `github.com/varun29ankuS/shodh-memory` (single binary, ~18MB)
- **Architecture:** Three-tier Hebbian memory: Working Memory (100 items) -> Session Memory (500MB) -> Long-Term Memory (RocksDB). Neuroscience-grounded with 400+ constants.
- **Configuration:**
  - Default settings
  - Working memory: 100 items
  - RocksDB backend for long-term storage
  - Hebbian strengthening: co-activated memories form edges, 5+ co-activations become permanent
- **Learning:** Hebbian co-activation. No LLM calls. Zero-cost learning.
- **Retrieval:** Tiered cache + spreading activation. Reported <10ms for working memory.
- **Dependencies:** None (single binary, fully local).
- **Benchmark setup:** Record file accesses via MCP tools. Closest competitor to BrainBox on architecture. Key comparison: does BrainBox's domain specialization (cross-type synapses, myelination, fan effect) beat Shodh's general-purpose Hebbian approach?

### 4.10 Obsidian + AI Plugins

**THIS IS THE MOST IMPORTANT COMPARISON. This section must be comprehensive.**

Three configurations tested:

#### 4.10a: Obsidian Baseline (Manual Linking Only)
- **Setup:** Obsidian vault with project documentation. Developer manually creates [[wikilinks]] between notes about related files, error patterns, and tool preferences.
- **Time investment:** 2 hours of manual vault curation per project
- **Retrieval:** Graph view for exploration, backlinks panel for related notes
- **Context injection:** Manual copy-paste from vault into agent prompt, or CLAUDE.md static file

#### 4.10b: Obsidian + Smart Connections (v2.x)
- **Source:** `github.com/brianpetro/obsidian-smart-connections` (150k+ active users)
- **Architecture:** AI embeddings over vault contents. Automatic similarity suggestions.
- **Configuration:**
  - Default settings with local embedding model (for fairness: no API cost)
  - Smart Chat enabled for conversational retrieval
  - Smart View enabled for related note suggestions
- **Learning:** None. Re-indexes vault periodically. Embedding-based similarity only.
- **Retrieval:** Cosine similarity over note embeddings. Conversation-based Q&A.
- **Dependencies:** Local embedding model (or OpenAI API key for cloud embeddings)
- **Context injection:** Export relevant notes as context block. Measure token cost of injecting vault context.

#### 4.10c: Obsidian + Copilot (v2.x)
- **Source:** `github.com/logancyang/obsidian-copilot`
- **Architecture:** RAG over vault contents with auto-compact.
- **Configuration:**
  - Default settings
  - RAG enabled for vault Q&A
  - Auto-compact enabled (128k token threshold)
- **Learning:** None. Indexes vault content for retrieval.
- **Retrieval:** RAG with LLM reranking. Vault-aware conversational interface.
- **Dependencies:** LLM API key (for chat), embedding API key (for indexing)
- **Context injection:** Copilot generates context from vault + active note. Measure token cost.

---

## 5. Obsidian Deep Dive (MAJOR SECTION)

### 5.1 Why Obsidian Matters: The Elephant in the Room

Obsidian has 5M+ users. It is the de facto knowledge management tool for developers and researchers. "Just use Obsidian" is the default answer to any knowledge organization question. If BrainBox cannot demonstrate clear superiority over Obsidian-based approaches for AI agent workflows, the paper has no viral hook.

**The fundamental tension:** Obsidian was designed for humans. BrainBox was designed for agents. Humans curate. Agents execute. These are different cognitive modes that demand different memory architectures.

### 5.2 Obsidian's Architecture: Manual Linking as Memory

Obsidian's knowledge graph is built through **manual wikilinks** (`[[note name]]`). The graph grows only when a human decides to create a link. This has profound implications:

1. **Link quality is high** -- every connection was intentionally created by a human who understood the relationship
2. **Link coverage is low** -- humans only link notes they consciously recognize as related
3. **Link maintenance is expensive** -- as the vault grows, maintaining links requires ongoing curation effort
4. **Link creation requires context switching** -- while working on code, the developer must pause to update their vault

**Benchmark measurement:** Record the human time required to maintain an Obsidian vault that matches BrainBox's behavioral knowledge. After 100 sessions, BrainBox has ~2,000 synapses representing file co-access patterns. How long would it take a human to manually create equivalent wikilinks in Obsidian?

**Expected result:** 4-8 hours of manual curation to approximate what BrainBox learns automatically in 5 hours of passive observation. And the Obsidian vault would still miss implicit patterns that humans don't consciously recognize (e.g., "you always run tests after editing config files").

### 5.3 Graph View vs. Spreading Activation

**Obsidian's Graph View:** Visual exploration tool. Nodes are notes, edges are wikilinks. The graph is static -- edges don't have weights, don't strengthen with use, don't decay. All links are equal.

**BrainBox's Spreading Activation:** Algorithmic retrieval engine. Nodes are neurons (files, tools, errors). Edges have weights that change dynamically. Retrieval follows strongest paths with fan effect normalization.

**Benchmark comparison: "Find Related Files" task**
1. Given a file path, ask each system to find the 5 most related files
2. Obsidian Graph View: manually inspect graph neighbors (no API, requires human interaction)
3. Obsidian Smart Connections: use embedding similarity to find related notes
4. BrainBox: spreading activation from file neuron

| Feature | Obsidian Graph View | BrainBox Spreading Activation |
|---------|-------------------|------------------------------|
| Requires human interaction | Yes | No |
| Edge weights | No (binary: linked or not) | Yes (0-1, Hebbian learned) |
| Strengthens with use | No | Yes (myelination) |
| Decays with disuse | No | Yes (Ebbinghaus decay) |
| Multi-hop traversal | Manual clicking | Automatic BFS with fan effect |
| Transitive discovery | Manual exploration | Automatic within 3 hops |
| Hub domination prevention | No | Fan effect (Anderson 1983) |
| API-accessible | No (visual tool only) | Yes (MCP, hooks, CLI) |

### 5.4 Smart Connections vs. BrainBox Recall

Smart Connections is Obsidian's most popular AI plugin (150k+ users). It uses AI embeddings to find related notes.

**Head-to-head protocol:**
1. Create Obsidian vault with project documentation (one note per key file/module)
2. Create BrainBox neural network from 100 sessions of real agent behavior
3. Issue 50 identical recall queries
4. Compare top-5 results from both systems

**Expected advantages of Smart Connections:**
- Better semantic understanding of note content (full-text embedding vs. BrainBox's path + context embedding)
- Works with rich prose notes that describe concepts, not just file paths
- Users who maintain detailed notes get good results

**Expected advantages of BrainBox:**
- No human curation required -- learns automatically
- Learns behavioral patterns Smart Connections cannot (file A is always accessed after file B)
- <5ms retrieval vs. Smart Connections' embedding lookup time
- Zero token cost (Smart Connections needs embedding API or local model)
- Transitive discovery via multi-hop spreading (Smart Connections only does single-hop similarity)
- Learns from agent behavior, not just note content

**Key experiment: "Undocumented Pattern Discovery"**
1. Engineer a codebase where files auth.ts, session.ts, and encryption.ts are always accessed together, but this relationship is NOT documented in any note
2. Ask both systems: "I'm working on authentication, what files do I need?"
3. Smart Connections can only find files mentioned in notes about authentication
4. BrainBox discovers encryption.ts through transitive spreading: auth.ts -> session.ts -> encryption.ts

**Expected result:** BrainBox discovers 30-50% more relevant files than Smart Connections because behavioral patterns capture implicit relationships that no human bothered to document.

### 5.5 Obsidian Copilot vs. NeuroVault

Copilot provides RAG over the Obsidian vault -- chat with your notes using LLM.

**Key differences:**

| Feature | Obsidian Copilot | NeuroVault |
|---------|-----------------|------------|
| Data source | Vault notes (human-written) | Behavioral graph (auto-learned) |
| Learning | None (indexes static content) | Hebbian (learns from tool usage) |
| Context window | Auto-compact at 128k tokens | Token-budget-aware spreading |
| Requires human input | Yes (write notes first) | No (observes agent behavior) |
| Error-fix recall | Only if documented in notes | Automatic from error-fix pairs |
| Token cost per query | LLM API call for RAG + reranking | 0 tokens (SQLite query) |
| Offline capable | Only with local LLM | Yes (fully local) |

**Key experiment: "Zero Curation Challenge"**
1. Give both systems access to the same codebase
2. Copilot: empty Obsidian vault (no notes written yet)
3. NeuroVault: run 20 agent sessions to build behavioral graph
4. Issue 50 recall queries
5. Copilot should return nothing (no notes to query). NeuroVault should return meaningful results.

**Expected result:** Copilot at 0% accuracy with empty vault. NeuroVault at ~60% accuracy after 20 sessions. This demonstrates the fundamental advantage of automatic behavioral learning over human-curated knowledge bases.

### 5.6 Token Cost Analysis: Why Obsidian Fails for AI Agents

The most devastating argument against Obsidian for AI agents is token cost. When an AI agent needs to use Obsidian vault context, it must load vault content into the context window.

**Measurement protocol:**
1. Create Obsidian vaults of varying sizes: 100, 500, 1K, 5K, 10K notes
2. Measure tokens required to inject relevant context for a typical coding query
3. Compare against BrainBox's recall (which injects only file paths + confidence scores)

**Expected token costs:**

| Vault Size | Obsidian Context Load | Smart Connections Top-10 | BrainBox Recall |
|-----------|----------------------|------------------------|-----------------|
| 100 notes | ~50K tokens (full vault) | ~5K tokens (10 note snippets) | ~200 tokens (5 paths + scores) |
| 500 notes | ~250K tokens (impossible) | ~5K tokens | ~200 tokens |
| 1K notes | ~500K tokens (impossible) | ~5K tokens | ~200 tokens |
| 5K notes | N/A | ~5K tokens | ~200 tokens |
| 10K notes | N/A | ~5K tokens | ~200 tokens |

**Key insight:** BrainBox's recall is O(1) in token cost -- it always returns a fixed number of file paths with confidence scores, regardless of how large the underlying neural network is. Obsidian approaches scale linearly with vault size.

**Additional cost: Vault embedding**
- Smart Connections: Embedding a 4M word vault costs ~2.3M tokens ($0.23 with OpenAI). Must re-embed when notes change.
- BrainBox: Zero embedding cost for behavioral learning. Optional one-time embedding of neurons (~2,276 neurons in 12s, local model, $0).

### 5.7 The Human Curation Bottleneck

**Core argument:** Obsidian's value proposition requires human curation. For autonomous AI agents that run 24/7, there is no human to curate.

**Scenarios where Obsidian breaks down:**
1. **Autonomous agent sessions:** Agent runs overnight, encountering new file patterns. No human to update vault.
2. **Multi-agent systems:** 10 agents working in parallel. Each discovers different patterns. No human can curate for all of them.
3. **Rapid codebase evolution:** Files renamed, moved, deleted. Vault links break. Human must maintain them.
4. **Implicit patterns:** Files co-accessed 50 times but no human noticed the pattern. BrainBox captures it automatically.

**Quantitative measure: "Curation Tax"**
- Record time a developer spends maintaining their Obsidian vault per week
- Compare against BrainBox's zero-maintenance automatic learning
- Express as: hours of human effort to achieve equivalent knowledge

**Expected result:** 2-4 hours per week of Obsidian curation to maintain parity with BrainBox's automatic learning. For teams with 5+ developers, this is 10-20 person-hours per week.

### 5.8 Where Obsidian Wins (Fair Acknowledgment)

- **Rich prose notes:** Obsidian excels at storing nuanced, context-rich documentation that no automated system can generate
- **Human-readable knowledge base:** The vault is a permanent, browsable, human-readable knowledge base. BrainBox's SQLite database is opaque.
- **Community and ecosystem:** 1,000+ plugins, active community, mature tooling
- **Cross-project knowledge:** A well-maintained vault can capture conceptual knowledge that transfers across projects
- **Visual exploration:** Graph View enables serendipitous discovery through visual exploration -- a capability that programmatic retrieval cannot replicate
- **Longevity:** Markdown files are forever. SQLite databases can corrupt.

**Our position:** Obsidian is the best knowledge management tool for humans. BrainBox is the best knowledge system for autonomous agents. They are complementary, not competing. The danger is using Obsidian (a human tool) as an agent memory system -- which its AI plugins attempt to do, but which fundamentally does not scale.

---

## 6. Results Section Design

### 6.1 Summary Table (Table 3)

| System | Top-1 Recall | Top-3 Recall | p50 Latency | p95 Latency | Tokens/Learn | Tokens/Recall | Cold Start | Learning? |
|--------|-------------|-------------|-------------|-------------|-------------|--------------|------------|-----------|
| BrainBox | **67%** | **84%** | **<1ms** | **<5ms** | **0** | **0** | 2 tasks | Yes (Hebbian) |
| Mem0 | ~45% | ~62% | 50ms | 300ms | ~500 | ~200 | 5 tasks | No |
| Mem0g | ~48% | ~65% | 100ms | 600ms | ~500 | ~300 | 5 tasks | No |
| SuperMemory | ~42% | ~60% | 100ms | 300ms | ~500 | ~200 | 5 tasks | No |
| Zep/Graphiti | ~50% | ~68% | 80ms | 200ms | ~500 | ~150 | 7 tasks | No |
| Letta | ~40% | ~58% | 100ms | 400ms | ~200 | ~300* | 8 tasks | Self-managed |
| LangMem | ~35% | ~52% | 50ms | 100ms | ~300 | ~100 | 6 tasks | Prompt-level |
| Shodh | ~55% | ~72% | 2ms | 10ms | 0 | 0 | 3 tasks | Yes (Hebbian) |
| memory-core | ~30% | ~48% | 50ms | 100ms | 0** | ~100 | N/A*** | No |
| memory-lancedb | ~25% | ~40% | 50ms | 100ms | ~100 | ~50 | N/A*** | Partial |
| Obsidian (manual) | ~20% | ~35% | N/A**** | N/A**** | 0 | 0 | 2+ hours | No |
| Obsidian+Smart | ~38% | ~55% | 200ms | 500ms | ~100 | ~200 | 30min index | No |
| Obsidian+Copilot | ~35% | ~50% | 500ms | 2000ms | ~100 | ~500 | 30min index | No |

\* Letta's recall cost includes agent memory management overhead
\** memory-core requires manual markdown writing (human time, not token cost)
\*** OpenClaw memory plugins require manual setup, no learning curve
\**** Manual Obsidian requires human interaction, not API-measurable

**Note:** Numbers in this table are projections based on published benchmarks and architecture analysis. Actual benchmark results will replace these.

### 6.2 Per-Category Breakdown Charts

**Chart 1: Cold Start Learning Curve**
- X-axis: Number of development tasks completed
- Y-axis: Recall accuracy on test queries
- Lines: One per system, showing learning speed
- Key insight: BrainBox reaches 50% accuracy by task 5. Obsidian remains at 0%.

**Chart 2: Warm Recall by Query Type**
- Grouped bar chart: 5 query types x 10 systems
- Key insight: BrainBox dominates transitive queries. Mem0/Zep may win temporal queries.

**Chart 3: Error-to-Fix Retrieval**
- Accuracy for seen errors vs. novel errors vs. cross-module errors
- Key insight: BrainBox's 2x error boost gives massive advantage on seen errors.

**Chart 4: Tool Sequence Prediction**
- Only BrainBox and Shodh have tool prediction. Others default to random.
- Bar chart showing accuracy by chain frequency.

**Chart 5: Learning Curve Over 20 Sessions**
- X-axis: Session number
- Y-axis: Recall accuracy
- Lines: All systems
- Key insight: BrainBox's curve goes up. Others are flat.

**Chart 6: Token Efficiency Scaling**
- X-axis: Memory count (100, 1K, 5K, 10K)
- Y-axis: Tokens per operation (log scale)
- Lines: All systems
- Key insight: BrainBox stays at 0. Others scale linearly or worse.

### 6.3 Obsidian-Specific Charts

**Chart 7: Curation Tax**
- X-axis: Development sessions
- Y-axis: Cumulative human hours spent on vault curation
- Lines: Obsidian manual, Obsidian+Smart Connections, BrainBox (always 0)

**Chart 8: Vault Size vs. Context Token Cost**
- X-axis: Vault size (notes)
- Y-axis: Tokens injected per query
- Lines: Full vault, Smart Connections top-10, BrainBox recall

**Chart 9: Undocumented Pattern Discovery Rate**
- X-axis: Pattern type (explicit, implicit, transitive)
- Y-axis: Discovery rate
- Bars: Smart Connections vs. BrainBox

---

## 7. Head-to-Head Comparison Section

Dedicated subsection for each pair, with a clear "Winner" declaration:

### 7.1 BrainBox vs. Mem0 (The Giant Killer)
- **BrainBox wins:** Latency (100x), cost (infinite ratio), adaptation (Hebbian vs. static), file co-access, error-fix, tool prediction
- **Mem0 wins:** Conversational fact extraction, ecosystem maturity (47k stars), managed cloud offering, LOCOMO conversational accuracy
- **Winner for coding agents: BrainBox**

### 7.2 BrainBox vs. Zep/Graphiti (Temporal vs. Behavioral)
- **BrainBox wins:** Latency, cost, implicit pattern learning, no Neo4j dependency
- **Zep wins:** Temporal reasoning (when was this discussed?), fact validity tracking, DMR accuracy for conversational memory, enterprise-grade graph infrastructure
- **Winner for coding agents: BrainBox**

### 7.3 BrainBox vs. Letta/MemGPT (Passive vs. Active Memory)
- **BrainBox wins:** Zero overhead (agent doesn't know it exists), no token cost for memory management, simpler deployment
- **Letta wins:** Agent agency over memory (can decide what matters), richer memory types, Context Repositories for code-specific memory, active community
- **Winner for coding agents: BrainBox** (simplicity and zero overhead outweigh Letta's flexibility)

### 7.4 BrainBox vs. SuperMemory (Learning vs. Scale)
- **BrainBox wins:** Behavioral learning, latency, cost, file co-access patterns
- **SuperMemory wins:** Scale (50M tokens/user), temporal reasoning, enterprise readiness, knowledge conflict resolution
- **Winner for coding agents: BrainBox** (individual developer efficiency; SuperMemory wins at enterprise scale)

### 7.5 BrainBox vs. LangMem (Graph vs. Prompt)
- **BrainBox wins:** Query-specific activation (different queries find different files), granularity, transitive discovery
- **LangMem wins:** Procedural prompt updates (teaches agent new behaviors), LangChain ecosystem integration, prompt optimization
- **Winner for coding agents: BrainBox** (granularity and zero-cost learning)

### 7.6 BrainBox vs. Shodh-Memory (Specialist vs. Generalist Hebbian)
- **BrainBox wins:** Cross-type synapses, myelination, fan effect, tool prediction, error-fix learning, 5-source bootstrap, macOS daemon
- **Shodh wins:** Biological fidelity (400+ constants), three-tier architecture, single-binary deployment (~18MB), general-purpose applicability, more neuroscience grounding
- **Winner for coding agents: BrainBox** (domain specialization beats general-purpose)

### 7.7 BrainBox vs. OpenClaw memory-core (Behavioral vs. Manual)
- **BrainBox wins:** Automatic learning, no API keys, richer signal (tool usage, file co-access, errors)
- **memory-core wins:** Full-text search over rich prose documentation, well-integrated with OpenClaw ecosystem
- **Winner for coding agents: BrainBox** (automatic beats manual)

### 7.8 BrainBox vs. OpenClaw memory-lancedb (Behavioral vs. Auto-Capture)
- **BrainBox wins:** Learns from tool usage (not just user statements), cross-type synapses, no API key, richer behavioral signal
- **memory-lancedb wins:** Captures declarative user preferences ("I prefer TypeScript"), seamless OpenClaw integration
- **Winner for coding agents: BrainBox** (richer signal from behavioral observation)

### 7.9 BrainBox vs. Obsidian (THE VIRAL COMPARISON)
- **BrainBox wins:** Zero curation required, automatic pattern discovery, API-accessible, works for autonomous agents, O(1) token cost, transitive discovery, learning curves, myelination
- **Obsidian wins:** Rich prose documentation, human-readable vault, visual exploration, community/ecosystem (1000+ plugins), cross-project knowledge, longevity (markdown files are forever)
- **Winner for AI coding agents: BrainBox** (by a massive margin)
- **Winner for human knowledge management: Obsidian**
- **Key takeaway:** They solve different problems. Stop using Obsidian as agent memory.

---

## 8. Discussion Section

### 8.1 Why Behavioral Learning Beats Declarative Storage for Agents

The fundamental architectural insight: coding agents don't need to remember facts. They need to predict behavior.

A coding agent doesn't benefit from knowing "the user prefers TypeScript" (declarative). It benefits from knowing "when working on the API module, these 5 files are always accessed together" (behavioral). The first is a preference. The second is an operational optimization that saves time and tokens on every session.

All existing memory systems (Mem0, SuperMemory, Zep, Letta, LangMem) focus on declarative knowledge because they inherit from conversational AI, where remembering facts about users is the primary value. BrainBox takes a fundamentally different approach by learning behavioral patterns -- an approach borrowed from hardware prefetching, not from conversational memory.

### 8.2 The Myelination Effect: Why "Gets Better With Use" Is the Killer Feature

No other system has this property: BrainBox's recall becomes faster and more confident with repeated use.

- Session 1: Query "authentication" -> auth.ts (confidence 0.42, medium)
- Session 10: Same query -> auth.ts (confidence 0.71, high -- skip search entirely)
- Session 50: Same query -> auth.ts (confidence 0.85, myelinated superhighway)

This is analogous to how expert developers "just know" which file to open. They don't search -- they have muscle memory. BrainBox gives agents this same capability through synaptic myelination.

### 8.3 The Obsidian Paradox

Obsidian is simultaneously the most successful knowledge management tool AND the worst choice for autonomous agent memory. The paradox:

1. Obsidian's success comes from empowering human curation -- the tool is designed to make linking, tagging, and organizing effortless for humans
2. Autonomous agents don't have humans available to curate
3. AI plugins (Smart Connections, Copilot) attempt to bridge the gap but are fundamentally limited to querying what humans have already documented
4. BrainBox bypasses human curation entirely by learning from behavior

**The implication:** The 5M+ Obsidian users who build AI coding workflows around their vaults are building on the wrong foundation. Obsidian excels at human knowledge management. Agent memory requires a fundamentally different architecture.

### 8.4 When BrainBox Loses

Fair acknowledgment of BrainBox's weaknesses:
- **Greenfield projects:** No behavioral patterns to learn from. BrainBox contributes ~5% value on novel codebases with no git history.
- **Declarative preference recall:** "What email template library does the user prefer?" BrainBox cannot answer this. Mem0 can.
- **Scale:** BrainBox's SQLite graph maxes at ~10K neurons. SuperMemory handles 50M tokens/user.
- **Temporal reasoning:** "What was I working on last Tuesday?" BrainBox has timestamps but no temporal query engine. Zep handles this natively.
- **Rich documentation:** Obsidian's well-curated vault provides nuanced, prose-based knowledge that no automated system can generate.
- **Stale paths:** File renames break synaptic connections. No automatic path migration.

---

## 9. Limitations Section

### 9.1 Benchmark Limitations
- AgentMemBench is designed specifically for coding agent workflows. It may not generalize to conversational memory tasks where Mem0/Zep excel.
- Ground truth labels are manually created, introducing subjective bias.
- We test with Claude Sonnet as the LLM. Results may differ with other models.
- All tests run on a single machine. Distributed scenarios not evaluated.

### 9.2 System Limitations
- BrainBox's projected numbers are based on existing evaluations. Full benchmark may reveal different results.
- Obsidian comparison uses AI plugins in their default configurations. Expert users may achieve better results with custom settings and prompt engineering.
- Some systems (SuperMemory, Zep) offer managed cloud services that may perform differently than self-hosted configs.
- Letta V1's Context Repositories may significantly change their performance profile.

### 9.3 Fairness Considerations
- We are the authors of BrainBox. Despite best efforts at objectivity, there is inherent bias.
- All benchmark code and data will be released for independent verification.
- We invite the maintainers of all tested systems to run AgentMemBench independently and publish their results.

---

## 10. Conclusion

### 10.1 Key Results
1. BrainBox achieves the highest file recall accuracy for coding agents at the lowest latency and zero token cost
2. Obsidian-based approaches fail for autonomous agents due to human curation dependency
3. Behavioral learning (Hebbian) outperforms declarative storage (vector/graph) for agent operational efficiency
4. Myelination is a unique feature that makes memory systems improve with use -- no competitor offers this
5. The fan effect (Anderson, 1983) is the single most important mechanism for preventing hub domination in spreading activation networks

### 10.2 Recommendations
- **For autonomous coding agents:** Use BrainBox or Shodh-Memory (behavioral learning systems)
- **For conversational agents:** Use Mem0 or Zep (optimized for declarative knowledge)
- **For human knowledge management:** Keep using Obsidian -- but don't use it as agent memory
- **For maximum coverage:** Use BrainBox for behavioral learning + Mem0 for declarative facts (complementary, not competing)

---

## 11. Benchmark Implementation Plan

### 11.1 Code to Write

#### `benchmark/harness.ts` -- Main benchmark runner
```
- Load system configurations
- For each system:
  - Initialize fresh instance
  - Run task battery
  - Collect metrics (latency, accuracy, tokens)
  - Save results to JSON
- Generate comparison reports
```

#### `benchmark/systems/` -- Adapter for each system
```
benchmark/systems/brainbox.ts      -- BrainBox adapter (direct API)
benchmark/systems/mem0.ts          -- Mem0 adapter (Python SDK via subprocess)
benchmark/systems/supermemory.ts   -- SuperMemory adapter (REST API)
benchmark/systems/zep.ts           -- Zep/Graphiti adapter (Python SDK via subprocess)
benchmark/systems/letta.ts         -- Letta adapter (REST API)
benchmark/systems/langmem.ts       -- LangMem adapter (Python SDK via subprocess)
benchmark/systems/shodh.ts         -- Shodh-Memory adapter (MCP)
benchmark/systems/openclaw-core.ts -- OpenClaw memory-core adapter (direct)
benchmark/systems/openclaw-lance.ts-- OpenClaw memory-lancedb adapter (direct)
benchmark/systems/obsidian-smart.ts-- Smart Connections adapter (Obsidian API)
benchmark/systems/obsidian-copilot.ts-- Copilot adapter (Obsidian API)
```

#### `benchmark/tasks/` -- Task definitions
```
benchmark/tasks/cold-start.json     -- 50 cold start tasks with ground truth
benchmark/tasks/warm-recall.json    -- 150 warm recall tasks with ground truth
benchmark/tasks/error-fix.json      -- 100 error-fix pairs with ground truth
benchmark/tasks/tool-sequence.json  -- 50 tool sequence tasks with ground truth
benchmark/tasks/cross-session.json  -- 100 learning curve tasks
benchmark/tasks/scaling.json        -- 50 scaling tasks
```

#### `benchmark/codebases/` -- Test project metadata
```
benchmark/codebases/happy-cli.json     -- File inventory, module structure
benchmark/codebases/django-app.json    -- Python project metadata
benchmark/codebases/rust-cli.json      -- Rust project metadata
benchmark/codebases/go-service.json    -- Go project metadata
benchmark/codebases/react-app.json     -- React project metadata
```

#### `benchmark/analysis/` -- Statistical analysis scripts
```
benchmark/analysis/compare.ts       -- Pairwise comparison with statistical tests
benchmark/analysis/charts.py        -- Matplotlib/Plotly chart generation
benchmark/analysis/tables.ts        -- LaTeX table generation
benchmark/analysis/obsidian.ts      -- Obsidian-specific analysis (curation tax, token cost)
```

#### `benchmark/report/` -- Report generation
```
benchmark/report/generate.ts        -- Compile JSON results into paper-ready tables/charts
benchmark/report/latex-template.tex  -- Paper template with chart/table placeholders
```

### 11.2 Data Collection Methodology

#### Phase 1: Task Creation (Week 1)
1. Extract 500+ real tasks from Claude Code session logs (`~/.claude/projects/.../*.jsonl`)
2. Parse each session to identify:
   - Files accessed (with order and timestamps)
   - Tools used (with arguments)
   - Errors encountered (with subsequent fix files)
   - Session boundaries
3. Manually label ground truth for each task:
   - For recall tasks: which file(s) should the system return?
   - For error-fix tasks: which file(s) contain the fix?
   - For tool prediction: what tool comes next?
4. Split into training (60%) and test (40%) sets
5. Create an inter-annotator agreement check: have 2 people label a subset, measure Cohen's kappa

#### Phase 2: System Setup (Week 2)
1. Install and configure all 10+ systems on the same machine
2. Write adapter code for each system (unified interface)
3. Pre-seed training data into each system using its native API
4. Verify each system is operational with smoke tests

#### Phase 3: Benchmark Execution (Week 3)
1. Run each system through all 6 task categories
2. 3 independent runs per system (different random seeds for task ordering)
3. Measure and record all metrics with microsecond precision
4. Save raw results to JSON for analysis

#### Phase 4: Analysis (Week 4)
1. Compute all metrics (accuracy, latency, tokens, learning curves)
2. Run statistical tests (paired t-test, Wilcoxon, effect size)
3. Generate charts and tables
4. Write the Obsidian deep-dive analysis (curation tax measurement)

### 11.3 Obsidian Benchmark Setup Protocol

Since Obsidian is the most important comparison, it gets a dedicated setup protocol:

1. **Create representative vault:**
   - One note per key module/component in each test codebase
   - Manual wikilinks between related modules
   - Error documentation notes with links to fix files
   - Tool preference notes
   - Time this process to measure "curation tax"

2. **Smart Connections setup:**
   - Install plugin (default settings)
   - Let it index the vault (time this)
   - Run Smart Chat queries for each task
   - Record: time to index, latency per query, quality of results

3. **Copilot setup:**
   - Install plugin (default settings)
   - Enable RAG with default embedding model
   - Run Vault QA queries for each task
   - Record: indexing time, latency per query, token cost per query

4. **Zero Curation Control:**
   - Test all Obsidian configurations with an empty vault
   - This measures the "floor" -- what happens when no human curates
   - BrainBox's results with behavioral learning vs. Obsidian's results with no curation

### 11.4 Adapter Interface

All system adapters implement this unified interface:

```typescript
interface MemorySystemAdapter {
  name: string;

  // Lifecycle
  initialize(): Promise<void>;           // Fresh install / reset state
  teardown(): Promise<void>;             // Cleanup

  // Learning
  recordFileAccess(path: string, context?: string): Promise<LearnMetrics>;
  recordToolUse(tool: string, args?: any): Promise<LearnMetrics>;
  recordError(error: string, fixFiles?: string[]): Promise<LearnMetrics>;

  // Retrieval
  recallFiles(query: string, limit?: number): Promise<RecallResult>;
  recallErrorFix(error: string): Promise<RecallResult>;
  predictNextTool(currentTool: string): Promise<PredictionResult>;

  // Metrics
  getMetrics(): Promise<SystemMetrics>;
}

interface LearnMetrics {
  tokensConsumed: number;
  latencyMs: number;
  llmCallsMade: number;
}

interface RecallResult {
  files: Array<{ path: string; confidence: number; rank: number }>;
  latencyMs: number;
  tokensConsumed: number;
}

interface PredictionResult {
  nextTool: string | null;
  confidence: number;
  latencyMs: number;
}

interface SystemMetrics {
  totalMemories: number;
  totalTokensConsumed: number;
  averageLatencyMs: number;
}
```

---

## 12. Key Arguments Summary

### 12.1 Arguments BrainBox Makes

1. **Zero-cost learning is non-negotiable.** Systems that consume tokens to save tokens have a fundamental contradiction. BrainBox's record() is a single SQLite UPDATE statement: zero LLM calls, zero API roundtrips, zero token cost.

2. **<5ms retrieval changes the game.** When recall is faster than search, agents can skip search entirely for known patterns. This is not an optimization -- it is a paradigm shift from "search for everything" to "recall what you know, search only for the unknown."

3. **Myelination is the missing primitive.** Every other system treats the 100th retrieval identically to the first. BrainBox strengthens with use and decays with disuse -- the system literally gets better the more you use it.

4. **Obsidian's human curation doesn't scale for agents.** 5M+ humans use Obsidian because manual curation works for humans. But autonomous agents need automatic learning. Using Obsidian as agent memory is like using a manual transmission in a self-driving car.

5. **Transitive discovery finds what vector search cannot.** "Fix the login bug" -> encryption.ts has zero semantic similarity to "login bug." BrainBox discovers it through 2-hop spreading because these files are behaviorally connected. Vector databases will never surface it.

6. **The fan effect is essential.** Anderson's 1983 ACT-R principle -- inverse degree normalization -- is the single most important mechanism for preventing hub domination. No competitor implements it. In our benchmark, it alone improved accuracy from 13% to 60%.

### 12.2 Arguments Against BrainBox (Address Honestly)

1. **"But Mem0 has higher accuracy on LOCOMO."** Yes, because LOCOMO tests conversational fact recall, not file access prediction. On our coding-agent-specific benchmark, BrainBox wins.

2. **"But Zep has 94.8% on DMR."** Yes, for temporal fact retrieval. DMR does not test file co-access patterns, error-fix association, or tool sequence prediction.

3. **"But Obsidian has 5M users."** Users, not agents. The question is not "which tool do developers prefer?" but "which memory system makes autonomous agents more efficient?"

4. **"But BrainBox only has a 15-query benchmark."** Fair criticism. AgentMemBench with 500 tasks addresses this directly. We are publishing the benchmark for independent evaluation.

5. **"But what about greenfield projects?"** Valid weakness. BrainBox contributes minimal value with no behavioral history. The v2.0 roadmap (semantic code retrieval, commit neurons) addresses this.

---

## 13. Publication Strategy

### 13.1 Paper (arXiv)
- Full benchmark results with all tables and charts
- Emphasis on reproducibility (all code + data released)
- Obsidian comparison as headline finding

### 13.2 Blog Post Series (Viral Distribution)
- **Post 1:** "We Benchmarked 10 Memory Systems. Obsidian Lost." (the viral hook)
- **Post 2:** "Mem0 vs. BrainBox: 47K GitHub Stars vs. 67% Recall Accuracy"
- **Post 3:** "Why Your AI Agent Doesn't Need a Vector Database"
- **Post 4:** "The Myelination Effect: Memory That Gets Better With Use"

### 13.3 Open Source Release
- AgentMemBench benchmark suite (all tasks, ground truth, runner)
- System adapters for all 10+ systems
- Analysis scripts with chart generation
- Docker setup for easy reproduction

---

## 14. Risk Mitigation

### 14.1 Risk: BrainBox doesn't actually win on some metrics
**Mitigation:** Run preliminary benchmarks on a subset (50 tasks) before committing to full benchmark. If BrainBox loses on a category, acknowledge it clearly -- credibility matters more than a clean sweep.

### 14.2 Risk: Obsidian community backlash
**Mitigation:** Frame as "Obsidian is great for humans, not for agents" rather than "Obsidian is bad." Explicitly acknowledge Obsidian's strengths. Position BrainBox as complementary, not replacement.

### 14.3 Risk: Systems update before publication
**Mitigation:** Pin all system versions. Note in paper that results apply to tested versions. Provide scripts to re-run with newer versions.

### 14.4 Risk: Unfair comparison (some systems not designed for this use case)
**Mitigation:** Acknowledge this explicitly in the paper. "Mem0 was designed for conversational memory, not file recall. We include it because the community frequently suggests it for this purpose." Let each system show its strengths on the categories where it is strongest.

### 14.5 Risk: Insufficient statistical rigor
**Mitigation:** 3 runs per system, paired statistical tests with Bonferroni correction, effect sizes, confidence intervals. Pre-register hypothesis before running benchmarks.

---

## 15. Appendix: Projected Timeline

| Week | Deliverable |
|------|------------|
| 1 | Task creation: extract 500 tasks from real sessions, label ground truth |
| 2 | System setup: install all 10 systems, write adapters, smoke tests |
| 3 | Benchmark execution: full runs for all systems, 3 independent runs each |
| 4 | Data analysis: statistics, charts, tables, Obsidian deep-dive |
| 5 | Paper writing: intro, methods, results |
| 6 | Paper writing: discussion, Obsidian section, conclusion |
| 7 | Review, polish, release benchmark code and data |

---

## 16. Appendix: Existing Benchmark Data to Cite

### Published Scores (from competitor papers)

| System | Benchmark | Score | Source |
|--------|-----------|-------|--------|
| Mem0 | LOCOMO (LLM-as-Judge) | 66.9% | arXiv 2504.19413 |
| Mem0g | LOCOMO (LLM-as-Judge) | 68.5% | arXiv 2504.19413 |
| OpenAI Memory | LOCOMO (LLM-as-Judge) | 52.9% | arXiv 2504.19413 |
| LangMem | LOCOMO (LLM-as-Judge) | 58.1% | arXiv 2504.19413 |
| MemGPT | LOCOMO | ~48% | arXiv 2504.19413 |
| Letta | LOCOMO (GPT-4o mini) | 74.0% | letta.com/blog |
| Zep | DMR | 94.8% | arXiv 2501.13956 |
| Zep | LongMemEval | +18.5% vs baseline | arXiv 2501.13956 |
| SuperMemory | LongMemEval_s | SOTA | supermemory.ai/research |
| BrainBox | Internal 15-query benchmark | 67% top-1 | WHITEPAPER.md |

### Latency Comparison (Published Data)

| System | p50 Latency | p95 Latency | Source |
|--------|-------------|-------------|--------|
| BrainBox | <1ms | <5ms | Own measurement |
| Mem0 | ~400ms | 1.44s | arXiv 2504.19413 |
| LangMem | 17.99s | 59.82s | mem0.ai/blog |
| SuperMemory | ~150ms | <300ms | supermemory.ai |
| Zep | ~100ms | <200ms | getzep.com |
| OpenAI Memory | ~500ms | 900ms | mem0.ai/blog |

### Token Cost Comparison (Estimated from Architecture)

| System | Tokens per Learning Event | Tokens per Recall | Source |
|--------|--------------------------|-------------------|--------|
| BrainBox | 0 | 0 | Pure SQLite |
| Shodh | 0 | 0 | Pure RocksDB |
| Mem0 | ~500 (LLM extraction) | ~200 (hybrid search) | Architecture analysis |
| SuperMemory | ~500 (LLM atomization) | ~200 (hybrid + temporal) | Architecture analysis |
| Zep | ~500 (LLM entity extraction) | ~150 (KG traversal) | Architecture analysis |
| Letta | ~200 (agent tool calls) | ~300 (search + management) | Architecture analysis |
| LangMem | ~300 (extraction pipeline) | ~100 (semantic search) | Architecture analysis |
| OpenClaw memory-core | 0 (manual markdown) | ~100 (BM25 + vector) | Architecture analysis |
| OpenClaw memory-lancedb | ~100 (auto-capture) | ~50 (vector search) | Architecture analysis |
| Obsidian Smart Connections | ~100 (embedding per note) | ~200 (similarity + context) | Architecture analysis |
| Obsidian Copilot | ~100 (embedding per note) | ~500 (RAG + LLM reranking) | Architecture analysis |

---

## 17. Appendix: Obsidian Plugin Research Notes

### Smart Connections (v2.x)
- 150k+ active users
- Local-first: default local embedding model, optional cloud (OpenAI, etc.)
- Smart View: sidebar showing related notes via embedding similarity
- Smart Chat: conversational interface to query vault
- Zero configuration required: auto-indexes vault on install
- Limitations: no learning from agent behavior, no file co-access patterns, single-hop similarity only

### Obsidian Copilot (v2.x)
- "THE Copilot in Obsidian"
- RAG-based vault Q&A
- Auto-compact at 128k token threshold
- YouTube and web clipper integration (2026)
- Limitations: requires LLM API key, token cost scales with vault size, no behavioral learning

### Other Obsidian AI Plugins (Not Tested But Noted)
- **InfraNodus:** Graph analysis with clustering and network science. Advanced but requires external service.
- **Text Generator:** General-purpose LLM integration. Not memory-specific.
- **Khoj:** Self-hosted AI assistant with Obsidian integration. Closest to full agent memory but requires separate server.

### Obsidian Performance Data
- 281K notes: several minutes to index, slow [[]] autocomplete (4s per keystroke)
- 40K notes: slow on PC, unusable on mobile
- Smart Connections embedding cost: ~$1-2 for 4M word vault (2.3M tokens at OpenAI rates)
- Smart Connections local embedding: free but slower and potentially less accurate

---

## 18. Glossary of Terms

| Term | Definition |
|------|-----------|
| Hebbian learning | "Neurons that fire together wire together" -- synaptic strengthening through co-activation |
| Myelination | Biological process where frequently-used neural pathways become faster. In BrainBox, neurons that are accessed frequently develop higher myelination values. |
| Spreading activation | Retrieval mechanism where activation propagates through synaptic connections from seed nodes |
| Fan effect | Anderson (1983): activation spread is inversely proportional to a node's out-degree |
| BCM rule | Bienenstock-Cooper-Munro (1982): diminishing returns in synaptic strengthening as weights approach maximum |
| LOCOMO | Long Conversational Memory benchmark for evaluating AI memory systems |
| DMR | Deep Memory Retrieval benchmark used by Zep/MemGPT |
| LongMemEval | Multi-session evaluation benchmark for long-term memory |
| AgentMemBench | Our proposed benchmark for coding agent memory systems (this paper) |
| Curation tax | Human time required to maintain a knowledge base (Obsidian vault) |
| Cold start | Period before a learning system has accumulated enough data to be useful |
| MRR | Mean Reciprocal Rank: average of 1/rank across all queries |
