// e2e: exclusive (times real milliseconds at 4x throttle: scripts/e2e.sh runs this spec alone on the server)
// Opt in, outside the routine suite: scripts/e2e.sh -c playwright.frame-cost.config.ts (tests/e2e/README.md says when).
// Refits the generator's frame cost model (src/core/frame-cost.ts, FRAME_MS): our JS a frame in play against the
// shadow corners a box casts. For boxes across the range, the lantern is carried in small loops within 0.05 of the spot
// of the box's biggest lock (most sample points, so its measure runs every frame), in the right hand, the left hand's
// fingers in the beam, at 4x CPU throttle. Each box is timed over WINDOWS_HERE windows of TIMED_FRAMES frames; the
// first is left out (the engine still warming), and so is the first box of a run, which reads about 0.25 ms high: box
// 12 goes first as a warm-up. At the end the fit of the frame's mean (and the shell system's) against the corners is
// printed beside FRAME_MS, for FRAME_MS and FRAME_CORNER_CAP to be set from. Asserts nothing about the budgets.
import { boxFrame, generateBox } from "../../src/core/generator";
import { FRAME_MS } from "../../src/core/frame-cost";
import { prepareLock } from "../../src/core/solve";
import type { V3 } from "../../src/core/types";
import { CHROME_ARGS } from "./helpers/chromium";
import { Pointer, worldOf } from "./helpers/finger";
import { Hands } from "./helpers/hands";
import { carry, grab, toWorld } from "./helpers/lantern";
import { timedWindows } from "./helpers/perf-play";
import { expect, test } from "./helpers/test";

test.use({
  launchOptions: { args: [...CHROME_ARGS, "--js-flags=--invocation-count-for-maglev=5 --invocation-count-for-turbofan=30"] },
});

const WINDOWS_HERE = 3;
/** The warm-up first, then early boxes and every kind from 10, the heaviest (52) among them, box 15 early and late. */
const BOXES = [12, 15, 3, 1, 7, 9, 5, 21, 52, 22, 13, 28, 46, 37, 12, 15];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const measured: { n: number; corners: number; frame: number; shell: number }[] = [];

/** Least squares y = a + b x: [a, b, r]. */
function fit(xs: number[], ys: number[]): [number, number, number] {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i]! - my);
    sxx += (x - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  });
  const b = sxy / sxx;
  return [my - b * mx, b, sxy / Math.sqrt(sxx * syy)];
}

test.describe.configure({ mode: "serial" });

for (const [k, n] of BOXES.entries()) {
  test(`frame cost at box ${n}'s biggest lock (${k + 1} of ${BOXES.length})`, async ({ page, boot }) => {
    const box = generateBox({ kind: "box", n }), corners = boxFrame(box).corners;
    const size = box.locks.map((l) => {
      const s = prepareLock(l);
      return s.inside.length + s.band.length;
    });
    const L = box.locks[size.indexOf(Math.max(...size))]!.L;
    const app = await boot();
    await page.evaluate((n) => window.__sl!.session.play({ kind: "box", n }), n);
    await app.stepUntil(
      (_ns, w) => {
        const s = w.__sl.session.state();
        return s?.stage === "playing" && s.revealed;
      },
      { maxMs: 10_000, label: `box ${n} in play` },
    );
    const right = new Hands(app, "right");
    await page.evaluate(() => window.__sl!.placeLantern([0.05, -0.1, 1.25]));
    await app.step(2);
    const off = await grab(app, page, right);
    const around = (dx: number, dy: number, dz: number): V3 => [L[0] + dx, L[1] + dy, L[2] + dz];
    const loop = [around(0.04, 0.02, 0), around(-0.03, -0.03, 0.03), around(0.01, -0.04, -0.02), around(-0.04, 0.03, 0.01)];
    const pts = await Promise.all(loop.map((p) => toWorld(page, p)));
    const left = new Pointer(app, "left");
    const [tip] = await worldOf(page, [[0.1, 0.05, 0.6]]);
    await left.point(tip!, [1, 0, 0], [0, 0, -1]);
    const sweep = async (i: number) => carry(right, off, pts[i % pts.length]!, 400);
    for (let i = 0; i < 8; i++) await sweep(i);
    const windows = await timedWindows(app, page, sweep, 4, WINDOWS_HERE);
    const means = windows.map((w) => {
      const keep = (f: number) => w.frames[f]! < 20;
      return { frame: mean(w.frames.filter((_, f) => keep(f))), shell: mean(w.bySystem.shell!.filter((_, f) => keep(f))) };
    });
    // One measurement a box run, the mean of its windows after the first (as FRAME_MS's fit took them), so the r
    // printed at the end compares with FRAME_MS's.
    const later = means.slice(1);
    if (k > 0) measured.push({ n, corners, frame: mean(later.map((m) => m.frame)), shell: mean(later.map((m) => m.shell)) });
    console.log(
      means
        .map((m, i) => `frame cost: box ${n} (${k + 1}), ${corners} corners, window ${i + 1}: mean ${m.frame.toFixed(3)} ms, shell ${m.shell.toFixed(3)} ms`)
        .join("\n"),
    );
    expect(windows).toHaveLength(WINDOWS_HERE);
  });
}

test.afterAll(() => {
  if (measured.length < 3) return;
  const xs = measured.map((m) => m.corners);
  const [a, b, r] = fit(xs, measured.map((m) => m.frame)), [sa, sb, sr] = fit(xs, measured.map((m) => m.shell));
  console.log(
    `frame cost fit over ${measured.length} measurements of ${new Set(measured.map((m) => m.n)).size} boxes: frame mean ${a.toFixed(3)} + ` +
      `${b.toFixed(6)} ms a corner (r ${r.toFixed(2)}); shell ${sa.toFixed(3)} + ${sb.toFixed(6)} (r ${sr.toFixed(2)}); ` +
      `FRAME_MS now ${FRAME_MS.base} + ${FRAME_MS.corner}`,
  );
});
