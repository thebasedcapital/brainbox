#!/usr/bin/env bash
# WHITEPAPER.md is the manuscript source; regenerate the LaTeX and PDF together.
set -euo pipefail
cd "$(dirname "$0")/.."
"${PANDOC:-pandoc}" WHITEPAPER.md \
  --standalone --citeproc --to latex --pdf-engine=tectonic \
  --variable=documentclass:article --variable=fontsize:11pt \
  --variable=geometry:margin=25mm --variable=colorlinks:true \
  --variable=linkcolor:blue --variable=urlcolor:blue \
  --output=paper/brainbox.tex
"${TECTONIC:-tectonic}" --outdir paper paper/brainbox.tex
