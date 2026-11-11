import { type MeshBasicMaterial, SRGBColorSpace } from "@iwsdk/core";
import { describe, expect, it, vi } from "vitest";
import { COACH, CoachLine, CoachLineView, coachChars, LineHold, wrapCoach } from "../../src/ui/coach-line";
import { COPY } from "../../src/ui/copy";

const strings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];

/** A painter that records what it was asked to paint. */
function painter() {
  const painted: string[][] = [];
  return { painted, paint: (lines: readonly string[]) => void painted.push([...lines]) };
}

describe("wrapCoach", () => {
  const max = coachChars();

  it("keeps a short line whole", () => {
    expect(wrapCoach("Watch.", max)).toEqual(["Watch."]);
    expect(wrapCoach("Pick up the lantern.", max)).toEqual(["Pick up the lantern."]);
  });

  it("breaks between sentences where it can, else as evenly as the words allow", () => {
    expect(wrapCoach("One piece is missing. Your finger can cast it.", max)).toEqual(["One piece is missing.", "Your finger can cast it."]);
    expect(wrapCoach("This outline is hidden. What shape do the shadows make?", max)).toEqual([
      "This outline is hidden.",
      "What shape do the shadows make?",
    ]);
    const two = wrapCoach("Pull the drawer to find these lessons again.", max);
    expect(two).toHaveLength(2);
    expect(two.join(" ")).toBe("Pull the drawer to find these lessons again.");
    expect(Math.abs(two[0]!.length - two[1]!.length)).toBeLessThanOrEqual(8);
  });

  it("fits every lesson line and tip in two lines at the coach line's width", () => {
    expect(max).toBeGreaterThanOrEqual(30);
    for (const s of strings(COPY.lessons)) {
      const lines = wrapCoach(s, max);
      expect(lines.length, s).toBeLessThanOrEqual(COACH.maxLines);
      for (const l of lines) expect(l.length, s).toBeLessThanOrEqual(max);
      expect(lines.join(" "), s).toBe(s);
    }
  });
});

describe("CoachLine", () => {
  it("paints a line once, fades it in, and paints nothing more while it stays", () => {
    const p = painter(), c = new CoachLine(p);
    c.show(COPY.lessons.pickUp);
    c.update(0);
    expect(p.painted).toEqual([[COPY.lessons.pickUp]]);
    expect(c.text).toBe(COPY.lessons.pickUp);
    expect(c.opacity).toBe(0);
    c.update(COACH.fadeInMs / 2);
    expect(c.opacity).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 1000; i++) {
      c.show(COPY.lessons.pickUp);
      c.update(16);
    }
    expect(c.opacity).toBe(1);
    expect(p.painted).toHaveLength(1);
  });

  it("fades the old line out before painting the new one in", () => {
    const p = painter(), c = new CoachLine(p);
    c.show(COPY.lessons.watch);
    c.update(0);
    c.update(COACH.fadeInMs);
    c.show(COPY.lessons.yourTurn);
    c.update(COACH.fadeOutMs / 2);
    expect(c.opacity).toBeCloseTo(0.5, 6);
    expect(c.text).toBe(COPY.lessons.watch);
    expect(p.painted).toHaveLength(1);
    c.update(COACH.fadeOutMs / 2);
    expect(c.text).toBe(COPY.lessons.yourTurn);
    expect(p.painted).toEqual([[COPY.lessons.watch], [COPY.lessons.yourTurn]]);
    c.update(COACH.fadeInMs);
    expect(c.opacity).toBe(1);
  });

  it("skips a line replaced before it was ever shown, and fades out to nothing", () => {
    const p = painter(), c = new CoachLine(p);
    c.show(COPY.lessons.watch);
    c.update(0);
    c.update(COACH.fadeInMs);
    c.show(COPY.lessons.nearSwing);
    c.update(50);
    c.show(COPY.lessons.yourTurn);
    c.update(COACH.fadeOutMs);
    expect(p.painted).toEqual([[COPY.lessons.watch], [COPY.lessons.yourTurn]]);
    c.show(null);
    c.update(COACH.fadeInMs);
    c.update(COACH.fadeOutMs);
    expect(c.opacity).toBe(0);
    expect(c.text).toBeNull();
    expect(p.painted).toHaveLength(2);
    // Back to the same line it had: painted again (the canvas may have been reused meanwhile).
    c.show(COPY.lessons.yourTurn);
    c.update(16);
    expect(p.painted).toHaveLength(3);
  });

  it("comes back from part way through a fade out when the line it shows is asked for again", () => {
    const p = painter(), c = new CoachLine(p);
    c.show(COPY.lessons.watch);
    c.update(0);
    c.update(COACH.fadeInMs);
    c.show(null);
    c.update(COACH.fadeOutMs / 2);
    c.show(COPY.lessons.watch);
    c.update(16);
    expect(c.opacity).toBeGreaterThan(0.5);
    expect(p.painted).toHaveLength(1);
  });
});

describe("CoachLine: a new line's tick", () => {
  it("tells of each new line as it is painted, never of a repaint, a fade out or no line", () => {
    const told: string[] = [];
    const p = painter(), c = new CoachLine(p, (t) => told.push(t));
    c.show(COPY.lessons.watch);
    c.update(0);
    c.update(COACH.fadeInMs);
    expect(told).toEqual([COPY.lessons.watch]);
    // The same line asked for again, a repaint, a font arriving: nothing new.
    c.show(COPY.lessons.watch);
    c.update(16);
    c.repaint();
    c.relettered();
    c.update(16);
    expect(told).toEqual([COPY.lessons.watch]);
    // A new line: once, as it takes over (after the old one has faded out); none for the line going away.
    c.show(COPY.lessons.yourTurn);
    c.update(COACH.fadeOutMs / 2);
    expect(told).toHaveLength(1);
    c.update(COACH.fadeOutMs / 2);
    expect(told).toEqual([COPY.lessons.watch, COPY.lessons.yourTurn]);
    c.show(null);
    for (let i = 0; i < 40; i++) c.update(16);
    expect(told).toHaveLength(2);
  });
});

describe("LineHold", () => {
  it("shows a line at once and keeps it through short drops, so a line asked for on and off never flickers", () => {
    const h = new LineHold();
    expect(h.update(null, 16)).toBeNull();
    expect(h.update(COPY.game.controllerFinger, 16)).toBe(COPY.game.controllerFinger);
    // Asked for on and off every few frames (coverage crossing the gap's threshold): it stays up.
    for (let i = 0; i < 100; i++) expect(h.update(i % 3 === 0 ? null : COPY.game.controllerFinger, 16)).toBe(COPY.game.controllerFinger);
    // Gone for good: it goes once it has not been asked for for COACH.holdMs.
    let t = 0;
    while (h.update(null, 16) !== null) t += 16;
    // (The flicker loop's last frame was already a drop.)
    expect(t).toBeGreaterThanOrEqual(COACH.holdMs - 48);
    expect(t).toBeLessThanOrEqual(COACH.holdMs + 16);
    // A different line takes over at once.
    h.update(COPY.lessons.watch, 16);
    expect(h.update(COPY.lessons.yourTurn, 16)).toBe(COPY.lessons.yourTurn);
  });

  it("fits the session's controller line in two lines", () => {
    expect(wrapCoach(COPY.game.controllerFinger, coachChars())).toEqual(["Or set a controller down", "and use your finger."]);
  });
});

describe("CoachLineView", () => {
  it("builds without a 2D canvas (unit tests), sized in metres, and hides at opacity 0", () => {
    const v = new CoachLineView();
    v.paint(["Watch."]);
    v.opacity = 0;
    expect(v.object.visible).toBe(false);
    v.opacity = 0.6;
    expect(v.object.visible).toBe(true);
    v.setBoxSize(0.24);
    expect(v.object.scale.x).toBeCloseTo(1 / 0.24, 9);
  });

  it("fades its letters with the chip: the tint is the opacity as a display value, white at rest", () => {
    const v = new CoachLineView();
    const m = v.object.material as MeshBasicMaterial;
    v.opacity = 1;
    expect(m.color.getHex()).toBe(0xffffff);
    expect([m.color.r, m.color.g, m.color.b]).toEqual([1, 1, 1]);
    for (const a of [0.25, 0.5, 0.75]) {
      v.opacity = a;
      expect(m.opacity).toBe(a);
      // Linear in the material (the sRGB curve undone), so it reads `a` once encoded for display, as the blend sees it.
      expect(m.color.r).toBeCloseTo(((a + 0.055) / 1.055) ** 2.4, 6);
      expect(m.color.g).toBe(m.color.r);
      expect(m.color.b).toBe(m.color.r);
      const shown = m.color.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
      expect(shown.r).toBeCloseTo(a, 4);
    }
  });

  it("does the colour work only when the opacity changes (it is set every frame)", () => {
    const v = new CoachLineView();
    const m = v.object.material as MeshBasicMaterial;
    const tint = vi.spyOn(m.color, "setRGB");
    v.opacity = 0.5;
    v.opacity = 0.5;
    v.opacity = 0.5;
    expect(tint).toHaveBeenCalledTimes(1);
    expect([m.opacity, v.object.visible]).toEqual([0.5, true]);
    v.opacity = 0.75;
    expect(tint).toHaveBeenCalledTimes(2);
    expect(m.color.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace).r).toBeCloseTo(0.75, 4);
    v.opacity = 0;
    v.opacity = 0;
    expect(tint).toHaveBeenCalledTimes(3);
    expect([m.opacity, v.object.visible]).toEqual([0, false]);
    v.opacity = 1;
    expect(tint).toHaveBeenCalledTimes(4);
    expect([m.color.r, m.opacity, v.object.visible]).toEqual([1, 1, true]);
  });
});
