// The room's light when a new box starts after one that opened. Game.play moves to the play screen before the box
// session starts the box (its `box-start` comes after an async build), so the opened box's light must end before the
// screen moves, or the room would come up and go down again, with theatre_up then theatre_dim.
import { describe, expect, it } from "vitest";
import type { BoxSession } from "../../src/app/box-session";
import { on } from "../../src/app/bus";
import { Game, type GameShell } from "../../src/app/game";
import { go } from "../../src/app/screens";
import { RoomLights, Theatre } from "../../src/render/theatre";

function rig() {
  const theatre = new Theatre();
  const changes: string[] = [];
  const lights = new RoomLights(theatre, (from, to) => changes.push(`${from}>${to}`));
  const off = on("screen", (e) => lights.screen(e.to));
  // A box session whose build never finishes here: its box-start is the test's to send.
  const session = { start: () => new Promise<void>(() => {}), saving: null } as unknown as BoxSession;
  const shell = {
    lifecycle: { session, attach() {} },
    profiles: {},
    continueSaved: () => false,
    boxBegins: () => lights.boxOpen(false),
  } as unknown as GameShell;
  const game = new Game(session, shell);
  // A box played and opened (the room up), then a menu over it.
  go("play");
  lights.boxOpen(true);
  go("home");
  expect(theatre.light).toBe("menu");
  changes.length = 0;
  return { theatre, changes, lights, game, off };
}

describe("a new box after an opened one", () => {
  it("from a menu: the room goes from the menu's light straight down to play's, never up, before and after box-start", () => {
    const r = rig();
    r.game.play({ kind: "box", n: 4 });
    // Its box-start has not come yet (a lesson's may never come): the room is down, not latched up.
    expect(r.theatre.light).toBe("play");
    r.lights.boxOpen(false);
    expect(r.changes).toEqual(["menu>play"]);
    r.off();
  });

  it("Continue (a saved box resumed): the same", () => {
    const r = rig();
    r.game.resume({ key: "shadow-locks/4" } as Parameters<Game["resume"]>[0]);
    go("play");
    expect(r.theatre.light).toBe("play");
    r.lights.boxOpen(false);
    expect(r.changes).toEqual(["menu>play"]);
    r.off();
  });
});
