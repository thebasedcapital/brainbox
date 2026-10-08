import { seededRandom } from "./metrics.js";

export const BASELINES = ["recency", "frequency", "bm25", "edgebank", "random"] as const;
export type BaselineName = typeof BASELINES[number];
interface Document { touches: number; last: number; length: number; terms: Map<string, number>; sessions: Set<string> }
function tokens(value: string): string[] {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[a-z0-9]+/g) ?? [];
}
export class BaselineIndex {
  private documents = new Map<string, Document>();
  private df = new Map<string, number>();
  private postings = new Map<string, Set<string>>();
  private totalLength = 0;
  private clock = 0;
  touch(path: string, context: string, session: string): void {
    let doc = this.documents.get(path);
    if (!doc) { doc = { touches: 0, last: 0, length: 0, terms: new Map(), sessions: new Set() }; this.documents.set(path, doc); }
    const terms = tokens((doc.touches ? "" : path + " ") + context);
    for (const term of terms) {
      if (!doc.terms.has(term)) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
        let paths = this.postings.get(term);
        if (!paths) { paths = new Set(); this.postings.set(term, paths); }
        paths.add(path);
      }
      doc.terms.set(term, (doc.terms.get(term) ?? 0) + 1);
    }
    doc.length += terms.length; this.totalLength += terms.length;
    doc.touches++; doc.last = ++this.clock; doc.sessions.add(session);
  }
  candidates(): Set<string> { return new Set(this.documents.keys()); }
  rank(name: BaselineName, universe: Set<string>, query: string, touched: Set<string>, seed: number): string[] {
    const paths = [...universe].sort();
    if (name === "random") {
      const rng = seededRandom(seed);
      for (let i = paths.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [paths[i], paths[j]] = [paths[j], paths[i]]; }
      return paths.slice(0, 10);
    }
    const bm25Scores = new Map<string, number>();
    if (name === "bm25") {
      const queryTerms = [...new Set(tokens(query))];
      const avgLength = this.totalLength / Math.max(1, this.documents.size);
      for (const term of queryTerms) {
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (this.documents.size - df + 0.5) / (df + 0.5));
        for (const path of this.postings.get(term) ?? []) {
          if (!universe.has(path)) continue;
          const doc = this.documents.get(path)!;
          const tf = doc.terms.get(term)!;
          const score = idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * doc.length / Math.max(avgLength, 1)));
          bm25Scores.set(path, (bm25Scores.get(path) ?? 0) + score);
        }
      }
    }
    const touchedSessions = new Set<string>();
    if (name === "edgebank") for (const path of touched) for (const session of this.documents.get(path)?.sessions ?? []) touchedSessions.add(session);
    const scored = paths.map(path => {
      const doc = this.documents.get(path)!;
      let score = name === "recency" ? doc.last : name === "frequency" ? doc.touches : 0;
      if (name === "bm25") score = bm25Scores.get(path) ?? 0;
      if (name === "edgebank") for (const session of doc.sessions) if (touchedSessions.has(session)) score++;
      return { path, score };
    });
    return scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 10).map(row => row.path);
  }
}
