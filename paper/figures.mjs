#!/usr/bin/env node
// Export README figures as vector PDFs for the paper: light theme, final (settled) frame,
// with the plate's own "fig. N" line removed so the paper can number and caption it.
// Usage: node paper/figures.mjs   (run `npm run visuals` first if scenes changed)
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "paper", "figures");
const FIGURES = ["the-loop", "hebbian", "spreading", "eval"];
const CAPTION_BAND = 34; // the plate caption sits at H - 26; trim the band it occupied
const chromium = process.env.CHROMIUM ?? "chromium";

mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "bb-paper-fig-"));
try {
  for (const name of FIGURES) {
    let svg = readFileSync(join(root, "assets", `${name}.svg`), "utf8");
    const [, w, h] = svg.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
    const caption = /<text[^>]*>fig\. \d+ —[\s\S]*?<\/text>/;
    if (!caption.test(svg)) throw new Error(`${name}: plate caption not found`);
    const H = h - CAPTION_BAND;
    svg = svg
      .replace(caption, "")
      .replace(`viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"`, `viewBox="0 0 ${w} ${H}" width="${w}" height="${H}"`)
      .replace(`<rect width="${w}" height="${h}"`, `<rect width="${w}" height="${H}"`)
      .replace(`height="${h - 1}" rx="17.5"`, `height="${H - 1}" rx="17.5"`);
    const html = join(tmp, `${name}.html`);
    writeFileSync(html, `<!doctype html><html><head><style>@page{size:${w}px ${H}px;margin:0}html,body{margin:0}svg{display:block}</style></head><body>${svg}</body></html>`);
    const out = join(outDir, `${name}.pdf`);
    // Reduced motion disables every animation, leaving each plate in its finished state.
    execFileSync(chromium, ["--headless=new", "--disable-gpu", "--force-prefers-reduced-motion", "--no-pdf-header-footer",
      "--virtual-time-budget=2000", `--print-to-pdf=${out}`, `file://${html}`], { stdio: "ignore" });
    console.log(`${name}.pdf  ${w}×${H}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
