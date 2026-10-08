// Plate II: the loop. Five stations strung on the olive thread; what the agent actually opens or
// edits flows back (dashed red) into the policy and the graph. Side modules are circled below.
import { rng, loop, stroke, smooth, burst, arc } from "../ink.mjs";
import { header, caption, arrowhead, measure } from "../lib.mjs";

const W = 1280, H = 690;
const Y = 372; // thread height
const XS = [150, 395, 640, 885, 1130];

const glyphs = {
  // Many tool calls arriving: a seed head.
  tools: (r, x, y) => [{ d: burst(r, x, y, 20, { count: 26, inner: 0.15 }), w: 0.8 }],
  // Two neurons, one synapse drawn over a few times.
  learn: (r, x, y) => [
    { d: loop(r, x - 13, y + 6, 5, { points: 8, gap: 0.1 }), w: 1.2 },
    { d: loop(r, x + 13, y - 6, 5, { points: 8, gap: 0.1 }), w: 1.2 },
    { d: arc(r, x - 8, y + 4, x + 8, y - 4, 4, 0.4) + arc(r, x - 8, y + 5, x + 8, y - 3, -3, 0.4), w: 1.4, c: "accent" },
  ],
  // Ranked channels: bars of decreasing length.
  recall: (r, x, y) => [4, 4, 4, 2, 1, 0.5].map((v, i) => ({ d: stroke(r, x - 18, y - 13 + i * 5.2, x - 18 + v * 9, y - 13 + i * 5.2, 0.3), w: 1.4, c: i < 3 ? "accent" : "ink" })),
  // Four arms, one chosen.
  policy: (r, x, y) => [0, 1, 2, 3].map((i) => ({ d: loop(r, x - 15 + i * 10, y, 3.6, { points: 7, gap: 0.05 }), w: i === 2 ? 1.8 : 1, c: i === 2 ? "accent" : "ink" })),
  // A few compact lines of injected context.
  inject: (r, x, y) => [24, 18, 21].map((len, i) => ({ d: stroke(r, x - 14, y - 8 + i * 8, x - 14 + len, y - 8 + i * 8, 0.4), w: 1.3, c: i === 0 ? "accent" : "ink" })),
};

const stations = [
  { g: "tools", title: "tool calls", lines: ["Read · Edit · Grep · Bash"], mono: "PostToolUse hook · MCP" },
  { g: "learn", title: "learn", lines: ["neurons and synapses"], mono: "STDP · SNAP · myelin" },
  { g: "recall", title: "recall", lines: ["rank fusion of seven channels"], mono: "lexical · hebbian · snippets" },
  { g: "policy", title: "decide", lines: ["a bandit picks how much"], mono: "silent · top 1 · top 3 · top 5" },
  { g: "inject", title: "inject", lines: ["compact, line-ranged"], mono: "login.ts:42-88 — co-edited" },
];

const modules = [
  { x: 395, title: "code graph", sub: "tree-sitter imports &amp; calls" },
  { x: 640, title: "hybrid search", sub: "FTS5 + sqlite-vec, RRF" },
  { x: 1130, title: "procedures", sub: "error → fix playbooks" },
];

export default function howItWorks(k) {
  const r = rng("brainbox-loop");
  let s = header(k, "ii. how it works", "Every tool call is <em>a neuron firing.</em>");

  // The thread, wavering through every station, entering and leaving the plate.
  const pts = [[-10, Y + 30], [60, Y + 8]];
  XS.forEach((x, i) => pts.push([x, Y + (i % 2 ? -6 : 6)], [x + 122, Y + (i % 2 ? 8 : -8)]));
  pts.pop();
  pts.push([W + 10, Y - 26]);
  const thread = smooth(pts);
  s += k.path(thread, { c: "thread", w: 1.3, delay: 200, dur: 2200 });

  stations.forEach((st, i) => {
    const x = XS[i], y = Y + (i % 2 ? -6 : 6), t = 500 + i * 260;
    s += k.path(loop(r, x, y, 40, { gap: 0.1, start: -1 - i * 0.4, wobble: 0.04 }), { w: 1.6, delay: t });
    s += `<circle cx="${x}" cy="${y}" r="36" fill="${k.T.paper}" class="fade" style="animation-delay:${t}ms"/>`;
    for (const m of glyphs[st.g](r, x, y)) s += k.path(m.d, { w: m.w, c: m.c ?? "ink", delay: t + 200 });
    s += k.text(x, y + 82, st.title, { font: "hand", size: 30, anchor: "middle", delay: t + 150 });
    s += k.text(x, y + 108, st.lines[0], { font: "sans", size: 15, c: "muted", anchor: "middle", delay: t + 220 });
    s += k.text(x, y + 131, st.mono, { font: "mono", size: 12.5, c: "muted", anchor: "middle", delay: t + 260 });
    s += k.text(x - 54, y - 50, `${i + 1}`, { font: "hand", size: 22, c: "accent", delay: t });
  });
  s += k.traveller(thread, { r: 3.4, dur: 6, begin: 2.4 });

  // Feedback: dashed red return arcs from inject back to decide and learn.
  const fb1 = smooth([[XS[4] - 10, Y - 50], [XS[4] - 70, Y - 116], [XS[3] + 40, Y - 104], [XS[3] + 8, Y - 52]]);
  const fb2 = smooth([[XS[4] + 6, Y - 52], [XS[4] - 30, Y - 168], [XS[2], Y - 178], [XS[1] + 60, Y - 150], [XS[1] + 12, Y - 54]]);
  s += k.path(fb1, { c: "accent", w: 1.4, delay: 2100 });
  s += k.path(fb2, { c: "accent", w: 1.4, delay: 2300, dur: 1900 });
  s += k.path(arrowhead(r, XS[3] + 8, Y - 50, 1.9), { c: "accent", w: 1.4, delay: 2900 });
  s += k.path(arrowhead(r, XS[1] + 12, Y - 52, 1.75), { c: "accent", w: 1.4, delay: 3300 });
  s += k.text(XS[2] + 8, Y - 186, "opened · edited · ignored  →  reward + targeted anti-recall", { font: "hand", size: 21, c: "accent", anchor: "middle", delay: 2600 });
  s += k.text(XS[2] + 8, Y - 210, "at session end", { font: "hand", size: 18, c: "muted", anchor: "middle", delay: 2600 });

  // Side modules: circled words wired up to their station with a fine dashed line.
  modules.forEach((m, i) => {
    const y = Y + 222, t = 2500 + i * 200;
    const tw = measure(m.title, 25, "hand");
    s += k.text(m.x, y, m.title, { font: "hand", size: 25, anchor: "middle", delay: t });
    const rx = tw / 2 + 24;
    s += k.path(loop(r, m.x, y - 8, rx, { squash: 24 / rx, gap: 0.06, start: -0.6, points: 16 }), { c: "accent", w: 1.3, delay: t + 100 });
    s += k.text(m.x, y + 34, m.sub, { font: "mono", size: 12.5, c: "muted", anchor: "middle", delay: t + 150 });
    s += k.path(stroke(r, m.x, y - 36, m.x, Y + 146, 0.5), { c: "muted", w: 0.9, dash: "3 4", delay: t });
  });

  s += caption(k, 56, H - 26, "fig. 2 — one loop per prompt. everything runs locally in SQLite; nothing leaves the machine.", { delay: 3000 });
  return { w: W, h: H, title: "How BrainBox works: tool calls → learn → recall → decide → inject, with feedback", body: s };
}
