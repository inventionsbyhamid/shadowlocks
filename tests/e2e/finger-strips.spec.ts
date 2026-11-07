// A real finger fills every silhouette's finger strip, in its worst case: of every finger lock a silhouette makes in
// boxes 5 to 400, at every lock size the kinds use (0.29, 0.34 and the 0.46 breather), the one where the modelled
// finger (tests/unit/helpers/finger-model.ts) spills most. With the lantern on its spot and IWER's right index finger
// laid along the strip as perf-budget.spec.ts lays it (its last two bones centred on the gap, tip to the left, 0.5 from
// the panel), the lock must open. The shape rules alone do not show this: a strip much thinner than the finger's shadow
// lets the finger darken too much of the lit band round the outline (the rule allows 55%), and a thin strip between two
// wider parts cannot be filled at all. Logs each silhouette's worst spill by size, then each lock's coverage measured
// with the finger in against the model's. A silhouette that is never a finger lock fails by name.
import { generateBox } from "../../src/core/generator";
import { SILHOUETTES } from "../../src/core/shapes";
import type { Box, Lock } from "../../src/core/types";
import { fingerCoverage } from "../unit/helpers/finger-model";
import { axisOf, fingerLocks, onRay, Pointer, worldOf } from "./helpers/finger";
import { expect, test } from "./helpers/test";

const FINGER_Z = 0.5;
const LAST_BOX = 400;

interface Worst {
  n: number;
  lock: Lock;
  spill: number;
}

/** Each silhouette's finger locks in boxes 5 to LAST_BOX: the worst modelled spill by lock size, and the worst of all. */
function worstLocks(): { worst: Map<string, Worst>; bySize: Map<string, Map<number, Worst>> } {
  const worst = new Map<string, Worst>(), bySize = new Map<string, Map<number, Worst>>();
  for (let n = 5; n <= LAST_BOX; n++) {
    const box: Box = generateBox({ kind: "box", n });
    for (const lock of box.locks) {
      if (!lock.finger || !SILHOUETTES.includes(lock.shape)) continue;
      const w: Worst = { n, lock, spill: fingerCoverage(box, lock).spillAll };
      const sizes = bySize.get(lock.shape) ?? new Map<number, Worst>();
      if (w.spill > (sizes.get(lock.size)?.spill ?? -1)) sizes.set(lock.size, w);
      bySize.set(lock.shape, sizes);
      if (w.spill > (worst.get(lock.shape)?.spill ?? -1)) worst.set(lock.shape, w);
    }
  }
  return { worst, bySize };
}

test("a finger laid along each silhouette's strip opens its lock, in the silhouette's worst case", async ({ page, boot }) => {
  test.setTimeout(30 * 60_000);
  const { worst, bySize } = worstLocks();
  console.log(
    `modelled worst spill with a finger, by silhouette and lock size (boxes 5 to ${LAST_BOX}):\n` +
      [...bySize]
        .map(([name, s]) => `${name}: ${[...s].sort((a, b) => a[0] - b[0]).map(([size, w]) => `@${size} ${w.spill.toFixed(3)} (box ${w.n})`).join(", ")}`)
        .join("\n"),
  );
  const never = SILHOUETTES.filter((name) => !worst.has(name));
  expect(never, `silhouettes that are never a finger lock in boxes 5 to ${LAST_BOX}, so their strips go unproven`).toEqual([]);
  const app = await boot();
  const rows: string[] = [], failed: string[] = [];
  const hand = new Pointer(app, "right");
  for (const name of SILHOUETTES) {
    const { n, lock, spill } = worst.get(name)!;
    await page.evaluate((n) => window.__sl!.session.play({ kind: "box", n }), n);
    await app.stepUntil((_ns, w, k) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed && s.key === "shadow-locks/" + k;
    }, { arg: n, maxMs: 10_000, label: `box ${n} in play` });
    const f = (await fingerLocks(page)).find((x) => x.lock === lock.i);
    expect(f, `box ${n} lock ${lock.i} (${name}) is a finger lock in the browser too`).toBeTruthy();
    await page.evaluate((L) => window.__sl!.placeLantern(L), f!.spot);
    await app.step(3);
    const { mid, angle } = axisOf(f!.piece);
    const sign = Math.cos(angle) >= 0 ? -1 : 1;
    await hand.lay(onRay(f!.spot, mid, FINGER_Z), [sign * Math.cos(angle), sign * Math.sin(angle), 0]);
    await app.step(3);
    const c = (await fingerLocks(page)).find((x) => x.lock === lock.i)!;
    let opened = true;
    try {
      await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock.i, maxMs: 3_000, batch: 1, label: "open" });
    } catch {
      opened = false;
    }
    const cv = c.coverage;
    const row =
      `${name} @${lock.size} (box ${n} lock ${lock.i}): cover ${cv.cover.toFixed(3)} spill ${cv.spill.toFixed(3)} ` +
      `spillAll ${cv.spillAll.toFixed(3)} (model ${spill.toFixed(3)}) gap ${cv.gap.toFixed(3)} meets ${c.meets} -> ${opened ? "opened" : "NOT OPENED"}`;
    rows.push(row);
    if (!opened) failed.push(row);
    const [inBox, out] = await worldOf(page, [[0, 0, FINGER_Z], [0, 0, 1.6]]);
    await hand.shift([out![0] - inBox![0], out![1] - inBox![1], out![2] - inBox![2]]);
    await app.step(3);
  }
  console.log(rows.join("\n"));
  expect(failed).toEqual([]);
});
