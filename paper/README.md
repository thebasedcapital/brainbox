# BrainBox research-paper draft

The manuscript is **BrainBox: Local Behavioral Memory for Coding Agents**, version 2 (8 October 2026). It is written to be deposited as a new version under concept DOI 10.5281/zenodo.18664906; until that happens, the DOI still resolves to the February version.

## Files

- `../WHITEPAPER.md`: manuscript source, with Pandoc metadata, equations and citation keys. Figures point at `assets/*.svg` so they display on GitHub.
- `references.bib`: 16 references, each checked against its primary source.
- `figures.mjs`: exports four README figures (the loop, Hebbian learning, spreading activation, results) as vector PDFs in their settled frame, without the plate's own "fig. N" line. Output goes to `figures/` (ignored).
- `brainbox.tex`: generated standalone LaTeX, including the resolved bibliography. Regenerate rather than editing it independently.
- `brainbox.pdf`: compiled reading copy (ignored by git; upload this file to Zenodo).
- `evidence.json`: aggregate data from four existing evaluation artifacts, their original paths and SHA-256 hashes. No private session text, task IDs or local project paths are included.
- `build.sh`: exports the figures, then regenerates LaTeX and PDF from the Markdown source.
- `gemini-review.md`: historical external critique; not a verified reference or an evaluation artifact. Some statements describe obsolete code, so the revised manuscript is grounded in current code and raw results instead.

## Build

Requires Node, Chromium (for the figure export), Pandoc with citeproc, and Tectonic. This version was compiled with Pandoc 3.9 and Tectonic 0.17.0; Tectonic downloads its TeX bundle, including the TeX Gyre Pagella text and math fonts, on the first build.

```bash
# From the repository root:
bash paper/build.sh

# Or choose explicit binary paths:
PANDOC=/path/to/pandoc TECTONIC=/path/to/tectonic CHROMIUM=/path/to/chromium bash paper/build.sh
```

If a figure scene changes, run `npm run visuals` first so `assets/*.svg` is current. No tests, model downloads or install hooks are involved.

## Evidence boundary

The revision replaces the older draft's headline estimated-token-savings claims with coverage-conditioned replay results. It does not report a new benchmark run. Numerical tables were checked against the original JSON artifacts, not copied from the README or scout summaries.

- Public cohort: 40 selected trajectories; only 16 edited-file tasks, 30 read-file tasks, 221 next-file opportunities and 2,625 next-tool opportunities are scored after prior-history eligibility filtering.
- Local cohort: 97 selected sessions from up to five projects; metadata's nine projects refers to the full scanned source corpus.
- File scores are MRR@10; tool scores are MRR@3. Differences and intervals are against the named heuristic, not against the historical BrainBox engine.
- Current-run artifacts lack source commit hashes and selected input manifests. The inspected source revision is recorded separately and is not asserted to be the exact executable that produced them.
- The public historical/current runs match declared options, coverage and comparator scores. Local source scanning changed between historical and current runs, so the draft does not claim a controlled local version comparison.
- Embeddings are disabled in the main runs. Injection-policy benefit, procedure quality, indexed code-search benefit, actual token savings and end-to-end task success remain unmeasured here.

`evidence.json` allows aggregate-table checking, but cannot reconstruct raw trajectories, re-estimate intervals from individual probes or establish missing original-run provenance. Original `eval-results/` directories are ignored; fresh clones must rerun the public evaluation or obtain the underlying artifacts separately.

## Revision record

- Rewrote the paper around one question (how well an agent's own history predicts what it touches next) and the v0.2 implementation.
- Added four vector figures. The Hebbian figure was corrected to the update rule's actual values (0.10, 0.38, 0.66 after 1, 5 and 20 sessions; ceiling 1.0); the README and website copies were corrected with it.
- Added coverage denominators, all five baselines, paired intervals, ordering assumptions and provenance limits. Every number in Tables 2–4 and Appendix A was checked against `evidence.json`.
- Added Section 7, which lists each version-1 claim and its status: withdrawn, superseded, reframed or removed.
- Corrected related-work metadata and added three foundational references (Hebb 1949, Collins & Loftus 1975, Palmer & Zdonik 1991).
- Prepared with coding-assistant drafting and evidence review. The author must review it before deposit.
