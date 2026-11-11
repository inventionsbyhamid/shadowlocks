/* eslint-disable @typescript-eslint/no-explicit-any */
// The soak (soak.spec.ts, soak-long.spec.ts, soak-paths.spec.ts): a long session played without a reload, and what it
// leaves behind, counted every so often in the same state of play.
//
// A sample counts the renderer's geometries, textures and shader programs, the scene's objects, the ECS's live
// entities, the listeners on the app's bus, on the window, the document, the canvas and the XR session and on three's
// XR manager, the Web Audio nodes wired into the graph, the sources playing and the audio buffers alive (countAudioNodes,
// an init script), the JS heap after a forced GC, and the profile as stored. Before every heap sample it clears the three logs only a test
// build keeps and nothing caps (the hooks' sound log and lantern feel log, and the IWER command results the helpers
// keep), so the heap measured is the game's: the audit found nothing else that grows with play.
//
// The boxes are played the fastest honest way, as session.spec plays them: the lantern put on each plain lock's spot
// through its controller, an IWER index finger laid in a finger lock's gap, the reward taken by hand toward the player
// and the plate's Next poked by a fingertip, all on the virtual clock. (The jitter bot plays a box in about 40 s of
// real time; 60 boxes would take about 40 minutes.)
import type { CDPSession, TestInfo } from "@playwright/test";
import type { SlKey, SlSessionState } from "../../../src/app/test-api";
import type { Vec3 } from "../../../src/core/types";
import { SEATED } from "./boot";
import { CHROME_ARGS } from "./chromium";
import { axisOf, fingerLocks, onRay, Pointer, worldOf } from "./finger";
import { Hands } from "./hands";
import { add, sub, unit } from "./lantern";
import { type PlayWindow, boxInPlay, timedWindows } from "./perf-play";
import { setHeadset, type XYZ } from "./page-scripts";
import { judgeWindows, judgeWindowsP95, MAX_STALLS, STALL_MS } from "./stall-rule";
import { expect } from "./test";
import { addRunNote, POKE_DEPTH_M, type XrApp } from "./xr-app";

/**
 * The soak's browser: Chromium's autoplay policy lifted (the engine still waits for a gesture of its own, the first
 * grab), and V8's `gc()` exposed so a sample measures the heap after a full collection. With `jit`, the JIT flags
 * perf-budget times with, so the reference box's code is optimised within its warm-up sweeps.
 */
export function soakArgs(jit: boolean): string[] {
  const js = ["--expose-gc", ...(jit ? ["--invocation-count-for-maglev=5", "--invocation-count-for-turbofan=30"] : [])];
  return [...CHROME_ARGS, "--autoplay-policy=no-user-gesture-required", `--js-flags=${js.join(" ")}`];
}

/**
 * Page script (addInitScript, before boot): counts the Web Audio graph without holding on to any of it. `connected`:
 * nodes with an outgoing connection now (a node wired into the graph is kept alive by it, so this is what a leak of
 * nodes grows); `started` and `ended`: sources started, and their `ended` events; `created`: every node made (it grows
 * with play: reported only). Audio buffers too, decoded or made: `buffers` and `pcm` (bytes of 32-bit samples) are the
 * ones still alive (a FinalizationRegistry takes each collected one off), and `decodes` each decode's file bytes, PCM
 * bytes and real ms from the call to its buffer (the real clock, taken before the virtual one is installed).
 */
export function countAudioNodes(): void {
  const w = window as any;
  if (w.__soakAudio) return;
  const realNow = performance.now.bind(performance);
  const stats = { created: 0, connected: 0, started: 0, ended: 0, buffers: 0, pcm: 0, decodes: [] as { file: number; pcm: number; ms: number; at: number }[] };
  w.__soakAudio = stats;
  const out = new WeakMap<object, number>();
  const ctx = (w.BaseAudioContext ?? w.AudioContext)?.prototype;
  if (!ctx) return;
  const gone = new FinalizationRegistry<number>((bytes) => {
    stats.buffers--;
    stats.pcm -= bytes;
  });
  const keep = (b: AudioBuffer): number => {
    const bytes = b.length * b.numberOfChannels * 4;
    stats.buffers++;
    stats.pcm += bytes;
    gone.register(b, bytes);
    return bytes;
  };
  const createBuffer = ctx.createBuffer;
  ctx.createBuffer = function (this: unknown, ...args: unknown[]) {
    const b = createBuffer.apply(this, args) as AudioBuffer;
    keep(b);
    return b;
  };
  const decode = ctx.decodeAudioData;
  ctx.decodeAudioData = function (this: unknown, data: ArrayBuffer, ...rest: unknown[]) {
    const t0 = realNow(), file = data?.byteLength ?? 0;
    return (decode.call(this, data, ...rest) as Promise<AudioBuffer>).then((b) => {
      stats.decodes.push({ file, pcm: keep(b), ms: realNow() - t0, at: t0 });
      return b;
    });
  };
  for (const name of Object.getOwnPropertyNames(ctx)) {
    if (!/^create[A-Z]/.test(name) || name === "createBuffer" || name === "createPeriodicWave") continue;
    const real = Object.getOwnPropertyDescriptor(ctx, name)?.value;
    if (typeof real !== "function") continue;
    ctx[name] = function (this: unknown, ...args: unknown[]) {
      const n = real.apply(this, args);
      stats.created++;
      return n;
    };
  }
  const node = w.AudioNode.prototype;
  const connect = node.connect;
  node.connect = function (this: object, ...args: unknown[]) {
    const r = connect.apply(this, args);
    const k = out.get(this) ?? 0;
    if (k === 0) stats.connected++;
    out.set(this, k + 1);
    return r;
  };
  const disconnect = node.disconnect;
  node.disconnect = function (this: object, ...args: unknown[]) {
    const r = disconnect.apply(this, args);
    const k = out.get(this) ?? 0;
    if (k > 0) {
      // disconnect() lets go of every output; disconnect(dest) of the connections to that one.
      const left = args.length === 0 ? 0 : k - 1;
      out.set(this, left);
      if (left === 0) stats.connected--;
    }
    return r;
  };
  for (const C of [w.AudioScheduledSourceNode, w.AudioBufferSourceNode]) {
    const p = C?.prototype;
    if (!p || !Object.prototype.hasOwnProperty.call(p, "start")) continue;
    const start = p.start;
    p.start = function (this: EventTarget, ...args: unknown[]) {
      stats.started++;
      this.addEventListener("ended", () => stats.ended++, { once: true });
      return start.apply(this, args);
    };
  }
}

/** What a long session has left behind at one moment (see the header). */
export interface Sample {
  label: string;
  geometries: number;
  textures: number;
  programs: number;
  objects: number;
  entities: number;
  /** ECS entity slots ever made (a slot is reused once its entity is gone): reported only. */
  entitySlots: number;
  bus: number;
  /** Listeners on window, document, the canvas and the XR session (CDP), and on three's XR manager. */
  dom: Record<string, number>;
  threeXr: number;
  audio: { connected: number; playing: number; created: number; buffers: number; pcmMB: number; music: boolean };
  heapKB: number;
  profileBytes: number;
  collection: number;
}

/** The counts that must not change over a session (everything but the heap, the profile and what is only reported). */
export function counts(s: Sample): Record<string, number> {
  const c: Record<string, number> = {
    geometries: s.geometries,
    textures: s.textures,
    programs: s.programs,
    objects: s.objects,
    entities: s.entities,
    bus: s.bus,
    threeXr: s.threeXr,
    audioConnected: s.audio.connected,
    audioPlaying: s.audio.playing,
    audioBuffers: s.audio.buffers,
  };
  for (const [k, v] of Object.entries(s.dom)) c[`dom.${k}`] = v;
  return c;
}

/** Page script: the stored profile's size (JSON characters) and collection; null when none is stored. */
function storedProfile(): Promise<{ bytes: number; collection: number } | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("shadow-locks");
    let missing = false;
    req.onupgradeneeded = () => {
      missing = true;
      req.transaction?.abort();
    };
    req.onerror = () => (missing ? resolve(null) : reject(req.error ?? new Error("IndexedDB open failed")));
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains("profile")) {
          db.close();
          resolve(null);
          return;
        }
        const get = db.transaction("profile", "readonly").objectStore("profile").get("me");
        get.onsuccess = () => {
          db.close();
          const p = get.result as { collection?: unknown[] } | undefined;
          resolve(p ? { bytes: JSON.stringify(p).length, collection: p.collection?.length ?? 0 } : null);
        };
        get.onerror = () => {
          db.close();
          reject(get.error ?? new Error("IndexedDB read failed"));
        };
      } catch (e) {
        db.close();
        reject(e);
      }
    };
  });
}

/** Listeners on the page's event targets, through the DevTools protocol (-1 where one cannot be read). */
async function domListeners(cdp: CDPSession): Promise<Record<string, number>> {
  const targets: [string, string][] = [
    ["window", "window"],
    ["document", "document"],
    ["canvas", "window.__ns.world.renderer.domElement"],
    ["session", "window.__ns.world.renderer.xr.getSession()"],
  ];
  const out: Record<string, number> = {};
  for (const [name, expression] of targets) {
    try {
      const r = (await cdp.send("Runtime.evaluate", { expression, objectGroup: "soak" })) as any;
      const id = r.result?.objectId as string | undefined;
      if (!id) {
        out[name] = -1;
        continue;
      }
      const l = (await cdp.send("DOMDebugger.getEventListeners", { objectId: id, depth: 0 })) as any;
      out[name] = (l.listeners as unknown[]).length;
    } catch {
      out[name] = -1;
    }
  }
  await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "soak" });
  return out;
}

/** Real ms the audio gets to settle before a sample: sounds end in real time (the virtual clock does not hold them). */
const AUDIO_SETTLE_MS = 8_000;

/**
 * One sample (see the header). Takes the test-build-only logs out of the heap first (the hooks' sound and feel logs,
 * the IWER command results), lets the effects playing in real time end, and collects garbage fully.
 */
export async function sample(app: XrApp, cdp: CDPSession, label: string): Promise<Sample> {
  const page = app.page;
  await page.evaluate(() => {
    const w = window as any;
    w.__ns.clearEvents();
    w.__ns.audio.clear();
    w.__sl.clearFeelEvents();
    const c = w.__nsCmd;
    if (c) {
      c.results = {};
      c.history.length = 0;
    }
  });
  // No voice left, and the sources playing steady for half a second (a sting or a tune note ending).
  const end = Date.now() + AUDIO_SETTLE_MS;
  let last = -1, steadySince = Date.now();
  for (;;) {
    const a = await page.evaluate(() => {
      const w = window as any;
      const s = w.__soakAudio;
      const voices: number = w.__ns.audio.voices();
      const playing: number = s ? s.started - s.ended : 0;
      return { voices, playing };
    });
    if (a.playing !== last) {
      last = a.playing;
      steadySince = Date.now();
    }
    if ((a.voices === 0 && Date.now() - steadySince >= 500) || Date.now() > end) break;
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => {
    const gc = (window as any).gc as (() => void) | undefined;
    if (gc) {
      gc();
      gc();
    }
  });
  await cdp.send("HeapProfiler.collectGarbage");
  // A collected audio buffer is taken off the count by its FinalizationRegistry callback, a task after the GC.
  await page.waitForTimeout(200);
  const heap = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
  const c = await page.evaluate(() => {
    const w = window as any;
    const world = w.__ns.world;
    const r = world.renderer;
    let objects = 0;
    world.scene.traverse(() => {
      objects++;
    });
    const em = world.entityManager;
    let entities = 0;
    for (const e of (em?.indexLookup ?? []) as unknown[]) if (e) entities++;
    const xl = (r.xr._listeners ?? {}) as Record<string, unknown[] | undefined>;
    let threeXr = 0;
    for (const k of Object.keys(xl)) threeXr += xl[k]?.length ?? 0;
    const a = w.__soakAudio as { created: number; connected: number; started: number; ended: number; buffers: number; pcm: number } | undefined;
    const music: boolean = !!w.__ns.audio.music().playing;
    return {
      geometries: r.info.memory.geometries as number,
      textures: r.info.memory.textures as number,
      programs: (r.info.programs?.length ?? -1) as number,
      objects,
      entities,
      entitySlots: (em?.entityIndex ?? -1) as number,
      bus: w.__ns.busListeners() as number,
      threeXr,
      audio: a
        ? { connected: a.connected, playing: a.started - a.ended, created: a.created, buffers: a.buffers, pcmMB: a.pcm / 1048576, music }
        : { connected: -1, playing: -1, created: -1, buffers: -1, pcmMB: -1, music },
    };
  });
  const dom = await domListeners(cdp);
  const stored = await page.evaluate(storedProfile);
  return { label, ...c, dom, heapKB: heap.usedSize / 1024, profileBytes: stored?.bytes ?? 0, collection: stored?.collection ?? 0 };
}

/** The audio decodes so far, as a line: how many, their files' and buffers' size, and the real ms they took. */
export async function decodeLine(app: XrApp): Promise<string> {
  const d = await app.page.evaluate(() => ((window as any).__soakAudio?.decodes ?? []) as { file: number; pcm: number; ms: number; at: number }[]);
  if (!d.length) return "audio decodes: none";
  const sum = (k: "file" | "pcm" | "ms") => d.reduce((a, x) => a + x[k], 0);
  const big = d.reduce((a, x) => (x.pcm > a.pcm ? x : a));
  const span = Math.max(...d.map((x) => x.at + x.ms)) - Math.min(...d.map((x) => x.at));
  const rest = d.filter((x) => x !== big);
  return (
    `audio decodes: ${d.length} files, ${(sum("file") / 1024).toFixed(0)} KB to ${(sum("pcm") / 1048576).toFixed(2)} MB of PCM; ` +
    `the largest ${(big.file / 1024).toFixed(0)} KB to ${(big.pcm / 1048576).toFixed(2)} MB in ${big.ms.toFixed(0)} ms; ` +
    `the other ${rest.length}: ${(rest.reduce((a, x) => a + x.ms, 0) / Math.max(1, rest.length)).toFixed(1)} ms each on average, ` +
    `${rest.length ? Math.max(...rest.map((x) => x.ms)).toFixed(0) : 0} ms at most; first call to last buffer ${span.toFixed(0)} ms (real, decodes overlap)`
  );
}

/** One sample as a line for the run notes. */
export function sampleLine(what: string, s: Sample): string {
  const dom = Object.entries(s.dom).map(([k, v]) => `${k} ${v}`).join(", ");
  return (
    `${what} ${s.label}: ${s.geometries} geometries, ${s.textures} textures, ${s.programs} programs, ${s.objects} scene objects, ` +
    `${s.entities} entities (${s.entitySlots} slots), ${s.bus} bus listeners, DOM listeners ${dom}, three XR ${s.threeXr}; ` +
    `audio ${s.audio.connected} nodes wired, ${s.audio.playing} sources playing (music ${s.audio.music ? "on" : "off"}), ${s.audio.created} made in all, ` +
    `${s.audio.buffers} buffers alive holding ${s.audio.pcmMB.toFixed(2)} MB of PCM; ` +
    `heap ${(s.heapKB / 1024).toFixed(2)} MB after GC; profile ${s.profileBytes} bytes stored, ${s.collection} in the collection`
  );
}

/** Note and log a line. */
export function note(testInfo: TestInfo, line: string): void {
  console.log(line);
  testInfo.annotations.push({ type: "soak", description: line });
  addRunNote(line);
}

// --- The reference box's cost -------------------------------------------------------------------------------------

/** The reference box: perf-budget's box 15, played and timed the same way (helpers/perf-play.ts). */
export const REF_BOX = 15;
/** Windows of TIMED_FRAMES frames at each measurement; the better one is judged (the stall rule). */
const REF_WINDOWS = 3;
const ALL_TIPS = ["decoys", "ringless", "hidden", "drawer"];

export interface Cost {
  /** The judged window's p95 and mean of our JS a frame at 4x, without its stalls, and its stalls. */
  p95Ms: number;
  meanMs: number;
  stalls: number;
  /** The most draw calls and triangles in any one frame of any window. */
  calls: number;
  triangles: number;
  windows: PlayWindow[];
}

/**
 * The reference box timed as perf-budget times it: box 15 in play, the lantern carried back and forth in the right
 * hand and the left hand's fingers in the beam, REF_WINDOWS windows at 4x. Every tip counts as seen meanwhile (a coach
 * chip shown at one measurement and not the other would change the draw calls); the tips seen before are put back.
 * Both hands leave the box after.
 */
export async function referenceCost(app: XrApp, testInfo: TestInfo, label: string): Promise<Cost> {
  const page = app.page;
  const seen = await page.evaluate(() => window.__sl!.lessons.state().tipsSeen);
  await page.evaluate((all) => window.__ns!.ui.profile({ tipsSeen: all }), ALL_TIPS);
  const sweep = await boxInPlay(app, page, REF_BOX);
  const windows = await timedWindows(app, page, sweep, 4, REF_WINDOWS);
  const frames = windows.map((w) => w.frames);
  const p95 = judgeWindowsP95(frames), mean = judgeWindows(frames);
  const cost: Cost = {
    p95Ms: p95.p95Ms,
    meanMs: mean.meanMs,
    stalls: p95.stalls,
    calls: Math.max(...windows.map((w) => w.calls)),
    triangles: Math.max(...windows.map((w) => w.triangles)),
    windows,
  };
  note(
    testInfo,
    `soak, box ${REF_BOX} at the ${label}: our JS at 4x p95 ${cost.p95Ms.toFixed(2)} ms (window ${p95.index + 1}, ${p95.stalls} stalls over ` +
      `${STALL_MS} ms left out), mean ${cost.meanMs.toFixed(3)} ms; windows' p95 ${windows
        .map((w) => judgeWindowsP95([w.frames]).p95Ms.toFixed(2))
        .join(", ")} ms; ${cost.calls} draw calls, ${cost.triangles} triangles at most; server load ${windows.map((w) => w.load?.toFixed(1) ?? "?").join(", ")}`,
  );
  expect(cost.stalls, `${label}: stalls in the judged window`).toBeLessThanOrEqual(MAX_STALLS);
  await handsAway(app);
  await page.evaluate((t) => window.__ns!.ui.profile({ tipsSeen: t }), seen);
  return cost;
}

/** Both hands open (hand tracking on), out of the box and away from the lantern, in the lap beside it. */
export async function handsAway(app: XrApp): Promise<void> {
  await app.queue("set_input_mode", { mode: "hand" });
  const [l, r] = await worldOf(app.page, [
    [-1.6, -0.6, 2.4],
    [1.6, -0.6, 2.4],
  ]);
  for (const [device, p] of [
    ["hand-left", l!],
    ["hand-right", r!],
  ] as const) {
    await app.queue("set_connected", { device, connected: true });
    await app.queue("set_select_value", { device, value: 0 });
    await app.queue("set_hand_pose", { device, poseId: "default" });
    await app.queue("set_transform", { device, anchor: "grasp", position: { x: p[0], y: p[1], z: p[2] }, orientation: "auto" });
  }
  await app.settle();
}

// --- Playing boxes ------------------------------------------------------------------------------------------------

const state = (app: XrApp): Promise<SlSessionState> => app.page.evaluate(() => window.__sl!.session.state()!);

/** Step until a box (box `key`, when given) is in play with its etching shown; its state. */
export async function inPlay(app: XrApp, key?: string): Promise<SlSessionState> {
  await app.stepUntil(
    (_ns, w, k) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed && (k === null || s.key === k);
    },
    { arg: key ?? null, maxMs: 15_000, label: key ? `${key} in play` : "a box in play" },
  );
  return state(app);
}

/** The plate's and the hint lantern's keys. */
const boxKeys = (app: XrApp): Promise<SlKey[]> => app.page.evaluate(() => window.__sl!.session.keys());

/** Poke a key of the box (the plate, the hint lantern) with the right index fingertip along its normal, and back out. */
export async function pokeKey(app: XrApp, id: string): Promise<void> {
  const k = (await boxKeys(app)).find((x) => x.id === id);
  if (!k || !k.live) throw new Error(`no live key "${id}" (have: ${(await boxKeys(app)).map((x) => `${x.id}${x.live ? "" : " (off)"}`).join(", ")})`);
  const at = (d: number) => ({ x: k.world[0] + k.normal[0] * d, y: k.world[1] + k.normal[1] * d, z: k.world[2] + k.normal[2] * d });
  const device = "hand-right";
  await app.queue("set_input_mode", { mode: "hand" });
  await app.queue("set_connected", { device, connected: true });
  await app.queue("set_hand_pose", { device, poseId: "point" });
  await app.queue("set_transform", { device, anchor: "index-tip", position: at(0.15), orientation: "auto" });
  await app.queue("animate_to", { device, anchor: "index-tip", position: at(0.05), duration: 0.3, easing: "minimum-jerk" });
  await app.queue("animate_to", { device, anchor: "index-tip", position: at(POKE_DEPTH_M), duration: 0.15, easing: "minimum-jerk" });
  await app.queue("animate_to", { device, anchor: "index-tip", position: at(0.12), duration: 0.15, easing: "minimum-jerk" });
  await app.settle();
}

/** Put the lantern on a plain lock's spot (through its controller) and step until that lock is open. */
async function openWithLantern(app: XrApp, lock: number, spot: Vec3): Promise<void> {
  await app.page.evaluate((L) => window.__sl!.placeLantern(L), spot);
  await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 2_000, batch: 1, label: `lock ${lock} open` });
}

/** Finger depths (box z) a finger lock is tried at, in turn: session.spec's, the bot's, a deeper one. */
const FINGER_DEPTHS = [0.5, 0.45, 0.6];

/**
 * A finger lock opened by the right index finger laid in its gap with the lantern on its spot (session.spec's way),
 * then the finger out of the box. Tries the next depth if the lock stays shut.
 */
async function openWithFinger(app: XrApp, lock: number): Promise<void> {
  const page = app.page;
  const l = (await fingerLocks(page)).find((f) => f.lock === lock)!;
  await page.evaluate((L) => window.__sl!.placeLantern(L), l.spot);
  await app.step(3);
  const { mid, angle } = axisOf(l.piece);
  // The finger points to the player's left, so a right hand lies to the right of the gap.
  const sign = Math.cos(angle) >= 0 ? -1 : 1;
  for (const z of FINGER_DEPTHS) {
    const hand = new Pointer(app, "right");
    await hand.lay(onRay(l.spot, mid, z), [sign * Math.cos(angle), sign * Math.sin(angle), 0]);
    let open = true;
    try {
      await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 3_000, batch: 1, label: `finger lock ${lock} open` });
    } catch {
      open = false;
    }
    const [inBox, out] = await worldOf(page, [
      [0, 0, z],
      [0, 0, 1.6],
    ]);
    await hand.shift([out![0] - inBox![0], out![1] - inBox![1], out![2] - inBox![2]]);
    await app.step(3);
    if (open) return;
  }
  throw new Error(`finger lock ${lock} stayed shut at depths ${FINGER_DEPTHS.join(", ")}`);
}

/** Pinch the risen reward where it floats, carry it 12 cm toward the head, let go, and the hand leaves. */
async function takeReward(app: XrApp): Promise<void> {
  const page = app.page;
  const r = (await page.evaluate(() => window.__sl!.session.reward()))!;
  const head = (await app.state()).head!;
  const hand = new Hands(app, "left");
  await hand.pinchAt(r.world);
  await app.step(6);
  await hand.moveTo(add(r.world, unit(sub(head, r.world)), 0.12), 400);
  await hand.release();
  await hand.moveTo(add(r.world, [0.2, 0.25, 0.2]), 200);
}

/** Play the box in play to its end: every lock opened, the box open, its reward taken (the plate offers Next). */
export async function solveBox(app: XrApp): Promise<SlSessionState> {
  const s = await state(app);
  for (const l of s.locks.filter((x) => !x.finger)) {
    if (!(await state(app)).open.includes(l.i)) await openWithLantern(app, l.i, l.spot);
  }
  for (const l of s.locks.filter((x) => x.finger)) {
    if (!(await state(app)).open.includes(l.i)) await openWithFinger(app, l.i);
  }
  await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "reward", { maxMs: 4_000, label: `${s.key}: the reward up` });
  await takeReward(app);
  await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "offered", { maxMs: 9_000, label: `${s.key}: the reward taken` });
  return state(app);
}

/** Frames the virtual clock has stepped so far. */
export const framesSoFar = (app: XrApp): Promise<number> => app.page.evaluate(() => (window as any).__vt.frames as number);

export interface SoakOptions {
  /** Boxes played in a row, from box 1. */
  boxes: number;
  /** Sample every this many boxes (and after box 1). */
  every: number;
  /** The heap after GC may grow less than this from the sample after box `every` to the last (KB). */
  heapKB: number;
  /** The stored profile may grow at most this a box solved (bytes: its collection's new item). */
  profileBytesPerBox: number;
  /** The reference box's p95 at the end at most this many times the start's. */
  costRatio: number;
  /**
   * Counts the box `every` sample is short of, by name: parts made once and drawn for the first time after it
   * (FOCUS_MARK_SHOWN_LATER). Every sample after the next one must then match the next one exactly.
   */
  shownLater?: Readonly<Record<string, number>>;
}

/**
 * The one geometry a soak draws for the first time after box 10: HintMarks' focus mark (src/app/hints.ts), the small
 * gold diamond above the lock the head's gaze rests on. It is made once, with the hint marks, and drawn the first time
 * the gaze rests on a closed lock. The soak's head never moves (SEATED), so that is the first box with a closed lock
 * on its line of sight: box 13, whose one lock sits there. One geometry, made once and never again; the counts from
 * box 20 on match box 20's exactly, so a part made per box still fails.
 */
export const FOCUS_MARK_SHOWN_LATER: Readonly<Record<string, number>> = { geometries: 1 };

/**
 * The box soak: the reference box timed, then boxes 1 to `boxes` in a row, each to its end and the next by the plate's
 * Next, sampled (in the same state: the reward taken, Next offered) after box 1 and every `every` boxes, then the
 * reference box timed again. Asserts the last sample counts what the box `every` sample counts, plus `shownLater` and
 * nothing else, and exactly what the sample after that counts; the heap after GC grown by less than `heapKB` from the
 * box `every` sample; the profile grown only by its collection; the reference box's p95 at the end within `costRatio`
 * of the start's, with the same draw calls and triangles.
 */
export async function soakBoxes(app: XrApp, testInfo: TestInfo, o: SoakOptions): Promise<{ samples: Sample[]; start: Cost; end: Cost }> {
  const page = app.page;
  const cdp = await page.context().newCDPSession(page);
  await app.stepUntil((ns) => ns.audio.ready(), { maxMs: 10_000, label: "sound effects loaded" });
  const start = await referenceCost(app, testInfo, "start");
  note(testInfo, await decodeLine(app));
  // The reference box's grab was the gesture the engine waits for: sound plays from here on.
  await app.stepUntil((ns) => ns.audio.running(), { maxMs: 2_000, label: "audio running" });
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 1 }));
  await inPlay(app, "shadow-locks/1");
  const samples: Sample[] = [];
  let real0 = Date.now(), f0 = await framesSoFar(app);
  for (let n = 1; n <= o.boxes; n++) {
    await solveBox(app);
    if (n === 1 || n % o.every === 0) {
      const f = await framesSoFar(app);
      note(testInfo, `soak, boxes to ${n}: ${f - f0} frames in ${((Date.now() - real0) / 1000).toFixed(0)} s real`);
      const s = await sample(app, cdp, `box ${n}`);
      samples.push(s);
      note(testInfo, sampleLine("soak", s));
      real0 = Date.now();
      f0 = await framesSoFar(app);
    }
    if (n < o.boxes) {
      await pokeKey(app, "plate-next");
      await inPlay(app, `shadow-locks/${n + 1}`);
    }
  }
  const end = await referenceCost(app, testInfo, "end");
  await cdp.detach();

  const from = samples.find((s) => s.label === `box ${o.every}`)!, last = samples[samples.length - 1]!;
  const boxes = o.boxes - o.every;
  note(
    testInfo,
    `soak: ${from.label} to ${last.label}: heap ${((last.heapKB - from.heapKB) / 1024).toFixed(2)} MB (bound ${(o.heapKB / 1024).toFixed(2)}), ` +
      `profile ${last.profileBytes - from.profileBytes} bytes over ${boxes} boxes (${((last.profileBytes - from.profileBytes) / boxes).toFixed(0)} a box); ` +
      `box ${REF_BOX} p95 ${start.p95Ms.toFixed(2)} -> ${end.p95Ms.toFixed(2)} ms (${((end.p95Ms / start.p95Ms - 1) * 100).toFixed(1)}%), ` +
      `draw calls ${start.calls} -> ${end.calls}`,
  );
  const later = o.shownLater ?? {};
  const expected = counts(from);
  for (const [k, v] of Object.entries(later)) expected[k] = (expected[k] ?? 0) + v;
  expect(counts(last), `${last.label} against ${from.label}, with what shows later (${JSON.stringify(later)})`).toEqual(expected);
  expect(last.heapKB - from.heapKB, `heap growth from ${from.label} to ${last.label} (KB)`).toBeLessThan(o.heapKB);
  const next = samples[samples.indexOf(from) + 1];
  if (next && next !== last) expect(counts(last), `${last.label} against ${next.label}`).toEqual(counts(next));
  expect(last.collection - from.collection, "one collection item a box").toBe(boxes);
  expect((last.profileBytes - from.profileBytes) / boxes, "stored profile bytes a box").toBeLessThanOrEqual(o.profileBytesPerBox);
  expect(end.calls, `box ${REF_BOX}'s draw calls at the end`).toBe(start.calls);
  expect(end.triangles, `box ${REF_BOX}'s triangles at the end`).toBe(start.triangles);
  expect(end.p95Ms, `box ${REF_BOX}'s p95 at the end against the start's ${start.p95Ms.toFixed(2)} ms`).toBeLessThanOrEqual(start.p95Ms * o.costRatio);
  return { samples, start, end };
}

// --- The other long-session paths (soak-paths.spec.ts) ------------------------------------------------------------

const along = (p: Vec3, d: Vec3, k: number): Vec3 => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];

/** Pinch the menu drawer's handle and pull it 6 cm toward the player: Home comes up (menus.spec's pull). */
export async function pullDrawer(app: XrApp): Promise<void> {
  await app.stepUntil((n) => n.ui.drawer().out === 0, { maxMs: 3_000, label: "drawer shut" });
  const d = await app.page.evaluate(() => window.__ns!.ui.drawer());
  const hand = new Hands(app, "right");
  await hand.pinchAt(d.handle);
  await hand.moveTo(along(d.handle, d.toward, 0.06), 400);
  await app.stepUntil((n) => n.state().screen === "home", { maxMs: 2_000, label: "home after the pull" });
  await hand.release();
  await hand.moveTo(along(d.handle, d.toward, 0.3), 300);
  await app.stepUntil((n) => !n.ui.busy(), { maxMs: 3_000, label: "home at rest" });
}

/** The Lessons menu's rows of the four examples, as the replays go round them. */
export const EXAMPLE_ROWS: readonly (readonly [string, string])[] = [
  ["lesson-move", "move"],
  ["lesson-near-far", "near-far"],
  ["lesson-rings", "rings"],
  ["lesson-finger", "finger"],
];

/** A Lessons row replayed from the box in play: the drawer pulled, Lessons, the row; the example to its end; the box back. */
export async function replayRow(app: XrApp, row: string, ex: string, key: string): Promise<void> {
  await pullDrawer(app);
  await app.poke("home-lessons");
  await app.stepUntil((n) => n.state().screen === "lessons", { maxMs: 5_000, label: "lessons" });
  await app.poke(row);
  await app.stepUntil((n, w, e) => n.state().screen === "play" && w.__sl.lessons.state().replaying === e, { arg: ex, maxMs: 3_000, label: `${ex} replaying` });
  await app.stepUntil((_n, w) => w.__sl.lessons.state().replaying === null, { maxMs: 45_000, batch: 12, label: `${ex} over` });
  await inPlay(app, key);
}

/** The hint lantern poked and one of its choices: a Hint (the next hint shows), or Show me (its example to the end). */
export async function hintUse(app: XrApp, choice: "hint" | "show-me", key: string): Promise<void> {
  const before = (await state(app)).hints;
  await pokeKey(app, "hint-lantern");
  await app.step(10);
  await pokeKey(app, choice === "hint" ? "hint-choice" : "hint-show-me");
  await app.step(10);
  if (choice === "hint") {
    await app.stepUntil((_n, w, b) => w.__sl.session.state().hints > b, { arg: before, maxMs: 2_000, label: "the hint shown" });
    return;
  }
  await app.stepUntil((_n, w) => w.__sl.lessons.state().replaying !== null, { maxMs: 3_000, label: "Show me replaying" });
  await app.stepUntil((_n, w) => w.__sl.lessons.state().replaying === null, { maxMs: 45_000, batch: 12, label: "Show me over" });
  await inPlay(app, key);
}

/** The drawer pulled (Home up) and Continue poked: back to the box in play, the drawer shut. */
export async function menuCycle(app: XrApp, key: string): Promise<void> {
  await pullDrawer(app);
  await app.poke("home-continue");
  await app.stepUntil((n) => n.state().screen === "play" && n.ui.drawer().out === 0 && !n.ui.busy(), { maxMs: 5_000, label: "back to play" });
  await inPlay(app, key);
}

/** The headset taken off (the XR session and the page hidden) or put back on, then a half second of frames. */
export async function headsetOn(app: XrApp, on: boolean): Promise<void> {
  await app.page.evaluate((v) => {
    const w = window as any;
    w.IWER_DEVICE.updateVisibilityState(v ? "visible" : "hidden");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (v ? "visible" : "hidden") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => !v });
    document.dispatchEvent(new Event("visibilitychange"));
  }, on);
  await app.step(36);
}

/** `p` turned `deg` to the left about the up axis, in the same place (shell.spec's). */
function turnedLeft(p: { position: XYZ; lookAt: XYZ }, deg: number): { position: XYZ; lookAt: XYZ } {
  const a = (deg * Math.PI) / 180, dx = p.lookAt.x - p.position.x, dz = p.lookAt.z - p.position.z;
  return { position: p.position, lookAt: { x: p.position.x + dx * Math.cos(a) + dz * Math.sin(a), y: p.lookAt.y, z: p.position.z - dx * Math.sin(a) + dz * Math.cos(a) } };
}

/** Far enough round that no part of the box is in view (shell.spec's AWAY_DEG). */
const AWAY_DEG = 135;

/**
 * A lost box summoned back: the head turned to face `away` (135 degrees to the left) or back, the box left out of
 * view until the arrow shows, the arrow pinched, and the box placed in front of the head again.
 */
export async function summonOnce(app: XrApp, away: boolean): Promise<void> {
  const page = app.page;
  await page.evaluate(setHeadset, away ? turnedLeft(SEATED, AWAY_DEG) : SEATED);
  await app.stepUntil((_ns, w) => w.__sl.summon().arrow !== null, { maxMs: 4_000, label: "the arrow up" });
  await app.step(60);
  const arrow = (await page.evaluate(() => window.__sl!.summon())).arrow!;
  const yaw = away ? (AWAY_DEG * Math.PI) / 180 : 0;
  const hand = new Hands(app, "right");
  await hand.pinchAt(arrow);
  await app.stepUntil((ns, w, y) => w.__sl.summon().phase === "idle" && Math.abs(Math.atan2(Math.sin(ns.state().boxPose.yaw - y), Math.cos(ns.state().boxPose.yaw - y))) < 0.01, {
    arg: yaw,
    maxMs: 2_000,
    label: "the box brought back",
  });
  await hand.release();
  await handsAway(app);
}

/** A path's heap growth over its last block of cycles may be this much and still count as noise (KB). */
export const HEAP_NOISE_KB = 128;
/** ...or this share of its first block's growth: warm-up dies away, a leak keeps its pace. */
export const HEAP_SETTLE_SHARE = 0.75;

/**
 * A path's heap after GC settles: its growth over the last block of cycles is under HEAP_NOISE_KB, or under
 * HEAP_SETTLE_SHARE of its growth over the first block. A leak of L KB a cycle grows the same in every block and fails
 * once a block's L exceeds HEAP_NOISE_KB (12.8 KB a cycle in blocks of 10); the engine's and the libraries' own warm-up
 * (code optimised, caches and pools sized up: what the paths' first soak measured, dying away block by block) passes.
 */
export function expectHeapSettles(name: string, samples: readonly Sample[]): void {
  const g = samples.slice(1).map((s, i) => s.heapKB - samples[i]!.heapKB);
  const first = g[0]!, last = g[g.length - 1]!;
  const bound = Math.max(HEAP_NOISE_KB, HEAP_SETTLE_SHARE * first);
  expect(g.length, `${name}: at least two blocks of cycles`).toBeGreaterThanOrEqual(2);
  expect(last, `${name}: heap growth over the last block (KB), against ${bound.toFixed(0)} (blocks: ${g.map((x) => x.toFixed(0)).join(", ")})`).toBeLessThan(bound);
}

/**
 * A long-session path soaked: `warm` cycles first (long enough for everything the path shows to have shown once: what
 * shows the first time is made then), a sample, then `cycles` more with a sample every `every`. Every count at the
 * last sample as at the first (no slack), and the heap settled (expectHeapSettles).
 */
export async function soakPath(
  app: XrApp,
  testInfo: TestInfo,
  name: string,
  o: { warm: number; cycles: number; every: number },
  cycle: (i: number) => Promise<void>,
): Promise<Sample[]> {
  const cdp = await app.page.context().newCDPSession(app.page);
  for (let i = 0; i < o.warm; i++) await cycle(i);
  const samples = [await sample(app, cdp, `after ${o.warm}`)];
  note(testInfo, sampleLine(name, samples[0]!));
  let real0 = Date.now(), f0 = await framesSoFar(app);
  for (let i = o.warm; i < o.warm + o.cycles; i++) {
    await cycle(i);
    const done = i + 1 - o.warm;
    if (done % o.every === 0 || done === o.cycles) {
      note(testInfo, `${name}: ${done} cycles, ${(await framesSoFar(app)) - f0} frames in ${((Date.now() - real0) / 1000).toFixed(0)} s real`);
      const s = await sample(app, cdp, `after ${o.warm} + ${done}`);
      samples.push(s);
      note(testInfo, sampleLine(name, s));
      real0 = Date.now();
      f0 = await framesSoFar(app);
    }
  }
  await cdp.detach();
  const first = samples[0]!, last = samples[samples.length - 1]!;
  const blocks = samples.slice(1).map((s, i) => ((s.heapKB - samples[i]!.heapKB) / 1024).toFixed(2));
  note(testInfo, `${name}: ${first.label} to ${last.label}: heap ${((last.heapKB - first.heapKB) / 1024).toFixed(2)} MB, by block ${blocks.join(", ")} MB`);
  expect(counts(last), `${last.label} against ${first.label}`).toEqual(counts(first));
  expectHeapSettles(name, samples);
  return samples;
}

/** Console errors the page logged. */
export const pageErrors = (app: XrApp): string[] => app.consoleLines.filter((l) => l.startsWith("error:") || l.startsWith("PAGEERROR"));
