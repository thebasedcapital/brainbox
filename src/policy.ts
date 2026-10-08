import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { RecallResult } from "./hebbian.js";

export const POLICY_ARMS = ["TOP5", "SILENT", "TOP1", "TOP3"] as const;
export type PolicyArm = typeof POLICY_ARMS[number];
export const POLICY_PRIOR_PULLS = 12;
export const POLICY_TOKEN_COST = 2; // reward penalty per 1,000 injected tokens
export const POLICY_EXPLORATION = 0.15;
export const INJECTION_CHAR_BUDGET = 1800;
export const ARM_LIMIT: Record<PolicyArm, number> = { SILENT: 0, TOP1: 1, TOP3: 3, TOP5: 5 };

export function queryHash(query: string): string {
  return createHash("sha256").update(query).digest("hex");
}

export function policyContext(query: string, confidence: number, projectKnown: boolean, first: boolean): string {
  const band = confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
  const kind = /error|exception|traceback|fail|bug|crash/i.test(query) ? "error"
    : /code|function|class|implement|refactor|\.[cm]?[jt]sx?\b|\b(src|test|file)\b/i.test(query) ? "code" : "other";
  return `${band}:${kind}:${projectKnown ? "project" : "unknown"}:${first ? "first" : "later"}`;
}

export function selectPolicyArm(db: Database.Database, contextKey: string, enabled = process.env.BRAINBOX_POLICY !== "off"): PolicyArm {
  if (!enabled) return "TOP5";
  const stats = db.prepare("SELECT arm, pulls, reward_sum FROM policy_stats WHERE context_key = ?")
    .all(contextKey) as { arm: PolicyArm; pulls: number; reward_sum: number }[];
  const total = stats.reduce((sum, row) => sum + row.pulls, 0);
  if (total < POLICY_PRIOR_PULLS) return "TOP5";
  let best: PolicyArm = "TOP5";
  let bestScore = -Infinity;
  for (const arm of POLICY_ARMS) {
    const row = stats.find(s => s.arm === arm);
    const score = !row || row.pulls === 0 ? Infinity
      : row.reward_sum / row.pulls + POLICY_EXPLORATION * Math.sqrt(2 * Math.log(total) / row.pulls);
    if (score > bestScore) { best = arm; bestScore = score; }
  }
  return best;
}

export function updatePolicyReward(db: Database.Database, contextKey: string, arm: PolicyArm, reward: number): void {
  db.prepare(`INSERT INTO policy_stats(context_key, arm, pulls, reward_sum, reward_sq) VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(context_key, arm) DO UPDATE SET pulls=pulls+1, reward_sum=reward_sum+excluded.reward_sum,
    reward_sq=reward_sq+excluded.reward_sq`).run(contextKey, arm, reward, reward * reward);
}

export function beginPolicyDecision(db: Database.Database, sessionId: string, query: string, contextKey: string, arm: PolicyArm, injectedChars: number, learn = true): number {
  return Number(db.prepare(`INSERT INTO policy_decisions(session_id, ts, query_hash, context_key, arm, injected_tokens, learn)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(sessionId, new Date().toISOString(), queryHash(query), contextKey, arm, Math.ceil(injectedChars / 4), Number(learn)).lastInsertRowid);
}

/**
 * injectedIds iterates in the formatter's presentation order: injected ranks are
 * 1-based citations. Non-injected candidates continue after that block and never
 * occupy citation ranks; reward and rank-based explanation use injected rows only.
 */
export function logRecallEvents(db: Database.Database, decisionId: number, sessionId: string, query: string, results: RecallResult[], injectedIds: Set<string>, arm: PolicyArm): void {
  const insert = db.prepare(`INSERT INTO recall_events(session_id, ts, query_hash, query_snippet, neuron_id, rank,
    confidence, activation_path, source_from, source_to, injected, arm, decision_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const ts = new Date().toISOString();
  const hash = queryHash(query);
  const injectedRanks = new Map([...injectedIds].map((id, index) => [id, index + 1]));
  let nextCandidateRank = injectedRanks.size + 1;
  db.transaction(() => {
    for (const r of results) {
      const rank = injectedRanks.get(r.neuron.id);
      insert.run(sessionId, ts, hash, query.slice(0, 200), r.neuron.id, rank ?? nextCandidateRank++,
        r.confidence, r.activation_path, r.source_edge?.from ?? null, r.source_edge?.to ?? null,
        Number(rank !== undefined), arm, decisionId);
    }
  })();
}

export function markRecallAccess(db: Database.Database, sessionId: string, neuronId: string, edited = false): void {
  db.prepare(`UPDATE recall_events SET opened=1, edited=MAX(edited, ?) WHERE session_id=? AND neuron_id=?
    AND injected=1 AND decision_id IN (SELECT id FROM policy_decisions WHERE session_id=? AND finalized=0)`)
    .run(Number(edited), sessionId, neuronId, sessionId);
}

/** Once-only reward accounting; callbacks attribute anti-recall before finalization in the same transaction. */
export function flushPolicySession(db: Database.Database, sessionId: string, beforeFinalize?: () => void): { decisions: number; reward: number } {
  return db.transaction(() => {
    const decisions = db.prepare("SELECT id, context_key, arm, injected_tokens, learn FROM policy_decisions WHERE session_id=? AND finalized=0 ORDER BY id")
      .all(sessionId) as { id: number; context_key: string; arm: PolicyArm; injected_tokens: number; learn: number }[];
    if (decisions.length === 0) return { decisions: 0, reward: 0 };
    beforeFinalize?.();
    let totalReward = 0;
    for (const decision of decisions) {
      const hits = db.prepare(`SELECT COALESCE(SUM(CASE WHEN edited=1 THEN 1.5/rank WHEN opened=1 THEN 1.0/rank ELSE 0 END),0) AS reward
        FROM recall_events WHERE decision_id=? AND injected=1`).get(decision.id) as { reward: number };
      const reward = decision.arm === "SILENT" ? 0 : hits.reward - POLICY_TOKEN_COST * decision.injected_tokens / 1000;
      if (decision.learn) updatePolicyReward(db, decision.context_key, decision.arm, reward);
      db.prepare("UPDATE policy_decisions SET finalized=1, reward=? WHERE id=?").run(reward, decision.id);
      totalReward += reward;
    }
    return { decisions: decisions.length, reward: totalReward };
  })();
}

function recallLine(r: RecallResult, rank: number): string {
  const snippet = r.snippets?.[0]?.snippet;
  const citation = `${r.neuron.path}${snippet ? `:${snippet.start_line}-${snippet.end_line}` : ""}`;
  const why = r.activation_path.replace(/[\r\n]+/g, " ").trim().split(/\s+/).slice(0, 8).join(" ") || "learned relevance";
  return `${rank}. ${citation} — ${why}`;
}

export function compactRecall(results: RecallResult[], maxChars = INJECTION_CHAR_BUDGET): { text: string; included: RecallResult[] } {
  const budget = Math.max(0, Math.floor(maxChars));
  const header = "[brainbox] Files (brainbox_explain expands ranks):";
  if (budget < header.length || results.length === 0) return { text: "", included: [] };
  let text = header;
  const included: RecallResult[] = [];
  for (const result of results) {
    const line = recallLine(result, included.length + 1);
    if (text.length + line.length + 1 > budget) break;
    text += `\n${line}`;
    included.push(result);
  }
  return { text: included.length ? text : "", included };
}

export function formatRecall(results: RecallResult[], maxChars = INJECTION_CHAR_BUDGET): string {
  return compactRecall(results, maxChars).text;
}

/** Explicit MCP expansion uses bounded, indexed queries; never scans history into JS. */
export function explainRecall(db: Database.Database, target: { path?: string; rank?: number; sessionId?: string }): unknown {
  let neuronId: string | undefined;
  if (target.path) {
    const neuron = db.prepare("SELECT id FROM neurons WHERE path=? ORDER BY type='file' DESC LIMIT 1").get(target.path) as { id: string } | undefined;
    neuronId = neuron?.id;
  } else if (target.rank !== undefined) {
    const row = target.sessionId
      ? db.prepare("SELECT neuron_id FROM recall_events WHERE session_id=? AND rank=? AND injected=1 ORDER BY id DESC LIMIT 1").get(target.sessionId, target.rank)
      : db.prepare("SELECT neuron_id FROM recall_events WHERE rank=? AND injected=1 ORDER BY id DESC LIMIT 1").get(target.rank);
    neuronId = (row as { neuron_id: string } | undefined)?.neuron_id;
  }
  if (!neuronId) return { status: "not_found" };
  const neuron = db.prepare("SELECT id, path, type, access_count, last_accessed FROM neurons WHERE id=?").get(neuronId);
  const history = db.prepare(`SELECT ts, session_id, rank, confidence, activation_path, source_from, source_to, injected, opened, edited
    FROM recall_events WHERE neuron_id=? ORDER BY id DESC LIMIT 20`).all(neuronId);
  const counts = db.prepare(`SELECT COUNT(*) AS recalls, COALESCE(SUM(injected),0) AS injections,
    COALESCE(SUM(injected=1 AND (opened=1 OR edited=1)),0) AS hits,
    COALESCE(SUM(injected=1 AND opened=0 AND edited=0 AND decision_id IN (SELECT id FROM policy_decisions WHERE finalized=1)),0) AS ignores
    FROM recall_events WHERE neuron_id=?`).get(neuronId);
  return { neuron, recall_history: history, attribution: counts,
    co_access: db.prepare("SELECT source_id, target_id, co_access_count, weight, last_fired FROM synapses WHERE source_id=? OR target_id=? ORDER BY co_access_count DESC LIMIT 20").all(neuronId, neuronId),
    last_accesses: db.prepare("SELECT session_id, query, timestamp FROM access_log WHERE neuron_id=? ORDER BY id DESC LIMIT 10").all(neuronId) };
}
