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
  screen with the box placed. `mode: "visual"` is 1280x720 with the room drawn, for screenshots: the
  room is drawn only in frames a capture takes (`roomOnCaptureOnly`; drawing it every frame made each
  visual frame 0.5 to 2 s on the server). Anything that captures goes through `app.capture` or sets
  `window.__nsRoomFrame` around its frame step, or the room is missing from the image.
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

Functional runs of named specs share that lock: up to four go at once, from any lanes, and one
starts while the server's load is 34 or less (40 cores less one run's 6). Exclusive runs start only at
load 25 or less. These gates are named defaults at the top of `scripts/e2e.sh`
(`FUNCTIONAL_SLOTS`, which must match `SHARED_SLOTS` in `scripts/remote.sh`, `FUNCTIONAL_MAX_LOAD`
and `EXCLUSIVE_MAX_LOAD`); `NS_MAX_LOAD` overrides the load limit for one run. Exclusive runs go
alone:
- the full suite (no spec named);
- any argument mentioning `cost`, `perf-budget`, `bot`, `store`, `shadows`, `lantern` or
  `tests/video`;
- a spec filter that is not a plain path or name (only letters, digits and `. _ / -`), or that also
  matches such a spec or one carrying the line `// e2e: exclusive` (`hand` runs
  `hand-cost.spec.ts` too);
- `NS_E2E_EXCLUSIVE` set to anything but empty or `0`.

Every spec that gates on wall-clock time (real milliseconds, CPU throttling) must carry
`// e2e: exclusive`.

An exclusive run waits for every other run to end. It first waits on this Mac for up to 30 minutes
until no browser run goes; during that pre-wait functional runs still start. Then it queues for the
lock on the server, even if runs are still going, and from that moment no new run starts ahead of
it. Only the lock wait itself (`NS_LOCK_WAIT`) ends it with exit 75. A functional run that still
finds four browser runs going after its 30-minute pre-wait gives up (exit 75).
`scripts/e2e.sh --print-mode <args>` says which kind a run would be, and `--print-limits <args>`
also gives the load and the number of browser runs it starts under. The rule is in the script's
header.

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

## The jitter bot (opt in)

`bot.spec.ts` (hands solve boxes 1 to 20), `bot-controllers.spec.ts` (the same with Touch controllers),
`bot-sweeps.spec.ts` (five minutes of fast sweeps open nothing) and `bot-lessons.spec.ts` (both lessons, the crown's
finger and the real drawer pull included) drive the game as a careful player whose hand shakes, drifts as it lets go
and drops out of tracking (`helpers/jitter.ts`). They are not part of the routine suite: `playwright.config.ts` leaves
`bot*.spec.ts` out, because the box and sweep specs each take about 25 minutes of exclusive server time. Run them
through their own config, which is the suite's with only these specs:

```sh
# All four, one after the other (about 1.5 hours): wait up to two hours for the slot, allow three to run.
NS_LOCK_WAIT=7200 NS_MAX_RUN=10800 scripts/e2e.sh -c playwright.bot.config.ts
# One (about 25 minutes)
NS_LOCK_WAIT=7200 scripts/e2e.sh -c playwright.bot.config.ts tests/e2e/bot.spec.ts
```

Run them after a change to the feel (`src/feel/constants.ts`, the ring thresholds, the lantern or finger paths) or
the box session's open rule. Each carries `// e2e: exclusive`, and any run naming the bot config is exclusive too.
Naming a bot spec with the default config finds no tests. Per-box results land in `test-results/bot/*.json` and a
summary in the run notes. A bot run waits for an exclusive slot; behind another lane's long run that can take over
an hour, hence `NS_LOCK_WAIT=7200` (the default gives up after one). The three box and sweep specs took 1.4 h
together, and the lessons add to that, near enough the default two-hour container limit (`NS_MAX_RUN` 7200) on a
loaded server that `NS_MAX_RUN=10800` is the safer setting.
