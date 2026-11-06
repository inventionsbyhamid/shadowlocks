import { describe, expect, it } from "vitest";
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
});
