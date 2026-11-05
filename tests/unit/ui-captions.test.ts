import { describe, expect, it } from "vitest";
import { CAPTIONS, CaptionQueue, captionFor, captionPlace, chipWidthMm, layoutCaptions } from "../../src/ui/captions";
import { COPY } from "../../src/ui/copy";
import { expectCleanCopy } from "./helpers/ui";

const run = (q: CaptionQueue, seconds: number, dt = 1 / 72) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) q.step(dt);
};
const shown = (q: CaptionQueue) => q.slots.filter((s) => s.active).map((s) => s.text);

describe("caption places", () => {
  it("lock sounds by the lock, lantern sounds by the lantern, the rest in the middle", () => {
    expect(captionPlace("brass_clunk")).toBe("lock");
    expect(captionPlace("ring_chime")).toBe("lock");
    expect(captionPlace("crystallise")).toBe("lock");
    expect(captionPlace("lantern_pick")).toBe("lantern");
    expect(captionPlace("dial_tick")).toBe("lantern");
    expect(captionPlace("walls_hinge")).toBe("centre");
    expect(captionPlace("hint_reveal")).toBe("centre");
  });
});

describe("caption queue", () => {
  it("fades in over 300 ms, holds, fades out over 300 ms, then frees its slot", () => {
    expect(CAPTIONS.fadeS).toBe(0.3);
    const q = new CaptionQueue();
    q.push("walls_hinge", "Box opens", 0);
    run(q, 0.15);
    expect(q.slots[0]!.alpha).toBeCloseTo(0.5, 1);
    run(q, 0.2);
    expect(q.slots[0]!.alpha).toBe(1);
    run(q, CAPTIONS.holdS);
    expect(q.slots[0]!.alpha).toBeLessThan(1);
    expect(q.slots[0]!.active).toBe(true);
    run(q, 0.35);
    expect(shown(q)).toEqual([]);
  });

  it("never shows more than two: a third waits for the oldest to fade out from where it is", () => {
    const q = new CaptionQueue();
    q.push("brass_clunk", "Lock open", 0);
    run(q, 0.1);
    q.push("hint_reveal", "Hint", 0);
    run(q, 0.1);
    const clunk = q.slots.find((s) => s.text === "Lock open")!;
    const before = clunk.alpha;
    q.push("ring_chime", "Rings line up", 0);
    expect(shown(q).sort()).toEqual(["Hint", "Lock open"]);
    expect(q.slots.length).toBe(2);
    // Lock open goes down from its alpha (no snap) over at most 300 ms, then Rings line up comes in.
    q.step(1 / 72);
    expect(clunk.alpha).toBeLessThan(before);
    expect(clunk.alpha).toBeGreaterThan(before - 0.1);
    run(q, before * CAPTIONS.fadeS);
    expect(shown(q).sort()).toEqual(["Hint", "Rings line up"]);
    expect(q.slots.find((s) => s.text === "Rings line up")!.alpha).toBeLessThan(0.2);
  });

  it("four inside 300 ms: the one pushed out is the oldest by start, a refresh counting as new", () => {
    const q = new CaptionQueue();
    q.push("brass_clunk", "Lock open", 0);
    run(q, 0.05);
    q.push("hint_reveal", "Hint", 0);
    run(q, 0.05);
    // Lock open again while still fading in: its age stays the larger, but it is now the newer of the two.
    q.push("brass_clunk", "Lock open", 0);
    run(q, 0.05);
    q.push("ring_chime", "Rings line up", 0);
    expect(q.slots.find((s) => s.next)?.text).toBe("Hint");
    run(q, 0.4);
    expect(shown(q).sort()).toEqual(["Lock open", "Rings line up"]);
  });

  it("five inside 300 ms: two that waited keep their push order, so the older of them goes next", () => {
    const q = new CaptionQueue();
    q.push("brass_clunk", "Lock open", 0);
    run(q, 0.02);
    q.push("hint_reveal", "Hint", 0);
    run(q, 0.02);
    q.push("ring_chime", "Rings line up", 0);
    run(q, 0.02);
    q.push("walls_hinge", "Box opens", 0);
    // Lock open and Hint fade out from low opacity; Rings line up, then Box opens, come in.
    run(q, 0.09);
    expect(shown(q).sort()).toEqual(["Box opens", "Rings line up"]);
    const rings = q.slots.find((s) => s.text === "Rings line up")!;
    const target = q.slots.find((s) => s.text === "Box opens")!;
    expect(rings.started).toBeLessThan(target.started);
    q.push("daily_streak", "Streak", 0);
    expect(rings.next?.text).toBe("Streak");
    run(q, 0.4);
    expect(shown(q).sort()).toEqual(["Box opens", "Streak"]);
  });

  it("a fourth pushes out the other one; the newest two end up shown", () => {
    const q = new CaptionQueue();
    q.push("brass_clunk", "Lock open", 0);
    run(q, 0.5);
    q.push("hint_reveal", "Hint", 0);
    run(q, 0.5);
    q.push("ring_chime", "Rings line up", 0);
    q.push("walls_hinge", "Box opens", 0);
    run(q, 0.7);
    expect(shown(q).sort()).toEqual(["Box opens", "Rings line up"]);
  });

  it("the same words again refresh the caption instead of stacking", () => {
    const q = new CaptionQueue();
    q.push("crystallise", "Piece formed", 0.15);
    run(q, CAPTIONS.holdS);
    q.push("crystallise", "Piece formed", 0.15);
    expect(shown(q)).toEqual(["Piece formed"]);
    run(q, CAPTIONS.holdS * 0.9);
    expect(shown(q)).toEqual(["Piece formed"]);
    expect(q.slots.find((s) => s.active)!.alpha).toBe(1);
  });

  it("a refresh while fading out comes back up from where it is, without a jump", () => {
    const q = new CaptionQueue();
    q.push("crystallise", "Piece formed", 0);
    run(q, CAPTIONS.fadeS + CAPTIONS.holdS + 0.15);
    const s = q.slots.find((x) => x.active)!;
    const low = s.alpha;
    expect(low).toBeGreaterThan(0.3);
    expect(low).toBeLessThan(0.7);
    q.push("crystallise", "Piece formed", 0);
    q.step(1 / 72);
    expect(s.alpha).toBeGreaterThan(low);
    expect(s.alpha).toBeLessThan(low + 0.1);
    run(q, 0.3);
    expect(s.alpha).toBe(1);
  });

  it("a refresh in the fade in keeps fading in; one brought back hands its wait to the other", () => {
    const q = new CaptionQueue();
    q.push("brass_clunk", "Lock open", 0);
    run(q, 0.1);
    const clunk = q.slots.find((x) => x.text === "Lock open")!;
    const a = clunk.alpha;
    q.push("brass_clunk", "Lock open", 0);
    expect(clunk.alpha).toBe(a);
    q.push("hint_reveal", "Hint", 0);
    run(q, 0.4);
    // Rings line up pushes Lock open (the oldest) out; Lock open again brings it back, so Hint makes way instead.
    q.push("ring_chime", "Rings line up", 0);
    q.step(1 / 72);
    expect(clunk.next?.text).toBe("Rings line up");
    q.push("brass_clunk", "Lock open", 0);
    expect(clunk.next).toBeNull();
    run(q, 0.4);
    expect(shown(q).sort()).toEqual(["Lock open", "Rings line up"]);
  });

  it("clear drops everything (captions turned off, or play ended)", () => {
    const q = new CaptionQueue();
    q.push("brass_clunk", "Lock open", 0);
    q.clear();
    expect(shown(q)).toEqual([]);
  });

  it("no motion: alpha only depends on time (reduced motion keeps the same fades)", () => {
    const q = new CaptionQueue();
    q.push("walls_hinge", "Box opens", 0);
    run(q, 0.3);
    expect(q.slots[0]!.alpha).toBeCloseTo(1, 1);
  });
});

describe("caption layout", () => {
  it("estimates chip widths from the words, the dot, padding and border", () => {
    expect(chipWidthMm("Lock open")).toBeLessThan(chipWidthMm("Rings line up"));
    // No words: padding 10 and border 1 each side, dot 5 and the 6 mm gap after it.
    expect(chipWidthMm("")).toBe(33);
    expect(chipWidthMm("Hint")).toBeCloseTo(33 + 4 * 11 * 0.6, 6);
  });

  it("keeps each caption near its place, inside the strip, and pushes two apart when they would touch", () => {
    const out = new Float64Array(2);
    layoutCaptions(0, 40, false, 0, 0, 120, 8, out);
    expect(out[0]).toBe(0);
    layoutCaptions(500, 40, false, 0, 0, 120, 8, out);
    expect(out[0]).toBe(100);
    layoutCaptions(0, 60, true, 10, 50, 120, 8, out);
    expect(Math.abs(out[1]! - out[0]!)).toBeGreaterThanOrEqual(55 - 1e-9);
    expect(out[0]! - 30).toBeGreaterThanOrEqual(-120 - 1e-9);
    expect(out[1]! + 25).toBeLessThanOrEqual(120 + 1e-9);
  });
});

describe("which sounds get a caption", () => {
  it("only the meaningful ones: a lock opens, the box opens, a hint, the rings line up, in the game's own words", () => {
    expect(captionFor("brass_clunk")).toBe(COPY.captions.lockOpen);
    expect(captionFor("walls_hinge")).toBe(COPY.captions.boxOpens);
    expect(captionFor("hint_reveal")).toBe(COPY.captions.hint);
    expect(captionFor("ring_chime")).toBe(COPY.captions.ringsLine);
    for (const id of ["glass_tick", "mb_g5", "crystallise", "gentle_error", "daily_streak", "reward_lift", "collection_drop", "ui_press", "lock_hum"]) {
      expect(captionFor(id), id).toBeNull();
    }
    expect(COPY.captions.lockOpen).toBe("Lock opens");
    expectCleanCopy(["brass_clunk", "walls_hinge", "hint_reveal", "ring_chime"].map(captionFor));
  });
});
