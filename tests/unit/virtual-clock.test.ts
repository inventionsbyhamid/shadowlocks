import { describe, expect, it } from "vitest";
import { installVirtualClock, type VirtualClock } from "../../src/app/virtual-clock";

function fakeWindow() {
  let real = 1000;
  const realQueue: Array<(t: number) => void> = [];
  const win = {
    Date,
    performance: { now: () => real },
    requestAnimationFrame: (cb: (t: number) => void) => realQueue.push(cb),
    cancelAnimationFrame: (_id: number) => {},
  } as unknown as Window & typeof globalThis & { __vt?: VirtualClock };
  return {
    win,
    advanceReal: (ms: number) => (real += ms),
    flushReal: () => realQueue.splice(0).forEach((cb) => cb(real)),
    realPending: () => realQueue.length,
  };
}

describe("virtual clock", () => {
  it("freezes performance.now and runs frames only on step", () => {
    const f = fakeWindow();
    const vt = installVirtualClock(true, f.win);
    const seen: number[] = [];
    f.win.requestAnimationFrame((t) => seen.push(t));
    f.advanceReal(500);
    expect(f.win.performance.now()).toBe(1000);
    expect(seen).toEqual([]);
    const r = vt.step(16);
    expect(r.ran).toBe(1);
    expect(seen).toEqual([1016]);
    expect(f.win.performance.now()).toBe(1016);
    expect(vt.frames).toBe(1);
  });

  it("runs callbacks queued during a frame on the next step, not the same one", () => {
    const f = fakeWindow();
    const vt = installVirtualClock(true, f.win);
    let n = 0;
    const loop = () => {
      n++;
      f.win.requestAnimationFrame(loop);
    };
    f.win.requestAnimationFrame(loop);
    vt.step(10);
    vt.step(10);
    vt.steps(3, 10);
    expect(n).toBe(5);
  });

  it("cancels a queued frame", () => {
    const f = fakeWindow();
    const vt = installVirtualClock(true, f.win);
    let ran = false;
    const id = f.win.requestAnimationFrame(() => (ran = true));
    f.win.cancelAnimationFrame(id);
    vt.step(16);
    expect(ran).toBe(false);
  });

  it("pauses from real time and resumes without a jump", () => {
    const f = fakeWindow();
    const vt = installVirtualClock(false, f.win);
    f.advanceReal(200);
    expect(f.win.performance.now()).toBe(1200);
    vt.pause();
    f.advanceReal(300);
    expect(f.win.performance.now()).toBe(1200);
    vt.step(16);
    const seen: number[] = [];
    f.win.requestAnimationFrame((t) => seen.push(t));
    vt.resume();
    expect(f.win.performance.now()).toBe(1216);
    expect(f.realPending()).toBe(1);
    f.advanceReal(10);
    f.flushReal();
    expect(seen).toEqual([1226]);
    expect(f.win.performance.now()).toBe(1226);
    vt.pause();
    f.advanceReal(50);
    expect(f.win.performance.now()).toBe(1226);
  });

  it("drives Date from a fixed epoch", () => {
    const f = fakeWindow();
    const epoch = Date.UTC(2026, 10, 2, 23, 59, 30);
    const vt = installVirtualClock({ enabled: true, epochMs: epoch }, f.win);
    expect(f.win.Date.now()).toBe(epoch);
    expect(new f.win.Date().getTime()).toBe(epoch);
    vt.step(60_000);
    expect(new f.win.Date().getTime()).toBe(epoch + 60_000);
    expect(new f.win.Date(2020, 0, 1).getFullYear()).toBe(2020);
    expect(new f.win.Date(0).getTime()).toBe(0);
    expect(f.win.Date.UTC(2026, 0, 1)).toBe(Date.UTC(2026, 0, 1));
    expect(new f.win.Date()).toBeInstanceOf(Date);
    expect(new f.win.Date()).toBeInstanceOf(f.win.Date);
    expect(typeof (f.win.Date as unknown as () => string)()).toBe("string");
  });

  it("without an epoch, Date starts at the real date and follows the virtual clock", () => {
    const f = fakeWindow();
    const before = Date.now();
    const vt = installVirtualClock(true, f.win);
    const start = f.win.Date.now();
    expect(start).toBeGreaterThanOrEqual(before);
    f.advanceReal(5000);
    expect(f.win.Date.now()).toBe(start);
    vt.step(1000);
    expect(f.win.Date.now()).toBe(start + 1000);
  });

  it("keeps one clock when installed twice", () => {
    const f = fakeWindow();
    const a = installVirtualClock(true, f.win);
    const b = installVirtualClock(true, f.win);
    expect(b).toBe(a);
    expect(f.win.__vt).toBe(a);
  });

  it("reports the real time spent running callbacks", () => {
    const f = fakeWindow();
    const vt = installVirtualClock(true, f.win);
    f.win.requestAnimationFrame(() => f.advanceReal(7));
    expect(vt.step(16).jsMs).toBe(7);
    expect(vt.realNow()).toBe(1007);
  });
});
