import { performance } from 'node:perf_hooks';
import { embedText, EMBEDDING_MODEL_ID, cosineSimilarity } from "../embeddings.js";
import { extractSnippets, snippetEmbeddingText } from "../snippets.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const pairs: [string,string,string][] = [
 ['hebbian.ts','normalizeError','normalize changing line numbers and paths in error messages'],
 ['hebbian.ts','extractErrorFingerprint','extract stable error type operation fingerprint'],
 ['hebbian.ts','HebbianEngine.clearCoAccessWindow','reset the recently accessed files coaccess window'],
 ['hebbian.ts','HebbianEngine.seedNeuron','initialize a file memory without recording real access'],
 ['hebbian.ts','HebbianEngine.appendContext','append deduplicated context to a neuron'],
 ['hebbian.ts','HebbianEngine.seedSynapse','initialize a bidirectional association between files'],
 ['hebbian.ts','HebbianEngine.computeMyelinDelta','compute diminishing returns myelination growth'],
 ['hebbian.ts','HebbianEngine.snapPlasticity','calculate sigmoid synaptic plasticity'],
 ['hebbian.ts','HebbianEngine.record','record a file access and strengthen coaccess synapses'],
 ['hebbian.ts','HebbianEngine.recordError','record error memory associate recently accessed files'],
 ['hebbian.ts','HebbianEngine.resolveError','link a resolved error with the files fixing it'],
 ['hebbian.ts','HebbianEngine.predictNext','predict the next tool call from recent tool chain'],
 ['hebbian.ts','HebbianEngine.getToolChain','get recent tools used in this session'],
 ['hebbian.ts','HebbianEngine.recall','retrieve files spreading activation fan effect'],
 ['hebbian.ts','HebbianEngine.baseLevelActivation','ACT R power law sum past accesses time decay'],
 ['hebbian.ts','HebbianEngine.computeConfidence','calculate confidence semantic relevance frequency and recency'],
 ['hebbian.ts','HebbianEngine.embedNeuron','embed a memory neuron context for semantic retrieval'],
 ['bootstrap.ts','parseGitLog','parse git commit history and touched files'],
 ['bootstrap.ts','scanDirectoryPatterns','discover related source files in directories'],
 ['bootstrap.ts','parseClaudeSessions','read Claude conversation logs for file access history'],
 ['bootstrap.ts','bootstrap','bootstrap memory from repository commits and source imports'],
 ['bootstrap.ts','printResult','print statistics of repository bootstrapping'],
 ['adapter.ts','shouldSkipPath','ignore temporary and generated dependency paths'],
 ['adapter.ts','resolvePath','expand home directory tilde file paths'],
 ['adapter.ts','recordEvents','persist adapter tool access events into memory'],
 ['adapter.ts','performRecall','format recalled files for prompt context injection'],
 ['adapter.ts','detectBashError','detect failures from terminal command output'],
 ['db.ts','openDb','open sqlite database enable WAL and apply schema migrations'],
 ['snippets.ts','extractAndStoreSnippets','incremental content hash snippet reindex transaction'],
 ['snippets.ts','searchSnippets','combine dense vector and BM25 lexical search reciprocal rank fusion'],
];
// Each invocation is a fresh process. Prime downloads with --load-only first;
// cached-artifact coldMs includes session construction and the first short query.
const coldStart = performance.now();
const probe = await embedText("retrieve files spreading activation fan effect");
const coldMs = performance.now() - coldStart;
if (!probe) {
  console.log(JSON.stringify({ model: EMBEDDING_MODEL_ID, status: "unavailable", coldMs }));
  process.exit(1);
}
const warmStart = performance.now();
await embedText("retrieve files spreading activation fan effect");
const warmMs = performance.now() - warmStart;
if (process.argv.includes("--load-only")) {
  console.log(JSON.stringify({ model: EMBEDDING_MODEL_ID, coldMs, warmMs, status: "loaded" }));
  process.exit(0);
}
const docs: { name: string; path: string; text: string }[] = [];
for (const file of [...new Set(pairs.map(p => p[0]))]) {
  const path = resolve(sourceRoot, file);
  const chunks = await extractSnippets(path);
  for (const [targetFile, name] of pairs.filter(p => p[0] === file)) {
    const candidate = chunks.find(c => c.name === name);
    if (!candidate) throw new Error(`Missing benchmark target ${targetFile}:${name}`);
    docs.push({ name, path, text: snippetEmbeddingText(path, candidate) });
  }
  const distractors = chunks.filter(c => !pairs.some(p => p[0] === file && p[1] === c.name) && c.kind !== "class").slice(0, 6);
  for (const c of distractors) docs.push({ name: c.name, path, text: snippetEmbeddingText(path, c) });
}
const indexStart = performance.now();
const vectors: Float32Array[] = [];
for (const doc of docs) {
  const vector = await embedText(doc.text, "document");
  if (!vector) throw new Error("Document embedding failed");
  vectors.push(vector);
}
const indexMs = performance.now() - indexStart;
let hit1 = 0, hit5 = 0, mrr = 0;
for (const [file, name, query] of pairs) {
  const queryVector = await embedText(query);
  if (!queryVector) throw new Error("Query embedding failed");
  const ranking = docs.map((doc, i) => ({ doc, score: cosineSimilarity(queryVector, vectors[i]) })).sort((a, b) => b.score - a.score);
  const rank = ranking.findIndex(({ doc }) => doc.name === name && doc.path.endsWith(`/${file}`)) + 1;
  if (rank === 0) throw new Error(`Target disappeared from ranking: ${name}`);
  hit1 += Number(rank === 1);
  hit5 += Number(rank <= 5);
  mrr += 1 / rank;
}
console.log(JSON.stringify({
  model: EMBEDDING_MODEL_ID, status: "ok", coldMs, warmMs,
  documents: docs.length, indexMs, docsPerSecond: docs.length * 1000 / indexMs,
  pairs: pairs.length, recall1: hit1 / pairs.length, recall5: hit5 / pairs.length,
  mrr: mrr / pairs.length,
}));
