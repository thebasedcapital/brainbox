// Plate VIII: built on research. A small catalogue: each paper is an entry with its own seeded
// specimen glyph, tied by a fine ink line to the subsystem it shaped. The thread runs through all six.
import { rng, loop, arc, smooth, burst } from "../ink.mjs";
import { header, caption, measure } from "../lib.mjs";

const W = 1280, H = 580;
const SY = 352;

const SUBS = [
  { key: "ranking", label: "ranking", x: 160 },
  { key: "search", label: "code search", x: 378 },
  { key: "policy", label: "injection policy", x: 604 },
  { key: "attr", label: "attribution", x: 826 },
  { key: "proc", label: "procedures", x: 1012 },
  { key: "eval", label: "evaluation", x: 1190 },
];

const PAPERS = [
  { name: "ACT-R hybrid", id: "2505.05083", to: "ranking", x: 64, row: "top" },
  { name: "Base3", id: "2506.12764", to: "ranking", x: 222, row: "top" },
  { name: "cAST", id: "2506.15655", to: "search", x: 380, row: "top" },
  { name: "MemCon", id: "2607.13591", to: "policy", x: 600, row: "top" },
  { name: "ACE", id: "2510.04618", to: "proc", x: 960, row: "top" },
  { name: "Temporal-graph heuristics", id: "2502.04910", to: "ranking", x: 64, row: "bot" },
  { name: "FastContext", id: "2606.14066", to: "policy", x: 520, row: "bot" },
  { name: "MemTrace", id: "2605.28732", to: "attr", x: 720, row: "bot" },
  { name: "Memᵖ", id: "2508.06433", to: "proc", x: 910, row: "bot" },
  { name: "SWE-rebench", id: "OpenHands trajectories", to: "eval", x: 1062, row: "bot" },
];

/** Tiny specimen glyph, varied by seed, in the spirit of tbcresearch.org's catalogue. */
function glyph(r, x, y) {
  const form = r.int(0, 2);
  if (form === 0) return loop(r, x, y, 9, { gap: 0.12, points: 9 });
  if (form === 1) return burst(r, x, y, 10, { count: 12, inner: 0.15 });
  return loop(r, x, y, 9, { gap: 0.3, points: 9 }) + loop(r, x + 3, y - 2, 4, { gap: 0.1, points: 6 });
}

export default function research(k) {
  const r = rng("brainbox-research");
  let s = header(k, "viii. built on research", "Ten papers, <em>six subsystems.</em>");
  const pos = Object.fromEntries(SUBS.map((x) => [x.key, x]));

  // The thread strung through every subsystem.
  const tp = [[-10, SY + 30]];
  SUBS.forEach((sub, i) => tp.push([sub.x, SY + (i % 2 ? 4 : -4)]));
  tp.push([W + 10, SY - 20]);
  s += k.path(smooth(tp), { c: "thread", w: 1.3, delay: 200, dur: 2200 });

  SUBS.forEach((sub, i) => {
    const t = 400 + i * 150;
    const tw = measure(sub.label, 25, "hand") * 0.84;
    s += `<rect x="${sub.x - tw / 2 - 8}" y="${SY - 22}" width="${tw + 16}" height="34" fill="${k.T.paper}" class="fade" style="animation-delay:${t}ms"/>`;
    s += k.text(sub.x, SY + 3, sub.label, { font: "hand", size: 25, anchor: "middle", delay: t });
    s += k.path(loop(r, sub.x, SY - 6, tw / 2 + 15, { squash: 26 / (tw / 2 + 15), gap: 0.06, start: -0.7, points: 16 }), { c: "accent", w: 1.3, delay: t + 150 });
  });

  PAPERS.forEach((p, i) => {
    const top = p.row === "top";
    const y = top ? 200 : 490, t = 900 + i * 120;
    const gx = p.x + 10, gy = y - 6;
    s += k.path(glyph(r, gx, gy), { w: 1.1, delay: t });
    s += k.dot(gx, gy, 2, { c: "accent", delay: t + 100 });
    s += k.text(p.x + 30, y, p.name, { font: "sans", size: 16, weight: 600, delay: t });
    s += k.text(p.x + 30, y + 21, p.id, { font: "mono", size: 12.5, c: "muted", delay: t + 50 });
    const sub = pos[p.to];
    const from = top ? [gx, gy + 34] : [gx, gy - 22];
    const to = [sub.x + (p.x + 30 < sub.x ? -14 : 14) * (Math.abs(p.x - sub.x) > 40 ? 1 : 0), top ? SY - 36 : SY + 22];
    s += k.path(arc(r, from[0], from[1], to[0], to[1], (from[0] < to[0] ? 1 : -1) * (top ? -14 : 14), 0.6), { w: 0.9, c: "muted", delay: t + 200, dur: 1200 });
  });

  s += caption(k, 56, H - 22, "fig. 8 — every change was measured with the replay eval before it shipped. links in the README.", { delay: 2600 });
  return { w: W, h: H, title: "Ten recent papers mapped to the six BrainBox subsystems they shaped", body: s };
}
