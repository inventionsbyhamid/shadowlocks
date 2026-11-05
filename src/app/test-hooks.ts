// Test hooks: window.__ns and window.__sl. Only built when VITE_TEST_HOOKS=1 (main.ts imports this
// module behind that flag, so production bundles drop it).
import { type Matrix4, Quaternion, Vector3, type World } from "@iwsdk/core";
import { generateBox } from "../core/generator";
import { mirrorBox } from "../core/mirror";
import type { Settings } from "../core/profile";
import { SKIP_MISSING, shadowBuffers, shadowPolys } from "../core/solve";
import type { V2, V3, Vec3 } from "../core/types";
import { handJoints } from "../input/grab-system";
import { HAND_JOINTS } from "../input/hand-joints";
import { crystallise } from "../render/fx/crystallise";
import { BOX_ROOT_NAME, boxToWorld, placement, worldToBox } from "../render/placement";
import { slotOf } from "../render/scraps";
import { emit, type FeedbackEvent, onAny } from "./bus";
import { Panels } from "./panels";
import { currentScreen, go } from "./screens";
import type { Shell } from "./shell";
import type { ShellSystem } from "./shell-system";
import type { SfxId } from "../audio/manifest";
import type { PlayOptions } from "../audio/engine";
import type { HandsInBox } from "./hand-system";
import type { Lantern } from "./lantern-system";
import type { Sound } from "./sound";
import { appSystemName, onAppSystem } from "./systems";
import type { NsApi, NsButton, NsClock, NsPerf, NsScene, NsSound, NsState, SlApi, SlFeelEvent, SlHand, SlLantern } from "./test-api";
import { installVirtualClock, type VirtualClock } from "./virtual-clock";

const MAX_EVENTS = 2000;
const PERF_WINDOW = 240;
const log: FeedbackEvent[] = [];

/** Start recording bus events; call before anything can emit. */
export function startEventLog(): void {
  onAny((e) => {
    // A count-up reuses one event object for its steps: keep a copy.
    log.push(e.type === "count" ? { ...e } : e);
    // Trimmed in batches: cutting the front of a full log on every event costs the frame that
    // tells it (and so shows up in the timed systems).
    if (log.length > MAX_EVENTS + 500) log.splice(0, log.length - MAX_EVENTS);
  });
}

const v3 = (v: Vector3): Vec3 => [v.x, v.y, v.z];

/**
 * Our systems' update time per frame, measured with the real clock (the virtual one stands still).
 * Covers every system registered through registerAppSystem, before or after this runs.
 */
function instrument(world: World, realNow: () => number) {
  const samples: number[] = [];
  let current = 0;
  let last = 0;
  // Per system: this frame's time and a ring of the last PERF_WINDOW frames (allocation free per frame).
  const per: { name: string; now: number; ring: Float64Array; n: number }[] = [];
  onAppSystem((sys) => {
    const orig = sys.update.bind(sys);
    const mine = { name: appSystemName(sys), now: 0, ring: new Float64Array(PERF_WINDOW), n: 0 };
    per.push(mine);
    sys.update = (d, t) => {
      const a = realNow();
      orig(d, t);
      const ms = realNow() - a;
      current += ms;
      mine.now += ms;
    };
  });
  const update = world.update.bind(world);
  world.update = (d: number, t: number) => {
    current = 0;
    for (const p of per) p.now = 0;
    update(d, t);
    last = current;
    samples.push(current);
    if (samples.length > PERF_WINDOW) samples.shift();
    for (const p of per) {
      p.ring[p.n % PERF_WINDOW] = p.now;
      p.n++;
    }
  };
  const stats = (xs: ArrayLike<number>, n: number) => {
    const sorted = Array.from(xs).slice(0, n).sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
      avg: n ? sum / n : 0,
      p95: n ? (sorted[Math.min(n - 1, Math.floor(n * 0.95))] as number) : 0,
      max: n ? (sorted[n - 1] as number) : 0,
      sum,
    };
  };
  return {
    perf(): NsPerf {
      const info = world.renderer.info.render;
      const all = stats(samples, samples.length);
      const systems: NsPerf["systems"] = {};
      for (const p of per) {
        const n = Math.min(p.n, PERF_WINDOW);
        const st = stats(p.ring, n);
        // Two systems may share a name (say, two of one class): their times add up.
        const prev = systems[p.name];
        systems[p.name] = prev
          ? { avgMs: prev.avgMs + st.avg, p95Ms: prev.p95Ms + st.p95, maxMs: prev.maxMs + st.max, sumMs: prev.sumMs + st.sum }
          : { avgMs: st.avg, p95Ms: st.p95, maxMs: st.max, sumMs: st.sum };
      }
      return {
        calls: info.calls,
        triangles: info.triangles,
        frameMs: last,
        frameMsAvg: all.avg,
        frameMsP95: all.p95,
        frameMsMax: all.max,
        frames: samples.length,
        systems,
      };
    },
    reset() {
      samples.length = 0;
      last = 0;
      for (const p of per) p.n = 0;
    },
  };
}

/** Record what the game asks of the audio engine (it stays silent in tests: no gesture). */
function listen(sound: Sound): { log: NsSound[] } {
  const log: NsSound[] = [];
  const e = sound.engine;
  const play = e.play.bind(e);
  e.play = (id: SfxId, o?: PlayOptions) => {
    log.push(o?.pitch !== undefined ? { id, pitch: o.pitch, at: performance.now() } : { id, at: performance.now() });
    return play(id, o);
  };
  const sting = e.sting.bind(e);
  e.sting = (id) => {
    log.push({ id: `sting:${id}`, at: performance.now() });
    sting(id);
  };
  const music = e.setMusic.bind(e);
  e.setMusic = (state) => {
    if (e.musicState !== state) log.push({ id: `music:${state}`, at: performance.now() });
    music(state);
  };
  return { log };
}

/** One tracked hand for __sl.hands(): its joints in box units, read through the box's matrix. */
function handNow(hands: HandsInBox, side: "left" | "right", m: Matrix4): SlHand | null {
  const v = new Vector3();
  const box = (j: XRHandJoint): V3 => {
    handJoints.joint(side, j, v);
    return worldToBox(m, v, [0, 0, 0]);
  };
  if (!handJoints.tracked(side)) return null;
  const minZ = Math.min(...HAND_JOINTS.map((j) => box(j)[2]));
  return {
    outlines: hands.shadow.cast[side === "left" ? 0 : 1]!,
    minZ,
    index: [box("index-finger-phalanx-intermediate"), box("index-finger-phalanx-distal"), box("index-finger-tip")],
  };
}

export function installTestHooks(
  world: World,
  shell: Shell,
  system: ShellSystem,
  app: { sound: Sound; lantern?: Lantern; hands?: HandsInBox },
): void {
  const w = window as unknown as { __vt?: VirtualClock; __ns?: NsApi; __sl?: SlApi };
  const realNow = w.__vt ? w.__vt.realNow : performance.now.bind(performance);
  const timing = instrument(world, realNow);
  const tmp = new Vector3();
  const tmp2 = new Vector3();
  const tmpQ = new Quaternion();
  const sounds = listen(app.sound);

  const clock: NsClock = {
    get paused() {
      return !!w.__vt?.enabled;
    },
    pause() {
      installVirtualClock(true, window);
    },
    step(ms = 1000 / 72) {
      const vt = installVirtualClock(true, window);
      return vt.step(ms).now;
    },
    resume() {
      w.__vt?.resume();
    },
    now: () => performance.now(),
  };

  const state = (): NsState => {
    const screen = currentScreen();
    const buttons: NsButton[] = shell.panels.buttons(screen).map((b) => {
      b.object.getWorldPosition(tmp);
      tmp2.set(0, 0, 1).applyQuaternion(b.object.getWorldQuaternion(tmpQ));
      return { id: b.id, world: v3(tmp), normal: v3(tmp2), size: Panels.sizeOf(b.object) };
    });
    const pose = placement.pose();
    const head = world.session ? v3(world.player.head.getWorldPosition(tmp)) : null;
    const root = world.scene.getObjectByName(BOX_ROOT_NAME);
    let drawn = !!root;
    root?.traverseAncestors((o) => {
      if (!o.visible) drawn = false;
    });
    return {
      screen,
      buttons,
      xr: {
        presenting: world.renderer.xr.isPresenting,
        sessionMode: shell.sessionMode,
        blendMode: world.session?.environmentBlendMode ?? null,
        visibility: String(world.visibilityState.value),
      },
      boxPose: { position: [...pose.position] as Vec3, yaw: pose.yaw, source: placement.source },
      box: {
        exists: !!root && shell.box.entity.object3D === root,
        world: root ? v3(root.getWorldPosition(tmp)) : null,
        sizeM: shell.box.size,
        visible: drawn && !!root?.visible,
      },
      head,
      persistent: shell.profiles.persistent,
      notice: shell.profiles.pendingNotice,
    };
  };

  const box = shell.box;
  const lan = app.lantern ?? null;
  // Through the lantern's controller when there is one (the view follows it every frame).
  const placeLantern = (p: V3) => (lan ? lan.place(p) : box.lantern.setPos(p));
  const feelLog: SlFeelEvent[] = [];
  lan?.onFeel((e) => feelLog.push({ ...e, at: performance.now() }));
  const scene: NsScene = {
    show(spec, mirrored = false) {
      const made = generateBox("n" in spec ? { kind: "box", n: spec.n } : { kind: "daily", day: spec.day });
      const b = mirrored ? mirrorBox(made) : made;
      box.setBox(b);
      return b.key;
    },
    box() {
      const b = box.box;
      return (
        b && {
          key: b.key,
          spots: b.locks.map((l) => [...l.L] as V3),
          start: [...b.start] as V3,
          mirrored: b.mirrored,
          missing: b.locks.map((l) => l.missing),
        }
      );
    },
    // What is drawn: the box root's world matrix, not the placement it was given.
    toWorld: (points) => {
      box.root.updateWorldMatrix(true, false);
      return points.map((p) => v3(boxToWorld(box.root.matrixWorld, p, tmp)));
    },
    matrix: () => {
      box.root.updateWorldMatrix(true, false);
      return [...box.root.matrixWorld.elements];
    },
    setLantern: placeLantern,
    lantern: () => box.lantern.getPos([0, 0, 0]),
    setScrap: (lock, piece, o) => {
      const h = box.scrapMesh(lock, piece);
      if (o.glow !== undefined) h.setGlow(o.glow);
      if (o.visible !== undefined) h.setVisible(o.visible);
    },
    scrap: (lock, piece) => {
      const s = slotOf(lock, piece);
      return { glow: box.scraps.slots[s * 2]!, visible: box.scraps.slots[s * 2 + 1] === 1 };
    },
    draws: () => box.drawStats(),
    setVisible: (v) => {
      box.root.visible = v;
    },
  };

  w.__ns = {
    scene,
    state,
    perf: () => timing.perf(),
    resetPerf: () => timing.reset(),
    clock,
    events: (type) => (type ? log.filter((e) => e.type === type) : [...log]),
    clearEvents: () => {
      log.length = 0;
    },
    recenter: () => system.recenter(),
    world,
    ui: {
      busy: () => shell.panels.busy,
      text: (id) => shell.panels.textOf(id),
      settings: () => ({ ...shell.settings.get() }),
      setSettings: (patch) => void shell.settings.set(patch as Partial<Settings>),
      go,
      key: (id) => shell.panels.keyState(id),
      layoutHeld: () => shell.panels.layoutHeld,
      capCount: () => shell.panels.capCount,
      slabCount: () => shell.panels.slabCount,
      panelBox: (screen) => shell.panels.panelBox(screen),
      panelPosition: (screen) => {
        const o = shell.panels.panelObject(screen);
        return o ? v3(o.getWorldPosition(tmp)) : null;
      },
    },
    emit,
    audio: {
      log: () => sounds.log.map((x) => ({ ...x })),
      clear: () => {
        sounds.log.length = 0;
      },
      ready: () => app.sound.loaded,
      running: () => app.sound.engine.running,
      voices: () => app.sound.engine.activeVoices,
    },
  };

  const lanternNow = (): SlLantern => {
    if (!lan) return { pos: box.lantern.getPos([0, 0, 0]), held: false, mode: "free", holder: null, glow: 0 };
    const c = lan.ctrl;
    return { pos: [c.pos[0], c.pos[1], c.pos[2]], held: c.held, mode: c.mode, holder: lan.grab.holder, glow: lan.grab.brightness };
  };

  w.__sl = {
    // No box session yet: the game layer fills this in (box key, lantern, open locks, screen).
    frameState: () => null,
    lantern: lanternNow,
    placeLantern,
    shadows: () => {
      const b = box.box;
      if (!b) return [];
      const out = shadowBuffers(b.elements, SKIP_MISSING);
      const n = shadowPolys(b.elements, lanternNow().pos, out, SKIP_MISSING);
      return out.slice(0, n).map((poly) => poly.map((p): V2 => [p[0], p[1]]));
    },
    ringLines: () =>
      lan
        ? lan.feel.ctx.lines.map((l) => ({ lock: l.lock, mark: [...l.mark] as V3, dir: [...l.dir] as V3, aligned: l.aligned }))
        : [],
    feelEvents: () => feelLog.map((e) => ({ ...e })),
    clearFeelEvents: () => {
      feelLog.length = 0;
    },
    hands: () => {
      const h = app.hands;
      const copy = (polys: V2[][], n: number) => polys.slice(0, n).map((poly) => poly.map((p): V2 => [p[0], p[1]]));
      if (!h) return { outlines: [], finger: [], fingerZ: null, mask: 0, left: null, right: null };
      box.root.updateWorldMatrix(true, false);
      const m = box.root.matrixWorld;
      return {
        outlines: copy(h.outlines, h.n),
        finger: copy(h.finger, h.nFinger),
        fingerZ: Number.isFinite(h.fingerZ) ? h.fingerZ : null,
        mask: h.mask.count,
        left: handNow(h, "left", m),
        right: handNow(h, "right", m),
      };
    },
    fingerLocks: () =>
      (app.hands?.locks ?? []).map((e) => ({
        lock: e.lock.i,
        spot: [...e.lock.L] as V3,
        piece: e.lock.target[e.lock.missing]!.map((p): V2 => [p[0], p[1]]),
        state: e.loop.state,
        progress: e.loop.progress,
        coverage: { ...e.coverage },
        meets: e.meets,
        crystal: box.crystals.piece(e.lock.i),
      })),
    crystallise: (lock, fingerZ) => {
      const l = box.box?.locks[lock];
      if (l) void crystallise(box, l, fingerZ, { reducedMotion: shell.settings.get().reducedMotion });
    },
  };
}
