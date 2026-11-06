// Shared setup for shots of a box in play (the store listing's inline media): the menus away, a numbered box in
// the lap, and where its locks, spots and missing piece are. The box is the generator's own (the page builds the
// same one from the same number), so the shots know a lock's spot and a finger lock's missing piece in box units.
// Part of every shot's frame version (lib/version.ts FRAME_INPUTS).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Page } from "@playwright/test";
import { generateBox } from "../../../src/core/generator";
import type { V3, Vec3 } from "../../../src/core/types";
import type { XrApp } from "../../e2e/helpers/xr-app";

/** From any screen: the menus away and box `n` shown in the lap, its lantern at the start. */
export async function showBox(app: XrApp, page: Page, n: number): Promise<void> {
  await page.evaluate(() => (window as any).__ns.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  await page.evaluate((k) => (window as any).__ns.scene.show({ n: k }), n);
  await app.step(2);
}

/** Box units to world metres for the box in play. */
export async function toWorld(page: Page, p: readonly [number, number, number]): Promise<Vec3> {
  const [w] = (await page.evaluate((q) => (window as any).__ns.scene.toWorld([q]), [p[0], p[1], p[2]] as V3)) as Vec3[];
  return w!;
}

/** The lantern's position now, box units. */
export const lanternPos = async (page: Page): Promise<V3> => (await page.evaluate(() => (window as any).__sl.lantern().pos)) as V3;

/** A lock of box `n` the lantern alone opens: its index and spot. */
export function plainLock(n: number): { lock: number; spot: V3 } {
  const box = generateBox({ kind: "box", n });
  const l = box.locks.find((x) => !x.finger);
  if (!l) throw new Error(`box ${n} has no lock the lantern alone opens`);
  return { lock: l.i, spot: [...l.L] as V3 };
}

/** Box `n`'s finger lock: its spot, and the centre of the piece the box leaves out (where the fingertip goes). */
export function fingerLock(n: number): { lock: number; spot: V3; tip: V3 } {
  const box = generateBox({ kind: "box", n });
  const l = box.locks.find((x) => x.finger);
  if (!l) throw new Error(`box ${n} has no finger lock`);
  const piece = box.elements.find((e) => e.kind === "piece" && e.lock === l.i && e.missing);
  if (!piece || piece.kind !== "piece") throw new Error(`box ${n} lock ${l.i} has no missing piece`);
  const c: V3 = [0, 0, 0];
  const n3 = piece.verts.length;
  for (const v of piece.verts) {
    c[0] += v[0] / n3;
    c[1] += v[1] / n3;
    c[2] += v[2] / n3;
  }
  return { lock: l.i, spot: [...l.L] as V3, tip: c };
}

/** Open lock `k` in gold unless the game already did (a later build opens it by itself; this keeps the shot whole). */
export async function openIfShut(page: Page, k: number): Promise<boolean> {
  return page.evaluate((i) => {
    const sl = (window as any).__sl;
    if ((sl.panelState().open[i] ?? 0) >= 0.5) return false;
    sl.setOpen(i, true);
    return true;
  }, k);
}

export const offset = (p: Vec3, dx: number, dy: number, dz: number): Vec3 => [p[0] + dx, p[1] + dy, p[2] + dz];
