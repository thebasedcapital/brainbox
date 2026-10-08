# BrainBox research-paper draft

The revised manuscript is **BrainBox: Local Behavioral Memory for Coding Agents** (8 October 2026). This is a working draft, not a new arXiv/Zenodo deposit. Author identity and the previous concept DOI are retained; the draft does not claim that the DOI already resolves to this revision.

## Files

- `../WHITEPAPER.md`: editable manuscript source, with Pandoc metadata, equations and citation keys.
- `references.bib`: 13 references checked against primary sources during the revision.
- `brainbox.tex`: generated standalone LaTeX, including the resolved bibliography. Regenerate rather than editing it independently.
- `brainbox.pdf`: compiled reading copy. PDFs remain ignored by the repository.
- `evidence.json`: aggregate data from four existing evaluation artifacts, their original paths and SHA-256 hashes. No private session text, task IDs or local project paths are included.
- `build.sh`: regenerate LaTeX and PDF from the Markdown source.
- `gemini-review.md`: historical external critique; not a verified reference or an evaluation artifact. Some statements describe obsolete code, so the revised manuscript is grounded in current code and raw results instead.

## Build

Requires Pandoc with citeproc and Tectonic. This revision was compiled using Pandoc 3.9 and Tectonic 0.17.0. Tectonic downloads its TeX bundle dependencies on the first build.

```bash
# From the repository root:
bash paper/build.sh

# Or choose explicit binary paths:
PANDOC=/path/to/pandoc TECTONIC=/path/to/tectonic bash paper/build.sh
```

No Node tests, model downloads or editor installation hooks are needed to build the paper. `brainbox.tex` is standalone and can also be compiled with a compatible XeLaTeX installation.

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

- Replaced the legacy v4.0/February narrative with the v0.2 implementation and stored October replay evidence.
- Distinguished implemented components from evaluated components.
- Added coverage denominators, all five heuristic comparators, paired intervals, ordering assumptions and provenance limitations.
- Removed unsupported first-in-field, biological-validation, instantaneous-recall and measured-token-savings claims.
- Corrected related-work metadata and excluded citations not verified during the evidence audit.
- Retained the manuscript author's identity; prepared with coding-assistant drafting and evidence-review support. Author review is required before submission or publication.
