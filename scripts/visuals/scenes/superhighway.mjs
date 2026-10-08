// Plate V: superhighways and decay. One route walked again and again is gone over in red until it
// is a highway; links nobody uses thin out into dashes. ACT-R's base level is the bookkeeping.
import { rng, loop, stroke, smooth } from "../ink.mjs";
import { header, caption, arrowhead } from "../lib.mjs";

const W = 1280, H = 520;

export default function superhighway(k) {
  const r = rng("brainbox-highway");
  let s = header(k, "v. superhighways and decay", "Use it, <em>or lose it.</em>");

  // A loose field of files; the route runs left to right through it.
  const route = [
    { x: 110, y: 340, label: "router.ts" }, { x: 290, y: 280, label: "auth.ts" }, { x: 470, y: 330, label: "session.ts" },
    { x: 650, y: 268, label: "token.ts" }, { x: 820, y: 318, label: "db.ts" },
  ];
  const others = [];
  let tries = 0;
  while (others.length < 26 && tries++ < 5000) {
    const p = { x: r.range(70, 880), y: r.range(190, 450) };
    const inLabelZone = p.x > 300 && p.x < 660 && p.y > 395; // keep the annotation legible
    if (inLabelZone) continue;
    if ([...route, ...others].every((n) => Math.hypot(n.x - p.x, n.y - p.y) > 58)) others.push(p);
  }
  const all = [...route, ...others];

  // Decaying links: dashed and faint, the older the fainter.
  others.forEach((n, i) => {
    const near = all.filter((m) => m !== n).sort((a, b) => Math.hypot(a.x - n.x, a.y - n.y) - Math.hypot(b.x - n.x, b.y - n.y)).slice(0, 2);
    near.forEach((m, j) => {
      const fading = (i + j) % 3 !== 0;
      s += k.path(stroke(r, n.x, n.y, m.x, m.y, 1), { c: "muted", w: fading ? 0.8 : 1, dash: fading ? "2 5" : undefined, opacity: fading ? 0.55 : 0.8, delay: 200 + i * 25 });
    });
  });

  // The highway: many overlapping passes in red.
  const pts = route.map((p) => [p.x, p.y]);
  for (let pass = 0; pass < 7; pass++) {
    const d = smooth(pts.map(([x, y]) => [x + r.jitter(1.6), y + r.jitter(2.4)]));
    s += k.path(d, { c: "accent", w: pass === 0 ? 2.8 : 1.1, opacity: pass === 0 ? 1 : 0.5, delay: 900 + pass * 200, dur: 1400 });
  }
  s += k.traveller(smooth(pts), { r: 3.8, dur: 3.2, begin: 2.6 });
  s += k.traveller(smooth(pts), { r: 3.8, dur: 3.2, begin: 4.2 });

  all.forEach((n, i) => {
    const hot = i < route.length;
    s += k.path(loop(r, n.x, n.y, hot ? 8 : r.range(3.5, 5), { points: 8, gap: 0.12, wobble: 0.08 }), { c: hot ? "accent" : "ink", w: hot ? 1.6 : 1, opacity: hot ? 1 : 0.7, delay: 400 + i * 30 });
    s += k.dot(n.x, n.y, hot ? 2.6 : 1.4, { c: hot ? "accent" : "ink", opacity: hot ? 1 : 0.7, delay: 400 + i * 30 });
    if (n.label) s += k.text(n.x, n.y + (i % 2 ? -20 : 30), n.label, { font: "mono", size: 13, anchor: "middle", delay: 700 + i * 60 });
  });

  // Annotations, handwritten with arrows.
  s += k.text(470, 452, "walked 40 times → myelin 0.95", { font: "hand", size: 22, c: "accent", anchor: "middle", delay: 2400 });
  s += k.path(smooth([[470, 432], [462, 400], [468, 352]]), { c: "accent", w: 1.2, delay: 2400 });
  s += k.path(arrowhead(r, 468, 352, -1.45), { c: "accent", w: 1.2, delay: 2800 });
  s += k.text(150, 190, "unused for weeks → fading", { font: "hand", size: 21, c: "muted", delay: 2600 });

  // Side notes: the actual bookkeeping.
  const NX = 950;
  s += k.text(NX, 220, "ACT-R base level", { font: "hand", size: 24, delay: 2000 });
  s += k.rect(NX, 236, 270, 52, { fill: "field", stroke: "rule", rx: 8, delay: 2050 });
  s += k.text(NX + 20, 270, `B = ln Σ t<tspan baseline-shift="sub" font-size="13">j</tspan><tspan baseline-shift="super" font-size="13">−0.5</tspan>`, { font: "mono", size: 18, delay: 2100 });
  s += k.text(NX, 316, "recency × frequency, power-law", { font: "sans", size: 15, c: "muted", delay: 2150 });
  s += k.text(NX, 366, "per decay cycle", { font: "hand", size: 24, delay: 2300 });
  s += k.text(NX, 394, "activation  −15%", { font: "mono", size: 14.5, c: "muted", delay: 2350 });
  s += k.text(NX, 418, "synapses    −2%", { font: "mono", size: 14.5, c: "muted", delay: 2400 });
  s += k.text(NX, 442, "ignored recall weakens", { font: "mono", size: 14.5, c: "muted", delay: 2450 });
  s += k.text(NX, 462, "only the edge that caused it", { font: "mono", size: 14.5, c: "muted", delay: 2450 });

  s += caption(k, 56, H - 22, "fig. 5 — frequently used paths become instant-recall superhighways; unused links decay away.", { delay: 3000 });
  return { w: W, h: H, title: "Superhighways form on frequently used paths while unused links decay", body: s };
}
