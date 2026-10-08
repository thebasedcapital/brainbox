#!/usr/bin/env bash
# Snapshot an animated SVG at an exact time with headless Chromium (visual QA only).
# The SVG is inlined and every CSS animation is paused and seeked to <ms> (delays included).
# Usage: scripts/visuals/snap.sh <name> <ms> [out.png]   e.g. snap.sh hero 4000
set -euo pipefail
name="$1"; ms="${2:-0}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
svg="$root/assets/$name.svg"
qa="$root/.visuals-qa"
out="${3:-$qa/$name-$ms.png}"
mkdir -p "$qa" "$(dirname "$out")"
read -r w h < <(grep -o 'viewBox="0 0 [0-9]* [0-9]*"' "$svg" | head -1 | grep -o '[0-9]* [0-9]*"' | tr -d '"')
html="$qa/$name-$ms.html"
{
  printf '<!doctype html><html><body style="margin:0;background:#ffffff">'
  cat "$svg"
  printf '<script>const s=document.querySelector("svg");s.pauseAnimations();s.setCurrentTime(%s/1000);document.getAnimations().forEach(a=>{a.pause();a.currentTime=%s;});</script></body></html>' "$ms" "$ms"
} > "$html"
chromium --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size="$w,$h" --virtual-time-budget=500 --screenshot="$out" "file://$html" >/dev/null 2>&1
echo "$out"
