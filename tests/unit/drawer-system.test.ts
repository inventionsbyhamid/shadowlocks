// The menu drawer in the app: a controller (its trigger is its pinch, at its grip) pulls the drawer in
// a box 24 cm wide whose root is the box placement; the drawer follows, springs back from a short
// pull, opens past 4 cm (Home comes up), and the lantern is put away under every menu.
import { Group, Quaternion, Vector3 } from "@iwsdk/core";
import { afterEach, describe, expect, it } from "vitest";
import { on } from "../../src/app/bus";
import { MenuDrawer } from "../../src/app/drawer-system";
import { go, screens } from "../../src/app/screens";
import type { Vec3 } from "../../src/core/types";
import type { HandPinch } from "../../src/input/grab-system";
import type { HandJoints } from "../../src/input/hand-joints";
import { DRAWER } from "../../src/render/drawer";
import { DRAWER_X, REWARD_DRAWER } from "../../src/render/fx/box-open";

const pin = (): HandPinch => ({ kind: "controller", tracked: true, pinching: false, edge: null, point: new Vector3(0, 0, 5), anchor: new Vector3(), rot: new Quaternion() });
const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
  if (screens.current() !== "play") go("play");
});

function bench() {
  const root = new Group();
  root.position.set(0, 1, -0.6);
  root.scale.setScalar(0.24);
  root.updateMatrixWorld(true);
  const pins: [HandPinch, HandPinch] = [pin(), pin()];
  const said: string[] = [];
  const drawer = new MenuDrawer({
    root,
    reducedMotion: () => false,
    pinches: pins,
    joints: {} as HandJoints,
    pulled: (_at: Vec3, hand) => said.push(`pulled ${hand}`),
    menuOpen: (open) => said.push(`menu ${open}`),
    away: (away) => said.push(`away ${away}`),
  });
  // Play, as the drawer hears it (from a menu: the lantern back), then a clean record.
  if (screens.current() !== "home") go("home");
  go("play");
  said.length = 0;
  offs.push(on("screen", (e) => said.push(`screen ${e.to}`)));
  let t = 0;
  const handle = () => drawer.view.handle(new Vector3()).applyMatrix4(root.matrixWorld);
  const right = pins[1];
  /** One frame of the right controller at `p`, trigger down or up. */
  const frame = (p: Vector3, trigger: boolean) => {
    right.point.copy(p);
    right.pinching = trigger;
    t += 1000 / 72;
    drawer.update(t);
  };
  return { drawer, said, handle, frame, root };
}

describe("the plinth's two drawers", () => {
  it("the reward drawer (either side) never overlaps the menu drawer, and both stay inside the plinth", () => {
    const rewardInner = DRAWER_X - REWARD_DRAWER.w / 2;
    const rewardOuter = DRAWER_X + REWARD_DRAWER.w / 2;
    expect(rewardInner).toBeGreaterThanOrEqual(DRAWER.w / 2);
    // The plinth is 1.1 box units wide.
    expect(rewardOuter).toBeLessThanOrEqual(0.55);
  });
});

describe("MenuDrawer", () => {
  it("springs back from a short pull, opens past 4 cm and raises Home, and shuts when play comes back", () => {
    const b = bench();
    const h = b.handle();
    b.frame(h, false);
    b.frame(h, true);
    expect(b.drawer.pull.state).toBe("opening");
    // 2 cm toward the player (the box faces +z here): the drawer follows the hand, in box units.
    for (let i = 1; i <= 10; i++) b.frame(h.clone().add(new Vector3(0, 0, 0.002 * i)), true);
    expect(b.drawer.view.out).toBeCloseTo(0.02 / 0.24, 3);
    // Let go: it slides back shut.
    for (let i = 0; i < 3; i++) b.frame(h.clone().add(new Vector3(0, 0, 0.02)), false);
    expect(b.drawer.pull.state).toBe("closed");
    for (let i = 0; i < 72; i++) b.frame(new Vector3(0, 0, 5), false);
    expect(b.drawer.view.out).toBe(0);
    expect(b.said).toEqual([]);

    // A full pull: open, Home, the lantern put away, the menu sound.
    const h2 = b.handle();
    b.frame(h2, false);
    b.frame(h2, true);
    for (let i = 1; i <= 10; i++) b.frame(h2.clone().add(new Vector3(0, 0, 0.005 * i)), true);
    expect(b.drawer.pull.state).toBe("open");
    expect(screens.current()).toBe("home");
    expect(b.said).toEqual(["pulled right", "away true", "menu true", "screen home"]);
    for (let i = 0; i < 72; i++) b.frame(new Vector3(0, 0, 5), false);
    expect(b.drawer.view.out).toBe(DRAWER.out);
    // Another menu keeps it open; play shuts it and brings the lantern back.
    go("settings");
    expect(b.drawer.pull.state).toBe("open");
    go("play");
    expect(b.drawer.pull.state).toBe("closed");
    expect(b.said.slice(4)).toEqual(["screen settings", "away false", "menu false", "screen play"]);
    for (let i = 0; i < 72; i++) b.frame(new Vector3(0, 0, 5), false);
    expect(b.drawer.view.out).toBe(0);
  });

  it("the lantern is put away exactly while a menu is up, whatever the screens do", () => {
    const b = bench();
    const away = () => {
      const last = b.said.filter((s) => s.startsWith("away ")).pop();
      return last === "away true";
    };
    expect(away()).toBe(false);
    for (const s of ["home", "lessons", "collection", "settings", "reset", "settings", "home", "trial", "play", "home", "play"] as const) {
      go(s);
      expect(away(), s).toBe(s !== "play");
    }
  });

  it("cannot be pulled while a menu is up", () => {
    const b = bench();
    go("home");
    const h = b.handle();
    b.frame(h, false);
    b.frame(h, true);
    for (let i = 1; i <= 10; i++) b.frame(h.clone().add(new Vector3(0, 0, 0.006 * i)), true);
    expect(b.drawer.pull.opened).toBe(0);
  });
});
