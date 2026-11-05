import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateBox } from "../../src/core/generator";
import type { BoxSpec } from "../../src/core/types";

type Msg = { id: number; spec: BoxSpec };

class FakeWorker {
  static mode: "ok" | "error-msg" | "onerror" = "ok";
  static created = 0;
  static posted: BoxSpec[] = [];
  static delays: Record<number, number> = {};
  static args: unknown[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(...args: unknown[]) {
    FakeWorker.created++;
    FakeWorker.args = args;
  }
  postMessage(m: Msg) {
    FakeWorker.posted.push(m.spec);
    const delay = m.spec.kind === "box" ? (FakeWorker.delays[m.spec.n] ?? 0) : 0;
    setTimeout(() => {
      if (FakeWorker.mode === "onerror") return void this.onerror?.(new Error("boom"));
      if (FakeWorker.mode === "error-msg") return void this.onmessage?.({ data: { id: m.id, error: "bad" } });
      try {
        this.onmessage?.({ data: { id: m.id, box: structuredClone(generateBox(m.spec)) } });
      } catch (err) {
        this.onmessage?.({ data: { id: m.id, error: String(err) } });
      }
    }, delay);
  }
  terminate() {}
}

const box = (n: number): BoxSpec => ({ kind: "box", n });

beforeEach(() => {
  vi.resetModules();
  FakeWorker.mode = "ok";
  FakeWorker.created = 0;
  FakeWorker.posted = [];
  FakeWorker.delays = {};
  FakeWorker.args = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../../src/core/generator");
});

describe("createBoxClient", () => {
  it("builds box 7 on this thread in Node, the same as generateBox", async () => {
    expect(typeof Worker).toBe("undefined");
    const { createBoxClient } = await import("../../src/core/box-client");
    expect(await createBoxClient().get(box(7))).toEqual(generateBox(box(7)));
  });

  it("builds in one module worker and matches overlapping replies by id", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.delays = { 1: 30, 2: 0 };
    const { createBoxClient } = await import("../../src/core/box-client");
    const client = createBoxClient();
    const [a, b] = await Promise.all([client.get(box(1)), client.get({ kind: "daily", day: "2026-11-06" })]);
    expect(a).toEqual(generateBox(box(1)));
    expect(b).toEqual(generateBox({ kind: "daily", day: "2026-11-06" }));
    expect(FakeWorker.created).toBe(1);
    expect(String(FakeWorker.args[0])).toMatch(/worker\/box\.worker\.ts$/);
    expect(FakeWorker.args[1]).toEqual({ type: "module" });
  });

  it("prefetches: a later get uses the box already on its way", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { createBoxClient } = await import("../../src/core/box-client");
    const client = createBoxClient();
    client.prefetch(box(3));
    const b = await client.get(box(3));
    expect(b).toEqual(generateBox(box(3)));
    expect(await client.get(box(3))).toBe(b);
    expect(FakeWorker.posted).toEqual([box(3)]);
  });

  it("keeps only a few recent boxes", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { createBoxClient } = await import("../../src/core/box-client");
    const client = createBoxClient();
    for (let n = 1; n <= 12; n++) await client.get(box(n));
    await client.get(box(12));
    expect(FakeWorker.posted).toHaveLength(12);
    await client.get(box(1));
    expect(FakeWorker.posted).toHaveLength(13);
  });

  it("falls back to this thread when the worker posts an error for a good box, then stops using it", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.mode = "error-msg";
    const { createBoxClient } = await import("../../src/core/box-client");
    const client = createBoxClient();
    expect(await client.get(box(1))).toEqual(generateBox(box(1)));
    FakeWorker.mode = "ok";
    expect(await client.get(box(2))).toEqual(generateBox(box(2)));
    expect(FakeWorker.posted).toEqual([box(1)]);
    expect(FakeWorker.created).toBe(1);
  });

  it("rejects a box that cannot be built, keeps the worker, and does not keep the failure", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { createBoxClient } = await import("../../src/core/box-client");
    const client = createBoxClient();
    const lesson: BoxSpec = { kind: "lesson", id: "l1" };
    await expect(client.get(lesson)).rejects.toThrow(/Lessons/);
    await expect(client.get(lesson)).rejects.toThrow(/Lessons/);
    expect(await client.get(box(1))).toEqual(generateBox(box(1)));
    expect(FakeWorker.posted).toEqual([lesson, lesson, box(1)]);
    expect(FakeWorker.created).toBe(1);
  });

  it("finishes pending boxes on this thread when the worker dies", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.mode = "onerror";
    const { createBoxClient } = await import("../../src/core/box-client");
    const client = createBoxClient();
    const [a, b] = await Promise.all([client.get(box(1)), client.get(box(2))]);
    expect(a).toEqual(generateBox(box(1)));
    expect(b).toEqual(generateBox(box(2)));
  });

  it("falls back when the worker cannot be made", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("nope");
        }
      },
    );
    const { createBoxClient } = await import("../../src/core/box-client");
    expect(await createBoxClient().get(box(2))).toEqual(generateBox(box(2)));
  });

  it("rejects when the worker dies and this thread fails too", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.mode = "onerror";
    const err = new Error("gave up");
    vi.doMock("../../src/core/generator", () => ({
      generateBox: () => {
        throw err;
      },
    }));
    const { createBoxClient } = await import("../../src/core/box-client");
    await expect(createBoxClient().get(box(1))).rejects.toBe(err);
  });
});

describe("box worker", () => {
  it("answers a request with the box, or with the error", async () => {
    const posted: unknown[] = [];
    const scope: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m: unknown): void } = {
      onmessage: null,
      postMessage: (m) => posted.push(m),
    };
    vi.stubGlobal("self", scope);
    await import("../../src/worker/box.worker");
    scope.onmessage!({ data: { id: 4, spec: box(2) } });
    scope.onmessage!({ data: { id: 5, spec: { kind: "lesson", id: "l2" } } });
    expect(posted[0]).toEqual({ id: 4, box: generateBox(box(2)) });
    expect(posted[1]).toEqual({ id: 5, error: expect.stringMatching(/Lessons/) });
  });
});
