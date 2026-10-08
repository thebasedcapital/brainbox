/** Structural code chunks, transactional lexical/vector indexes, and rank fusion. */
import { readFileSync, existsSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { Parser, Language } from "web-tree-sitter";
import * as sqliteVec from "sqlite-vec";
import { embedText, cosineSimilarity, serializeEmbedding, deserializeEmbedding, isEmbeddingAvailable, EMBEDDING_MODEL_ID, EMBEDDING_DIM } from "./embeddings.js";

export const CHUNKER_VERSION = "cast-v1-1500";
export const CHUNK_CHAR_BUDGET = 1500;
export const HYBRID_RRF_K = 60;
export const HYBRID_CANDIDATES = 50;
export interface Snippet {
  name: string;
  kind: "function" | "class" | "method" | "struct" | "trait" | "enum" | "chunk";
  startLine: number;
  endLine: number;
  source: string;
  signature: string;
}
export interface SnippetRow {
  id: string;
  parent_neuron_id: string;
  path: string;
  name: string;
  kind: string;
  start_line: number;
  end_line: number;
  source: string;
  signature: string;
  embedding: Buffer | null;
  content_hash: string;
  chunker_version: string;
  model_id: string | null;
  dims: number | null;
}
export interface SnippetMatch { snippet: SnippetRow; confidence: number }
const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript", ".tsx": "tsx", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".rs": "rust", ".swift": "swift", ".go": "go",
};
const parsers = new Map<string, Parser>();
let initPromise: Promise<void> | null = null;
export function getSupportedLang(filePath: string): string | null {
  return EXT_TO_LANG[extname(filePath).toLowerCase()] || null;
}
export async function getParser(lang: string): Promise<Parser | null> {
  if (parsers.has(lang)) return parsers.get(lang) || null;
  try {
    initPromise ||= Parser.init();
    await initPromise;
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const filename = `tree-sitter-${lang}.wasm`;
    const wasmPath = [join(thisDir, "..", "node_modules", "tree-sitter-wasms", "out", filename), join(thisDir, "..", "..", "node_modules", "tree-sitter-wasms", "out", filename), join(thisDir, "..", "grammars", filename)].find(existsSync);
    if (!wasmPath) return null;
    const language = await Language.load(new Uint8Array(readFileSync(wasmPath)));
    const parser = new Parser();
    parser.setLanguage(language);
    parsers.set(lang, parser);
    return parser;
  } catch { return null; }
}

interface Span { start: number; end: number }
/** Recursive child-boundary split; indivisible lexical leaves may exceed the budget. */
function splitNode(node: SyntaxNode, source: string, budget: number): Span[] {
  if (node.text.replace(/\s/g, "").length <= budget || node.namedChildCount === 0) return [{ start: node.startIndex, end: node.endIndex }];
  const spans: Span[] = [];
  let cursor = node.startIndex;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const parts = splitNode(child, source, budget);
    if (parts.length) {
      parts[0].start = cursor;
      spans.push(...parts);
      cursor = child.endIndex;
    }
  }
  if (spans.length) spans[spans.length - 1].end = node.endIndex;
  else return [{ start: node.startIndex, end: node.endIndex }];
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && source.slice(last.start, span.end).replace(/\s/g, "").length <= budget) last.end = span.end;
    else merged.push({ ...span });
  }
  return merged;
}
const ENTITY_KINDS: Record<string, Snippet["kind"]> = {
  function_declaration: "function", function_definition: "function", function_item: "function",
  method_definition: "method", method_declaration: "method", class_declaration: "class", class_definition: "class",
  struct_item: "struct", struct_declaration: "struct", trait_item: "trait", enum_item: "enum", enum_declaration: "enum",
};

export async function extractSnippetSource(source: string, lang: string, budget = CHUNK_CHAR_BUDGET): Promise<Snippet[]> {
  const parser = await getParser(lang);
  if (!parser) return [];
  const tree = parser.parse(source);
  if (!tree) return [];
  const snippets: Snippet[] = [];
  // Binary search line offsets instead of rescanning the file for every chunk.
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const lineAt = (offset: number): number => {
    let lo = 0, hi = lineStarts.length;
    while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid; }
    return lo + 1;
  };
  const emit = (node: SyntaxNode, name: string, kind: Snippet["kind"]): void => {
    const body = node.childForFieldName("body");
    const signature = source.slice(node.startIndex, body?.startIndex ?? Math.min(node.endIndex, node.startIndex + 240)).trim();
    for (const span of splitNode(node, source, budget)) {
      const text = source.slice(span.start, span.end);
      if (!text.trim()) continue;
      snippets.push({ name, kind, signature, source: text, startLine: lineAt(span.start), endLine: lineAt(Math.max(span.start, span.end - 1)) });
    }
  };
  const visit = (node: SyntaxNode, parent: string): boolean => {
    let kind = ENTITY_KINDS[node.type];
    let name = node.childForFieldName("name")?.text;
    if (node.type === "impl_item") {
      const owner = node.childForFieldName("type")?.text || "impl";
      let found = false;
      const body = node.childForFieldName("body");
      if (body) for (const child of body.namedChildren) if (child) found = visit(child, owner) || found;
      return found;
    }
    if (node.type === "method_declaration" && !parent) {
      const receiver = node.childForFieldName("receiver");
      const receiverType = receiver?.namedChildren.find(child => child?.type === "parameter_declaration")?.childForFieldName("type")?.text;
      if (receiverType) parent = receiverType.replace(/^\*/, "");
    }
    if (node.type === "variable_declarator") {
      const value = node.childForFieldName("value");
      if (value && ["arrow_function", "function_expression", "function"].includes(value.type)) kind = "function";
    }
    if (kind && name) {
      const qualified = parent ? `${parent}.${name}` : name;
      if (parent && kind === "function") kind = "method";
      emit(node, qualified, kind);
      if (["class", "struct", "trait"].includes(kind)) for (const child of node.namedChildren) if (child) visit(child, qualified);
      return true;
    }
    let found = false;
    for (const child of node.namedChildren) if (child) found = visit(child, parent) || found;
    return found;
  };
  try {
    // Entity chunks plus gap chunks cover imports, constants and executable top-level code.
    let pending: SyntaxNode[] = [];
    const flush = (): void => {
      if (!pending.length) return;
      const spans = pending.flatMap(n => splitNode(n, source, budget));
      const merged: Span[] = [];
      for (const span of spans) {
        const last = merged[merged.length - 1];
        if (last && source.slice(last.start, span.end).replace(/\s/g, "").length <= budget) last.end = span.end;
        else merged.push({ ...span });
      }
      for (const span of merged) snippets.push({ name: `<module>:${lineAt(span.start)}`, kind: "chunk", signature: "", source: source.slice(span.start, span.end), startLine: lineAt(span.start), endLine: lineAt(span.end - 1) });
      pending = [];
    };
    for (const node of tree.rootNode.namedChildren) {
      if (!node) continue;
      const before = snippets.length;
      if (visit(node, "")) {
        const entities = snippets.splice(before);
        flush();
        snippets.push(...entities);
      } else pending.push(node);
    }
    flush();
    return snippets;
  } finally { tree.delete(); }
}
export async function extractSnippets(filePath: string): Promise<Snippet[]> {
  const lang = getSupportedLang(filePath);
  if (!lang) return [];
  try {
    const source = readFileSync(filePath, "utf8");
    if (source.split("\n").length > 10_000) return [];
    return await extractSnippetSource(source, lang);
  } catch { return []; }
}
export function snippetId(parentNeuronId: string, startLine: number, endLine: number): string {
  return `snip:${contentHash(`${parentNeuronId}:${startLine}:${endLine}`)}`;
}
export function contentHash(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}
export function snippetEmbeddingText(path: string, snippet: Snippet): string {
  return `${path}\n${snippet.name}\n${snippet.kind}\n${snippet.signature}\n${snippet.source}`;
}

const vectorStates = new WeakMap<Database.Database, boolean>();
let vectorWarningLogged = false;
const VECTOR_TABLE = `snippet_vectors_${contentHash(EMBEDDING_MODEL_ID)}`;
/** Drain row-level invalidations, including cascaded deletions and manual model changes. */
function synchronizeVectorChanges(db: Database.Database): void {
  const changed = db.prepare("SELECT snippet_rowid FROM snippet_vector_changes").all() as { snippet_rowid: number }[];
  if (!changed.length) return;
  db.transaction(() => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'snippet_vectors_*' AND sql LIKE 'CREATE VIRTUAL TABLE%'").all() as { name: string }[];
    const validTables = tables.filter(t => /^snippet_vectors_[a-f0-9]+$/.test(t.name));
    const deletes = validTables.map(t => db.prepare(`DELETE FROM ${t.name} WHERE rowid = ?`));
    const inserts = new Map(validTables.map(t => [t.name, db.prepare(`INSERT INTO ${t.name}(rowid,embedding) VALUES (?,?)`)]));
    const current = db.prepare("SELECT embedding,model_id,dims FROM snippets WHERE rowid = ?");
    const remove = db.prepare("DELETE FROM snippet_vector_changes WHERE snippet_rowid = ?");
    for (const { snippet_rowid } of changed) {
      for (const statement of deletes) statement.run(BigInt(snippet_rowid));
      const row = current.get(snippet_rowid) as { embedding: Buffer | null; model_id: string | null; dims: number | null } | undefined;
      if (row?.model_id && row.embedding && row.dims && row.embedding.length === row.dims * 4) {
        inserts.get(`snippet_vectors_${contentHash(row.model_id)}`)?.run(BigInt(snippet_rowid), row.embedding);
      }
      remove.run(snippet_rowid);
    }
  })();
}
/** Extension loaded only on snippet paths, once per connection. Existing BLOBs backfill once. */
export function ensureSnippetVectorIndex(db: Database.Database): boolean {
  const state = vectorStates.get(db);
  if (state === false) return false;
  try {
    if (state !== true) sqliteVec.load(db);
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(VECTOR_TABLE);
    if (!exists) db.transaction(() => {
      db.exec(`CREATE VIRTUAL TABLE ${VECTOR_TABLE} USING vec0(embedding float[${EMBEDDING_DIM}] distance_metric=cosine)`);
      // Backfill stays inside SQLite; never materialize every BLOB in JavaScript.
      db.prepare(`INSERT INTO ${VECTOR_TABLE}(rowid,embedding) SELECT rowid,embedding FROM snippets WHERE model_id = ? AND dims = ? AND length(embedding) = ?`).run(EMBEDDING_MODEL_ID, EMBEDDING_DIM, EMBEDDING_DIM * 4);
    })();
    synchronizeVectorChanges(db);
    vectorStates.set(db, true);
    return true;
  } catch (error: unknown) {
    vectorStates.set(db, false);
    if (!vectorWarningLogged) {
      vectorWarningLogged = true;
      console.error(`[brainbox] sqlite-vec unavailable; using cosine scan: ${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
  }
}
export function prepareSnippetStatements(db: Database.Database): Record<string, Database.Statement> {
  return {
    getSnippetsForNeuron: db.prepare("SELECT * FROM snippets WHERE parent_neuron_id = @parentNeuronId"),
    countSnippets: db.prepare("SELECT COUNT(*) as cnt FROM snippets"),
    getSnippetById: db.prepare("SELECT * FROM snippets WHERE id = @id"),
  };
}

export function searchDenseSnippets(db: Database.Database, queryEmbedding: Float32Array, limit = HYBRID_CANDIDATES): SnippetMatch[] {
  if (queryEmbedding.length !== EMBEDDING_DIM || limit <= 0) return [];
  if (ensureSnippetVectorIndex(db)) {
    const rows = db.prepare(`SELECT s.*, 1-v.distance AS similarity FROM ${VECTOR_TABLE} v JOIN snippets s ON s.rowid=v.rowid WHERE v.embedding MATCH ? AND k = ? AND s.model_id = ? AND s.dims = ? ORDER BY v.distance`).all(serializeEmbedding(queryEmbedding), limit, EMBEDDING_MODEL_ID, EMBEDDING_DIM) as (SnippetRow & { similarity: number })[];
    return rows.filter(row => row.similarity >= 0.2).map(row => ({ snippet: row, confidence: row.similarity }));
  }
  const results: SnippetMatch[] = [];
  const rows = db.prepare("SELECT * FROM snippets WHERE embedding IS NOT NULL AND model_id = ? AND dims = ?").iterate(EMBEDDING_MODEL_ID, EMBEDDING_DIM);
  for (const value of rows) {
    const row = value as SnippetRow;
    if (!row.embedding || row.embedding.byteLength !== EMBEDDING_DIM * 4) continue;
    const confidence = cosineSimilarity(queryEmbedding, deserializeEmbedding(row.embedding));
    if (confidence >= 0.2) results.push({ snippet: row, confidence });
  }
  return results.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}
export function searchSnippets(db: Database.Database, query: string, queryEmbedding: Float32Array | null, limit = 10): SnippetMatch[] {
  if (limit <= 0) return [];
  const tokens = [...new Set(query.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [])].slice(0, 32);
  const lexical = tokens.length ? db.prepare(`SELECT s.* FROM snippet_fts JOIN snippets s ON s.rowid = snippet_fts.rowid WHERE snippet_fts MATCH ? ORDER BY bm25(snippet_fts, 3, 5, 1, 1) LIMIT ?`).all(tokens.map(t => `"${t}"`).join(" OR "), HYBRID_CANDIDATES) as SnippetRow[] : [];
  const dense = queryEmbedding ? searchDenseSnippets(db, queryEmbedding) : [];
  const fused = new Map<string, { snippet: SnippetRow; score: number; denseSimilarity: number; lexical: boolean }>();
  lexical.forEach((snippet, rank) => fused.set(snippet.id, { snippet, score: 1 / (HYBRID_RRF_K + rank + 1), denseSimilarity: 0, lexical: true }));
  dense.forEach(({ snippet, confidence }, rank) => {
    const old = fused.get(snippet.id);
    if (old) { old.score += 1 / (HYBRID_RRF_K + rank + 1); old.denseSimilarity = confidence; }
    else fused.set(snippet.id, { snippet, score: 1 / (HYBRID_RRF_K + rank + 1), denseSimilarity: confidence, lexical: false });
  });
  const matches = [...fused.values()].map(item => {
    const identifiers: string[] = `${item.snippet.path} ${item.snippet.name}`.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
    const exact = tokens.length ? tokens.filter(t => identifiers.includes(t)).length / tokens.length : 0;
    const score = item.score * (1 + 0.25 * exact);
    // Full-evidence rank-1 single channel maps to .625, dual channel to .95.
    // Lexical query coverage gates broad OR matches; this is an evidence score, not a probability.
    const text = `${item.snippet.path} ${item.snippet.name} ${item.snippet.source}`.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    const coverage = tokens.length ? tokens.filter(t => text.includes(t)).length / tokens.length : 0;
    const evidence = item.lexical ? Math.max(coverage, item.denseSimilarity) : item.denseSimilarity;
    return { snippet: item.snippet, confidence: Math.min(0.99, (0.30 + 0.65 * score * (HYBRID_RRF_K + 1) / 2) * (0.5 + 0.5 * evidence)), score };
  });
  return matches.sort((a, b) => b.score - a.score || b.confidence - a.confidence).slice(0, limit).map(({ snippet, confidence }) => ({ snippet, confidence }));
}
export interface ExtractionStats { filesScanned: number; filesWithSnippets: number; snippetsExtracted: number; snippetsEmbedded: number; errors: number }
export async function extractAndStoreSnippets(db: Database.Database, filePath: string, neuronId: string, embed = true, force = false): Promise<number> {
  const source = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const hash = contentHash(source);
  const model = embed && isEmbeddingAvailable() ? EMBEDDING_MODEL_ID : null;
  const indexed = db.prepare("SELECT content_hash, chunker_version, model_id FROM snippet_files WHERE parent_neuron_id = ?").get(neuronId) as { content_hash: string; chunker_version: string; model_id: string | null } | undefined;
  if (!force && indexed?.content_hash === hash && indexed.chunker_version === CHUNKER_VERSION && indexed.model_id === model) return 0;
  const lang = getSupportedLang(filePath);
  const snippets = lang && source.split("\n").length <= 10_000 ? await extractSnippetSource(source, lang) : [];
  const rows: { snippet: Snippet; embedding: Buffer | null; hash: string }[] = [];
  let allEmbedded = true;
  for (const snippet of snippets) {
    const text = snippetEmbeddingText(filePath, snippet);
    const vector = model ? await embedText(text, "document") : null;
    if (model && !vector) allEmbedded = false;
    rows.push({ snippet, embedding: vector ? serializeEmbedding(vector) : null, hash: contentHash(text) });
  }
  const vec = ensureSnippetVectorIndex(db);
  db.transaction(() => {
    db.prepare("DELETE FROM snippets WHERE parent_neuron_id = ?").run(neuronId);
    const insert = db.prepare(`INSERT INTO snippets(id,parent_neuron_id,path,name,kind,start_line,end_line,source,signature,embedding,content_hash,chunker_version,model_id,dims,created_at,updated_at) VALUES (@id,@parent,@path,@name,@kind,@start,@end,@source,@signature,@embedding,@hash,@version,@model,@dims,@now,@now)`);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], s = row.snippet;
      insert.run({ id: `snip:${contentHash(`${neuronId}:${s.name}:${s.kind}:${s.startLine}:${s.endLine}:${i}`)}`, parent: neuronId, path: filePath, name: s.name, kind: s.kind, start: s.startLine, end: s.endLine, source: s.source, signature: s.signature, embedding: row.embedding, hash: row.hash, version: CHUNKER_VERSION, model: row.embedding ? EMBEDDING_MODEL_ID : null, dims: row.embedding ? EMBEDDING_DIM : null, now: new Date().toISOString() });
    }
    db.prepare(`INSERT INTO snippet_files(parent_neuron_id,path,content_hash,chunker_version,model_id) VALUES (?,?,?,?,?) ON CONFLICT(parent_neuron_id) DO UPDATE SET path=excluded.path,content_hash=excluded.content_hash,chunker_version=excluded.chunker_version,model_id=excluded.model_id`).run(neuronId, filePath, hash, CHUNKER_VERSION, allEmbedded ? model : null);
    if (vec) synchronizeVectorChanges(db);
  })();
  return snippets.length;
}
