import { fileURLToPath } from "node:url";
import { iwsdkDev } from "@iwsdk/vite-plugin-dev";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { pwaOptions } from "./src/platform/pwa-config";
import { siteOrigin } from "./src/platform/site-origin";

export default defineConfig({
  // The link card image's origin (src/platform/site-origin.ts). Vite fills %VITE_SITE_ORIGIN% in index.html from it.
  define: { "import.meta.env.VITE_SITE_ORIGIN": JSON.stringify(siteOrigin(process.env.VITE_SITE_ORIGIN)) },
  // The service worker precaches the whole build for offline play (src/platform/pwa-config.ts).
  plugins: [iwsdkDev(), VitePWA(pwaOptions())],
  server: { host: "0.0.0.0", port: 8081, open: false },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "esnext",
    rollupOptions: { input: "./index.html" },
  },
  esbuild: { target: "esnext" },
  // One copy of three, uikit and its signals, or UIKit's instanceof checks fail (a signal made
  // through @iwsdk/core, which is not pre-bundled, must be the same class uikit checks against).
  resolve: {
    dedupe: ["three", "@pmndrs/uikit", "@pmndrs/uikit-horizon", "@pmndrs/uikit-lucide", "@preact/signals-core"],
    // UIKit's default Inter (no accents) becomes ours (all of Latin-1; src/ui/inter-fonts.ts).
    alias: { "@pmndrs/msdfonts/inter": fileURLToPath(new URL("./src/ui/inter-fonts.ts", import.meta.url)) },
  },
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
    include: ["three", "@pmndrs/uikit", "@pmndrs/uikit-horizon", "@pmndrs/uikit-lucide", "@drawcall/uikitml", "@preact/signals-core"],
    esbuildOptions: { target: "esnext" },
  },
  worker: { format: "es" },
  publicDir: "public",
  base: "./",
});
