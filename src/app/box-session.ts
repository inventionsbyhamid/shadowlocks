// The box in play, one frame at a time: each lock measured from where the lantern is (only locks within WARMTH_RANGE
// of it, and only when the lantern or a finger moved), its warmth on the panel and in its hum, its rings lining up,
// a finger lock's hold and its piece forming (session-fingers.ts), locks opening, the head's gaze choosing the lock in
// focus, the stuck watch lighting the hint lantern, then the box opening, its reward taken, and the next box offered
// on the plate. It owns the rules around a box (session-rules.ts): the Warmth setting, hints, saves (every 2 s of
// play, and whenever the lifecycle asks), the collection, the next box and the daily streak. Play time counts only
// while the player can see the box.
//
// The session runs right after the lantern and the hands (priority -2.8), before the box scene draws the frame. The
// renderer, the hands and the sounds come in as small interfaces (session-deps.ts), so the unit tests run it on a
// fake clock with fake frames. Per frame it allocates nothing: lock state, shadow buffers and coverage are made once
// per box, and the events it sends every frame or so are shared or reused (events.ts).
import { HINT_GLOW_GAIN } from "../audio/cues";
import { ENVELOPE } from "../core/envelope";
import { GENERATOR_VERSION, seedKey } from "../core/generator";
import { mirrorBox } from "../core/mirror";
import type { BoxSnapshot } from "../core/profile";
import { type Coverage, type LockSamples, measure, meets, prepareLock, ShadowCaster, SKIP_MISSING, warmth, WARMTH_RANGE } from "../core/solve";
import type { Box, BoxSpec, Lock, V3, Vec3 } from "../core/types";
import { LANTERN_MIN_Z, MAX_STEP_MS, OPEN_DWELL_MS } from "../feel/constants";
import { GazeFocus } from "../feel/gaze-focus";
import type { FeelEvent } from "../feel/lantern-controller";
import { StuckWatch } from "../feel/stuck-watch";
import { FOCUS, HINT, type HintLevel, LOCK_OPEN, RING, reusedEvents, STUCK } from "./events";
import { HintBook } from "./hints";
import type { Phase } from "./lifecycle";
import { ACT_HINT, ACT_NEXT, ACT_SHOW_ME, ACT_TAKE, type BoxSessionDeps, NULL_VIEW, type SessionView, type Stage } from "./session-deps";
import { CRYSTAL_MS, type FingerLoop, FingerLocks } from "./session-fingers";
import { collect, lockOnPanel, solveBox } from "./session-rules";

// The session's surface in one import (its deps, its stages and the finger seam live beside it).
export { ACT_HINT, ACT_NEXT, ACT_SHOW_ME, ACT_TAKE, NULL_VIEW } from "./session-deps";
export type { BoxSessionDeps, HeadRay, SessionLantern, SessionProfiles, SessionScene, SessionSound, SessionView, Stage } from "./session-deps";
export { CRYSTAL_MS } from "./session-fingers";
export type { CrystalSink, FingerLoop, FingerLoopState, FingerSource } from "./session-fingers";

/** From the last lock opening to the box opening: the lock's own celebration reads first. */
export const LOCK_TO_BOX_MS = 700;
/** From the box opening until its reward has risen out of the drawer and can be taken (it rises with the tune). */
export const REWARD_UP_MS = 2500;
/** A reward nobody takes goes into the collection by itself this long after it is up. */
export const REWARD_AUTO_MS = 8000;
/** A box in play is saved this often (the lifecycle debounces it), besides on hide and after anything that matters. */
export const SAVE_EVERY_MS = 2000;
/** A lock's warmth on the bus moves in steps of this (or to 0 or 1). */
const WARMTH_EVENT_STEP = 0.05;
/** The warmth a lock's hum follows is eased with this time constant (the panel eases its glow itself). */
const WARMTH_EASE_MS = 120;
/** Float slack for times added up frame by frame. */
const EPS_MS = 1e-6;

/** A lock of the box in play: its samples and this frame's coverage, made once per box. */
class LockState {
  readonly cov: Coverage = { cover: 0, spill: 0, spillAll: 0, gap: 0 };
  open = false;
  /** A finger lock whose piece has formed: open for good, its celebration once the piece is there. */
  done = false;
  meets = false;
  meetMs = 0;
  /** Warmth now (unsmoothed), its eased value for the hum, and the last value sent on the bus. */
  w = 0;
  smooth = 0;
  sentW = -1;
  ring = false;
  crystalZ = Number.NaN;
  openInMs = -1;

  constructor(
    readonly lock: Lock,
    readonly samples: LockSamples,
  ) {}
}

export class BoxSession {
  /** "Show me" on the hint lantern: replays the example the lock needs (wired by the lessons). */
  showMe: ((lock: Lock) => void) | null = null;
  private current: Box | null = null;
  private currentSpec: BoxSpec | null = null;
  private stageNow: Stage = "idle";
  private locks: LockState[] = [];
  private caster = new ShadowCaster([]);
  private readonly fingers: FingerLocks;
  private book = new HintBook(0);
  private watch = new StuckWatch();
  private gazeFocus = new GazeFocus();
  private focused: number | null = null;
  private stuckOn = false;
  private openCount = 0;
  private seqMs = 0;
  private rewardMs = 0;
  private boxOpenSent = false;
  private elapsed = 0;
  private saveMs = 0;
  private best = 0;
  private lastT = Number.NaN;
  private nowMs = 0;
  private paused = false;
  private feelSync = false;
  private heldBack = false;
  private token = 0;
  private pendingSpec: BoxSpec | null = null;
  private pendingSnap: BoxSnapshot | null = null;
  private readonly view: SessionView;
  private readonly reused = reusedEvents();
  private readonly L: V3 = [0, 0, 0];
  private readonly lastL: V3 = [Number.NaN, Number.NaN, Number.NaN];
  private lastNF = 0;
  private readonly origin: V3 = [0, 0, 0];
  private readonly dir: V3 = [0, 0, 0];
  private readonly at: Vec3 = [0, 0, 0];

  constructor(private readonly deps: BoxSessionDeps) {
    this.view = deps.view ?? NULL_VIEW;
    this.fingers = new FingerLocks({ fingers: deps.fingers, makeFingerLoop: deps.makeFingerLoop, crystals: deps.crystals, sound: deps.sound, emit: deps.emit });
    deps.lantern.onFeel((e) => this.onFeel(e));
  }

  get box(): Box | null {
    return this.current;
  }

  get spec(): BoxSpec | null {
    return this.currentSpec;
  }

  get stage(): Stage {
    return this.stageNow;
  }

  /**
   * For the lifecycle: a box is saved until it opens. While one loads, a resumed box keeps its save; a fresh one has
   * nothing to save yet.
   */
  get phase(): Phase {
    const s = this.stageNow;
    if (s === "loading") return this.pendingSnap ? "playing" : "finished";
    return s === "playing" || (s === "opening" && !this.boxOpenSent) ? "playing" : "finished";
  }

  /** The box the saves are about: the one loading, else the one in play. */
  get saving(): BoxSpec | null {
    return this.stageNow === "loading" ? this.pendingSpec : this.currentSpec;
  }

  /** Play time on this box so far (ms); hidden time never counts. */
  get elapsedMs(): number {
    return this.elapsed;
  }

  get focus(): number | null {
    return this.focused;
  }

  get stuck(): boolean {
    return this.stuckOn;
  }

  /** The panel shows this box's etching and what hangs in the box is shown. */
  get revealed(): boolean {
    return this.current !== null && !this.heldBack;
  }

  isOpen(lock: number): boolean {
    return this.locks[lock]?.open ?? false;
  }

  /** Lock `lock`'s warmth now, 0..1, as measured (before the Warmth setting and the focus). */
  warmth(lock: number): number {
    return this.locks[lock]?.w ?? 0;
  }

  /** The depth lock `lock`'s finger piece formed at, or NaN. */
  crystalOf(lock: number): number {
    return this.locks[lock]?.crystalZ ?? Number.NaN;
  }

  /** Lock `lock`'s coverage as last measured (with the finger), and its finger hold (null for a plain lock). */
  fingerLock(lock: number): { coverage: Readonly<Coverage>; loop: FingerLoop | null } | null {
    const s = this.locks[lock];
    return s ? { coverage: s.cov, loop: this.fingers.loopOf(lock) } : null;
  }

  /** Hints taken on this box, and the level reached per lock. */
  get hints(): HintBook {
    return this.book;
  }

  /**
   * Play `spec`, from `snap` when it is that box's save under this generator version (else afresh). Resolves once the
   * box is in the scene; a later start supersedes one still loading.
   */
  async start(spec: BoxSpec, snap?: BoxSnapshot | null): Promise<void> {
    const token = ++this.token;
    const before = this.stageNow;
    this.stageNow = "loading";
    this.pendingSpec = spec;
    this.pendingSnap = snap ?? null;
    let box: Box;
    try {
      box = await this.deps.boxes.get(spec);
    } catch (err) {
      if (token === this.token) this.stageNow = this.current ? before : "idle";
      throw err;
    }
    if (token !== this.token) return;
    if (this.deps.settings.get().handed === "left") box = mirrorBox(box);
    const keep = snap && snap.key === box.key && snap.gen === GENERATOR_VERSION ? snap : null;
    this.apply(box, spec, keep);
  }

  /** The offered next box (the plate's Next): the next numbered box. */
  next(): Promise<void> {
    if (this.stageNow !== "offered") return Promise.resolve();
    return this.start({ kind: "box", n: this.deps.profiles.profile.nextBox });
  }

  pause(_now: number): void {
    this.paused = true;
  }

  /** Back in view: the first frame counts nothing (the gap before it was hidden time). */
  resume(_now: number): void {
    this.paused = false;
    this.lastT = Number.NaN;
  }

  /** One frame at `tMs` (the frame clock); `frame` is the XR frame (the head's gaze), or null. */
  update(tMs: number, frame: XRFrame | null = null): void {
    const dt = this.tick(tMs);
    if (this.paused || !this.current) return;
    if (this.feelSync) this.syncFeel();
    if (this.heldBack && this.deps.scene.panelArt.etched) {
      this.heldBack = false;
      this.view.reveal();
    }
    const s = this.stageNow;
    if (s === "playing") {
      this.elapsed += dt;
      const opened = this.measureLocks(dt);
      this.rings();
      this.stuckWatch(dt, opened);
      this.gaze(dt, frame);
    } else if (s === "opening" || s === "reward") this.sequence(dt);
    this.act(this.view.update(dt, this.stageNow));
    if (this.phase === "playing" && this.stageNow !== "loading") {
      this.saveMs += dt;
      if (this.saveMs >= SAVE_EVERY_MS) {
        this.saveMs = 0;
        this.saveSoon();
      }
    }
  }

  /** The box as it would be saved now. */
  snapshot(_now?: number): BoxSnapshot {
    const box = this.current;
    if (!box || this.stageNow === "loading") {
      // A box still being built: its save as it was (a resumed box), else a fresh one at the start.
      const s = this.pendingSnap;
      if (s) return { ...s, lantern: [s.lantern[0], s.lantern[1], s.lantern[2]], open: [...s.open], crystal: s.crystal.map((c) => ({ ...c })), hintLevel: { ...s.hintLevel } };
      const spec = this.pendingSpec, x = ENVELOPE.START[0] * (this.deps.settings.get().handed === "left" ? -1 : 1);
      const key = spec && spec.kind !== "lesson" ? seedKey(spec) : "";
      return { key, gen: GENERATOR_VERSION, lantern: [x, ENVELOPE.START[1], ENVELOPE.START[2]], open: [], crystal: [], elapsedMs: 0, hints: 0, hintLevel: {} };
    }
    const p = this.deps.scene.lantern.getPos([0, 0, 0]);
    const open: number[] = [];
    const crystal: { lock: number; z: number }[] = [];
    for (const s of this.locks) {
      if (s.open || s.done) open.push(s.lock.i);
      if (Number.isFinite(s.crystalZ)) crystal.push({ lock: s.lock.i, z: s.crystalZ });
    }
    return { key: box.key, gen: GENERATOR_VERSION, lantern: p, open, crystal, elapsedMs: this.elapsed, hints: this.book.count, hintLevel: this.book.levels() };
  }

  /** The next hint for lock `lock`: 1 its scraps, 2 its rings and line, 3 a marker at the spot's distance, 4 a ghost lantern on the spot. */
  nextHint(lock: number): HintLevel {
    if (!this.locks[lock]) throw new RangeError(`no lock ${lock} in this box`);
    const level = this.book.next(lock);
    const d = this.deps;
    d.emit(HINT[lock]![level - 1]!);
    d.sound.hint(lock, this.view.hintLanternAt(this.at) ? this.at : undefined);
    this.view.hint(lock, level);
    // Help taken: the watch starts over and the hint lantern goes quiet.
    this.watch = new StuckWatch();
    if (this.stuckOn) this.setStuck(false);
    this.saveSoon();
    return level;
  }

  /** The hint lantern's "Hint": the next hint for the lock in focus (else the warmest closed one). Null when all are open. */
  useHint(): HintLevel | null {
    const lock = this.hintTarget();
    return lock < 0 ? null : this.nextHint(lock);
  }

  /** The reward goes into the collection (dropped toward the player, or by itself after 8 s). False when there is none to take. */
  takeReward(): boolean {
    if (this.stageNow !== "reward" || !this.current) return false;
    const box = this.current, d = this.deps;
    collect(d.profiles.profile, box, d.wallNow(), this.elapsed, this.book.count);
    void d.profiles.save();
    d.emit({ type: "reward-taken", key: box.key });
    this.stageNow = "offered";
    this.view.rewardTaken();
    this.view.offerNext(true);
    return true;
  }

  // ---------------------------------------------------------------------------------------------- per box

  private apply(box: Box, spec: BoxSpec, snap: BoxSnapshot | null): void {
    const d = this.deps;
    this.current = box;
    this.currentSpec = spec;
    this.locks = box.locks.map((l) => new LockState(l, prepareLock(l)));
    this.caster = new ShadowCaster(box.elements, SKIP_MISSING);
    this.fingers.setBox(box, this.locks.map((s) => s.samples));
    this.book = new HintBook(box.locks.length);
    this.watch = new StuckWatch();
    this.gazeFocus = new GazeFocus();
    this.focused = null;
    this.stuckOn = false;
    this.openCount = 0;
    this.seqMs = 0;
    this.rewardMs = 0;
    this.boxOpenSent = false;
    this.elapsed = 0;
    this.saveMs = 0;
    this.best = 0;
    this.lastL[0] = Number.NaN;
    this.lastNF = 0;
    d.scene.setBox(box);
    if (snap) {
      const p = snap.lantern;
      d.scene.lantern.setPos([p[0], p[1], Math.max(p[2], LANTERN_MIN_Z)]);
    }
    d.sound.boxStart(spec);
    // The lantern drops out of a hand for the new box: a real release, but a silent one (the box's moment).
    if (d.lantern.grab.holder !== null) d.sound.muteRelease();
    this.view.setBox(box, spec);
    this.view.offerNext(false);
    this.heldBack = true;
    d.emit({ type: "box-start", key: box.key });
    this.stageNow = "playing";
    if (snap) this.restore(snap);
    // The lantern's feel builds its spots for this box on its next frame (all closed): open ones are opened after it.
    this.feelSync = true;
    this.saveSoon();
    d.boxes.prefetch({ kind: "box", n: spec.kind === "box" ? spec.n + 1 : d.profiles.profile.nextBox });
  }

  private restore(snap: BoxSnapshot): void {
    this.elapsed = snap.elapsedMs;
    this.book.restore(snap.hints, snap.hintLevel);
    for (const c of snap.crystal) {
      const s = this.locks[c.lock];
      if (!s || !s.lock.finger || !Number.isFinite(c.z)) continue;
      s.done = true;
      s.crystalZ = c.z;
      this.fingers.place(s.lock, c.z);
    }
    for (const s of this.locks) if ((s.done || snap.open.includes(s.lock.i)) && !s.open) this.openLock(s, true);
    for (const s of this.locks) {
      const level = this.book.levelOf(s.lock.i);
      if (level > 0 && !s.open) this.view.hint(s.lock.i, level as HintLevel);
    }
    // Saved in the moment between the last lock and the box opening: the box opens now.
    if (this.openCount === this.locks.length) {
      this.stageNow = "opening";
      this.seqMs = LOCK_TO_BOX_MS;
    }
  }

  private syncFeel(): void {
    this.feelSync = false;
    for (const s of this.locks) if (s.open || s.done) this.deps.lantern.feel.setOpen(s.lock.i, true);
  }

  // ---------------------------------------------------------------------------------------------- per frame

  private tick(tMs: number): number {
    this.nowMs = tMs;
    const last = this.lastT;
    this.lastT = tMs;
    if (this.paused || !(tMs > last)) return 0;
    const dt = tMs - last;
    return dt < MAX_STEP_MS ? dt : MAX_STEP_MS;
  }

  /** Measure, warm and open the locks; true when one opened this frame. */
  private measureLocks(dt: number): boolean {
    const d = this.deps, fingers = this.fingers;
    const L = d.scene.lantern.getPos(this.L), last = this.lastL;
    const nF = fingers.count;
    const moved = L[0] !== last[0] || L[1] !== last[1] || L[2] !== last[2] || nF > 0 || this.lastNF > 0;
    last[0] = L[0];
    last[1] = L[1];
    last[2] = L[2];
    this.lastNF = nF;
    const warmOn = d.settings.get().warmth;
    let ns = -1, best = 0, opened = false;
    fingers.begin();
    for (let i = 0; i < this.locks.length; i++) {
      const s = this.locks[i]!;
      if (s.open) continue;
      if (s.done) {
        // The piece is forming: the lock opens once it has.
        s.openInMs -= dt;
        if (s.openInMs <= EPS_MS) {
          this.openLock(s, false);
          opened = true;
        }
        continue;
      }
      const lock = s.lock;
      const dx = L[0] - lock.L[0], dy = L[1] - lock.L[1], dz = L[2] - lock.L[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const near = dist <= WARMTH_RANGE;
      if (!near) {
        s.w = 0;
        s.meets = false;
      } else if (moved) {
        if (ns < 0) ns = this.caster.cast(L);
        measure(s.samples, this.caster.polys, ns, fingers.polys, nF, s.cov);
        s.w = warmth(s.cov, dist);
        s.meets = meets(s.cov, lock.finger);
      }
      if (s.w > best) best = s.w;
      if (lock.finger) {
        const z = fingers.update(lock, s.cov, near, dt);
        if (z === z) this.pieceForming(s, z);
      } else {
        s.meetMs = s.meets ? s.meetMs + dt : 0;
        if (s.meetMs >= OPEN_DWELL_MS - EPS_MS) {
          this.openLock(s, false);
          opened = true;
          continue;
        }
      }
      this.showWarmth(s, warmOn ? s.w : 0, dt);
    }
    this.best = best;
    fingers.end();
    return opened;
  }

  /** A finger lock's hold is done: its piece forms at depth `z`, and the lock opens once it has. */
  private pieceForming(s: LockState, z: number): void {
    s.done = true;
    s.crystalZ = z;
    s.openInMs = CRYSTAL_MS;
    this.saveSoon();
  }

  /** Warmth to the panel (only the lock in focus, or every lock while none is), the hum, and the bus. */
  private showWarmth(s: LockState, w: number, dt: number): void {
    const d = this.deps, i = s.lock.i;
    const lit = this.focused === null || this.focused === i ? w : 0;
    d.scene.panelArt.setWarmth(i, lit);
    const k = dt > 0 ? 1 - Math.exp(-dt / WARMTH_EASE_MS) : 0;
    s.smooth += (w - s.smooth) * k;
    if (Math.abs(w - s.smooth) < 1e-3) s.smooth = w;
    d.sound.warmth(i, s.smooth);
    this.sendWarmth(s, lit);
  }

  private sendWarmth(s: LockState, w: number): void {
    if (w === s.sentW || (Math.abs(w - s.sentW) < WARMTH_EVENT_STEP && w !== 0 && w !== 1)) return;
    s.sentW = w;
    const e = this.reused.warmth[s.lock.i]!;
    e.w = w;
    this.deps.emit(e);
  }

  private openLock(s: LockState, restored: boolean): void {
    const d = this.deps, i = s.lock.i;
    s.open = true;
    s.done = true;
    s.w = 0;
    const order = ++this.openCount;
    d.scene.panelArt.setOpen(i, true);
    d.scene.panelArt.setWarmth(i, 0);
    d.lantern.feel.setOpen(i, true);
    this.view.clearHint(i);
    this.view.lockOpened(i, order, restored);
    if (restored) return;
    this.sendWarmth(s, 0);
    d.emit(LOCK_OPEN[i]![order - 1]!);
    d.sound.lockOpened(i);
    this.saveSoon();
    if (order === this.locks.length) {
      this.stageNow = "opening";
      this.seqMs = 0;
    }
  }

  /** Ring events only when a lock's rings line up or part; locks without rings (and open ones) say nothing. */
  private rings(): void {
    const d = this.deps;
    for (let i = 0; i < this.locks.length; i++) {
      const s = this.locks[i]!, l = s.lock;
      if (!l.rings || l.mark === null || s.open) continue;
      const on = d.lantern.feel.aligned(l.i);
      if (on === s.ring) continue;
      s.ring = on;
      d.emit(RING[l.i]![on ? 1 : 0]);
      d.sound.ring(l.i, on);
    }
  }

  private stuckWatch(dt: number, opened: boolean): void {
    const stuck = this.watch.update(dt, this.best, opened);
    if (stuck !== this.stuckOn) this.setStuck(stuck);
  }

  private setStuck(on: boolean): void {
    this.stuckOn = on;
    this.deps.emit(STUCK[on ? 1 : 0]);
    this.view.stuck(on);
    if (!on) return;
    const lock = this.hintTarget();
    if (lock >= 0) this.deps.sound.hint(lock, this.view.hintLanternAt(this.at) ? this.at : undefined, HINT_GLOW_GAIN);
  }

  /** The lock the head's gaze rests on, after the dwell. */
  private gaze(dt: number, frame: XRFrame | null): void {
    const head = this.deps.head;
    const hit = head && head.read(frame, this.origin, this.dir) ? lockOnPanel(this.locks, this.origin, this.dir) : null;
    const f = this.gazeFocus.update(dt, hit);
    if (f === this.focused) return;
    this.focused = f;
    this.deps.emit(FOCUS[f === null ? 0 : f + 1]!);
    this.deps.sound.focus(f);
    this.view.focus(f);
  }

  /** The lock a hint is for: the one in focus if it is still closed, else the warmest closed one, else -1. */
  private hintTarget(): number {
    const f = this.focused;
    if (f !== null && this.locks[f] && !this.locks[f]!.done) return f;
    let best = -1, w = -1;
    for (const s of this.locks) {
      if (s.done || s.w <= w) continue;
      w = s.w;
      best = s.lock.i;
    }
    return best;
  }

  /** From the last lock to the reward: the box opens, the reward rises, and one nobody takes is collected. */
  private sequence(dt: number): void {
    if (this.stageNow === "opening") {
      this.seqMs += dt;
      if (!this.boxOpenSent && this.seqMs >= LOCK_TO_BOX_MS - EPS_MS) this.openBox();
      if (this.seqMs >= LOCK_TO_BOX_MS + REWARD_UP_MS - EPS_MS) {
        this.stageNow = "reward";
        this.rewardMs = 0;
      }
      return;
    }
    this.rewardMs += dt;
    if (this.rewardMs >= REWARD_AUTO_MS - EPS_MS) this.takeReward();
  }

  private openBox(): void {
    const d = this.deps, box = this.current!, p = d.profiles.profile;
    this.boxOpenSent = true;
    d.emit({ type: "box-open", key: box.key });
    d.sound.boxOpened(box.key);
    this.view.boxOpened();
    // Solved: the profile moves on now (the reward goes into the collection when it is taken).
    solveBox(p, this.currentSpec!);
    void d.profiles.save();
    d.boxes.prefetch({ kind: "box", n: p.nextBox });
  }

  private act(a: number): void {
    if (a === 0) return;
    if (a & ACT_HINT && this.stageNow === "playing") this.useHint();
    if (a & ACT_SHOW_ME && this.stageNow === "playing" && this.showMe) {
      const lock = this.hintTarget();
      if (lock >= 0) this.showMe(this.current!.locks[lock]!);
    }
    if (a & ACT_TAKE) this.takeReward();
    if (a & ACT_NEXT) this.next().catch((err) => console.error("the next box could not be built", err));
  }

  /** A lantern feel event: its sound or haptic, and a copy on the bus (none for dial ticks with Warmth off). */
  private onFeel(e: FeelEvent): void {
    if (!this.current || this.paused) return;
    const d = this.deps;
    if (e.type === "tick") {
      if (!d.settings.get().warmth) return;
      d.sound.dialTick(e.cm);
    } else if (e.type === "settle") d.sound.settle();
    d.emit({ type: "feel", e: { ...e } as FeelEvent });
  }

  private saveSoon(): void {
    this.deps.saveSoon?.(this.nowMs);
  }
}
