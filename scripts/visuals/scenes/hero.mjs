// Plate I: the opening. An open ink ring around a small learned network; the red path is a
// superhighway the agent has walked many times. Wordmark, headline and install line on the right.
import { rng, loop, stroke, smooth } from "../ink.mjs";
import { caption } from "../lib.mjs";

const W = 1280, H = 600;
const CX = 330, CY = 300, R = 214;

/** Seeded network inside the ring: fixed labelled files first, then Poisson-ish filler nodes. */
function network(r) {
  const named = [
    { x: 228, y: 238, label: "auth.ts", dx: -30, dy: -14 },
    { x: 318, y: 186, label: "session.ts", dx: 0, dy: -16 },
    { x: 418, y: 248, label: "token.ts", dx: 30, dy: -12 },
    { x: 402, y: 362, label: "login.ts", dx: 30, dy: 20 },
    { x: 238, y: 380, label: "db.ts", dx: -14, dy: 6 },
    { x: 322, y: 300, label: "", dx: 0, dy: 0 },
  ];
  const nodes = named.map((n) => ({ ...n }));
  let tries = 0;
  while (nodes.length < 24 && tries++ < 4000) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (R - 46);
    const p = { x: CX + Math.cos(a) * d, y: CY + Math.sin(a) * d, label: "" };
    if (nodes.every((n) => Math.hypot(n.x - p.x, n.y - p.y) > 44)) nodes.push(p);
  }
  const edges = new Set();
  nodes.forEach((n, i) => {
    nodes
      .map((m, j) => ({ j, d: Math.hypot(m.x - n.x, m.y - n.y) }))
      .filter((e) => e.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
      .forEach((e) => edges.add(i < e.j ? `${i}-${e.j}` : `${e.j}-${i}`));
  });
  return { nodes, edges: [...edges].map((e) => e.split("-").map(Number)) };
}

export default function hero(k) {
  const r = rng("brainbox-hero");
  const { nodes, edges } = network(r);
  const highway = [0, 1, 2, 3]; // auth → session → token → login
  const onHighway = (a, b) => highway.some((h, i) => i < highway.length - 1 && ((h === a && highway[i + 1] === b) || (h === b && highway[i + 1] === a)));

  // The ring: shadow + dashed ink, as on tbcresearch.org's opening plate.
  const ring = loop(r, CX, CY, R, { gap: 0.07, start: -1.15, wobble: 0.022, points: 22 });
  let art = k.path(ring, { c: k.T.shadow, w: 7, delay: 0, draw: false, cls: "", opacity: 1 }).replace("<path", '<path transform="translate(4 5)"');
  art += `<path d="${ring}" fill="none" stroke="${k.T.ink}" stroke-width="6" stroke-linecap="round" stroke-dasharray="4.5 1.8" class="fade"/>`;

  // Fine web of synapses.
  edges.forEach(([a, b], i) => {
    if (onHighway(a, b)) return;
    art += k.path(stroke(r, nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y, 1.1), { w: 0.8, c: "muted", delay: 300 + i * 22, opacity: 0.75 });
  });

  // The superhighway: three overlapping pen passes, like a line gone over many times.
  const hp = highway.map((i) => [nodes[i].x, nodes[i].y]);
  for (let pass = 0; pass < 3; pass++) {
    const jittered = hp.map(([x, y], i) => [x + (i && i < hp.length - 1 ? r.jitter(2.2) : r.jitter(0.6)), y + r.jitter(1.6)]);
    art += k.path(smooth(jittered), { c: "accent", w: pass === 0 ? 2.6 : 1.3, delay: 1100 + pass * 260, opacity: pass === 0 ? 1 : 0.8 });
  }
  const highwayPath = smooth(hp);

  // Neurons: tiny open loops with a dot, labelled in mono.
  nodes.forEach((n, i) => {
    const hot = highway.includes(i);
    const rad = hot ? 7.5 : r.range(3.4, 5);
    art += k.path(loop(r, n.x, n.y, rad, { gap: 0.12, points: 8, wobble: 0.08 }), { c: hot ? "accent" : "ink", w: hot ? 1.5 : 1, delay: 500 + i * 30 });
    art += k.dot(n.x, n.y, hot ? 2.6 : 1.5, { c: hot ? "accent" : "ink", delay: 600 + i * 30 });
    if (n.label) {
      art += k.text(n.x + n.dx, n.y + n.dy, n.label, { font: "mono", size: 13, c: hot ? "ink" : "muted", anchor: n.dx < -10 ? "end" : n.dx > 10 ? "start" : "middle", delay: 900 + i * 40 });
    }
  });
  art += k.traveller(highwayPath, { r: 3.6, dur: 3.6, begin: 2.2 });

  // The thread: enters from the left edge and ties into the ring, tipped in red.
  const thread = smooth([[-10, 520], [40, 470], [70, 380], [90, 330], [CX - R + 6, CY + 6]]);
  art += k.path(thread, { c: "thread", w: 1.3, delay: 200 });
  art += k.dot(CX - R + 6, CY + 6, 3.2, { c: "accent", delay: 1500 });

  // Right column: wordmark, headline, lede, install line, caption.
  const X = 640;
  let text = "";
  text += k.text(X, 112, `brainbox<tspan fill="${k.T.accent}">.</tspan>`, { font: "sans", size: 30, weight: 600, delay: 100, spacing: "-0.3" });
  text += k.text(X + 150, 112, "by tbc research", { font: "hand", size: 20, c: "muted", delay: 200 });
  text += k.text(X, 168, "procedural memory for coding agents · local · zero api cost", { font: "hand", size: 21, c: "muted", delay: 300 });
  text += k.text(X - 4, 262, "Muscle memory,", { font: "hand", size: 92, delay: 400, spacing: "-0.9" });
  text += k.text(X - 4, 350, `<tspan fill="${k.T.accent}">for agents.</tspan>`, { font: "hand", size: 92, delay: 550, spacing: "-0.9" });
  text += k.text(X, 404, "Learns which files, tools and fixes go together —", { font: "sans", size: 20, c: "muted", delay: 700 });
  text += k.text(X, 432, "then recalls them before your agent starts searching.", { font: "sans", size: 20, c: "muted", delay: 760 });
  text += k.rect(X, 466, 360, 46, { fill: "field", stroke: "rule", rx: 8, delay: 850 });
  text += k.text(X + 18, 495, `<tspan fill="${k.T.accent}">$</tspan> npm install brainbox-hebbian`, { font: "mono", size: 16, delay: 900 });
  text += caption(k, CX, 556, "fig. 1 — files that fire together, wire together.", { anchor: "middle", size: 19, delay: 1400 });
  text += caption(k, CX, 580, `the <tspan fill="${k.T.accent}">red</tspan> path was walked so often it became a superhighway.`, { anchor: "middle", size: 19, delay: 1500 });

  return { w: W, h: H, title: "BrainBox — muscle memory for coding agents", body: art + text };
}
