import { describe, expect, it } from "vitest";
import { Lifecycle, type LifecycleSession } from "../../src/app/lifecycle";
import type { BoxSnapshot } from "../../src/core/profile";

class FakeSession implements LifecycleSession {
  phase: LifecycleSession["phase"] = "playing";
  log: string[] = [];
  pause(now: number) {
    this.log.push(`pause@${now}`);
  }
  resume(now: number) {
    this.log.push(`resume@${now}`);
  }
  snapshot(now: number) {
    return { at: now } as unknown as BoxSnapshot;
  }
}

function setup() {
  const saved: Array<BoxSnapshot | null> = [];
  const audio: string[] = [];
  const life = new Lifecycle({
    persist: (s) => saved.push(s),
    audio: { suspend: () => audio.push("suspend"), resume: () => audio.push("resume") },
  });
  return { life, saved, audio };
}

/** A box session reduced to its clock: play time counts only while resumed. */
class ClockSession implements LifecycleSession {
  phase: LifecycleSession["phase"] = "playing";
  private sum = 0;
  private since: number | null = null;
  pause(now: number) {
    if (this.since === null) return;
    this.sum += now - this.since;
    this.since = null;
  }
  resume(now: number) {
    this.since ??= now;
  }
  elapsed(now: number): number {
    return this.sum + (this.since === null ? 0 : now - this.since);
  }
  snapshot(now: number): BoxSnapshot {
    return { key: "box-1", lantern: [0, -0.3, 1.35], open: [], crystal: [], elapsedMs: this.elapsed(now), hints: 0, hintLevel: {} };
  }
}

const at = (s: BoxSnapshot | null | undefined) => (s as unknown as { at: number } | null)?.at;

describe("lifecycle", () => {
  it("is active only while XR is visible and the page is shown", () => {
    const { life } = setup();
    expect(life.active).toBe(false);
    life.setXrVisibility("visible", 0);
    expect(life.active).toBe(true);
    life.setXrVisibility("visible-blurred", 1);
    expect(life.active).toBe(false);
    life.setXrVisibility("visible", 2);
    life.setDocumentHidden(true, 3);
    expect(life.active).toBe(false);
  });

  it("pauses the session and audio on blur, saves at once, and resumes on return", () => {
    const { life, saved, audio } = setup();
    life.setXrVisibility("visible", 0);
    const s = new FakeSession();
    life.attach(s, 100);
    saved.length = 0;
    life.setXrVisibility("visible-blurred", 5000);
    expect(s.log).toEqual(["resume@100", "pause@5000"]);
    expect(audio).toEqual(["suspend"]);
    expect(saved.map(at)).toEqual([5000]);
    life.setXrVisibility("visible", 9000);
    expect(s.log).toEqual(["resume@100", "pause@5000", "resume@9000"]);
    expect(audio).toEqual(["suspend", "resume"]);
  });

  it("holds the box while a menu is up over it: paused and saved, sound left running", () => {
    const { life, saved, audio } = setup();
    life.setXrVisibility("visible", 0);
    const s = new FakeSession();
    life.attach(s, 100);
    saved.length = 0;
    life.setHeld(true, 2000);
    expect(life.held).toBe(true);
    expect(life.active).toBe(true);
    expect(s.log).toEqual(["resume@100", "pause@2000"]);
    expect(saved.map(at)).toEqual([2000]);
    expect(audio).toEqual([]);
    // Holding again changes nothing.
    life.setHeld(true, 2500);
    expect(s.log).toEqual(["resume@100", "pause@2000"]);
    // Headset off and on under the menu: the box stays paused (only sound follows).
    life.setXrVisibility("visible-blurred", 3000);
    life.setXrVisibility("visible", 4000);
    expect(s.log).toEqual(["resume@100", "pause@2000"]);
    expect(audio).toEqual(["suspend", "resume"]);
    life.setHeld(false, 5000);
    expect(s.log).toEqual(["resume@100", "pause@2000", "resume@5000"]);
    // Let go while hidden: it resumes only when the player can see it again.
    life.setHeld(true, 6000);
    life.setDocumentHidden(true, 6500);
    life.setHeld(false, 7000);
    expect(s.log).toEqual(["resume@100", "pause@2000", "resume@5000", "pause@6000"]);
    life.setDocumentHidden(false, 8000);
    expect(s.log).toEqual(["resume@100", "pause@2000", "resume@5000", "pause@6000", "resume@8000"]);
  });

  it("a session attached under a menu starts paused", () => {
    const { life } = setup();
    life.setXrVisibility("visible", 0);
    life.setHeld(true, 0);
    const s = new FakeSession();
    life.attach(s, 10);
    expect(s.log).toEqual(["pause@10"]);
    life.setHeld(false, 20);
    expect(s.log).toEqual(["pause@10", "resume@20"]);
  });

  it("a held clock stops under the menu and goes on exactly", () => {
    const { life, saved } = setup();
    life.setXrVisibility("visible", 0);
    const s = new ClockSession();
    life.attach(s, 0);
    life.setHeld(true, 10_000);
    life.setHeld(false, 70_000);
    expect(s.elapsed(75_000)).toBe(15_000);
    expect((saved[saved.length - 1] as BoxSnapshot).elapsedMs).toBe(10_000);
  });

  it("pauses once when the page hides while XR is blurred, and resumes only when both are back", () => {
    const { life } = setup();
    life.setXrVisibility("visible", 0);
    const s = new FakeSession();
    life.attach(s, 0);
    life.setXrVisibility("hidden", 10);
    life.setDocumentHidden(true, 20);
    life.setXrVisibility("visible", 30);
    life.setDocumentHidden(false, 40);
    expect(s.log).toEqual(["resume@0", "pause@10", "resume@40"]);
  });

  it("treats the end of the XR session as hidden", () => {
    const { life, saved } = setup();
    life.setXrVisibility("visible", 0);
    const s = new FakeSession();
    life.attach(s, 0);
    life.setXrVisibility("non-immersive", 50);
    expect(s.log).toContain("pause@50");
    expect(saved.map(at)).toContain(50);
  });

  it("saves 1 s after the first unsaved change, once", () => {
    const { life, saved } = setup();
    life.setXrVisibility("visible", 0);
    life.attach(new FakeSession(), 0);
    life.tick(999);
    expect(saved).toHaveLength(0);
    life.tick(1000);
    expect(saved.map(at)).toEqual([1000]);
    life.markDirty(1200);
    life.markDirty(1900);
    life.tick(2199);
    expect(saved).toHaveLength(1);
    life.tick(2200);
    life.tick(5000);
    expect(saved.map(at)).toEqual([1000, 2200]);
  });

  it("saves on hide even with nothing marked, so the paused clock is kept", () => {
    const { life, saved } = setup();
    life.setXrVisibility("visible", 0);
    life.attach(new FakeSession(), 0);
    life.tick(1000);
    life.setDocumentHidden(true, 60000);
    expect(saved.map(at)).toEqual([1000, 60000]);
    life.tick(70000);
    expect(saved).toHaveLength(2);
  });

  it("never writes over a saved game it did not start (continue screen)", () => {
    const { life, saved } = setup();
    life.setXrVisibility("visible", 0);
    life.setDocumentHidden(true, 10);
    life.flush(20);
    life.tick(5000);
    expect(saved).toEqual([]);
  });

  it("clears the saved game when the session finishes or is dropped", () => {
    const { life, saved } = setup();
    life.setXrVisibility("visible", 0);
    const s = new FakeSession();
    life.attach(s, 0);
    life.flush(10);
    s.phase = "finished";
    life.markDirty(20);
    life.flush(30);
    expect(saved.map((x) => (x === null ? null : at(x)))).toEqual([10, null]);
    life.attach(null, 40);
    life.flush(50);
    expect(saved).toHaveLength(2); // already null, no second write
  });

  it("pauses a session attached while hidden", () => {
    const { life } = setup();
    const s = new FakeSession();
    life.attach(s, 7);
    expect(s.log).toEqual(["pause@7"]);
    life.setXrVisibility("visible", 9);
    expect(s.log).toEqual(["pause@7", "resume@9"]);
  });

  it("stops a session clock while hidden and continues exactly", () => {
    const { life, saved } = setup();
    const s = new ClockSession();
    life.setXrVisibility("visible", 0);
    life.attach(s, 1000);
    life.setXrVisibility("hidden", 6000);
    expect(s.elapsed(60000)).toBe(5000);
    life.setXrVisibility("visible", 60000);
    expect(s.elapsed(65000)).toBe(10000);
    const snap = saved[saved.length - 1] as BoxSnapshot;
    expect(snap.elapsedMs).toBe(5000);
  });
});
