// BrainBox README figures in the tbcresearch.org design language: warm paper, ink strokes
// drawn by hand (./ink.mjs), terracotta accent, olive thread, Gaegu handwriting and DM Sans.
// Each scene renders twice (light + dark paper); GitHub picks one with <picture>.
// No runtime JS (GitHub strips it from images): motion is CSS keyframes + SMIL, drawn in once.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";
import { f } from "./ink.mjs";

// Tokens copied from tbcresearch.org style.css (light-dark pairs).
export const THEMES = {
  light: {
    name: "light",
    paper: "#f6f1e4", ink: "#2a2620", muted: "#6d665a", accent: "#b83e2d", rule: "#dcd4c2",
    surface: "#ece5d4", field: "#faf8f1", thread: "#8a8848", result: "#526c50", sage: "#dfe3cc",
    sageRule: "#b6bc9f", grass: "#6f7a55", negative: "#c8998d", shadow: "rgba(42,38,32,0.13)",
  },
  dark: {
    name: "dark",
    paper: "#16130f", ink: "#ebe3d1", muted: "#a59c8b", accent: "#e0705a", rule: "#35302a",
    surface: "#211d18", field: "#1c1814", thread: "#a3a165", result: "#9cb98f", sage: "#1b2018",
    sageRule: "#333b2c", grass: "#7f8c5e", negative: "#6b3a30", shadow: "rgba(235,227,209,0.13)",
  },
};

export const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Drawing context for one scene/theme. Every mark gets a reveal delay so the figure
 * draws itself in, stroke by stroke, the way tbcresearch.org plates do on scroll.
 */
export function ink(T) {
  const at = (delay) => (delay == null ? "" : ` style="animation-delay:${Math.round(delay)}ms"`);
  const color = (c) => T[c] ?? c;
  return {
    T,
    /** An ink stroke that draws in. `w` stroke width, `c` theme colour key or literal. */
    path(d, { c = "ink", w = 1.3, delay, dur, cls = "", dash, opacity, fill = "none", draw = true } = {}) {
      const style = [delay != null ? `animation-delay:${Math.round(delay)}ms` : "", dur ? `animation-duration:${dur}ms` : ""].filter(Boolean).join(";");
      const animated = draw && !dash && fill === "none";
      return `<path d="${d}"${animated ? ' pathLength="1"' : ""} class="${animated ? "draw" : "fade"}${cls ? " " + cls : ""}" fill="${color(fill)}" stroke="${fill === "none" ? color(c) : "none"}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""}${opacity != null ? ` opacity="${opacity}"` : ""}${style ? ` style="${style}"` : ""}/>`;
    },
    /** Text that fades in. font: "hand" (Gaegu) | "sans" (DM Sans) | "mono". */
    text(x, y, str, { font = "sans", size = 16, c = "ink", anchor = "start", weight, delay, cls = "", opacity, spacing } = {}) {
      return `<text x="${f(x)}" y="${f(y)}" class="${font} fade${cls ? " " + cls : ""}" font-size="${size}" fill="${color(c)}" text-anchor="${anchor}"${weight ? ` font-weight="${weight}"` : ""}${spacing ? ` letter-spacing="${spacing}"` : ""}${opacity != null ? ` opacity="${opacity}"` : ""}${at(delay)}>${str}</text>`;
    },
    /** Filled dot that pops in. */
    dot(x, y, r, { c = "ink", delay, opacity, cls = "" } = {}) {
      return `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" class="pop${cls ? " " + cls : ""}" fill="${color(c)}"${opacity != null ? ` opacity="${opacity}"` : ""}${at(delay)}/>`;
    },
    /** Rectangle (cards, bars) that fades in. */
    rect(x, y, w, h, { fill = "field", stroke, sw = 1, rx = 6, delay, opacity, cls = "" } = {}) {
      return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${rx}" class="fade${cls ? " " + cls : ""}" fill="${color(fill)}"${stroke ? ` stroke="${color(stroke)}" stroke-width="${sw}"` : ""}${opacity != null ? ` opacity="${opacity}"` : ""}${at(delay)}/>`;
    },
    /** A small accent dot travelling a path forever once the drawing is done (SMIL). */
    traveller(d, { c = "accent", r = 3.4, dur = 4, begin = 2 } = {}) {
      return `<circle r="${r}" fill="${color(c)}" opacity="0"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/><animateMotion path="${d}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;1" keySplines="0.45 0 0.55 1"/></circle>`;
    },
  };
}

const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "fonts");
const GAEGU = readFileSync(join(fontsDir, "gaegu-latin-300-normal.woff2"));
const DMSANS = readFileSync(join(fontsDir, "dm-sans-latin-wght-normal.woff2"));

/** Characters drawn by text elements of one font class, so each SVG embeds a tiny subset. */
function glyphsFor(body, font) {
  const re = new RegExp(`<text[^>]*class="${font}[^"]*"[^>]*>([\\s\\S]*?)</text>`, "g");
  let chars = "";
  for (const m of body.matchAll(re)) chars += m[1].replace(/<[^>]+>/g, "");
  chars = chars.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
  return [...new Set(chars)].join("");
}

async function fontFace(family, buf, chars, weight) {
  if (!chars) return "";
  const sub = await subsetFont(buf, chars, { targetFormat: "woff2" });
  return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${sub.toString("base64")}) format("woff2");font-weight:${weight};}`;
}

/** Wrap a scene body into a complete paper plate SVG with embedded font subsets and motion CSS. */
export async function plate({ T, id, w, h, title, body }) {
  const faces =
    (await fontFace("BB Gaegu", GAEGU, glyphsFor(body, "hand"), "300")) +
    (await fontFace("BB DM Sans", DMSANS, glyphsFor(body, "sans"), "100 1000"));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="${id}-t">
<title id="${id}-t">${esc(title)}</title>
<style>
${faces}
.hand{font-family:"BB Gaegu","Comic Sans MS",cursive;font-weight:300;}
.sans{font-family:"BB DM Sans",Arial,sans-serif;}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
.draw{stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1500ms ${EASE} forwards;}
.fade{animation:fade 900ms ${EASE} both;}
.pop{transform-box:fill-box;transform-origin:center;animation:pop 700ms ${EASE} both;}
@keyframes draw{to{stroke-dashoffset:0;}}
@keyframes fade{from{opacity:0;}}
@keyframes pop{from{opacity:0;transform:scale(0.2);}}
.breathe{transform-box:fill-box;transform-origin:center;animation:pop 700ms ${EASE} both,breathe 3.2s ease-in-out 1.6s infinite;}
@keyframes breathe{50%{transform:scale(1.35);}}
.grow{transform-box:fill-box;transform-origin:50% 100%;animation:grow 1300ms ${EASE} both;}
@keyframes grow{from{transform:scaleY(0);}}
@media (prefers-reduced-motion:reduce){.draw,.fade,.pop,.breathe,.grow{animation:none;stroke-dashoffset:0;}}
</style>
<rect width="${w}" height="${h}" rx="18" fill="${T.paper}"/>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="17.5" fill="none" stroke="${T.rule}"/>
${body}
</svg>
`;
}

/** Roman-numeral plate label in the hand font, e.g. "ii. how it learns". */
export function label(k, x, y, text, delay = 0) {
  return k.text(x, y, esc(text), { font: "hand", size: 22, c: "muted", delay });
}

/** Handwritten figure caption: "fig. N — …", with optional accent fragment. */
export function caption(k, x, y, text, { anchor = "start", size = 19, delay = 900 } = {}) {
  return k.text(x, y, text, { font: "hand", size, c: "muted", anchor, delay });
}

/** Rough text width estimate (for layout); `em` factor per font. */
export function measure(str, size, font = "sans") {
  const factor = font === "mono" ? 0.6 : font === "hand" ? 0.47 : 0.53;
  return str.length * size * factor;
}


/** Plate header as on tbcresearch.org: roman-numeral hand label, then a Gaegu headline whose <em> is accent. */
export function header(k, labelText, headline, { x = 56, y = 64, size = 52, delay = 0 } = {}) {
  const h = headline.replace(/<em>/g, `<tspan fill="${k.T.accent}">`).replace(/<\/em>/g, "</tspan>");
  return label(k, x, y, labelText, delay) + k.text(x - 2, y + size + 6, h, { font: "hand", size, delay: delay + 120, spacing: "-0.5" });
}

/** A small hand-drawn arrowhead at (x, y) pointing along angle `a` (radians). */
export function arrowhead(r, x, y, a, size = 9) {
  const p = (da) => [x - Math.cos(a + da) * size + r.jitter(0.6), y - Math.sin(a + da) * size + r.jitter(0.6)];
  const [lx, ly] = p(0.45), [rx, ry] = p(-0.45);
  return `M${f(lx)} ${f(ly)}L${f(x)} ${f(y)}L${f(rx)} ${f(ry)}`;
}