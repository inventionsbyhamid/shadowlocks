// The game in the app: the box session wired to the real box scene, lantern, sounds and profile; what the player
// sees of it beyond the panel (GameView: lock and box celebrations, the reward, the plate, the hint lantern, the hint
// and focus marks); the head's gaze ray; and how boxes start (a numbered box, the Daily Box, Continue, the `?box=N`
// field flag). The session runs as the "game" system right after the hands (priority -2.8), before the box scene
// draws the frame.
import { createSystem, type Object3D, Vector3, type World } from "@iwsdk/core";
import { createBoxClient } from "../core/box-client";
import { todayKey } from "../core/daily";
import { seedKey, specOfKey } from "../core/generator";
import type { BoxSnapshot } from "../core/profile";
import type { Box, BoxSpec, V3, Vec3 } from "../core/types";
import { hands } from "../input/grab-system";
import { pressGate } from "../input/poke";
import type { BoxScene } from "../render/box-scene";
import { BoxOpenFx } from "../render/fx/box-open";
import { crystallise } from "../render/fx/crystallise";
import { LockOpenFx } from "../render/fx/lock-open";
import { worldToBox } from "../render/placement";
import { Reward, type RewardHands } from "../render/reward";
import { type FrameTips, frameTips } from "../ui/fingertips";
import { HINT_ASK, HintLantern } from "../ui/hint-lantern";
import { NO_TIPS } from "../ui/key-view";
import { COPY } from "../ui/copy";
import { Plate } from "../ui/plate";
import { BoxSession } from "./box-session";
import { FingerLockLoop } from "./finger-lock";
import type { FingerSource } from "./session-fingers";
import { emit } from "./bus";
import type { CoachLine, HintLevel } from "./events";
import { HintMarks } from "./hints";
import type { Lantern } from "./lantern-system";
import type { Lifecycle, LifecycleSession } from "./lifecycle";
import type { ProfileStore } from "./profile-store";
import { go } from "./screens";
import { ACT_HINT, ACT_NEXT, ACT_SHOW_ME, ACT_TAKE, type HeadRay, type SessionView, type Stage } from "./session-deps";
import type { SettingsStore } from "./settings";
import type { GameFlow } from "./shell";
import type { Sound } from "./sound";
import { registerAppSystem } from "./systems";

export interface GameViewDeps {
  world: World;
  scene: BoxScene;
  settings: SettingsStore;
  lantern: Pick<Lantern, "grab">;
  /** "Show me" can be offered (the lessons wired it). */
  canShowMe: () => boolean;
}

/** The session as the player sees it beyond the panel (the box scene draws the panel, scraps and lantern). */
export class GameView implements SessionView {
  readonly marks: HintMarks;
  readonly lockFx: LockOpenFx;
  readonly boxFx: BoxOpenFx;
  readonly reward: Reward;
  readonly plate: Plate;
  readonly hintLantern: HintLantern;
  private readonly tips: FrameTips;
  private readonly hands: RewardHands;
  private box: Box | null = null;
  private readonly lanternAt: V3 = [0, 0, 0];
  private readonly drawer: V3 = [0, 0, 0];
  /** The coach line shown now (for the test hooks), or null. */
  coachLine: CoachLine | null = null;

  constructor(private readonly d: GameViewDeps) {
    const scene = d.scene, root = scene.root;
    this.marks = new HintMarks(scene);
    // The box's one flash budget (the scene steps it): lock and box celebrations, the lantern's flares and the
    // crystallises share the three-a-second cap.
    this.lockFx = new LockOpenFx(scene, scene.flashes);
    this.boxFx = new BoxOpenFx(root, scene.flashes);
    this.reward = new Reward(root);
    this.plate = new Plate(root);
    this.hintLantern = new HintLantern(root, d.canShowMe);
    this.tips = frameTips(d.world);
    this.hands = {
      point: (i, out) => {
        const h = hands[i];
        if (!h.tracked) return false;
        worldToBox(root.matrixWorld, h.point, out);
        return true;
      },
      pinching: (i) => hands[i].pinching,
      started: (i) => hands[i].edge === "start",
      busy: (i) => d.lantern.grab.holding(i),
    };
  }

  setBox(box: Box, spec: BoxSpec): void {
    this.box = box;
    this.marks.setBox(box);
    this.lockFx.setBox(box);
    this.boxFx.reset();
    this.reward.setBox(box);
    this.plate.setBox(box, spec);
    this.hintLantern.reset(true, this.d.settings.get().handed === "left" ? 1 : -1);
    this.hold(true);
  }

  reveal(): void {
    this.hold(false);
  }

  lockOpened(lock: number, _order: number, restored: boolean): void {
    this.plate.latch(lock, true);
    this.lockFx.open(lock, restored);
  }

  focus(lock: number | null): void {
    this.marks.focus(lock);
  }

  stuck(on: boolean): void {
    this.hintLantern.setGlow(on);
  }

  hint(lock: number, level: HintLevel): void {
    this.marks.show(lock, level);
  }

  clearHint(lock: number): void {
    this.marks.clear(lock);
  }

  boxOpened(): void {
    // The drawer opens on the side away from the lantern, so reaching for the reward never grabs the lantern.
    const L = this.d.scene.lantern.getPos(this.lanternAt);
    this.boxFx.start(L[0] >= 0 ? -1 : 1);
    this.reward.rise(this.boxFx.drawerTop(this.drawer));
    this.marks.focus(null);
    this.hintLantern.reset(false, this.d.settings.get().handed === "left" ? 1 : -1);
  }

  rewardTaken(): void {
    this.reward.take();
  }

  offerNext(on: boolean): void {
    this.plate.offerNext(on);
  }

  hintLanternAt(out: Vec3): boolean {
    return this.hintLantern.worldPos(out);
  }

  coach(line: CoachLine | null): void {
    this.coachLine = line;
    this.plate.coach(line ? COPY.game[line] : null);
  }

  update(dtMs: number, stage: Stage): number {
    const dt = dtMs / 1000, reduced = this.d.settings.get().reducedMotion;
    this.lockFx.update(dt, reduced);
    this.boxFx.update(dt, reduced);
    const tips = stage === "idle" || stage === "loading" ? NO_TIPS : this.tips.read();
    let acts = 0;
    if (this.plate.update(tips, this.press)) acts |= ACT_NEXT;
    const ask = this.hintLantern.update(dt, stage === "playing" ? tips : NO_TIPS, reduced, this.press);
    if (ask === HINT_ASK.hint) acts |= ACT_HINT;
    else if (ask === HINT_ASK.showMe) acts |= ACT_SHOW_ME;
    if (this.reward.update(dt, this.hands, stage === "reward", this.d.scene.size * 100, reduced)) acts |= ACT_TAKE;
    return acts;
  }

  /** The box's keys and their states, for the test hooks. */
  keys() {
    return [this.plate.next, this.hintLantern.lantern, this.hintLantern.hint, this.hintLantern.showMe].map((k) => ({
      id: k.id,
      live: k.live && k.group.visible && this.visible(k.group),
      ...k.pose(),
    }));
  }

  /** A key clicked down: through the shared press gate, then `press` on the bus (its click sound). */
  private readonly press = (id: string): boolean => {
    if (!pressGate.accept(performance.now())) return false;
    emit({ type: "press", id });
    return true;
  };

  private visible(o: Object3D): boolean {
    for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  /** Hold back what hangs in the box (until the panel shows this box's etching), or show it. */
  private hold(on: boolean): void {
    const s = this.d.scene;
    for (const o of [s.scraps.mesh, s.scraps.threads, s.scraps.rings]) o.visible = !on;
    s.shadows.mesh.mesh.visible = !on && this.box !== null;
  }
}

/** The head's gaze from the player's head (IWSDK keeps it on the XR viewer pose), in box units. */
export function playerHead(world: World, root: Object3D): HeadRay {
  const pos = new Vector3(), ahead = new Vector3(), tip: V3 = [0, 0, 0];
  return {
    read(_frame, origin, dir) {
      const head = world.player?.head;
      if (!head) return false;
      head.updateWorldMatrix(true, false);
      const e = head.matrixWorld.elements;
      // Forward is the head's -z axis.
      pos.set(e[12]!, e[13]!, e[14]!);
      ahead.set(e[12]! - e[8]!, e[13]! - e[9]!, e[14]! - e[10]!);
      worldToBox(root.matrixWorld, pos, origin);
      worldToBox(root.matrixWorld, ahead, tip);
      dir[0] = tip[0] - origin[0];
      dir[1] = tip[1] - origin[1];
      dir[2] = tip[2] - origin[2];
      return true;
    },
  };
}

/** What the game needs of the shell. */
export interface GameShell {
  readonly lifecycle: Lifecycle;
  readonly profiles: ProfileStore;
  continueSaved(): boolean;
}

/** How boxes start, and the flow the shell hands saved boxes to. */
export class Game implements GameFlow {
  constructor(
    readonly session: BoxSession,
    private readonly shell: GameShell,
  ) {}

  /** Play `spec` now (from `snap` when it is that box's save): the play screen, the lifecycle saving it. */
  play(spec: BoxSpec, snap: BoxSnapshot | null = null, practice = false): void {
    if (this.shell.lifecycle.session !== this.session) this.shell.lifecycle.attach(this.session, performance.now());
    go("play");
    this.run(spec, snap, practice);
  }

  /** Continue: the numbered box in progress, else the next one. */
  playNext(): void {
    const p = this.shell.profiles.profile;
    if (p.current) this.shell.continueSaved();
    else this.play({ kind: "box", n: p.nextBox });
  }

  /** Today's Daily Box (its save when it is today's). */
  playDaily(nowMs: number): void {
    const spec: BoxSpec = { kind: "daily", day: todayKey(nowMs) };
    const cur = this.shell.profiles.profile.daily.current;
    this.play(spec, cur && cur.key === seedKey(spec) ? cur : null);
  }

  /** The `?box=N` field flag: box N as practice. */
  playBox(n: number): void {
    // A practice box: played from the start, never saved, never solved into the player's progress. The box in
    // progress, the next box, the collection and the streak stay as they were.
    this.play({ kind: "box", n }, null, true);
  }

  /** GameFlow: resume a saved box (Continue). Throws for a save that names no box. */
  resume(snapshot: BoxSnapshot): LifecycleSession {
    const spec = specOfKey(snapshot.key);
    if (!spec) throw new Error(`a saved box with no box to play: "${snapshot.key}"`);
    this.run(spec, snapshot);
    return this.session;
  }

  /** GameFlow: which save the session's snapshots go to. */
  slot(): "box" | "daily" | null {
    const s = this.session.saving;
    return s && (s.kind === "box" || s.kind === "daily") ? s.kind : null;
  }

  private run(spec: BoxSpec, snap: BoxSnapshot | null, practice = false): void {
    this.session.start(spec, snap, { practice }).catch((err) => {
      console.error("the box could not be built", err);
      // A save that cannot be played on is let go, so it is not offered again.
      if (snap && spec.kind === "box") void this.shell.profiles.setCurrent(null);
      if (snap && spec.kind === "daily") void this.shell.profiles.setDailyCurrent(null);
      go("home");
    });
  }
}

let current: BoxSession | null = null;

/** The box session's frame (timed in the per-frame budget as "game"). */
export class GameSystem extends createSystem({}) {
  update(): void {
    current?.update(performance.now(), (this.xrFrame ?? null) as XRFrame | null);
  }
}

export interface GameDeps {
  world: World;
  shell: { readonly box: BoxScene; readonly settings: SettingsStore; markDirty(now: number): void; useFlow(flow: GameFlow): void } & GameShell;
  lantern: Lantern;
  sound: Pick<Sound, "game">;
  /** The hands in the box: the finger locks' finger source. */
  hands: FingerSource;
}

/** The game: the box session and its view, registered as the "game" system. Call once, after the lantern and the hands. */
export function attachGame(d: GameDeps): { game: Game; session: BoxSession; view: GameView } {
  const { world, shell } = d;
  const scene = shell.box;
  let session: BoxSession | null = null;
  const view = new GameView({ world, scene, settings: shell.settings, lantern: d.lantern, canShowMe: () => session?.showMe != null });
  session = new BoxSession({
    // The finger locks (session-fingers.ts): the hands' finger shadow, a FingerLockLoop per finger lock, and the
    // piece forming where the finger was (or put back at once for a resumed box).
    fingers: d.hands,
    makeFingerLoop: (onDone) => new FingerLockLoop(onDone),
    crystals: {
      crystallise: (lock, z) => void crystallise(scene, lock, z, { reducedMotion: shell.settings.get().reducedMotion }),
      place: (lock, z) => scene.crystals.place(lock, z),
    },
    scene: shell.box,
    lantern: d.lantern,
    boxes: createBoxClient(),
    profiles: shell.profiles,
    settings: shell.settings,
    sound: d.sound.game,
    emit,
    wallNow: () => Date.now(),
    head: playerHead(world, shell.box.root),
    view,
    saveSoon: (now) => shell.markDirty(now),
  });
  const game = new Game(session, shell);
  shell.useFlow(game);
  current = session;
  registerAppSystem(world, GameSystem, { priority: -2.8, name: "game" });
  return { game, session, view };
}
