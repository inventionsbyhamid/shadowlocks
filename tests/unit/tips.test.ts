import { describe, expect, it } from "vitest";
import { tipDone, tipFor, TIP_FROM, TIP_LINES, tipLock } from "../../src/app/tips";
import { generateBox } from "../../src/core/generator";
import { LESSON_1, LESSON_2 } from "../../src/core/lessons-data";
import type { TipId } from "../../src/core/profile";
import type { Box } from "../../src/core/types";
import { COPY } from "../../src/ui/copy";

const box = (n: number): Box => generateBox({ kind: "box", n });
const daily = generateBox({ kind: "daily", day: "2026-11-06" });

describe("tipFor", () => {
  it("shows decoys at box 2, a lock without rings at box 4 and a hidden outline at box 5, each once", () => {
    expect(TIP_FROM).toEqual({ decoys: 2, ringless: 4, hidden: 5 });
    expect(tipFor(box(1), [])).toBeNull();
    expect(tipFor(box(2), [])).toBe("decoys");
    expect(tipFor(box(2), ["decoys"])).toBeNull();
    expect(tipFor(box(3), ["decoys"])).toBeNull();
    expect(tipFor(box(4), ["decoys"])).toBe("ringless");
    expect(tipFor(box(4), ["decoys", "ringless"])).toBeNull();
    expect(tipFor(box(5), ["decoys", "ringless"])).toBe("hidden");
    expect(tipFor(box(6), ["decoys", "ringless", "hidden"])).toBeNull();
    // The drawer is lesson 2's to teach, never a box's tip.
    for (let n = 1; n <= 12; n++) expect(tipFor(box(n), ["decoys", "ringless", "hidden"])).toBeNull();
  });

  it("shows one tip a box, the earliest unseen, to a player who skipped ahead (a field flag, the Daily Box)", () => {
    expect(tipFor(box(5), [])).toBe("decoys");
    expect(tipFor(box(5), ["decoys"])).toBe("ringless");
    expect(tipFor(box(9), ["decoys", "ringless"])).toBe("hidden");
    expect(tipFor(daily, [])).toBe("decoys");
    expect(tipFor(daily, ["decoys", "ringless"])).toBe("hidden");
  });

  it("never shows a tip in a lesson, nor one the box gives no reason for", () => {
    expect(tipFor(LESSON_1, [])).toBeNull();
    expect(tipFor(LESSON_2, [])).toBeNull();
    const plain: Box = { ...box(5), elements: box(5).elements.filter((e) => e.kind !== "decoy"), locks: box(5).locks.map((l) => ({ ...l, rings: true, hidden: false })) };
    expect(tipFor(plain, [])).toBeNull();
  });
});

describe("tips", () => {
  it("say each tip in the game's words", () => {
    const want: Record<TipId, string> = {
      decoys: "Each lock has its own spot. Some scraps belong to none.",
      ringless: "No rings here. Read the shadows.",
      hidden: "This outline is hidden. What shape do the shadows make?",
      drawer: COPY.lessons.drawer,
    };
    expect(TIP_LINES).toEqual(want);
  });

  it("point at the lock a tip is about, and count it done once the player has done it", () => {
    const b4 = box(4), b5 = box(5);
    const ringless = b4.locks.find((l) => !l.rings)!.i, hidden = b5.locks.find((l) => l.hidden)!.i;
    expect(tipLock("ringless", b4)).toBe(ringless);
    expect(tipLock("hidden", b5)).toBe(hidden);
    expect(tipLock("decoys", b4)).toBe(-1);
    const open = new Set<number>();
    const isOpen = (l: number) => open.has(l);
    expect(tipDone("decoys", b4, isOpen)).toBe(false);
    expect(tipDone("ringless", b4, isOpen)).toBe(false);
    open.add(ringless === 0 ? 1 : 0);
    // Any lock opened shows the decoys were read past; the ringless tip waits for its own lock.
    expect(tipDone("decoys", b4, isOpen)).toBe(true);
    expect(tipDone("ringless", b4, isOpen)).toBe(false);
    open.add(ringless);
    expect(tipDone("ringless", b4, isOpen)).toBe(true);
    expect(tipDone("hidden", b5, () => false)).toBe(false);
    expect(tipDone("hidden", b5, (l) => l === hidden)).toBe(true);
    expect(tipDone("drawer", b5, () => true)).toBe(false);
  });
});
