// Plate VI: the immune system. A failing command, the edits that fixed it and the passing rerun
// become one procedure keyed by the error's fingerprint; the next time, the fix is recalled first.
import { rng, loop, stroke, smooth } from "../ink.mjs";
import { header, caption, arrowhead } from "../lib.mjs";

const W = 1280, H = 520;

export default function immune(k) {
  const r = rng("brainbox-immune");
  let s = header(k, "vi. the immune system", "Fail once, <em>remember the fix.</em>");
  const Y0 = 190;

  // 1. The failure.
  const A = 56;
  s += k.text(A, Y0, "the first time", { font: "hand", size: 24, c: "muted", delay: 200 });
  s += k.rect(A, Y0 + 18, 360, 150, { fill: "field", stroke: "rule", rx: 10, delay: 300 });
  s += k.text(A + 20, Y0 + 52, `<tspan fill="${k.T.muted}">$</tspan> npm test`, { font: "mono", size: 15, delay: 400 });
  s += k.text(A + 20, Y0 + 82, "TypeError: Cannot read properties", { font: "mono", size: 14, c: "accent", delay: 600 });
  s += k.text(A + 20, Y0 + 102, "of undefined (reading 'token')", { font: "mono", size: 14, c: "accent", delay: 650 });
  s += k.text(A + 20, Y0 + 140, "fingerprint", { font: "hand", size: 19, c: "muted", delay: 800 });
  s += k.text(A + 112, Y0 + 140, "TYPE_ERROR|property_access", { font: "mono", size: 13, delay: 850 });
  // a red cross mark, the site's "negative" glyph
  s += k.path(stroke(r, A + 330, Y0 + 36, A + 346, Y0 + 52, 0.5) + stroke(r, A + 346, Y0 + 36, A + 330, Y0 + 52, 0.5), { c: "accent", w: 1.8, delay: 700 });

  // 2. The fix, then the passing rerun.
  const B = 476;
  s += k.text(B, Y0, "what fixed it", { font: "hand", size: 24, c: "muted", delay: 1100 });
  const fix = ["edit  src/auth/session.ts", "edit  src/api/token.ts"];
  fix.forEach((line, i) => {
    s += k.text(B, Y0 + 52 + i * 34, line, { font: "mono", size: 15, delay: 1250 + i * 150 });
  });
  s += k.text(B, Y0 + 130, `<tspan fill="${k.T.muted}">$</tspan> npm test`, { font: "mono", size: 15, delay: 1600 });
  s += k.text(B + 112, Y0 + 130, "✓ passing", { font: "mono", size: 15, c: "result", delay: 1750 });
  s += k.path(smooth([[B + 2, Y0 + 152], [B + 120, Y0 + 158], [B + 230, Y0 + 150]]), { c: "result", w: 1.4, delay: 1800 });

  // Arrows along the thread between stages.
  const thread = smooth([[A + 366, Y0 + 92], [B - 40, Y0 + 80], [B - 10, Y0 + 78]]);
  s += k.path(thread, { c: "thread", w: 1.3, delay: 900 });
  s += k.path(arrowhead(r, B - 10, Y0 + 78, 0), { c: "thread", w: 1.3, delay: 1200 });

  // 3. Stored as a procedure.
  const C = 836;
  s += k.text(C, Y0, "stored as a procedure", { font: "hand", size: 24, c: "muted", delay: 2000 });
  s += k.rect(C, Y0 + 18, 390, 150, { fill: "surface", stroke: "rule", rx: 10, delay: 2100 });
  s += k.text(C + 20, Y0 + 52, "error_fix", { font: "mono", size: 14, c: "accent", delay: 2200 });
  s += k.text(C + 110, Y0 + 52, "TYPE_ERROR|property_access", { font: "mono", size: 14, delay: 2200 });
  s += k.text(C + 20, Y0 + 84, "edit session.ts → edit token.ts", { font: "mono", size: 14, c: "muted", delay: 2300 });
  s += k.text(C + 20, Y0 + 106, "→ npm test", { font: "mono", size: 14, c: "muted", delay: 2350 });
  s += k.text(C + 20, Y0 + 142, "+3 helpful · −0 harmful", { font: "mono", size: 14, c: "result", delay: 2450 });
  const thread2 = smooth([[B + 250, Y0 + 92], [C - 40, Y0 + 96], [C - 10, Y0 + 92]]);
  s += k.path(thread2, { c: "thread", w: 1.3, delay: 1900 });
  s += k.path(arrowhead(r, C - 10, Y0 + 92, 0), { c: "thread", w: 1.3, delay: 2200 });

  // The next time: same fingerprint, fix recalled before any search.
  const ny = Y0 + 250;
  s += k.text(A, ny, "the next time", { font: "hand", size: 24, c: "muted", delay: 2800 });
  s += k.text(A + 150, ny, "TypeError … (reading 'token')", { font: "mono", size: 15, c: "accent", delay: 2900 });
  s += k.path(smooth([[A + 430, ny - 5], [A + 470, ny - 12], [A + 506, ny - 6]]), { c: "thread", w: 1.3, delay: 3000 });
  s += k.path(arrowhead(r, A + 506, ny - 6, 0.15), { c: "thread", w: 1.3, delay: 3200 });
  const files = "session.ts  token.ts";
  const fx = A + 536, fw = files.length * 15 * 0.6;
  s += k.text(fx, ny, files, { font: "mono", size: 15, delay: 3200 });
  s += k.path(loop(r, fx + fw / 2, ny - 5, fw / 2 + 20, { squash: 22 / (fw / 2 + 20), gap: 0.06, start: -0.5, points: 16 }), { c: "accent", w: 1.4, delay: 3400 });
  s += k.text(fx + fw + 36, ny, "recalled before any search", { font: "hand", size: 23, delay: 3500 });

  s += caption(k, 56, H - 26, "fig. 6 — procedures are shown to the agent as quoted observations from past sessions, never as instructions.", { delay: 3600 });
  return { w: W, h: H, title: "Error to fix memory: a failing test, the edits that fixed it, recalled the next time", body: s };
}
