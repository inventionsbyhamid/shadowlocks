// Sound for the game: one Web Audio engine for the effects, the music and the captions, and the
// controller haptics. Effects load at boot, music once the first screen is up. Every bus event goes
// through the cue mapper (heard after every other listener), placed where it happened: at the button
// it names. The box's own sounds (locks, hums, the music box) come from `game`, which the box session
// calls. Audio starts on the first pinch, poke or grab (or the Enter tap), pauses with the game
// whenever the player cannot see it (the lifecycle's audio hook), follows the head for spatial
// sounds, and plays room tone only in the virtual room (no passthrough). Variants and pitch spread
// come from a seeded random source, so a frame-stepped run sounds the same every time.
import { createSystem, type Object3D, Vector3, type World } from "@iwsdk/core";
import { CueMapper, type CueEvent, GAME_CUE_TYPES, GameSounds, placeOf, type SoundPlaces } from "../audio/cues";
import { AudioEngine } from "../audio/engine";
import type { ListenerPose } from "../audio/manifest";
import { loadSoundPack, type SoundPack } from "../audio/pack";
import { mulberry32, seedFrom } from "../core/rng";
import type { Box, V3, Vec3 } from "../core/types";
import { CaptionQueue, captionFor } from "../ui/captions";
import { startAudio } from "./audio-unlock";
import { type FeedbackEvent, on, onAny } from "./bus";
import { type HapticSession, Haptics } from "./haptics";
import type { Lifecycle } from "./lifecycle";
import type { PanelButton } from "./panels";
import { currentScreen, type Screen } from "./screens";
import type { SettingsStore } from "./settings";

/** The box in the scene, as sound needs it: its locks, its root (box units to world) and the lantern. */
export interface SoundBox {
  readonly box: Box | null;
  readonly root: Object3D;
  readonly lantern: { getPos(out: V3): V3 };
}

/** What sound needs of the app: the keys on screen, the box, settings, the lifecycle and where captions go. */
export interface SoundDeps {
  world: World;
  settings: SettingsStore;
  lifecycle: Lifecycle;
  /** Keys of a menu screen (for where a press sounds). */
  menuButtons(screen: Screen): PanelButton[];
  /** The box (for where lock, lantern and box sounds are). */
  box?: SoundBox;
  /** Shows a sound's caption (Settings, Captions) on the game's caption strip, once there is one. */
  caption?: (id: string, text: string) => void;
}

/** The listener moves when the head moved this far (m, summed over axes)... */
const LISTENER_MOVE_M = 0.002;
/** ...or turned more than about 1 degree (cosine of the angle between the old and new forward). */
const LISTENER_TURN_COS = Math.cos((1 * Math.PI) / 180);
/** The middle of the box, in box units. */
const BOX_MIDDLE: V3 = [0, 0, 0.5];

export class Sound {
  readonly engine: AudioEngine;
  /** The box's sounds and haptics: the box session calls these. */
  readonly game: GameSounds;
  readonly haptics: Haptics;
  /** Captions up now (the game's caption strip draws them). */
  readonly captions = new CaptionQueue();
  private readonly mapper: CueMapper;
  private readonly pose: ListenerPose = { position: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] };
  /** The listener has been placed once (the first frame always places it). */
  private placed = false;
  private readonly tmp = new Vector3();
  private readonly tmpBox: V3 = [0, 0, 0];
  private pack: Promise<{ pack: SoundPack; loadMusic: () => Promise<void> } | null>;
  private effects = false;

  constructor(private readonly deps: SoundDeps) {
    this.engine = new AudioEngine({
      random: mulberry32(seedFrom("shadow-locks-sound")),
      baseUrl: `${import.meta.env.BASE_URL}audio/`,
      // Captions only when the player asked for them, and only for sounds that carry meaning; the
      // engine reports one even for a sound it does not play (muted, cooldown, before audio starts).
      onCaption: (id) => this.caption(id),
    });
    const places = this.places();
    this.mapper = new CueMapper({ locate: (e) => this.locate(e) ?? placeOf(e, places) });
    // WebXR typings disagree on gamepad.hapticActuators; haptics reads only what it checks for.
    this.haptics = new Haptics(() => (deps.world.session ?? null) as unknown as HapticSession | null, () => performance.now());
    this.game = new GameSounds({
      engine: this.engine,
      now: () => performance.now(),
      haptics: this.haptics,
      warmth: () => deps.settings.get().warmth,
      places,
      mapper: this.mapper,
    });
    this.pack = loadSoundPack(this.engine, { baseUrl: `${import.meta.env.BASE_URL}audio/`, warn: (m) => console.warn(m) }).then(
      (p) => {
        this.effects = true;
        return p;
      },
      (err) => {
        console.warn("sound effects could not load", err);
        return null;
      },
    );

    onAny((e) => this.send(e));
    // The first pinch, poke or grab may start audio (browsers want a gesture).
    on("press", () => this.unlock());
    on("grab", (e) => {
      this.unlock();
      this.game.grab(e.hand);
    });
    on("release", () => this.game.release());
    // Leaving play drops what the box still had to say (a tune half played, the hums).
    on("screen", (e) => {
      if (e.from === "play" && e.to !== "play") this.game.reset();
    });
    deps.lifecycle.setAudio(this.engine);
    const apply = (s: { musicVol: number; sfxVol: number; captions: boolean }) => {
      this.engine.setVolumes({ music: s.musicVol, sfx: s.sfxVol });
      if (!s.captions) this.captions.clear();
      this.game.settingsChanged();
    };
    apply(deps.settings.get());
    deps.settings.subscribe(apply);
    this.watchXr();
  }

  /** The sound effects (and their captions) are loaded. */
  get loaded(): boolean {
    return this.effects;
  }

  /** Start audio (on a gesture). Every gesture tries again until audio runs. */
  unlock(): void {
    startAudio(this.engine);
  }

  /** Music is the bigger download: load it once the first screen is up. */
  loadMusicLater(): void {
    void this.pack.then((p) => p?.loadMusic()).catch((err) => console.warn("music could not load", err));
  }

  /** The caption texts up now (tests). */
  captionsShown(): string[] {
    return this.captions.slots.filter((s) => s.active).map((s) => s.text);
  }

  /**
   * Per frame: timed sounds and pulses, captions, and the listener following the head (only while
   * audio runs, and only when the head moved: every listener write crosses into the audio graph).
   * Allocation free.
   */
  update(dt: number): void {
    this.game.update();
    if (this.captions.any) this.captions.step(dt);
    const head = this.deps.world.player?.head;
    if (head && this.engine.running) this.follow(head);
  }

  /** The listener at the head: one world matrix update, read straight from its columns. */
  private follow(head: Object3D): void {
    head.updateWorldMatrix(true, false);
    const e = head.matrixWorld.elements;
    const p = this.pose;
    const x = e[12] as number;
    const y = e[13] as number;
    const z = e[14] as number;
    // Forward is the head's -z axis, up its y axis (no scale on the head).
    const fx = -(e[8] as number);
    const fy = -(e[9] as number);
    const fz = -(e[10] as number);
    const moved =
      Math.abs(x - p.position[0]) + Math.abs(y - p.position[1]) + Math.abs(z - p.position[2]) > LISTENER_MOVE_M ||
      fx * p.forward[0] + fy * p.forward[1] + fz * p.forward[2] < LISTENER_TURN_COS;
    if (!moved && this.placed) return;
    this.placed = true;
    p.position[0] = x;
    p.position[1] = y;
    p.position[2] = z;
    p.forward[0] = fx;
    p.forward[1] = fy;
    p.forward[2] = fz;
    p.up[0] = e[4] as number;
    p.up[1] = e[5] as number;
    p.up[2] = e[6] as number;
    this.engine.setListener(p);
  }

  /**
   * Bus events through the cue mapper. A game event on the bus is a record of something the box
   * session already played through `game` (the demo video's mix replays those), so it is not played
   * again here.
   */
  private send(e: FeedbackEvent): void {
    if (GAME_CUE_TYPES.has(e.type)) return;
    this.game.handle(e);
  }

  /** A sound with a manifest caption was asked for: show it if it is one that carries meaning. */
  private caption(id: string): void {
    if (!this.deps.settings.get().captions) return;
    const text = captionFor(id);
    if (!text) return;
    // Centred on the strip: the strip that draws captions places them along itself.
    this.captions.push(id, text, 0);
    this.deps.caption?.(id, text);
  }

  /** Room tone only in the virtual room (an opaque VR session); passthrough has the real room. */
  private watchXr(): void {
    const xr = this.deps.world.renderer.xr;
    xr.addEventListener("sessionstart", () => {
      this.unlock();
      this.engine.setAmbience(xr.getSession()?.environmentBlendMode === "opaque");
    });
    xr.addEventListener("sessionend", () => this.engine.setAmbience(false));
    // A pinch or trigger anywhere counts as the first gesture too.
    xr.addEventListener("sessionstart", () => xr.getSession()?.addEventListener("selectstart", () => this.unlock()));
  }

  /** Where a button event happened: the key it names on the current screen. */
  private locate(e: CueEvent): Vec3 | undefined {
    const id = (e as { id?: unknown }).id;
    if (typeof id !== "string") return undefined;
    const b = this.deps.menuButtons(currentScreen()).find((k) => k.id === id);
    if (!b) return undefined;
    b.object.getWorldPosition(this.tmp);
    return [this.tmp.x, this.tmp.y, this.tmp.z];
  }

  /** Where the box's locks, lantern and middle are in the world (box units through the box root). */
  private places(): SoundPlaces {
    const toWorld = (p: V3, out: Vec3): boolean => {
      const root = this.deps.box?.root;
      if (!root) return false;
      root.updateWorldMatrix(true, false);
      this.tmp.set(p[0], p[1], p[2]).applyMatrix4(root.matrixWorld);
      out[0] = this.tmp.x;
      out[1] = this.tmp.y;
      out[2] = this.tmp.z;
      return true;
    };
    const onPanel = (x: number, y: number, out: Vec3): boolean => {
      const b = this.tmpBox;
      b[0] = x;
      b[1] = y;
      b[2] = 0;
      return toWorld(b, out);
    };
    const lockOf = (i: number) => this.deps.box?.box?.locks[i];
    return {
      lock: (i, out) => {
        const l = lockOf(i);
        return !!l && onPanel(l.center[0], l.center[1], out);
      },
      mark: (i, out) => {
        const l = lockOf(i);
        const m = l?.mark ?? l?.center;
        return !!m && onPanel(m[0], m[1], out);
      },
      lantern: (out) => {
        const box = this.deps.box;
        return !!box?.box && toWorld(box.lantern.getPos(this.tmpBox), out);
      },
      box: (out) => !!this.deps.box?.box && toWorld(BOX_MIDDLE, out),
    };
  }
}

let sound: Sound | null = null;

/** Hand the sound to its system (systems cannot take constructor arguments). */
export function useSound(s: Sound): void {
  sound = s;
}

/** Sound's per-frame work as an app system (timed in the per-frame budget). */
export class SoundSystem extends createSystem({}) {
  update(delta: number): void {
    sound?.update(delta);
  }
}
