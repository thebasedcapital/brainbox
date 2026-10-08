#!/usr/bin/env bash
# WHITEPAPER.md is the manuscript source. It references assets/*.svg so the figures show on GitHub;
# for print, those are swapped for vector PDFs exported by paper/figures.mjs (needs Chromium).
# Tables with lines under 110 characters keep natural widths; longer ones wrap at their dash ratios.
set -euo pipefail
cd "$(dirname "$0")/.."
node paper/figures.mjs
sed -E -e 's#\(assets/([a-z-]+)\.svg\)#(figures/\1.pdf)#' -e 's/^# Appendix A/\\newpage\n\n# Appendix A/' WHITEPAPER.md |
  "${PANDOC:-pandoc}" --from markdown --standalone --citeproc --to latex --columns=110 \
    --metadata=link-citations:true \
    --variable=documentclass:article --variable=fontsize:11pt --variable=linestretch:1.08 \
    --variable=geometry:margin=26mm --variable=colorlinks:true \
    --variable=linkcolor:blue --variable=urlcolor:blue --variable=citecolor:blue \
    --variable=mainfont:texgyrepagella \
    --variable=mainfontoptions:Extension=.otf --variable=mainfontoptions:UprightFont=*-regular \
    --variable=mainfontoptions:BoldFont=*-bold --variable=mainfontoptions:ItalicFont=*-italic \
    --variable=mainfontoptions:BoldItalicFont=*-bolditalic \
    --variable=mathfont:texgyrepagella-math.otf \
    --variable='header-includes:\usepackage[font=small,labelfont=bf,margin=1em]{caption}' \
    --output=paper/brainbox.tex
"${TECTONIC:-tectonic}" --outdir paper paper/brainbox.tex
