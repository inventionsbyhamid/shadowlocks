// Test hooks: window.__ns and window.__sl. Only built when VITE_TEST_HOOKS=1 (main.ts imports this
// module behind that flag, so production bundles drop it).
import { Quaternion, Vector3, type World } from "@iwsdk/core";
import { generateBox } from "../core/generator";
import { mirrorBox } from "../core/mirror";
import type { Settings } from "../core/profile";
import type { V3, Vec3 } from "../core/types";
import { BOX_ROOT_NAME, boxToWorld, placement } from "../render/placement";
import { slotOf } from "../render/scraps";
import { emit, type FeedbackEvent, onAny } from "./bus";
import { Panels } from "./panels";
import { currentScreen, go } from "./screens";
import type { Shell } from "./shell";
import type { ShellSystem } from "./shell-system";
import type { SfxId } from "../audio/manifest";
import type { PlayOptions } from "../audio/engine";
import type { Sound } from "./sound";
import { appSystemName, onAppSystem } from "./systems";
import type { NsApi, NsButton, NsClock, NsPerf, NsScene, NsSound, NsState, SlApi } from "./test-api";
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

/** Record what the game asks of the audio engine (heard or not: tests often have no gesture). */
function listen(sound: Sound): { log: NsSound[] } {
  const log: NsSound[] = [];
  const e = sound.engine;
  const play = e.play.bind(e);
  e.play = (id: SfxId, o?: PlayOptions) => {
    const s: NsSound = { id, at: performance.now() };
    if (o?.pitch !== undefined) s.pitch = o.pitch;
    if (o?.delay) s.delayMs = o.delay * 1000;
    log.push(s);
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

export function installTestHooks(world: World, shell: Shell, system: ShellSystem, app: { sound: Sound }): void {
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
  const scene: NsScene = {
    show(spec, mirrored = false) {
      const made = generateBox("n" in spec ? { kind: "box", n: spec.n } : { kind: "daily", day: spec.day });
      const b = mirrored ? mirrorBox(made) : made;
      box.setBox(b);
      // The panel etches a new box over several frames; a test sees it etched at once.
      box.panelArt.finishEtch();
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
    setLantern: (p) => box.lantern.setPos(p),
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
      music: () => app.sound.engine.musicInfo(),
    },
  };

  const lanternAt: V3 = [0, 0, 0];
  w.__sl = {
    // No box session yet: the game layer fills this in (box key, lantern, open locks, screen).
    frameState: () => null,
    placeLantern: (p) => {
      box.lantern.setPos(p);
      box.syncShadows();
    },
    lantern: () => box.lantern.getPos([0, 0, 0]),
    setWarmth: (lock, v) => box.panelArt.setWarmth(lock, v),
    setOpen: (lock, open = true) => box.panelArt.setOpen(lock, open),
    panelState: () => ({
      warmth: [...box.panelArt.uniforms.uWarmth.value],
      open: [...box.panelArt.uniforms.uOpen.value],
    }),
    showHanging: (v) => {
      for (const o of [box.scraps.mesh, box.scraps.threads, box.scraps.rings, box.lantern.group]) o.visible = v;
    },
    shadowTimes: (path, batch = 1) => {
      const out: number[] = [];
      const back = box.lantern.getPos(lanternAt);
      const saved: V3 = [back[0], back[1], back[2]];
      for (let i = 0; i + batch <= path.length; i += batch) {
        const t0 = realNow();
        for (let k = 0; k < batch; k++) box.shadows.cast(path[i + k]!);
        out.push((realNow() - t0) / batch);
      }
      box.shadows.cast(saved);
      return out;
    },
    shadowStats: () => ({ vertices: box.shadows.mesh.vertexCount, triangles: box.shadows.mesh.indexCount / 3 }),
    etchTimes: (count) => {
      const panel = box.panelArt, shown = box.box;
      const textures = [panel.uniforms.uAlbedo.value, panel.uniforms.uMasks.value, panel.uniforms.uHalo.value].filter(
        (t): t is NonNullable<typeof t> => t !== null,
      );
      // A one-pixel read makes the canvases finish any drawing they defer.
      const flush = () => {
        for (const t of textures) (t.image as HTMLCanvasElement).getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, 1, 1);
      };
      const total: number[] = [], worstStep: number[] = [], upload: number[] = [], each: number[][] = [];
      let steps = 0;
      for (let i = 0; i < count; i++) {
        let t = realNow();
        panel.setBox(shown);
        flush();
        let worst = realNow() - t, sum = worst;
        const run = [worst];
        steps = 0;
        for (let more = true; more; ) {
          t = realNow();
          more = panel.etchStep();
          flush();
          const d = realNow() - t;
          worst = Math.max(worst, d);
          sum += d;
          run.push(d);
          steps++;
        }
        t = realNow();
        for (const tex of textures) world.renderer.initTexture(tex);
        upload.push(realNow() - t);
        total.push(sum);
        worstStep.push(worst);
        each.push(run);
      }
      // Per step (setBox first), the median over the runs.
      const perStep = (each[0] ?? []).map((_, j) => {
        const xs = each.map((r) => r[j]!).sort((a, b) => a - b);
        return xs[Math.floor(xs.length / 2)]!;
      });
      return { total, worstStep, steps, upload, perStep };
    },
    sound: app.sound.game,
    captions: () => app.sound.captionsShown(),
  };
}
