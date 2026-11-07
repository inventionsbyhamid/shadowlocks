// A real finger fills every silhouette's finger strip: in the first box where each silhouette is a finger lock, the
// lantern on its spot and IWER's right index finger laid along the strip as perf-budget.spec.ts lays it (its last two
// bones centred on the gap, tip to the left, 0.5 from the panel). The lock must open. The shape rules alone do not
// show this: a strip much thinner than the finger's shadow lets the finger darken too much of the lit band round the
// outline (the rule allows 55%), and a thin strip between two wider parts cannot be filled at all. Logs each lock's
// coverage with the finger in.
import { generateBox } from "../../src/core/generator";
import { SILHOUETTES } from "../../src/core/shapes";
import { axisOf, fingerLocks, onRay, Pointer, worldOf } from "./helpers/finger";
import { expect, test } from "./helpers/test";

const FINGER_Z = 0.5;

test("a finger laid along each silhouette's strip opens its lock", async ({ page, boot }) => {
  test.setTimeout(30 * 60_000);
  const app = await boot();
  const rows: string[] = [], failed: string[] = [];
  const hand = new Pointer(app, "right");
  for (const name of SILHOUETTES) {
    let n = 5;
    while (n < 400 && !generateBox({ kind: "box", n }).locks.some((l) => l.shape === name && l.finger)) n++;
    const lock = generateBox({ kind: "box", n }).locks.find((l) => l.shape === name && l.finger)!;
    await page.evaluate((n) => window.__sl!.session.play({ kind: "box", n }), n);
    await app.stepUntil((_ns, w, k) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed && s.key === "shadow-locks/" + k;
    }, { arg: n, maxMs: 10_000, label: `box ${n} in play` });
    const f = (await fingerLocks(page)).find((x) => x.lock === lock.i)!;
    await page.evaluate((L) => window.__sl!.placeLantern(L), f.spot);
    await app.step(3);
    const { mid, angle } = axisOf(f.piece);
    const sign = Math.cos(angle) >= 0 ? -1 : 1;
    await hand.lay(onRay(f.spot, mid, FINGER_Z), [sign * Math.cos(angle), sign * Math.sin(angle), 0]);
    await app.step(3);
    const c = (await fingerLocks(page)).find((x) => x.lock === lock.i)!;
    let opened = true;
    try {
      await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock.i, maxMs: 3_000, batch: 1, label: "open" });
    } catch {
      opened = false;
    }
    const cv = c.coverage;
    const row = `${name} (box ${n} lock ${lock.i}): cover ${cv.cover.toFixed(3)} spill ${cv.spill.toFixed(3)} spillAll ${cv.spillAll.toFixed(3)} gap ${cv.gap.toFixed(3)} meets ${c.meets} -> ${opened ? "opened" : "NOT OPENED"}`;
    rows.push(row);
    if (!opened) failed.push(row);
    const [inBox, out] = await worldOf(page, [[0, 0, FINGER_Z], [0, 0, 1.6]]);
    await hand.shift([out![0] - inBox![0], out![1] - inBox![1], out![2] - inBox![2]]);
    await app.step(3);
  }
  console.log(rows.join("\n"));
  expect(failed).toEqual([]);
});
