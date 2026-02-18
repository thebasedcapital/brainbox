# BrainBox: Hebbian Memory System for Agents

## Core Concept

A **Wormhole Registry** that learns agent access patterns and creates direct neural pathways to frequently used code locations.

## Architecture

### 1. Neural Path Registry
- Each "neuron" = a file/folder path
- **Synapse weight** = access frequency + recency
- **Activation threshold** = minimum weight to establish wormhole
- **Path pruning** = decay unused connections over time

### 2. Wormhole Categories

#### Direct File Wormholes
```
path: src/api/api.ts
weight: 0.87
access_count: 234
last_used: 5m ago
related_context: ["session management", "websocket", "encryption"]
```

#### Pattern Wormholes
```
pattern: "*auth*.ts" in src/api/
weight: 0.72
query: "authentication flow"
result_cache: [apiSession.ts, auth.ts]
```

#### Semantic Wormholes
```
semantic: "websocket initialization"
resolved_path: src/api/apiSession.ts:45-89
weight: 0.65
context_fingerprint: "socket.io, real_time, session"
```

### 3. Neural Reinforcement Loop

```typescript
agent_query("find session management code")
  ↓
search_wormholes() → low_match → fallback_grep() → success
  ↓
reinforce_path("src/api/apiSession.ts") // +0.15 weight
reinforce_path("src/api/auth.ts")        // +0.08 weight
reinforce_pattern("*session*.ts")        // +0.05 weight
  ↓
prune_unused_connections()              // decay old paths
```

## Key Features

### 1. Context-Aware Paths
- Store query context with each wormhole
- Match queries to context fingerprints
- Semantic similarity scoring

### 2. Hierarchical Learning
- Directory-level neurons → file-level neurons → function-level neurons
- Strengthen parent paths when children accessed
- Cross-reference between related locations

### 3. Session-Local Learning
- Per-session neural weights
- Global baseline weights
- Transfer learning across sessions

### 4. Intelligent Fallback
```
if (wormhole_confidence > 0.7) → direct_access()
else if (wormhole_confidence > 0.4) → hybrid_search()
else → grep_search()
```

## Implementation Approach

### Storage
```typescript
interface NeuronNode {
  path: string;
  weight: number;
  accessHistory: timestamp[];
  contexts: string[];     // Query contexts used
  relatedPaths: string[]; // Strongly connected nodes
  lastAccessed: timestamp;
}

interface WormholeRegistry {
  neurons: Map<string, NeuronNode>;
  global_weights: number;
  decay_rate: 0.01;      // Per day
  learning_rate: 0.1;    // Per access
}
```

### Query Processing
```typescript
function find_file(query: string): string[] {
  // 1. Check semantic wormhole match
  const semantic = match_semantic_wormhole(query);
  if (semantic.score > 0.7) return [semantic.path];

  // 2. Check pattern wormhole
  const pattern = match_pattern_wormhole(query);
  if (pattern.score > 0.5) return pattern.paths;

  // 3. Fallback to grep
  const results = grep_search(query);

  // 4. Reinforce learnings
  reinforce_learning(results, query);

  return results;
}
```

## Benefits

1. **Speed**: 10-100x faster for common operations
2. **Context**: Learns how you work, where you go
3. **Efficiency**: Reduces redundant grep calls
4. **Intelligence**: Proactively suggests related files

## Challenges

1. **Cold Start**: Needs time to build weights
2. **Stale Paths**: Decay rate tuning needed
3. **False Positives**: Need confidence thresholds
4. **Memory**: Registry size for large codebases

---

## Brain-Inspired Architecture: Associative Hebbian Networks

### Key Principles from Neurobiology

**1. Hebbian Learning** - "Neurons that fire together, wire together"
- When you access API + websocket code together → strengthen their synaptic link
- Next query "websocket" → API areas pre-activate (associative recall)

**2. Myelination = Superhighways**
- Frequently used paths get "myelin coating" → 10-100x faster transmission
- Cold paths = bare axon → slow, energy-expensive

**3. Sparse Activation**
- Only ~1-4% of neurons active at any time
- Energy-efficient pattern matching, not brute search

**4. Associative Spreading**
```
query: "websocket setup"
  ↓
activate neuron(node: websocket)
  ↓
spread_activation [session, api, encryption] // +0.3 weight neighbors
  ↓
select_highest_activation() → src/api/apiSession.ts
```

## The Network Model

### Neurons, Not Just Paths

```typescript
interface Neuron {
  id: string;                          // Unique hash
  path: string;                        // File location
  type: 'file' | 'directory' | 'pattern' | 'semantic';
  activation: number;                  // Current signal (0-1)
  synaptic_strength: Map<string, number>; // connections + weights
  myelination: number;                 // 0-1: superhighway status
  contexts: string[];                  // What queries fire this
}
```

### Synaptic Connections (The Magic)

```typescript
// Strongly coupled neurons from joint access patterns
neuron('apiSession.ts').synaptic_strength = {
  'api.ts': 0.82,          // Frequently accessed together
  'auth.ts': 0.67,         // Related patterns
  '*session*.ts': 0.45,     // Pattern association
  'websocket': 0.71,        // Semantic coupling
}
```

## The Brain's Query Algorithm

```
function recall(query: string) {
  // 1. Activate matching neurons (sparse)
  let active = activate_by_keywords(query);

  // 2. Spreading activation - ONE hop
  let spread = [];
  for (neuron in active) {
    spread = spread.concat(
      neuron.synaptic_strength
        .filter(w > 0.5)  // Only strong synapses fire
        .map(neighbor_id)
    );
  }

  // 3. Apply myelination multiplier
  for (neuron in spread) {
    activation *= (1 + neuron.myelination * 9);  // Up to 10x boost
  }

  // 4. Winner-take-all
  return top_3_by_activation();
}
```

## Learning = Synaptic Rewiring

```typescript
function on_access(path: string, query: string, context: string[]) {
  let neuron = neurons.get(path);

  // 1. Strengthen just-used neuron (LTP)
  neuron.myelination += 0.05;
  neuron.contexts.push(query);

  // 2. Hebbian: strengthen neurons that fired together
  for (neighbor in recently_active_neurons) {
    let connection = neuron.synaptic_strength.get(neighbor);

    // Fire together → wire together
    connection = Math.min(connection + 0.1, 1.0);
  }

  // 3. Prune unused (synaptic pruning)
  for (id, weight in neuron.synaptic_strength) {
    if (recent_usage(id) < 7_days && weight < 0.3) {
      delete connection;
    }
  }
}
```

## Myelination = Efficient Path Formation

```typescript
// Cold start: bare axon
src/api/apiSession.ts → myelination: 0.0, access_time: 500ms

// After 50 hits: myelin sheath forming
src/api/apiSession.ts → myelination: 0.4, access_time: 250ms

// After 200 hits: superhighway
src/api/apiSession.ts → myelination: 0.9, access_time: 20ms
```

## Predictive Pre-Activation

The brain **predicts** what you'll need next:

```typescript
function on_complete(task: string) {
  // Pattern: what files usually follow this task?
  let likely_next = predict_next(task);

  // Pre-activate predicted neurons (subthreshold)
  for (path in likely_next) {
    neurons.get(path).activation += 0.2;  // Low-level priming
  }
}
```

Real example:
```
User: "setup websocket connection"
→ accesses: apiSession.ts, api.ts, auth.ts
→ next likely: encryption.ts (strength: 0.73)
→ pre-activate encryption.ts (activation: 0.2)

User: "encrypt the session"
→ encryption.ts already at 0.2
→ query activation adds 0.5 → 0.7
→ wins immediately (no grep needed)
```

## Energy/Efficiency Model

```typescript
function compute_cost(query: string): number {
  // 1. Recall from memory = cheap
  if (cached_activation(query) > 0.8) {
    return 0.01;  // One neuronal spike
  }

  // 2. Spreding activation = moderate
  if (associative_match(query)) {
    return 0.1;   // Few neurons fire
  }

  // 3. Grep/search = expensive
  return 1.0;     // Full filesystem scan
}
```

## The Wormhole Registry as Long-Term Memory

```typescript
interface Hippocampus {
  // Short-term memory buffer
  active_neurons: Set<string>;

  // Recent synapse trace (for Hebbian learning)
  synaptic_trace: Map<string, number>;  // decays over minutes

  // Consolidation to long-term memory
  consolidate() {
    for (neuron in active_neurons) {
      // Move short-term patterns to permanent weights
      if (synaptic_trace.get(neuron) > threshold) {
        strengthen_permanent(neuron);
      }
    }
  }
}
```

## Sparse Architecture = Scaleable

```
Codebase: 10,000 files
Active neurons per query: ~100 (1%)
Synaptic connections per neuron: ~50 (mean)
Computation: 100 neurons * 50 weights = 5,000 multiplications
vs grep: 10,000 file scans * regex per file = 100,000+ operations

Speedup: 20-50x for common patterns
```

## Self-Optimizing Over Sessions

```typescript
// Session 1-10: Build baseline
// Session 10+: Refine predictions

// After 100 agent interactions with "websocket" queries:
- apiSession.ts: myelination 0.87
- api.ts: myelination 0.72
- encryption.ts: myelination 0.58

// Query "setup secure websocket"
→ Immediate 3-step activation
→ No search needed
→ Result in 10ms vs 500ms grep
```

---

## Why This Doesn't Exist in Agent Frameworks

### What Exists Today

#### 1. Vector Databases (Closest, but Static)
- **What it does:** Semantic similarity search with embeddings
- **Missing:** No learning, no synaptic strengthening, static relationships
- **Example:** Chroma, Pinecone, Weaviate

#### 2. GraphRAG / Knowledge Graphs
- **What it does:** Stores relationships between entities
- **Missing:** No Hebbian learning, no myelination, no predictive activation
- **Example:** Microsoft GraphRAG, LangChain

#### 3. Agent Memory Systems
- **What it does:** Store conversation history, state, context
- **Missing:** No pattern learning, no synaptic rewiring
- **Example:** LangGraph, CrewAI, AutoGPT

#### 4. Swarm Coordination
- **What it does:** Multi-agent orchestration (leader-worker, consensus)
- **Missing:** No collective learning across agents
- **Example:** Microsoft AutoGen, OpenAI Swarm

### The Gap

| Brain Feature | Agent Frameworks | Gap |
|--------------|------------------|-----|
| Hebbian learning | ❌ None | No synaptic strengthening |
| Myelination | ❌ None | No speed optimization from reuse |
| Associative activation | ❌ None | No spreading activation patterns |
| Sparse activation | ❌ None | Most use dense search |
| Predictive priming | ❌ None | No anticipation |
| Long-term consolidation | ⚠️ Limited memory | No synaptic pruning/rewiring |

### Why It Doesn't Exist

1. **Agent frameworks are stateless by design** - Each session isolated
2. **Vector DBs dominate** - Industry went embedding route, not brain route
3. **No learning loop** - Agents execute tasks, don't learn patterns
4. **Swarm = distributed compute, not distributed memory** - Coordination focus
5. **Hard to persist** - Synaptic weights need long-term storage across sessions

## The Opportunity

This is **novel** territory. You could build:

**BrainBox**: First agent memory system with Hebbian learning
- Persistent synaptic network
- Myelination-based speed optimization
- Spreading activation for fast recall
- Swarm-wide shared neural memory