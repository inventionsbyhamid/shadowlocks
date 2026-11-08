// Boxes off the main thread: the generator runs in a worker (src/worker/box.worker.ts), so building a box (tens of
// milliseconds, a few hundred at worst) never costs a frame. Same results as generateBox. Without a working worker
// (Node tests, a browser that refuses one, a worker that dies) it builds on this thread instead.
import { generateBox } from "./generator";
import type { Box, BoxSpec, Element, Lock, V2, V3 } from "./types";

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

const v2 = (p: V2): V2 => [p[0], p[1]];
const v3 = (p: V3): V3 => [p[0], p[1], p[2]];

/**
 * A box as it came from the worker, rebuilt with plain arrays of numbers (equal to it in every value). A structured
 * clone comes back with generic (holey) array elements on V8, and code that measures the box every frame meets those
 * arrays: V8 then generalises every array that passes the same code, double arrays included, and each coordinate
 * written into one afterwards boxes a double. Once per box.
 */
export function reviveBox(b: Box): Box {
  const elements: Element[] = b.elements.map((e) => (e.kind === "ring" ? { ...e, c: v3(e.c), nrm: v3(e.nrm) } : { ...e, verts: e.verts.map(v3) }));
  const locks: Lock[] = b.locks.map((l) => ({ ...l, center: v2(l.center), target: l.target.map((p) => p.map(v2)), L: v3(l.L), mark: l.mark && v2(l.mark) }));
  return { ...b, spec: { ...b.spec }, params: { ...b.params }, start: v3(b.start), elements, locks };
}

/** A spec's place among the kept boxes: an older version's box (a resumed save) is kept apart from today's. */
const keyOf = (spec: BoxSpec) => {
  if (spec.kind === "lesson") return `lesson/${spec.id}`;
  const v = spec.gen === undefined ? "" : `@${spec.gen}`;
  return (spec.kind === "box" ? `box/${spec.n}` : `daily/${spec.day}`) + v;
};

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
        // An error reply means the generator itself failed on this spec (it is deterministic, so this thread would
        // fail the same way): reject, and keep the worker for other boxes.
        if ("error" in msg) p.reject(new Error(msg.error));
        else p.resolve(reviveBox(msg.box));
      };
      // A broken worker, or a reply that cannot be read: stop using it and finish everything on this thread.
      w.onerror = () => disable();
      w.onmessageerror = () => disable();
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
