import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FramesMeta, frameFile, FrameStore, pngSha } from "../video/lib/journal";

const META: FramesMeta = { shot: "s", version: "v1", width: 64, height: 36, fps: 60, hfovDeg: 90 };
const png = (n: number) => Buffer.from(`png${n}`);
let dir = "";

beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "slvideo-")), "frames");
});
afterEach(() => {
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

describe("frame store", () => {
  it("resumes after the frames it finished", () => {
    const a = FrameStore.open(dir, META);
    for (let i = 0; i < 5; i++) a.add(i, png(i), `h${i}`);
    const b = FrameStore.open(dir, META);
    expect(b.count).toBe(5);
    expect(b.hashes).toEqual(["h0", "h1", "h2", "h3", "h4"]);
    // Each frame's PNG sha is kept, so a resume can redraw the last one and compare bytes.
    expect(b.shas).toEqual([0, 1, 2, 3, 4].map((i) => pngSha(png(i))));
    expect(b.bytes).toBe([0, 1, 2, 3, 4].reduce((n, i) => n + png(i).length, 0));
    b.add(5, png(5), "h5");
    expect(FrameStore.open(dir, META).count).toBe(6);
  });

  it("drops a half-written frame and anything without its journal line", () => {
    const a = FrameStore.open(dir, META);
    for (let i = 0; i < 3; i++) a.add(i, png(i), `h${i}`);
    fs.writeFileSync(`${frameFile(dir, 3)}.tmp`, "half");
    fs.writeFileSync(frameFile(dir, 4), "orphan");
    fs.appendFileSync(path.join(dir, "journal.ndjson"), '{"i":3,"h":"h3"');
    const b = FrameStore.open(dir, META);
    expect(b.count).toBe(3);
    expect(fs.existsSync(`${frameFile(dir, 3)}.tmp`)).toBe(false);
    expect(fs.existsSync(frameFile(dir, 4))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "journal.ndjson"), "utf8").trim().split("\n")).toHaveLength(3);
  });

  it("stops at a frame whose PNG went missing", () => {
    const a = FrameStore.open(dir, META);
    for (let i = 0; i < 4; i++) a.add(i, png(i), `h${i}`);
    fs.rmSync(frameFile(dir, 2));
    const b = FrameStore.open(dir, META);
    expect(b.count).toBe(2);
    expect(fs.existsSync(frameFile(dir, 3))).toBe(false);
  });

  it("starts over for another version, another size or fresh", () => {
    const a = FrameStore.open(dir, META);
    a.add(0, png(0), "h0");
    expect(FrameStore.open(dir, { ...META, version: "v2" }).count).toBe(0);
    FrameStore.open(dir, META).add(0, png(0), "h0");
    expect(FrameStore.open(dir, { ...META, width: 128 }).count).toBe(0);
    FrameStore.open(dir, META).add(0, png(0), "h0");
    expect(FrameStore.open(dir, META, { fresh: true }).count).toBe(0);
  });

  it("only takes frames in order", () => {
    const a = FrameStore.open(dir, META);
    expect(() => a.add(1, png(1), "h1")).toThrow(/out of order/);
  });
});

describe("frame store format", () => {
  it("does not trust journal lines without a PNG sha", () => {
    const a = FrameStore.open(dir, META);
    a.add(0, png(0), "h0");
    fs.writeFileSync(frameFile(dir, 1), png(1));
    fs.appendFileSync(path.join(dir, "journal.ndjson"), '{"i":1,"h":"h1"}\n');
    expect(FrameStore.open(dir, META).count).toBe(1);
  });
});
