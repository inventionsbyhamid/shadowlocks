import { describe, expect, it } from "vitest";
import { coachLines } from "../../src/ui/box-text";
import { COPY, fill } from "../../src/ui/copy";
import { expectCleanCopy } from "./helpers/ui";

describe("copy", () => {
  it("has no em or en dashes anywhere", () => {
    expectCleanCopy(COPY);
  });

  it("is short and plain: sentences end with a full stop, labels do not", () => {
    for (const s of Object.values(COPY.page)) expect(s).toMatch(/^[A-Z].*\.$/);
    for (const s of Object.values(COPY.notice)) expect(s).toMatch(/^[A-Z].*\.$/);
    for (const s of Object.values(COPY.settings)) {
      expect(s).not.toMatch(/\.$/);
      expect(s.length).toBeLessThanOrEqual(12);
    }
    for (const s of Object.values(COPY.captions)) {
      expect(s).not.toMatch(/\.$/);
      expect(s.length).toBeLessThanOrEqual(16);
    }
    // The box in play: short labels; the story line and "one piece short" are sentences.
    for (const s of [COPY.game.boxNo, COPY.game.daily, COPY.game.next, COPY.game.hint, COPY.game.showMe, COPY.game.practice]) {
      expect(s).not.toMatch(/\.$/);
      expect(s.length).toBeLessThanOrEqual(12);
    }
    for (const s of [COPY.game.storyOwner, COPY.game.storyLoot, COPY.game.short, COPY.game.controllerFinger]) expect(s).toMatch(/^[A-Z].*\.$/);
    expect(COPY.game.controllerFinger).toBe("Or set a controller down and use your finger.");
    expect(fill(COPY.game.boxNo, { n: 12 })).toBe("Box No. 12");
    expect(fill(COPY.game.storyOwner, { owner: "the Clockmaker" })).toBe("Off the desk of the Clockmaker.");
    expect(fill("{a} {b}", { a: 1 })).toBe("1 {b}");
    // The film's end card: a tagline sentence, short fact chips.
    expect(COPY.film.tagline).toMatch(/^[A-Z].*\.$/);
    for (const s of COPY.film.facts) {
      expect(s).not.toMatch(/\.$/);
      expect(s.length).toBeLessThanOrEqual(16);
    }
  });

  it("menus: key lines are short labels, messages are sentences", () => {
    const m = COPY.menus;
    // Second lines on keys fit a key: short, no full stop.
    for (const [k, v] of Object.entries(m.home)) {
      // A count is its plural forms: each a key line.
      for (const s of typeof v === "string" ? [v] : [v.one, v.other]) {
        if (k === "reset") expect(s).toMatch(/^[A-Z].*\.$/);
        else {
          expect(s, k).not.toMatch(/\.$/);
          expect(s.length, k).toBeLessThanOrEqual(18);
        }
      }
    }
    for (const s of Object.values(m.lessons)) {
      expect(s).not.toMatch(/\.$/);
      expect(s.length).toBeLessThanOrEqual(16);
    }
    expect(m.collection.page).toBe("{from} to {to} of {n}");
    for (const k of ["over", "bought", "failed"] as const) expect(m.trial[k]).toMatch(/^[A-Z].*\.$/);
    expect(m.trial.daysLeft).toEqual({ one: "Your trial: {n} day left", other: "Your trial: {n} days left" });
    expect(m.trial.unlock).toBe("Unlock the full game");
  });

  it("the landing page: one button, a tagline sentence that names the goal", () => {
    expect(COPY.landing.open).toBe("Open the box");
    expect(COPY.landing.tagline).toMatch(/^[A-Z].*\.$/);
    expect(COPY.landing.tagline).toBe("Move a lantern. Fill each lock with shadow.");
  });
});

/** Words as a voice would say them (a "No." or a number is one). */
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe("the coach lines", () => {
  // Every line the chip shows: the lessons' own, the tips, the session's suggestion, and a phone's and a controller's
  // wording of the lines about hands. A voice will say exactly these, so each stays short.
  const lines = coachLines(COPY);

  it("each is a short sentence: 12 words at most, ending with a full stop (or a question)", () => {
    expect(lines.length).toBeGreaterThan(30);
    for (const s of lines) {
      expect(words(s), s).toBeLessThanOrEqual(12);
      expect(s, s).toMatch(/^[A-Z].*[.?]$/);
    }
  });

  it("no two keys share a line: a line on the chip names its one copy key", () => {
    const lessonLines = (Object.values(COPY.lessons) as unknown[]).filter((v): v is string => typeof v === "string");
    expect(new Set(lessonLines).size).toBe(lessonLines.length);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("lesson 1 says its goal, names each win, and helps an idle player, word for word", () => {
    const L = COPY.lessons;
    expect({
      goal: L.goal,
      watchNearFar: L.watchNearFar,
      watchRings: L.watchRings,
      watchFinger: L.watchFinger,
      turnNearFar: L.turnNearFar,
      turnFinger: L.turnFinger,
      puppets: L.puppets,
      lockOpen: L.lockOpen,
      twoOpen: L.twoOpen,
      boxOpen: L.boxOpen,
      moveIdle: L.moveIdle,
      growShrink: L.growShrink,
      stuck: L.stuck,
      letGo: L.letGo,
      turnNearFarIdle: L.turnNearFarIdle,
      turnRingsIdle: L.turnRingsIdle,
      fingerIdle: L.fingerIdle,
    }).toEqual({
      goal: "Move the lantern until the shadow fills the moon.",
      watchNearFar: "Watch. I will borrow your lantern for a moment.",
      watchRings: "Watch. This key has two sight rings.",
      watchFinger: "Watch. This crown is one piece short.",
      turnNearFar: "Your turn. Make both pieces meet in the arrow.",
      turnFinger: "Your turn. Point one finger into the gap and hold still.",
      puppets: "Now put your free hand inside the box.",
      lockOpen: "Lock open! Every shape on the wall is a lock.",
      twoOpen: "Two locks open. One to go.",
      boxOpen: "The box is open. Lift out your reward.",
      moveIdle: "Find the gold moon outline. Slide the shadow onto it.",
      growShrink: "Bring it nearer or farther. The shadow grows and shrinks.",
      stuck: "Stuck? Poke the little lantern on the frame for help.",
      letGo: "Let go any time. The lantern floats where you leave it.",
      turnNearFarIdle: "Move side to side. Watch which piece swings more.",
      turnRingsIdle: "Move until one ring shadow sits inside the other.",
      fingerIdle: "Move your finger nearer or farther until it fits.",
    });
    // The "Move the light" example still says what it shows.
    expect(L.watchMove).toBe("Watch the shadows move.");
  });

  it("a phone and a controller say the lines about hands their own way", () => {
    expect(COPY.phone).toMatchObject({
      turnFinger: "Your turn. Touch the gap and hold still.",
      growShrink: "Move the phone nearer or farther. The shadow grows and shrinks.",
      stuck: "Stuck? Tap the little lantern on the frame for help.",
      letGo: "Lift your finger any time. The lantern stays where you leave it.",
      boxOpen: "The box is open. Tap your reward to take it.",
    });
    expect(COPY.controller).toEqual({
      puppets: "Set a controller down and put that hand inside the box.",
      turnFinger: "Your turn. Aim a controller into the gap and hold still.",
    });
  });
});
