// Boxes off the main thread: the generator runs in a worker (src/worker/box.worker.ts), so building a box (tens of
// milliseconds, a few hundred at worst) never costs a frame. Same results as generateBox. Without workers (Node
// tests, a browser that refuses one) it builds on this thread instead.
import { generateBox } from "./generator";
import type { Box, BoxSpec } from "./types";

export interface BoxRequest {
  id: number;
  spec: BoxSpec;
}
export type BoxResponse = { id: number; box: Box } | { id: number; error: string };

export interface BoxClient {
  /** The box for a spec. Calls for one spec share one box: treat it as read-only (mirrorBox makes a new one). */
  get(spec: BoxSpec): Promise<Box>;
  /** Starts building a box now, so a later `get` for it is ready sooner. */
  prefetch(spec: BoxSpec): void;
}

/** How many recent boxes a client keeps ready. */
const KEEP = 6;

const keyOf = (spec: BoxSpec) =>
  spec.kind === "box" ? `box/${spec.n}` : spec.kind === "daily" ? `daily/${spec.day}` : `lesson/${spec.id}`;

interface Pending {
  spec: BoxSpec;
  resolve: (b: Box) => void;
  reject: (e: unknown) => void;
}

export function createBoxClient(): BoxClient {
  let worker: Worker | null = null;
  let disabled = false;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const kept = new Map<string, Promise<Box>>();

  function local(p: Pending): void {
    try {
      p.resolve(generateBox(p.spec));
    } catch (err) {
      p.reject(err);
    }
  }

  /** Stops using the worker and finishes whatever it still owed on this thread. */
  function disable(): void {
    disabled = true;
    const w = worker;
    worker = null;
    try {
      w?.terminate();
    } catch {
      // Already gone.
    }
    const rest = [...pending.values()];
    pending.clear();
    for (const p of rest) local(p);
  }

  function getWorker(): Worker | null {
    if (disabled || typeof Worker === "undefined") return null;
    if (worker) return worker;
    try {
      const w = new Worker(new URL("../worker/box.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<BoxResponse>) => {
        const msg = e.data;
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (!("error" in msg)) return p.resolve(msg.box);
        // The worker could not build it. If this thread can, the worker is at fault: stop using it. If not, the box
        // itself cannot be built, and the caller gets the generator's own error.
        try {
          p.resolve(generateBox(p.spec));
        } catch (err) {
          return p.reject(err);
        }
        disable();
      };
      w.onerror = () => disable();
      worker = w;
      return w;
    } catch {
      disabled = true;
      return null;
    }
  }

  function build(spec: BoxSpec): Promise<Box> {
    return new Promise<Box>((resolve, reject) => {
      const p: Pending = { spec, resolve, reject };
      const w = getWorker();
      if (!w) return local(p);
      const id = nextId++;
      pending.set(id, p);
      try {
        w.postMessage({ id, spec } satisfies BoxRequest);
      } catch {
        pending.delete(id);
        local(p);
        disable();
      }
    });
  }

  function get(spec: BoxSpec): Promise<Box> {
    const key = keyOf(spec);
    const hit = kept.get(key);
    if (hit) {
      kept.delete(key);
      kept.set(key, hit);
      return hit;
    }
    const box = build(spec);
    kept.set(key, box);
    if (kept.size > KEEP) kept.delete(kept.keys().next().value!);
    // A failure is not kept: the next get tries again.
    box.catch(() => {
      if (kept.get(key) === box) kept.delete(key);
    });
    return box;
  }

  return {
    get,
    prefetch(spec) {
      get(spec).catch(() => {});
    },
  };
}
