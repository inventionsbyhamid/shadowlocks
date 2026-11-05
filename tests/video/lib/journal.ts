// A shot's frames on disk and what is known about them, so an interrupted render resumes where it
// stopped. Layout of a frames folder:
//   meta.json      what the frames are of (shot version, size, rate)
//   journal.ndjson one line per finished frame: {"i": n, "h": "<state fingerprint>", "s": "<PNG sha256>"}
//   f00000.png ... the frames, each written to a .tmp file first and renamed once complete
// A journal line is written only after its PNG is in place, so every line has a whole frame.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface FramesMeta {
  shot: string;
  /** Fingerprint of the shot script and the video library: frames of another version never mix. */
  version: string;
  width: number;
  height: number;
  fps: number;
  hfovDeg: number;
}

export const frameFile = (dir: string, i: number): string => path.join(dir, `f${String(i).padStart(5, "0")}.png`);
export const FRAME_PATTERN = "f%05d.png";

const sameMeta = (a: FramesMeta, b: FramesMeta) =>
  a.shot === b.shot && a.version === b.version && a.width === b.width && a.height === b.height && a.fps === b.fps && a.hfovDeg === b.hfovDeg;

/** sha256 of a frame's PNG bytes (first 16 hex characters). */
export const pngSha = (png: Buffer): string => crypto.createHash("sha256").update(png).digest("hex").slice(0, 16);

export class FrameStore {
  /** State fingerprints of the frames on disk, in order. */
  readonly hashes: string[] = [];
  /** PNG sha of each frame on disk (a resumed shot redraws the last one and compares). */
  readonly shas: string[] = [];
  /** Bytes of the frames written through this store or found on disk. */
  bytes = 0;

  private constructor(
    readonly dir: string,
    readonly meta: FramesMeta,
  ) {}

  /**
   * Open the folder for `meta`. Frames of another version or size, or `fresh`, are deleted. Of what
   * remains, the frames kept are the leading run that has both a journal line and a PNG; anything
   * after (a half-written frame, a frame without its line) is removed.
   */
  static open(dir: string, meta: FramesMeta, o: { fresh?: boolean } = {}): FrameStore {
    const metaFile = path.join(dir, "meta.json");
    let old: FramesMeta | null = null;
    try {
      old = JSON.parse(fs.readFileSync(metaFile, "utf8")) as FramesMeta;
    } catch {
      old = null;
    }
    if (o.fresh || !old || !sameMeta(old, meta)) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
      return new FrameStore(dir, meta);
    }
    const store = new FrameStore(dir, meta);
    let lines: string[] = [];
    try {
      lines = fs.readFileSync(path.join(dir, "journal.ndjson"), "utf8").split("\n");
    } catch {
      lines = [];
    }
    for (const line of lines) {
      let rec: { i?: unknown; h?: unknown; s?: unknown };
      try {
        rec = JSON.parse(line) as { i?: unknown; h?: unknown; s?: unknown };
      } catch {
        break;
      }
      const i = store.hashes.length;
      if (rec.i !== i || typeof rec.h !== "string" || typeof rec.s !== "string" || !fs.existsSync(frameFile(dir, i))) break;
      store.hashes.push(rec.h);
      store.shas.push(rec.s);
    }
    store.truncate(store.hashes.length);
    for (let i = 0; i < store.count; i++) store.bytes += fs.statSync(frameFile(dir, i)).size;
    return store;
  }

  get count(): number {
    return this.hashes.length;
  }

  /** Keep frames before `n`; delete the rest (and leftovers) and rewrite the journal to match. */
  truncate(n: number): void {
    this.hashes.length = Math.min(n, this.hashes.length);
    this.shas.length = this.hashes.length;
    for (const f of fs.readdirSync(this.dir)) {
      const m = /^f(\d{5})\.png(\.tmp)?$/.exec(f);
      if (m && (m[2] || Number(m[1]) >= this.hashes.length)) fs.rmSync(path.join(this.dir, f), { force: true });
    }
    const body = this.hashes.map((h, i) => JSON.stringify({ i, h, s: this.shas[i] })).join("\n");
    fs.writeFileSync(path.join(this.dir, "journal.ndjson"), body ? `${body}\n` : "");
  }

  /** Store frame `i` (must be the next one): PNG first, then its journal line. */
  add(i: number, png: Buffer, hash: string): void {
    if (i !== this.hashes.length) throw new Error(`frame ${i} out of order (next is ${this.hashes.length})`);
    const file = frameFile(this.dir, i);
    const sha = pngSha(png);
    fs.writeFileSync(`${file}.tmp`, png);
    fs.renameSync(`${file}.tmp`, file);
    fs.appendFileSync(path.join(this.dir, "journal.ndjson"), `${JSON.stringify({ i, h: hash, s: sha })}\n`);
    this.hashes.push(hash);
    this.shas.push(sha);
    this.bytes += png.length;
  }

  remove(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}
