#!/usr/bin/env node
// Regenerate the README figures: node scripts/visuals/build.mjs [scene ...]
// Each scenes/<name>.mjs default-exports (k) => ({ w, h, title, body }) where k = ink(theme).
// Writes assets/<name>.svg (light paper) and assets/<name>-dark.svg (dark paper).
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { THEMES, ink, plate } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scenesDir = join(here, "scenes");
const outDir = join(here, "..", "..", "assets");
mkdirSync(outDir, { recursive: true });

const only = new Set(process.argv.slice(2));
for (const file of readdirSync(scenesDir).filter((n) => n.endsWith(".mjs")).sort()) {
  const name = basename(file, ".mjs");
  if (only.size && !only.has(name)) continue;
  const { default: render } = await import(pathToFileURL(join(scenesDir, file)).href);
  for (const T of [THEMES.light, THEMES.dark]) {
    const scene = render(ink(T));
    const svg = await plate({ T, id: name, ...scene });
    if (/<script|\son\w+=/i.test(svg)) throw new Error(`${name}: scripts/event handlers are stripped by GitHub`);
    // GitHub serves these as image/svg+xml: one stray "&" or "<" and the image silently fails to load.
    const bare = svg.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, "");
    if (/&/.test(bare)) throw new Error(`${name}: unescaped "&" (use &amp;) — invalid XML`);
    const out = join(outDir, `${name}${T.name === "dark" ? "-dark" : ""}.svg`);
    writeFileSync(out, svg);
    console.log(`${basename(out).padEnd(24)} ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`);
  }
}
