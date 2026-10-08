export interface Metrics {
  recall1: number; recall3: number; recall5: number; recall10: number;
  mrr: number; ndcg10: number; precision5: number;
}
export function scoreRanking(ranking: string[], gold: string[]): Metrics {
  const relevant = new Set(gold);
  const ranked = [...new Set(ranking)];
  const hits = (k: number) => ranked.slice(0, k).filter(path => relevant.has(path)).length;
  const first = ranked.findIndex(path => relevant.has(path));
  let dcg = 0; let ideal = 0;
  for (let i = 0; i < 10; i++) {
    if (relevant.has(ranked[i])) dcg += 1 / Math.log2(i + 2);
    if (i < relevant.size) ideal += 1 / Math.log2(i + 2);
  }
  return { recall1: relevant.size ? hits(1) / relevant.size : 0, recall3: relevant.size ? hits(3) / relevant.size : 0,
    recall5: relevant.size ? hits(5) / relevant.size : 0, recall10: relevant.size ? hits(10) / relevant.size : 0,
    mrr: first < 0 ? 0 : 1 / (first + 1), ndcg10: ideal ? dcg / ideal : 0, precision5: hits(5) / 5 };
}
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
export function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lo = Math.floor(index); const fraction = index - lo;
  return sorted[lo] * (1 - fraction) + sorted[Math.ceil(index)] * fraction;
}
export interface PairedValue { task: string; brainbox: number; baseline: number }
/** Paired cluster bootstrap: resample trajectories, retaining correlated probes within each task. */
export function pairedBootstrap(values: PairedValue[], seed: number, resamples = 1000): { delta: number; low: number; high: number; tasks: number } {
  const clusters = new Map<string, { sum: number; count: number }>();
  for (const value of values) {
    const cluster = clusters.get(value.task) ?? { sum: 0, count: 0 };
    cluster.sum += value.brainbox - value.baseline; cluster.count++;
    clusters.set(value.task, cluster);
  }
  const groups = [...clusters.values()];
  if (!groups.length) return { delta: 0, low: 0, high: 0, tasks: 0 };
  const rng = seededRandom(seed); const samples: number[] = [];
  for (let i = 0; i < resamples; i++) {
    let sum = 0; let count = 0;
    for (let j = 0; j < groups.length; j++) { const item = groups[Math.floor(rng() * groups.length)]; sum += item.sum; count += item.count; }
    samples.push(sum / count);
  }
  return { delta: values.reduce((sum, v) => sum + v.brainbox - v.baseline, 0) / values.length,
    low: percentile(samples, 0.025), high: percentile(samples, 0.975), tasks: groups.length };
}
