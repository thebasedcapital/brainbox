// Plate IV: spreading activation. Recall seeds one file; activation spreads three hops, fading
// with each hop and damped at hubs by 1/√degree. The ranked list on the right is the output.
import { rng, loop, stroke, arc } from "../ink.mjs";
import { header, caption, arrowhead } from "../lib.mjs";

const W = 1280, H = 600;
const SX = 360, SY = 368;

const results = [
  { path: "src/auth/login.ts", score: 0.94, via: "direct" },
  { path: "src/auth/session.ts", score: 0.81, via: "spread" },
  { path: "src/api/token.ts", score: 0.66, via: "spread" },
  { path: "tests/login.test.ts", score: 0.52, via: "snippet" },
  { path: "src/db/users.ts", score: 0.41, via: "spread" },
];

export default function spreading(k) {
  const r = rng("brainbox-spread");
  let s = header(k, "iv. spreading activation", "Recall one file, <em>wake its neighbours.</em>");

  // Hop rings.
  const rings = [72, 136, 196];
  rings.forEach((rad, i) => {
    s += k.path(loop(r, SX, SY, rad, { gap: 0.05, start: -2.2 + i, wobble: 0.025, points: 20 }), { c: "muted", w: 0.9, dash: "3 5", opacity: 0.8 });
    s += k.text(SX + Math.cos(-0.62) * rad + 6, SY + Math.sin(-0.62) * rad - 4, `hop ${i + 1}`, { font: "hand", size: 18, c: "muted", delay: 800 + i * 500 });
  });

  // Nodes per hop, brightness = activation.
  const hops = [
    [{ a: 0.35, label: "session.ts", below: true }, { a: 2.3, label: "login.test.ts" }, { a: 4.3, label: "" }],
    [{ a: 0.05, label: "token.ts" }, { a: 0.9, label: "" }, { a: 2.5, label: "", hub: true }, { a: 3.9, label: "" }, { a: 4.8, label: "users.ts" }],
    [{ a: -0.35 }, { a: 0.45 }, { a: 1.3 }, { a: 2.15 }, { a: 2.85 }, { a: 3.6 }, { a: 4.5 }, { a: 5.3 }],
  ];
  const pos = (hop, n) => ({ x: SX + Math.cos(n.a) * rings[hop] * 0.86, y: SY + Math.sin(n.a) * rings[hop] * 0.86 });
  const opacity = [1, 0.72, 0.42];
  hops.forEach((list, h) => {
    list.forEach((n, j) => {
      const p = pos(h, n), t = 700 + h * 550 + j * 60;
      // Parent: the previous-hop node nearest in angle, so activation flows outward.
      const angDist = (x, y) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y)));
      const parent = h === 0 ? null : hops[h - 1].reduce((best, m) => (angDist(m.a, n.a) < angDist(best.a, n.a) ? m : best));
      const from = h === 0 ? { x: SX, y: SY } : pos(h - 1, parent);
      s += k.path(stroke(r, from.x, from.y, p.x, p.y, 0.8), { c: h === 0 ? "accent" : "ink", w: h === 0 ? 1.6 : 1, opacity: opacity[h], delay: t - 200 });
      s += k.path(loop(r, p.x, p.y, n.hub ? 9 : 6, { points: 8, gap: 0.1 }), { w: 1.2, opacity: opacity[h], delay: t });
      s += k.dot(p.x, p.y, 2.2, { opacity: opacity[h], delay: t });
      if (n.label) {
        const left = Math.cos(n.a) < -0.2;
        s += k.text(p.x + (left ? -12 : 12), p.y + (n.below ? 22 : -10), n.label, { font: "mono", size: 12.5, c: "muted", anchor: left ? "end" : "start", delay: t + 100 });
      }
      if (n.hub) {
        for (let q = 0; q < 6; q++) {
          const a = q * 1.05 + 0.3;
          s += k.path(stroke(r, p.x, p.y, p.x + Math.cos(a) * 30, p.y + Math.sin(a) * 30, 0.4), { w: 0.7, opacity: 0.5, delay: t + 100 });
        }
        s += k.text(p.x - 10, p.y + 48, "hub: × 1/√degree", { font: "hand", size: 19, c: "accent", anchor: "middle", delay: t + 300 });
      }
    });
  });

  // The seed.
  s += k.path(loop(r, SX, SY, 14, { points: 10, gap: 0.08 }), { c: "accent", w: 2, delay: 300 });
  s += `<circle cx="${SX}" cy="${SY}" r="5" fill="${k.T.accent}" class="breathe" style="animation-delay:300ms"/>`;
  s += k.text(SX + 18, SY - 18, "login.ts", { font: "mono", size: 13.5, delay: 400 });

  // Query enters from the left.
  s += k.text(56, 196, `recall("login flow")`, { font: "mono", size: 15, delay: 100 });
  s += k.path(arc(r, 120, 208, SX - 18, SY - 12, 30, 0.6), { c: "thread", w: 1.3, delay: 200 });
  s += k.path(arrowhead(r, SX - 18, SY - 12, 0.75), { c: "thread", w: 1.3, delay: 1000 });

  // Ranked output.
  const LX = 720, LY = 250;
  s += k.text(LX, LY - 44, "ranked recall", { font: "hand", size: 26, delay: 2200 });
  results.forEach((row, i) => {
    const y = LY + i * 54, t = 2400 + i * 180;
    s += k.text(LX, y, `${i + 1}`, { font: "hand", size: 24, c: i === 0 ? "accent" : "muted", delay: t });
    s += k.text(LX + 34, y, row.path, { font: "mono", size: 15, delay: t });
    s += k.path(stroke(r, LX + 34, y + 14, LX + 34 + row.score * 300, y + 14, 0.5), { c: i === 0 ? "accent" : "ink", w: i === 0 ? 2.2 : 1.4, delay: t + 100, dur: 900 });
    s += k.text(LX + 350, y, row.score.toFixed(2), { font: "mono", size: 15, c: i === 0 ? "accent" : "ink", delay: t + 200 });
    s += k.text(LX + 404, y, row.via, { font: "hand", size: 19, c: "muted", delay: t + 250 });
  });
  s += k.path(loop(r, LX + 9, LY - 8, 21, { gap: 0.1, points: 12, squash: 0.95 }), { c: "accent", w: 1.4, delay: 3400 });

  s += caption(k, 56, H - 26, "fig. 4 — every result names the channel and edge that produced it. ask brainbox_explain why.", { delay: 3500 });
  return { w: W, h: H, title: "Spreading activation over three hops with fan-effect damping, and the ranked recall it produces", body: s };
}
