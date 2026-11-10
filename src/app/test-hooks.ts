// Test hooks: window.__ns and window.__sl. Only built when VITE_TEST_HOOKS=1 (main.ts imports this
// module behind that flag, so production bundles drop it).
import { type BufferGeometry, type Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3, type World } from "@iwsdk/core";
import { generateBox } from "../core/generator";
import { lang } from "../i18n";
import { boxTextFits } from "../ui/box-text";
import { loadCanvasFonts } from "../ui/fonts";
import { panelTextProblems } from "../ui/panel-fits";
import { mirrorBox } from "../core/mirror";
import type { Settings } from "../core/profile";
import { meets, SKIP_MISSING, shadowBuffers, shadowPolys } from "../core/solve";
import type { V2, V3, Vec3 } from "../core/types";
import { handJoints } from "../input/grab-system";
import { HAND_JOINTS } from "../input/hand-joints";
import { FLOOR_ORDER, frameGeometry } from "../render/box-scene";
import { crystallise } from "../render/fx/crystallise";
import { SLAB_ORDER } from "../ui/panel-slab";
import { BOX_ROOT_NAME, boxToWorld, placement, worldToBox } from "../render/placement";
import { slotOf } from "../render/scraps";
import type { Access, FakeBillingState } from "./access";
import type { BoxSession } from "./box-session";
import { emit, type FeedbackEvent, onAny } from "./bus";
import { census, probe } from "./gpu-census";
import type { MenuDrawer } from "./drawer-system";
import type { GameMenus } from "./menu-game";
import { REUSED_EVENT_TYPES } from "./events";
import type { Game, GameView } from "./game";
import { Panels } from "./panels";
import { currentScreen, go } from "./screens";
import type { Shell } from "./shell";
import type { ShellSystem } from "./shell-system";
import type { SfxId } from "../audio/manifest";
import type { PlayOptions } from "../audio/engine";
import type { HandsInBox } from "./hand-system";
import type { Lantern } from "./lantern-system";
import type { Lessons } from "./lessons";
import type { Sound } from "./sound";
import { appSystemName, onAppSystem } from "./systems";
import type { Touches } from "./touch-system";
import type { NsApi, NsButton, NsClock, NsPerf, NsScene, NsSound, NsState, SlApi, SlFeelEvent, SlHand, SlLantern, SlLessons, SlSession } from "./test-api";
import { installVirtualClock, type VirtualClock } from "./virtual-clock";

const MAX_EVENTS = 2000;
const PERF_WINDOW = 240;
const log: FeedbackEvent[] = [];

/** Start recording bus events; call before anything can emit. */
export function startEventLog(): void {
  onAny((e) => {
    // A count-up reuses one event object for its steps, and so do a lock's warmth and finger hold: keep a copy.
    log.push(e.type === "count" || REUSED_EVENT_TYPES.has(e.type) ? { ...e } : e);
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
  // The most draw calls and triangles any one frame rendered since the last reset: read as each update starts, when
  // the renderer's counts still hold the frame just drawn (the first update after a reset reads a frame before it).
  let callsMax = 0;
  let trianglesMax = 0;
  let countFrom = false;
  // Per system: this frame's time and a ring of the last PERF_WINDOW frames (allocation free per frame).
  const per: { name: string; now: number; ring: Float64Array; n: number }[] = [];
  // The whole frame: every system's update (IWSDK's too) and the render after it, a ring of PERF_WINDOW frames each.
  const whole = { update: new Float64Array(PERF_WINDOW), render: new Float64Array(PERF_WINDOW), n: 0, lastRender: 0, pending: -1 };
  const renderer = world.renderer;
  const render = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    const a = realNow();
    render(scene, camera);
    whole.lastRender = realNow() - a;
  };
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
    const drawn = world.renderer.info.render;
    if (countFrom) {
      if (drawn.calls > callsMax) callsMax = drawn.calls;
      if (drawn.triangles > trianglesMax) trianglesMax = drawn.triangles;
    }
    countFrom = true;
    current = 0;
    for (const p of per) p.now = 0;
    // The frame before this one ends here: its update and the render that followed it.
    if (whole.pending >= 0) {
      whole.update[whole.n % PERF_WINDOW] = whole.pending;
      whole.render[whole.n % PERF_WINDOW] = whole.lastRender;
      whole.n++;
    }
    const u0 = realNow();
    update(d, t);
    whole.pending = realNow() - u0;
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
        callsMax: Math.max(callsMax, info.calls),
        trianglesMax: Math.max(trianglesMax, info.triangles),
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
      callsMax = 0;
      trianglesMax = 0;
      countFrom = false;
      for (const p of per) p.n = 0;
      whole.n = 0;
      whole.pending = -1;
    },
    /** The whole frame's update and render times, oldest first (the same window as perf()). */
    whole(): { update: number[]; render: number[] } {
      const n = Math.min(whole.n, PERF_WINDOW), update: number[] = [], render: number[] = [];
      for (let k = whole.n - n; k < whole.n; k++) {
        update.push(whole.update[k % PERF_WINDOW]!);
        render.push(whole.render[k % PERF_WINDOW]!);
      }
      return { update, render };
    },
    /** The named systems' update time per frame, summed, oldest frame first (the same window as perf()). */
    frames(names: string[]): number[] {
      const sel = per.filter((p) => names.includes(p.name));
      if (!sel.length) return [];
      const end = sel[0]!.n;
      const n = Math.min(end, PERF_WINDOW);
      const out: number[] = [];
      for (let k = end - n; k < end; k++) {
        let s = 0;
        for (const p of sel) s += p.ring[k % PERF_WINDOW]!;
        out.push(s);
      }
      return out;
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
  app: {
    sound: Sound;
    lantern: Lantern;
    hands: HandsInBox;
    play: { game: Game; session: BoxSession; view: GameView };
    drawer: MenuDrawer;
    access: Access;
    fakeBilling: FakeBillingState | null;
    menuGame: GameMenus;
    lessons: Lessons;
    touch: Touches;
  },
): void {
  const w = window as unknown as { __vt?: VirtualClock; __ns?: NsApi; __sl?: SlApi };
  // The store link opens nothing in tests (the page must stay offline): it is only recorded.
  const opened: string[] = [];
  shell.openPage = (url) => opened.push(url);
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
  const lan = app.lantern;
  // Through the lantern's controller (the view follows the controller every frame, so a view-only move would not
  // stay), then the shadows cast at once (the box would cast them on its next frame anyway).
  const placeLantern = (p: V3) => {
    lan.place(p);
    box.syncShadows();
  };
  const feelLog: SlFeelEvent[] = [];
  lan.onFeel((e) => feelLog.push({ ...e, at: performance.now() }));
  // The frame's geometry with and without the hidden-overdraw trims (scene.trims).
  let trimmed: BufferGeometry | undefined;
  let untrimmed: BufferGeometry | undefined;
  let probeMesh: Mesh | undefined;
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
    trims: (on) => {
      const frame = box.root.getObjectByName("Box Frame") as Mesh;
      trimmed ??= frame.geometry;
      untrimmed ??= frameGeometry(true);
      frame.geometry = on ? trimmed : untrimmed;
      box.root.getObjectByName("Box Floor")!.renderOrder = on ? FLOOR_ORDER : 0;
      world.scene.traverse((o) => {
        if (o.name === "Panel Slab") o.renderOrder = on ? SLAB_ORDER : 0;
      });
      scene.panelDepth(on);
    },
    panelDepth: (on) => {
      box.panelArt.material.depthWrite = on;
      box.panelArt.shadowMaterial.polygonOffset = on;
    },
    probe: (z) => {
      if (probeMesh) box.root.remove(probeMesh);
      if (z === null) return;
      probeMesh ??= Object.assign(
        new Mesh(new PlaneGeometry(0.5, 0.5), new MeshBasicMaterial({ color: 0xff00ff, transparent: true, depthWrite: false, toneMapped: false })),
        { name: "Probe", renderOrder: 999 },
      );
      probeMesh.position.z = z;
      box.root.add(probeMesh);
    },
  };

  w.__ns = {
    scene,
    state,
    perf: () => timing.perf(),
    perfFrames: (systems) => timing.frames(systems),
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
      drawer: () => {
        const d = app.drawer;
        box.root.updateWorldMatrix(true, false);
        const handle = v3(d.view.handle(tmp).applyMatrix4(box.root.matrixWorld));
        const e = box.root.matrixWorld.elements;
        const toward = v3(tmp2.set(e[8]!, e[9]!, e[10]!).normalize());
        const gap = (h: "left" | "right") => Math.round(handJoints.pinchDistance(h) * 1000) / 1000;
        return {
          state: d.pull.state,
          progress: d.pull.progress,
          out: d.view.out,
          opened: d.pull.opened,
          handle,
          toward,
          hand: d.pull.hand,
          gaps: [gap("left"), gap("right")] as [number, number],
        };
      },
      access: () => ({
        edition: app.access.edition,
        paywall: app.access.paywall,
        ent: app.access.ent ? { ...app.access.ent } : { kind: "pending" },
        canBuy: app.access.canBuy,
      }),
      billing: (patch) => {
        if (!app.fakeBilling) return false;
        Object.assign(app.fakeBilling, patch);
        return true;
      },
      opened: () => [...opened],
      replays: () => app.menuGame.replays.map((r) => ({ ...r })),
      behind: () => app.menuGame.behind(),
      held: () => shell.lifecycle.held,
      profile: (patch) => {
        Object.assign(shell.profiles.profile, patch);
        void shell.profiles.save();
        shell.panels.refresh();
        // The entitlement reads the first launch: work it out again (it repaints on a change).
        void app.access.refresh();
      },
    },
    emit,
    perfWhole: () => timing.whole(),
    gpu: {
      census: (o) => census(world, o),
      probe: (o) => probe(world, { ...o, realNow }),
    },
    headset: () => ({ class: shell.headset?.class ?? "standard", gpu: shell.headset?.gpu ?? null, frameRate: shell.frameRateAsked }),
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

  const lanternNow = (): SlLantern => {
    const c = lan.ctrl;
    return {
      pos: [c.pos[0], c.pos[1], c.pos[2]],
      held: c.held,
      mode: c.mode,
      holder: lan.grab.holder,
      glow: lan.grab.brightness,
      ripple: shell.box.lantern.ringOpacity,
    };
  };

  const lanternAt: V3 = [0, 0, 0];
  const { game, session: ses, view } = app.play;
  const openLocks = (): number[] => (ses.box ? ses.box.locks.filter((l) => ses.isOpen(l.i)).map((l) => l.i) : []);
  const session: SlSession = {
    play: (spec) => game.play(spec),
    continue: () => shell.continueSaved(),
    state: () => {
      const b = ses.box;
      const crystals: { lock: number; z: number }[] = [];
      for (const l of b?.locks ?? []) if (Number.isFinite(ses.crystalOf(l.i))) crystals.push({ lock: l.i, z: ses.crystalOf(l.i) });
      const p = shell.profiles.profile;
      return {
        stage: ses.stage,
        key: b?.key ?? null,
        spec: ses.spec ? { ...ses.spec } : null,
        locks: (b?.locks ?? []).map((l) => ({
          i: l.i,
          center: [l.center[0], l.center[1]] as [number, number],
          size: l.size,
          spot: [l.L[0], l.L[1], l.L[2]] as V3,
          finger: l.finger,
          rings: l.rings,
          hidden: l.hidden,
        })),
        open: openLocks(),
        crystals,
        warmth: (b?.locks ?? []).map((l) => ses.warmth(l.i)),
        focus: ses.focus,
        stuck: ses.stuck,
        hints: ses.hints.count,
        hintLevel: ses.hints.levels(),
        elapsedMs: ses.elapsedMs,
        revealed: ses.revealed,
        phase: ses.phase,
        collected: p.collection.length,
        nextBox: p.nextBox,
        hintGlow: view.hintLantern.glowing,
        hintChoices: view.hintLantern.choicesOpen,
        coach: view.coachLine,
        practice: ses.practice,
      };
    },
    snapshot: () => (ses.box ? ses.snapshot() : null),
    save: () => shell.lifecycle.flush(performance.now(), true),
    keys: () => view.keys(),
    reward: () => {
      const r = view.reward;
      if (!r.group.visible) return null;
      const p = r.position([0, 0, 0]);
      box.root.updateWorldMatrix(true, false);
      return { world: v3(boxToWorld(box.root.matrixWorld, p, tmp)), up: r.up, held: r.held };
    },
    hint: () => ses.useHint(),
  };
  const les = app.lessons;
  const lessons: SlLessons = {
    start: (id, step, practice) => les.start(id, { step, practice }),
    state: () => {
      const d = les.director, f = d.frame, p = shell.profiles.profile;
      const c3 = (v: V3): V3 => [v[0], v[1], v[2]];
      return {
        lesson: d.lesson,
        step: d.step,
        done: d.done,
        replaying: d.replaying,
        running: les.running,
        drawerAllowed: les.drawerAllowed,
        tipping: d.tipping,
        practice: les.practice,
        line: f.line,
        key: f.key,
        why: f.why,
        coach: { text: les.view.coach.text, opacity: les.view.coach.opacity, near: les.view.coachNear },
        ghost: les.view.ghost.opacity,
        form: f.form,
        hand: { opacity: f.hand.opacity, pose: f.hand.poseB, side: f.hand.side, anchor: f.hand.anchor, at: c3(f.hand.at) },
        lamp: { opacity: f.lamp.opacity, at: c3(f.lamp.at) },
        ghostLight: f.ghostLight,
        park: f.park,
        layout: Array.from(f.layout),
        clicks: f.clicks,
        box: f.box,
        frozen: lan.frozen,
        progress: { l1: p.lessons.l1, l2: p.lessons.l2, step: p.lessons.step ? { ...p.lessons.step } : null },
        tipsSeen: [...p.tipsSeen],
      };
    },
    replay: (ex) => les.replay(ex),
  };
  w.__sl = {
    session,
    lessons,
    // What a demo video frame's fingerprint reads: copies, never the session's own arrays.
    frameState: () => {
      const b = ses.box;
      if (!b) return null;
      const L = box.lantern.getPos([0, 0, 0]);
      return { boxKey: b.key, lantern: [L[0], L[1], L[2]], openLocks: openLocks(), screen: currentScreen() };
    },
    lantern: lanternNow,
    placeLantern,
    shadows: () => {
      const b = box.box;
      if (!b) return [];
      const out = shadowBuffers(b.elements, SKIP_MISSING);
      const n = shadowPolys(b.elements, lanternNow().pos, out, SKIP_MISSING);
      return out.slice(0, n).map((poly) => poly.map((p): V2 => [p[0], p[1]]));
    },
    ringLines: () => lan.feel.ctx.lines.map((l) => ({ lock: l.lock, mark: [...l.mark] as V3, dir: [...l.dir] as V3, aligned: l.aligned })),
    feelEvents: () => feelLog.map((e) => ({ ...e })),
    clearFeelEvents: () => {
      feelLog.length = 0;
    },
    hands: () => {
      const h = app.hands;
      const copy = (polys: V2[][], n: number) => polys.slice(0, n).map((poly) => poly.map((p): V2 => [p[0], p[1]]));
      box.root.updateWorldMatrix(true, false);
      const m = box.root.matrixWorld;
      return {
        outlines: copy(h.outlines, h.n),
        finger: copy(h.finger, h.nFinger),
        fingerZ: Number.isFinite(h.fingerZ) ? h.fingerZ : null,
        mask: h.mask.count,
        left: handNow(h, "left", m),
        right: handNow(h, "right", m),
        standIn:
          h.standInBy < 0
            ? null
            : {
                by: h.standInBy === 0 ? "left" : "right",
                front: [h.shadow.standIn[0]!, h.shadow.standIn[1]!, h.shadow.standIn[2]!] as V3,
                back: [h.shadow.standIn[3]!, h.shadow.standIn[4]!, h.shadow.standIn[5]!] as V3,
              },
        version: h.version,
      };
    },
    // The box session's finger locks (it measures them and runs their holds).
    fingerLocks: () =>
      (ses.box?.locks ?? [])
        .filter((l) => l.finger)
        .map((l) => {
          const f = ses.fingerLock(l.i)!;
          return {
            lock: l.i,
            spot: [...l.L] as V3,
            piece: l.target[l.missing]!.map((p): V2 => [p[0], p[1]]),
            state: f.loop?.state ?? "idle",
            progress: f.loop?.progress ?? 0,
            coverage: { ...f.coverage },
            meets: meets(f.coverage, true),
            crystal: box.crystals.piece(l.i),
          };
        }),
    crystallise: (lock, fingerZ) => {
      const l = box.box?.locks[lock];
      if (l) void crystallise(box, l, fingerZ, { reducedMotion: shell.settings.get().reducedMotion });
    },
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
    touch: {
      phone: () => app.touch.phone,
      set: (list) => app.touch.inject(list === null ? null : list.map((t) => ({ id: t.id, at: [t.at[0], t.at[1], t.at[2]] }))),
      roles: () => app.touch.roles(),
    },
    i18n: {
      lang: () => ({ shown: lang(), doc: document.documentElement.lang }),
      texts: () => view.texts(),
      boxFits: async () => {
        await loadCanvasFonts("ja");
        const g = document.createElement("canvas").getContext("2d");
        if (!g) throw new Error("no 2D canvas");
        return boxTextFits(g);
      },
      panelFits: (screen) => {
        const o = shell.panels.panelObject(screen);
        return o ? panelTextProblems(o, { japanese: lang() === "ja", wrote: (id) => shell.panels.wroteOf(screen, id) }) : null;
      },
      forceText: (screen, id, text, raw) => shell.panels.forceText(screen, id, text, raw),
    },
  };
}
