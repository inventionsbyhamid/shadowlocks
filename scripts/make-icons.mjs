#!/usr/bin/env node
// Draws the app icon (a lit frosted panel in a walnut frame with a keyhole's shadow on it: a lock
// cast by light) and writes the PNGs the web app manifest lists. Shapes only, so no font is needed.
// Usage (on the build server): node scripts/make-icons.mjs [out dir, default public/icons]
// Writes icon.svg, icon-192.png, icon-512.png and icon-512-maskable.png.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const out = process.argv[2] ?? "public/icons";

// src/platform/pwa-config.ts THEME_COLOR and the provisional walnut and brass theme.
const THEME = "#1a1410";
const WALNUT = "#3a2a1e";
const SHADOW = "#2b2018";
const BRASS = "#d9b26a";

/** The panel and its keyhole shadow, centred on (256, 256) and scaled by `k` (the maskable icon keeps it inside its safe circle). */
function icon(k) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="room" cx="50%" cy="58%" r="75%">
      <stop offset="0%" stop-color="#4a3524"/>
      <stop offset="100%" stop-color="${THEME}"/>
    </radialGradient>
    <radialGradient id="light" cx="60%" cy="72%" r="78%">
      <stop offset="0%" stop-color="#fff3da"/>
      <stop offset="55%" stop-color="#e8d7ba"/>
      <stop offset="100%" stop-color="#b49f80"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#room)"/>
  <g transform="translate(256 256) scale(${k}) translate(-256 -256)">
    <rect x="100" y="100" width="312" height="312" rx="40" fill="${WALNUT}"/>
    <rect x="100" y="100" width="312" height="312" rx="40" fill="none" stroke="${BRASS}" stroke-opacity="0.55" stroke-width="4"/>
    <rect x="124" y="124" width="264" height="264" rx="24" fill="url(#light)"/>
    <g fill="${SHADOW}">
      <circle cx="256" cy="218" r="42"/>
      <path d="M236 238 L276 238 L294 334 Q256 346 218 334 Z"/>
    </g>
  </g>
</svg>
`;
}

fs.mkdirSync(out, { recursive: true });
const full = icon(1);
const safe = icon(0.8);
fs.writeFileSync(path.join(out, "icon.svg"), full);
const png = (svg, size, file) =>
  sharp(Buffer.from(svg), { density: 72 * (size / 512) * 2 })
    .resize(size, size)
    .flatten({ background: THEME })
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, file));
await png(full, 192, "icon-192.png");
await png(full, 512, "icon-512.png");
await png(safe, 512, "icon-512-maskable.png");
for (const f of fs.readdirSync(out)) console.log(`${f} ${fs.statSync(path.join(out, f)).size} bytes`);
