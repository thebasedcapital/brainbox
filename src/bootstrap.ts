/**
 * BrainBox Bootstrap: Multi-Source Neural Network Seeder
 *
 * Seeds the neural network from available data sources. Eliminates cold start.
 * Each source is independent and additive — use --auto to try all.
 *
 * Sources (in order of signal strength):
 *   Git history:    files changed together in commits form co-access synapses
 *   VaultGraph:     markdown files linked via [[wikilinks]] form strong synapses
 *   Import graph:   TypeScript/JavaScript import relationships
 *   Dir patterns:   same-name files across directories (auth.ts ↔ auth.test.ts)
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname, relative, basename } from "path";
import { openDb } from "./db.js";
import { HebbianEngine } from "./hebbian.js";
import { indexCommits } from "./commit-learning.js";

// --- Types ---

export interface GitCommit {
  hash: string;
  timestamp: number; // unix seconds
  message: string;
  files: string[];
}

export interface BootstrapOptions {
  repo: string;
  maxCommits: number;
  imports: boolean;
  vault?: string;
  patterns: boolean;
  sessions: boolean;
  auto: boolean;
  dryRun: boolean;
}

interface BootstrapResult {
  commits: number;
  filesRecorded: number;
  synapsesExpected: number;
  importEdges: number;
  vaultEdges: number;
  patternEdges: number;
  sessionEdges: number;
  uniqueFiles: Set<string>;
  skippedGit: boolean;
}

// --- Git history parsing ---

const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp",
  ".woff", ".woff2", ".ttf", ".eot",
  ".zip", ".tar", ".gz", ".bz2",
  ".pdf", ".doc", ".docx",
  ".lock", ".map",
]);

const SKIP_PATHS = [
  /node_modules\//,
  /\.git\//,
  /vendor\//,
  /dist\//,
  /build\//,
  /\.next\//,
  /coverage\//,
  /__pycache__\//,
];

/** Low-signal files that appear in many commits but rarely help with tasks */
const SKIP_BASENAMES = new Set([
  "package.json",
  ".gitignore",
  ".env",
  ".env.example",
  ".env.dev",
  ".env.dev-local-server",
  "tsconfig.json",
  ".eslintrc.js",
  ".prettierrc",
  "bun.lock",
  "LICENSE",
]);

function shouldSkipFile(filePath: string): boolean {
  if (SKIP_PATHS.some((p) => p.test(filePath))) return true;
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return true;
  if (filePath.endsWith(".min.js") || filePath.endsWith(".min.css")) return true;
  const basename = filePath.split("/").pop() || "";
  if (SKIP_BASENAMES.has(basename)) return true;
  return false;
}

export function parseGitLog(repoPath: string, maxCommits: number): GitCommit[] {
  const cmd = `git -C "${repoPath}" log --name-only --pretty=format:"COMMIT:%H%nDATE:%at%nMSG:%s%n" --all -n ${maxCommits}`;
  let stdout: string;
  try {
    stdout = execSync(cmd, { maxBuffer: 50 * 1024 * 1024, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return []; // No git available — skip gracefully
  }

  const commits: GitCommit[] = [];
  let current: Partial<GitCommit> | null = null;

  /** Check if a parsed commit should be kept (filters noise) */
  function shouldKeepCommit(c: Partial<GitCommit> | null): boolean {
    if (!c || !c.hash || !c.files || c.files.length === 0) return false;
    // Skip merge commits
    if (c.message?.toLowerCase().includes("merge")) return false;
    // Skip bulk changes (>20 source files — likely formatting/refactor)
    if (c.files.length > 20) return false;
    return true;
  }

  for (const line of stdout.split("\n")) {
    if (line.startsWith("COMMIT:")) {
      // Save previous commit (with noise filtering)
      if (shouldKeepCommit(current as Partial<GitCommit>)) {
        commits.push(current as GitCommit);
      }
      current = { hash: line.slice(7), files: [] };
    } else if (line.startsWith("DATE:")) {
      if (current) current.timestamp = parseInt(line.slice(5), 10);
    } else if (line.startsWith("MSG:")) {
      if (current) current.message = line.slice(4);
    } else {
      const trimmed = line.trim();
      if (trimmed && current?.files && !shouldSkipFile(trimmed)) {
        current.files.push(trimmed);
      }
    }
  }
  // Don't forget the last commit
  if (shouldKeepCommit(current as Partial<GitCommit>)) {
    commits.push(current as GitCommit);
  }

  return commits;
}

// --- Import graph scanning ---

const IMPORT_REGEX = /(?:import\s+.*?\s+from\s+['"](.+?)['"]|require\s*\(\s*['"](.+?)['"]\s*\))/g;

function extractImports(filePath: string): string[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const imports: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(IMPORT_REGEX.source, "g");
  while ((match = re.exec(content)) !== null) {
    const importPath = match[1] || match[2];
    // Only resolve relative imports (skip npm packages)
    if (importPath && (importPath.startsWith(".") || importPath.startsWith("/"))) {
      imports.push(importPath);
    }
  }
  return imports;
}

function resolveImportPath(importPath: string, fromFile: string): string | null {
  const dir = dirname(fromFile);
  const extensions = [".ts", ".tsx", ".js", ".jsx", ""];
  const base = resolve(dir, importPath);

  // Direct match
  for (const ext of extensions) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }

  // Handle .js → .ts remapping (common in ESM TypeScript projects)
  if (importPath.endsWith(".js")) {
    const tsBase = resolve(dir, importPath.replace(/\.js$/, ""));
    for (const ext of [".ts", ".tsx"]) {
      const candidate = tsBase + ext;
      if (existsSync(candidate)) return candidate;
    }
  }

  // Try index files
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const candidate = join(base, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function findSourceFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  const extSet = new Set(extensions);

  function walk(currentDir: string) {
    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      if (SKIP_PATHS.some((p) => p.test(fullPath + "/"))) continue;
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else {
          const ext = fullPath.substring(fullPath.lastIndexOf(".")).toLowerCase();
          if (extSet.has(ext)) results.push(fullPath);
        }
      } catch {
        // Skip inaccessible files
      }
    }
  }

  walk(dir);
  return results;
}

export interface ImportEdge {
  from: string;
  to: string;
}

export function scanImportGraph(repoPath: string): ImportEdge[] {
  const sourceFiles = findSourceFiles(repoPath, [".ts", ".tsx", ".js", ".jsx"]);
  const edges: ImportEdge[] = [];

  for (const file of sourceFiles) {
    const imports = extractImports(file);
    for (const imp of imports) {
      const resolved = resolveImportPath(imp, file);
      if (resolved) {
        edges.push({ from: file, to: resolved });
      }
    }
  }

  return edges;
}

// --- VaultGraph scanning ---

/**
 * Parse a VaultGraph adjacency list into edges.
 * VaultGraph outputs JSON like: { "MEMORY": ["brainbox-arch", "goals"], ... }
 * Each wikilink becomes a synapse between the two notes.
 */
export function parseVaultGraph(vaultPath: string): ImportEdge[] {
  const absVault = resolve(vaultPath);
  try {
    const json = execSync(
      `vaultgraph -v "${absVault}" -f json graph`,
      { encoding: "utf-8", timeout: 10000 }
    ).trim();
    if (!json) return [];
    const graph: Record<string, string[]> = JSON.parse(json);
    const edges: ImportEdge[] = [];
    for (const [source, targets] of Object.entries(graph)) {
      for (const target of targets) {
        edges.push({
          from: join(absVault, source + ".md"),
          to: join(absVault, target + ".md"),
        });
      }
    }
    return edges;
  } catch {
    return []; // vaultgraph not installed or not a vault — skip
  }
}

// --- Directory pattern scanning ---

/** File extensions to include in directory pattern scanning (language-agnostic) */
const PATTERN_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".swift",
  ".rb", ".java", ".kt", ".scala",
  ".c", ".cpp", ".h", ".hpp",
  ".cs", ".php", ".lua", ".zig",
  ".md", ".mdx",
  ".css", ".scss", ".less",
  ".html", ".vue", ".svelte",
];

/** Suffixes that indicate a related file (test, spec, stories, etc.) */
const RELATED_SUFFIXES = /\.(test|spec|stories|story|styles|module|mock|stub|fixture|d)\./i;

/**
 * Scan directory for structurally related files.
 * Groups files by normalized basename: auth.ts ↔ auth.test.ts ↔ auth.css
 */
export function scanDirectoryPatterns(repoPath: string): ImportEdge[] {
  const files = findSourceFiles(resolve(repoPath), PATTERN_EXTENSIONS);
  const edges: ImportEdge[] = [];

  // Group by normalized basename (strip extension + test/spec/etc suffix)
  const byBasename = new Map<string, string[]>();
  for (const file of files) {
    const name = basename(file);
    const normalized = name
      .replace(RELATED_SUFFIXES, ".")
      .replace(/\.[^.]+$/, "")
      .toLowerCase();
    const group = byBasename.get(normalized) || [];
    group.push(file);
    byBasename.set(normalized, group);
  }

  // Files with same normalized basename → edges
  for (const group of byBasename.values()) {
    if (group.length < 2 || group.length > 8) continue; // skip singletons and noisy groups
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        edges.push({ from: group[i], to: group[j] });
      }
    }
  }

  return edges;
}

// --- Bipartite projection: commit → file co-occurrence ---

interface CoOccurrence {
  fileA: string;
  fileB: string;
  count: number;       // shared commits
  maxCount: number;    // for normalization
}

/**
 * Compute file-file co-occurrence from git commits using bipartite projection.
 * Instead of replaying through the co-access window, we directly compute
 * how many commits each pair of files shares. Weight ∝ shared commits.
 *
 * This naturally handles bridge files: auth.ts appearing in 7 commits
 * with login.ts gets weight 0.7 (capped at 0.95).
 */
function computeCoOccurrence(commits: GitCommit[], repoPath: string): {
  neurons: Map<string, string[]>; // path → context strings
  edges: CoOccurrence[];
} {
  // Track per-file contexts (commit messages)
  const neurons = new Map<string, string[]>();
  // Count co-occurrences for each file pair
  const pairCounts = new Map<string, number>();

  for (const commit of commits) {
    const absFiles = commit.files.map(f => join(repoPath, f));
    const context = commit.message.slice(0, 100);

    // Record neurons with context
    for (const file of absFiles) {
      const existing = neurons.get(file) || [];
      if (!existing.includes(context) && existing.length < 10) {
        existing.push(context);
      }
      neurons.set(file, existing);
    }

    // Count co-occurrences (each pair in this commit)
    for (let i = 0; i < absFiles.length; i++) {
      for (let j = i + 1; j < absFiles.length; j++) {
        const key = [absFiles[i], absFiles[j]].sort().join("\0");
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }

  // Find max for normalization
  let maxCount = 1;
  for (const count of pairCounts.values()) {
    if (count > maxCount) maxCount = count;
  }

  // Convert to edges
  const edges: CoOccurrence[] = [];
  for (const [key, count] of pairCounts) {
    const [fileA, fileB] = key.split("\0");
    edges.push({ fileA, fileB, count, maxCount });
  }

  return { neurons, edges };
}

// --- Claude Code session parsing ---

interface SessionAccess {
  filePath: string;
  tool: string;
  timestamp: number;
  sessionFile: string;
}

/**
 * Parse Claude Code session JSONL files to extract file accesses.
 * Each session is a natural co-access group.
 * Returns edges grouped by session (files accessed in the same session).
 */
export function parseClaudeSessions(projectDir?: string): {
  accesses: SessionAccess[];
  sessionGroups: Map<string, string[]>; // sessionFile → unique file paths
} {
  const home = process.env.HOME || "~";
  const projectsDir = projectDir || join(home, ".claude", "projects");
  const accesses: SessionAccess[] = [];
  const sessionGroups = new Map<string, string[]>();

  // Find all project directories
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsDir)
      .map(d => join(projectsDir, d))
      .filter(d => { try { return statSync(d).isDirectory(); } catch { return false; } });
  } catch {
    return { accesses, sessionGroups };
  }

  for (const projDir of projectDirs) {
    let jsonlFiles: string[];
    try {
      jsonlFiles = readdirSync(projDir).filter(f => f.endsWith(".jsonl"));
    } catch { continue; }

    for (const jsonlFile of jsonlFiles) {
      const fullPath = join(projDir, jsonlFile);
      let content: string;
      try {
        content = readFileSync(fullPath, "utf-8");
      } catch { continue; }

      const sessionFiles = new Set<string>();

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const ts = msg.timestamp || 0;
          const msgContent = msg.message?.content;
          if (!Array.isArray(msgContent)) continue;

          for (const block of msgContent) {
            if (block?.type !== "tool_use") continue;
            const tool = block.name || "";
            const input = block.input || {};
            const fp = input.file_path || input.path || "";
            if (!fp || fp.startsWith("/private/tmp")) continue;
            // Only track file-accessing tools
            if (!["Read", "Edit", "Write", "Glob", "Grep"].includes(tool)) continue;

            accesses.push({ filePath: fp, tool, timestamp: ts, sessionFile: jsonlFile });
            sessionFiles.add(fp);
          }
        } catch { /* skip unparseable lines */ }
      }

      if (sessionFiles.size >= 2) {
        sessionGroups.set(jsonlFile, [...sessionFiles]);
      }
    }
  }

  return { accesses, sessionGroups };
}

// --- Bootstrap execution ---

export function bootstrap(opts: BootstrapOptions): BootstrapResult {
  const repoPath = resolve(opts.repo);
  const result: BootstrapResult = {
    commits: 0,
    filesRecorded: 0,
    synapsesExpected: 0,
    importEdges: 0,
    vaultEdges: 0,
    patternEdges: 0,
    sessionEdges: 0,
    uniqueFiles: new Set(),
    skippedGit: false,
  };

  // --- Phase 1: Git history (bipartite projection) ---
  console.log(`Phase 1: Git history (up to ${opts.maxCommits} commits)...`);
  const commits = parseGitLog(repoPath, opts.maxCommits);
  if (commits.length === 0) {
    result.skippedGit = true;
    console.log("  Skipped — no git history available");
  } else {
    result.commits = commits.length;
    console.log(`  Found ${commits.length} commits with source files`);
  }

  // Compute co-occurrence (used in both dry-run and real run)
  const coOccurrence = commits.length > 0
    ? computeCoOccurrence(commits, repoPath)
    : { neurons: new Map<string, string[]>(), edges: [] as CoOccurrence[] };

  for (const path of coOccurrence.neurons.keys()) {
    result.uniqueFiles.add(path);
    result.filesRecorded++;
  }
  result.synapsesExpected += coOccurrence.edges.length * 2; // bidirectional

  if (coOccurrence.edges.length > 0) {
    console.log(`  Co-occurrence: ${coOccurrence.neurons.size} files, ${coOccurrence.edges.length} pairs`);
  }

  // Gather other phases data (for both dry-run and real run)
  let vaultEdges: ImportEdge[] = [];
  if (opts.vault || opts.auto) {
    const vaultPath = opts.vault || repoPath;
    console.log(`Phase 2: VaultGraph (${vaultPath})...`);
    vaultEdges = parseVaultGraph(vaultPath);
    result.vaultEdges = vaultEdges.length;
    console.log(vaultEdges.length === 0
      ? "  Skipped — no vault/wikilinks found"
      : `  Found ${vaultEdges.length} wikilink edges`);
    for (const e of vaultEdges) {
      result.uniqueFiles.add(e.from);
      result.uniqueFiles.add(e.to);
    }
    result.synapsesExpected += vaultEdges.length * 2;
  }

  let importEdgesList: ImportEdge[] = [];
  if (opts.imports) {
    console.log("Phase 3: Import graph...");
    importEdgesList = scanImportGraph(repoPath);
    result.importEdges = importEdgesList.length;
    console.log(importEdgesList.length === 0
      ? "  Skipped — no JS/TS imports found"
      : `  Found ${importEdgesList.length} import relationships`);
    for (const e of importEdgesList) {
      result.uniqueFiles.add(e.from);
      result.uniqueFiles.add(e.to);
    }
    result.synapsesExpected += importEdgesList.length * 2;
  }

  let patternEdgesList: ImportEdge[] = [];
  if (opts.patterns) {
    console.log("Phase 4: Directory patterns...");
    patternEdgesList = scanDirectoryPatterns(repoPath);
    result.patternEdges = patternEdgesList.length;
    console.log(patternEdgesList.length === 0
      ? "  Skipped — no filename patterns found"
      : `  Found ${patternEdgesList.length} filename pattern edges`);
    for (const e of patternEdgesList) {
      result.uniqueFiles.add(e.from);
      result.uniqueFiles.add(e.to);
    }
    result.synapsesExpected += patternEdgesList.length * 2;
  }

  // Phase 5: Claude Code sessions
  let sessionData: ReturnType<typeof parseClaudeSessions> | null = null;
  if (opts.sessions) {
    console.log("Phase 5: Claude Code sessions...");
    sessionData = parseClaudeSessions();
    const totalSessions = sessionData.sessionGroups.size;
    let sessionEdgeCount = 0;
    for (const files of sessionData.sessionGroups.values()) {
      const n = Math.min(files.length, 20); // cap to avoid huge sessions
      sessionEdgeCount += n * (n - 1) / 2;
      for (const f of files) result.uniqueFiles.add(f);
    }
    result.sessionEdges = sessionEdgeCount;
    result.synapsesExpected += sessionEdgeCount * 2;
    console.log(totalSessions === 0
      ? "  Skipped — no Claude Code sessions found"
      : `  Found ${totalSessions} sessions, ${sessionEdgeCount} co-access pairs`);
  }

  if (opts.dryRun) return result;

  // --- Real run: seed neurons and synapses directly ---
  const db = openDb();
  const engine = new HebbianEngine(db, `bootstrap-${Date.now()}`);

  // Use a transaction for performance
  const runInTransaction = db.transaction(() => {
    // Phase 1: Git — bipartite projection (direct seeding, no co-access window)
    if (coOccurrence.edges.length > 0) {
      // Seed neurons
      for (const [path, contexts] of coOccurrence.neurons) {
        engine.seedNeuron(path, "file", contexts[0]);
      }
      // Seed synapses with weight proportional to co-occurrence
      for (const edge of coOccurrence.edges) {
        // Normalize: 1 shared commit → 0.1, 10+ shared commits → 0.95
        const weight = Math.min(0.05 + (edge.count / edge.maxCount) * 0.9, 0.95);
        engine.seedSynapse(edge.fileA, edge.fileB, weight, edge.count);
      }
    }

    // Phase 2: VaultGraph
    for (const edge of vaultEdges) {
      engine.seedNeuron(edge.from, "file", "wikilink");
      engine.seedNeuron(edge.to, "file", "wikilink");
      engine.seedSynapse(edge.from, edge.to, 0.6); // strong: explicit links
    }

    // Phase 3: Import graph
    for (const edge of importEdgesList) {
      engine.seedNeuron(edge.from, "file", "import");
      engine.seedNeuron(edge.to, "file", "import");
      engine.seedSynapse(edge.from, edge.to, 0.5); // moderate: structural
    }

    // Phase 4: Directory patterns
    for (const edge of patternEdgesList) {
      engine.seedNeuron(edge.from, "file", "pattern");
      engine.seedNeuron(edge.to, "file", "pattern");
      engine.seedSynapse(edge.from, edge.to, 0.3); // weak: inferred
    }

    // Phase 5: Claude Code sessions
    if (sessionData) {
      for (const [, files] of sessionData.sessionGroups) {
        // Cap files per session to prevent combinatorial explosion
        const capped = files.slice(0, 20);
        for (const f of capped) {
          engine.seedNeuron(f, "file", "session");
        }
        // Co-accessed files in same session → moderate weight
        for (let i = 0; i < capped.length; i++) {
          for (let j = i + 1; j < capped.length; j++) {
            engine.seedSynapse(capped[i], capped[j], 0.4);
          }
        }
      }
    }
  });

  runInTransaction();

  // Phase 6: Commit neurons (v2.1 change-set learning)
  if (commits.length >= 2) {
    const commitCount = indexCommits(commits, engine, repoPath);
    console.log(`Phase 6: Created ${commitCount} commit neurons`);
  }

  db.close();

  return result;
}

// --- CLI entry point (used when run directly) ---

export function printResult(result: BootstrapResult, dryRun: boolean) {
  console.log("");
  console.log(dryRun ? "=== Dry Run Results ===" : "=== Bootstrap Complete ===");
  console.log(`  Git commits:          ${result.commits}${result.skippedGit ? " (skipped — not a git repo)" : ""}`);
  if (result.vaultEdges > 0)   console.log(`  Vault links:          ${result.vaultEdges}`);
  if (result.importEdges > 0)  console.log(`  Import edges:         ${result.importEdges}`);
  if (result.patternEdges > 0) console.log(`  Pattern edges:        ${result.patternEdges}`);
  if (result.sessionEdges > 0) console.log(`  Session pairs:        ${result.sessionEdges}`);
  console.log(`  ---`);
  console.log(`  Unique files:         ${result.uniqueFiles.size}`);
  console.log(`  Synapses (estimated): ${result.synapsesExpected}`);
  if (!dryRun) {
    console.log("");
    console.log("Neural network seeded. Run 'brainbox stats' to see the result.");
  }
}
