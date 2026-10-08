/** Local tree-sitter file dependencies. Parsing runs only during explicit bootstrap. */
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "path";
import type Database from "better-sqlite3";
import type { Node } from "web-tree-sitter";
import type { HebbianEngine } from "./hebbian.js";
import { getParser, getSupportedLang } from "./snippets.js";

export interface CodeEdge {
  from: string;
  to: string;
  kind: "import" | "call" | "inherit";
  count: number;
}

export interface CodeGraphOptions {
  db?: Database.Database;
  since?: string;
  /** Dry runs can consult the cache without marking files as successfully indexed. */
  persist?: boolean;
}

export interface CodeGraphResult {
  /** Only edges from changed files: unchanged files must not reinforce synapses again. */
  edges: CodeEdge[];
  scanned: number;
  skipped: number;
  unavailable: string[];
}

// Structure is a weak prior: a single import/call starts at 0.2, inheritance at 0.3,
// and even repeated calls stop at 0.35, below learned co-access weights of 0.5–0.9.
export const CODE_EDGE_WEIGHTS = { import: 0.2, call: 0.2, inherit: 0.3 } as const;
export const CODE_REVERSE_FACTOR = 0.6;
const GRAPH_VERSION = "codegraph-2";
const IGNORE_DIRS: Record<string, true> = { ".git": true, node_modules: true, vendor: true, dist: true, build: true, ".next": true, coverage: true, __pycache__: true, ".venv": true, venv: true, target: true };
const JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

interface Binding { targets: string[]; symbol: string; }
interface ImportRef { specifier: string; bindings: { local: string; symbol: string }[]; }
interface FileFacts {
  path: string;
  lang: string;
  hash: string;
  exports: Set<string>;
  imports: ImportRef[];
  calls: string[];
  inherits: string[];
}
interface JsConfig { baseUrl: string | null; paths: Record<string, string[]>; pathsBase: string; }
interface CacheRow { content_hash: string; exports_json: string; }

function namedChildren(node: Node | null | undefined, named = true): Node[] {
  return (node ? (named ? node.namedChildren : node.children) : []).filter((child): child is Node => child !== null);
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const child of namedChildren(node)) walk(child, visit);
}
function unquote(text: string): string { return text.slice(1, -1); }
function field(node: Node, name: string): string { return node.childForFieldName(name)?.text ?? ""; }
function symbolName(node: Node): string { return field(node, "name") || field(node, "pattern"); }
function insideRepo(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function isFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}
function sourceFiles(root: string): string[] {
  const files: string[] = [];
  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS[entry.name]) visit(join(dir, entry.name));
      } else if (entry.isFile()) {
        const path = join(dir, entry.name);
        if (getSupportedLang(path)) files.push(path);
      }
    }
  }
  visit(root);
  return files.sort();
}

/** Preserve strings while stripping JSONC comments; tsconfig commonly contains both. */
function parseJsonConfig(text: string): unknown {
  let cleaned = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      cleaned += c;
      if (c === "\\") cleaned += text[++i] ?? "";
      else if (c === '"') quoted = false;
    } else if (c === '"') { quoted = true; cleaned += c; }
    else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      cleaned += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      cleaned += " ";
    } else cleaned += c;
  }
  // Remove trailing commas only outside strings.
  let result = "";
  quoted = false;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (quoted) {
      result += c;
      if (c === "\\") result += cleaned[++i] ?? "";
      else if (c === '"') quoted = false;
    } else if (c === '"') { quoted = true; result += c; }
    else if (c === "," && /^[\s]*[}\]]/.test(cleaned.slice(i + 1))) continue;
    else result += c;
  }
  return JSON.parse(result) as unknown;
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configFile(base: string): string | undefined {
  return [base, `${base}.json`, join(base, "tsconfig.json")].find(isFile);
}

function extendedConfig(specifier: string, from: string): string | undefined {
  if (specifier.startsWith(".") || isAbsolute(specifier)) return configFile(resolve(dirname(from), specifier));
  const parts = specifier.split("/");
  const packageName = parts.splice(0, specifier.startsWith("@") ? 2 : 1).join("/");
  let dir = dirname(from);
  while (true) {
    const packageRoot = join(dir, "node_modules", packageName);
    if (parts.length) {
      const hit = configFile(join(packageRoot, ...parts));
      if (hit) return hit;
    } else {
      const manifest = join(packageRoot, "package.json");
      if (isFile(manifest)) {
        try {
          const pkg: unknown = JSON.parse(readFileSync(manifest, "utf8"));
          if (object(pkg) && typeof pkg.tsconfig === "string") {
            const hit = configFile(resolve(packageRoot, pkg.tsconfig));
            if (hit) return hit;
          }
        } catch { /* Invalid presets do not prevent indexing unrelated files. */ }
      }
      const hit = configFile(packageRoot);
      if (hit) return hit;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function loadJsConfig(file: string, seen = new Set<string>()): JsConfig {
  const fallback: JsConfig = { baseUrl: null, paths: {}, pathsBase: dirname(file) };
  if (seen.has(file) || !isFile(file)) return fallback;
  seen.add(file);
  try {
    const config = parseJsonConfig(readFileSync(file, "utf8"));
    if (!object(config)) return fallback;
    let parent = fallback;
    if (typeof config.extends === "string") {
      const path = extendedConfig(config.extends, file);
      if (path) parent = loadJsConfig(path, seen);
    }
    const opts = object(config.compilerOptions) ? config.compilerOptions : {};
    const baseUrl = typeof opts.baseUrl === "string" ? resolve(dirname(file), opts.baseUrl) : parent.baseUrl;
    let paths = parent.paths;
    let pathsBase = parent.pathsBase;
    if (object(opts.paths)) {
      paths = {};
      pathsBase = dirname(file);
      for (const [key, value] of Object.entries(opts.paths)) {
        if (Array.isArray(value) && value.every((item: unknown) => typeof item === "string")) paths[key] = value;
      }
    }
    return { baseUrl, paths, pathsBase };
  } catch { return fallback; }
}

class Resolver {
  private configs = new Map<string, JsConfig>();
  private swiftModules = new Map<string, string[]>();
  private goModules = new Map<string, { root: string; name: string } | null>();
  private goPackages = new Map<string, string[]>();
  constructor(private root: string, private files: Set<string>) {
    for (const path of files) {
      if (extname(path) === ".swift") {
        const module = basename(dirname(path));
        this.swiftModules.set(module, [...(this.swiftModules.get(module) ?? []), path]);
      }
      if (extname(path) === ".go" && !path.endsWith("_test.go")) {
        const dir = dirname(path);
        const module = this.goModule(path);
        if (module) this.goPackages.set(dir, [...(this.goPackages.get(dir) ?? []), path]);
      }
    }
  }
  private goModule(from: string): { root: string; name: string } | null {
    let dir = dirname(from);
    const visited: string[] = [];
    let module: { root: string; name: string } | null = null;
    while (insideRepo(dir, this.root)) {
      if (this.goModules.has(dir)) { module = this.goModules.get(dir) ?? null; break; }
      visited.push(dir);
      const file = join(dir, "go.mod");
      if (isFile(file)) {
        const name = /^module\s+(\S+)/m.exec(readFileSync(file, "utf8"))?.[1] ?? "";
        module = name ? { root: dir, name } : null;
        break;
      }
      if (dir === this.root) break;
      dir = dirname(dir);
    }
    for (const path of visited) this.goModules.set(path, module);
    return module;
  }
  private pick(base: string, extensions: string[], index?: string): string[] {
    const candidates = [base, ...extensions.map(ext => base + ext)];
    if (index) candidates.push(...extensions.map(ext => join(base, index + ext)));
    for (const candidate of candidates) if (this.files.has(candidate)) return [candidate];
    return [];
  }
  private config(from: string): JsConfig {
    let dir = dirname(from);
    while (insideRepo(dir, this.root)) {
      const configPath = [join(dir, "tsconfig.json"), join(dir, "jsconfig.json")].find(isFile);
      if (configPath) {
        let config = this.configs.get(configPath);
        if (!config) { config = loadJsConfig(configPath); this.configs.set(configPath, config); }
        return config;
      }
      if (dir === this.root) break;
      dir = dirname(dir);
    }
    return { baseUrl: this.root, paths: {}, pathsBase: this.root };
  }
  fingerprint(from: string): string {
    return JSON.stringify({ js: this.config(from), go: extname(from) === ".go" ? this.goModule(from) : null });
  }
  resolve(specifier: string, from: string, lang: string): string[] {
    if (lang === "typescript" || lang === "javascript" || lang === "tsx") {
      const candidates: string[] = [];
      if (specifier.startsWith(".") || isAbsolute(specifier)) candidates.push(resolve(dirname(from), specifier));
      else {
        const config = this.config(from);
        for (const [pattern, replacements] of Object.entries(config.paths)) {
          const star = pattern.indexOf("*");
          const match = star < 0 ? specifier === pattern : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
          if (!match) continue;
          const token = star < 0 ? "" : specifier.slice(star, specifier.length - (pattern.length - star - 1));
          for (const replacement of replacements) candidates.push(resolve(config.baseUrl ?? config.pathsBase, replacement.replace("*", token)));
        }
        if (config.baseUrl) candidates.push(resolve(config.baseUrl, specifier));
      }
      for (const base of candidates) {
        // ESM source imports name the emitted file, not the original TypeScript file.
        const mapped: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };
        for (const ext of mapped[extname(base)] ?? []) {
          const hit = this.pick(base.slice(0, -extname(base).length) + ext, []);
          if (hit.length) return hit;
        }
        const hit = this.pick(base, JS_EXTENSIONS, "index");
        if (hit.length) return hit;
      }
    } else if (lang === "python") {
      const dots = /^\.+/.exec(specifier)?.[0].length ?? 0;
      const suffix = specifier.slice(dots).split(".").filter(Boolean);
      let base = dots ? dirname(from) : this.root;
      for (let i = 1; i < dots; i++) base = dirname(base);
      const hit = this.pick(join(base, ...suffix), [".py"], "__init__");
      if (hit.length) return hit;
      if (!dots) return this.pick(join(this.root, "src", ...suffix), [".py"], "__init__");
    } else if (lang === "rust") {
      const parts = specifier.split("::").filter(Boolean);
      let base = ["lib.rs", "main.rs"].includes(basename(from)) || basename(from) === "mod.rs" ? dirname(from) : join(dirname(from), basename(from, ".rs"));
      if (parts[0] === "crate") {
        base = dirname(from);
        while (insideRepo(base, this.root) && !isFile(join(base, "lib.rs")) && !isFile(join(base, "main.rs"))) {
          if (base === this.root) break;
          base = dirname(base);
        }
        parts.shift();
      } else if (parts[0] === "self") parts.shift();
      else if (parts[0] === "super") {
        // An inline module's parent is its file; an out-of-line module's parent is its directory.
        base = dirname(from);
        parts.shift();
        while (parts[0] === "super") { base = dirname(base); parts.shift(); }
      }
      for (let size = parts.length; size > 0; size--) {
        const hit = this.pick(join(base, ...parts.slice(0, size)), [".rs"], "mod");
        if (hit.length) return hit;
      }
    } else if (lang === "swift") {
      return (this.swiftModules.get(specifier) ?? []).filter(path => path !== from);
    } else if (lang === "go") {
      const module = this.goModule(from);
      if (module && (specifier === module.name || specifier.startsWith(`${module.name}/`))) {
        const dir = resolve(module.root, specifier.slice(module.name.length).replace(/^\//, ""));
        if (this.goModule(join(dir, "_package.go"))?.root === module.root) return this.goPackages.get(dir) ?? [];
      }
    }
    return [];
  }
}

function jsImports(node: Node): ImportRef | null {
  const source = node.childForFieldName("source");
  if (!source) return null;
  const bindings: ImportRef["bindings"] = [];
  const clause = namedChildren(node).find(child => child.type === "import_clause");
  if (clause) {
    for (const child of namedChildren(clause)) {
      if (child.type === "identifier") bindings.push({ local: child.text, symbol: "default" });
      else if (child.type === "namespace_import") {
        const name = namedChildren(child).find(part => part.type === "identifier");
        if (name) bindings.push({ local: name.text, symbol: "*" });
      } else if (child.type === "named_imports") {
        for (const item of namedChildren(child)) bindings.push({ local: field(item, "alias") || field(item, "name"), symbol: field(item, "name") });
      }
    }
  }
  return { specifier: unquote(source.text), bindings };
}

function extractFacts(path: string, lang: string, hash: string, root: Node): FileFacts {
  const facts: FileFacts = { path, lang, hash, exports: new Set(), imports: [], calls: [], inherits: [] };
  const js = lang === "typescript" || lang === "javascript" || lang === "tsx";
  walk(root, node => {
    if (js) {
      if (node.type === "import_statement" || node.type === "export_statement") {
        const ref = jsImports(node);
        if (ref) facts.imports.push(ref);
      }
      if (node.type === "export_statement") {
        if (namedChildren(node, false).some(child => child.type === "default")) facts.exports.add("default");
        const declaration = node.childForFieldName("declaration");
        if (declaration) {
          const name = symbolName(declaration);
          if (name) facts.exports.add(name);
          for (const child of namedChildren(declaration)) if (child.type === "variable_declarator") facts.exports.add(symbolName(child));
        }
        const clause = namedChildren(node).find(child => child.type === "export_clause");
        for (const item of namedChildren(clause)) facts.exports.add(field(item, "alias") || field(item, "name"));
      }
      if (node.type === "call_expression" && ["require", "import"].includes(field(node, "function"))) {
        const args = node.childForFieldName("arguments");
        const source = namedChildren(args)[0];
        if (source?.type === "string") {
          const bindings: ImportRef["bindings"] = [];
          const declarator = node.parent;
          if (declarator?.type === "variable_declarator") {
            const name = declarator.childForFieldName("name");
            if (name?.type === "identifier") bindings.push({ local: name.text, symbol: "*" });
            else for (const child of namedChildren(name)) bindings.push({ local: field(child, "value") || child.text, symbol: field(child, "key") || child.text });
          }
          facts.imports.push({ specifier: unquote(source.text), bindings });
        }
      }
      if (node.type === "assignment_expression") {
        const left = field(node, "left");
        if (left === "module.exports") facts.exports.add("*");
        else if (left.startsWith("exports.")) facts.exports.add(left.slice(8));
        else if (left.startsWith("module.exports.")) facts.exports.add(left.slice(15));
      }
      if (node.type === "extends_clause" || node.type === "implements_clause") {
        for (const child of namedChildren(node)) facts.inherits.push(child.text);
      }
      if (node.type === "class_heritage" && lang === "javascript") {
        for (const child of namedChildren(node)) facts.inherits.push(child.text);
      }
    } else if (lang === "python") {
      if (node.type === "import_from_statement") {
        const module = field(node, "module_name");
        const bindings: ImportRef["bindings"] = [];
        for (const child of namedChildren(node)) {
          if (child.id === node.childForFieldName("module_name")?.id || ["relative_import", "import_prefix"].includes(child.type)) continue;
          if (child.type === "aliased_import") bindings.push({ local: field(child, "alias"), symbol: field(child, "name") });
          else if (child.type === "dotted_name") bindings.push({ local: child.text, symbol: child.text });
        }
        facts.imports.push({ specifier: module, bindings });
      } else if (node.type === "import_statement") {
        for (const child of namedChildren(node)) {
          const specifier = child.type === "aliased_import" ? field(child, "name") : child.text;
          const alias = field(child, "alias");
          facts.imports.push({ specifier, bindings: [{ local: alias || specifier, symbol: "*" }] });
        }
      }
      if (node.type === "class_definition") {
        for (const child of namedChildren(node.childForFieldName("superclasses"))) facts.inherits.push(child.text);
      }
    } else if (lang === "rust") {
      if (node.type === "mod_item" && !node.childForFieldName("body")) {
        const name = field(node, "name");
        facts.imports.push({ specifier: name, bindings: [{ local: name, symbol: "*" }] });
      } else if (node.type === "use_declaration") {
        const argument = node.childForFieldName("argument");
        if (argument) {
          const collect = (item: Node, prefix = ""): void => {
            if (item.type === "scoped_use_list") {
              const path = field(item, "path");
              const list = item.childForFieldName("list");
              for (const child of namedChildren(list)) collect(child, prefix + path + "::");
            } else if (item.type === "use_list") {
              for (const child of namedChildren(item)) collect(child, prefix);
            } else {
              const path = prefix + (item.type === "use_as_clause" ? field(item, "path") : item.text);
              const local = field(item, "alias") || path.split("::").pop() || path;
              facts.imports.push({ specifier: path, bindings: [{ local, symbol: path.split("::").pop() || "*" }] });
            }
          };
          collect(argument);
        }
      }
      if (node.type === "impl_item") {
        const trait = field(node, "trait");
        if (trait) facts.inherits.push(trait);
      }
    } else if (lang === "swift") {
      if (node.type === "import_declaration") {
        const module = namedChildren(node).find(child => child.type === "identifier")?.text;
        if (module) facts.imports.push({ specifier: module, bindings: [] });
      }
      if (node.type === "inheritance_specifier") facts.inherits.push(field(node, "inherits_from"));
    } else if (lang === "go" && node.type === "import_spec") {
      const path = node.childForFieldName("path");
      if (path) {
        const specifier = unquote(path.text);
        facts.imports.push({ specifier, bindings: [{ local: field(node, "name") || basename(specifier), symbol: "*" }] });
      }
    }
    if (["call_expression", "call", "new_expression"].includes(node.type)) {
      const callable = field(node, "function") || field(node, "constructor") || (lang === "swift" ? namedChildren(node)[0]?.text : "");
      if (callable) facts.calls.push(callable);
    }
    if (!js && node.parent?.id === root.id) {
      const name = symbolName(node);
      if (name && (lang !== "rust" || namedChildren(node).some(child => child.type === "visibility_modifier")) && (lang !== "go" || /^[A-Z]/.test(name))) facts.exports.add(name);
      // Imported Python names are public package re-exports too.
      if (lang === "python") for (const ref of facts.imports) for (const binding of ref.bindings) facts.exports.add(binding.local);
    }
  });
  return facts;
}

function readExports(row: CacheRow | undefined): Set<string> {
  if (!row) return new Set();
  try {
    const parsed: unknown = JSON.parse(row.exports_json);
    return new Set(Array.isArray(parsed) ? parsed.filter((value: unknown): value is string => typeof value === "string") : []);
  } catch { return new Set(); }
}

function changedFiles(root: string, since: string): Set<string> {
  // execFile prevents revisions or repository paths from becoming shell instructions.
  const tracked = execFileSync("git", ["-C", root, "diff", "--name-only", "-z", since, "--"], { encoding: "utf8" });
  const untracked = execFileSync("git", ["-C", root, "ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8" });
  return new Set((tracked + untracked).split("\0").filter(Boolean).map(path => resolve(root, path)));
}

export async function scanCodeGraph(repoPath: string, opts: CodeGraphOptions = {}): Promise<CodeGraphResult> {
  const root = resolve(repoPath);
  const files = sourceFiles(root);
  const fileSet = new Set(files);
  const selected = opts.since ? changedFiles(root, opts.since) : fileSet;
  const resolver = new Resolver(root, fileSet);
  const result: CodeGraphResult = { edges: [], scanned: 0, skipped: 0, unavailable: [] };
  const facts = new Map<string, FileFacts>();
  const exported = new Map<string, Set<string>>();
  const cache = new Map((opts.db?.prepare("SELECT path, content_hash, exports_json FROM codegraph_files WHERE repo = ?").all(root) as (CacheRow & { path: string })[] | undefined ?? []).map(row => [row.path, row]));
  if (opts.since && !opts.db?.prepare("SELECT 1 FROM codegraph_files WHERE repo = ? LIMIT 1").get(root)) {
    throw new Error("--since requires an initial full bootstrap --imports scan in this database");
  }
  // Config changes invalidate resolution hashes without loading parsers for unchanged code.
  const configFingerprint = ["tsconfig.json", "jsconfig.json", "go.mod", "Package.swift"].map(name => {
    const path = join(root, name);
    return isFile(path) ? readFileSync(path, "utf8") : "";
  }).join("\0");
  for (const path of files) exported.set(path, readExports(cache.get(path)));
  const changedExports = new Set([...cache.keys()].filter(path => !fileSet.has(path)));
  const parseFile = async (path: string, force = false): Promise<void> => {
    const old = cache.get(path);
    const source = readFileSync(path, "utf8");
    const hash = createHash("sha256").update(GRAPH_VERSION).update(configFingerprint).update(resolver.fingerprint(path)).update(source).digest("hex");
    if (!force && old?.content_hash === hash) { result.skipped++; return; }
    const lang = getSupportedLang(path);
    if (!lang) return;
    const parser = await getParser(lang);
    if (!parser) { if (!result.unavailable.includes(lang)) result.unavailable.push(lang); return; }
    const tree = parser.parse(source);
    if (!tree) return;
    try {
      const extracted = extractFacts(path, lang, hash, tree.rootNode);
      const priorExports = readExports(old);
      if (priorExports.size !== extracted.exports.size || [...priorExports].some(name => !extracted.exports.has(name))) changedExports.add(path);
      facts.set(path, extracted);
      exported.set(path, extracted.exports);
      result.scanned++;
    } finally { tree.delete(); }
  };
  for (const path of files) if (selected.has(path)) await parseFile(path);
  // The cache stores exports, not syntax facts. Reparse inbound sources when a target's
  // API changes, even under --since; derive/store all affected edges in one transaction.
  if (opts.db) {
    const inbound = opts.db.prepare("SELECT DISTINCT from_path FROM code_edges WHERE repo = ? AND to_path = ?");
    const sources = new Set<string>();
    for (const target of changedExports) {
      for (const row of inbound.all(root, target) as { from_path: string }[]) {
        if (fileSet.has(row.from_path) && !facts.has(row.from_path)) sources.add(row.from_path);
      }
    }
    for (const path of sources) await parseFile(path, true);
  }
  for (const file of facts.values()) {
    const edges = new Map<string, CodeEdge>();
    const bindings = new Map<string, Binding>();
    const add = (to: string, kind: CodeEdge["kind"]): void => {
      if (to === file.path) return;
      const key = `${kind}\0${to}`;
      const existing = edges.get(key);
      if (existing) existing.count++;
      else edges.set(key, { from: file.path, to, kind, count: 1 });
    };
    for (const ref of file.imports) {
      const targets = resolver.resolve(ref.specifier, file.path, file.lang);
      // Python `from . import helper` names a submodule rather than a package export.
      for (const binding of ref.bindings) {
        const submodule = file.lang === "python" ? resolver.resolve(`${ref.specifier}${ref.specifier.endsWith(".") ? "" : "."}${binding.symbol}`, file.path, file.lang) : [];
        const boundTargets = submodule.length ? submodule : targets;
        if (submodule.length) { for (const target of submodule) add(target, "import"); }
        const rustModule = file.lang === "rust" && boundTargets.some(target => (basename(target) === "mod.rs" ? basename(dirname(target)) : basename(target, ".rs")) === binding.symbol);
        bindings.set(binding.local, { targets: boundTargets, symbol: submodule.length || rustModule ? "*" : binding.symbol });
      }
      for (const target of targets) add(target, "import");
      if (file.lang === "swift") {
        for (const target of targets) for (const name of exported.get(target) ?? []) {
          // Do not guess when two imported modules export the same unqualified symbol.
          const prior = bindings.get(name);
          bindings.set(name, { targets: prior ? [...prior.targets, target] : [target], symbol: name });
        }
      }
    }
    const targetFor = (reference: string): string | null => {
      const normalized = reference.replace(/<.*>$/, "");
      let binding = bindings.get(normalized);
      let symbol = binding?.symbol ?? "";
      if (!binding) {
        // Namespace imports and static methods of imported classes/functions.
        for (const [local, candidate] of bindings) {
          for (const separator of [".", "::"]) {
            if (normalized.startsWith(local + separator)) {
              binding = candidate;
              symbol = candidate.symbol === "*" ? normalized.slice(local.length + separator.length).split(/[.:]/)[0] : candidate.symbol;
            }
          }
        }
      }
      if (!binding) return null;
      const candidates = binding.targets.filter(target => {
        const names = exported.get(target);
        return names?.has(symbol) || names?.has("*") || (symbol === "*" && names?.has("default"));
      });
      return candidates.length === 1 ? candidates[0] : null;
    };
    for (const call of file.calls) { const target = targetFor(call); if (target) add(target, "call"); }
    for (const inherited of file.inherits) { const target = targetFor(inherited); if (target) add(target, "inherit"); }
    result.edges.push(...edges.values());
  }
  if (opts.db && opts.persist !== false) {
    const db = opts.db;
    const storeFile = db.prepare("INSERT INTO codegraph_files(repo,path,content_hash,exports_json) VALUES (?,?,?,?) ON CONFLICT(repo,path) DO UPDATE SET content_hash=excluded.content_hash,exports_json=excluded.exports_json");
    const clearEdges = db.prepare("DELETE FROM code_edges WHERE repo = ? AND from_path = ?");
    const storeEdge = db.prepare("INSERT INTO code_edges(repo,from_path,to_path,kind,count,seeded_weight) VALUES (?,?,?,?,?,?)");
    const store = db.transaction(() => {
      for (const file of facts.values()) {
        storeFile.run(root, file.path, file.hash, JSON.stringify([...file.exports]));
        clearEdges.run(root, file.path);
      }
      for (const edge of result.edges) storeEdge.run(root, edge.from, edge.to, edge.kind, edge.count, structuralWeight(edge));
      const cached = db.prepare("SELECT path FROM codegraph_files WHERE repo = ?").all(root) as { path: string }[];
      for (const { path } of cached) if (!fileSet.has(path)) {
        db.prepare("DELETE FROM codegraph_files WHERE repo = ? AND path = ?").run(root, path);
        db.prepare("DELETE FROM code_edges WHERE repo = ? AND (from_path = ? OR to_path = ?)").run(root, path, path);
      }
      reconcileSeeds(db);
    });
    store();
  }
  return result;
}

function structuralWeight(edge: CodeEdge): number {
  return Math.min(0.35, CODE_EDGE_WEIGHTS[edge.kind] + (edge.kind === "call" ? Math.log(edge.count) * 0.05 : 0));
}

interface StructuralSeed { source_id: string; target_id: string; weight: number; co_access_count: number; }
function seedKey(source: string, target: string): string { return `${source}\0${target}`; }

function structuralSeeds(db: Database.Database): Map<string, StructuralSeed> {
  const seeds = new Map<string, StructuralSeed>();
  const add = (source: string, target: string, weight: number, count: number): void => {
    const key = seedKey(source, target);
    const prior = seeds.get(key);
    if (prior) { prior.weight = Math.max(prior.weight, weight); prior.co_access_count += count; }
    else seeds.set(key, { source_id: source, target_id: target, weight, co_access_count: count });
  };
  for (const row of db.prepare("SELECT from_path,to_path,count,seeded_weight FROM code_edges").all() as { from_path: string; to_path: string; count: number; seeded_weight: number }[]) {
    const source = `file:${row.from_path}`, target = `file:${row.to_path}`;
    add(source, target, row.seeded_weight, row.count);
    add(target, source, row.seeded_weight * CODE_REVERSE_FACTOR, row.count);
  }
  return seeds;
}

/** Reconcile only an exact seed snapshot. Weight OR count changes mean learning owns it. */
function reconcileSeeds(db: Database.Database): void {
  const desired = structuralSeeds(db);
  const update = db.prepare("UPDATE synapses SET weight = ?, co_access_count = ? WHERE source_id = ? AND target_id = ? AND weight = ? AND co_access_count = ?");
  const remove = db.prepare("DELETE FROM synapses WHERE source_id = ? AND target_id = ? AND weight = ? AND co_access_count = ?");
  const forget = db.prepare("DELETE FROM codegraph_seeds WHERE source_id = ? AND target_id = ?");
  const remember = db.prepare("UPDATE codegraph_seeds SET weight = ?, co_access_count = ? WHERE source_id = ? AND target_id = ?");
  for (const old of db.prepare("SELECT * FROM codegraph_seeds").all() as StructuralSeed[]) {
    const next = desired.get(seedKey(old.source_id, old.target_id));
    if (!next) {
      remove.run(old.source_id, old.target_id, old.weight, old.co_access_count);
      forget.run(old.source_id, old.target_id);
    } else if (next.weight !== old.weight || next.co_access_count !== old.co_access_count) {
      const changed = update.run(next.weight, next.co_access_count, old.source_id, old.target_id, old.weight, old.co_access_count);
      if (changed.changes) remember.run(next.weight, next.co_access_count, old.source_id, old.target_id);
      else forget.run(old.source_id, old.target_id);
    }
  }
}

export function seedCodeEdges(engine: HebbianEngine, edges: CodeEdge[], db: Database.Database): void {
  const desired = structuralSeeds(db);
  const visited = new Set<string>();
  const get = db.prepare("SELECT source_id,target_id,weight,co_access_count FROM synapses WHERE source_id = ? AND target_id = ?");
  const restore = db.prepare("UPDATE synapses SET weight = ?, co_access_count = ? WHERE source_id = ? AND target_id = ?");
  const remember = db.prepare("INSERT INTO codegraph_seeds(source_id,target_id,weight,co_access_count) VALUES (?,?,?,?) ON CONFLICT(source_id,target_id) DO UPDATE SET weight=excluded.weight,co_access_count=excluded.co_access_count");
  for (const edge of edges) {
    const source = `file:${edge.from}`, target = `file:${edge.to}`;
    const key = seedKey(source, target), reverseKey = seedKey(target, source);
    if (visited.has(key)) continue;
    visited.add(key); visited.add(reverseKey);
    const forward = desired.get(key), reverse = desired.get(reverseKey);
    if (!forward || !reverse) continue;
    const oldForward = get.get(source, target) as StructuralSeed | undefined;
    const oldReverse = get.get(target, source) as StructuralSeed | undefined;
    if (oldForward && oldReverse) continue;
    engine.seedNeuron(edge.from, "file", "structural dependency");
    engine.seedNeuron(edge.to, "file", "structural dependency");
    engine.seedSynapse(edge.from, edge.to, forward.weight, forward.co_access_count, reverse.weight);
    // Seeding is not another observed co-access. Preserve existing (possibly learned)
    // directions; claim provenance only for directions actually created by structure.
    for (const [old, next] of [[oldForward, forward], [oldReverse, reverse]] as const) {
      if (old) restore.run(old.weight, old.co_access_count, old.source_id, old.target_id);
      else remember.run(next.source_id, next.target_id, next.weight, next.co_access_count);
    }
  }
}
