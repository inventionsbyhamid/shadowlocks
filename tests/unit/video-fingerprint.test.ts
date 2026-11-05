import { describe, expect, it } from "vitest";
import type { SlFrameState } from "../../src/app/test-api";
import { type FrameHand, frameFingerprint } from "../video/lib/page-video";

const HANDS: FrameHand[] = [
  { side: "left", p: [-0.45, 0.7, -1.3], q: [0, 0, 0, 1] },
  { side: "right", p: [0.45, 0.7, -1.3], q: [0, 0.7071, 0, 0.7071] },
];
const GAME: SlFrameState = { boxKey: "box/3", lantern: [0.1234, 0.2, 0.61], openLocks: [0, 2], screen: "play" };
const fp = (o: { now?: number; screen?: string; game?: unknown; hands?: FrameHand[]; events?: unknown[] } = {}) =>
  frameFingerprint(o.now ?? 30_016.667, o.screen ?? "play", "game" in o ? o.game : GAME, o.hands ?? HANDS, o.events ?? []);

describe("frame fingerprint", () => {
  it("is 8 hex characters and the same for the same frame", () => {
    expect(fp()).toMatch(/^[0-9a-f]{8}$/);
    expect(fp()).toBe(fp());
    expect(fp({ game: { ...GAME, openLocks: [...GAME.openLocks] } })).toBe(fp());
  });

  it("works while the hook has no box (null), and with no hook at all", () => {
    const none = fp({ game: null, screen: "home" });
    expect(none).toMatch(/^[0-9a-f]{8}$/);
    expect(fp({ game: undefined, screen: "home" })).toBe(none);
    // A box in play is a different state from no box.
    expect(fp({ screen: "home" })).not.toBe(none);
  });

  it("does not throw on a half-filled game state", () => {
    expect(fp({ game: {} })).toMatch(/^[0-9a-f]{8}$/);
    expect(fp({ game: { boxKey: "box/1", lantern: "x", openLocks: null } })).toMatch(/^[0-9a-f]{8}$/);
    expect(fp({ game: { boxKey: "box/1", lantern: [Number.NaN, 0, 0], openLocks: [] } })).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes with the box, the lantern, the open locks, the screen, the time, the hands and the events", () => {
    const base = fp();
    const changed = [
      fp({ game: { ...GAME, boxKey: "box/4" } }),
      fp({ game: { ...GAME, lantern: [0.1244, 0.2, 0.61] } }),
      fp({ game: { ...GAME, openLocks: [0] } }),
      fp({ game: { ...GAME, screen: "home" } }),
      fp({ screen: "home" }),
      fp({ now: 30_033.333 }),
      fp({ hands: [HANDS[0]!, { ...HANDS[1]!, p: [0.451, 0.7, -1.3] }] }),
      fp({ hands: [HANDS[0]!] }),
      fp({ events: [{ type: "press", id: "start" }] }),
    ];
    for (const h of changed) expect(h).not.toBe(base);
    expect(new Set(changed).size).toBe(changed.length);
  });

  it("ignores float noise far below what shows", () => {
    expect(fp({ game: { ...GAME, lantern: [0.12340001, 0.2, 0.61] } })).toBe(fp());
    expect(fp({ hands: [HANDS[0]!, { ...HANDS[1]!, p: [0.4500001, 0.7, -1.3] }] })).toBe(fp());
  });

  it("is self-contained, so the page can run it from its source", () => {
    // What videoPrepare does in the page: no imports or outer names may be left in it.
    const inPage = (0, eval)(`(${frameFingerprint.toString()})`) as typeof frameFingerprint;
    expect(inPage(30_016.667, "play", GAME, HANDS, [])).toBe(fp());
    expect(inPage(1000, "home", null, [], [])).toBe(frameFingerprint(1000, "home", null, [], []));
  });
});
