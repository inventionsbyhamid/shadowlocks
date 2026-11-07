// The hidden-overdraw trims (src/render/box-scene.ts, src/ui/panel-slab.ts) on the project's own Quest 3 profile: the
// back slab's front face, which the panel covers, left out of the frame; the velvet floor drawn ahead of the frame, so
// the plinth's top under it is never shaded; the menu slabs drawn ahead of the box. Each moment's frame is drawn and
// counted (src/app/gpu-census.ts) with the trims and without them (__ns.scene.trims), the game standing still in
// between: the pixels must be the same, and the lacquer (the scene's most expensive shader) must shade less. On this
// profile the session also keeps asking for 90 Hz (src/app/headset.ts).
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { Census } from "../../src/app/gpu-census";
import { QUEST2_EYE } from "./helpers/headset";
import { expect, test } from "./helpers/test";
import { addRunNote, SHOTS_DIR, type XrApp } from "./helpers/xr-app";

/** Half Quest 2's eye buffer and its view (the trims' effect is a share of the eye, the same on any headset). */
const VIEW = { width: QUEST2_EYE.width / 2, height: QUEST2_EYE.height / 2, fov: QUEST2_EYE.fov };

const fragmentsOf = (c: Census, name: string) => c.draws.filter((d) => d.name === name).reduce((s, d) => s + d.fragments, 0);
const total = (c: Census) => c.draws.reduce((s, d) => s + d.fragments, 0);

async function compare(page: Page, moment: string): Promise<{ frameOn: number; frameOff: number }> {
  const census = (image: boolean) => page.evaluate((o) => window.__ns!.gpu.census(o), { ...VIEW, image });
  const on = await census(true);
  await page.evaluate(() => window.__ns!.scene.trims(false));
  const off = await census(true);
  await page.evaluate(() => window.__ns!.scene.trims(true));
  const px = VIEW.width * VIEW.height;
  const share = (n: number) => `${((100 * n) / px).toFixed(2)}%`;
  const frameOn = fragmentsOf(on, "Box Frame"), frameOff = fragmentsOf(off, "Box Frame");
  const line =
    `hidden overdraw, ${moment}: lacquer frame ${share(frameOff)} of the eye shaded before, ${share(frameOn)} with the trims; ` +
    `all draws ${share(total(off))} before, ${share(total(on))} after; pixels ${on.hash === off.hash ? "the same" : "DIFFERENT"} (${on.hash})`;
  console.log(line);
  addRunNote(line);
  if (on.hash !== off.hash) {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    for (const [k, c] of [["on", on], ["off", off]] as const) {
      fs.writeFileSync(path.join(SHOTS_DIR, `overdraw-${moment}-${k}.png`), Buffer.from(c.image!.split(",")[1] ?? "", "base64"));
    }
  }
  expect(on.hash, `${moment}: the trims change no pixel`).toBe(off.hash);
  return { frameOn, frameOff };
}

async function inPlay(app: XrApp, n: number): Promise<void> {
  await app.page.evaluate((k) => window.__sl!.session.play({ kind: "box", n: k }), n);
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: `box ${n} in play` },
  );
}

test("the hidden-overdraw trims change no pixel and shade less lacquer: Home, Settings, box 15 in play, box 1 opening", async ({ page, boot }) => {
  const app = await boot();
  // The project's Quest 3 profile keeps the standard path: 90 Hz asked for (the older Quests' 72 Hz is theirs only).
  expect(await page.evaluate(() => window.__ns!.headset())).toMatchObject({ class: "standard", frameRate: 90 });
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 5_000, label: "home at rest" });
  await app.step(36);
  const home = await compare(page, "home");
  await page.evaluate(() => window.__ns!.ui.go("settings"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 5_000, label: "settings at rest" });
  await app.step(36);
  await compare(page, "settings");
  await inPlay(app, 15);
  await page.evaluate(() => window.__sl!.placeLantern([0.05, -0.1, 1.25]));
  await app.step(36);
  const play = await compare(page, "box15-in-play");
  await inPlay(app, 1);
  const s = (await page.evaluate(() => window.__sl!.session.state()))!;
  await page.evaluate((L) => window.__sl!.placeLantern(L), s.locks[0]!.spot);
  await app.stepUntil((_ns, w) => w.__ns.events("box-open").length > 0, { maxMs: 4_000, dt: 100, label: "the box opens" });
  for (let t = 0; t < 1400; t += 100) await app.step(1, 100);
  await compare(page, "box1-opening");
  // In play the panel's slab and the plinth's top went unseen; at Home the menu panel hides the box's lower half too.
  expect(play.frameOn).toBeLessThan(play.frameOff * 0.75);
  expect(home.frameOn).toBeLessThan(home.frameOff * 0.75);
});
