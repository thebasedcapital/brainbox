import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { object } from "./trajectory.js";
import type Database from "better-sqlite3";
import type { ReplayEngine, ReplayOptions } from "./replay.js";

export const LEGACY_COMMIT = "9750d2f";
const OLD_WORKTREE = "/tmp/bb-old";

/** Historical modules are runtime-selected, so static imports would require the worktree for every eval. */
export async function loadReplayEngine(engine: "old" | "new", embeddings: boolean): Promise<Partial<ReplayOptions>> {
  if (engine === "new") return {};
  if (embeddings) throw new Error("Historical comparisons currently require --embeddings off; old/new models are different");
  if (!existsSync(join(OLD_WORKTREE, "src", "hebbian.ts"))) {
    throw new Error(`Missing historical worktree. Run: git -C /home/dell/brainbox worktree add ${OLD_WORKTREE} ${LEGACY_COMMIT}; install its SQLite dependency without @huggingface/transformers for embeddings-off comparison`);
  }
  const engineModule: unknown = await import(pathToFileURL(join(OLD_WORKTREE, "src", "hebbian.ts")).href);
  const dbModule: unknown = await import(pathToFileURL(join(OLD_WORKTREE, "src", "db.ts")).href);
  const embeddingModule: unknown = await import(pathToFileURL(join(OLD_WORKTREE, "src", "embeddings.ts")).href);
  const Engine = object(engineModule).HebbianEngine;
  const openDb = object(dbModule).openDb;
  const isEmbeddingAvailable = object(embeddingModule).isEmbeddingAvailable;
  if (typeof Engine !== "function" || typeof openDb !== "function" || typeof isEmbeddingAvailable !== "function") {
    throw new Error("Historical worktree does not expose the expected production APIs");
  }
  // The old commit has no disable environment flag. Its genuine missing-optional-package path
  // disables embeddings; never substitute mocked embedding or ranking implementations.
  if (isEmbeddingAvailable()) throw new Error("Historical embeddings-off requires an isolated worktree node_modules without @huggingface/transformers (do not symlink all current dependencies)");
  const Constructor = Engine as new (db: Database.Database, sessionId: string) => ReplayEngine;
  const factory = openDb as (path: string) => Database.Database;
  return {
    legacyOverfetch: true,
    dbFactory: factory,
    engineFactory: (db, sessionId) => new Constructor(db, sessionId),
  };
}
