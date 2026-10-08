// Hand-drawn SVG primitives, shared with tbcresearch.org (src/art/ink.js) so BrainBox's
// figures use the lab's ink. Pure functions returning SVG path data; every drawing is
// reproducible from code and a seed.

/** 32-bit FNV-1a hash of a string; used to derive stable seeds from names. */
export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded random source. `seed` may be a number or a string. */
export function rng(seed) {
  let s = typeof seed === "string" ? hash(seed) : seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + (b - a) * next();
  next.int = (a, b) => Math.floor(next.range(a, b + 1));
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.jitter = (amount) => (next() - 0.5) * 2 * amount;
  return next;
}

/** Round to one decimal place: keeps SVG output small and diff-friendly. */
export const f = (n) => Math.round(n * 10) / 10;

/** Smooth path through points (Catmull-Rom converted to cubic Béziers). */
export function smooth(points, closed = false) {
  if (points.length < 2) return "";
  const p = closed ? [points.at(-1), ...points, points[0], points[1]] : [points[0], ...points, points.at(-1)];
  let d = `M${f(p[1][0])} ${f(p[1][1])}`;
  for (let i = 1; i < p.length - 2; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i], [x2, y2] = p[i + 1], [x3, y3] = p[i + 2];
    d += `C${f(x1 + (x2 - x0) / 6)} ${f(y1 + (y2 - y0) / 6)} ${f(x2 - (x3 - x1) / 6)} ${f(y2 - (y3 - y1) / 6)} ${f(x2)} ${f(y2)}`;
  }
  return d;
}

/** A straight segment as a slightly wavering pen stroke. */
export function stroke(r, x1, y1, x2, y2, wobble = 1.2) {
  const steps = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 40));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const w = i === 0 || i === steps ? wobble * 0.3 : wobble;
    pts.push([x1 + (x2 - x1) * t + r.jitter(w), y1 + (y2 - y1) * t + r.jitter(w)]);
  }
  return smooth(pts);
}

/** A gently bowed pen stroke from a to b; `bow` is the sideways offset at the middle. */
export function arc(r, x1, y1, x2, y2, bow = 20, wobble = 1) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
  const pts = [];
  const steps = Math.max(3, Math.round(len / 36));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const b = Math.sin(t * Math.PI) * bow;
    const w = i === 0 || i === steps ? wobble * 0.3 : wobble;
    pts.push([x1 + (x2 - x1) * t + nx * b + r.jitter(w), y1 + (y2 - y1) * t + ny * b + r.jitter(w)]);
  }
  return smooth(pts);
}

/**
 * An unclosed, hand-drawn circle. `gap` is the open fraction of a turn and
 * `start` the angle (radians) where the pen lands.
 */
export function loop(r, cx, cy, radius, { gap = 0.08, start = -0.9, wobble = 0.035, points = 18, squash = 1 } = {}) {
  const pts = [];
  const sweep = Math.PI * 2 * (1 - gap);
  for (let i = 0; i <= points; i++) {
    const a = start + (sweep * i) / points;
    const k = 1 + r.jitter(wobble) + (i / points) * wobble * 0.8;
    pts.push([cx + Math.cos(a) * radius * k, cy + Math.sin(a) * radius * k * squash]);
  }
  return smooth(pts);
}

/** A radial burst of short strokes, like a seed head. */
export function burst(r, cx, cy, radius, { count = 90, inner = 0.18 } = {}) {
  let d = "";
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const len = radius * r.range(0.55, 1);
    const from = radius * inner * r.range(0.6, 1.4);
    const bend = r.jitter(0.12);
    const x1 = cx + Math.cos(a) * from, y1 = cy + Math.sin(a) * from;
    const x2 = cx + Math.cos(a + bend) * len, y2 = cy + Math.sin(a + bend) * len;
    d += `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
  }
  return d;
}

/** Diagonal pen hatching clipped by hand to a rectangle (no clipPath needed). */
export function hatch(r, x, y, w, h, gap = 6, wobble = 0.5) {
  let d = "";
  for (let k = -h; k < w; k += gap) {
    const x1 = Math.max(x, x + k), y1 = k < 0 ? y - k : y;
    const x2 = Math.min(x + w, x + k + h), y2 = k + h > w ? y + (w - k) : y + h;
    if (x2 - x1 < 1) continue;
    d += stroke(r, x1, y1, x2, y2, wobble);
  }
  return d;
}

/** Scattered dots: `[x, y, size]` triples inside a box. */
export function scatter(r, count, x, y, w, h, [min, max] = [0.4, 1.4]) {
  return Array.from({ length: count }, () => [x + r() * w, y + r() * h, r.range(min, max)]);
}

/**
 * A torn paper edge filling a `width`×`height` band. `side` is the side the
 * paper occupies: "top" (edge faces down) or "bottom" (edge faces up).
 */
export function torn(r, width, height, side = "top") {
  const pts = [];
  let x = 0;
  while (x < width) {
    const nick = r() < 0.06; // occasional small rip
    pts.push([x, height * (nick ? r.range(0.05, 0.25) : r.range(0.45, 0.8))]);
    x += r.range(4, 18);
  }
  pts.push([width, height * 0.6]);
  const edge = pts.map(([px, py]) => `L${f(px)} ${f(py)}`).join("");
  return side === "top" ? `M0 0${edge}L${width} 0Z` : `M0 ${height}${edge}L${width} ${height}Z`;
}
