/**
 * A frame clock that tests and frame-by-frame capture can stop and step.
 *
 * While enabled, `performance.now()` stands still and `requestAnimationFrame` callbacks only run when
 * `step(ms)` is called. IWER drives the emulated XR frame loop from both, so the whole app (systems,
 * emulated hands, render) advances exactly one frame per step, however slow the machine is.
 * `Date` follows the same clock (from a fixed epoch if given), so day keys and seeds reproduce.
 */
export interface VirtualClock {
  enabled: boolean;
  /** Virtual time in ms (what performance.now() returns while enabled). */
  now: number;
  /** Frames stepped so far. */
  frames: number;
  /** The real performance.now. */
  realNow(): number;
  /** Advance by `ms` and run the frame callbacks queued before this call. */
  step(ms: number): { ran: number; jsMs: number; now: number };
  /** `step(ms)` n times; returns the real ms spent in callbacks. */
  steps(n: number, ms: number): number;
  /** Switch to virtual frames, continuing from the current time. */
  pause(): void;
  /** Back to real frames, continuing from the virtual time (no jump). */
  resume(): void;
}

export interface VirtualClockOptions {
  /** Start on virtual frames (default true). */
  enabled?: boolean;
  /** What `Date.now()` returns at install (ms since 1970); default the real date. */
  epochMs?: number;
}

/**
 * Installs the clock on `win` (once; later calls return the same clock).
 * Self-contained on purpose: Playwright serializes this function into an init script.
 */
export function installVirtualClock(
  options: boolean | VirtualClockOptions = true,
  win: Window & typeof globalThis = window,
): VirtualClock {
  const o = typeof options === "boolean" ? { enabled: options } : options;
  const w = win as unknown as { __vt?: VirtualClock } & Window & typeof globalThis;
  if (w.__vt) {
    if (o.enabled !== false) w.__vt.pause();
    return w.__vt;
  }
  const perf = w.performance;
  const realNow = perf.now.bind(perf);
  const realRaf = w.requestAnimationFrame.bind(w);
  const realCancel = w.cancelAnimationFrame.bind(w);
  const RealDate = w.Date;
  // Virtual ids start high so they never collide with ids from the real requestAnimationFrame.
  let nextId = 1_000_000_000;
  let queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  /** While on real frames, reported time = real time - offset (so resuming never jumps). */
  let offset = 0;

  const vt: VirtualClock = {
    enabled: o.enabled !== false,
    now: realNow(),
    frames: 0,
    realNow,
    step(ms: number) {
      vt.now += ms;
      vt.frames++;
      const run = queue;
      queue = [];
      const t0 = realNow();
      for (const e of run) {
        try {
          e.cb(vt.now);
        } catch (err) {
          console.error("frame callback failed", err);
        }
      }
      return { ran: run.length, jsMs: realNow() - t0, now: vt.now };
    },
    steps(n: number, ms: number) {
      let js = 0;
      for (let i = 0; i < n; i++) js += vt.step(ms).jsMs;
      return js;
    },
    pause() {
      if (vt.enabled) return;
      vt.now = realNow() - offset;
      vt.enabled = true;
    },
    resume() {
      if (!vt.enabled) return;
      vt.enabled = false;
      offset = realNow() - vt.now;
      const run = queue;
      queue = [];
      for (const e of run) realRaf((t) => e.cb(t - offset));
    },
  };

  const reported = () => (vt.enabled ? vt.now : realNow() - offset);
  const perfBase = reported();
  const dateBase = o.epochMs ?? RealDate.now();
  const dateNow = () => dateBase + (reported() - perfBase);
  function VirtualDate(this: unknown, ...args: unknown[]): unknown {
    if (!new.target) return new RealDate(dateNow()).toString();
    return args.length ? Reflect.construct(RealDate, args) : new RealDate(dateNow());
  }
  VirtualDate.prototype = RealDate.prototype;
  VirtualDate.now = dateNow;
  VirtualDate.parse = RealDate.parse;
  VirtualDate.UTC = RealDate.UTC;

  perf.now = reported;
  w.Date = VirtualDate as unknown as DateConstructor;
  w.requestAnimationFrame = (cb: FrameRequestCallback) => {
    if (!vt.enabled) return realRaf((t) => cb(t - offset));
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  w.cancelAnimationFrame = (id: number) => {
    if (id >= 1_000_000_000) queue = queue.filter((e) => e.id !== id);
    else realCancel(id);
  };
  w.__vt = vt;
  return vt;
}
