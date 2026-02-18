/**
 * BrainBox Snippet Neurons — System 2 (Semantic Code Search)
 *
 * Extracts functions, classes, and methods from source files using tree-sitter.
 * Each snippet is embedded independently and stored in SQLite for vector search.
 * Query flow: semantic match on snippets → aggregate to parent file neurons → merge with Hebbian results.
 */

import { readFileSync, existsSync } from "fs";
import { extname, join, dirname } from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import type Database from "better-sqlite3";
import {
  embedText,
  cosineSimilarity,
  serializeEmbedding,
  deserializeEmbedding,
  isEmbeddingAvailable,
} from "./embeddings.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Snippet {
  name: string;
  kind: "function" | "class" | "method" | "struct" | "trait" | "enum";
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed
  source: string;
}

export interface SnippetRow {
  id: string;
  parent_neuron_id: string;
  name: string;
  kind: string;
  start_line: number;
  end_line: number;
  source: string;
  embedding: Buffer | null;
  content_hash: string;
}

export interface SnippetMatch {
  snippet: SnippetRow;
  confidence: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_LINES = 5; // minimum lines for a snippet to be extracted
const MAX_FILE_LINES = 10_000; // skip huge files
const SNIPPET_CONFIDENCE_GATE = 0.35; // lower than Hebbian's 0.4

// Language → file extensions
const LANG_MAP: Record<string, string[]> = {
  typescript: [".ts", ".tsx"],
  javascript: [".js", ".jsx", ".mjs"],
  python: [".py"],
  rust: [".rs"],
  swift: [".swift"],
};

// Reverse: extension → language
const EXT_TO_LANG: Record<string, string> = {};
for (const [lang, exts] of Object.entries(LANG_MAP)) {
  for (const ext of exts) EXT_TO_LANG[ext] = lang;
}

// ── Tree-sitter Setup (lazy singleton) ───────────────────────────────────────

let Parser: any = null;
let LanguageClass: any = null;
let parsers: Map<string, any> = new Map();
let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<boolean> {
  if (Parser) return true;
  if (initPromise) {
    await initPromise;
    return Parser !== null;
  }

  initPromise = (async () => {
    try {
      const TreeSitter: any = await import("web-tree-sitter");
      const ParserClass = TreeSitter.Parser || TreeSitter.default;
      await ParserClass.init();
      Parser = ParserClass;
      LanguageClass = TreeSitter.Language || ParserClass.Language;
    } catch {
      Parser = null;
    }
  })();

  await initPromise;
  return Parser !== null;
}

async function getParser(lang: string): Promise<any | null> {
  if (!(await ensureInit())) return null;
  if (parsers.has(lang)) return parsers.get(lang);

  // Find WASM grammar from tree-sitter-wasms package
  const wasmPath = resolveGrammarPath(lang);
  if (!wasmPath) return null;

  try {
    // Load as Uint8Array to avoid CJS/ESM fs/promises compatibility issue
    const wasmBuffer = readFileSync(wasmPath);
    const language = await LanguageClass.load(new Uint8Array(wasmBuffer));
    const parser = new Parser();
    parser.setLanguage(language);
    parsers.set(lang, parser);
    return parser;
  } catch {
    return null;
  }
}

function resolveGrammarPath(lang: string): string | null {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const filename = `tree-sitter-${lang}.wasm`;
  const candidates = [
    // From tree-sitter-wasms npm package (preferred)
    join(thisDir, "..", "node_modules", "tree-sitter-wasms", "out", filename),
    join(thisDir, "..", "..", "node_modules", "tree-sitter-wasms", "out", filename),
    // Legacy vendored grammars/ dir
    join(thisDir, "..", "grammars", filename),
    join(thisDir, "grammars", filename),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

// ── Extraction ───────────────────────────────────────────────────────────────

export function getSupportedLang(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] || null;
}

export async function extractSnippets(filePath: string): Promise<Snippet[]> {
  const lang = getSupportedLang(filePath);
  if (!lang) return [];

  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const lines = source.split("\n");
  if (lines.length > MAX_FILE_LINES) return [];

  const parser = await getParser(lang);
  if (!parser) return [];

  const tree = parser.parse(source);
  if (!tree) return [];

  const snippets: Snippet[] = [];

  try {
    switch (lang) {
      case "typescript":
      case "javascript":
        extractJS(tree.rootNode, snippets, lines);
        break;
      case "python":
        extractPython(tree.rootNode, snippets, lines);
        break;
      case "rust":
        extractRust(tree.rootNode, snippets, lines);
        break;
      case "swift":
        extractSwift(tree.rootNode, snippets, lines);
        break;
    }
  } finally {
    tree.delete();
  }

  return snippets;
}

// ── Language-specific extractors ─────────────────────────────────────────────

function extractJS(node: any, snippets: Snippet[], lines: string[]) {
  // Walk all children — extract exported functions, classes, and large methods
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    const type = child.type;

    // export function foo() {} or export default function foo() {}
    if (type === "export_statement") {
      const decl = child.namedChildren?.[0];
      if (decl) extractJSDecl(decl, snippets, lines, true);
      continue;
    }

    // Top-level function/class (non-exported but still useful)
    if (
      type === "function_declaration" ||
      type === "class_declaration" ||
      type === "lexical_declaration"
    ) {
      extractJSDecl(child, snippets, lines, false);
      continue;
    }
  }
}

function extractJSDecl(node: any, snippets: Snippet[], lines: string[], exported: boolean) {
  const type = node.type;
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const lineCount = endLine - startLine + 1;

  if (type === "function_declaration") {
    const nameNode = node.childForFieldName("name");
    if (nameNode && lineCount >= MIN_LINES) {
      snippets.push({
        name: nameNode.text,
        kind: "function",
        startLine,
        endLine,
        source: getSource(lines, startLine, endLine),
      });
    }
  } else if (type === "class_declaration") {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text || "anonymous";
    if (lineCount >= MIN_LINES) {
      snippets.push({
        name,
        kind: "class",
        startLine,
        endLine,
        source: getSource(lines, startLine, endLine),
      });
    }
    // Also extract large methods inside the class
    extractJSClassMethods(node, snippets, lines, name);
  } else if (type === "lexical_declaration") {
    // const foo = () => {} or const foo = function() {}
    for (let i = 0; i < node.namedChildCount; i++) {
      const declarator = node.namedChild(i);
      if (declarator?.type !== "variable_declarator") continue;
      const nameNode = declarator.childForFieldName("name");
      const valueNode = declarator.childForFieldName("value");
      if (!nameNode || !valueNode) continue;
      if (
        valueNode.type === "arrow_function" ||
        valueNode.type === "function"
      ) {
        const sl = node.startPosition.row + 1;
        const el = node.endPosition.row + 1;
        if (el - sl + 1 >= MIN_LINES) {
          snippets.push({
            name: nameNode.text,
            kind: "function",
            startLine: sl,
            endLine: el,
            source: getSource(lines, sl, el),
          });
        }
      }
    }
  }
}

function extractJSClassMethods(classNode: any, snippets: Snippet[], lines: string[], className: string) {
  const body = classNode.childForFieldName("body");
  if (!body) return;
  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i);
    if (!member) continue;
    if (member.type === "method_definition" || member.type === "public_field_definition") {
      const nameNode = member.childForFieldName("name");
      if (!nameNode) continue;
      const sl = member.startPosition.row + 1;
      const el = member.endPosition.row + 1;
      if (el - sl + 1 >= MIN_LINES) {
        snippets.push({
          name: `${className}.${nameNode.text}`,
          kind: "method",
          startLine: sl,
          endLine: el,
          source: getSource(lines, sl, el),
        });
      }
    }
  }
}

function extractPython(node: any, snippets: Snippet[], lines: string[]) {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    if (child.type === "function_definition") {
      const nameNode = child.childForFieldName("name");
      if (!nameNode) continue;
      const sl = child.startPosition.row + 1;
      const el = child.endPosition.row + 1;
      if (el - sl + 1 >= MIN_LINES) {
        snippets.push({
          name: nameNode.text,
          kind: "function",
          startLine: sl,
          endLine: el,
          source: getSource(lines, sl, el),
        });
      }
    } else if (child.type === "class_definition") {
      const nameNode = child.childForFieldName("name");
      const name = nameNode?.text || "anonymous";
      const sl = child.startPosition.row + 1;
      const el = child.endPosition.row + 1;
      if (el - sl + 1 >= MIN_LINES) {
        snippets.push({
          name,
          kind: "class",
          startLine: sl,
          endLine: el,
          source: getSource(lines, sl, el),
        });
      }
      // Extract methods
      const body = child.childForFieldName("body");
      if (body) {
        for (let j = 0; j < body.namedChildCount; j++) {
          const method = body.namedChild(j);
          if (method?.type === "function_definition") {
            const mName = method.childForFieldName("name");
            if (!mName) continue;
            const msl = method.startPosition.row + 1;
            const mel = method.endPosition.row + 1;
            if (mel - msl + 1 >= MIN_LINES) {
              snippets.push({
                name: `${name}.${mName.text}`,
                kind: "method",
                startLine: msl,
                endLine: mel,
                source: getSource(lines, msl, mel),
              });
            }
          }
        }
      }
    }
  }
}

function extractRust(node: any, snippets: Snippet[], lines: string[]) {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    if (child.type === "function_item") {
      const nameNode = child.childForFieldName("name");
      if (!nameNode) continue;
      const sl = child.startPosition.row + 1;
      const el = child.endPosition.row + 1;
      if (el - sl + 1 >= MIN_LINES) {
        snippets.push({
          name: nameNode.text,
          kind: "function",
          startLine: sl,
          endLine: el,
          source: getSource(lines, sl, el),
        });
      }
    } else if (child.type === "struct_item") {
      const nameNode = child.childForFieldName("name");
      if (!nameNode) continue;
      const sl = child.startPosition.row + 1;
      const el = child.endPosition.row + 1;
      if (el - sl + 1 >= MIN_LINES) {
        snippets.push({
          name: nameNode.text,
          kind: "struct",
          startLine: sl,
          endLine: el,
          source: getSource(lines, sl, el),
        });
      }
    } else if (child.type === "trait_item") {
      const nameNode = child.childForFieldName("name");
      if (!nameNode) continue;
      const sl = child.startPosition.row + 1;
      const el = child.endPosition.row + 1;
      if (el - sl + 1 >= MIN_LINES) {
        snippets.push({
          name: nameNode.text,
          kind: "trait",
          startLine: sl,
          endLine: el,
          source: getSource(lines, sl, el),
        });
      }
    } else if (child.type === "enum_item") {
      const nameNode = child.childForFieldName("name");
      if (!nameNode) continue;
      const sl = child.startPosition.row + 1;
      const el = child.endPosition.row + 1;
      if (el - sl + 1 >= MIN_LINES) {
        snippets.push({
          name: nameNode.text,
          kind: "enum",
          startLine: sl,
          endLine: el,
          source: getSource(lines, sl, el),
        });
      }
    } else if (child.type === "impl_item") {
      // Extract methods from impl blocks
      const typeNode = child.childForFieldName("type");
      const implName = typeNode?.text || "impl";
      const body = child.childForFieldName("body");
      if (body) {
        for (let j = 0; j < body.namedChildCount; j++) {
          const fn = body.namedChild(j);
          if (fn?.type === "function_item") {
            const fnName = fn.childForFieldName("name");
            if (!fnName) continue;
            const fsl = fn.startPosition.row + 1;
            const fel = fn.endPosition.row + 1;
            if (fel - fsl + 1 >= MIN_LINES) {
              snippets.push({
                name: `${implName}::${fnName.text}`,
                kind: "method",
                startLine: fsl,
                endLine: fel,
                source: getSource(lines, fsl, fel),
              });
            }
          }
        }
      }
    }
  }
}

function extractSwift(node: any, snippets: Snippet[], lines: string[]) {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    if (child.type === "function_declaration") {
      const nameNode = child.childForFieldName("name");
      if (!nameNode) continue;
      const sl = child.startPosition.row + 1;
      const el = child.endPosition.row + 1;
      if (el - sl + 1 >= MIN_LINES) {
        snippets.push({
          name: nameNode.text,
          kind: "function",
          startLine: sl,
          endLine: el,
          source: getSource(lines, sl, el),
        });
      }
    } else if (child.type === "class_declaration" || child.type === "struct_declaration") {
      const nameNode = child.childForFieldName("name");
      const name = nameNode?.text || "anonymous";
      const kind = child.type === "class_declaration" ? "class" : "struct";
      const sl = child.startPosition.row + 1;
      const el = child.endPosition.row + 1;
      if (el - sl + 1 >= MIN_LINES) {
        snippets.push({
          name,
          kind: kind as any,
          startLine: sl,
          endLine: el,
          source: getSource(lines, sl, el),
        });
      }
      // Extract methods from body
      extractSwiftMethods(child, snippets, lines, name);
    } else if (child.type === "enum_declaration") {
      const nameNode = child.childForFieldName("name");
      if (!nameNode) continue;
      const sl = child.startPosition.row + 1;
      const el = child.endPosition.row + 1;
      if (el - sl + 1 >= MIN_LINES) {
        snippets.push({
          name: nameNode.text,
          kind: "enum",
          startLine: sl,
          endLine: el,
          source: getSource(lines, sl, el),
        });
      }
    }
  }
}

function extractSwiftMethods(parentNode: any, snippets: Snippet[], lines: string[], parentName: string) {
  const body = parentNode.childForFieldName("body");
  if (!body) return;
  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i);
    if (!child) continue;
    if (child.type === "function_declaration") {
      const nameNode = child.childForFieldName("name");
      if (!nameNode) continue;
      const sl = child.startPosition.row + 1;
      const el = child.endPosition.row + 1;
      if (el - sl + 1 >= MIN_LINES) {
        snippets.push({
          name: `${parentName}.${nameNode.text}`,
          kind: "method",
          startLine: sl,
          endLine: el,
          source: getSource(lines, sl, el),
        });
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSource(lines: string[], startLine: number, endLine: number): string {
  return lines.slice(startLine - 1, endLine).join("\n");
}

export function snippetId(parentNeuronId: string, startLine: number, endLine: number): string {
  const hash = createHash("sha256")
    .update(`${parentNeuronId}:${startLine}:${endLine}`)
    .digest("hex")
    .slice(0, 16);
  return `snip:${hash}`;
}

export function contentHash(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

// ── DB Operations ────────────────────────────────────────────────────────────

export function prepareSnippetStatements(db: Database.Database): Record<string, Database.Statement> {
  return {
    upsertSnippet: db.prepare(`
      INSERT INTO snippets (id, parent_neuron_id, name, kind, start_line, end_line, source, embedding, content_hash, created_at, updated_at)
      VALUES (@id, @parentNeuronId, @name, @kind, @startLine, @endLine, @source, @embedding, @contentHash, @now, @now)
      ON CONFLICT(id) DO UPDATE SET
        name = @name, kind = @kind, start_line = @startLine, end_line = @endLine,
        source = @source, embedding = @embedding, content_hash = @contentHash, updated_at = @now
    `),
    deleteSnippetsForNeuron: db.prepare(
      `DELETE FROM snippets WHERE parent_neuron_id = @parentNeuronId`
    ),
    getSnippetsForNeuron: db.prepare(
      `SELECT * FROM snippets WHERE parent_neuron_id = @parentNeuronId`
    ),
    getAllSnippetEmbeddings: db.prepare(
      `SELECT id, parent_neuron_id, name, kind, start_line, end_line, embedding FROM snippets WHERE embedding IS NOT NULL`
    ),
    countSnippets: db.prepare(`SELECT COUNT(*) as cnt FROM snippets`),
    getSnippetById: db.prepare(`SELECT * FROM snippets WHERE id = @id`),
  };
}

// ── Search ───────────────────────────────────────────────────────────────────

// Cache for snippet embeddings (invalidated when snippets change)
let embeddingCache: { rows: any[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

export function searchSnippets(
  db: Database.Database,
  queryEmbedding: Float32Array,
  limit: number = 10
): SnippetMatch[] {
  const stmts = prepareSnippetStatements(db);

  // Use cached embeddings if fresh
  const now = Date.now();
  if (!embeddingCache || now - embeddingCache.timestamp > CACHE_TTL_MS) {
    embeddingCache = {
      rows: stmts.getAllSnippetEmbeddings.all(),
      timestamp: now,
    };
  }

  const results: SnippetMatch[] = [];
  for (const row of embeddingCache.rows) {
    if (!row.embedding) continue;
    const emb = deserializeEmbedding(row.embedding);
    const sim = cosineSimilarity(queryEmbedding, emb);
    if (sim >= SNIPPET_CONFIDENCE_GATE) {
      results.push({
        snippet: row as SnippetRow,
        confidence: sim,
      });
    }
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return results.slice(0, limit);
}

/** Invalidate the embedding cache (call after extraction) */
export function invalidateSnippetCache() {
  embeddingCache = null;
}

// ── Batch Extraction + Embedding ─────────────────────────────────────────────

export interface ExtractionStats {
  filesScanned: number;
  filesWithSnippets: number;
  snippetsExtracted: number;
  snippetsEmbedded: number;
  errors: number;
}

export async function extractAndStoreSnippets(
  db: Database.Database,
  filePath: string,
  neuronId: string,
  embed: boolean = true
): Promise<number> {
  const snippets = await extractSnippets(filePath);
  if (snippets.length === 0) return 0;

  const stmts = prepareSnippetStatements(db);
  const now = new Date().toISOString();
  let stored = 0;

  // Delete old snippets for this file and re-insert
  stmts.deleteSnippetsForNeuron.run({ parentNeuronId: neuronId });

  for (const s of snippets) {
    const id = snippetId(neuronId, s.startLine, s.endLine);
    const hash = contentHash(s.source);

    let embedding: Buffer | null = null;
    if (embed && isEmbeddingAvailable()) {
      // Embed: name + first 500 chars of source for context
      const text = `${s.kind} ${s.name}\n${s.source.slice(0, 500)}`;
      const emb = await embedText(text);
      if (emb) embedding = serializeEmbedding(emb);
    }

    stmts.upsertSnippet.run({
      id,
      parentNeuronId: neuronId,
      name: s.name,
      kind: s.kind,
      startLine: s.startLine,
      endLine: s.endLine,
      source: s.source,
      embedding,
      contentHash: hash,
      now,
    });
    stored++;
  }

  invalidateSnippetCache();
  return stored;
}
