#!/usr/bin/env bash
# Render the GitHub social preview (1280×640 PNG) from the finished dark hero plate.
# Upload assets/social-preview.png in GitHub → Settings → General → Social preview.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
qa="$root/.visuals-qa"; mkdir -p "$qa"
html="$qa/social.html"
{
  printf '<!doctype html><html><body style="margin:0;background:#16130f;display:flex;align-items:center;justify-content:center;width:1280px;height:640px">'
  cat "$root/assets/hero-dark.svg"
  printf '<script>const s=document.querySelector("svg");s.pauseAnimations();s.setCurrentTime(2.9);document.getAnimations().forEach(a=>{a.pause();a.currentTime=8000;});</script></body></html>'
} > "$html"
chromium --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1280,640 --virtual-time-budget=500 --screenshot="$root/assets/social-preview.png" "file://$html" >/dev/null 2>&1
echo "$root/assets/social-preview.png"
