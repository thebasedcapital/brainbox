---
title: "BrainBox: Local Behavioral Memory for Coding Agents"
subtitle: "A systems draft with coverage-conditioned replay evaluation"
author: "Bhavesh B"
date: "8 October 2026 — revised draft, not a new archival release"
bibliography: paper/references.bib
link-citations: true
lang: en-US
abstract: |
  Coding agents repeatedly revisit files and tool sequences, creating an opportunity for external memory without updating language-model parameters. We present BrainBox, a local SQLite-backed system that learns directed co-access associations among files, tools and errors. Its current implementation combines bounded associative updates, query-conditioned graph retrieval, temporal features and reciprocal-rank fusion; a separate sequence model predicts tools. Optional components provide structural code hints, hybrid snippet retrieval, contextual control of prompt injection and deterministic procedure mining. We reassess the system using recorded agent trajectories rather than treating estimated search-token avoidance as measured savings. In a selected 40-task SWE-rebench replay, next-tool MRR@3 is 0.767 versus 0.748 for frequency, with a paired trajectory-bootstrap difference interval of [0.012, 0.027]. Next-file MRR is 0.409 versus 0.430 for recency, with an interval spanning zero. All rank metrics condition on targets already represented in prior-task memory: only 221 of 1,303 SWE next-file opportunities are scored. A separate 97-session local replay shows the same next-tool advantage but lower edited-file MRR than frequency. These results support a narrow claim about repeated-access prediction, not improved task completion, net token savings, biological fidelity or superiority to complete agent-memory products. We make the evaluation's ordering assumptions, coverage limits and incomplete artifact provenance explicit.
---

**Author:** Bhavesh B, independent researcher; bhaveshb@proton.me. ORCID: [0009-0007-9680-3842](https://orcid.org/0009-0007-9680-3842).

**Draft status.** This revision describes the v0.2 source tree and recorded replay runs. It replaces the earlier manuscript's central synthetic-token-savings argument. The existing concept DOI, [10.5281/zenodo.18664906](https://doi.org/10.5281/zenodo.18664906), identifies the prior publication record; this draft has not been deposited as a new version. Code: [thebasedcapital/brainbox](https://github.com/thebasedcapital/brainbox). Manuscript license: CC BY 4.0; code license: MIT.

**Keywords:** coding agents; behavioral memory; associative retrieval; tool prediction; rank fusion; offline replay.

# 1. Introduction

Repeated work on a repository produces a trace of operational associations: files are read together, edits follow errors, and familiar tool sequences recur. A coding agent can use this history to propose likely resources before repeating a broad search. This is a prediction problem as well as a retrieval problem. The file most often used after a test failure may be useful even when its contents do not closely match the next task description; conversely, a strong lexical query must be able to override a habitual but irrelevant file.

BrainBox stores these associations outside the language model. Adapters translate tool activity into local events; an indexed SQLite graph retains resources, directed associations and access history. Recall combines query evidence and behavioral priors rather than relying on either alone. The model's parameters are unchanged. Learning and recall require no LLM inference call, although optional dense retrieval uses a downloaded embedding model on the CPU. This removes an API dependency, not computational or storage cost.

We use *behavioral memory* for historical file/tool/error associations and *procedural memory* more narrowly for mined action sequences with observed verification outcomes. Neither term implies that observing a frequently used action proves it useful or correct. In particular, access frequency is not a causal estimate of utility.

This revision makes three contributions:

1. **An inspectable local implementation** combining directed co-access learning, temporal retrieval, query-aware rank fusion and suffix-based tool prediction, with optional code retrieval and procedure mining.
2. **A prior-history replay protocol** that fixes candidate universes before each target task, separates edited-file, read-file, next-file and next-tool probes, and reports both coverage and ranking quality.
3. **A bounded empirical finding:** next-tool prediction exceeds the strongest measured heuristic baseline in the stored runs; file-retrieval comparisons are mixed, and low historical coverage limits the claim.

We do not claim a new biological learning law or first-in-field status. The main contribution is the concrete system and its evaluation boundary. A useful research outcome includes identifying when simple frequency or recency is competitive with a more elaborate memory system.

# 2. Related work and positioning

**Agent memory.** A-MEM builds linked agent memories, while SYNAPSE uses spreading activation over episodic-semantic memory and MAGMA separates several graph relationships [@amem2025; @synapse2026; @magma2026]. These systems invalidate a simple division in which all existing memory is static or purely declarative. BrainBox emphasizes operational traces from coding tools and deterministic local updates; it does not establish empirical superiority over these systems.

**Procedures and tool experience.** ToolMem studies learned tool-capability memory, and MACLA studies hierarchical procedural memory with Bayesian selection and contrastive refinement [@toolmem2025; @macla2025]. NEMORI addresses adaptive memory distillation [@nemori2025]. BrainBox's procedure compiler instead recognizes constrained patterns in execution traces. Its advantages and disadvantages relative to language-mediated abstraction remain an empirical question: deterministic extraction is easier to inspect but may miss transferable explanations or infer spurious fixes.

**Association, temporal history and caching.** Hebbian plasticity is a broad family of learning ideas, not a correctness argument for a particular implementation [@safa2024]. ACT-R-inspired personalization motivates combining recency and recurrence [@actr2025], while temporal-graph research demonstrates the importance of heuristic comparators [@heuristics2025]. Cortex studies semantic-aware knowledge caching for LLM access [@cortex2025]. BrainBox shares the motivation of avoiding repeated discovery but predicts operational resources rather than measuring remote-cache performance.

**Retrieval composition.** Reciprocal-rank fusion combines heterogeneous rankers without requiring comparable raw scores [@rrf2009]. BrainBox uses a weighted variant at the file level and a separate hybrid snippet ranker. Structural chunking is motivated by cAST [@cast2025]. These are adopted design ingredients, not new algorithms claimed by this paper. The replay results below do not evaluate embedding models or code-chunk retrieval.

# 3. System and task definition

## 3.1 State and interfaces

A resource record contains an identifier, type, path or name, accumulated query context, timestamps, access count, activation and a bounded reinforcement scalar. Types include files, tools and errors. Directed edges retain association weights, counts and temporal metadata. Additional tables hold access logs, recall decisions, injection outcomes, code snippets, replay events and procedures.

The operational flow is:

```text
Tool events -> event normalization -> resource/edge updates
                                     |
Prompt query -> candidate channels -> rank fusion -> injection choice
                                                       |
                           observed opens/edits -> outcome attribution
Session end -> outcome finalization + procedure compilation
```

The Claude Code integration observes tool completion, performs pre-prompt recall and finalizes outcomes at session end. An MCP server exposes recording, recall, explanation, error recording, resolution, prediction, statistics and decay. Other adapters use the same observation/recall layer. Platform integration demonstrates an available interface, not a measured benefit on each platform.

## 3.2 Two distinct deployment questions

The deployed system asks both *which resources should be ranked?* and *whether any of them should be injected?* The former is evaluated here through retrieval and prediction probes. The latter involves a contextual policy, prompt overhead and agent responses; it is not evaluated by the recorded ranking replay. The same separation applies to procedure mining: implementation availability is not evidence that remembered procedures improve debugging success.

The database is local, but local storage is not a security boundary. Recorded commands, paths and excerpts can be sensitive, and repository-controlled text remains untrusted after it enters memory.

# 4. Methods

## 4.1 Bounded association learning

An access resets the resource's activation and updates its counters. The current event is associated with up to 25 distinct recent resources. Let $w_{uv}$ be an existing directed association, $p\in(0,1]$ the relative position of the earlier resource within that window, and $h$ a hub multiplier. The base update uses

$$
g(w)=\frac{1}{1+\exp(8(w-0.5))},\qquad
\delta_{uv}=\eta\,p\,h\,d_{uv}\,g(w_{uv}),
$$

$$
w'_{uv}=\min\{1,\;w_{uv}+\delta_{uv}(1-w_{uv})\}.
$$

The ordinary rate is $\eta=0.1$, doubled when an error participates. The multiplier $h$ is 0.5 when either endpoint has degree greater than 20, otherwise 1. Earlier-to-later associations receive $d_{uv}=1$; the reverse orientation receives 0.5 by default. For a new edge, the inserted weight is the corresponding $\delta$ computed from zero. Additional tagging/capture and maintenance mechanisms can modify stored weights, so this equation describes the ordinary co-access update, not every possible transition.

The code retains the name `myelination` for a resource-level reinforcement scalar $m$. Its ordinary access update is

$$
\Delta m=0.02\left(1-\frac{m}{0.95}\right)
\max\left\{\frac{1}{\sqrt{\max(n,1)}},0.1\right\},
\qquad m'=\min\{0.95,m+\Delta m\},
$$

where $n$ is the access count supplied to the update. This is a saturating heuristic. It does not implement the sliding modification threshold of biological BCM theory. Likewise, event-order asymmetry is not continuous-time spike-timing-dependent plasticity, and `myelination` is a software field name, not a model of axonal physiology.

Maintenance supports multiplicative decay and pruning. Daily multipliers are 0.85 for activation, 0.995 for the reinforcement scalar and 0.98 for association weight. These mechanisms require maintenance to run; they do not imply a hard bound on database size or an experimentally verified forgetting curve.

## 4.2 Retrieval channels and graph traversal

File candidates come from lexical evidence over stored path/context text, query-conditioned associative retrieval, optional snippet matches, recurrence, recency, frequency and base-level activation. A channel need not contain every candidate. Lexical tokenization and stored context are part of the implementation, not an oracle over repository contents.

For resource $i$, the ACT-R-inspired feature uses the last at most 50 access times:

$$
B_i(t)=\log\sum_{j\in H_i}
\max\{(t-t_{ij})/\text{hour},1/60\}^{-0.5}.
$$

A sigmoid provides a bounded version for some confidence calculations. A bootstrap resource without an access log can use its seed timestamp. This feature is an engineering adaptation; the evaluation uses synthetic event time rather than actual elapsed developer time.

Associative retrieval traverses up to three hops and at most ten outgoing edges per expanded resource. In the default fan-damped path, a proposed target score is proportional to

$$
a_v=a_u\,w_{uv}\,(1+\min\{m_v,m_{\rm cap}\})
\left[\max\{1,\min(\deg(u),D_{\rm cap})\}\right]^{-1/2}.
$$

Only sufficiently strong edges and sufficiently confident targets pass admission gates; candidate-type, universe and budget filters also apply. Already activated targets keep a better discovered score rather than summing every path. The alternative full inverse-degree mode exists but is disabled by default. Because reinforcement can increase an individual transition factor, the hop bound—not a proof of monotonic attenuation—limits traversal depth.

## 4.3 Query-aware rank fusion

For candidate $i$, channel $c$ supplies a one-based rank $r_c(i)$. The default file score is

$$
S(i\mid q)=\sum_{c:i\in L_c(q)}
\frac{\lambda_c\,\gamma_c(i,q)}{20+r_c(i)},
$$

where $\gamma_c=1$ except for the lexical channel, whose contribution is scaled by distinct query-term coverage matched against raw text. The denominator constant is 20 for file/tool fusion, distinct from the snippet ranker's constant of 60. Table 1 records the inspected defaults.

| Channel | Default weight | Qualification |
|:--|--:|:--|
| Lexical | 4 | Scaled by query-term coverage |
| Query-conditioned associative evidence | 4 | Excludes purely popularity-driven evidence from this channel |
| Snippet | 4 | Requires an available snippet index |
| Frequency | 2 | Historical access count |
| Recency | 1 | Replaced by 30 when the query matches recent-session lexical evidence |
| Base level | 0.5 | Recency/frequency history feature |
| Recurrence | 0.2 | Recent-resource association candidates |

Table 1. File-level fusion defaults. The reported replay does not populate every optional channel.

A final score normalization supplies the API field called `confidence`; it is not a calibrated probability of relevance. Results have count and budget limits, and the wrapper can abstain when no supporting evidence is available. Ranking weights were developed using the designated development repositories and product-level query-sensitivity checks. An immutable tuning log and a quantitative channel-ablation study are not present in the evidence used here, so the values should not be described as a reproducibly estimated optimum.

## 4.4 Tool-sequence prediction

Tool prediction backs off from the longest supported suffix, up to three tools, to shorter suffixes and then directional associations. Default minimum suffix support is four observations. A rank-fusion stage combines the sequence-derived ranking with frequency: weights are 1 for the sequence channel and 0.5 for frequency; tool recency has weight zero. The API returns at most three predicted tools. This is a small sequence model over observed tool names, not a planner that decides whether the proposed operation is safe or productive.

## 4.5 Optional code and procedure components

**Code structure and snippets.** Tree-sitter supports extraction of import, call and inheritance hints and syntax-aware code chunks. Structural edges are weak priors; unchanged files are not repeatedly strengthened merely by re-indexing. Snippet retrieval combines FTS5 BM25 and optional local dense similarity using rank fusion. The default embedding profile is Jina code, 768 dimensions with q8 weights; other local profiles are configurable. Hooks do not initiate model downloads, and lexical retrieval remains available when embeddings are disabled or unavailable. A missing vector extension can use a cosine-scan fallback, whose scaling differs from indexed search.

**Injection policy.** The deployed policy chooses SILENT, TOP1, TOP3 or TOP5 in a context formed from confidence band, query class, project familiarity and session stage. After an initial TOP5 period, it uses a UCB-style bonus:

$$
U(a)=\overline{R}_a+0.15\sqrt{\frac{2\log N}{N_a}}.
$$

An unseen arm is explored. For injected suggestions, the implemented reward is

$$
R=\sum_{i\in\text{used suggestions}}\frac{v_i}{r_i}
-2\,\frac{\widehat{T}_{\rm injected}}{1000},
$$

where $v_i=1$ for a read and 1.5 for an edit, and $\widehat{T}_{\rm injected}=\lceil\text{characters}/4\rceil$. SILENT receives zero. This does not observe opportunities lost by silence. Reads/edits are attribution signals, not counterfactual evidence that a suggestion helped. Ignored recalls can weaken the producing association rather than indiscriminately weakening every adjacent edge.

**Procedures.** A deterministic compiler recognizes failed command → successful edits → similar successful rerun patterns, and workflows supported by at least three sessions. Error-fix candidates may originate from one session. Command outcomes use exit status when available and an error detector otherwise; detector-clean output is weaker evidence than an explicit passing exit. Workflow retrieval requires a matching live prefix and a concrete command-bearing step. Formatting constrains paths and command text and labels output as historical observation. Helpful/harmful counters can deprecate failing procedures. None of these safeguards constitutes a proof against prompt injection or poisoned histories.

# 5. Evaluation protocol

## 5.1 Data and selection

The public source is the Nebius SWE-rebench OpenHands trajectory collection [@nebius2025]. The recorded catalog has 67,074 rows; this is not the evaluation sample size. Selection deduplicates attempts by issue, ranks repositories by distinct issue count, takes a five-repository slice, and assigns alternating global repository ranks to development or test. The reported test slice contains 40 trajectories, at most 20 per repository, from Pillow and conan; sqlglot, dvc and streamlink are the designated development repositories. This is a selected, repository-disjoint evaluation, not a random sample of all SWE-rebench tasks.

The local run selects 97 sessions from up to five project groups in the author's OMP logs. Its loader scanned 715 session files spanning nine source projects; the nine-project metadata describes the scanned corpus, not the selected evaluation cohort. Local inputs were not released, and the recorded run used the all-project split. We treat this as a secondary descriptive cohort, not an independently auditable held-out benchmark.

For the public data, the loader uses PR-number-like issue order as its chronology proxy and chooses a single attempt per issue. For local data, it uses the parser's session order. Neither is sufficient to establish perfect temporal correspondence with actual repository state. The simulated clock advances one second per event from a fixed epoch. Consequently, the replay does not evaluate real-time forgetting across days or weeks.

## 5.2 Candidate universe and probe timing

An in-memory database and baseline indexes are initialized per repository. Selected trajectories are processed in the prescribed order; state persists across tasks within that repository, while per-session transient state is reset. At the beginning of target task $t$, the evaluator freezes file and tool candidate universes $U_t$ to resources observed in earlier tasks. For sequential probes it records prefix events after predicting them, but newly observed resources remain outside $U_t$ until a later task.

The four reported target labels are:

- **P1-edit:** rank the task's edited files from its initial task-text query, before observing target-task events.
- **P1-read:** the analogous retrieval probe for files read during the task.
- **P2:** predict each upcoming read/edit file from prefix context, before recording that event.
- **P3:** predict each upcoming tool from prior tools, before recording that tool event.

Gold sets come from parsed trace activity, not independent relevance annotation. At any probe, the scored gold is $G'_t=G_t\cap U_t$. A probe with $G'_t=\varnothing$ contributes to coverage statistics but not ranking metrics. For P1, novel files are also removed from a mixed gold set. Thus the experiment measures **retrieval conditional on prior-resource coverage**, not full-repository localization and not discovery of new files. Prefix-only ordering reduces one source of target leakage but does not remove dataset selection, parser or repository-version biases.

## 5.3 Metrics, baselines and uncertainty

File rankings are truncated at ten; tool rankings at three. Reciprocal rank is the inverse rank of the first eligible relevant item, or zero if absent. We report MRR@10 for files (the stored field is `mrr`) and MRR@3 for tools. For multi-file P1 gold, this measures finding the first relevant file, not retrieving all relevant files.

All point estimates average over scored probe opportunities. P2 and P3 therefore weight longer trajectories more heavily. Paired intervals resample trajectory clusters 1,000 times with seed 42, retain each sampled cluster's sum and count, and use the 2.5th and 97.5th percentiles of the resulting event-weighted differences. This preserves within-trajectory clustering but not all dependence between trajectories that share a growing repository history. No repository-cluster uncertainty estimate or multiple-comparison correction is provided. Intervals spanning zero indicate insufficient evidence of a difference, not equivalence.

Comparators share the candidate universe and parsed history. They are locally implemented heuristics, not complete competing memory products:

- **Recency:** descending last-access order.
- **Frequency:** descending historical touch count.
- **BM25:** lexical ranking of accumulated path/context terms, with $k_1=1.2$ and $b=0.75$; it does not index the repository's full source code.
- **Co-session (EdgeBank-style):** overlap between a candidate's historical sessions and sessions containing current-prefix resources. It is a local co-occurrence baseline, not a reproduction of a complete published EdgeBank evaluation.
- **Random:** seeded permutation of candidates.

The strongest observed comparator is selected separately per probe and cohort for compact reporting. That selection is post hoc. All baselines are reported in Appendix A to avoid hiding weaker or stronger comparisons.

## 5.4 What was actually exercised

All principal runs have embeddings **off**. Replay calls core recording, error association, recall and tool prediction. It does not populate source-code snippet indexes, scan structural code graphs, run the prompt-injection policy or execute mined procedures. It also does not run an agent with and without suggestions. Accordingly, Tables 2–5 do not establish benefits from code embeddings, static structure, the policy or procedure mining.

Artifact fields labelled injected tokens are character-based estimates for short path lists; they are not tokenizer counts from live prompts and are not net tokens saved. Earlier synthetic scenarios and production counter estimates are not used as evidence of cost reduction in this revision. Historical latency figures are likewise not carried forward as a current controlled benchmark.

# 6. Results

## 6.1 Coverage before ranking quality

| Cohort / probe | Gold occurrences | Eligible gold | Opportunities | Scored |
|:--|--:|--:|--:|--:|
| SWE P1-edit | 298 | 28 | 40 | 16 |
| SWE P1-read | 374 | 92 | 40 | 30 |
| SWE P2 | 1,303 | 221 | 1,303 | 221 |
| SWE P3 | 2,727 | 2,625 | 2,727 | 2,625 |
| Local P1-edit | 693 | 121 | 97 | 38 |
| Local P1-read | 980 | 343 | 97 | 57 |
| Local P2 | 5,885 | 2,490 | 5,885 | 2,490 |
| Local P3 | 9,663 | 7,083 | 9,663 | 7,083 |

Table 2. Eligibility is membership in the frozen prior-task candidate universe. P1 gold counts sum unique targets within each task; they are not corpus-wide unique-file counts. P2/P3 count individual target opportunities.

Only 16.96% of SWE next-file opportunities and 42.31% of local next-file opportunities are eligible. Tool coverage is much higher: 96.26% and 73.30%, respectively. This difference is central to interpretation. A strong conditional file ranker may still remain silent or miss most novel work; the experiment does not score those novel targets as ranking failures.

## 6.2 Selected public trajectories

| Probe | Historical engine | Current run | Best baseline | Difference [95% interval] | Clusters |
|:--|--:|--:|:--|:--|--:|
| P1-edit | 0.307 | 0.307 | BM25 0.216 | +0.092 [−0.018, +0.224] | 16 |
| P1-read | 0.191 | 0.267 | BM25 0.206 | +0.061 [−0.038, +0.165] | 30 |
| P2 | 0.223 | 0.409 | Recency 0.430 | −0.021 [−0.049, +0.003] | 30 |
| P3 | 0.479 | 0.767 | Frequency 0.748 | +0.019 [+0.012, +0.027] | 38 |

Table 3. SWE conditional MRR@10 for files and MRR@3 for tools. Difference is current-run minus the indicated heuristic, not current minus historical engine. Historical/current public artifacts have matching declared options, coverage and baseline scores; missing immutable input manifests prevent a stronger identity claim.

The clearest result is tool prediction: its interval against the strongest measured heuristic is positive. The improvement over the historical sequence predictor is descriptive; the artifacts do not include a paired historical-versus-current interval. File results do not support a blanket superiority claim. Both P1 point estimates exceed BM25, but their intervals include zero. Next-file prediction improves over the historical engine while remaining below recency in point estimate, with uncertainty spanning zero.

At three decimal places P1-edit appears unchanged; the raw historical and current values are 0.3067708333 and 0.3072916667. The draft does not interpret this tiny difference as a meaningful improvement.

## 6.3 Local sessions

| Probe | Current run | Best baseline | Difference [95% interval] | Clusters |
|:--|--:|:--|:--|--:|
| P1-edit | 0.703 | Frequency 0.791 | −0.089 [−0.185, 0.000] | 38 |
| P1-read | 0.555 | BM25 0.547 | +0.008 [−0.101, +0.123] | 57 |
| P2 | 0.702 | Recency 0.701 | +0.001 [−0.003, +0.006] | 64 |
| P3 | 0.686 | Recency 0.662 | +0.024 [+0.010, +0.036] | 85 |

Table 4. Secondary, private local cohort, scored under the same eligibility rule. The P1-edit upper endpoint is approximately zero (stored floating-point value $1.46\times10^{-19}$), so we do not claim a strictly negative interval.

Tool prediction again has a positive interval against the strongest observed heuristic. Frequency is substantially better on edited-file point estimates. Read-file and next-file differences are small relative to their intervals. These observations caution against adding memory complexity without simple comparators.

A historical local run exists, but its scanned source count differs from the current run (713 versus 715 sessions). Even though aggregate denominators and comparator scores match, neither artifact retains selected input identities. We therefore omit a controlled local version-to-version claim rather than infer exact cohort identity from matching aggregates.

# 7. Discussion and limitations

**Evidence supports prediction, not productivity.** The agent traces are fixed. Better next-tool prediction may reflect repeated interface conventions rather than transferable task knowledge. The evaluator does not show that suggestions are read, that searches are avoided, or that patches become more correct. A deployment study must measure task outcomes, actual tokenizer counts, failed-action rates and wall-clock cost under randomized or otherwise controlled memory-on/off assignment.

**Coverage conditions the headline scores.** Prior-access candidates exclude unseen files even after their first appearance within a target task. This is intentionally conservative about information leakage, but unlike full-repository retrieval. A broader experiment should report unconditional quality and separate known-resource and novel-resource tasks. The current small P1 cluster counts particularly limit precision.

**Selection and adaptation remain risks.** The public cohort covers two selected test repositories, not broad language or repository diversity. PR-number ordering is only a chronology proxy. The local corpus is private and evolving. Development-informed ranking choices do not constitute a preregistered protocol; evaluation results were inspected during engineering. Repository-level separation alone does not establish that all later design decisions were independent of test observations.

**No causal mechanism attribution.** Multiple ranking mechanisms changed together. The available artifacts do not isolate benefits from asymmetric co-access, base-level features, recurrence, query coverage or the sequence-frequency mixture. No quantitative ablation result is claimed. Similarly, a separate small embedding comparison mentioned in project documentation is omitted because the draft's evidence set does not contain its query manifest and raw outcomes.

**Confidence and feedback are heuristic.** A normalized fusion score is not calibrated relevance. Opens and edits can be prompted by existing agent intent, so credit attribution can reward suggestions that did not help. Ignored suggestions are not necessarily wrong. UCB-style exploration also operates under changing task distributions and imperfect rewards; this paper supplies no regret guarantee or online policy result.

**Security and privacy.** A poisoned repository can manufacture co-accesses, misleading error fingerprints or command histories. Labeling procedure text as observation and constraining paths/commands reduces some presentation risk, but does not authenticate the source or make execution safe. Permission checks and tool-execution authorization must remain outside the memory system. Local databases and raw session logs should be treated as sensitive artifacts. Sanitization is not a guarantee that secrets never enter memory.

**Systems scale.** Per-event windows and per-seed graph expansion are bounded, but the number of resources, associations, logs and procedures is not globally capped by those bounds. If $s$ seeds are expanded with fan-out at most ten and depth at most three, the traversal budget has a worst-case shape proportional to $s(10+10^2+10^3)$ before filtering and deduplication; SQL access, candidate generation and indexing add work. This is not an end-to-end complexity or latency guarantee. Vector-scan fallback, growing logs, file renames and multi-process SQLite contention require separate evaluation.

# 8. Reproducibility and artifact scope

The methods were checked against source revision `0edc2ed728f71d4b986a39e5d56a9dca505b0ab3`. The numerical evidence predates this manuscript revision and comes from these result directories under `eval-results/`:

- Public current: `2026-10-08T18-01-31-878Z`.
- Public historical: `2026-10-08T17-37-06-513Z`.
- Local current: `2026-10-08T18-06-22-676Z`.
- Local historical, not used for controlled version comparison: `2026-10-08T17-42-39-240Z`.

The historical engine loader names commit `9750d2f`. Current-run artifacts record engine mode and options but no source commit hash, parser hash, input manifest or dataset revision. Therefore, the inspected source revision must not be mistaken for a proven executable provenance link to those older runs. Result directories are excluded by the repository's ignore rules; a fresh clone does not include them. The companion `paper/evidence.json` preserves the aggregate fields used for the manuscript plus original-file SHA-256 hashes, without exporting private session text. It is a transcription aid, not a replacement for missing per-probe records or original inputs.

The public replay commands, from the repository root, are:

```bash
npm ci --ignore-scripts
npm rebuild better-sqlite3
npm run eval -- --source nebius --repos 5 \
  --max-tasks-per-repo 20 --split test \
  --embeddings off --engine new --seed 42 --json
npm run eval -- --source nebius --repos 5 \
  --max-tasks-per-repo 20 --split test \
  --embeddings off --engine old --seed 42 --json
```

Skipping install scripts avoids automatically configuring an editor or downloading a model during evaluation setup. Native dependencies still require a working platform toolchain. The historical mode prepares a legacy worktree and may need network/dependency access. Public data selection uses a cache and dataset catalog, so future reruns can differ if that source changes. The local command uses `--source omp` and omits `--split`, reading the invoking user's session directory; it cannot reproduce the private cohort on another machine.

No new benchmark run was performed for this writing revision. Compilation and numerical consistency checks validate the manuscript artifact, not the system's scientific claims. Before an archival submission, frozen public input manifests, a source-pinned rerun, explicit ablations and an online task-success experiment would materially strengthen the evidence. Their absence is a limitation of this completed draft, not an experiment reported as done.

# 9. Conclusion

BrainBox implements local behavioral memory from coding-agent traces without modifying a language model or requiring LLM calls for memory maintenance. In the stored, coverage-conditioned replay results, its most consistent advantage is next-tool prediction. File retrieval is less decisive: frequency wins an important local point comparison, recency remains competitive, and novel files fall outside the measured universe. These findings motivate a narrower research claim than universal memory superiority: lightweight operational history can improve prediction of repeated tool use, while its value for end-to-end software engineering remains to be established.

# Appendix A. All heuristic point comparisons

| Cohort / probe | BrainBox | Recency | Frequency | BM25 | Co-session | Random |
|:--|--:|--:|--:|--:|--:|--:|
| SWE P1-edit | 0.307 | 0.167 | 0.100 | 0.216 | 0.100 | 0.030 |
| SWE P1-read | 0.267 | 0.071 | 0.173 | 0.206 | 0.075 | 0.113 |
| SWE P2 | 0.409 | 0.430 | 0.156 | 0.254 | 0.274 | 0.035 |
| SWE P3 | 0.767 | 0.691 | 0.748 | 0.671 | 0.743 | 0.357 |
| Local P1-edit | 0.703 | 0.577 | 0.791 | 0.447 | 0.158 | 0.138 |
| Local P1-read | 0.555 | 0.397 | 0.431 | 0.547 | 0.011 | 0.142 |
| Local P2 | 0.702 | 0.701 | 0.587 | 0.495 | 0.485 | 0.049 |
| Local P3 | 0.686 | 0.662 | 0.590 | 0.595 | 0.440 | 0.161 |

Table 5. Stored current-run conditional MRR values rounded to three decimals. File and tool cutoffs differ as specified in Section 5.3; no inference should compare them as identical tasks.

# Appendix B. Implementation-to-claim map

| Implementation | Manuscript role | Evidenced by ranking replay? |
|:--|:--|:--|
| `src/hebbian.ts` | Access updates, graph recall, temporal features, fusion, tool prediction | Yes, as a combined system; no isolated attribution |
| `src/policy.ts` | Injection decisions, attribution and reward | No |
| `src/procedures.ts` | Error-fix and workflow mining | No |
| `src/snippets.ts`, `src/codegraph.ts` | Optional source retrieval and structural priors | No populated source index in these runs |
| `src/embeddings.ts` | Optional CPU embedding profiles | Disabled in principal runs |
| `src/eval/` | Selection, parsing, probe timing, comparators and uncertainty | Defines the replay protocol |

# References
