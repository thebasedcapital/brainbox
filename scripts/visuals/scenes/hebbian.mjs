// Plate III: fire together, wire together. The same two files across three sessions; the synapse
// is literally drawn over more times as it strengthens. A hand-drawn SNAP curve explains why the
// strongest links grow slowest.
import { rng, loop, arc, stroke, smooth } from "../ink.mjs";
import { header, caption } from "../lib.mjs";

const W = 1280, H = 500;

// One co-access per session at the ordinary rate (η = 0.1): the exact values the update rule gives.
const panels = [
  { x: 190, session: "session 1", passes: 1, w: "0.10", note: "co-accessed once" },
  { x: 480, session: "session 5", passes: 4, w: "0.38", note: "a habit forming" },
  { x: 770, session: "session 20", passes: 11, w: "0.66", note: "a well-worn path" },
];

export default function hebbian(k) {
  const r = rng("brainbox-hebbian");
  let s = header(k, "iii. fire together, wire together", "Strength is just <em>repetition.</em>");
  const Y = 300;

  panels.forEach((p, i) => {
    const t = 400 + i * 700, a = { x: p.x - 92, y: Y + 12 }, b = { x: p.x + 92, y: Y - 12 };
    const hot = i === 2;
    s += k.text(p.x, Y - 92, p.session, { font: "hand", size: 26, anchor: "middle", delay: t });
    // The synapse: one pen pass per few co-accesses, red once it is a superhighway.
    for (let n = 0; n < p.passes; n++) {
      s += k.path(arc(r, a.x + 8, a.y - 2, b.x - 8, b.y + 2, -18 + r.jitter(3.5), 0.9), {
        c: hot ? "accent" : "ink", w: hot && n === 0 ? 2.4 : 1.1, opacity: n === 0 ? 1 : 0.55, delay: t + 200 + n * 90, dur: 1100,
      });
    }
    for (const [pt, name] of [[a, "auth.ts"], [b, "session.ts"]]) {
      s += k.path(loop(r, pt.x, pt.y, 9, { points: 9, gap: 0.1 }), { c: hot ? "accent" : "ink", w: 1.5, delay: t });
      s += k.dot(pt.x, pt.y, 3, { c: hot ? "accent" : "ink", delay: t + 100 });
      s += k.text(pt.x, pt.y + 34, name, { font: "mono", size: 13, c: "muted", anchor: "middle", delay: t + 100 });
    }
    s += k.text(p.x, Y + 84, `w = ${p.w}`, { font: "mono", size: 16, c: hot ? "accent" : "ink", anchor: "middle", delay: t + 500 });
    s += k.text(p.x, Y + 110, p.note, { font: "hand", size: 20, c: "muted", anchor: "middle", delay: t + 600 });
    if (i < 2) s += k.path(stroke(r, p.x + 118, Y + 84, p.x + 172, Y + 84, 0.6), { c: "thread", w: 1.3, delay: t + 600 });
  });

  // The real update, w += 0.1·g(w)·(1 − w) with g a falling sigmoid: fast at first, slower as w grows.
  const gx = 960, gy = 380, gw = 250, gh = 200, N = 40;
  s += k.path(stroke(r, gx, gy, gx + gw, gy, 0.5) + stroke(r, gx, gy, gx, gy - gh, 0.5), { w: 1.2, delay: 2500 });
  const curve = [[gx + 6, gy - 8]];
  for (let n = 1, w = 0; n <= N; n++) {
    const g = 0.1 / (1 + Math.exp(8 * (w - 0.5)));
    w = n === 1 ? g : Math.min(1, w + g * (1 - w));
    curve.push([gx + 6 + (n / N) * (gw - 12), gy - 8 - w * (gh - 20)]);
  }
  s += k.path(smooth(curve), { c: "accent", w: 1.8, delay: 2700, dur: 1800 });
  s += k.path(stroke(r, gx, gy - 8 - (gh - 20), gx + gw, gy - 8 - (gh - 20), 0.4), { c: "muted", w: 0.9, dash: "3 4", delay: 2700 });
  s += k.text(gx + gw, gy - 8 - (gh - 20) - 10, "ceiling 1.0", { font: "mono", size: 12.5, c: "muted", anchor: "end", delay: 3000 });
  s += k.text(gx + gw / 2, gy + 28, "co-accesses →", { font: "hand", size: 20, c: "muted", anchor: "middle", delay: 2600 });
  s += k.text(gx - 12, gy - gh + 12, "w", { font: "mono", size: 14, c: "muted", anchor: "end", delay: 2600 });
  s += k.text(gx + gw / 2, gy - gh - 22, "SNAP: strong links grow slowest", { font: "hand", size: 21, anchor: "middle", delay: 2900 });

  s += caption(k, 56, H - 26, "fig. 3 — co-access strengthens a directed synapse; what you open next counts double the reverse link.", { delay: 3200 });
  return { w: W, h: H, title: "Hebbian learning: a synapse strengthens across sessions", body: s };
}
