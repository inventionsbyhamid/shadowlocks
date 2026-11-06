# End-to-end tests

Headless Chromium (software WebGL) with Meta's IWER headset emulator, run on the build server by
`scripts/e2e.sh`. The app is served by vite with `VITE_TEST_HOOKS=1`, which adds `window.__ns`.

Every test runs on a **virtual clock**: `performance.now()`, `requestAnimationFrame` and `Date` only
move when a helper steps a frame. Software rendering is slow (up to about 1.5 s per 720p frame), so
this keeps timing-sensitive input (a poke must release within 800 ms) and game clocks exact.

```ts
import { expect, test } from "./helpers/test";

test("example", async ({ boot }) => {
  const app = await boot();                            // "logic" mode: 320x180, room not drawn
  await app.poke("home-settings");                     // fingertip poke on a button of the current screen
  await app.stepUntil((ns) => ns.state().screen === "settings", { maxMs: 5_000 });
  expect((await app.state()).box.exists).toBe(true);
});
```

Always import `test` and `expect` from `./helpers/test`, not from `@playwright/test`:
- On failure it saves `console.txt`, `ns-state.json` (`__ns.state()`), `iwer-commands.txt` (every IWER
  command with the frame it was queued and finished on) and `failure.png` under
  `test-results/artifacts/<test>/`.
- Every test fails if the page asked any host but the local server for anything (offline rule).

The offline spec (`offline.spec.ts`) is different: the dev server has no service worker, so it first builds the app for
production with the test hooks and the emulator (`helpers/pwa-site.ts`, about a minute, into
`dist-e2e/`, without the emulator's synthetic room) and serves that on port 8082 with the headers
from `public/_headers`, the report-only CSP sent enforced. The update test serves a copy on port
8083 and publishes a second version over it with `deployUpdate`.

Helpers:
- `boot({ mode, room, head, date, enterXR, expectScreen })`: loads the page, seats the headset
  (`SEATED`: eyes 1.2 m high, looking down at the lap), accepts the XR offer and waits for the first
  screen with the box placed. `mode: "visual"` is 1280x720 with the room drawn, for screenshots.
  `date` sets the page's clock (default `DEFAULT_DATE`, so daily seeds reproduce; the time zone is UTC).
- `app.step(frames, dt)`, `app.stepUntil(pred, { maxMs, arg })`: predicates run in the page and get
  `(window.__ns, window, arg)`; they cannot use test variables, pass them as `arg`.
- `app.state()`, `app.perf()`, `app.events(type)`: the test hooks (`src/app/test-api.ts`).
- `app.queue(method, params)`, `app.command(method, params)`, `app.settle()`: IWER remote commands
  (`IWER_DEVICE.remote.dispatch`), queued and stepped until done.
- `app.poke(buttonId)`: index fingertip along the button's normal, 12 mm press, back out.
- `app.capture(name)`: steps one frame and saves room plus app as `test-results/shots/<name>.png`
  (the folder is emptied at the start of each run).
- `app.captureHeadset(name, target)`: a headset-equivalent shot. Quest 3 shows about 25 pixels per
  degree; the emulator's wide view makes panels tiny at 720p, so this narrows the view to 25 px per
  degree, turns the head to `target` (world metres) and captures. Use it for every legibility and
  look review.
- `app.foreignHosts()`, `app.requested(pathPart)`: what the page fetched.
- `addRunNote(line)` (`helpers/xr-app.ts`): a line for `test-results/notes.txt`, printed at the end of
  the run (perf-budget says there when the server was too busy to assert frame time strictly).
- `new Hands(app, "left" | "right")` (`helpers/hands.ts`): `pinchAt(world)` (open hand comes down on
  the point and pinches), `moveTo(world, ms)`, `release()`, `poke(id, { times, gapMs })`, `lose(ms)`
  (out of tracking, then back), `disconnect()` / `reconnect()`. Built on IWER's remote API; each
  gesture is stepped until IWER's queue is empty.
- Page helpers in `helpers/page-scripts.ts`: `setHeadset`, `loadRoom`, `storedInProgress`, ...

## For app code

- Register every ECS system with `registerAppSystem(world, MySystem, opts)` from `src/app/systems.ts`,
  not `world.registerSystem`: `__ns.perf()` then counts its `update()` in the per-frame JS budget.
- `__ns.perf().frameMs` has 0.1 ms steps in Chromium; use `frameMsAvg` for small costs.
- To load an asset from somewhere else (self-hosted KTX2/DRACO decoders, input-profile models), add a
  rewrite with `addUrlRewrite(fn)` from `src/app/url-rewrites.ts`. Never call `setURLModifier` on
  IWSDK's loading manager directly: it holds one modifier, and main.ts gives it the registry.
  Rewrites apply from right after `World.create` (the loading manager is made inside it), so they
  cover everything loaded later (input-profile models, scene-loaded glTF, decoders) but not assets
  preloaded during `World.create` from the asset manifest: give those local URLs in `assets.ts`.
- Decoders: IWSDK's glTF loader has `dracoDecoderPath` / `ktx2TranscoderPath` options, but in
  1.1.0-rc.2 `World.create` does not pass them and the loaders are private, so they default to unpkg.
  Use those options if IWSDK exposes them; until then a rewrite of the unpkg three URLs to local
  copies is the way (the decoders load through the same loading manager).

## Running

`scripts/e2e.sh [spec or Playwright args]` waits while the server is busy and holds a server-wide
lock while the browser runs, so lanes take turns. Needs the `shadowlocks-e2e` image
(`scripts/e2e-image/build.sh`).

The run lives only as long as the Mac that started it. Ctrl-C, a dropped connection or a Mac that
sleeps for more than 60 s stops it on the server and frees the lock, by design. While a run goes the
runner keeps the Mac from idle sleep (`caffeinate`), but closing the lid still sleeps it, so keep
the lid open for long runs.

Runs of one lane also take turns: unit tests started while that lane's e2e run goes wait for it
(up to `NS_LOCK_WAIT` s). Containers run as uid 1000 with no capabilities, so a test or an npm
install script cannot act as root on the server, and `--pull` copies back only `test-results`,
`playwright-report`, `dist`, `package-lock.json` or `audio-out`. A container is stopped (exit 137)
when it runs longer than `NS_MAX_RUN` seconds (default 7200; set it higher for a long video render),
so a hung run frees the locks, or when the server disk drops under 50 GB free while it runs.

Every run needs 100 GB free on the server (our unit, typecheck, build and e2e runs write under 2 GB;
the floor keeps room for the other projects there). A run that writes more, such as a video render,
says how much: `scripts/remote.sh <lane> --expect-gb <n> ...` or `NS_EXPECT_GB=<n> scripts/e2e.sh`,
and then needs 100 + n GB. Pulls stay capped at 2 GB per run either way.

The emulator cannot show multiview, foveation, the real frame rate or real hand jitter.
