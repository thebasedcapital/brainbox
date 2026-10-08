// Plate VII: results. v0.1 (hatched), v0.2 (red) and the best simple baseline (dashed) per probe,
// on held-out SWE-rebench tasks and on local sessions. Losses are circled, not hidden.
import { rng, loop, stroke, hatch, f } from "../ink.mjs";
import { header, caption } from "../lib.mjs";

const W = 1280, H = 660;

// MRR (next tool: MRR@3), embeddings off. Source: README "Results" table (eval-results/ runs).
const FACETS = [
  {
    title: "held-out SWE-rebench tasks", sub: "40 tasks · Pillow + conan", x: 80,
    rows: [
      { probe: "files edited", v1: 0.307, v2: 0.307, base: 0.216, baseName: "BM25" },
      { probe: "files read", v1: 0.191, v2: 0.267, base: 0.206, baseName: "BM25" },
      { probe: "next file", v1: 0.223, v2: 0.409, base: 0.43, baseName: "recency", note: "tied — CI spans 0" },
      { probe: "next tool", v1: 0.479, v2: 0.767, base: 0.748, baseName: "frequency" },
    ],
  },
  {
    title: "local agent sessions", sub: "97 sessions · 5 projects", x: 680,
    rows: [
      { probe: "files edited", v1: 0.737, v2: 0.703, base: 0.791, baseName: "frequency", note: "frequency still wins", loss: true },
      { probe: "files read", v1: 0.372, v2: 0.555, base: 0.547, baseName: "BM25" },
      { probe: "next file", v1: 0.634, v2: 0.702, base: 0.701, baseName: "recency" },
      { probe: "next tool", v1: 0.257, v2: 0.686, base: 0.662, baseName: "recency" },
    ],
  },
];

const BASE_Y = 540, SCALE = 290 / 0.8, GROUP = 132, BAR = 30, GAP = 7;

/** A filled bar with hand-wobbled corners. */
function bar(r, x, y0, w, h) {
  const p = [[x + r.jitter(0.6), y0], [x + r.jitter(0.8), y0 - h + r.jitter(0.8)], [x + w + r.jitter(0.8), y0 - h + r.jitter(0.8)], [x + w + r.jitter(0.6), y0]];
  return `M${p.map(([a, b]) => `${f(a)} ${f(b)}`).join("L")}Z`;
}

export default function evalPlate(k) {
  const r = rng("brainbox-eval");
  let s = header(k, "vii. results", "v0.2 against v0.1, <em>losses included.</em>");

  // Legend.
  const LX = 900, LY = 72;
  s += `<g class="fade" style="animation-delay:200ms">`;
  s += `<path d="${bar(r, LX, LY + 6, 18, 18)}" fill="none" stroke="${k.T.ink}" stroke-width="1"/><path d="${hatch(r, LX, LY - 12, 18, 18, 5, 0.3)}" fill="none" stroke="${k.T.ink}" stroke-width="0.7"/>`;
  s += `<path d="${bar(r, LX + 100, LY + 6, 18, 18)}" fill="${k.T.accent}"/>`;
  s += `<path d="${bar(r, LX + 200, LY + 6, 18, 18)}" fill="none" stroke="${k.T.muted}" stroke-width="1.2" stroke-dasharray="3 3"/>`;
  s += `</g>`;
  s += k.text(LX + 26, LY + 2, "v0.1", { font: "hand", size: 21, delay: 250 });
  s += k.text(LX + 126, LY + 2, "v0.2", { font: "hand", size: 21, c: "accent", delay: 250 });
  s += k.text(LX + 226, LY + 2, "best baseline", { font: "hand", size: 21, c: "muted", delay: 250 });


  FACETS.forEach((facet, fi) => {
    const fx = facet.x, t0 = 300 + fi * 600;
    s += k.text(fx, 184, facet.title, { font: "hand", size: 26, delay: t0 });
    s += k.text(fx, 207, facet.sub, { font: "mono", size: 12.5, c: "muted", delay: t0 + 50 });
    // Axis + gridlines.
    s += k.path(stroke(r, fx - 12, BASE_Y, fx + GROUP * 4 - 10, BASE_Y, 0.6), { w: 1.2, delay: t0 });
    for (const v of [0.2, 0.4, 0.6, 0.8]) {
      const y = BASE_Y - v * SCALE;
      s += k.path(stroke(r, fx - 12, y, fx + GROUP * 4 - 10, y, 0.4), { c: "rule", w: 1, delay: t0 + 100 });
      s += k.text(fx - 18, y + 4, `.${Math.round(v * 10)}`, { font: "mono", size: 11.5, c: "muted", anchor: "end", delay: t0 + 100 });
    }

    facet.rows.forEach((row, gi) => {
      const gx = fx + gi * GROUP, t = t0 + 200 + gi * 140;
      const bars = [
        { v: row.v1, kind: "v1", x: gx },
        { v: row.v2, kind: "v2", x: gx + BAR + GAP },
        { v: row.base, kind: "base", x: gx + 2 * (BAR + GAP) },
      ];
      bars.forEach((b, bi) => {
        const h = b.v * SCALE, delay = t + bi * 90;
        if (b.kind === "v1") {
          s += `<g class="grow" style="animation-delay:${delay}ms"><path d="${bar(r, b.x, BASE_Y, BAR, h)}" fill="none" stroke="${k.T.ink}" stroke-width="1"/><path d="${hatch(r, b.x + 1, BASE_Y - h + 1, BAR - 2, h - 2, 6, 0.4)}" fill="none" stroke="${k.T.ink}" stroke-width="0.7" opacity="0.8"/></g>`;
        } else if (b.kind === "v2") {
          s += `<path d="${bar(r, b.x, BASE_Y, BAR, h)}" fill="${k.T.accent}" class="grow" style="animation-delay:${delay}ms"/>`;
        } else {
          s += `<path d="${bar(r, b.x, BASE_Y, BAR, h)}" fill="none" stroke="${k.T.muted}" stroke-width="1.3" stroke-dasharray="3 3" class="grow" style="animation-delay:${delay}ms"/>`;
        }
        const label = b.v.toFixed(3).replace(/^0/, "");

        s += k.text(b.x + BAR / 2, BASE_Y - h - 8, label, { font: "mono", size: 11.5, c: b.kind === "v2" ? "accent" : b.kind === "base" ? "muted" : "ink", anchor: "middle", delay: delay + 500 });
      });
      s += k.text(gx + 1.5 * BAR + GAP, BASE_Y + 24, row.probe, { font: "hand", size: 21, anchor: "middle", delay: t });
      s += k.text(gx + 2 * (BAR + GAP) + BAR / 2, BASE_Y + 44, row.baseName, { font: "mono", size: 11.5, c: "muted", anchor: "middle", delay: t });

      if (row.note) {
        // Circle the two value labels being compared; note beside or above, clear of other bars.
        const yV2 = BASE_Y - row.v2 * SCALE - 12, yB = BASE_Y - row.base * SCALE - 12;
        const cx = gx + 2 * (BAR + GAP) - GAP / 2, cy = (yV2 + yB) / 2;
        const ry = Math.abs(yV2 - yB) / 2 + 16;
        s += k.path(loop(r, cx, cy, 46, { squash: ry / 46, gap: 0.08, start: -2.4, points: 14 }), { c: "accent", w: 1.3, delay: 2600 + fi * 200 });
        if (row.loss) s += k.text(cx + 54, cy + 6, row.note, { font: "hand", size: 20, c: "accent", delay: 2800 + fi * 200 });
        else s += k.text(cx, cy - ry - 10, row.note, { font: "hand", size: 20, c: "accent", anchor: "middle", delay: 2800 + fi * 200 });
      }
    });
  });

  s += caption(k, 56, H - 24, "fig. 7 — MRR (next tool: MRR@3), embeddings off. ranking weights were fit on separate dev repos. higher is better.", { delay: 3000 });
  return { w: W, h: H, title: "Results: BrainBox v0.2 vs v0.1 vs the best baseline on real agent trajectories", body: s };
}
