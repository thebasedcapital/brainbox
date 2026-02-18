/**
 * BrainBox Commit Learning (v2.1): Change-Set Prediction from Git History
 *
 * Each git commit becomes a semantic neuron. Its embedding = commit_message.
 * Its contexts store [commit_message, "files:path1,path2,..."].
 * At recall time, match query embedding against commit embeddings → return
 * the file lists from matching commits.
 *
 * This enables "these 5 files change together for this type of change."
 */

import type Database from "better-sqlite3";
import { join } from "path";
import { HebbianEngine } from "./hebbian.js";
import type { GitCommit } from "./bootstrap.js";

// --- Types ---

export interface ChangeSetPrediction {
  files: string[];
  confidence: number;
  commitHash: string;
  commitMessage: string;
}

// --- Constants ---

/** Min commit neurons before enabling change-set predictions */
const MIN_COMMIT_NEURONS = 20;

/** Min commit message length (skip noise like "wip", "fix") */
const MIN_MESSAGE_LENGTH = 5;

/** Min files per commit (single-file commits don't teach co-access) */
const MIN_FILES_PER_COMMIT = 2;

/** Max files per commit (bulk changes like formatting are noise) */
const MAX_FILES_PER_COMMIT = 20;

// --- Core ---

/**
 * Create commit neurons from git history.
 * Each qualifying commit becomes a semantic neuron with its message as context
 * and file list stored for change-set prediction.
 * Synchronous — embeddings happen in background via auto-embed.
 */
export function indexCommits(
  commits: GitCommit[],
  engine: HebbianEngine,
  repoPath: string
): number {
  let created = 0;

  for (const commit of commits) {
    // Quality bar
    if (commit.message.length < MIN_MESSAGE_LENGTH) continue;
    if (commit.files.length < MIN_FILES_PER_COMMIT) continue;
    if (commit.files.length > MAX_FILES_PER_COMMIT) continue;
    if (/^merge\b/i.test(commit.message)) continue;

    const hashPrefix = commit.hash.slice(0, 8);
    const absFiles = commit.files.map(f =>
      f.startsWith("/") ? f : join(repoPath, f)
    );
    const fileList = "files:" + absFiles.join(",");

    // Seed as semantic neuron: path = "commit:<hash>", contexts = [message]
    engine.seedNeuron(`commit:${hashPrefix}`, "semantic", commit.message);

    // Append file list to contexts (seedNeuron only sets first context)
    const neuronId = `semantic:commit:${hashPrefix}`;
    engine.appendContext(neuronId, fileList);

    created++;
  }

  return created;
}

/**
 * Predict file change-sets based on task intent.
 * Recalls semantic (commit) neurons matching the query, then extracts
 * file lists from their contexts.
 */
export async function predictChangeSet(
  query: string,
  db: Database.Database,
  minConfidence: number = 0.5
): Promise<ChangeSetPrediction[]> {
  const engine = new HebbianEngine(db, `changeset-${Date.now()}`);

  const results = await engine.recall({
    query,
    type: "semantic",
    limit: 10,
    token_budget: 5000,
  });

  const predictions: ChangeSetPrediction[] = [];

  for (const r of results) {
    if (r.confidence < minConfidence) continue;

    const contexts = typeof r.neuron.contexts === "string"
      ? JSON.parse(r.neuron.contexts) as string[]
      : r.neuron.contexts;
    const fileListCtx = contexts.find(c => c.startsWith("files:"));
    if (!fileListCtx) continue;

    const files = fileListCtx.slice(6).split(",").filter(f => f.length > 0);
    if (files.length === 0) continue;

    // Filter to files that exist as file neurons (skip deleted files)
    const existingFiles = files.filter(f => {
      const n = db.prepare("SELECT id FROM neurons WHERE id = ? AND type = 'file'").get(`file:${f}`);
      return !!n;
    });
    if (existingFiles.length === 0) continue;

    const commitHash = r.neuron.path.replace("commit:", "");

    predictions.push({
      files: existingFiles,
      confidence: r.confidence,
      commitHash,
      commitMessage: contexts[0] || "",
    });
  }

  return predictions;
}

/**
 * Check if commit learning is enabled (enough commit neurons indexed).
 */
export function isCommitLearningEnabled(db: Database.Database): boolean {
  const row = db.prepare(
    "SELECT COUNT(*) as cnt FROM neurons WHERE type = 'semantic' AND path LIKE 'commit:%'"
  ).get() as { cnt: number };
  return row.cnt >= MIN_COMMIT_NEURONS;
}

/**
 * Get commit neuron count for stats.
 */
export function commitNeuronCount(db: Database.Database): number {
  const row = db.prepare(
    "SELECT COUNT(*) as cnt FROM neurons WHERE type = 'semantic' AND path LIKE 'commit:%'"
  ).get() as { cnt: number };
  return row.cnt;
}
