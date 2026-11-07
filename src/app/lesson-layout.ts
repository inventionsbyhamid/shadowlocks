// A lesson's scraps swinging between a twin's layout and the player's: each lock staged on a twin moves its scraps
// and sight rings in place, `t` of the way from the twin's layout (0) to the player's (1; past 1 while they swing
// home). The box's own elements move (their shadows follow them), and the scrap mesh is told each piece's offset
// and each ring's pose. The solve never sees this: the box session copied the player's layout when the box started.
//
// A lesson piece hangs flat at its own depth, so between the layouts it slides straight sideways; a ring slides and
// turns to face the other spot. At 1 everything is back exactly where the box hangs it. Allocation-free per call
// (the start positions and moves are copied once per box).
import type { LessonLock } from "../core/lessons-data";
import type { Box, Piece, Ring, V3 } from "../core/types";

/** What the swing draws through: the scrap mesh and the shadows (BoxScene and its Scraps have it all). */
export interface LayoutSink {
  offsetPiece(lock: number, piece: number, x: number, y: number, z: number): void;
  moveRing(r: number, c: Readonly<V3>, nrm: Readonly<V3>, off: Readonly<V3>): void;
  shadowsMoved(): void;
}

interface PieceMove {
  el: Piece;
  /** The player's corners, and each corner's move to the twin's (flat x, y, z). */
  base: Float64Array;
  delta: Float64Array;
}

interface RingMove {
  el: Ring;
  /** Its index among the box's rings (the scrap mesh's instance). */
  r: number;
  base: Float64Array;
  delta: Float64Array;
  /** The player's normal and the twin's. */
  n0: Float64Array;
  n1: Float64Array;
}

interface LockMoves {
  pieces: PieceMove[];
  rings: RingMove[];
  /** The layout shown now (1: the player's). */
  t: number;
}

export class LessonLayout {
  private readonly locks: (LockMoves | null)[];
  private readonly c: V3 = [0, 0, 0];
  private readonly nrm: V3 = [0, 0, 0];
  private readonly off: V3 = [0, 0, 0];

  /** For `box` (the one the scene shows) and its lesson's twins, by lock (null: no example on that lock). */
  constructor(box: Box, twins: readonly (LessonLock | null)[]) {
    const ringIndex = new Map<Ring, number>();
    let r = 0;
    for (const e of box.elements) if (e.kind === "ring") ringIndex.set(e, r++);
    this.locks = box.locks.map((lock) => {
      const twin = twins[lock.i];
      if (!twin) return null;
      const pieces: PieceMove[] = [], rings: RingMove[] = [];
      const twinRings = twin.elements.filter((e): e is Ring => e.kind === "ring");
      let ringNo = 0;
      for (const e of box.elements) {
        if (e.kind === "piece" && e.lock === lock.i) {
          const t = twin.elements.find((x): x is Piece => x.kind === "piece" && x.piece === e.piece);
          if (!t) continue;
          const base = Float64Array.from(e.verts.flat()), to = t.verts.flat();
          pieces.push({ el: e, base, delta: Float64Array.from(base, (v, i) => to[i]! - v) });
        } else if (e.kind === "ring" && e.lock === lock.i) {
          const t = twinRings[ringNo++];
          if (!t) continue;
          const base = Float64Array.from(e.c);
          rings.push({
            el: e,
            r: ringIndex.get(e)!,
            base,
            delta: Float64Array.from(base, (v, i) => t.c[i]! - v),
            n0: Float64Array.from(e.nrm),
            n1: Float64Array.from(t.nrm),
          });
        }
      }
      return { pieces, rings, t: 1 };
    });
  }

  /** Show lock `lock` `t` of the way from its twin's layout to the player's. False (nothing drawn) when unchanged. */
  set(lock: number, t: number, sink: LayoutSink): boolean {
    const m = this.locks[lock];
    if (!m || m.t === t) return false;
    m.t = t;
    const k = 1 - t;
    for (let i = 0; i < m.pieces.length; i++) {
      const p = m.pieces[i]!, v = p.el.verts, b = p.base, d = p.delta;
      for (let j = 0; j < v.length; j++) {
        const q = v[j]!, o = j * 3;
        q[0] = b[o]! + d[o]! * k;
        q[1] = b[o + 1]! + d[o + 1]! * k;
        q[2] = b[o + 2]! + d[o + 2]! * k;
      }
      sink.offsetPiece(p.el.lock, p.el.piece, d[0]! * k, d[1]! * k, d[2]! * k);
    }
    const c = this.c, nrm = this.nrm, off = this.off;
    for (let i = 0; i < m.rings.length; i++) {
      const g = m.rings[i]!, b = g.base, d = g.delta;
      for (let a = 0; a < 3; a++) {
        off[a] = d[a]! * k;
        c[a] = b[a]! + off[a]!;
        g.el.c[a] = c[a]!;
      }
      // Turn from the player's normal toward the twin's (a small turn: a normalised blend is close enough).
      const nx = g.n0[0]! + (g.n1[0]! - g.n0[0]!) * k, ny = g.n0[1]! + (g.n1[1]! - g.n0[1]!) * k, nz = g.n0[2]! + (g.n1[2]! - g.n0[2]!) * k;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nrm[0] = nx / l;
      nrm[1] = ny / l;
      nrm[2] = nz / l;
      if (t === 1) {
        nrm[0] = g.n0[0]!;
        nrm[1] = g.n0[1]!;
        nrm[2] = g.n0[2]!;
      }
      g.el.nrm[0] = nrm[0];
      g.el.nrm[1] = nrm[1];
      g.el.nrm[2] = nrm[2];
      sink.moveRing(g.r, c, nrm, off);
    }
    sink.shadowsMoved();
    return true;
  }

  /** Every lock back in the player's layout. */
  reset(sink: LayoutSink): void {
    for (let i = 0; i < this.locks.length; i++) this.set(i, 1, sink);
  }
}
