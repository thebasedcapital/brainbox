import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { asyncBufferFromUrl, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { object, parseOmp, parseOpenHands } from "./trajectory.js";
import type { Trajectory } from "./trajectory.js";

const DATASET = "nebius/SWE-rebench-openhands-trajectories";
const CACHE = join(homedir(), ".brainbox", "eval-cache", "nebius-v1");
const API = "https://datasets-server.huggingface.co";
export type EvaluationSplit = "dev" | "test";
export interface SourceOptions { repos: number; maxTasksPerRepo: number; limitTrajectories: number; split?: EvaluationSplit; reposOffset?: number }
export interface SourceResult { trajectories: Trajectory[]; metadata: Record<string, unknown> }
async function request(endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = `${API}/${endpoint}?${new URLSearchParams({ dataset: DATASET, config: "default", split: "train", ...params })}`;
  let failure: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (response.status === 429) {
        const retry = Number(response.headers.get("retry-after"));
        await delay(Number.isFinite(retry) && retry > 0 ? retry * 1000 : Math.min(300000, 30000 * (attempt + 1)));
        failure = new Error(`Dataset API rate limit: ${url}`);
        continue;
      }
      if (!response.ok) throw new Error(`Dataset API ${response.status}: ${url}`);
      return object(await response.json());
    } catch (error: unknown) { failure = error; await delay(1000 * (attempt + 1)); }
  }
  throw failure;
}
/** Disjoint repository-level splits: no task from a held-out repository can train fusion weights. */
export function repositorySplit(repo: string, globalRank: number, mode: "rank" | "hash"): EvaluationSplit {
  if (mode === "rank") return globalRank % 2 === 0 ? "dev" : "test";
  let hash = 2166136261;
  for (const char of repo) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash % 2 === 0 ? "dev" : "test";
}
export function selectTrajectories(all: Trajectory[], opts: SourceOptions, splitMode: "rank" | "hash" = "rank"): Trajectory[] {
  const grouped = new Map<string, Map<string, Trajectory>>();
  // One attempt per issue: parallel attempts of the same issue must not teach the target's solution.
  for (const trajectory of [...all].sort((a, b) => a.id.localeCompare(b.id))) {
    let tasks = grouped.get(trajectory.repo);
    if (!tasks) { tasks = new Map(); grouped.set(trajectory.repo, tasks); }
    const taskId = trajectory.instance_id || trajectory.id;
    if (!tasks.has(taskId)) tasks.set(taskId, trajectory);
  }
  const offset = opts.reposOffset ?? 0;
  const repos = [...grouped.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .slice(offset, offset + opts.repos).filter(([repo], rank) => !opts.split || repositorySplit(repo, rank + offset, splitMode) === opts.split);
  return repos.flatMap(([, tasks]) => [...tasks.values()].sort((a, b) => a.created_order - b.created_order || a.id.localeCompare(b.id)).slice(0, opts.maxTasksPerRepo)).slice(0, opts.limitTrajectories);
}
async function readJsonl(path: string): Promise<unknown[]> {
  const values: unknown[] = [];
  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.trim()) continue;
    try { values.push(JSON.parse(line)); } catch { /* Interrupted final session writes are not complete events. */ }
  }
  return values;
}
export async function loadNebius(opts: SourceOptions): Promise<SourceResult> {
  await mkdir(CACHE, { recursive: true });
  const indexPath = join(CACHE, "metadata-index.jsonl");
  let index: Trajectory[];
  if (existsSync(indexPath)) index = (await readJsonl(indexPath)) as Trajectory[];
  else {
    const response = await fetch(`https://huggingface.co/api/datasets/${DATASET}/parquet/default/train/0.parquet`, { method: "HEAD", signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Parquet metadata redirect: ${response.status}`);
    // Signed CDN URLs expire: resolve afresh, never persist them in the cache.
    const file = await asyncBufferFromUrl({ url: response.url });
    const rows: unknown[] = await parquetReadObjects({ file, compressors, columns: ["repo", "instance_id", "resolved"] });
    index = rows.map((value, rowIndex) => {
      const row = object(value);
      const instance = String(row.instance_id);
      return { id: String(rowIndex).padStart(8, "0"), repo: String(row.repo), instance_id: instance,
        created_order: Number(instance.match(/-(\d+)$/)?.[1] ?? 0), task_text: "", events: [], edited_files: [], outcome: { resolved: Number(row.resolved) } };
    });
    await writeFile(indexPath + ".tmp", index.map(row => JSON.stringify(row)).join("\n") + "\n");
    await rename(indexPath + ".tmp", indexPath);
  }
  const selected = selectTrajectories(index, opts);
  const trajectories: Trajectory[] = [];
  for (const item of selected) {
    const offset = Number(item.id);
    const cachedPage = join(CACHE, `rows-${Math.floor(offset / 100) * 100}.jsonl`);
    const path = join(CACHE, `trajectory-${offset}.jsonl`);
    let trajectory: Trajectory | undefined;
    if (existsSync(path)) trajectory = (await readJsonl(path))[0] as Trajectory;
    else if (existsSync(cachedPage)) trajectory = (await readJsonl(cachedPage) as Trajectory[]).find(t => t.instance_id === item.instance_id);
    if (!trajectory) {
      // JSON fallback for sparse slices avoids decoding 4,096 nested trajectories per parquet row group.
      const payload = await request("rows", { offset: String(offset), length: "1" });
      const row = object(Array.isArray(payload.rows) ? payload.rows[0] : undefined);
      if (!row.row || (Array.isArray(row.truncated_cells) && row.truncated_cells.includes("trajectory"))) throw new Error(`Missing/truncated trajectory at ${offset}`);
      trajectory = parseOpenHands(row.row);
      if (trajectory.instance_id !== item.instance_id || trajectory.repo !== item.repo) {
        const filtered = await request("filter", { where: `"instance_id"='${item.instance_id?.replaceAll("'", "''")}'`, offset: "0", length: "1" });
        const matched = object(Array.isArray(filtered.rows) ? filtered.rows[0] : undefined);
        if (!matched.row || (Array.isArray(matched.truncated_cells) && matched.truncated_cells.includes("trajectory"))) throw new Error(`Missing filtered trajectory ${item.instance_id}`);
        trajectory = parseOpenHands(matched.row);
      }
      await writeFile(path, JSON.stringify(trajectory) + "\n");
      await delay(2000);
    }
    if (trajectory.instance_id !== item.instance_id || trajectory.repo !== item.repo) throw new Error(`Dataset cache/index mismatch at ${offset}; refresh ${CACHE}`);
    trajectories.push(trajectory);
    if (trajectories.length % 20 === 0) console.error(`Selected trajectories: ${trajectories.length}/${selected.length} cached`);
  }
  const counts = new Map<string, Set<string>>();
  for (const t of index) { let ids = counts.get(t.repo); if (!ids) { ids = new Set(); counts.set(t.repo, ids); } ids.add(t.instance_id || t.id); }
  const repositoryCounts = [...counts].map(([repo, ids]) => ({ repo, distinct_instances: ids.size })).sort((a,b) => b.distinct_instances - a.distinct_instances || a.repo.localeCompare(b.repo));
  return { trajectories, metadata: { dataset: DATASET, catalog_rows: index.length, repositoryCounts, outcome_fields: Object.keys(trajectories[0]?.outcome ?? {}), cache: CACHE,
    split: opts.split ?? "all", split_method: "alternate global repository rank", repos_offset: opts.reposOffset ?? 0,
    selected_resolved: trajectories.filter(t => Number(t.outcome?.resolved) === 1).length,
    selected_unresolved: trajectories.filter(t => Number(t.outcome?.resolved) === 0).length,
    selection: "global distinct instance counts; one earliest physical attempt per issue; PR-number ordering" } };
}
export async function loadOmp(opts: SourceOptions): Promise<SourceResult> {
  const root = join(homedir(), ".omp", "agent", "sessions");
  const paths: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) paths.push(path);
    }
  }
  await visit(root);
  const trajectories: Trajectory[] = [];
  for (const path of paths.sort()) {
    const lines = await readJsonl(path);
    if (!lines.some(line => object(line).type === "session")) continue;
    trajectories.push(parseOmp(lines, path));
  }
  // Session text stays outside the repository: only aggregate statistics are written by the runner.
  return { trajectories: selectTrajectories(trajectories, opts, "hash"), metadata: { files_scanned: paths.length, sessions: trajectories.length,
    split: opts.split ?? "all", split_method: "FNV-1a project hash parity", repos_offset: opts.reposOffset ?? 0,
    nonempty_sessions: trajectories.filter(t => t.events.length > 0).length, project_count: new Set(trajectories.map(t => t.repo)).size } };
}
