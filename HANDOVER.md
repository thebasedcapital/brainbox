# BrainBox Handover — v5.0

> **Date:** 2026-02-17
> **Status:** v5.0 — 7 features inspired by Supermemory & Ars Contexta. Session intent capture, hub detection, staleness detection, project tagging, conversation capture, staleness alerts, and consecutive anti-recall escalation. All features wired into hooks (PostToolUse + UserPromptSubmit) and 8 new CLI commands. 59/59 sandbox tests + 26/26 production verification tests passing. Prior features (v1.0-v4.0) intact.
> **Location:** `~/happy-cli-new/brainbox/`
> **Memory:** `~/.claude/projects/-Users-bbclaude/memory/brainbox-architecture.md`
> **Research:** `~/.claude/projects/-Users-bbclaude/memory/brainbox-self-healing-research.md`
> **Whitepaper:** `~/happy-cli-new/brainbox/WHITEPAPER.md` (Section 11 = v5.0 features)
> **LaTeX paper:** `~/happy-cli-new/brainbox/paper/brainbox.tex`
> **DB:** `~/.brainbox/brainbox.db`

---

## What Is BrainBox

Hebbian memory system for AI agents — learns file access patterns, builds neural pathways, saves tokens. "Neurons that fire together wire together." The first system to apply hardware prefetching intelligence to LLM agent operations.

**Vision (from GLM-5 debate):** "Learn what you touch together, forget what you ignore, predict what you'll need next."

## Current State (v5.0)

### What's Working

**Core (v1.0-v2.0)**
- **Multiplicative confidence formula** — context score GATES everything (if semantic match = 0, confidence = 0 regardless of myelination)
- **Fan effect** (Anderson 1983) — `1/sqrt(min(outDegree, 50))` prevents hub neurons from dominating
- **Tool exclusion** — tool neurons participate as bridges in spreading but never appear in results
- **Anti-recall** — files recalled but never opened get synapse weakening (10% per ignore, floor 0.1)
- **Session state tracking** — `~/.brainbox/session-state.json` bridges prompt hook <-> PostToolUse hook
- **Bootstrap** — multi-source seeder: git history, vault, imports, patterns, sessions, commit neurons
- **Hooks** — PostToolUse (passive learning) + UserPromptSubmit (auto-injection) in `~/.claude/settings.json`
- **MCP** — 7 tools: record, recall, error, resolve, predict_next, stats, decay
- **macOS daemon** — FSEvents + git hooks + frontmost app polling + Unix socket for shell events

**Intelligence (v2.1-v2.3)**
- **v2.1 Benchmark fix** — source code priority (0.3 boost for .ts/.py/.rs, -0.15 for .md), filename stem matching (0.4 bonus), confidence-sorted budget allocation
- **v2.1 Commit learning** — git commits become semantic neurons (message embedding + file list). `predictChangeSet()` matches task intent to historical change-sets
- **v2.2 Predictive pre-load** — first message in session triggers consensus prediction (Hebbian + commit agree, OR single system >= 0.85). Caps at 2 files
- **v2.3 Error fingerprinting** — `extractErrorFingerprint()` categorizes errors into `TYPE_ERROR|property_access` format. O(1) lookup via fingerprint neurons

**Self-Healing (v3.0)**
- **BCM sliding threshold** — myelination rate decreases as neurons become established. `delta = MYELIN_RATE * (1 - myelin/MYELIN_MAX) * max(1/sqrt(accessCount), 0.1)`. Prevents "rich get richer" runaway. (BCM Theory: Bienenstock-Cooper-Munro)
- **SNAP sigmoidal plasticity** — strong synapses resist change, weak synapses are highly plastic. At weight 0.1: 96% plastic. At 0.5: 50%. At 0.8: 8% frozen. Protects established knowledge from being overwritten. (arXiv 2410.15318)
- **Smart tiered pruning** — 3-tier synapse cleanup: dead (<0.05 weight, >7d stale), noise (single co-access, >3d stale), abandoned (<0.3 weight, >30d stale). Plus orphaned neuron cleanup (no connections, low value). (arXiv 2508.09330)
- **Anti-Hebbian noise bridge detection** — during decay, detects synapses connecting to low-activation, low-myelination dead-end neurons. Weakens these by 20% per cycle until they fall below prune threshold. (PLOS CompBio)
- **Auto-decay on session rotation** — daemon triggers self-healing decay when session idle timeout fires (15min). No manual intervention needed.

**Sleep Consolidation (v3.1)**
- **Session replay** — replays top 5 sessions from last 7 days through Hebbian learning at 10% rate. Only strengthens EXISTING synapses, never creates phantom patterns. (Nature Communications: sleep replay)
- **Ebbinghaus spaced repetition** — neurons with >5% myelination that haven't been accessed in 1-7 days get a gentle review boost (25% of BCM-computed delta). Neurons that miss all review windows (>7d) get extra 5% decay. (arXiv 2601.03938 FOREVER)
- **Cross-session pattern discovery** — finds file pairs that co-occur in 3+ different sessions but lack strong synapses. Creates weak seed synapses (0.15) that need real access confirmation to survive pruning. Now also tags these for capture (v3.2). (Frontiers CompNeuro: reward-based consolidation)
- **Consolidation runs on daemon idle + shutdown** — integrated into session rotation (after decay) and graceful shutdown handler
- **CLI:** `brainbox consolidate` or `brainbox sleep`

**Homeostasis (v3.2) — NEW**
- **Global synaptic scaling** — when avg myelination exceeds target (0.15), multiplicatively scales ALL file neuron myelination down by `target/avg`. Same for avg synapse weight (target 0.35). Preserves relative ranking while preventing inflation from repeated consolidation. (eLife 88376)
- **Per-neuron activation homeostasis** — neurons with access_count > 3× network average get 10% myelination reduction. Prevents hub neurons (like `index.ts`) from monopolizing recall through sheer access volume. Underactive neurons with myelination > 5% and access_count < 1/3 average get a 5% boost. (eLife 88376: local homeostatic regulation)
- **Synaptic tagging + capture** — new synapses are tagged with a timestamp. If a related access confirms the pattern within 1 hour, the synapse is immediately boosted to 0.3 (one-shot learning). Expired tags are cleaned during decay. Cross-session discoveries from consolidate() are also tagged, giving them a capture window. (Eur J Neurosci ejn.70258)
- **CLI:** `brainbox homeostasis` (standalone) or included in `brainbox decay` output
- **DB migration:** `tagged_at TEXT DEFAULT NULL` column added to synapses table

**Complementary Learning Systems (v3.3) — NEW**
- **Temporal proximity discovery** — finds file pairs accessed within 60 seconds of each other across 3+ occasions, regardless of session boundaries. Weight scaled by temporal distance (closer = stronger seed 0.15-0.30). Tagged for v3.2 capture. (Nature Comms 2025: dual-speed CLS)
- **Directional synapse weighting** — uses `access_order` to discover A→B patterns. If file A is consistently accessed before file B (ratio > 2:1), the forward synapse gets a 20% boost. Files opened in sequence develop directional memory.
- **Multi-file triplet mining** — discovers {A,B,C} patterns where all three pairs exist in cross-session data. Triplet synapses get a bonus weight (0.05 per edge). Finds architectural patterns beyond simple pairs.
- **Episodic pruning** — after consolidation, prunes access_log rows older than 30 days and caps at 5000 total. Episodic traces fade after patterns are consolidated into semantic memory. Prevents unbounded growth.
- **Episodic recall** — new `recallEpisodic()` queries access_log directly for recent working context. Finds sessions where similar queries were used, returns co-accessed files. Merged into `recall()` as an additional source (activation_path: 'episodic'). Also available standalone: `brainbox recall-episodic <query>`.
- **busy_timeout pragma** — `PRAGMA busy_timeout = 5000` prevents SQLITE_BUSY errors when hooks and CLI access the DB concurrently.

**Snippet Neurons — System 2 (v4.0) — NEW**
- **Tree-sitter extraction** — `web-tree-sitter` (WASM) parses TypeScript, JavaScript, Python, Rust, Swift. Extracts exported functions, classes, methods >=5 lines. Grammar WASMs stored in `grammars/` directory.
- **Snippet table** — separate from neurons table (snippets don't participate in Hebbian spreading). Schema: `id, parent_neuron_id (FK → neurons), name, kind, start_line, end_line, source, embedding (384-dim BLOB), content_hash, created_at, updated_at`. CASCADE delete when parent neuron is removed.
- **Embedding** — each snippet embedded as `"{kind} {name}\n{source[:500]}"` using same MiniLM-L6-v2. Production: 1484 snippets, 100% embedded.
- **Search** — SQLite BLOB scan + in-memory cosine similarity. Confidence gate at 0.35 (lower than Hebbian's 0.4 since no myelination bonus). ~50ms for 1484 snippets.
- **Merge with Hebbian** — snippets always run in parallel with Hebbian recall. Results aggregated to parent file neurons. If both systems find same file: 15% consensus bonus. If only snippets: pure `snippet` activation path. Snippet details (name, kind, line range) attached to RecallResult.
- **Key insight:** Removed confidence-gated routing (0.7 threshold). Hub myelination made Hebbian always exceed 0.7, gating snippets permanently. Now always-on.
- **CLI:** `brainbox extract-snippets [--force] [--no-embed]` — batch extracts from all file neurons.
- **DB migration:** v4.0 — `snippets` table + indexes on `parent_neuron_id` and `name`.
- **Stats:** snippet count shown in `brainbox stats` output.
- **Recall output:** snippet matches shown with function name, kind, and line range.

**Supermemory + Ars Contexta Features (v5.0) — NEW**
- **Session intent capture** — stores first message as session intent. `setSessionIntent(text)`, `getSessionIntent()`, `getRecentSessions(days)`. Auto-captured from first prompt via UserPromptSubmit hook. CLI: `brainbox intent [text]`, `brainbox sessions [--days 7]`.
- **Hub detection** — surfaces most-connected neurons by out-degree with top connections sorted by weight. `getHubs(limit)` returns `HubInfo[]`. CLI: `brainbox hubs [--limit 10]`.
- **Staleness detection** — finds neurons with high myelination but old last_accessed. Projects future decay via `myelin * 0.995^days`. `detectStale(opts)` returns `StaleNeuron[]`. CLI: `brainbox stale [--min-myelin 0.1] [--days 7]`.
- **Project tagging** — auto-tags file neurons with project name derived from cwd path. `tagProject(root, name)`, `getProjectNeurons(name)`, `recallForProject(opts)`. Auto-tagged via PostToolUse hook. CLI: `brainbox projects`, `brainbox tag-project <path> <name>`.
- **Conversation capture** — extracts keywords from user messages (stopword-filtered, frequency-sorted), creates semantic neuron at `session:<id>`. `captureSessionContext(messages)`. Recallable via standard recall.
- **Staleness alerts** — formatted string for prompt injection when superhighways are decaying. `getStalenessAlerts(opts)` → `"Stale superhighways: auth.ts (82%→71% myelin, 14d idle)"` or null. Injected via UserPromptSubmit hook.
- **Anti-recall escalation** — tracks consecutive ignore streaks per neuron. Escalating decay: `effective_decay = 1 - (1 - 0.1)^streak`. `applyAntiRecallEscalated()` replaces `applyAntiRecall()`. `getIgnoreStreaks()` for inspection. CLI: `brainbox streaks`.
- **Schema migration v5:** `sessions.intent TEXT`, `neurons.project TEXT`, `neurons.ignore_streak INTEGER`

### Production Verification (v5.0, 2026-02-17)

```
Production DB: 453 neurons, 25,740 synapses, 4 superhighways

  679 sessions in last 7 days, 3 with intent captured
  Top hub: Bash (out-degree 452, top connection → Read at 98.3%)
  63 neurons tagged as "brainbox" project, 384 untagged
  Captured session neuron recallable at 100% confidence
  Anti-recall escalation: 1st ignore drops 0.060, 2nd drops total 0.163 (escalating)
  Streak reset on file open confirmed

  26/26 production tests passed
  59/59 sandbox tests passed
```

### Benchmark Results (15-query suite)
| Version | Accuracy | Key Change |
|---------|----------|-----------|
| Pre-v1.0 (additive, no fan) | 2/15 (13%) | Tool neurons dominated everything |
| v1.0 sandbox (fan + multiplicative + no tools) | 10/15 (67%) | Sandbox-only, not deployed |
| **v2.0 deployed** | **8/15 (53%)** | Formula changes in actual engine |
| v2.1 benchmark fix | improved | Source code priority + stem matching + sorted budget |

---

## v3.0 Self-Healing — Technical Details

### BCM Myelination (replaces constant-rate growth)

```typescript
// Old: delta = 0.02 * (1 - myelin)                        // constant rate, asymptotic only
// New: delta = 0.02 * (1 - myelin/0.95) * 1/sqrt(access)  // BCM + access dampening

private computeMyelinDelta(currentMyelin: number, accessCount: number): number {
  const bcmFactor = 1 - (currentMyelin / MYELIN_MAX);       // 1.0 at 0%, 0.0 at 95%
  const accessDampening = 1 / Math.sqrt(Math.max(accessCount, 1));
  return MYELIN_RATE * bcmFactor * Math.max(accessDampening, 0.1);  // floor at 10%
}
```

Effect: fileA after 10 accesses gets 0.09 myelin (was 0.17). Hubs with 100+ accesses barely grow.

### SNAP Plasticity (applied to synapse updates)

```typescript
// Sigmoid: strong synapses are nearly frozen
private snapPlasticity(currentWeight: number): number {
  return 1 / (1 + Math.exp(8 * (currentWeight - 0.5)));
}
// Applied in Hebbian learning loop: adjustedDelta = baseDelta * snapPlasticity(currentWeight)
```

Requires a weight lookup before each upsert (`getSynapseWeight` prepared statement).

### Smart Pruning (replaces flat threshold)

```sql
DELETE FROM synapses WHERE
  (weight < 0.05 AND last_fired < datetime('now', '-7 days'))    -- dead
  OR (weight < 0.15 AND co_access_count <= 1 AND last_fired < datetime('now', '-3 days'))  -- noise
  OR (weight < 0.3 AND last_fired < datetime('now', '-30 days'))  -- stale

-- Plus orphan cleanup:
DELETE FROM neurons WHERE type = 'file' AND access_count < 3 AND myelination < 0.05
  AND id NOT IN (SELECT source_id FROM synapses UNION SELECT target_id FROM synapses)
```

### Noise Bridge Detection

```sql
-- Find synapses connecting to dead-end low-value neurons
SELECT s.source_id, s.target_id FROM synapses s
JOIN neurons n ON n.id = s.target_id
WHERE s.weight < 0.3 AND s.co_access_count <= 2
  AND n.activation < 0.1 AND n.myelination < 0.05 AND n.type = 'file'
```

Each noise bridge is weakened by 20% per decay cycle.

## v3.1 Sleep Consolidation — Technical Details

### `consolidate()` Method — 3 Phases

**Phase 1: Session Replay**
```typescript
// Query top 5 sessions from last 7 days with >= 5 accesses
// Replay access sequence through co-access window with CONSOLIDATION_DELTA = 0.01 (10% of LEARNING_RATE)
// SNAP plasticity applied to consolidation too — strong synapses resist further strengthening
// KEY: Only strengthens EXISTING synapses. Never creates new ones.
```

**Phase 2: Ebbinghaus Spaced Repetition**
```typescript
// Neurons with >5% myelination, accessed 1-7 days ago → gentle review boost
// boost = computeMyelinDelta(myelin, accessCount) * 0.25
// Neurons that missed all windows (>7 days) → extra 5% myelination decay
```

**Phase 3: Cross-Session Pattern Discovery**
```sql
-- Find file pairs co-occurring in 3+ different sessions
SELECT a1.neuron_id as n1, a2.neuron_id as n2, COUNT(DISTINCT a1.session_id) as sessions
FROM access_log a1
JOIN access_log a2 ON a1.session_id = a2.session_id AND a1.neuron_id < a2.neuron_id
WHERE a1.timestamp > datetime('now', '-7 days')
GROUP BY a1.neuron_id, a2.neuron_id
HAVING sessions >= 3
-- New pairs get seed synapse at 0.15 + tagged for capture (v3.2).
-- Weak existing pairs (<0.2) get bumped.
```

## v3.2 Homeostasis — Technical Details

### Global Synaptic Scaling

```typescript
// Compute network averages
const avgMyel = SELECT AVG(myelination) FROM neurons WHERE type = 'file';
const avgWeight = SELECT AVG(weight) FROM synapses;

// If above target, scale multiplicatively (preserves relative ranking)
if (avgMyel > 0.15) UPDATE neurons SET myelination = myelination * (0.15 / avgMyel);
if (avgWeight > 0.35) UPDATE synapses SET weight = weight * (0.35 / avgWeight);
```

**Key insight:** Multiplicative scaling preserves signal-to-noise ratio. A neuron at 0.6 myelination stays 4× stronger than one at 0.15 — both just get proportionally reduced. This prevents consolidation from inflating the entire network over repeated runs.

### Per-Neuron Activation Homeostasis

```typescript
// Compute average access count for file neurons
const avgAcc = SELECT AVG(access_count) FROM neurons WHERE type = 'file' AND access_count > 0;

// Hyperactive: access_count > 3× average → dampen myelination by 10%
UPDATE neurons SET myelination = myelination * 0.9 WHERE type = 'file' AND access_count > @threshold;

// Underactive but valuable: access_count < avg/3, myelination > 5% → boost 5%
UPDATE neurons SET myelination = MIN(myelination * 1.05, 0.95) WHERE type = 'file'
  AND access_count < @threshold AND myelination > 0.05;
```

### Synaptic Tagging + Capture

```typescript
// 1. In record(): when a NEW synapse is created (fwdWeight === 0 before upsert), tag it
if (fwdWeight === 0) tagSynapse(source, target, now);

// 2. In record(): check for tagged synapses connected to current neuron
const tagged = getTaggedSynapses(neuronId);  // within 1-hour capture window
for (const syn of tagged) {
  captureSynapse(syn.source, syn.target, weight: 0.3);  // boost + clear tag
}

// 3. In consolidate(): cross-session discoveries also get tagged
tagSynapse(pair.n1, pair.n2, now);  // gives 1-hour window for confirmation

// 4. In decay/homeostasis(): expired tags cleaned
UPDATE synapses SET tagged_at = NULL WHERE tagged_at < datetime('now', '-60 minutes');
```

**Effect on test data:** Synaptic capture gives new synapses a head start (0.3 vs natural ~0.1). In verify-raw-sql.ts, A→B weight converges at 0.612 (was 0.576 without capture). This is correct — early confirmation of a pattern should accelerate its establishment.

### `homeostasis()` Return Type

```typescript
interface HomeostasisResult {
  myelin_scaled: boolean;        // was global myelin scaling triggered?
  myelin_scale_factor: number;   // 1.0 = no scaling needed
  weight_scaled: boolean;        // was global weight scaling triggered?
  weight_scale_factor: number;   // 1.0 = no scaling needed
  neurons_dampened: number;      // hyperactive neurons dampened
  neurons_boosted: number;       // underactive but valuable neurons boosted
  tags_expired: number;          // expired tags cleared
}
```

### Updated `DecayResult` (v3.2)

```typescript
interface DecayResult {
  pruned_synapses: number;
  pruned_neurons: number;
  pruned_orphans: number;
  weakened_noise_bridges: number;
  homeostasis: HomeostasisResult;  // v3.2: added
}
```

## v3.3 Complementary Learning Systems — Technical Details

### Architecture: Dual-Speed Memory

```
FAST (Episodic):  access_log  →  raw events, queries, timestamps, session IDs
                                  captured instantly on every tool use
                                  pruned after 30 days / 5000 rows

SLOW (Semantic):  neurons     →  files, tools, errors, concepts
                  synapses    →  weighted connections, co-access patterns
                                  built gradually through Hebbian learning
                                  consolidated from episodic via CLS pipeline

CONSOLIDATION:    episodic → semantic transfer during daemon idle / shutdown
                  7 phases: replay, Ebbinghaus, cross-session, temporal,
                  directional, triplets, pruning
```

### Phase 4: Temporal Proximity Discovery

```sql
-- Find file pairs accessed within 60 seconds across 3+ occasions
SELECT a1.neuron_id as n1, a2.neuron_id as n2,
  COUNT(*) as proximity_count,
  AVG(ABS(JULIANDAY(a1.timestamp) - JULIANDAY(a2.timestamp)) * 86400) as avg_seconds
FROM access_log a1
JOIN access_log a2 ON a1.neuron_id < a2.neuron_id
  AND ABS(JULIANDAY(a1.timestamp) - JULIANDAY(a2.timestamp)) < (60.0 / 86400)
  AND a1.id != a2.id
WHERE a1.timestamp > datetime('now', '-14 days')
GROUP BY a1.neuron_id, a2.neuron_id
HAVING proximity_count >= 3
```

Weight = `0.15 + 0.15 * (1 - avg_seconds/60)`. Files accessed 5s apart get 0.29, files 50s apart get 0.17.

### Phase 5: Directional Synapse Weighting

```sql
-- Find A→B patterns: A accessed before B within 5 steps
SELECT a1.neuron_id as first_id, a2.neuron_id as second_id, COUNT(*) as cnt
FROM access_log a1
JOIN access_log a2 ON a1.session_id = a2.session_id
  AND a1.neuron_id != a2.neuron_id
  AND a1.access_order < a2.access_order
  AND (a2.access_order - a1.access_order) <= 5
WHERE a1.timestamp > datetime('now', '-14 days')
GROUP BY a1.neuron_id, a2.neuron_id
HAVING cnt >= 5
```

If forward count > 2× reverse count, forward synapse gets 20% boost (SNAP-modulated).

### Phase 6: Multi-File Triplet Mining

Post-processes cross-session pairs from Phase 3. For each node, checks if any two neighbors are also connected. If {A,B,C} forms a complete triangle, all three edges get a 0.05 bonus (SNAP-modulated). Neighbor scan capped at 20 to avoid O(n³).

### Phase 7: Episodic Pruning

```sql
DELETE FROM access_log WHERE timestamp < datetime('now', '-30 days');
-- If still > 5000 rows, keep only newest 5000
DELETE FROM access_log WHERE id NOT IN (
  SELECT id FROM access_log ORDER BY timestamp DESC LIMIT 5000
);
```

### Episodic Recall

```typescript
recallEpisodic(query: string, limit: number = 5): RecallResult[] {
  // 1. Find sessions where query keywords appeared in access_log.query
  // 2. Get all neurons from those sessions, ranked by frequency
  // 3. Score: freqFactor * (0.5 + recencyFactor * 0.5)
  //    freqFactor = min(count/5, 1), recencyFactor = 1 - ageHours/168
  // 4. Filter by CONFIDENCE_GATE (0.4), return with activation_path: 'episodic'
}
```

Merged into `recall()`: episodic results are deduped with semantic results (max confidence wins).

### Updated `ConsolidationResult` (v3.3)

```typescript
interface ConsolidationResult {
  sessions_replayed: number;
  synapses_strengthened: number;
  neurons_reviewed: number;
  neurons_forgotten: number;
  patterns_discovered: number;
  temporal_pairs_found: number;     // v3.3: temporal proximity
  directional_boosts: number;       // v3.3: directional weighting
  triplets_found: number;           // v3.3: multi-file patterns
  episodic_rows_pruned: number;     // v3.3: episodic pruning
}
```

### Verified First Run (production data, 17k neurons, 75k synapses)

```
Consolidation:
  Sessions replayed:     4
  Synapses strengthened: 5824
  Temporal pairs:        7         ← files accessed within 60s, 3+ times
  Directional boosts:    131       ← A→B patterns confirmed
  Triplets:              0         ← no complete triangles (expected — pairs too sparse)
  Episodic pruned:       0         ← all data within 30 days
```

### Stress Test Results (8 decay+consolidate cycles on bootstrapped 75k network)

```
                          BEFORE        AFTER (8 cycles)   CHANGE
Neurons                   17,125        17,108             -17 pruned
Synapses                  75,660        75,388             -272 pruned
Avg weight                0.307         0.142              -54% (healthy decay)
Strong (0.5+)             2,542         160                -94% (only real patterns survive)
Performance               —             0.48s decay + 0.27s consolidate per cycle
```

### Verified First Run (production data)

```
Decay:
  Pruned synapses:        78
  Pruned neurons:         0
  Pruned orphans:         0
  Weakened noise bridges: 0
  Homeostasis:
    Myelin scaled:    no (within 0.15 target)
    Weight scaled:    yes (×0.957)     ← avg weight slightly above 0.35 after pruning raised average
    Neurons dampened: 1                ← one hyperactive hub dampened
    Neurons boosted:  0
    Tags expired:     0                ← fresh deploy, no tags yet
```

---

## Key Constants (v3.0-v3.2)

| Constant | Value | Purpose |
|----------|-------|---------|
| `LEARNING_RATE` | 0.1 | Synapse strengthening per co-access |
| `MYELIN_RATE` | 0.02 | Base myelination rate (BCM modulates this) |
| `MYELIN_MAX` | 0.95 | Asymptotic ceiling |
| `SNAP_STEEPNESS` | 8 | Sigmoid steepness for SNAP plasticity |
| `SNAP_MIDPOINT` | 0.5 | Midpoint weight for SNAP transition |
| `NOISE_BRIDGE_DECAY` | 0.2 | 20% decay per cycle for noise bridges |
| `NOISE_BRIDGE_MAX_CO_ACCESS` | 2 | Max co-access to qualify as noise |
| `NOISE_BRIDGE_MAX_ACTIVATION` | 0.1 | Max target activation for noise |
| `NOISE_BRIDGE_MAX_MYELINATION` | 0.05 | Max target myelination for noise |
| `CO_ACCESS_WINDOW_SIZE` | 25 | Last 25 unique files form co-access pairs |
| `CONFIDENCE_GATE` | 0.4 | Min confidence to return recall results |
| `HIGH_CONFIDENCE` | 0.7 | Skip search entirely |
| `FAN_DEGREE_CAP` | 50 | Max out-degree for fan effect calc |
| `MYELIN_CAP_IN_CONFIDENCE` | 0.5 | Soft cap on myelin's contribution to confidence |
| `ANTI_RECALL_BASE_DECAY` | 0.1 | 10% decay per ignored session |
| `ANTI_RECALL_FLOOR` | 0.1 | Never forget permanently |
| `ERROR_FIX_RESOLVE_WEIGHT` | 0.85 | Strong error->fix wiring |
| `HOMEOSTASIS_MYELIN_TARGET` | 0.15 | v3.2: ideal average myelination |
| `HOMEOSTASIS_WEIGHT_TARGET` | 0.35 | v3.2: ideal average synapse weight |
| `HOMEOSTASIS_HYPERACTIVE_MULT` | 3 | v3.2: hyperactive = access > avg × 3 |
| `HOMEOSTASIS_UNDERACTIVE_DIV` | 3 | v3.2: underactive = access < avg / 3 |
| `HOMEOSTASIS_DAMPEN` | 0.9 | v3.2: 10% myelination reduction for hubs |
| `HOMEOSTASIS_BOOST` | 1.05 | v3.2: 5% myelination increase for underactive |
| `TAG_CAPTURE_WINDOW_MINUTES` | 60 | v3.2: 1-hour capture window for tagged synapses |
| `TAG_CAPTURE_WEIGHT` | 0.3 | v3.2: weight boost when tag is captured |
| `MYELIN_DAILY_DECAY` | 0.995 | v5.0: daily myelination decay rate for staleness projection |

## Confidence Formula (v2.1, unchanged through v3.2)

```
contextScore = cosine_similarity(query_embedding, neuron_embedding)   // 0-1
  if stemMatch: contextScore = max(contextScore, 0.5)                 // filename floor
myelinBonus  = min(myelination, 0.5) * 0.3
recencyBonus = max(0, 1 - age_hours/168) * 0.2
pathBonus    = keyword_match_ratio * 0.4
stemBonus    = 0.4 if query keyword matches filename stem (min 4 chars)
typeBonus    = +0.3 (source code) | -0.15 (docs) | 0 (other)

confidence = contextScore * (1 + myelinBonus + recencyBonus + pathBonus + stemBonus + typeBonus)
```

Context is a **gate**: if contextScore = 0, confidence = 0. Other bonuses are **amplifiers**.

## Spreading Activation (v2.0, unchanged through v3.2)

```
for each seed in frontier:
  fan_factor = 1 / sqrt(min(out_degree, 50))     // Anderson 1983

  for each synapse from seed (weight > 0.3, top 10):
    if target.type == "tool": skip                 // bridges only, never results
    spread = seed.conf * syn.weight * (1 + min(target.myelin, 0.5)) * fan_factor
    if spread < 0.4: skip
    // Collins & Loftus convergence: take MAX across paths
```

---

## What Needs To Be Done (Priority Order)

### 1. Pattern Layer (v5.1)

**What:** Learn abstract architectural preferences ("user prefers adapter pattern"). Structural inference from naming conventions (`*-adapter.ts`, `class X implements Y`). Depends on snippet neurons (v4.0) for code structure awareness.

### 2. Daemon Snippet Re-extraction

**What:** Wire FSEvents file-modify events to debounced snippet re-extraction. Currently snippets are only updated via `brainbox extract-snippets` CLI. Low priority since files don't change that often.

### 3. Fix verify-raw-sql.ts Production DB Nuke

**What:** Line 28 deletes all production data. Should use `:memory:` or a test-specific DB path. Quick fix but keeps getting deprioritized.

### 4. FAISS/Quantized Vector Index

**What:** When snippet count exceeds ~50k, SQLite BLOB scan becomes slow. Add optional FAISS IVF index or quantize embeddings to int8 for faster search. Not needed yet (1484 snippets, <50ms).

### 5. Per-Project Recall Scoping via Tags

**What:** Use v5.0 project tags to scope recall to current project automatically. Currently `recallForProject()` exists but isn't wired into the prompt hook. Would reduce cross-project noise.

---

## File Map

```
brainbox/
├── src/
│   ├── hebbian.ts         # Core engine — record, recall, recallEpisodic, decay, consolidate, homeostasis (v3.0-v3.3), snippet merge (v4.0), v5.0 features
│   ├── snippets.ts        # [v4.0] Tree-sitter extraction + snippet search (TS/JS/Python/Rust/Swift)
│   ├── adapter.ts         # DomainAdapter interface + performRecall + anti-recall (escalated) + staleness alerts + intent capture + project auto-tag
│   ├── adapters/
│   │   ├── claude-code.ts # Claude Code adapter (PostToolUse events + prompt enrichment)
│   │   ├── kilo.ts        # Kilo adapter (ACP event stream)
│   │   ├── kilo-record.ts # Kilo recording entry (stdin→BrainBox)
│   │   └── kilo-recall.ts # Kilo recall entry (stdin→stdout)
│   ├── kilo-plugin.ts     # Native Kilo/OpenCode plugin (3 hooks)
│   ├── db.ts              # SQLite schema: neurons, synapses, access_log, sessions, snippets (v4.0), v5 migration (intent, project, ignore_streak)
│   ├── embeddings.ts      # Lazy-loaded Xenova/all-MiniLM-L6-v2 (384 dims, cosine similarity)
│   ├── commit-learning.ts # [v2.1] Change-set prediction from git commits
│   ├── bootstrap.ts       # Multi-source seeder: git, vault, imports, patterns, sessions, commits
│   ├── daemon.ts          # macOS FSEvents daemon (v3.0: auto-decay, v3.1: consolidation, v3.2: homeostasis logging)
│   ├── cli.ts             # CLI: record, recall, extract-snippets, stats, decay, consolidate/sleep, homeostasis, daemon, hubs, stale, projects, tag-project, intent, sessions, streaks, etc.
│   ├── mcp.ts             # MCP server (7 tools)
│   ├── hook.ts            # Claude Code PostToolUse hook (+ v5 project auto-tagging)
│   ├── prompt-hook.ts     # UserPromptSubmit hook (+ v5 intent capture, staleness alerts)
│   ├── verify.ts          # 10 math verification tests
│   ├── verify-raw-sql.ts  # 17 raw SQL checks (v3.2: updated for tag+capture weight expectations)
│   └── test.ts            # 59 tests (40 existing + 19 v5.0), all passing
├── paper/                 # LaTeX academic paper
│   ├── brainbox.tex       # 901-line LaTeX paper
│   ├── brainbox.pdf       # Compiled paper
│   ├── gemini-review.md   # Gemini peer review
│   └── gemini-review.pdf
├── tasks/
│   └── todo.md
├── grammars/              # [v4.0] Tree-sitter WASM grammars (TS, JS, Python, Rust)
├── WHITEPAPER.md          # Academic whitepaper (~5000 words)
├── HANDOVER.md            # This file
├── RESEARCH-HOOKS.md      # macOS passive hooks research
└── package.json           # better-sqlite3, @modelcontextprotocol/sdk, @huggingface/transformers, fsevents, web-tree-sitter
```

## macOS Daemon

Architecture diagram, features, config, and CLI usage unchanged from v2.0.

**v3.0:** Daemon runs `engine.decay()` on session idle timeout (15min). Logs self-healing stats.
**v3.1:** Daemon runs `engine.consolidate()` after decay on session rotation AND on graceful shutdown.
**v3.2:** Daemon logs homeostasis results (scaling factors, dampened/boosted counts) when homeostasis triggers during decay.
**v3.3:** Consolidation now includes CLS phases (temporal, directional, triplets, episodic pruning). No daemon changes needed.
**v4.0:** No daemon changes. Snippet extraction via CLI only. Future: debounced re-extraction on file modify events.
**v5.0:** No daemon changes. All v5 features operate through hooks (PostToolUse auto-tags projects, UserPromptSubmit captures intent + injects staleness alerts) and engine methods.

## How To Run

```bash
cd ~/happy-cli-new/brainbox

# Recall
npx tsx src/cli.ts recall "authentication flow"

# Stats
npx tsx src/cli.ts stats

# Self-healing decay (v3.0, includes homeostasis since v3.2)
npx tsx src/cli.ts decay

# Homeostasis only (v3.2)
npx tsx src/cli.ts homeostasis

# Sleep consolidation (v3.1, CLS phases added in v3.3)
npx tsx src/cli.ts consolidate   # or: npx tsx src/cli.ts sleep

# Embed all neurons
npx tsx src/cli.ts embed

# Extract snippets (v4.0) — tree-sitter extraction + embedding
npx tsx src/cli.ts extract-snippets           # skip files with existing snippets
npx tsx src/cli.ts extract-snippets --force   # re-extract all
npx tsx src/cli.ts extract-snippets --no-embed  # extract only, skip embedding

# Bootstrap a new repo
npx tsx src/cli.ts bootstrap --repo /path/to/repo --auto --imports --sessions

# Episodic recall (v3.3) — query access_log directly
npx tsx src/cli.ts recall-episodic "authentication flow"

# v5.0 commands
npx tsx src/cli.ts hubs               # hub detection — most connected neurons
npx tsx src/cli.ts stale              # staleness detection — decaying superhighways
npx tsx src/cli.ts projects           # list project tags and neuron counts
npx tsx src/cli.ts tag-project /path name  # tag neurons under path with project name
npx tsx src/cli.ts intent "working on auth"  # set session intent
npx tsx src/cli.ts sessions           # list recent sessions with intents
npx tsx src/cli.ts streaks            # show anti-recall ignore streaks

# Daemon (auto-decays + consolidates + homeostasis on session rotation and shutdown)
npx tsx src/cli.ts daemon start
npx tsx src/cli.ts daemon status

# Commit predictions
npx tsx src/cli.ts commits "fix authentication"

# Verification
npx tsx src/test.ts            # 59 sandbox tests (all pass)
npx tsx src/verify.ts          # 10 math tests (2 known failures from formula changes)
npx tsx src/verify-raw-sql.ts  # 17 raw SQL checks (all pass)
```

## Known Issues

1. **verify.ts Tests 3 & 10 fail** — Pre-existing: window size + multiplicative confidence differences.
2. ~~**test.ts has 7 failures**~~ — **FIXED in v5.0**: 59/59 tests now passing.
3. **verify-raw-sql.ts nukes production DB** — Line 28 deletes all data before running test assertions. Should use `:memory:` or a test-specific DB path.
4. **Anti-recall has no CLI command** — `flushAntiRecall()` exists in adapter.ts but no CLI subcommand.
5. **Daemon not integrated with anti-recall tracking** — daemon records events directly, not through anti-recall path.

## NeuroVault (OpenClaw Plugin)

BrainBox ported to OpenClaw as NeuroVault. Separate codebase at `~/Projects/neurovault/`. Does NOT have v2.0+ changes. If upgrading NeuroVault, port from `hebbian.ts`.

## Research References

- **Self-healing research:** `~/.claude/projects/-Users-bbclaude/memory/brainbox-self-healing-research.md` (18 papers, implementation roadmap)
- **Architecture doc:** `~/.claude/projects/-Users-bbclaude/memory/brainbox-architecture.md`
- **Whitepaper Section 10:** Dual-process memory roadmap
- **Key papers:** Anderson 1983 (fan effect), BCM Theory (sliding threshold), arXiv 2410.15318 (SNAP), arXiv 2508.09330 (synaptic pruning), PLOS CompBio (anti-Hebbian), Nature Comms (sleep replay), arXiv 2601.03938 (FOREVER forgetting curve), eLife 88376 (homeostatic scaling), Eur J Neurosci ejn.70258 (synaptic tagging + capture), Nature Comms s41467-025-56405-9 (complementary learning systems)

## Commit History

| Hash | Date | Description |
|------|------|-------------|
| `eda9182` | 2026-02-15 | v1.0 sandbox results + whitepaper + architecture doc updates |
| `ff57918` | 2026-02-15 | v2.0: anti-recall, daemon, LaTeX paper, multiplicative confidence, fan effect |
| `da6a3e0` | 2026-02-15 | v2.1-2.3: benchmark fix, commit learning, pre-load, error fingerprinting |
| `2aacc5c` | 2026-02-16 | v3.0: self-healing core (BCM, SNAP, smart pruning, noise bridges) |
| `646619d` | 2026-02-16 | docs: handover update to v3.0 |
| `7a23dca` | 2026-02-16 | v3.1: sleep consolidation (session replay, Ebbinghaus, cross-session) |
| `29d885e` | 2026-02-16 | docs: handover update to v3.1 |
| `b56d108` | 2026-02-16 | v3.2: homeostasis (global scaling, activation homeostasis, synaptic tagging + capture) |
| `cc3f0bf` | 2026-02-16 | v3.3: complementary learning systems (temporal, directional, triplets, episodic) |
| `ca452df` | 2026-02-16 | docs: handover update to v3.3 |
| `8f444a7` | 2026-02-16 | v4.0: snippet neurons (tree-sitter extraction, System 2 semantic code search) |
| `1a24dd4` | 2026-02-17 | v5.0: 7 features inspired by Supermemory & Ars Contexta (engine + 19 tests) |
| `34f52f9` | 2026-02-17 | v5.0: hook integration, 8 CLI commands, whitepaper Section 11 |
