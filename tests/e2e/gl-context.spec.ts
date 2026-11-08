// A WebGL context lost and restored (WEBGL_lose_context), with box 15 in play: three restores its own state and
// uploads its textures again, and the box's two studio environments, render targets whose contents a lost context
// does not keep, are rendered again (src/render/box-scene.ts restoreEnvironmentsOnContextRestore). The frame after
// the restore must be the frame before it, pixel for pixel; without the studios rendered again the gold, lacquer and
// glass reflect black. The test waits for the lost and restored events with frames stepped meanwhile: waiting for
// them inside one page call, with no frame, ran into the test's 10-minute limit.
import fs from "node:fs";
import path from "node:path";
import { QUEST2_EYE } from "./helpers/headset";
import { expect, test } from "./helpers/test";
import { SHOTS_DIR } from "./helpers/xr-app";

const VIEW = { width: QUEST2_EYE.width / 2, height: QUEST2_EYE.height / 2, fov: QUEST2_EYE.fov };

test("the box looks the same after its WebGL context is lost and restored: its reflections come back", async ({ page, boot }) => {
  const app = await boot();
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 15 }));
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: "box 15 in play" },
  );
  await page.evaluate(() => window.__sl!.placeLantern([0.05, -0.1, 1.25]));
  await app.step(36);
  // Box 15 brings in a tip, whose ghost demo moves for about 6 s; frames pass while the context comes back (below), so
  // the frames compared come once the demo is over and nothing moves.
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().tipping, { maxMs: 2_000, label: "the tip's demo" });
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.lessons.state();
      return !s.tipping && s.ghost === 0;
    },
    { maxMs: 15_000, label: "the tip's demo over" },
  );
  await app.step(36);
  const census = () => page.evaluate((o) => window.__ns!.gpu.census(o), { ...VIEW, image: true });
  const before = await census();
  await app.step(36);
  expect((await census()).hash, "the box at rest: nothing moves from frame to frame").toBe(before.hash);
  // Lose the context, then get it back (three's own restore runs first, then the box's). The events come as tasks, so
  // wait for them in real time, a frame stepped per look, with a short limit: a run that never sees one says which.
  const ext = await page.evaluate(() => {
    const w = window as unknown as { __glt: Record<string, unknown>; __ns: { world: unknown } };
    const gl = (w.__ns.world as { renderer: { getContext(): WebGL2RenderingContext } }).renderer.getContext();
    const lose = gl.getExtension("WEBGL_lose_context");
    const t: Record<string, unknown> = { ext: !!lose, lost: false, restored: false, prevented: null, lose };
    w.__glt = t;
    if (!lose) return false;
    const canvas = gl.canvas as HTMLCanvasElement;
    const onLost = (e: Event): void => {
      t.lost = true;
      t.prevented = e.defaultPrevented;
    };
    canvas.addEventListener("webglcontextlost", onLost, { once: true });
    canvas.addEventListener("webglcontextrestored", () => void (t.restored = true), { once: true });
    lose.loseContext();
    return true;
  });
  expect(ext, "WEBGL_lose_context").toBe(true);
  await app.waitReal((_ns, w) => w.__glt.lost, { timeoutMs: 30_000, label: "webglcontextlost" });
  const prevented = await page.evaluate(() => {
    const t = (window as unknown as { __glt: { prevented: boolean; lose: WEBGL_lose_context } }).__glt;
    t.lose.restoreContext();
    return t.prevented;
  });
  expect(prevented, "three prevents the lost event's default, so the context may come back").toBe(true);
  await app.waitReal((_ns, w) => w.__glt.restored, { timeoutMs: 60_000, label: "webglcontextrestored" });
  const lost = await page.evaluate(() =>
    (window as unknown as { __ns: { world: { renderer: { getContext(): WebGL2RenderingContext } } } }).__ns.world.renderer
      .getContext()
      .isContextLost(),
  );
  expect(lost, "the context after the restore").toBe(false);
  await app.step(36);
  const after = await census();
  if (after.hash !== before.hash) {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    for (const [k, c] of [["before", before], ["after", after]] as const) {
      fs.writeFileSync(path.join(SHOTS_DIR, `context-restore-${k}.png`), Buffer.from(c.image!.split(",")[1] ?? "", "base64"));
    }
  }
  expect(after.hash, "the frame after the context came back").toBe(before.hash);
});
