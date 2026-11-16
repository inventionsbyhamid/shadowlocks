# Shadow Locks

**Shadow Locks is an infinite mixed reality puzzle game for Meta Quest: in passthrough, in your own room, you carry a
lantern with your hands until the shadows of hanging brass scraps fill each lock.** The scraps hang at different
depths, so as the light moves their shadows grow, blur and swing by different amounts: you read depth from the shadows
to find the one point in space that opens each lock. Some locks are one piece short, and your own fingertip in the
beam casts the missing piece. The boxes never run out, a new Daily Box arrives every day (the same for everyone), and
a "beat my time" link sends a friend the exact same box. It runs in the Meta Quest browser (WebXR) with no install,
hands first with Touch controllers too, and plays offline after the first load.

**[Play it](https://shadowlocks.pages.dev)** (open in the Meta Quest browser) · **[Demo video](https://youtu.be/Ak_oFJQgHYg)** (85 s) · Built for the Meta VR Start Developer Competition 2026, Gaming track

![A Shadow Locks puzzle box in a simulated room (emulator capture over a photographed room), both locks open in gold](docs/images/about-1-room.jpg)

## Contents

- [Play it in two minutes](#play-it-in-two-minutes)
- [Controls](#controls)
- [How depth works](#how-depth-works)
- [Features](#features)
- [Settings](#settings)
- [How it is built](#how-it-is-built)
- [Frame rate and optimisations](#frame-rate-and-optimisations)
- [Built for real life: the edge cases it handles](#built-for-real-life-the-edge-cases-it-handles)
- [Testing](#testing)
- [Run it yourself](#run-it-yourself)
- [Project layout](#project-layout)
- [Privacy](#privacy)
- [Credits](#credits)
- [Licence](#licence)

## Play it in two minutes

1. Sit down. Use your hands, or Touch controllers. Made for Meta Quest 3 and Meta Quest 3S (90 Hz) and Meta Quest 2
   and Meta Quest Pro (72 Hz), in the Meta Quest browser.
2. Open [shadowlocks.pages.dev](https://shadowlocks.pages.dev) in the Meta Quest browser and press **Open the box**.
   The first launch downloads about 11 MB; after that it plays offline.
3. Lesson 1 starts by itself, and a voice guide says what to do.
4. Pinch the lantern and move it until the shadows fill the gold outline. Let go any time: the lantern stays where you
   leave it.
5. Near scraps swing more and blur; far ones stay sharp. Use that to find the spot.
6. A lock that is one piece short: point one finger into the gap in the beam and hold still.
7. Stuck? Poke the little lantern on the frame for a hint, or choose Show me.
8. The Daily Box opens after Box No. 3.

From a phone or computer, the page offers **Open on my Meta Quest** (Meta's Web Launch), which sends the game to your
headset.

## Controls

| Action | Hands | Touch controllers |
|---|---|---|
| Pick up the lantern | Pinch it | Hold the trigger or grip on it |
| Move the lantern | Carry it; let go and it floats where you left it | The same |
| Finger locks | Point your index finger into the gap in the beam | Aim the controller into the gap: it casts a fingertip-sized stand-in finger |
| Press a key | Poke it, or pinch with your hand's ray on it | Poke it, or point the controller's ray at it and pull the trigger |
| Open the menu | Pinch the drawer handle at the front of the box and pull | The same |
| Bring a lost box back | Pinch or poke the gold arrow at the edge of your view | Trigger at the arrow |
| Choose a lock | Look at it: the lock in front of your eyes is the one you work on | The same |

**Controller support.** Every lock, lesson and menu can be finished with Touch controllers alone:
- Controllers get haptics: a tick on grab, ticks as the lantern comes within 4, 3, 2 and 1 cm of a spot, a double tap
  when the sight rings line up, a snap when the lantern settles, a thud when a lock opens and a roll when the box opens.
- Finger locks work with a controller: it casts a fingertip-sized stand-in finger along its aim.
- The lesson lines speak your input, for example "Your turn. Aim a controller into the gap and hold still."
- Controller models for Meta Quest 2, Meta Quest Pro, Meta Quest 3 and Meta Quest 3S ship with the game, so they load
  offline too.

## How depth works

![Side view: a scrap near the lantern casts a big, soft shadow; a scrap near the panel casts a small, sharp one](docs/images/about-2-depth.jpg)

With the lantern a distance D from the back panel, a scrap a distance d from it, a lantern of radius r, and the lantern
moved sideways by Δ:

$$
\text{shadow scale} = \frac{D}{D-d}, \qquad
\text{shadow swing} = \Delta \cdot \frac{d}{D-d}, \qquad
\text{edge blur} = r \cdot \frac{d}{D-d}
$$

A scrap at the panel casts its true size, sharp, and barely moves; a scrap halfway to the lantern casts a shadow twice
its size with a soft edge and swings as far as the lantern moves. Blur and swing share one factor, so the two depth
cues always agree. The blur is the same formula as `penumbra()` in `src/render/shadow-mesh.ts`.

## Features

**Puzzle**
- A lantern you hold freely in 3D, with every shadow recast from it each frame.
- Depth read from blur and parallax ([how depth works](#how-depth-works)).
- Finger locks: your own fingertip casts the missing piece; hold still and it turns to brass.
- Every opened box gives a reward with a line of story for your Collection.

![A hand in the lantern's beam casting the missing piece of a lock (emulator capture; on a headset your real hand shows through passthrough)](docs/images/about-3-finger.jpg)

**Infinite boxes and the Daily Box**
- Every box is generated from its number, so Box No. 157 is the same box for everyone, on every headset.
- Difficulty ramps up: one gentle lock first, then up to three locks per box, decoy scraps, locks without sight rings,
  hidden outlines where you guess the shape, and finger locks.
- Fair by construction: the generator throws away any layout that breaks the rules (each lock's scraps tile its outline
  from its spot, a finger lock is short exactly its missing piece, nothing else falls on a lock from its spot, the start
  solves nothing, every spot is within a seated comfort zone), and tests check boxes 1 to 200 and 30 Daily Boxes; an
  opt-in sweep builds boxes 10 to 2000 and a year of Daily Boxes.
- After Box No. 3, a new Daily Box every day, the same for everyone on the same date, with a streak.

**Sharing and friendly competition**
- A result card for every opened box: your time, one square per lock (gold for solved alone, orange with a hint, red
  when shown), your best, and your Daily streak.
- In the headset the card is made to read well in a Quest screenshot. On the game's 2D page, Share sends it as a few
  lines of text (coloured squares, time, streak) with a "beat my time" link such as
  `https://shadowlocks.pages.dev/?box=157&t=152&h=0&g=4` (box, your time in seconds, hints used, generator version; a
  Daily Box uses `day=2026-11-16`).
- The link opens the exact same box as practice, so it never touches your friend's own progress (a new player does
  Lesson 1 first). When your friend finishes, their card shows both times.
- No accounts and no server: the challenge lives in the link.

**Mixed reality and comfort**
- WebXR passthrough: the room dims like a theatre while you solve and lights up when the box opens; your real hand
  stays visible in front of the box.
- The box places itself in your lap from your seated posture (back panel about 55 cm ahead and 28 cm below your eyes,
  leaning back 10°), never moves on its own, and comes back in front of you with one pinch on the arrow, or Recenter.
- Seated, one-handed, no fail state, no countdown; box size 18 to 30 cm; a left-hand mode; optional room dimming.
- Lessons with a ghost hand and an English voice guide (every line also shown as text), replayable any time.
- Six languages: English, Spanish, French, German, Brazilian Portuguese and Japanese.
- Leaving, taking the headset off or reloading resumes the box where you were.

## Settings

Settings opens from the drawer at the front of the box. Every change applies at once and is saved.

![The Settings panel in the room: language, volumes, box size and toggles (emulator capture over a photographed room)](docs/images/settings.jpg)

| Setting | What it does |
|---|---|
| Language | Automatic (follows the headset) or any of English, Spanish, French, German, Brazilian Portuguese and Japanese |
| Music, Effects | Volume of each, down to off |
| Box size | 18 to 30 cm |
| Warmth | The "getting closer" glow and hum as the lantern nears a lock's spot; switch it off for a purer puzzle |
| Less motion | No bounce in the animations |
| Dim room | The theatre dimming of your room while you solve |
| Left hand | Mirrors the box and the lessons |
| Voice guide | Spoken help in English, on by default |
| Recenter | Places the box in front of you again |
| Reset progress | Starts over, after asking first |

## How it is built

![Architecture: hands, controllers and head gaze feed the per-frame shadow projection and solve rule](docs/images/about-4-architecture.jpg)

- **Engine:** TypeScript on Meta's Immersive Web SDK (`@iwsdk/core`) and three.js, in a WebXR `immersive-ar` session
  for passthrough (an `immersive-vr` session with a virtual studio where passthrough is not available). Menus are
  `@pmndrs/uikit` panels. Built with Vite.
- **Shadows without shadow maps:** every scrap, sight ring and hand bone is projected from the lantern onto the back
  panel on the CPU, as exact polygons with a soft edge sized by depth, all drawn in one mesh. A frame recasts only what
  moved and creates no new objects (`src/render/box-shadows.ts`, `src/render/shadow-mesh.ts`).
- **Solve rule:** a grid of points (about 3.8 mm apart at the default box size) is tested against the exact shadow
  polygons. A lock opens when at least 92% of its outline is in shadow, at most 25% of the lit band around it is
  darkened by scraps (55% counting a fingertip), and for a finger lock at least 78% of the missing piece is filled
  ([src/core/solve.ts](src/core/solve.ts)).
- **Hands:** each tracked hand is a set of capsules, one per bone. The same capsules cast the hand's shadow, decide
  finger locks, and, drawn invisibly first, keep the real hand visible in passthrough. Grabs are smoothed with a One
  Euro filter.
- **Generator:** seeded and deterministic, in a Web Worker (`src/core/generator.ts`, `src/worker/box.worker.ts`); the
  Daily Box is seeded by the date. Golden-hash tests pin boxes 1 to 200 and 30 Daily Boxes, and shared links record the
  generator version.
- **Sound:** a Web Audio engine with spatial hums, all Ogg Opus; everything pitched is in G major at 72 BPM, so each
  lock's note and each box's tune fit the music. Sound effects and the 42 voice lines were made with ElevenLabs, the
  music bed with Suno.
- **Offline:** a Workbox service worker (`vite-plugin-pwa`) precaches every file, voice and music included; a new
  version never takes over in the middle of a box. Hosted on Cloudflare Pages.

## Frame rate and optimisations

- **Frame rate:** 90 Hz on Meta Quest 3 and Meta Quest 3S. On Meta Quest 2 and Meta Quest Pro (Snapdragon XR2 Gen 1,
  detected from the GPU) the session asks for 72 Hz, giving each frame 13.9 ms instead of 11.1. Everything drawn is the
  same on every headset.
- **Budgets the code is held to:** at most 3 ms of our JavaScript per frame at 4× CPU throttle, at most 50 draw calls
  in play and 100 at a celebration's peak, at most 100k triangles, no post-processing, no shadow maps.
- **Measured:** on the heaviest box we test, our JavaScript's 95th-percentile frame cost is 2.2 to 2.8 ms at 4×
  throttle in headless Chromium, with 46 draw calls. A slower gate at 5.72× throttle stands in for Meta Quest 2 and Meta Quest Pro and
  passes. Over 300 boxes in a row, memory stays flat.
- **Both eyes in one pass** (multiview), on by default.
- **Shadows recast only when something changed:** the box's shadows are reprojected only when the lantern, a pose or
  the layout moved, and each mesh slot is rewritten only when its polygon changed.
- **Almost no garbage in the frame loop:** per-frame code reuses its buffers and creates no new objects, and a test
  holds the bytes allocated per frame under a budget, so garbage collection stays out of the way mid-puzzle.
- **One read per frame:** the head's world matrix is read once, fingertips reuse the hand-joint reads, and the hint
  lantern's keys share one matrix update.
- **No first-use stutter:** the box, its effects and the summon arrow are in the scene from the start, hidden, so the
  session's prewarm compiles their shaders before you play.
- **Off the main thread:** boxes are generated in a Web Worker, so a new box never stalls a frame.
- **Small and offline:** all audio is Ogg Opus, the whole game is about 11 MB, and after the first launch it loads from
  the device.
- **Check it on a headset:** add `?perf=1` to the address for a live panel with frame rate, frame time, JavaScript time
  per frame, draw calls and triangles; `?hz=72` (or 80, 90, 120) asks for another rate.

## Built for real life: the edge cases it handles

- **Tracking hiccups:** a hand that drops out of tracking for less than 150 ms keeps hold of the lantern; after that it
  lets go, and the lantern stays exactly where it was. A hand out of tracking never counts toward a finger lock.
- **Headset off, system menu, page hidden:** the box, its clock and the sound pause, so your time only counts time you
  played. The box is saved at once, and a voice line that was cut off is said again from the start.
- **Leave, reload or crash:** the box in progress is saved within a second of every change and resumes with Continue.
- **Updates never interrupt a puzzle:** a new version installs in the background and only takes over at the next
  launch, never while another window is playing, with one short note when it does.
- **Two windows at once:** saves are revision-checked, so one window never overwrites progress made in another.
- **Private browsing or blocked storage:** the game falls back to memory and plays normally.
- **The box out of view:** it never moves by itself; a gold arrow at the edge of your view brings it back in front of
  you with one pinch, with a fade instead of a slide. Pick up the lantern during the fade and the move is called off.
- **Hands or controllers, any time:** pick up a controller mid-lesson and the lesson lines switch to controller
  wording; put it down and hands take over.
- **Left-handed:** a left-hand mode mirrors the box and the lessons.
- **Fair boxes only:** the generator throws away any layout that breaks the fairness rules before you ever see it.

## Testing

- **1,839 unit tests** (Vitest) for the generator, solve rule, shadows, lessons, sharing, profile and more.
- **39 end-to-end specs** (Playwright) that drive Meta's IWER headset emulator in headless Chromium on a virtual clock,
  so every run repeats frame for frame.
- **Bots** play lessons and boxes with injected hand jitter.
- **Soaks:** 60 and 300 boxes in a row, with memory checked flat.
- **The demo video** is rendered from the game itself, frame by frame, by the same harness (`tests/video/`).

## Run it yourself

Requires Node.js 22 or later.

```bash
git clone https://github.com/inventionsbyhamid/shadowlocks.git && cd shadowlocks
npm install
npx vite             # https://localhost:8081, with Meta's IWER emulator for a desktop browser
npm test             # unit tests
npm run typecheck
npm run build        # production build in dist/, then checks it
```

The dev server uses a self-signed HTTPS certificate. On a headset, connect over USB with `adb reverse tcp:8081
tcp:8081` and open `https://localhost:8081` in the Meta Quest browser (accept the certificate warning). The
end-to-end suite (`npm run e2e`) renders with software WebGL one spec at a time and takes hours, so we run it in Docker
on a build machine (`scripts/e2e.sh`, image in `scripts/e2e-image/`); see [tests/e2e/README.md](tests/e2e/README.md).

## Project layout

| Path | What is in it |
|---|---|
| `src/core/` | Pure game logic: generator, solve rule, Daily Box, sharing links, profile, shapes |
| `src/render/` | three.js scene: the box, shadow projection and mesh, placement, the hand mask, effects |
| `src/app/` | Systems that run each frame: session, lantern, hands, lessons, menus, sound, summon |
| `src/input/` | Pinch, poke, grab, drawer pull, the One Euro filter |
| `src/feel/` | Lantern feel: rest detection, gaze focus, finger hold, stuck watch |
| `src/ui/` | Panels, menus, the result card and every line of text |
| `src/audio/` | Web Audio engine, hums, music box, voice guide |
| `src/i18n/` | The six languages |
| `src/platform/` | Offline service worker config, storage, version |
| `src/worker/` | The box generator's Web Worker |
| `src/lessons/` | The ghost hand's recorded poses |
| `src/video/` | Demo video render hooks (compiled out of production builds) |
| `tests/` | Unit, end-to-end and video tests |
| `public/` | Fonts, sounds, icons, the privacy page |
| `twa/` | Meta Horizon Store app configs (Bubblewrap) |
| `scripts/` | Build checks, deploy, fonts, icons, store and video tools |
| `docs/images/` | README images |

## Privacy

No account, no ads, no tracking, no analytics. Progress is stored on the device; a shared link carries only the box,
the time, hints and the generator version. See the [privacy page](https://shadowlocks.pages.dev/privacy).

## Credits

Built for the Meta VR Start Developer Competition 2026. Fonts, controller models and hand poses by others are listed
with their licences in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Sound effects and voice lines were made with
ElevenLabs, the music with Suno.

## Licence

Source-available. Anyone may read, clone, run and change the code for personal, educational, research or evaluation
use, and anyone may use the art, screenshots, video, name and logo to write about, feature or promote Shadow Locks.
Meta, Devpost and the judges keep every right the competition's Official Rules grant, over every part of the entry.
Only publishing the game itself as a playable copy, or commercial use of the code, needs permission. Third-party
components keep their own licences. See [LICENSE](LICENSE).
