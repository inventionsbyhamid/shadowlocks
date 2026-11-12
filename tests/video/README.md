# Demo video renders

Emulator footage for the competition video, rendered frame by frame on the build server: headless
Chromium (software WebGL) with Meta's IWER headset emulator, on the e2e tests' virtual clock. A frame
takes as long as it takes to draw (about 0.9 s at 720p, 1.9 s at 1080p in Number Smash); the footage
still plays smoothly because time only moves when a frame is stepped.

```sh
scripts/video.sh --shots sample --size 960x540 --fps 30  # the 2 s smoke shot, attached
scripts/video.sh --shots sample --final --size 2560x1440 --out 1920x1080  # drawn at 1440p, delivered at 1080p
scripts/video.sh --shots sample                          # 1280x720 60 fps draft
scripts/video.sh --shots sample --final                  # 1920x1080, x264 CRF 18
scripts/video.sh --shots sample --edit card-check        # the shot, then the end card after it
scripts/video.sh --detach --shots a,b --edit demo --final   # keeps going without this Mac
scripts/video.sh --status | --stop | --pull              # the detached render
```

Results land in `test-results/video/<width>x<height>-<fps>/` (pulled back to the Mac):
- `<shot>.mp4`: H.264 4:2:0 BT.709 (dithered, aq-mode 3), AAC stereo with the shot's sound.
- `<shot>-contact.png`: 12 frames spread over the shot; `<shot>-still-1..3.png`: full-size frames at a
  quarter, half and three quarters, from the lossless picture.
- `<shot>.json`: versions, frames, timings, every bus event with its time, the cues, music changes,
  loudness (integrated, range, true peak).
- `<edit>.mp4`, `<edit>.json`, `<edit>-contact.png`: an edit (`edits.ts`).

On the server, in the lane's `.video-cache/` (never pulled, never uploaded over, and not cleared by
an `npm ci` the way `node_modules/` is; `.gitignore` and `scripts/remote.sh` both leave it out):
`frames/` (PNG frames of the shot in progress), `mezz/` (one lossless picture per shot, x264 RGB at
qp 0), `work/` (effects stems, mixes, filter scripts, music loops decoded to PCM, end card layers).

## Writing a shot

One file per shot in `shots/` (its name is the file name), listed in `shots/index.ts`. `sample.ts`
is the template:

```ts
export default defineShot<Data>({
  name: "sample",
  description: "...",
  seconds: 2,                           // for progress and ETA
  async setup({ app, hand }) {          // not recorded: get the game where the shot starts
    await hand("right").park([0.45, 0.7, -1.3]);   // hands off camera
    const s = await app.state();
    return { box: s.boxPose.position };
  },
  firstView: ({ box }) => ({ from: [0, 1.2, -1.38], at: box }),
  async play({ camera, hand, until }, { box }) {  // recorded at the shot's rate
    camera.move(closer, 2000);          // eases (minimum jerk) while the next lines run
    await hand("right").glide(beside(box), 1300, orientation);
    await until(2);
  },
});
```

- `setup` runs on the same app, undrawn, a frame per round trip after the wait for async work; `play`
  records every frame. `app.poke`, `app.stepUntil`, `app.command` and the shot hands (the e2e `Hands`,
  with a multi-tap poke that steps through the app) work in both. In setup and play, anything that
  steps the clock on its own in the page (`waitReal`, `capture`, the e2e multi-tap loop) throws.
- The camera is a track of views (eye point and look-at point) driven by the recorder, so it moves
  while the hands do (IWER's own `animate_to` holds its single queue, which would freeze the hands).
  A slow head drift (1.5 mm, 0.12 degrees) keeps it from looking like a tripod; `sway` sets it.
- `hand(side)` is the e2e `Hands` plus `park`, `glide`, `pinch`, `shape`, `open`, `point`, `relax`,
  `gripPose`, `glideTip` and `follow` (a path set frame by frame, eased: an arc instead of glides
  that stop at each corner), all smooth.
- A view may name its lens (`hfovDeg`, the horizontal field of view; default the render's `HFOV`);
  a move eases the lens with the view. `lib/stage.ts` `boxView` sets a view in box units (beside the
  box, close on the panel: views a player never has), `boxCurve` a path in box units.
- `darkStage: true`: the emulator's room is not drawn (as the store art's plates), the Dim room
  setting is off, and each frame lays the app over a flat warm near-black (`DARK_BACKDROP`). Nothing
  is added to the scene: the box lit by its own lantern.
- `profile`: the player's stored history when the shot starts (boxes opened, a streak, the
  collection); the video build reads it at boot through the usual migration, which starts afresh
  from anything without `version: 1` (`lib/stage.ts` `playedProfile` makes one).
- The voice guide speaks in renders: the video build gives it a stand-in that counts as started and
  times each line on the frame clock, and the shot's sound lays the game's own clip
  (`public/audio/voice/en/<key>.ogg`) in where it was said (`video.voice` events in `<shot>.json`).
- A page shot (`lib/page-shot.ts`, listed in `PAGE_SHOTS`) films the game's 2D page in a browser
  window instead of the headset's view: each state of the page held for its time. It renders and
  cuts like any shot.
- While recording, each frame drains the app's event log for the sound, so a wait on bus events
  reads `w.__nsVideoEvents(type)` (the events since recording started), or `app.events()`, which
  does. `app.hold(ms)` holds still at the video rate.
- Keep what matters in view: work the hand from the side away from it, and look from a little left
  of a right hand (a raised arm hides what lies beyond it as seen from the camera). Check the stills.
- Keep `play` deterministic: no waiting on real time. Boxes are built on the main thread (the box
  worker is refused, and the box client falls back to this thread), progress is kept in memory,
  `Date` follows the frame clock, and every frame (setup frames too) first waits for async work in
  flight (fetches, decodes, worker requests), so the same thing happens on the same frame every run.
  Timers stay real (the wait needs them, and IWER re-arms one every frame); a timer the app itself
  starts during setup or recording is logged as a warning and counted in the sidecar (`appTimers`).

## How it works

1. `boot()` at the render size; IWER's field of view set to 90 degrees across (a Quest recording, not
   the emulator's 120); DevUI hidden; only the room and app canvases are captured, never the page.
   Video builds (`VITE_VIDEO=1`, never production; `check-dist` fails on it) draw IWSDK's outline
   hands as a see-through "system hand": a light body at about 30 percent, a warm-white fresnel rim,
   a depth-only pre-pass (a skinned copy sharing the skeleton, so a finger over the palm does not
   double up), a soft warm grey contour, a wrist stub that fades out 7 cm past the wrist (no
   forearm), drawn at render order 998, with its own light (`src/video/`).
2. The clock is stepped without drawing to a fixed virtual time (`START_MS`, 30 s; a shot's
   `startMs`), whatever boot took, then the setup runs, then a second of held first view, two drawn
   warm-up frames, and recording.
3. Each frame: wait for async work, pose the headset, step one frame, collect the bus events, capture
   room plus app as PNG. Each PNG goes to a temp file and is renamed, then a journal line with a
   fingerprint of the frame's state and the PNG's sha256. The fingerprint (`frameFingerprint` in
   `lib/page-video.ts`) hashes the virtual time, the screen, both hands' poses, the frame's events
   and the game's own small hook, `window.__sl.frameState()`: `{ boxKey, lantern: [x, y, z],
   openLocks, screen }`, or null while no box is in play (it then hashes as "no box"). Every 60
   frames the disk is checked: the shot stops (frames kept) when the disk has under 100 GB free or
   the frames pass `--expect-gb`.
4. Resuming: the frames on disk are replayed without drawing (about 10 to 30 ms each), each state
   checked against the journal; the last one is drawn again and its PNG compared byte for byte; then
   recording carries on. A shot that does not replay the same deletes its frames and the retry starts
   clean (`--fresh` applies to the first attempt only).
5. The frames become a lossless mezzanine (frame count and size checked), then the PNGs go.
6. Sound from the recorded events: the game's own `CueMapper` and the audio manifest (trims, buses,
   variants, seeded pitch and level spread, cooldowns, equal-power panning and distance from the
   head; an event naming a button is heard at that button, as in the game), mixed by ffmpeg from
   `public/audio/` with the music loops played sample exactly from PCM (bar-line changes, menu and
   results low-pass, ducking under stings) and the engine's limiter. Until the sound pack is in the
   repo (`public/audio/manifest.json`), the mix is silence of the right length, with a warning.
7. One delivery encode from the mezzanine, checked (frames, size, rate, audio length), contact sheet,
   stills, loudness measured (`ebur128`).

What is reused: a shot's frames and mezzanine depend on the app (`src/` minus audio, `public/` minus
audio, `index.html`, configs, `package-lock.json`), the browser image, the shot file and the frame
side of the video library (`shoot.ts` holds the start time, epoch, boot options and the order of the
steps before frame 0); its sound on `src/audio/`, `public/audio/` and the sound side of the library
(`audio.ts`, `mixdown.ts`, `loudness.ts`, `deliver.ts`, which also cuts edits). A sound change only
re-mixes from the stored events (no browser); a CRF change only re-encodes; anything else renders
the frames again. `--reuse-stale` reuses finished shots (their mezzanines) made from an older
version, with a warning; frames of a shot still in progress never carry over to another version.
Frame folders of an old version of a shot, and any frame folder a week old, are deleted at the start
of a render.

Edits: pictures from the mezzanines, crossfades in whole frames (shorter than every clip), each
shot's effects stem at its start, one continuous music bed across the cuts, an optional voice-over
(`narration`, from a file in `video-assets/`, not committed) that the rest ducks under, two-pass
loudness to -14 LUFS (linear; a peak limiter at 4x the rate first when the gain would pass the
ceiling; the PCM is aimed 0.5 dB under -1 dBTP for what AAC adds, more on a second or third encode
when the AAC still comes out over), and one delivery encode with the shots' own settings. A
`label` lays a corner label ("Emulator footage") over the shots it names; `captions` lay lower third
captions (the game's serif, Noto Serif Bold, at least 2.5 s each, fading in and out) over the shots
they name. With `--out` (OUT_SIZE), shots, edits and stills are drawn at the render size and scaled
down (Lanczos) in the one delivery encode. An
`endCard` (title, tagline, facts, an optional link) holds the last frame, blurs and dims it in, and
lays a card drawn by the browser in Archivo and the game's ebony and gold over it (`lib/endcard.ts`,
the font in `assets/fonts/`, OFL) for `holdSec`; the music runs on under it and fades out. Its words
live with the game's copy (`COPY.film` in `src/ui/copy.ts`: no em or en dashes). The edit fails when
the PCM or the decoded AAC track of the MP4 misses -14 LUFS by more than 0.5 LU or peaks over
-1 dBTP; both measurements go in `<edit>.json` (`loudness: null` keeps the game's own levels).
While the repo has no sound pack (and the edit has no voice-over) the mix is silence, which no gain
brings to -14 LUFS: the edit then skips the loudness step with a warning instead of failing. Every shot's version is printed; stale
shots are refused unless `--reuse-stale`.

## Store art

`scripts/store-art.sh` renders the Meta Horizon Store images from the game with `store.spec.ts`
(`playwright.store.config.ts`, through `scripts/e2e.sh`): plates first (the box lit by its lantern, the
room not drawn, a camera set in box units, one boot per size), then the hero cover, the three covers, the
mini landscape, the icon and the logo cut from them with the title in Limelight (OFL,
`assets/fonts/OFL-Limelight.txt`), and five screenshots as real frames with the room. Each file is written
at Meta's size and pixel format (24-bit, the logo 32-bit with transparency, checked with ffprobe); the
render fails when a title enters the top or bottom 20%. Results go to `test-results/store/` and are copied
to the planning folder's `store/assets/`, with `store-art.json` and `overview.png`. Sizes, views and title
placement live in `lib/store-art.ts`. About 25 minutes on the shared browser lock.

The same run makes the website's link card (`LINK_CARD`: index.html's og:image, 1200x630 JPEG under 300 KB,
the box, the title and a "Play on Meta Quest" line inside the centre square that chat apps crop to) and
copies it into the repo as `public/og-image.jpg`, never to the planning folder; commit it.
`scripts/store-art.sh --link-card` makes only the card and its plate (a few minutes) and leaves the
planning folder alone; `test-results/store/review/link-card-*.png` show it at 300x157 and as the
300x300 square crop.

## Attached and detached

Both first wait (as `scripts/e2e.sh` does) up to an hour until no other `shadowlocks-e2e` browser
container runs (still one after that: refused, exit 75), then hold the server-wide `e2e` lock that
e2e runs take, and the lane lock: one heavy browser at a time on the shared server. A render
therefore holds every lane's e2e runs back while it goes (they give up after `NS_LOCK_WAIT`, an hour
by default): render long cuts shot by shot, detached, at quiet times. Both stop after 3 h by
default, so a stuck render frees the lock; a long final sets `NS_MAX_RUN` (seconds) higher.
- Attached (`scripts/video.sh ...`): a `remote.sh` run; it stops when this Mac sleeps or disconnects
  (resuming later costs little). Run time cap 3 h (`NS_MAX_RUN`).
- Detached (`--detach`): asks the server first whether a render of this lane is already queued or
  running (refused at once, before the upload), uploads through `remote.sh`, then the server starts
  container `shadowlocks-e2e-video-<lane>` (same limits and user as the runner: 6 CPUs, 8 GB, 2048
  processes, uid 1000, no capabilities) under its own hard `timeout` (3 h, `NS_MAX_RUN`). The
  watchdog on the server takes the lane lock, the lane's write lock and the `e2e` lock in that order
  (as the runner does), stops the container (resumably) when the free disk drops under 100 GB, the
  load stays over 25 for 5 minutes, or the render makes no progress for 20 minutes (no new log line
  and no file written under the lane's `.video-cache/` or `test-results/`: a hung browser or encode;
  `NS_VIDEO_STALL_POLLS` checks 30 s apart on the server, default 40), kills it at its limit plus
  300 s, and writes
  `/root/shadowlocks/video/<lane>/status.json` (queued, running, done, stopped with the reason, or
  failed; shot, frame i of N, ETA); the container's log is kept in `last.log` there. One watchdog
  per lane: a second `--detach` is refused while one is queued or running; `--stop` stops a running
  render, cancels a queued one, or removes a container left behind. A shot that stops itself for the
  disk, or a render stopped for no progress, ends as "stopped" (resumable), not "failed". `--pull`
  fetches the results once it is done.

Time: Number Smash ran about 55 s of server time per second of 720p 60 fps video and 110 s at 1080p
(load around 15; more when the server is busy). Each shot's sidecar has the real figure
(`stats.renderSecondsPerVideoSecond`). Render shot by shot: finished shots are reused, and an edit
only re-cuts them.

Disk: the shot in progress keeps its PNG frames (720p about 0.8 MB, 1080p about 1.3 MB per frame);
mezzanines stay (about 0.16 MB per 720p frame). `scripts/video.sh` declares `--expect-gb` (2 for
drafts, 4 for finals): a render needs 100 GB plus that free.

Server footprint (for teardown): the lane folder's `.video-cache/`,
`/root/shadowlocks/video/<lane>/` (status, logs, watchdog lock and pid), and while a detached render
runs, container `shadowlocks-e2e-video-<lane>`.

The emulator cannot show multiview, foveation, the real frame rate, real hand jitter or passthrough.
