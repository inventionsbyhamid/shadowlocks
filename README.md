# Shadow Locks

A seated mixed-reality puzzle box for Meta Quest, played with hands or Touch controllers. A small glass box sits in your
lap; brass scraps hang inside it at different depths, and a lantern you hold casts their shadows on the
frosted back panel. Move the lantern until the shadows fill a lock's outline and the lock opens; later
boxes need your own fingertip to cast the missing piece. It is a WebXR app built with Meta's Immersive
Web SDK, works offline after the first load, and installs as a Quest app.

Builds and browsers never run on a laptop: every npm, tsc, vitest and Playwright command runs in a
container on the build server through `scripts/remote.sh <lane> -- <command>`, for example
`scripts/remote.sh main -- npm test`, `scripts/remote.sh main -- npm run typecheck` or
`scripts/remote.sh main -- npm run build`. End-to-end tests (headless Chromium with the IWER headset
emulator, on a virtual clock) run with `scripts/e2e.sh [spec]`, which needs the `shadowlocks-e2e` image
(`scripts/e2e-image/build.sh`, once); see `tests/e2e/README.md`.
