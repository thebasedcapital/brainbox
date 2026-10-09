<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/hero-dark.svg" />
    <img src="assets/hero.svg" alt="BrainBox — muscle memory for coding agents" width="100%" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/brainbox-hebbian"><img src="https://img.shields.io/npm/v/brainbox-hebbian?color=b83e2d&label=npm" alt="npm version" /></a>
  <a href="https://github.com/thebasedcapital/brainbox/stargazers"><img src="https://img.shields.io/github/stars/thebasedcapital/brainbox?color=8a8848" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522-526c50" alt="Node 22+" />
  <img src="https://img.shields.io/badge/MCP-8%20tools-6d665a" alt="MCP: 8 tools" />
  <img src="https://img.shields.io/badge/cost-%240%20%C2%B7%20local%20%C2%B7%20SQLite-6d665a" alt="Zero cost, local, SQLite" />
  <a href="https://github.com/thebasedcapital/brainbox/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2a2620" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="#install"><b>Install</b></a> ·
  <a href="#how-it-works"><b>How it works</b></a> ·
  <a href="#results"><b>Results</b></a> ·
  <a href="#built-on-research"><b>Research</b></a> ·
  <a href="#integrations"><b>Integrations</b></a> ·
  <a href="./WHITEPAPER.md"><b>Whitepaper</b></a>
</p>

BrainBox is **procedural memory for AI coding agents**. It watches what the agent actually does and remembers it:
- which files get read and edited together
- which errors were fixed by which edits
- which tool chains the agent repeats

On the next task it puts the right files in front of the agent *before* it starts searching.

**Not a vector database. Not RAG.** Hebbian learning on a local SQLite graph. Zero API cost, no GPU, nothing leaves your machine.

```
Session 1   agent greps for auth.ts, reads it, edits it            ~2,000 tokens of searching
Session 5   BrainBox recalls auth.ts + session.ts up front         search skipped
Session 20  auth.ts → session.ts → token.ts is a superhighway      instant recall
```

## Paper

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.18664906.svg)](https://doi.org/10.5281/zenodo.18664906)

**BrainBox: Local Behavioral Memory for Coding Agents** (Bhavesh B, 2026). The DOI above covers all versions and resolves to the latest. Latest version: **v0.2**, [doi:10.5281/zenodo.23250505](https://doi.org/10.5281/zenodo.23250505).

```bibtex
@misc{b2026brainbox,
  author    = {B, Bhavesh},
  title     = {BrainBox: Local Behavioral Memory for Coding Agents},
  year      = {2026},
  publisher = {Zenodo},
  version   = {v0.2},
  doi       = {10.5281/zenodo.23250505},
  url       = {https://doi.org/10.5281/zenodo.23250505}
}
```

## Install

```bash
npm install brainbox-hebbian
```

That's it. The postinstall script:
1. Adds a `PostToolUse` hook to `~/.claude/settings.json`. It learns from every file read, edit, search and command.
2. Adds a `UserPromptSubmit` hook. It injects compact recall into prompts, or stays silent once it has learned you ignore it.
3. Adds a `SessionEnd` hook. It scores which recalled files you actually opened or edited and compiles procedures.
4. Registers the MCP server via `claude mcp add`, with 8 tools: `record`, `recall`, `explain`, `error`, `resolve`, `predict_next`, `stats`, `decay`.
5. Creates `~/.brainbox/` and starts a background download of the embedding model.

Hooks never download models. Until the model is cached (`brainbox models pull`), recall runs lexical-only. Embeddings come from the optional `@huggingface/transformers` dependency; if its native modules can't install on your machine (for example, `sharp` with a system libvips and no build tools), BrainBox still installs and runs with keyword search. `brainbox models status` shows which mode you are in.

**Kill the cold start** by seeding from git history and the code graph:

```bash
brainbox bootstrap --repo /path/to/project --imports
```

**Uninstall:** `brainbox uninstall` removes the hooks and the MCP server and keeps your database.

## How it works

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/the-loop-dark.svg" />
    <img src="assets/the-loop.svg" alt="BrainBox pipeline: tool calls → learn → recall → policy → inject, with a feedback loop" width="100%" />
  </picture>
</p>

Every tool call is a **neuron** firing. Files, tools and errors become neurons, and things accessed close together become **synapses**. A prompt triggers **recall**, which fuses several ranking channels. A learned **policy** decides whether injecting is worth the tokens. **Feedback** on what you actually opened or edited flows back into the graph.

### Fire together, wire together

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/hebbian-dark.svg" />
    <img src="assets/hebbian.svg" alt="Hebbian learning: co-accessed files strengthen their synapse across sessions" width="100%" />
  </picture>
</p>

Access `auth.ts` then `session.ts` across sessions and their synapse strengthens. SNAP plasticity makes strong synapses grow more slowly, so no single connection takes over. Links are directional (STDP): what you open *next* matters more than what came before.

### Spreading activation

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/spreading-dark.svg" />
    <img src="assets/spreading.svg" alt="Spreading activation from a seed file over three hops with fan-effect damping" width="100%" />
  </picture>
</p>

Recalling one file activates its neighbours for up to 3 hops. Each hop is damped by `1/√degree`, so hub files don't flood the results. Each result carries the channel and the edge that produced it. `brainbox_explain` shows you exactly why a file was recalled.

### Superhighways and decay

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/superhighway-dark.svg" />
    <img src="assets/superhighway.svg" alt="Frequently used paths myelinate into superhighways while unused edges decay" width="100%" />
  </picture>
</p>

Paths you use often are myelinated into instant-recall superhighways. Recency and frequency follow the ACT-R base-level equation, `B = ln Σ tⱼ^-0.5`, and unused connections fade. Files recalled but ignored weaken **only the edge that surfaced them**.

### Error → fix immune system

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/immune-dark.svg" />
    <img src="assets/immune.svg" alt="An error fingerprint is linked to the edits that fixed it and recalled the next time" width="100%" />
  </picture>
</p>

When a failed command is followed by edits and a passing rerun, BrainBox stores an error→fix procedure. The procedure is keyed by the error's fingerprint and tracks helpful/harmful outcomes. The next time that error appears, the fix files are recalled at once. Procedures are shown to the agent as quoted observations, never as instructions.

## Results

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/eval-dark.svg" />
    <img src="assets/eval.svg" alt="v0.2 vs v0.1 vs best baseline on real agent trajectories" width="100%" />
  </picture>
</p>

`brainbox eval` replays real coding-agent trajectories in time order. Each task is scored on a fresh in-memory DB trained only on **earlier** tasks from the same repo, and every system ranks the same candidate set.

**v0.1 lost to plain recency on next-file prediction.** On the held-out SWE tasks the gap was −.207, 95% CI −.312…−.118. v0.2 is statistically tied with recency there. Next-tool prediction now beats every baseline significantly, and files-read recall leads on both data sources.

**Known gap:** on local sessions, ranking by edit frequency alone still beats BrainBox for *edited* files (Δ −.089, CI −.185…0).

Fitting the lexical and Hebbian channel weights to zero scored higher on dev, but recall then ignored the query, so the shipped weights keep them.

<details>
<summary><b>Full table, protocol and commands</b></summary>

Probes:
- **P1:** files edited or read for the task (query = task text)
- **P2:** next file, step by step
- **P3:** next tool (top 3)

Baselines: recency, frequency, BM25, EdgeBank and random. Confidence intervals are paired bootstrap 95% CIs, resampled by trajectory.

Datasets:
- Ranking weights were fit only on the **dev** repos (sqlglot, dvc, streamlink).
- **SWE test** is 40 held-out tasks from Pillow and conan.
- **Local** is 97 agent sessions across 5 projects, never used for fitting.

Scores are MRR (P3: MRR@3), with embeddings off.

| Probe | SWE test: v0.1 | v0.2 | best baseline | local: v0.1 | v0.2 | best baseline |
|---|---:|---:|---:|---:|---:|---:|
| P1 edited files | .307 | **.307** | .216 BM25 | .737 | .703 | **.791 frequency** |
| P1 read files | .191 | **.267** | .206 BM25 | .372 | **.555** | .547 BM25 |
| P2 next file | .223 | .409 | **.430 recency** (Δ CI −.049…+.003) | .634 | **.702** | .701 recency (tie) |
| P3 next tool | .479 | **.767** | .748 frequency (Δ +.019, CI +.012…+.027) | .257 | **.686** | .662 recency (Δ CI +.010…+.036) |

```bash
npm run eval -- --source nebius --repos 5 --max-tasks-per-repo 20 --split test --embeddings off --engine new
npm run eval -- --source omp    --repos 5 --max-tasks-per-repo 20 --embeddings off --engine old   # v0.1 engine (needs a worktree, see src/eval)
```

Code search: on a 30-query code-search set, the default `jina-embeddings-v2-base-code` reaches Recall@5 **0.867**, against 0.667 for the previous MiniLM.

</details>

## Built on research

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/research-dark.svg" />
    <img src="assets/research.svg" alt="Recent papers mapped to the BrainBox subsystems they shaped" width="100%" />
  </picture>
</p>

Each v0.2 change maps to a recent paper and was measured with the replay eval:

| Subsystem | What changed | Source |
|---|---|---|
| Ranking | ACT-R base-level activation replaces fixed decay. Recurrence and popularity candidates are added. Weighted reciprocal-rank fusion with weights fit on held-out dev repos. Directional STDP; n-gram tool prediction. | [ACT-R 2505.05083](https://arxiv.org/abs/2505.05083) · [Base3 2506.12764](https://arxiv.org/abs/2506.12764) · [2502.04910](https://arxiv.org/abs/2502.04910) |
| Code search | cAST-style AST chunks. FTS5 BM25 + `sqlite-vec` KNN, fused with RRF (k=60). Incremental by content hash. | [cAST 2506.15655](https://arxiv.org/abs/2506.15655) |
| Injection policy | A contextual UCB1 bandit picks SILENT / TOP1 / TOP3 / TOP5. Reward = files you open or edit, minus token cost. | [MemCon 2607.13591](https://arxiv.org/abs/2607.13591) |
| Attribution | Every recall is logged with the synapse that produced it; ignored recalls weaken only that edge. | [MemTrace 2605.28732](https://arxiv.org/abs/2605.28732) |
| Compact injection | Injects a compact `path:start-end — why` list; deleted files are never injected. | [FastContext 2606.14066](https://arxiv.org/abs/2606.14066) |
| Procedures | Deterministic mining of failed command → edits → passing rerun, plus multi-session workflows, with helpful/harmful counters. | [ACE 2510.04618](https://arxiv.org/abs/2510.04618) · [Mem^p 2508.06433](https://arxiv.org/abs/2508.06433) |
| Code graph | Tree-sitter import / call / inheritance edges (TS/JS, Python, Rust, Swift, Go), seeded as weak priors (≤ 0.35) that learned co-access outranks. | — |
| Evaluation | Offline replay of SWE-rebench OpenHands trajectories and local sessions, with baselines and paired CIs. | [SWE-rebench trajectories](https://huggingface.co/datasets/nebius/SWE-rebench-openhands-trajectories) |

Also in 0.2:
- Builds on Node 22–26 (better-sqlite3 v13).
- Hooks are written in Claude Code's nested settings format.
- The hook DB lock wait is capped at 100 ms.
- Procedure compilation is 470× faster on large histories.

## Integrations

### MCP server (any agent)

```bash
# 8 tools: record, recall (detail: compact|full), explain, error, resolve, predict_next, stats, decay
npx tsx node_modules/brainbox-hebbian/src/mcp.ts
```

### Kilo / OpenCode (native plugin)

Add to `~/.config/kilo/config.json`:

```json
{
  "plugin": ["node_modules/brainbox-hebbian/src/kilo-plugin.ts"]
}
```

### OpenClaw (NeuroVault)

BrainBox can run as an OpenClaw memory slot plugin. See [NeuroVault](https://github.com/thebasedcapital/neurovault) for the reference implementation.

| Aspect | Claude Code | OpenClaw |
|---|---|---|
| Tool names | PascalCase (`Read`) | Lowercase (`read`) |
| Context injection | `UserPromptSubmit` hook | `before_agent_start` lifecycle |
| Learning trigger | `PostToolUse` hook | `after_tool_call` lifecycle |
| Embeddings | jina-embeddings-v2-base-code (configurable) | Keyword-only (lower confidence gate) |

### macOS daemon (opt-in)

A system-wide FSEvents file watcher that learns from VS Code, Xcode, vim and the shell, not just agents. It installs a LaunchAgent, so it requires an explicit opt-in:

```bash
brainbox daemon install   # installs LaunchAgent, starts watching
brainbox daemon status
brainbox daemon uninstall
```

## CLI

```bash
brainbox recall "authentication login"
brainbox record src/auth.ts --query "authentication"
brainbox stats                 # includes stale-embedding counts + re-index commands
brainbox error "TypeError: cannot read 'token'"
brainbox predict Read
brainbox bootstrap --repo . --imports [--since <git-rev>]   # git history + tree-sitter code graph
brainbox extract-snippets [--force] [--no-embed]           # AST chunks → FTS5 + sqlite-vec
brainbox embed [--force]       # embed neurons with the active model
brainbox models pull|status    # fetch / inspect the embedding model
brainbox procedures [list|compile|show <id>|deprecate <id>]
brainbox sleep                 # consolidation + procedure compilation
brainbox eval --source nebius|omp [...]                   # offline replay evaluation
brainbox hubs | stale | projects | sessions | streaks | graph | highways | decay
```

<details>
<summary><b>Configuration</b></summary>

| Variable | Purpose | Default |
|---|---|---|
| `BRAINBOX_DB` | SQLite path | `~/.brainbox/brainbox.db` |
| `BRAINBOX_DB_TIMEOUT_MS` | SQLite busy timeout | `5000` (hooks use `100`) |
| `BRAINBOX_EMBED_MODEL` | `minilm` \| `jina-code` \| `gemma` \| `gemma-q4` | `jina-code` |
| `BRAINBOX_MODEL_CACHE` | Model cache directory | Transformers.js default |
| `BRAINBOX_EMBEDDINGS` | `off` disables embeddings entirely | on |
| `BRAINBOX_POLICY` | `off` disables the learned injection policy (always TOP5) | on |
| `BRAINBOX_SESSION_ID` | Override session id for CLI/adapters | derived |
| `BRAINBOX_HOOK` | Set by hook entrypoints: local-only models, 1.2 s embedding deadline | unset |

Gemma profiles are subject to the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).

</details>

<details>
<summary><b>Algorithm details</b></summary>

| Component | Mechanism (defaults in `DEFAULT_ENGINE_OPTIONS`) |
|-----------|-----------|
| Synapse formation | Sequential window (25 items), positional decay; directional STDP (later→earlier edge × 0.5) |
| Strengthening | SNAP sigmoid plasticity (midpoint 0.5, steepness 8); BCM myelination, 0.95 ceiling |
| Recency / frequency | ACT-R base level `B = ln Σ (Δt_h)^-0.5` over the last 50 accesses |
| File ranking | Weighted reciprocal-rank fusion. Channel weights: lexical (FTS5, scaled by verbatim query-term coverage) 4, Hebbian evidence 4, code snippets 4, frequency 2, recency 1, base level 0.5, recurrence 0.2. Session recency gets weight 30 when the query matches the current session. |
| Spreading | 3-hop BFS, fan-out cap 10, fan effect 1/sqrt(degree) |
| Tool prediction | Longest-suffix n-grams (n ≤ 3, min support 4) fused with frequency (0.5) |
| Code search | AST chunks; FTS5 BM25 + sqlite-vec KNN, RRF k=60 |
| Structural priors | import 0.2, call ≤ 0.35, inherit 0.3; never override learned co-access |
| Injection policy | UCB1 over SILENT/TOP1/TOP3/TOP5; reward = rank-weighted opens/edits − 2 per 1k tokens |
| Anti-recall | Ignored recalls weaken only the producing edge; `1 - (1 - 0.1)^streak`, floor 0.1 |
| Error learning | 2x boosted learning rate; error→fix procedures from failed→edited→passing reruns |

The [paper's source](./WHITEPAPER.md) (v0.2, [doi:10.5281/zenodo.23250505](https://doi.org/10.5281/zenodo.23250505)) describes the implementation and coverage-conditioned replay results, including uncertainty and provenance limitations. See [paper build and evidence notes](./paper/README.md) for the bibliography, aggregate evidence, LaTeX and PDF build.

</details>

<details>
<summary><b>Architecture</b></summary>

```
src/
  hebbian.ts       # Engine: record, recall (rank fusion), STDP, n-gram tool prediction, decay, anti-recall
  db.ts            # SQLite schema + migrations
  policy.ts        # Recall event log + contextual UCB1 injection policy
  adapter.ts       # Shared recall/injection orchestration for all hosts
  snippets.ts      # AST chunking, FTS5 + sqlite-vec hybrid search
  embeddings.ts    # Embedding model profiles, hook-safe loading
  codegraph.ts     # Tree-sitter import/call/inherit graph
  procedures.ts    # Procedural playbook mining + matching
  bootstrap.ts     # Git history / code graph / session seeding
  installer.ts     # Hooks + MCP registration, model prefetch
  mcp.ts           # MCP server (8 tools)
  hook.ts          # PostToolUse + SessionEnd hook
  prompt-hook.ts   # UserPromptSubmit hook
  kilo-plugin.ts   # Kilo/OpenCode native plugin
  daemon.ts        # FSEvents file watcher (macOS, opt-in)
  cli.ts           # CLI
  eval/            # Offline trajectory replay evaluation
  testkit.ts       # Test harness; test.ts + tests/*.test.ts
scripts/visuals/   # JS generators for the README figures (tbcresearch.org ink style, light + dark)
```

</details>

## Development

```bash
npm test                      # 147 tests
npx tsx src/test.ts "Ranking" # filter by suite/test name
npm run visuals               # regenerate assets/*.svg (light + dark) from scripts/visuals/scenes/*.mjs
bash scripts/visuals/social.sh  # render assets/social-preview.png for GitHub's social preview
```

Requirements: Node.js 22+, on macOS or Linux. The FSEvents daemon is macOS-only; everything else is cross-platform.

---

<p align="center">
  If BrainBox saved your agent some searching, <a href="https://github.com/thebasedcapital/brainbox">give it a ⭐</a> so others can find it.<br/>
  Built by <a href="https://x.com/thebasedcapital">@thebasedcapital</a> · MIT License
</p>
